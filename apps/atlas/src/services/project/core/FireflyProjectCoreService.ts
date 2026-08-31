import { Logger } from '../../logger';
import type { ProjectComposition } from '../types/composition.types';
import type { ProjectFolder } from '../types/folder.types';
import type { ProjectMediaFile } from '../types/media.types';
import type { ProjectFile } from '../types/project.types';
import {
  FireflyProjectRepository,
  type FireflyCloudSaveState,
  type OpenFireflyProjectOptions,
} from '../firefly/FireflyProjectRepository';
import type { FileStorageService } from './FileStorageService';
import type { ProjectCorePort } from './ProjectCorePort';
import { ProjectCoreService } from './ProjectCoreService';

const log = Logger.create('FireflyProjectCore');

/**
 * Firefly persistence adapter around the original, tested ProjectCoreService.
 * The original ProjectFile remains the only editor truth.
 */
export class FireflyProjectCoreService implements ProjectCorePort {
  private readonly localCore: ProjectCoreService;
  private readonly repository: FireflyProjectRepository;

  constructor(
    fileStorage: FileStorageService,
    repository: FireflyProjectRepository = new FireflyProjectRepository(),
  ) {
    this.localCore = new ProjectCoreService(fileStorage, { persistBrowserHandles: false });
    this.repository = repository;
  }

  async openProject(options: OpenFireflyProjectOptions): Promise<boolean> {
    try {
      const prepared = await this.repository.prepare(options);
      if (!await this.localCore.loadProject(prepared.handle)) return false;

      const projectFile = this.localCore.getProjectData();
      if (projectFile && projectFile.name !== options.title) {
        this.localCore.updateProjectData({ name: options.title });
        if (await this.localCore.saveProject()) {
          const synchronizedProjectFile = this.localCore.getProjectData();
          if (synchronizedProjectFile) this.repository.enqueueCloudSave(synchronizedProjectFile);
        }
      }
      return true;
    } catch (error) {
      // Conflict and recovery policy belong to the Firefly shell. Preserve the
      // typed error so the UI can offer "keep local" or "restore cloud"
      // instead of turning a recoverable state into a generic open failure.
      if (error instanceof Error && 'code' in error) throw error;
      log.error('Failed to open Firefly project', error);
      return false;
    }
  }

  isSupported(): boolean {
    return typeof navigator !== 'undefined'
      && Boolean(navigator.storage)
      && typeof navigator.storage.getDirectory === 'function';
  }

  getProjectHandle(): FileSystemDirectoryHandle | null {
    return this.localCore.getProjectHandle();
  }

  getProjectData(): ProjectFile | null {
    return this.localCore.getProjectData();
  }

  isProjectOpen(): boolean {
    return this.localCore.isProjectOpen();
  }

  hasUnsavedChanges(): boolean {
    return this.localCore.hasUnsavedChanges();
  }

  markDirty(): void {
    this.localCore.markDirty();
  }

  needsPermission(): boolean {
    return false;
  }

  getPendingProjectName(): string | null {
    return null;
  }

  async requestPendingPermission(): Promise<boolean> {
    return false;
  }

  async saveProject(): Promise<boolean> {
    const wasDirty = this.localCore.hasUnsavedChanges();
    const savedLocally = await this.localCore.saveProject();
    if (!savedLocally) return false;
    const projectFile = this.localCore.getProjectData();
    if (wasDirty && projectFile) this.repository.enqueueCloudSave(projectFile);
    return true;
  }

  async flushCloudSave(): Promise<FireflyCloudSaveState> {
    return this.repository.flushCloudSave();
  }

  async retryCloudSave(): Promise<FireflyCloudSaveState> {
    return this.repository.retryCloudSave();
  }

  getCloudSaveState(): FireflyCloudSaveState {
    return this.repository.getCloudSaveState();
  }

  updateLeaseToken(leaseToken: string): void {
    this.repository.updateLeaseToken(leaseToken);
  }

  closeProject(): void {
    this.localCore.closeProject();
  }

  async createBackup(): Promise<boolean> {
    return this.localCore.createBackup();
  }

  async renameProject(newName: string): Promise<boolean> {
    const trimmed = newName.trim();
    const projectFile = this.localCore.getProjectData();
    if (!projectFile || !trimmed || projectFile.name === trimmed) return false;
    try {
      await this.repository.renameActiveProject(trimmed);
      this.localCore.updateProjectData({ name: trimmed });
      const savedLocally = await this.localCore.saveProject();
      if (!savedLocally) return false;
      this.repository.enqueueCloudSave(projectFile);
      return true;
    } catch (error) {
      log.error('Failed to rename Firefly project', error);
      return false;
    }
  }

  updateProjectData(updates: Partial<ProjectFile>): void {
    this.localCore.updateProjectData(updates);
  }

  updateMedia(media: ProjectMediaFile[]): void {
    this.localCore.updateMedia(media);
  }

  updateCompositions(compositions: ProjectComposition[]): void {
    this.localCore.updateCompositions(compositions);
  }

  updateFolders(folders: ProjectFolder[]): void {
    this.localCore.updateFolders(folders);
  }
}
