import { Logger } from '../../logger';
import { projectDB } from '../../projectDB';
import type { NativeProjectCoreService } from '../core/NativeProjectCoreService';
import type { ProjectCoreService } from '../core/ProjectCoreService';
import {
  getRecentProject,
  removeRecentProject,
} from '../recentProjects';

const log = Logger.create('ProjectFileService');

export interface RecentProjectOpeningContext {
  isFsaAvailable: boolean;
  coreService: ProjectCoreService;
  ensureNativeBackendReady: () => Promise<NativeProjectCoreService | null>;
  activateFsaBackend: () => void;
}

export async function openRecentProject(context: RecentProjectOpeningContext, id: string): Promise<boolean> {
  const recentProject = getRecentProject(id);
  if (!recentProject) {
    return false;
  }

  if (recentProject.backend === 'native') {
    if (!recentProject.path) {
      await removeRecentProject(id);
      return false;
    }

    const nativeCore = await context.ensureNativeBackendReady();
    return nativeCore ? nativeCore.loadProject(recentProject.path) : false;
  }

  if (!context.isFsaAvailable || !recentProject.handleKey) {
    return false;
  }

  let storedHandle: FileSystemHandle | null = null;
  try {
    storedHandle = await projectDB.getStoredHandle(recentProject.handleKey);
  } catch (error) {
    log.warn('Failed to read recent project handle', error);
    return false;
  }

  if (!storedHandle || storedHandle.kind !== 'directory') {
    await removeRecentProject(id);
    return false;
  }

  const projectHandle = storedHandle as FileSystemDirectoryHandle;
  let permission = await projectHandle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    permission = await projectHandle.requestPermission({ mode: 'readwrite' });
  }

  if (permission !== 'granted') {
    return false;
  }

  context.activateFsaBackend();
  const loaded = await context.coreService.loadProject(projectHandle);
  if (!loaded) {
    await removeRecentProject(id);
  }
  return loaded;
}
