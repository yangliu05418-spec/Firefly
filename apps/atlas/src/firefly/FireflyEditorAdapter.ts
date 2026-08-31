import '../fireflyEditorBoot';

import { projectFileService } from '../services/projectFileService';
import {
  closeCurrentProject,
  loadProjectToStores,
  saveCurrentProject,
} from '../services/projectSync';
import { teardownAutoSync } from '../services/project/projectLifecycle';
import type { OpenFireflyProjectOptions } from '../services/project';

/** Thin lazy boundary between Firefly's control plane and the original editor. */
export async function openEditorProject(options: OpenFireflyProjectOptions): Promise<boolean> {
  const opened = await projectFileService.openFireflyProject(options);
  if (!opened) return false;
  await loadProjectToStores();
  return true;
}

export function saveEditorProjectLocally(): Promise<boolean> {
  return saveCurrentProject({ source: 'manual', label: 'Return to Atlas projects' });
}

/**
 * Cloud durability is deliberately separate from the local save boundary.
 * Atlas is local-first: navigation may wait for OPFS, but never for TOS.
 */
export function flushEditorProjectCloud(): ReturnType<typeof projectFileService.flushFireflyCloudSave> {
  return projectFileService.flushFireflyCloudSave();
}

export function updateEditorLeaseToken(token: string): void {
  projectFileService.updateFireflyLeaseToken(token);
}

export function closeEditorProject(): void {
  teardownAutoSync();
  closeCurrentProject();
}

export function disposeEditorRuntime(): void {
  teardownAutoSync();
}
