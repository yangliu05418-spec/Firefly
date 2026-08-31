import type { LocalMediaDescriptor, LocalMediaManifest } from './types';

const DATABASE = 'firefly-local-media-v1';
const STORE = 'manifests';

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
});

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    const store = database.createObjectStore(STORE, { keyPath: ['userId', 'cacheKey'] });
    store.createIndex('by-user-access', ['userId', 'lastAccessedAt']);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
});

export class LocalMediaManifestStore {
  async read(userId: string, cacheKey: string) {
    const database = await openDatabase();
    try {
      return await requestResult(database.transaction(STORE).objectStore(STORE).get([userId, cacheKey])) as LocalMediaManifest | undefined;
    } finally { database.close(); }
  }

  async put(manifest: LocalMediaManifest) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(manifest);
      await transactionDone(transaction);
    } finally { database.close(); }
  }

  async markPartial(userId: string, descriptor: LocalMediaDescriptor, downloadedBytes: number) {
    const existing = await this.read(userId, descriptor.cacheKey);
    await this.put({
      ...descriptor,
      userId,
      state: 'partial',
      downloadedBytes,
      lastAccessedAt: Date.now(),
      pinned: descriptor.cachePolicy === 'pin' || existing?.pinned === true,
    });
  }

  async markReady(userId: string, descriptor: LocalMediaDescriptor, downloadedBytes: number) {
    const existing = await this.read(userId, descriptor.cacheKey);
    await this.put({
      ...descriptor,
      userId,
      state: 'ready',
      downloadedBytes,
      lastAccessedAt: Date.now(),
      pinned: descriptor.cachePolicy === 'pin' || existing?.pinned === true,
    });
  }

  async touch(userId: string, cacheKey: string) {
    const manifest = await this.read(userId, cacheKey);
    if (manifest) await this.put({ ...manifest, lastAccessedAt: Date.now() });
  }

  async list(userId: string) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE);
      const index = transaction.objectStore(STORE).index('by-user-access');
      const range = IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]);
      return await requestResult(index.getAll(range)) as LocalMediaManifest[];
    } finally { database.close(); }
  }

  async remove(userId: string, cacheKey: string) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete([userId, cacheKey]);
      await transactionDone(transaction);
    } finally { database.close(); }
  }

  async clearUser(userId: string) {
    const manifests = await this.list(userId);
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      for (const manifest of manifests) store.delete([userId, manifest.cacheKey]);
      await transactionDone(transaction);
    } finally { database.close(); }
  }
}
