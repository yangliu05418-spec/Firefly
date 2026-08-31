const SAFE_SEGMENT = /^[a-zA-Z0-9_-]{1,160}$/;

export function safeLocalMediaSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

export async function localMediaUserDirectory(userId: string, create = false) {
  const root = await navigator.storage.getDirectory();
  const firefly = await root.getDirectoryHandle('firefly-local-media', { create });
  const version = await firefly.getDirectoryHandle('v1', { create });
  const users = await version.getDirectoryHandle('users', { create });
  return users.getDirectoryHandle(safeLocalMediaSegment(userId, 'userId'), { create });
}

export async function localMediaContentHandle(userId: string, cacheKey: string, create = false) {
  const user = await localMediaUserDirectory(userId, create);
  const partial = await user.getDirectoryHandle('partial', { create });
  return partial.getFileHandle(`${safeLocalMediaSegment(cacheKey, 'cacheKey')}.part`, { create });
}

export async function removeLocalMediaContent(userId: string, cacheKey: string) {
  try {
    const user = await localMediaUserDirectory(userId);
    const partial = await user.getDirectoryHandle('partial');
    await partial.removeEntry(`${safeLocalMediaSegment(cacheKey, 'cacheKey')}.part`);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}

export async function removeLocalMediaUserDirectory(userId: string) {
  try {
    const root = await navigator.storage.getDirectory();
    const firefly = await root.getDirectoryHandle('firefly-local-media');
    const version = await firefly.getDirectoryHandle('v1');
    const users = await version.getDirectoryHandle('users');
    await users.removeEntry(safeLocalMediaSegment(userId, 'userId'), { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}
