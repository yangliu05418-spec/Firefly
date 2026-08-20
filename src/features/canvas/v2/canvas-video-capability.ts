import type { ModelCapability } from "../../../types";

export type CanvasVideoReferenceKind = "image" | "video" | "audio";

export const canvasVideoModeForReferences = (references: readonly CanvasVideoReferenceKind[]) => references.length ? "omni" as const : "text" as const;

export const canvasVideoModelsForReferences = (models: readonly ModelCapability[], references: readonly CanvasVideoReferenceKind[]) => {
  const mode = canvasVideoModeForReferences(references);
  const counts = { image: 0, video: 0, audio: 0 };
  for (const kind of references) counts[kind] += 1;
  return models.filter((model) => model.modes.includes(mode)
    && counts.image <= model.imageLimit
    && counts.video <= model.videoLimit
    && counts.audio <= model.audioLimit
    && (!references.length || counts.image > 0 || counts.video > 0 || model.audioOnly));
};
