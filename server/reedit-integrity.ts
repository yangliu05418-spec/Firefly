import { MODELS } from "./capabilities.js";
import type { UserStore } from "./db.js";
import { buildImageReeditPayload, buildVideoReeditPayload, type GenerationReeditPayload } from "./generation-reedit.js";

type Result = { sourceType: "video" | "image"; sourceId: string; recoveryQuality: string; bindings: number; omitted: number };

const assertPayload = (payload: GenerationReeditPayload) => {
  if (payload.source.id !== payload.sourceId || payload.source.type !== payload.sourceType) throw new Error("re-edit source contract mismatch");
  if (payload.editorPrompt !== payload.state.prompt) throw new Error("re-edit editor prompt contract mismatch");
  if (payload.references !== payload.state.assets) throw new Error("re-edit reference contract mismatch");
  const bindings = new Set<string>();
  for (const reference of payload.references) {
    if (!reference.bindingId || bindings.has(reference.bindingId)) throw new Error("re-edit binding identifiers are not unique");
    bindings.add(reference.bindingId);
    if (reference.preview && (!reference.preview.startsWith("/api/") || /^https?:\/\//i.test(reference.preview))) throw new Error("re-edit returned an unstable media URL");
  }
};

export const runReeditIntegrityCheck = (store: UserStore, inputRetentionDays: number, requireSource = false) => {
  const sources = store.reeditIntegritySources();
  if (sources.providerMarkerLeak) throw new Error("internal reference marker persisted in provider prompt");
  if (sources.duplicateBinding) throw new Error("creation snapshot contains duplicate binding identifiers");
  const dependencies = {
    readUploadState: (uploadId: string) => store.readUploadState(uploadId),
    readUserAsset: (assetId: string) => store.readUserAsset(assetId),
    readSnapshot: (sourceType: "video" | "image", sourceId: string) => store.readCreationSnapshot(sourceType, sourceId),
    listSnapshotReferences: (sourceType: "video" | "image", sourceId: string) => store.listCreationSnapshotReferences(sourceType, sourceId),
    readSession: (sessionId: string, includeDeleted?: boolean) => store.readCreationSession(sessionId, includeDeleted),
    now: () => Date.now(), inputRetentionDays,
  };
  const results: Result[] = [];
  if (sources.video?.ownerId) {
    const payload = buildVideoReeditPayload(sources.video, sources.video.ownerId, dependencies);
    assertPayload(payload);
    results.push({ sourceType: "video", sourceId: sources.video.id, recoveryQuality: payload.recoveryQuality, bindings: payload.references.length, omitted: payload.omittedAssets });
  }
  if (sources.image) {
    const payload = buildImageReeditPayload(sources.image, sources.image.ownerId, MODELS[0]?.id ?? "", dependencies);
    assertPayload(payload);
    results.push({ sourceType: "image", sourceId: sources.image.id, recoveryQuality: payload.recoveryQuality, bindings: payload.references.length, omitted: payload.omittedAssets });
  }
  if (requireSource && !results.length) throw new Error("no terminal production task is available for re-edit smoke validation");
  return results;
};
