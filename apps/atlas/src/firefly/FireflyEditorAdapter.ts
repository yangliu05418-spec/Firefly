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

export async function saveAndFlushEditorProject(): Promise<{
  savedLocally: boolean;
  cloudStatus?: ReturnType<typeof projectFileService.getFireflyCloudSaveState>;
}> {
  const savedLocally = await saveCurrentProject({ source: 'manual', label: 'Return to Atlas projects' });
  if (!savedLocally) return { savedLocally: false };
  const cloudStatus = await projectFileService.flushFireflyCloudSave();
  return { savedLocally: true, cloudStatus };
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
