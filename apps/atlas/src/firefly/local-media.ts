import { LocalMediaCache, type LocalMediaDescriptor, type LocalMediaEvent } from '../../../../packages/local-media/src';

let cache: LocalMediaCache | null = null;
let userId = '';
let configPromise: Promise<boolean> | null = null;

const report = (event: LocalMediaEvent) => {
  void fetch('/api/local-media-events', {
    method: 'POST', credentials: 'same-origin', keepalive: true,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
  }).catch(() => undefined);
};

export function activateAtlasLocalMedia(nextUserId: string) {
  if (cache && userId === nextUserId) return cache;
  const previous = cache;
  const previousUserId = userId;
  if (previous) {
    if (previousUserId && previousUserId !== nextUserId) void previous.destroyAndRemoveUserData();
    else previous.close();
  }
  userId = nextUserId;
  cache = new LocalMediaCache(nextUserId, { report });
  configPromise = fetch('/api/local-media/config', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (response) => response.ok ? await response.json() as { enabled?: boolean; atlas?: boolean } : {})
    .then((flags) => flags.enabled === true && flags.atlas === true)
    .catch(() => false);
  return cache;
}

export function closeAtlasLocalMedia() {
  cache?.close(); cache = null; userId = ''; configPromise = null;
}

export async function materializeAtlasLocalMedia(descriptor: LocalMediaDescriptor) {
  if (!cache) throw new Error('Atlas local media cache is not active');
  if (!await configPromise) throw new Error('Atlas local media cache is disabled');
  return cache.materialize({ ...descriptor, cachePolicy: 'pin' });
}

export type { LocalMediaDescriptor };
