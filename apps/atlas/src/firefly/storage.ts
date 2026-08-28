import {
  stripRuntimeUrls,
  type AtlasAgentLedger,
  type AtlasDocument,
  type AtlasProjectSummary,
} from './model';

const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';
const BLOBS_STORE = 'asset-blobs';
const AGENT_INTENTS_STORE = 'agent-intents';
const AGENT_LEDGER_STORE = 'agent-operation-ledger';

interface LocalProjectRecord {
  projectId: string;
  title: string;
  revision: number;
  updatedAt: string;
  document: AtlasDocument;
}

interface LocalBlobRecord {
  assetId: string;
  blob: Blob;
  size?: number;
  updatedAt: string;
}

interface AgentIntentRecord {
  projectId: string;
  instruction: string;
  semanticFingerprint: string;
  idempotencyKey: string;
  createdAt: string;
}

export const atlasDatabaseName = (userId: string): string => `firefly-atlas-${userId}`;

function openDatabase(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(atlasDatabaseName(userId), DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        database.createObjectStore(PROJECTS_STORE, { keyPath: 'projectId' });
      }
      if (!database.objectStoreNames.contains(BLOBS_STORE)) {
        database.createObjectStore(BLOBS_STORE, { keyPath: 'assetId' });
      }
      if (!database.objectStoreNames.contains(AGENT_INTENTS_STORE)) {
        database.createObjectStore(AGENT_INTENTS_STORE, { keyPath: 'projectId' });
      }
      if (!database.objectStoreNames.contains(AGENT_LEDGER_STORE)) {
        const store = database.createObjectStore(AGENT_LEDGER_STORE, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open Atlas storage.'));
    request.onblocked = () => reject(new Error('Atlas storage upgrade is blocked by another tab.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Atlas storage request failed.'));
  });
}

async function withStore<T>(
  userId: string,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase(userId);
  try {
    const transaction = database.transaction(storeName, mode);
    const result = await run(transaction.objectStore(storeName));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Atlas storage transaction failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Atlas storage transaction was aborted.'));
    });
    return result;
  } finally {
    database.close();
  }
}

export async function saveLocalProject(userId: string, document: AtlasDocument): Promise<void> {
  const record = localProjectRecord(document);
  await withStore(userId, PROJECTS_STORE, 'readwrite', async (store) => {
    await requestResult(store.put(record));
  });
}

function localProjectRecord(document: AtlasDocument): LocalProjectRecord {
  return {
    projectId: document.projectId,
    title: document.title,
    revision: document.revision,
    updatedAt: document.updatedAt,
    document: stripRuntimeUrls(document),
  };
}

/**
 * Reuses the same key while an identical user intent is retried after a lost
 * network response. A changed instruction or semantic snapshot creates a new
 * intent, so a genuinely new command can never alias an earlier Agent run.
 */
export async function getOrCreateAgentIntent(
  userId: string,
  projectId: string,
  instruction: string,
  semanticFingerprint: string,
): Promise<AgentIntentRecord> {
  return withStore(userId, AGENT_INTENTS_STORE, 'readwrite', async (store) => {
    const existing = await requestResult<AgentIntentRecord | undefined>(store.get(projectId));
    if (existing && existing.instruction === instruction && existing.semanticFingerprint === semanticFingerprint) return existing;
    const intent: AgentIntentRecord = {
      projectId,
      instruction,
      semanticFingerprint,
      idempotencyKey: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await requestResult(store.put(intent));
    return intent;
  });
}

export async function clearAgentIntent(userId: string, projectId: string, expectedIdempotencyKey?: string): Promise<void> {
  await withStore(userId, AGENT_INTENTS_STORE, 'readwrite', async (store) => {
    if (expectedIdempotencyKey) {
      const existing = await requestResult<AgentIntentRecord | undefined>(store.get(projectId));
      if (!existing || existing.idempotencyKey !== expectedIdempotencyKey) return;
    }
    await requestResult(store.delete(projectId));
  });
}

/**
 * Atomically persists the post-plan document and the operation receipt ledger
 * before React mutates its in-memory history. After a crash, Atlas can replay
 * receipts from the ledger without executing the plan a second time.
 */
export async function commitAgentExecution(
  userId: string,
  document: AtlasDocument,
  ledger: AtlasAgentLedger,
): Promise<void> {
  const database = await openDatabase(userId);
  try {
    const transaction = database.transaction([PROJECTS_STORE, AGENT_LEDGER_STORE], 'readwrite');
    transaction.objectStore(PROJECTS_STORE).put(localProjectRecord(document));
    transaction.objectStore(AGENT_LEDGER_STORE).put(ledger);
    await transactionCompletion(transaction);
  } finally {
    database.close();
  }
}

export async function saveAgentLedger(userId: string, ledger: AtlasAgentLedger): Promise<void> {
  await withStore(userId, AGENT_LEDGER_STORE, 'readwrite', async (store) => {
    await requestResult(store.put(ledger));
  });
}

export async function listPendingAgentLedgers(userId: string, projectId: string): Promise<AtlasAgentLedger[]> {
  const records = await withStore(userId, AGENT_LEDGER_STORE, 'readonly', async (store) => {
    const index = store.index('projectId');
    return requestResult<AtlasAgentLedger[]>(index.getAll(projectId));
  });
  return records.filter((record) => record.status !== 'reported');
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Atlas storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Atlas storage transaction was aborted.'));
  });
}

export async function loadLocalProject(userId: string, projectId: string): Promise<AtlasDocument | null> {
  const record = await withStore(userId, PROJECTS_STORE, 'readonly', (store) => requestResult<LocalProjectRecord | undefined>(store.get(projectId)));
  if (!record) return null;
  const assets = await Promise.all(record.document.assets.map(async (asset) => {
    if (asset.source !== 'local') return asset;
    const blob = await loadLocalBlob(userId, asset.id);
    return blob ? { ...asset, objectUrl: URL.createObjectURL(blob) } : { ...asset, status: asset.mediaUrl ? asset.status : 'failed' as const };
  }));
  return { ...record.document, assets };
}

export async function listLocalProjects(userId: string): Promise<AtlasProjectSummary[]> {
  const records = await withStore(userId, PROJECTS_STORE, 'readonly', (store) => requestResult<LocalProjectRecord[]>(store.getAll()));
  return records.map((record) => ({
    id: record.projectId,
    title: record.title,
    revision: record.revision,
    createdAt: record.updatedAt,
    updatedAt: record.updatedAt,
    hasCheckpoint: false,
    localOnly: true,
  }));
}

export async function deleteLocalProject(userId: string, projectId: string): Promise<void> {
  const document = await loadLocalProject(userId, projectId);
  await withStore(userId, PROJECTS_STORE, 'readwrite', async (store) => {
    await requestResult(store.delete(projectId));
  });
  if (document) {
    await Promise.all(document.assets.filter((asset) => asset.source === 'local').map((asset) => deleteLocalBlob(userId, asset.id)));
    document.assets.forEach((asset) => {
      if (asset.objectUrl) URL.revokeObjectURL(asset.objectUrl);
    });
  }
}

export async function saveLocalBlob(userId: string, assetId: string, blob: Blob): Promise<void> {
  const record: LocalBlobRecord = { assetId, blob, size: blob.size, updatedAt: new Date().toISOString() };
  await withStore(userId, BLOBS_STORE, 'readwrite', async (store) => {
    await requestResult(store.put(record));
  });
}

export async function loadLocalBlob(userId: string, assetId: string): Promise<Blob | null> {
  const record = await withStore(userId, BLOBS_STORE, 'readwrite', async (store) => {
    const current = await requestResult<LocalBlobRecord | undefined>(store.get(assetId));
    if (current) await requestResult(store.put({ ...current, updatedAt: new Date().toISOString() }));
    return current;
  });
  return record?.blob ?? null;
}

export async function deleteLocalBlob(userId: string, assetId: string): Promise<void> {
  await withStore(userId, BLOBS_STORE, 'readwrite', async (store) => {
    await requestResult(store.delete(assetId));
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Reclaims only project media that already has a durable cloud URL. Pending or
 * failed local-only sources are never evicted. The database name is per user,
 * so cleanup cannot touch Firefly drafts or another employee's Atlas cache.
 */
export async function enforceAtlasStorageQuota(
  userId: string,
  triggerFraction = 0.75,
  targetFraction = 0.6,
): Promise<{ removed: number; bytes: number }> {
  if (!navigator.storage?.estimate) return { removed: 0, bytes: 0 };
  const estimate = await navigator.storage.estimate();
  const quota = estimate.quota ?? 0;
  const usage = estimate.usage ?? 0;
  if (!quota || usage / quota < triggerFraction) return { removed: 0, bytes: 0 };

  const database = await openDatabase(userId);
  try {
    const transaction = database.transaction([PROJECTS_STORE, BLOBS_STORE], 'readwrite');
    const projectStore = transaction.objectStore(PROJECTS_STORE);
    const blobStore = transaction.objectStore(BLOBS_STORE);
    const [projects, blobs] = await Promise.all([
      requestResult<LocalProjectRecord[]>(projectStore.getAll()),
      requestResult<LocalBlobRecord[]>(blobStore.getAll()),
    ]);
    const evictable = new Set<string>();
    for (const project of projects) {
      for (const asset of project.document.assets) {
        if (asset.source === 'local' && asset.status === 'ready' && asset.mediaUrl) evictable.add(asset.id);
      }
    }
    const candidates = blobs
      .filter((record) => evictable.has(record.assetId))
      .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
    const bytesNeeded = Math.max(0, usage - quota * targetFraction);
    let bytes = 0;
    let removed = 0;
    for (const record of candidates) {
      if (bytes >= bytesNeeded) break;
      blobStore.delete(record.assetId);
      bytes += record.size ?? record.blob.size ?? 0;
      removed += 1;
    }
    await transactionCompletion(transaction);
    return { removed, bytes };
  } finally {
    database.close();
  }
}

export function mergeProjectLists(cloud: AtlasProjectSummary[], local: AtlasProjectSummary[]): AtlasProjectSummary[] {
  const merged = new Map(cloud.map((project) => [project.id, project]));
  for (const project of local) {
    const existing = merged.get(project.id);
    if (!existing || new Date(project.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      merged.set(project.id, { ...existing, ...project, hasCheckpoint: existing?.hasCheckpoint ?? false, localOnly: !existing });
    }
  }
  return [...merged.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
