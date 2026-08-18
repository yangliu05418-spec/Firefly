import type { CanvasProject } from "./db.js";
import { countCanvasNodes, parseCanvasDocumentSafe, type CanvasDocumentV1 } from "./canvas-document.js";

export type PublicCanvasProject = { id: string; title: string; nodeCount: number; updatedAt: number };
export type PublicCanvasProjectDetail = { id: string; title: string; revision: number; updatedAt: number; document: CanvasDocumentV1 | null };

export const publicCanvasProject = (project: CanvasProject): PublicCanvasProject => ({
  id: project.id,
  title: project.title,
  nodeCount: countCanvasNodes(project.documentJson),
  updatedAt: project.updatedAt,
});

export const publicCanvasProjectDetail = (project: CanvasProject): PublicCanvasProjectDetail => ({
  id: project.id,
  title: project.title,
  revision: project.revision,
  updatedAt: project.updatedAt,
  document: parseCanvasDocumentSafe(project.documentJson),
});
