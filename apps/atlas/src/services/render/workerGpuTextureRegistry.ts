export type WorkerGpuTextureId = string;
export type WorkerGpuTextureRetainToken = string;
export type WorkerGpuTextureLifecycle = 'placeholder' | 'registered' | 'imported';
export type WorkerGpuTextureFormatName = GPUTextureFormat | string;

export interface WorkerGpuTextureLike {
  readonly label?: string;
  destroy?: () => void;
}

export interface WorkerGpuTextureSize {
  readonly width: number;
  readonly height: number;
  readonly depthOrArrayLayers?: number;
}

export interface WorkerGpuTextureEstimateInput extends Partial<WorkerGpuTextureSize> {
  readonly format?: WorkerGpuTextureFormatName | null;
  readonly bytes?: number | null;
  readonly bytesPerPixel?: number | null;
  readonly mipLevelCount?: number | null;
  readonly sampleCount?: number | null;
}

export interface WorkerGpuTextureDescriptor extends WorkerGpuTextureEstimateInput {
  readonly id?: WorkerGpuTextureId;
  readonly owner: string;
  readonly ownerId?: string | null;
  readonly sourceKind?: string | null;
  readonly sourceKey: string;
  readonly frameKey?: string | number | null;
  readonly cacheKey?: string | null;
  readonly label?: string | null;
  readonly cacheable?: boolean;
  readonly createdAt?: number;
  readonly lastUsedAt?: number;
  readonly retainOwnerId?: string | null;
}

export interface WorkerGpuTextureRegistration<TTexture extends WorkerGpuTextureLike>
  extends WorkerGpuTextureDescriptor {
  readonly texture: TTexture;
}

export interface WorkerGpuTextureAttachParams extends WorkerGpuTextureEstimateInput {
  readonly lifecycle?: Exclude<WorkerGpuTextureLifecycle, 'placeholder'>;
  readonly sourceKind?: string | null;
  readonly frameKey?: string | number | null;
  readonly cacheKey?: string | null;
  readonly label?: string | null;
  readonly cacheable?: boolean;
  readonly lastUsedAt?: number;
  readonly retainOwnerId?: string | null;
}

export interface WorkerGpuTextureRetainInfo {
  readonly token: WorkerGpuTextureRetainToken;
  readonly ownerId: string;
  readonly retainedAt: number;
}

export interface WorkerGpuTextureEntrySnapshot {
  readonly id: WorkerGpuTextureId;
  readonly lifecycle: WorkerGpuTextureLifecycle;
  readonly owner: string;
  readonly ownerId: string;
  readonly sourceKind: string;
  readonly sourceKey: string;
  readonly frameKey: string | number | null;
  readonly cacheKey: string | null;
  readonly label: string | null;
  readonly width: number;
  readonly height: number;
  readonly depthOrArrayLayers: number;
  readonly format: string;
  readonly mipLevelCount: number;
  readonly sampleCount: number;
  readonly bytes: number;
  readonly vramBytes: number;
  readonly cacheable: boolean;
  readonly refCount: number;
  readonly retainers: readonly WorkerGpuTextureRetainInfo[];
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly hasTexture: boolean;
}

export interface WorkerGpuTextureCounters {
  readonly allocations: number;
  readonly placeholders: number;
  readonly registrations: number;
  readonly imports: number;
  readonly reuses: number;
  readonly retains: number;
  readonly releases: number;
  readonly evictions: number;
  readonly destructions: number;
  readonly destroyErrors: number;
  readonly failedRetains: number;
  readonly failedReleases: number;
  readonly leakChecks: number;
  readonly leaks: number;
}

export interface WorkerGpuTextureRegistrySnapshot {
  readonly entries: number;
  readonly textures: number;
  readonly bytes: number;
  readonly vramBytes: number;
  readonly peakVramBytes: number;
  readonly bytesByOwner: Readonly<Record<string, number>>;
  readonly entriesByOwner: Readonly<Record<string, number>>;
  readonly counters: WorkerGpuTextureCounters;
  readonly items: readonly WorkerGpuTextureEntrySnapshot[];
}

export interface WorkerGpuTextureLease {
  readonly id: WorkerGpuTextureId;
  readonly token: WorkerGpuTextureRetainToken;
  readonly refCount: number;
  readonly entry: WorkerGpuTextureEntrySnapshot;
}

export interface WorkerGpuTextureReuseQuery {
  readonly cacheKey: string;
  readonly retainOwnerId?: string | null;
  readonly now?: number;
}

export interface WorkerGpuTextureReleaseOptions {
  readonly reason?: string;
  readonly evictIfUnused?: boolean;
  readonly now?: number;
}

export interface WorkerGpuTextureEvictQuery {
  readonly owner?: string;
  readonly ownerId?: string;
  readonly sourceKey?: string;
  readonly cacheKey?: string;
  readonly force?: boolean;
}

export interface WorkerGpuTextureLeakCheckOptions {
  readonly activeOwnerIds?: ReadonlySet<string>;
  readonly activeSourceKeys?: ReadonlySet<string>;
  readonly includeUnreferenced?: boolean;
}

interface WorkerGpuTextureEntry<TTexture extends WorkerGpuTextureLike> {
  id: WorkerGpuTextureId;
  lifecycle: WorkerGpuTextureLifecycle;
  texture: TTexture | null;
  owner: string;
  ownerId: string;
  sourceKind: string;
  sourceKey: string;
  frameKey: string | number | null;
  cacheKey: string | null;
  label: string | null;
  width: number;
  height: number;
  depthOrArrayLayers: number;
  format: string;
  mipLevelCount: number;
  sampleCount: number;
  bytes: number;
  cacheable: boolean;
  retainers: Map<WorkerGpuTextureRetainToken, WorkerGpuTextureRetainInfo>;
  createdAt: number;
  lastUsedAt: number;
}

type MutableCounters = {
  -readonly [Key in keyof WorkerGpuTextureCounters]: WorkerGpuTextureCounters[Key];
};

const DEFAULT_FORMAT = 'rgba8unorm';

function createCounters(): MutableCounters {
  return {
    allocations: 0,
    placeholders: 0,
    registrations: 0,
    imports: 0,
    reuses: 0,
    retains: 0,
    releases: 0,
    evictions: 0,
    destructions: 0,
    destroyErrors: 0,
    failedRetains: 0,
    failedReleases: 0,
    leakChecks: 0,
    leaks: 0,
  };
}

function normalizeFiniteInteger(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
  const normalized = normalizeFiniteInteger(value, fallback);
  return normalized > 0 ? normalized : fallback;
}

function normalizeTimestamp(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeFormat(format: WorkerGpuTextureFormatName | null | undefined): string {
  return typeof format === 'string' && format.length > 0 ? format : DEFAULT_FORMAT;
}

function bytesPerPixelForFormat(format: string): number {
  if (
    format.includes('rgba32')
    || format.includes('rg32')
    || format === 'depth32float-stencil8'
  ) {
    return 16;
  }
  if (format.includes('rgba16') || format === 'rg32float' || format === 'depth24plus-stencil8') {
    return 8;
  }
  if (
    format.includes('rgba8')
    || format.includes('bgra8')
    || format.includes('rgb10a2')
    || format === 'r32float'
    || format === 'depth24plus'
    || format === 'depth32float'
  ) {
    return 4;
  }
  if (format.includes('rg8') || format === 'r16float' || format === 'r16uint' || format === 'r16sint') {
    return 2;
  }
  return 4;
}

function mipMultiplier(width: number, height: number, depth: number, mipLevelCount: number): number {
  if (mipLevelCount <= 1) return 1;
  let multiplier = 0;
  let levelWidth = width;
  let levelHeight = height;
  let levelDepth = depth;
  for (let level = 0; level < mipLevelCount; level += 1) {
    multiplier += (levelWidth * levelHeight * levelDepth) / (width * height * depth);
    levelWidth = Math.max(1, Math.floor(levelWidth / 2));
    levelHeight = Math.max(1, Math.floor(levelHeight / 2));
    levelDepth = Math.max(1, Math.floor(levelDepth / 2));
  }
  return multiplier;
}

export function estimateWorkerGpuTextureBytes(input: WorkerGpuTextureEstimateInput): number {
  if (Number.isFinite(input.bytes) && Number(input.bytes) >= 0) {
    return Math.floor(Number(input.bytes));
  }
  const width = normalizeFiniteInteger(input.width, 0);
  const height = normalizeFiniteInteger(input.height, 0);
  if (width <= 0 || height <= 0) return 0;

  const depth = normalizePositiveInteger(input.depthOrArrayLayers, 1);
  const sampleCount = normalizePositiveInteger(input.sampleCount, 1);
  const mipLevelCount = normalizePositiveInteger(input.mipLevelCount, 1);
  const format = normalizeFormat(input.format);
  const bytesPerPixel = normalizePositiveInteger(input.bytesPerPixel, bytesPerPixelForFormat(format));
  const pixels = width * height * depth;
  const mipFactor = mipMultiplier(width, height, depth, mipLevelCount);
  return Math.ceil(pixels * bytesPerPixel * sampleCount * mipFactor);
}

export class WorkerGpuTextureRegistry<TTexture extends WorkerGpuTextureLike = WorkerGpuTextureLike> {
  private readonly entries = new Map<WorkerGpuTextureId, WorkerGpuTextureEntry<TTexture>>();
  private readonly tokens = new Map<WorkerGpuTextureRetainToken, WorkerGpuTextureId>();
  private readonly cacheKeys = new Map<string, WorkerGpuTextureId>();
  private readonly counters = createCounters();
  private readonly now: () => number;
  private nextId = 1;
  private nextToken = 1;
  private peakVramBytes = 0;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  allocatePlaceholder(descriptor: WorkerGpuTextureDescriptor): WorkerGpuTextureLease {
    const entry = this.createEntry('placeholder', null, descriptor);
    this.counters.placeholders += 1;
    this.updatePeakVram();
    return this.retainEntry(entry, descriptor.retainOwnerId ?? entry.ownerId, descriptor.lastUsedAt);
  }

  registerTexture(descriptor: WorkerGpuTextureRegistration<TTexture>): WorkerGpuTextureLease {
    const entry = this.createEntry('registered', descriptor.texture, descriptor);
    this.counters.registrations += 1;
    this.updatePeakVram();
    return this.retainEntry(entry, descriptor.retainOwnerId ?? entry.ownerId, descriptor.lastUsedAt);
  }

  importTexture(descriptor: WorkerGpuTextureRegistration<TTexture>): WorkerGpuTextureLease {
    const entry = this.createEntry('imported', descriptor.texture, descriptor);
    this.counters.imports += 1;
    this.updatePeakVram();
    return this.retainEntry(entry, descriptor.retainOwnerId ?? entry.ownerId, descriptor.lastUsedAt);
  }

  attachTexture(
    id: WorkerGpuTextureId,
    texture: TTexture,
    params: WorkerGpuTextureAttachParams = {},
  ): WorkerGpuTextureEntrySnapshot | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.texture) {
      throw new Error(`Worker GPU texture '${id}' already has a texture handle.`);
    }

    const lifecycle = params.lifecycle ?? 'registered';
    entry.texture = texture;
    entry.lifecycle = lifecycle;
    this.applyMetadata(entry, params);
    if (lifecycle === 'imported') {
      this.counters.imports += 1;
    } else {
      this.counters.registrations += 1;
    }
    this.updatePeakVram();
    return this.snapshotEntry(entry);
  }

  retain(
    id: WorkerGpuTextureId,
    retainOwnerId = 'anonymous',
    now = this.now(),
  ): WorkerGpuTextureLease | null {
    const entry = this.entries.get(id);
    if (!entry) {
      this.counters.failedRetains += 1;
      return null;
    }
    return this.retainEntry(entry, retainOwnerId, now);
  }

  reuseByKey(query: WorkerGpuTextureReuseQuery): WorkerGpuTextureLease | null {
    const id = this.cacheKeys.get(query.cacheKey);
    if (!id) {
      this.counters.failedRetains += 1;
      return null;
    }
    const entry = this.entries.get(id);
    if (!entry) {
      this.cacheKeys.delete(query.cacheKey);
      this.counters.failedRetains += 1;
      return null;
    }
    this.counters.reuses += 1;
    return this.retainEntry(entry, query.retainOwnerId ?? entry.ownerId, query.now);
  }

  release(ref: WorkerGpuTextureRetainToken | WorkerGpuTextureId, options: WorkerGpuTextureReleaseOptions = {}): boolean {
    const tokenEntryId = this.tokens.get(ref);
    const released = tokenEntryId
      ? this.releaseToken(ref, tokenEntryId, options.now)
      : this.releaseById(ref, options) > 0;
    if (!released) {
      this.counters.failedReleases += 1;
      return false;
    }
    return true;
  }

  releaseById(id: WorkerGpuTextureId, options: WorkerGpuTextureReleaseOptions = {}): number {
    const entry = this.entries.get(id);
    if (!entry) return 0;
    let released = 0;
    for (const token of Array.from(entry.retainers.keys())) {
      if (this.releaseToken(token, id, options.now)) released += 1;
    }
    if (options.evictIfUnused || !entry.cacheable) this.evict(id, { force: false });
    return released;
  }

  evict(id: WorkerGpuTextureId, query: Pick<WorkerGpuTextureEvictQuery, 'force'> = {}): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.retainers.size > 0 && !query.force) return false;
    if (query.force) this.dropRetainers(entry);
    this.destroyEntry(entry, 'evict');
    this.counters.evictions += 1;
    return true;
  }

  evictUnused(query: WorkerGpuTextureEvictQuery = {}): number {
    let evicted = 0;
    for (const entry of Array.from(this.entries.values())) {
      if (entry.retainers.size > 0 && !query.force) continue;
      if (!matchesEvictQuery(entry, query)) continue;
      if (this.evict(entry.id, { force: query.force })) evicted += 1;
    }
    return evicted;
  }

  getTexture(id: WorkerGpuTextureId): TTexture | null {
    return this.entries.get(id)?.texture ?? null;
  }

  getEntry(id: WorkerGpuTextureId): WorkerGpuTextureEntrySnapshot | null {
    const entry = this.entries.get(id);
    return entry ? this.snapshotEntry(entry) : null;
  }

  checkForLeaks(options: WorkerGpuTextureLeakCheckOptions = {}): WorkerGpuTextureEntrySnapshot[] {
    this.counters.leakChecks += 1;
    const leaks: WorkerGpuTextureEntrySnapshot[] = [];
    for (const entry of this.entries.values()) {
      const sourceIsInactive = options.activeSourceKeys
        ? !options.activeSourceKeys.has(entry.sourceKey)
        : false;
      const ownerIsInactive = options.activeOwnerIds
        ? !options.activeOwnerIds.has(entry.ownerId)
        : false;
      const hasOutstandingRefs = entry.retainers.size > 0;
      const isLeak = (hasOutstandingRefs || options.includeUnreferenced === true)
        && (sourceIsInactive || ownerIsInactive || (!options.activeSourceKeys && !options.activeOwnerIds));
      if (isLeak) leaks.push(this.snapshotEntry(entry));
    }
    this.counters.leaks += leaks.length;
    return leaks;
  }

  clear(reason = 'clear'): void {
    for (const entry of Array.from(this.entries.values())) {
      this.dropRetainers(entry);
      this.destroyEntry(entry, reason);
    }
  }

  snapshot(): WorkerGpuTextureRegistrySnapshot {
    const bytesByOwner: Record<string, number> = {};
    const entriesByOwner: Record<string, number> = {};
    let bytes = 0;
    let textureCount = 0;
    const items = Array.from(this.entries.values(), (entry) => {
      bytes += entry.bytes;
      if (entry.texture) textureCount += 1;
      bytesByOwner[entry.owner] = (bytesByOwner[entry.owner] ?? 0) + entry.bytes;
      entriesByOwner[entry.owner] = (entriesByOwner[entry.owner] ?? 0) + 1;
      return this.snapshotEntry(entry);
    });

    return {
      entries: items.length,
      textures: textureCount,
      bytes,
      vramBytes: bytes,
      peakVramBytes: this.peakVramBytes,
      bytesByOwner,
      entriesByOwner,
      counters: { ...this.counters },
      items,
    };
  }

  private createEntry(
    lifecycle: WorkerGpuTextureLifecycle,
    texture: TTexture | null,
    descriptor: WorkerGpuTextureDescriptor,
  ): WorkerGpuTextureEntry<TTexture> {
    const id = descriptor.id ?? this.createTextureId();
    if (this.entries.has(id)) {
      throw new Error(`Worker GPU texture '${id}' is already registered.`);
    }
    const createdAt = normalizeTimestamp(descriptor.createdAt, this.now());
    const entry: WorkerGpuTextureEntry<TTexture> = {
      id,
      lifecycle,
      texture,
      owner: descriptor.owner,
      ownerId: descriptor.ownerId ?? descriptor.owner,
      sourceKind: descriptor.sourceKind ?? 'unknown',
      sourceKey: descriptor.sourceKey,
      frameKey: descriptor.frameKey ?? null,
      cacheKey: descriptor.cacheKey ?? null,
      label: descriptor.label ?? texture?.label ?? null,
      width: normalizeFiniteInteger(descriptor.width, 0),
      height: normalizeFiniteInteger(descriptor.height, 0),
      depthOrArrayLayers: normalizePositiveInteger(descriptor.depthOrArrayLayers, 1),
      format: normalizeFormat(descriptor.format),
      mipLevelCount: normalizePositiveInteger(descriptor.mipLevelCount, 1),
      sampleCount: normalizePositiveInteger(descriptor.sampleCount, 1),
      bytes: estimateWorkerGpuTextureBytes(descriptor),
      cacheable: descriptor.cacheable ?? true,
      retainers: new Map(),
      createdAt,
      lastUsedAt: normalizeTimestamp(descriptor.lastUsedAt, createdAt),
    };
    this.entries.set(id, entry);
    this.rememberCacheKey(entry);
    this.counters.allocations += 1;
    return entry;
  }

  private applyMetadata(entry: WorkerGpuTextureEntry<TTexture>, params: WorkerGpuTextureAttachParams): void {
    this.forgetCacheKey(entry);
    entry.sourceKind = params.sourceKind ?? entry.sourceKind;
    entry.frameKey = params.frameKey ?? entry.frameKey;
    entry.cacheKey = params.cacheKey ?? entry.cacheKey;
    entry.label = params.label ?? entry.texture?.label ?? entry.label;
    entry.width = normalizeFiniteInteger(params.width, entry.width);
    entry.height = normalizeFiniteInteger(params.height, entry.height);
    entry.depthOrArrayLayers = normalizePositiveInteger(params.depthOrArrayLayers, entry.depthOrArrayLayers);
    entry.format = normalizeFormat(params.format ?? entry.format);
    entry.mipLevelCount = normalizePositiveInteger(params.mipLevelCount, entry.mipLevelCount);
    entry.sampleCount = normalizePositiveInteger(params.sampleCount, entry.sampleCount);
    entry.bytes = estimateWorkerGpuTextureBytes({
      ...params,
      width: entry.width,
      height: entry.height,
      depthOrArrayLayers: entry.depthOrArrayLayers,
      format: entry.format,
      mipLevelCount: entry.mipLevelCount,
      sampleCount: entry.sampleCount,
    });
    entry.cacheable = params.cacheable ?? entry.cacheable;
    entry.lastUsedAt = normalizeTimestamp(params.lastUsedAt, this.now());
    this.rememberCacheKey(entry);
  }

  private retainEntry(
    entry: WorkerGpuTextureEntry<TTexture>,
    retainOwnerId: string,
    now: number | null | undefined,
  ): WorkerGpuTextureLease {
    const retainedAt = normalizeTimestamp(now, this.now());
    const token = this.createRetainToken(entry.id);
    const retainInfo: WorkerGpuTextureRetainInfo = {
      token,
      ownerId: retainOwnerId,
      retainedAt,
    };
    entry.retainers.set(token, retainInfo);
    this.tokens.set(token, entry.id);
    entry.lastUsedAt = retainedAt;
    this.counters.retains += 1;
    return {
      id: entry.id,
      token,
      refCount: entry.retainers.size,
      entry: this.snapshotEntry(entry),
    };
  }

  private releaseToken(
    token: WorkerGpuTextureRetainToken,
    entryId: WorkerGpuTextureId,
    now: number | null | undefined,
  ): boolean {
    const entry = this.entries.get(entryId);
    if (!entry || !entry.retainers.delete(token)) return false;
    this.tokens.delete(token);
    entry.lastUsedAt = normalizeTimestamp(now, this.now());
    this.counters.releases += 1;
    if (!entry.cacheable && entry.retainers.size === 0) this.destroyEntry(entry, 'release');
    return true;
  }

  private dropRetainers(entry: WorkerGpuTextureEntry<TTexture>): void {
    for (const token of entry.retainers.keys()) this.tokens.delete(token);
    entry.retainers.clear();
  }

  private destroyEntry(entry: WorkerGpuTextureEntry<TTexture>, _reason: string): void {
    this.forgetCacheKey(entry);
    if (entry.texture) {
      try {
        entry.texture.destroy?.();
        this.counters.destructions += 1;
      } catch {
        this.counters.destroyErrors += 1;
      }
    }
    this.entries.delete(entry.id);
  }

  private snapshotEntry(entry: WorkerGpuTextureEntry<TTexture>): WorkerGpuTextureEntrySnapshot {
    return {
      id: entry.id,
      lifecycle: entry.lifecycle,
      owner: entry.owner,
      ownerId: entry.ownerId,
      sourceKind: entry.sourceKind,
      sourceKey: entry.sourceKey,
      frameKey: entry.frameKey,
      cacheKey: entry.cacheKey,
      label: entry.label,
      width: entry.width,
      height: entry.height,
      depthOrArrayLayers: entry.depthOrArrayLayers,
      format: entry.format,
      mipLevelCount: entry.mipLevelCount,
      sampleCount: entry.sampleCount,
      bytes: entry.bytes,
      vramBytes: entry.bytes,
      cacheable: entry.cacheable,
      refCount: entry.retainers.size,
      retainers: Array.from(entry.retainers.values()),
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt,
      hasTexture: entry.texture !== null,
    };
  }

  private rememberCacheKey(entry: WorkerGpuTextureEntry<TTexture>): void {
    if (entry.cacheKey) this.cacheKeys.set(entry.cacheKey, entry.id);
  }

  private forgetCacheKey(entry: WorkerGpuTextureEntry<TTexture>): void {
    if (entry.cacheKey && this.cacheKeys.get(entry.cacheKey) === entry.id) {
      this.cacheKeys.delete(entry.cacheKey);
    }
  }

  private createTextureId(): WorkerGpuTextureId {
    const id = `worker-gpu-texture:${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  private createRetainToken(id: WorkerGpuTextureId): WorkerGpuTextureRetainToken {
    const token = `${id}:retain:${this.nextToken}`;
    this.nextToken += 1;
    return token;
  }

  private updatePeakVram(): void {
    const current = this.snapshot().vramBytes;
    this.peakVramBytes = Math.max(this.peakVramBytes, current);
  }
}

function matchesEvictQuery<TTexture extends WorkerGpuTextureLike>(
  entry: WorkerGpuTextureEntry<TTexture>,
  query: WorkerGpuTextureEvictQuery,
): boolean {
  if (query.owner && entry.owner !== query.owner) return false;
  if (query.ownerId && entry.ownerId !== query.ownerId) return false;
  if (query.sourceKey && entry.sourceKey !== query.sourceKey) return false;
  if (query.cacheKey && entry.cacheKey !== query.cacheKey) return false;
  return true;
}
