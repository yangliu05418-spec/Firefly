import Database from "better-sqlite3";
import { config } from "./config.js";
import { UserStore } from "./db.js";
import { buildImageReeditPayload, buildVideoReeditPayload, type GenerationReeditPayload } from "./generation-reedit.js";
import { containsInternalPromptMarker } from "./creation-snapshots.js";
import { MODELS } from "./capabilities.js";

const database = new Database(config.databasePath, { readonly: true });
const store = new UserStore(config.databasePath);

const dependencies = {
  readUploadState: (uploadId: string) => store.readUploadState(uploadId),
  readUserAsset: (assetId: string) => store.readUserAsset(assetId),
  readSnapshot: (sourceType: "video" | "image", sourceId: string) => store.readCreationSnapshot(sourceType, sourceId),
  listSnapshotReferences: (sourceType: "video" | "image", sourceId: string) => store.listCreationSnapshotReferences(sourceType, sourceId),
  readSession: (sessionId: string, includeDeleted?: boolean) => store.readCreationSession(sessionId, includeDeleted),
  now: () => Date.now(),
  inputRetentionDays: config.tosInputRetentionDays,
};

const assertPayload = (payload: GenerationReeditPayload) => {
  if (payload.source.id !== payload.sourceId || payload.source.type !== payload.sourceType) throw new Error("re-edit source contract mismatch");
  if (payload.editorPrompt !== payload.state.prompt) throw new Error("re-edit editor prompt contract mismatch");
  if (payload.references !== payload.state.assets) throw new Error("re-edit reference contract mismatch");
  const bindings = new Set<string>();
  for (const reference of payload.references) {
    if (!reference.bindingId || bindings.has(reference.bindingId)) throw new Error("re-edit binding identifiers are not unique");
    bindings.add(reference.bindingId);
    if (reference.preview && (!reference.preview.startsWith("/api/") || /^https?:\/\//i.test(reference.preview))) {
      throw new Error("re-edit returned an unstable media URL");
    }
  }
};

try {
  const leaked = database.prepare(`
    SELECT source_type, source_id FROM creation_snapshots
    WHERE provider_prompt LIKE '%[[firefly-%' LIMIT 1
  `).get() as { source_type: string; source_id: string } | undefined;
  if (leaked) throw new Error(`internal reference marker persisted in provider prompt for ${leaked.source_type}:${leaked.source_id}`);

  const duplicateBinding = database.prepare(`
    SELECT source_type, source_id, binding_id FROM creation_snapshot_references
    WHERE status != 'deleted' GROUP BY source_type, source_id, binding_id HAVING COUNT(*) > 1 LIMIT 1
  `).get();
  if (duplicateBinding) throw new Error("creation snapshot contains duplicate binding identifiers");

  const results: Array<{ sourceType: "video" | "image"; sourceId: string; recoveryQuality: string; bindings: number; omitted: number }> = [];
  const videoRow = database.prepare(`
    SELECT id, owner_id FROM generation_tasks
    WHERE owner_id IS NOT NULL AND deleted_at IS NULL AND status IN ('succeeded', 'failed')
    ORDER BY created_at DESC LIMIT 1
  `).get() as { id: string; owner_id: string } | undefined;
  if (videoRow) {
    const task = store.readTask(videoRow.id);
    if (!task) throw new Error("video smoke source disappeared");
    const payload = buildVideoReeditPayload(task, videoRow.owner_id, dependencies);
    assertPayload(payload);
    results.push({ sourceType: "video", sourceId: task.id, recoveryQuality: payload.recoveryQuality, bindings: payload.references.length, omitted: payload.omittedAssets });
  }

  const imageRow = database.prepare(`
    SELECT id, owner_id FROM image_generation_tasks
    WHERE deleted_at IS NULL AND status IN ('succeeded', 'failed')
    ORDER BY created_at DESC LIMIT 1
  `).get() as { id: string; owner_id: string } | undefined;
  if (imageRow) {
    const task = store.readImageGeneration(imageRow.id);
    if (!task) throw new Error("image smoke source disappeared");
    const payload = buildImageReeditPayload(task, imageRow.owner_id, MODELS[0]?.id ?? "", dependencies);
    assertPayload(payload);
    results.push({ sourceType: "image", sourceId: task.id, recoveryQuality: payload.recoveryQuality, bindings: payload.references.length, omitted: payload.omittedAssets });
  }

  if (!results.length) throw new Error("no terminal production task is available for re-edit smoke validation");
  process.stdout.write(`${JSON.stringify({ type: "reedit_smoke_completed", at: new Date().toISOString(), results })}\n`);
} finally {
  database.close();
  store.close();
}
