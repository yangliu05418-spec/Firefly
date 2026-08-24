import type { ImageModel } from "./types";

const CACHE_KEY = "firefly-image-model-catalog-v1";
const CACHE_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ImageModelCatalog = {
  Items: ImageModel[];
  Ratios: string[];
  DefaultModel: string;
};

type CatalogRecord = {
  version: number;
  updatedAt: number;
  catalog: ImageModelCatalog;
};

export type ImageModelCatalogStore = {
  read(): Promise<unknown>;
  write(record: CatalogRecord): Promise<void>;
};

const nonEmptyStrings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
const validModel = (value: unknown): value is ImageModel => {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<ImageModel>;
  return typeof model.id === "string" && model.id.length > 0
    && typeof model.name === "string" && model.name.length > 0
    && nonEmptyStrings(model.resolutions)
    && typeof model.defaultResolution === "string" && model.resolutions.includes(model.defaultResolution)
    && Number.isInteger(model.maxCount) && Number(model.maxCount) > 0
    && Number.isInteger(model.maxReferences) && Number(model.maxReferences) >= 0;
};

export const normalizeImageModelCatalog = (value: unknown): ImageModelCatalog | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const catalog = value as Partial<ImageModelCatalog>;
  if (!Array.isArray(catalog.Items) || !catalog.Items.length || !catalog.Items.every(validModel) || !nonEmptyStrings(catalog.Ratios) || typeof catalog.DefaultModel !== "string") return undefined;
  if (!catalog.Items.some((model) => model.id === catalog.DefaultModel)) return undefined;
  return { Items: catalog.Items.map((model) => ({ ...model, resolutions: [...model.resolutions] })), Ratios: [...catalog.Ratios], DefaultModel: catalog.DefaultModel };
};

const browserStore: ImageModelCatalogStore = {
  async read() {
    if (typeof localStorage === "undefined") return undefined;
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"); }
    catch { return undefined; }
  },
  async write(record) {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(record)); }
    catch { /* A blocked or full cache must never affect model selection. */ }
  },
};

export const createImageModelCatalogCache = (store: ImageModelCatalogStore, now = () => Date.now()) => ({
  async read() {
    const value = await store.read().catch(() => undefined) as Partial<CatalogRecord> | undefined;
    if (!value || value.version !== CACHE_VERSION || typeof value.updatedAt !== "number" || now() - value.updatedAt > MAX_AGE_MS) return undefined;
    return normalizeImageModelCatalog(value.catalog);
  },
  async write(catalog: ImageModelCatalog) {
    const normalized = normalizeImageModelCatalog(catalog);
    if (!normalized) return;
    await store.write({ version: CACHE_VERSION, updatedAt: now(), catalog: normalized }).catch(() => undefined);
  },
});

export const imageModelCatalogCache = createImageModelCatalogCache(browserStore);

export async function loadImageModelCatalogCacheFirst(options: {
  loadFresh: () => Promise<ImageModelCatalog>;
  onCached?: (catalog: ImageModelCatalog) => void;
  cache?: ReturnType<typeof createImageModelCatalogCache>;
}) {
  const cache = options.cache ?? imageModelCatalogCache;
  const freshRequest = options.loadFresh().then((value) => ({ ok: true as const, value: normalizeImageModelCatalog(value) }), (error: unknown) => ({ ok: false as const, error }));
  const cached = await cache.read();
  if (cached) options.onCached?.(cached);
  const fresh = await freshRequest;
  if (!fresh.ok || !fresh.value) {
    const error = fresh.ok ? new Error("图片模型目录格式无效") : fresh.error;
    if (cached) return { catalog: cached, source: "cache" as const, error };
    throw error;
  }
  await cache.write(fresh.value);
  return { catalog: fresh.value, source: "network" as const };
}

/** Share one successful catalog request across Studio and Canvas for this tab. */
export const createSharedImageModelCatalogLoader = (loadFresh: () => Promise<ImageModelCatalog>) => {
  let catalog: ImageModelCatalog | undefined;
  let pending: Promise<ImageModelCatalog> | undefined;
  return {
    peek: () => catalog,
    load: () => {
      if (catalog) return Promise.resolve(catalog);
      if (!pending) pending = loadFresh().then((value) => {
        const normalized = normalizeImageModelCatalog(value);
        if (!normalized) throw new Error("图片模型目录格式无效");
        catalog = normalized;
        return normalized;
      }).finally(() => { pending = undefined; });
      return pending;
    },
  };
};
