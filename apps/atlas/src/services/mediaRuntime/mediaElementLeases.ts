import type {
  DecodeSessionPolicy,
  MediaRuntimeLease,
  MediaRuntimeLeaseStatus,
  RuntimeSessionKey,
  RuntimeSourceId,
} from './contracts';
import {
  mediaRuntimeObjectUrlLeaseOwner,
  toObjectUrlRuntimeSourceId,
} from './objectUrlLeases';

export type MediaElementLeaseKind = 'video' | 'audio';

export interface MediaElementRuntimeHandles<T extends HTMLMediaElement = HTMLMediaElement> {
  element: T;
  url: string;
  kind: MediaElementLeaseKind;
  createdAt: number;
  objectUrlRuntimeSourceId: RuntimeSourceId;
}

export interface AcquireMediaElementLeaseParams<T extends HTMLMediaElement = HTMLMediaElement> {
  kind: MediaElementLeaseKind;
  file: File;
  runtimeSourceId?: RuntimeSourceId;
  runtimeSessionKey?: RuntimeSessionKey;
  ownerId?: string;
  policy?: DecodeSessionPolicy;
  createElement?: () => T;
  configureElement?: (element: T) => void;
}

export interface MediaElementLeaseStats {
  liveLeases: number;
  created: number;
  released: number;
}

export interface MediaElementLeaseSnapshot {
  runtimeSourceId: RuntimeSourceId;
  ownerId: string;
  runtimeSessionKey?: RuntimeSessionKey;
  policy: DecodeSessionPolicy;
  status: MediaRuntimeLeaseStatus;
  kind: MediaElementLeaseKind;
  url: string;
  createdAt: number;
  objectUrlRuntimeSourceId: RuntimeSourceId;
}

type AnyMediaElementLease = MediaRuntimeMediaElementLease;

function detachMediaElementSource(element: HTMLMediaElement): string {
  const src = element.currentSrc || element.src;
  element.removeAttribute('src');
  try {
    element.load();
  } catch {
    // Removing src is enough for teardown; some browsers reject load() during cleanup.
  }
  return src;
}

function configureTimelineVideoElement(video: HTMLVideoElement): void {
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
}

function configureTimelineAudioElement(audio: HTMLAudioElement): void {
  audio.preload = 'auto';
}

function requireLeaseElement<T extends HTMLMediaElement>(
  lease: MediaRuntimeLease<MediaElementRuntimeHandles<T>>
): T {
  const element = lease.getRuntimeHandles()?.element;
  if (!element) {
    throw new Error('Media element lease did not acquire an element');
  }
  return element;
}

export function toMediaElementRuntimeSourceId(
  kind: MediaElementLeaseKind,
  file: Pick<File, 'name' | 'size' | 'lastModified'>,
  sequence: number
): RuntimeSourceId {
  return `media-element:${kind}:${sequence}:${file.name}:${file.size}:${file.lastModified}` as RuntimeSourceId;
}

export function toMediaElementObjectUrlRuntimeSourceId(
  runtimeSourceId: RuntimeSourceId,
  kind: MediaElementLeaseKind
): RuntimeSourceId {
  return toObjectUrlRuntimeSourceId(runtimeSourceId, kind);
}

class MediaRuntimeMediaElementLease implements MediaRuntimeLease<MediaElementRuntimeHandles> {
  runtimeSourceId: RuntimeSourceId;
  runtimeSessionKey?: RuntimeSessionKey;
  ownerId: string;
  policy: DecodeSessionPolicy;
  status: MediaRuntimeLeaseStatus = 'pending';
  acquiredAt = 0;
  releasedAt?: number;

  private handles: MediaElementRuntimeHandles | null = null;
  private readonly kind: MediaElementLeaseKind;
  private readonly file: File;
  private readonly createElement: () => HTMLMediaElement;
  private readonly configureElement: (element: HTMLMediaElement) => void;
  private readonly objectUrlRuntimeSourceId: RuntimeSourceId;
  private readonly leaseOwner: MediaRuntimeMediaElementLeaseOwner;

  constructor(params: {
    kind: MediaElementLeaseKind;
    file: File;
    runtimeSourceId: RuntimeSourceId;
    runtimeSessionKey?: RuntimeSessionKey;
    ownerId: string;
    policy: DecodeSessionPolicy;
    objectUrlRuntimeSourceId: RuntimeSourceId;
    createElement: () => HTMLMediaElement;
    configureElement: (element: HTMLMediaElement) => void;
    leaseOwner: MediaRuntimeMediaElementLeaseOwner;
  }) {
    this.kind = params.kind;
    this.file = params.file;
    this.runtimeSourceId = params.runtimeSourceId;
    this.runtimeSessionKey = params.runtimeSessionKey;
    this.ownerId = params.ownerId;
    this.policy = params.policy;
    this.objectUrlRuntimeSourceId = params.objectUrlRuntimeSourceId;
    this.createElement = params.createElement;
    this.configureElement = params.configureElement;
    this.leaseOwner = params.leaseOwner;
  }

  acquire(): MediaRuntimeMediaElementLease {
    if (this.status === 'active' || this.status === 'released') {
      return this;
    }

    const objectUrlLease = mediaRuntimeObjectUrlLeaseOwner.acquire({
      runtimeSourceId: this.objectUrlRuntimeSourceId,
      ownerId: this.ownerId,
      blob: this.file,
      runtimeSessionKey: this.runtimeSessionKey,
      policy: this.policy,
    });
    const url = objectUrlLease.getRuntimeHandles()?.url ?? '';
    const element = this.createElement();
    element.src = url;
    this.configureElement(element);

    const createdAt = Date.now();
    this.handles = {
      element,
      url,
      kind: this.kind,
      createdAt,
      objectUrlRuntimeSourceId: this.objectUrlRuntimeSourceId,
    };
    this.acquiredAt = createdAt;
    this.status = 'active';
    this.leaseOwner.activateLease(this, element);
    return this;
  }

  release(reason?: string): void {
    if (this.status === 'released') {
      return;
    }

    const handles = this.handles;
    this.handles = null;
    this.status = 'released';
    this.releasedAt = Date.now();

    if (handles) {
      const src = detachMediaElementSource(handles.element);
      if (mediaRuntimeObjectUrlLeaseOwner.has(this.objectUrlRuntimeSourceId)) {
        mediaRuntimeObjectUrlLeaseOwner.release(this.objectUrlRuntimeSourceId, reason);
      } else if (src.startsWith('blob:')) {
        this.leaseOwner.releaseTrackedObjectUrl(src, this.ownerId, this.policy, reason);
      }
      this.leaseOwner.detachLease(this, handles.element);
    }
    this.leaseOwner.recordReleased();
  }

  getRuntimeHandles(): MediaElementRuntimeHandles | null {
    return this.handles;
  }
}

export class MediaRuntimeMediaElementLeaseOwner {
  private leases = new Map<RuntimeSourceId, AnyMediaElementLease>();
  private elementLeases = new WeakMap<HTMLMediaElement, AnyMediaElementLease>();
  private nextSequence = 0;
  private totalCreated = 0;
  private totalReleased = 0;

  acquire<T extends HTMLMediaElement>(
    params: AcquireMediaElementLeaseParams<T>
  ): MediaRuntimeLease<MediaElementRuntimeHandles<T>> {
    const sequence = this.nextSequence + 1;
    this.nextSequence = sequence;
    const runtimeSourceId =
      params.runtimeSourceId ?? toMediaElementRuntimeSourceId(params.kind, params.file, sequence);
    const ownerId = params.ownerId ?? `media-element:${params.kind}:${sequence}`;
    const objectUrlRuntimeSourceId = toMediaElementObjectUrlRuntimeSourceId(
      runtimeSourceId,
      params.kind
    );
    const configureElement =
      (params.configureElement as ((element: HTMLMediaElement) => void) | undefined) ??
      (() => undefined);

    this.release(runtimeSourceId);
    return new MediaRuntimeMediaElementLease({
      kind: params.kind,
      file: params.file,
      runtimeSourceId,
      runtimeSessionKey: params.runtimeSessionKey,
      ownerId,
      policy: params.policy ?? 'interactive',
      objectUrlRuntimeSourceId,
      createElement: params.createElement ?? (() => document.createElement(params.kind)),
      configureElement,
      leaseOwner: this,
    }).acquire() as MediaRuntimeLease<MediaElementRuntimeHandles<T>>;
  }

  createVideoElement(file: File): HTMLVideoElement {
    return requireLeaseElement(this.acquire<HTMLVideoElement>({
      kind: 'video',
      file,
      createElement: () => document.createElement('video'),
      configureElement: configureTimelineVideoElement,
    }));
  }

  createAudioElement(file: File): HTMLAudioElement {
    return requireLeaseElement(this.acquire<HTMLAudioElement>({
      kind: 'audio',
      file,
      createElement: () => document.createElement('audio'),
      configureElement: configureTimelineAudioElement,
    }));
  }

  release(runtimeSourceId: RuntimeSourceId, reason?: string): void {
    this.leases.get(runtimeSourceId)?.release(reason);
  }

  releaseElement(element: HTMLMediaElement, reason?: string): void {
    const lease = this.elementLeases.get(element);
    if (lease) {
      lease.release(reason);
      return;
    }

    const src = detachMediaElementSource(element);
    if (src.startsWith('blob:')) {
      this.releaseTrackedObjectUrl(src, 'media-element:untracked', 'interactive', reason);
    }
  }

  get(runtimeSourceId: RuntimeSourceId): MediaRuntimeLease<MediaElementRuntimeHandles> | null {
    return this.leases.get(runtimeSourceId) ?? null;
  }

  getByElement(element: HTMLMediaElement): MediaRuntimeLease<MediaElementRuntimeHandles> | null {
    return this.elementLeases.get(element) ?? null;
  }

  has(runtimeSourceId: RuntimeSourceId): boolean {
    return this.leases.has(runtimeSourceId);
  }

  clear(): void {
    for (const lease of Array.from(this.leases.values())) {
      lease.release('clear');
    }
  }

  getLiveLeaseCount(): number {
    return this.leases.size;
  }

  getStats(): MediaElementLeaseStats {
    return {
      liveLeases: this.getLiveLeaseCount(),
      created: this.totalCreated,
      released: this.totalReleased,
    };
  }

  listLeases(): MediaElementLeaseSnapshot[] {
    return Array.from(this.leases.values()).flatMap((lease) => {
      const handles = lease.getRuntimeHandles();
      if (!handles) {
        return [];
      }
      return [{
        runtimeSourceId: lease.runtimeSourceId,
        ownerId: lease.ownerId,
        runtimeSessionKey: lease.runtimeSessionKey,
        policy: lease.policy,
        status: lease.status,
        kind: handles.kind,
        url: handles.url,
        createdAt: handles.createdAt,
        objectUrlRuntimeSourceId: handles.objectUrlRuntimeSourceId,
      }];
    });
  }

  activateLease(lease: AnyMediaElementLease, element: HTMLMediaElement): void {
    this.leases.set(lease.runtimeSourceId, lease);
    this.elementLeases.set(element, lease);
    this.totalCreated++;
  }

  detachLease(lease: AnyMediaElementLease, element: HTMLMediaElement): void {
    if (this.leases.get(lease.runtimeSourceId) === lease) {
      this.leases.delete(lease.runtimeSourceId);
    }
    this.elementLeases.delete(element);
  }

  recordReleased(): void {
    this.totalReleased++;
  }

  releaseTrackedObjectUrl(
    url: string,
    ownerId: string,
    policy: DecodeSessionPolicy,
    reason?: string
  ): void {
    const runtimeSourceId = toObjectUrlRuntimeSourceId(
      `media-element:tracked:${this.nextSequence += 1}`,
      'media'
    );
    mediaRuntimeObjectUrlLeaseOwner.trackExisting({
      runtimeSourceId,
      ownerId,
      url,
      policy,
    });
    mediaRuntimeObjectUrlLeaseOwner.release(runtimeSourceId, reason);
  }
}

let mediaRuntimeMediaElementLeaseOwnerInstance = new MediaRuntimeMediaElementLeaseOwner();

if (import.meta.hot) {
  import.meta.hot.accept();
  const hotData = (import.meta.hot.data ?? {}) as {
    mediaRuntimeMediaElementLeaseOwner?: MediaRuntimeMediaElementLeaseOwner;
  };
  if (hotData.mediaRuntimeMediaElementLeaseOwner) {
    mediaRuntimeMediaElementLeaseOwnerInstance = hotData.mediaRuntimeMediaElementLeaseOwner;
  }
  import.meta.hot.dispose((data) => {
    data.mediaRuntimeMediaElementLeaseOwner = mediaRuntimeMediaElementLeaseOwnerInstance;
  });
}

export const mediaRuntimeMediaElementLeaseOwner = mediaRuntimeMediaElementLeaseOwnerInstance;

export function createRuntimeVideoElement(file: File): HTMLVideoElement {
  return mediaRuntimeMediaElementLeaseOwner.createVideoElement(file);
}

export function createRuntimeAudioElement(file: File): HTMLAudioElement {
  return mediaRuntimeMediaElementLeaseOwner.createAudioElement(file);
}

export function releaseRuntimeMediaElement(element: HTMLMediaElement): void {
  mediaRuntimeMediaElementLeaseOwner.releaseElement(element);
}
