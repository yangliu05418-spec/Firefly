import type { ProjectComposition } from '../types/composition.types';
import type { ProjectFolder } from '../types/folder.types';
import type { ProjectMediaFile } from '../types/media.types';
import type { ProjectFile } from '../types/project.types';

/**
 * The persistence seam used by ProjectFileService.
 *
 * Timeline, preview, dock and Zustand stores continue to talk to the original
 * ProjectFileService facade. Backends only own where the canonical ProjectFile
 * and its project folder are persisted.
 */
export interface ProjectCorePort {
  isSupported(): boolean;
  getProjectHandle(): FileSystemDirectoryHandle | null;
  getProjectData(): ProjectFile | null;
  isProjectOpen(): boolean;
  hasUnsavedChanges(): boolean;
  markDirty(): void;
  needsPermission(): boolean;
  getPendingProjectName(): string | null;
  requestPendingPermission(): Promise<boolean>;
  saveProject(): Promise<boolean>;
  closeProject(): void;
  createBackup(): Promise<boolean>;
  renameProject(newName: string): Promise<boolean>;
  updateProjectData(updates: Partial<ProjectFile>): void;
  updateMedia(media: ProjectMediaFile[]): void;
  updateCompositions(compositions: ProjectComposition[]): void;
  updateFolders(folders: ProjectFolder[]): void;
}

export type ProjectHandlePort = Pick<ProjectCorePort, 'getProjectHandle'>;
