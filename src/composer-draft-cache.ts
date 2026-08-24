import type { CreationMode, UploadAsset } from "./types";

const DB_NAME = "firefly-composer-drafts-v1";
const STORE_NAME = "drafts";
const CACHE_VERSION = 1;
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DIRECT_UPLOAD_AGE_MS = 6 * 24 * 60 * 60 * 1000;
const MAX_ASSETS = 50;

export type ComposerDraftState = {
  engine: "video" | "image";
  prompt: string;
  modelId: string;
  mode: CreationMode;
  ratio: string;
  resolution: string;
  duration: number;
  generateAudio: boolean;
  cameraFixed: boolean;
  watermark: boolean;
  seed: number;
  imageModelId: string;
  imageRatio: string;
  imageResolution: string;
  imageCount: number;
  assets: UploadAsset[];
};

type PersistedAsset = { asset: UploadAsset; cachedAt: number; expiresAt?: number };
export type ComposerDraftRecord = {
  key: string;
  userId: string;
  sessionId: string;
  version: number;
  updatedAt: number;
  state: Omit<ComposerDraftState, "assets"> & { assets: PersistedAsset[] };
};

export type ComposerDraftStore = {
  get(key: string): Promise<ComposerDraftRecord | undefined>;
  put(record: ComposerDraftRecord): Promise<void>;
  delete(key: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
};

const draftKey = (userId: string, sessionId: string) => `${userId}:${sessionId}`;
const persistableAsset = (asset: UploadAsset) => Boolean(asset.assetId || asset.uploadId || asset.snapshotReferenceId) && asset.progress === 100;
const stripEphemeralAssetFields = (asset: UploadAsset): UploadAsset => {
  const { preview: _preview, url: _url, ...durable } = asset;
  return durable;
};

const indexedDbStore = (): ComposerDraftStore => {
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (database) return database;
    database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          const store = request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("userId", "userId", { unique: false });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to open composer drafts"));
    });
    return database;
  };
  const transaction = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      let value: T;
      let failed = false;
      run(tx.objectStore(STORE_NAME), (result) => { value = result; }, (reason) => { failed = true; reject(reason); });
      tx.oncomplete = () => { if (!failed) resolve(value!); };
      tx.onabort = () => reject(tx.error ?? new Error("Composer draft transaction aborted"));
      tx.onerror = () => { /* onabort supplies the authoritative transaction error. */ };
    });
  };
  return {
    get: (key) => transaction<ComposerDraftRecord | undefined>("readonly", (store, resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as ComposerDraftRecord | undefined);
      request.onerror = () => reject(request.error);
    }),
    put: (record) => transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
    delete: (key) => transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
    deleteUser: (userId) => transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.index("userId").openCursor(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    }),
  };
};

export const createComposerDraftCache = (store: ComposerDraftStore, now = () => Date.now()) => {
  const mutations = new Map<string, Promise<void>>();
  const enqueue = (key: string, change: () => Promise<void>) => {
    const previous = mutations.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(change).finally(() => {
      if (mutations.get(key) === next) mutations.delete(key);
    });
    mutations.set(key, next);
    return next;
  };
  const get = async (key: string) => {
    const pending = mutations.get(key);
    if (pending) await pending;
    try { return await store.get(key); } catch { return undefined; }
  };
  return {
    async read(userId: string, sessionId: string) {
      const key = draftKey(userId, sessionId);
      const record = await get(key);
      if (!record || record.version !== CACHE_VERSION || record.userId !== userId || record.sessionId !== sessionId || now() - record.updatedAt > MAX_DRAFT_AGE_MS) {
        if (record) void enqueue(key, () => store.delete(key).catch(() => undefined));
        return undefined;
      }
      let droppedAssets = 0;
      const assets = record.state.assets.filter(({ asset, cachedAt, expiresAt }) => {
        const durable = Boolean(asset.assetId || asset.snapshotReferenceId);
        const validUntil = expiresAt ?? asset.expiresAt ?? cachedAt + MAX_DIRECT_UPLOAD_AGE_MS;
        const valid = persistableAsset(asset) && (durable || now() <= validUntil);
        if (!valid) droppedAssets += 1;
        return valid;
      }).map(({ asset }) => ({ ...asset }));
      return { state: { ...record.state, assets } as ComposerDraftState, droppedAssets };
    },
    write(userId: string, sessionId: string, state: ComposerDraftState) {
      const key = draftKey(userId, sessionId);
      return enqueue(key, async () => {
        const previous = await store.get(key).catch(() => undefined);
        const previousAssets = new Map(previous?.state.assets.map((item) => [item.asset.id, item]) ?? []);
        const assets = state.assets.filter(persistableAsset).slice(0, MAX_ASSETS).map((asset) => {
          const prior = previousAssets.get(asset.id);
          const cachedAt = prior?.cachedAt ?? now();
          return { asset: stripEphemeralAssetFields(asset), cachedAt, expiresAt: asset.expiresAt ?? prior?.expiresAt ?? (asset.assetId || asset.snapshotReferenceId ? undefined : cachedAt + MAX_DIRECT_UPLOAD_AGE_MS) };
        });
        const record: ComposerDraftRecord = { key, userId, sessionId, version: CACHE_VERSION, updatedAt: now(), state: { ...state, prompt: state.prompt.slice(0, 20_000), assets } };
        try { await store.put(record); } catch { /* Draft persistence must never block creation. */ }
      });
    },
    clearSession(userId: string, sessionId: string) {
      const key = draftKey(userId, sessionId);
      return enqueue(key, () => store.delete(key).catch(() => undefined));
    },
    async clearUser(userId: string) {
      for (const [key, pending] of mutations) if (key.startsWith(`${userId}:`)) await pending.catch(() => undefined);
      try { await store.deleteUser(userId); } catch { /* Best-effort privacy cleanup. */ }
    },
  };
};

export const composerDraftCache = createComposerDraftCache(indexedDbStore());

/**
 * Draft persistence is a local recovery aid, never part of generation
 * admission. IndexedDB can be slow or temporarily unavailable, so clearing a
 * submitted draft must not delay or reject the provider-facing request.
 */
export const clearComposerDraftInBackground = (
  cache: Pick<ReturnType<typeof createComposerDraftCache>, "clearSession">,
  userId: string,
  sessionId: string,
) => {
  void cache.clearSession(userId, sessionId).catch(() => undefined);
};
