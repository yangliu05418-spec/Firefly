import { Logger } from '../../logger';
import { createInitialProjectFile } from '../core/createInitialProjectFile';
import {
  PROJECT_FILE_NAME,
  readLatestFsaProjectData,
  writeFsaProjectFile,
} from '../core/projectCorePersistence';
import type { ProjectFile } from '../types/project.types';
import {
  FireflyCheckpointTransport,
  type FireflyCheckpointTransportPort,
} from './FireflyCheckpointTransport';

const log = Logger.create('FireflyProjectRepository');
const LOCAL_METADATA_FILE = '.firefly-project.json';
const LOCAL_ROOT_PATH = ['firefly-atlas', 'v1', 'users'] as const;

export interface OpenFireflyProjectOptions {
  userId: string;
  projectId: string;
  title: string;
  cloudRevision: number;
  leaseToken: string;
  projectFile?: ProjectFile;
  recoveryPreference?: 'fail-on-conflict' | 'prefer-local' | 'prefer-cloud';
}

export interface PreparedFireflyProject {
  handle: FileSystemDirectoryHandle;
  projectFile: ProjectFile;
  source: 'local' | 'provided' | 'cloud' | 'new';
}

export type FireflyCloudSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface FireflyCloudSaveState {
  status: FireflyCloudSaveStatus;
  revision: number;
  savedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface FireflyLocalMetadata {
  version: 1;
  userId: string;
  projectId: string;
  cloudRevision: number;
}

interface FireflyProjectRegistration {
  key: string;
  userId: string;
  projectId: string;
  leaseToken: string;
  cloudRevision: number;
  handle: FileSystemDirectoryHandle;
}

interface PendingCloudSave {
  registrationKey: string;
  projectFile: ProjectFile;
}

interface FireflyProjectRepositoryDependencies {
  getRootDirectory?: () => Promise<FileSystemDirectoryHandle>;
  checkpointTransport?: FireflyCheckpointTransportPort;
  now?: () => Date;
}

export class FireflyLocalCloudConflictError extends Error {
  readonly code = 'ATLAS_LOCAL_CLOUD_CONFLICT';
  readonly localRevision: number | null;
  readonly cloudRevision: number;

  constructor(localRevision: number | null, cloudRevision: number) {
    super('本地草稿与较新的云端检查点冲突，请明确选择保留本地或恢复云端版本');
    this.name = 'FireflyLocalCloudConflictError';
    this.localRevision = localRevision;
    this.cloudRevision = cloudRevision;
  }
}

function cloneProjectFile(projectFile: ProjectFile): ProjectFile {
  return structuredClone(projectFile);
}

function assertProjectFile(projectFile: ProjectFile): void {
  if (projectFile.version !== 1
    || !Array.isArray(projectFile.media)
    || !Array.isArray(projectFile.compositions)
    || !Array.isArray(projectFile.folders)) {
    throw new Error('Firefly ProjectFile is invalid');
  }
}

function projectKey(userId: string, projectId: string): string {
  return `${userId}\u0000${projectId}`;
}

export function fireflyNamespaceSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || trimmed === '.' || trimmed === '..') {
    throw new Error(`${label} is invalid`);
  }
  return encodeURIComponent(trimmed);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'ATLAS_CHECKPOINT_SAVE_FAILED';
}

async function defaultRootDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('Origin Private File System is unavailable');
  }
  return navigator.storage.getDirectory();
}

async function readJsonFile(handle: FileSystemDirectoryHandle, fileName: string): Promise<unknown | null> {
  try {
    const fileHandle = await handle.getFileHandle(fileName);
    return JSON.parse(await (await fileHandle.getFile()).text()) as unknown;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function writeJsonFile(
  handle: FileSystemDirectoryHandle,
  fileName: string,
  value: unknown,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(value));
  await writable.close();
}

export class FireflyProjectRepository {
  private readonly getRootDirectory: () => Promise<FileSystemDirectoryHandle>;
  private readonly checkpointTransport: FireflyCheckpointTransportPort;
  private readonly now: () => Date;
  private readonly registrations = new Map<string, FireflyProjectRegistration>();
  private readonly states = new Map<string, FireflyCloudSaveState>();
  private readonly pending = new Map<string, PendingCloudSave>();
  private readonly failed = new Map<string, PendingCloudSave>();
  private activeRegistrationKey: string | null = null;
  private drainPromise: Promise<void> | null = null;

  constructor(dependencies: FireflyProjectRepositoryDependencies = {}) {
    this.getRootDirectory = dependencies.getRootDirectory ?? defaultRootDirectory;
    this.checkpointTransport = dependencies.checkpointTransport ?? new FireflyCheckpointTransport();
    this.now = dependencies.now ?? (() => new Date());
  }

  async prepare(options: OpenFireflyProjectOptions): Promise<PreparedFireflyProject> {
    if (!Number.isSafeInteger(options.cloudRevision) || options.cloudRevision < 0) {
      throw new Error('Firefly cloud revision is invalid');
    }
    if (!options.leaseToken) throw new Error('Firefly edit lease is required');

    const handle = await this.getProjectDirectory(options.userId, options.projectId);
    const metadata = await this.readLocalMetadata(handle, options.userId, options.projectId);
    const localProjectFile = await this.readLocalProjectFile(handle);
    const recoveryPreference = options.recoveryPreference ?? 'fail-on-conflict';

    let projectFile: ProjectFile;
    let source: PreparedFireflyProject['source'];
    const localRevision = metadata?.cloudRevision ?? null;
    if (localProjectFile) {
      if (localRevision !== null && localRevision > options.cloudRevision) {
        throw new Error('Firefly local metadata is ahead of the authoritative cloud revision');
      }
      const cloudIsNewer = options.cloudRevision > 0
        && (localRevision === null || options.cloudRevision > localRevision);
      if (cloudIsNewer && recoveryPreference === 'fail-on-conflict') {
        throw new FireflyLocalCloudConflictError(localRevision, options.cloudRevision);
      }
      if (cloudIsNewer && recoveryPreference === 'prefer-cloud') {
        projectFile = options.projectFile
          ? cloneProjectFile(options.projectFile)
          : await this.checkpointTransport.load(options.projectId);
        assertProjectFile(projectFile);
        await writeFsaProjectFile(handle, PROJECT_FILE_NAME, projectFile);
        source = options.projectFile ? 'provided' : 'cloud';
      } else {
        projectFile = localProjectFile;
        source = 'local';
      }
    } else {
      if (options.projectFile) {
        assertProjectFile(options.projectFile);
        projectFile = cloneProjectFile(options.projectFile);
        source = 'provided';
      } else if (options.cloudRevision > 0) {
        projectFile = await this.checkpointTransport.load(options.projectId);
        assertProjectFile(projectFile);
        source = 'cloud';
      } else {
        projectFile = createInitialProjectFile(options.title, this.now);
        source = 'new';
      }
      await writeFsaProjectFile(handle, PROJECT_FILE_NAME, projectFile);
    }

    await writeJsonFile(handle, LOCAL_METADATA_FILE, {
      version: 1,
      userId: options.userId,
      projectId: options.projectId,
      cloudRevision: options.cloudRevision,
    } satisfies FireflyLocalMetadata);

    const key = projectKey(options.userId, options.projectId);
    this.registrations.set(key, {
      key,
      userId: options.userId,
      projectId: options.projectId,
      leaseToken: options.leaseToken,
      cloudRevision: options.cloudRevision,
      handle,
    });
    this.states.set(key, { status: 'idle', revision: options.cloudRevision });
    this.activeRegistrationKey = key;
    return { handle, projectFile: cloneProjectFile(projectFile), source };
  }

  enqueueCloudSave(projectFile: ProjectFile): void {
    const registrationKey = this.requireActiveRegistrationKey();
    assertProjectFile(projectFile);
    this.pending.set(registrationKey, {
      registrationKey,
      projectFile: cloneProjectFile(projectFile),
    });
    this.failed.delete(registrationKey);
    if (!this.drainPromise) {
      this.drainPromise = this.drain().finally(() => {
        this.drainPromise = null;
        if (this.pending.size > 0) this.startDrain();
      });
    }
  }

  async flushCloudSave(): Promise<FireflyCloudSaveState> {
    while (this.drainPromise || this.pending.size > 0) {
      if (!this.drainPromise) this.startDrain();
      await this.drainPromise;
    }
    return this.getCloudSaveState();
  }

  async retryCloudSave(): Promise<FireflyCloudSaveState> {
    const key = this.requireActiveRegistrationKey();
    const failed = this.failed.get(key);
    if (!failed) return this.flushCloudSave();
    this.failed.delete(key);
    this.pending.set(key, failed);
    if (!this.drainPromise) this.startDrain();
    return this.flushCloudSave();
  }

  getCloudSaveState(): FireflyCloudSaveState {
    const key = this.requireActiveRegistrationKey();
    const state = this.states.get(key);
    if (!state) throw new Error('Firefly cloud state is unavailable');
    return { ...state };
  }

  async renameActiveProject(title: string): Promise<number> {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Project title is required');
    const beforeRename = await this.flushCloudSave();
    if (beforeRename.status === 'error') {
      throw new Error(beforeRename.errorMessage ?? 'Cloud save failed before rename');
    }
    const key = this.requireActiveRegistrationKey();
    const registration = this.requireRegistration(key);
    const revision = await this.checkpointTransport.rename(
      registration.projectId,
      trimmed,
      registration.cloudRevision,
    );
    registration.cloudRevision = revision;
    this.states.set(key, {
      status: 'saved',
      revision,
      savedAt: this.now().toISOString(),
    });
    await this.writeLocalMetadata(registration);
    return revision;
  }

  updateLeaseToken(leaseToken: string): void {
    if (!leaseToken) throw new Error('Firefly edit lease is required');
    const registration = this.requireRegistration(this.requireActiveRegistrationKey());
    registration.leaseToken = leaseToken;
  }

  private startDrain(): void {
    if (this.drainPromise) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (this.pending.size > 0) this.startDrain();
    });
  }

  private async drain(): Promise<void> {
    while (this.pending.size > 0) {
      const next = this.pending.entries().next().value as [string, PendingCloudSave] | undefined;
      if (!next) return;
      const [key, pending] = next;
      this.pending.delete(key);
      const registration = this.requireRegistration(pending.registrationKey);
      this.states.set(key, { status: 'saving', revision: registration.cloudRevision });
      try {
        const revision = await this.checkpointTransport.save({
          projectId: registration.projectId,
          leaseToken: registration.leaseToken,
          expectedRevision: registration.cloudRevision,
          projectFile: pending.projectFile,
        });
        registration.cloudRevision = revision;
        this.failed.delete(key);
        await this.writeLocalMetadata(registration);
        this.states.set(key, {
          status: 'saved',
          revision,
          savedAt: this.now().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cloud checkpoint failed';
        this.states.set(key, {
          status: 'error',
          revision: registration.cloudRevision,
          errorCode: errorCode(error),
          errorMessage: message,
        });
        if (!this.pending.has(key)) this.failed.set(key, pending);
        log.warn('Cloud checkpoint failed after local project save', {
          projectId: registration.projectId,
          errorCode: errorCode(error),
        });
      }
    }
  }

  private async getProjectDirectory(userId: string, projectId: string): Promise<FileSystemDirectoryHandle> {
    let directory = await this.getRootDirectory();
    for (const segment of LOCAL_ROOT_PATH) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    directory = await directory.getDirectoryHandle(fireflyNamespaceSegment(userId, 'userId'), { create: true });
    directory = await directory.getDirectoryHandle('projects', { create: true });
    return directory.getDirectoryHandle(fireflyNamespaceSegment(projectId, 'projectId'), { create: true });
  }

  private async readLocalMetadata(
    handle: FileSystemDirectoryHandle,
    userId: string,
    projectId: string,
  ): Promise<FireflyLocalMetadata | null> {
    const existing = await readJsonFile(handle, LOCAL_METADATA_FILE);
    if (!existing) return null;
    const metadata = existing as Partial<FireflyLocalMetadata>;
    if (metadata.version !== 1
      || metadata.userId !== userId
      || metadata.projectId !== projectId
      || !Number.isSafeInteger(metadata.cloudRevision)
      || (metadata.cloudRevision ?? -1) < 0) {
      throw new Error('Firefly local project namespace does not match the authenticated project');
    }
    return metadata as FireflyLocalMetadata;
  }

  private async readLocalProjectFile(handle: FileSystemDirectoryHandle): Promise<ProjectFile | null> {
    try {
      const projectFile = await readLatestFsaProjectData(handle);
      assertProjectFile(projectFile);
      return projectFile;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  private async writeLocalMetadata(registration: FireflyProjectRegistration): Promise<void> {
    await writeJsonFile(registration.handle, LOCAL_METADATA_FILE, {
      version: 1,
      userId: registration.userId,
      projectId: registration.projectId,
      cloudRevision: registration.cloudRevision,
    } satisfies FireflyLocalMetadata);
  }

  private requireActiveRegistrationKey(): string {
    if (!this.activeRegistrationKey) throw new Error('No Firefly project is active');
    return this.activeRegistrationKey;
  }

  private requireRegistration(key: string): FireflyProjectRegistration {
    const registration = this.registrations.get(key);
    if (!registration) throw new Error('Firefly project registration is unavailable');
    return registration;
  }
}
