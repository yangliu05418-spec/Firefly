import type { FileStorageService } from '../core/FileStorageService';
import type { NativeFileStorageService } from '../core/NativeFileStorageService';
import type { NativeProjectCoreService } from '../core/NativeProjectCoreService';
import type { ProjectCoreService } from '../core/ProjectCoreService';
import { PROJECT_FOLDERS, type ProjectFolderKey } from '../core/constants';

type ProjectFileStorageBackend = 'fsa' | 'native';

export interface FileStorageRoutingContext {
  activeBackend: ProjectFileStorageBackend;
  coreService: ProjectCoreService;
  fileStorage: FileStorageService;
  nativeCoreService: NativeProjectCoreService | null;
  nativeFileStorage: NativeFileStorageService | null;
}

export async function getRoutedFileHandle(
  context: FileStorageRoutingContext,
  subFolder: keyof typeof PROJECT_FOLDERS,
  fileName: string,
  create = false,
): Promise<FileSystemFileHandle | null> {
  const handle = context.coreService.getProjectHandle();
  if (!handle) return null;
  return context.fileStorage.getFileHandle(handle, subFolder as ProjectFolderKey, fileName, create);
}

export async function writeRoutedFile(
  context: FileStorageRoutingContext,
  subFolder: keyof typeof PROJECT_FOLDERS,
  fileName: string,
  content: Blob | string,
): Promise<boolean> {
  if (context.activeBackend === 'native' && context.nativeFileStorage && context.nativeCoreService) {
    const path = context.nativeCoreService.getProjectPath();
    if (!path) return false;
    return context.nativeFileStorage.writeFile(path, subFolder as ProjectFolderKey, fileName, content);
  }
  const handle = context.coreService.getProjectHandle();
  if (!handle) return false;
  return context.fileStorage.writeFile(handle, subFolder as ProjectFolderKey, fileName, content);
}

export async function readRoutedFile(
  context: FileStorageRoutingContext,
  subFolder: keyof typeof PROJECT_FOLDERS,
  fileName: string,
): Promise<File | null> {
  if (context.activeBackend === 'native' && context.nativeFileStorage && context.nativeCoreService) {
    const path = context.nativeCoreService.getProjectPath();
    if (!path) return null;
    const buffer = await context.nativeFileStorage.readFileBinary(path, subFolder as ProjectFolderKey, fileName);
    if (!buffer) return null;
    return new File([buffer], fileName);
  }
  const handle = context.coreService.getProjectHandle();
  if (!handle) return null;
  return context.fileStorage.readFile(handle, subFolder as ProjectFolderKey, fileName);
}

export async function routedFileExists(
  context: FileStorageRoutingContext,
  subFolder: keyof typeof PROJECT_FOLDERS,
  fileName: string,
): Promise<boolean> {
  if (context.activeBackend === 'native' && context.nativeFileStorage && context.nativeCoreService) {
    const path = context.nativeCoreService.getProjectPath();
    if (!path) return false;
    return context.nativeFileStorage.fileExists(path, subFolder as ProjectFolderKey, fileName);
  }
  const handle = context.coreService.getProjectHandle();
  if (!handle) return false;
  return context.fileStorage.fileExists(handle, subFolder as ProjectFolderKey, fileName);
}

export async function deleteRoutedFile(
  context: FileStorageRoutingContext,
  subFolder: keyof typeof PROJECT_FOLDERS,
  fileName: string,
): Promise<boolean> {
  if (context.activeBackend === 'native' && context.nativeFileStorage && context.nativeCoreService) {
    const path = context.nativeCoreService.getProjectPath();
    if (!path) return false;
    return context.nativeFileStorage.deleteFile(path, subFolder as ProjectFolderKey, fileName);
  }
  const handle = context.coreService.getProjectHandle();
  if (!handle) return false;
  return context.fileStorage.deleteFile(handle, subFolder as ProjectFolderKey, fileName);
}

export async function deleteRoutedEntry(
  context: FileStorageRoutingContext,
  subFolder: keyof typeof PROJECT_FOLDERS,
  entryName: string,
  options?: { recursive?: boolean },
): Promise<boolean> {
  if (context.activeBackend === 'native' && context.nativeFileStorage && context.nativeCoreService) {
    const path = context.nativeCoreService.getProjectPath();
    if (!path) return false;
    return context.nativeFileStorage.deleteEntry(path, subFolder as ProjectFolderKey, entryName, options);
  }
  const handle = context.coreService.getProjectHandle();
  if (!handle) return false;
  return context.fileStorage.deleteEntry(handle, subFolder as ProjectFolderKey, entryName, options);
}

export async function listRoutedFiles(
  context: FileStorageRoutingContext,
  subFolder: keyof typeof PROJECT_FOLDERS,
): Promise<string[]> {
  if (context.activeBackend === 'native' && context.nativeFileStorage && context.nativeCoreService) {
    const path = context.nativeCoreService.getProjectPath();
    if (!path) return [];
    return context.nativeFileStorage.listFiles(path, subFolder as ProjectFolderKey);
  }
  const handle = context.coreService.getProjectHandle();
  if (!handle) return [];
  return context.fileStorage.listFiles(handle, subFolder as ProjectFolderKey);
}
