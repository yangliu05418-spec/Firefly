import type { LibraryAsset } from "./types";

const DB_NAME = "firefly-client-cache-v1";
const STORE_NAME = "asset-metadata";
const CACHE_VERSION = 1;
const MAX_ASSETS = 500;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AssetCacheRecord = {
  userId: string;
  version: number;
  updatedAt: number;
  assets: LibraryAsset[];
};

export type AssetMetadataStore = {
  get(userId: string): Promise<AssetCacheRecord | undefined>;
  put(record: AssetCacheRecord): Promise<void>;
  delete(userId: string): Promise<void>;
};

const validAsset = (value: unknown): value is LibraryAsset => {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<LibraryAsset>;
  return typeof asset.Id === "string" && typeof asset.Name === "string" && ["Image", "Video", "Audio"].includes(asset.AssetType ?? "") && ["Active", "Processing", "Failed"].includes(asset.Status ?? "");
};

const normalizeAssets = (assets: readonly LibraryAsset[]) => {
  const seen = new Set<string>();
  return assets.filter(validAsset).filter((asset) => {
    if (seen.has(asset.Id)) return false;
    seen.add(asset.Id);
    return true;
  }).slice(0, MAX_ASSETS);
};

const indexedDbStore = (): AssetMetadataStore => {
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (database) return database;
    database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "userId" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to open asset cache"));
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
      tx.onabort = () => reject(tx.error ?? new Error("Asset cache transaction aborted"));
      tx.onerror = () => { /* onabort supplies the authoritative transaction error. */ };
    });
  };
  return {
    get: (userId) => transaction<AssetCacheRecord | undefined>("readonly", (store, resolve, reject) => {
      const request = store.get(userId);
      request.onsuccess = () => resolve(request.result as AssetCacheRecord | undefined);
      request.onerror = () => reject(request.error);
    }),
    put: (record) => transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
    delete: (userId) => transaction<void>("readwrite", (store, resolve, reject) => {
      const request = store.delete(userId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
  };
};

export const createAssetMetadataCache = (store: AssetMetadataStore, now = () => Date.now()) => {
  const memory = new Map<string, AssetCacheRecord>();
  const mutations = new Map<string, Promise<void>>();
  const getRecord = async (userId: string) => {
    let record = memory.get(userId);
    if (!record) {
      try { record = await store.get(userId); }
      catch { return undefined; }
      if (record) memory.set(userId, record);
    }
    if (!record || record.version !== CACHE_VERSION || now() - record.updatedAt > MAX_AGE_MS) {
      memory.delete(userId);
      try { await store.delete(userId); } catch { /* Expired cache cleanup is best effort. */ }
      return undefined;
    }
    return record;
  };
  const safeGet = async (userId: string) => {
    const pending = mutations.get(userId);
    if (pending) await pending;
    return getRecord(userId);
  };
  const enqueue = (userId: string, change: () => Promise<void>) => {
    const previous = mutations.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(change).finally(() => {
      if (mutations.get(userId) === next) mutations.delete(userId);
    });
    mutations.set(userId, next);
    return next;
  };
  const persist = async (userId: string, assets: readonly LibraryAsset[]) => {
    const record: AssetCacheRecord = { userId, version: CACHE_VERSION, updatedAt: now(), assets: normalizeAssets(assets) };
    memory.set(userId, record);
    try { await store.put(record); } catch { /* Cache failures must never block the product. */ }
  };
  return {
    async read(userId: string) { return [...(await safeGet(userId))?.assets ?? []]; },
    replace(userId: string, assets: readonly LibraryAsset[]) { return enqueue(userId, () => persist(userId, assets)); },
    merge(userId: string, assets: readonly LibraryAsset[]) {
      return enqueue(userId, async () => {
        const current = (await getRecord(userId))?.assets ?? [];
        const incoming = new Set(assets.map((asset) => asset.Id));
        await persist(userId, [...assets, ...current.filter((asset) => !incoming.has(asset.Id))]);
      });
    },
    replaceType(userId: string, type: LibraryAsset["AssetType"], assets: readonly LibraryAsset[]) {
      return enqueue(userId, async () => {
        const current = (await getRecord(userId))?.assets ?? [];
        await persist(userId, [...assets, ...current.filter((asset) => asset.AssetType !== type)]);
      });
    },
    remove(userId: string, ids: readonly string[]) {
      return enqueue(userId, async () => {
        const removed = new Set(ids);
        const current = (await getRecord(userId))?.assets ?? [];
        await persist(userId, current.filter((asset) => !removed.has(asset.Id)));
      });
    },
    clear(userId: string) {
      return enqueue(userId, async () => {
        memory.delete(userId);
        try { await store.delete(userId); } catch { /* Best-effort privacy cleanup. */ }
      });
    },
  };
};

export const assetMetadataCache = createAssetMetadataCache(indexedDbStore());

export async function loadAssetsCacheFirst(options: {
  userId: string;
  loadFresh: () => Promise<LibraryAsset[]>;
  selectCached?: (assets: LibraryAsset[]) => LibraryAsset[];
  onCached?: (assets: LibraryAsset[]) => void;
  cache?: ReturnType<typeof createAssetMetadataCache>;
}) {
  const cache = options.cache ?? assetMetadataCache;
  const freshRequest = options.loadFresh().then((assets) => ({ ok: true as const, assets }), (error: unknown) => ({ ok: false as const, error }));
  const cached = (options.selectCached ?? ((assets) => assets))(await cache.read(options.userId));
  if (cached.length) options.onCached?.(cached);
  const fresh = await freshRequest;
  if (!fresh.ok) {
    if (cached.length) return { assets: cached, source: "cache" as const, error: fresh.error };
    throw fresh.error;
  }
  await cache.merge(options.userId, fresh.assets);
  return { assets: fresh.assets, source: "network" as const };
}

export const filterCachedAssets = (assets: readonly LibraryAsset[], options: { type?: LibraryAsset["AssetType"]; query?: string; category?: string } = {}) => {
  const needle = options.query?.trim().toLocaleLowerCase() ?? "";
  return assets.filter((asset) => (!options.type || asset.AssetType === options.type)
    && (!options.category || options.category === "all" || asset.Category === options.category)
    && (!needle || asset.Name.toLocaleLowerCase().includes(needle)));
};
