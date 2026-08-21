import type { CanvasDocumentV2, CanvasNodeV2 } from "./canvas-document.js";

export type ResolvedCanvasContext = {
  target: CanvasNodeV2;
  sources: CanvasNodeV2[];
  text: string;
  assetIds: string[];
};

export const resolveCanvasContext = (document: CanvasDocumentV2, nodeId: string): ResolvedCanvasContext | null => {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  const target = byId.get(nodeId);
  if (!target) return null;
  const seen = new Set<string>();
  const sources: CanvasNodeV2[] = [];
  for (const connection of document.connections) {
    if (connection.target !== nodeId || seen.has(connection.source)) continue;
    const source = byId.get(connection.source);
    if (!source) continue;
    seen.add(source.id);
    sources.push(source);
  }
  const text = sources
    .filter((node) => node.type === "text")
    .map((node) => node.data.markdown?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const assetIds = [...new Set(sources
    .map((node) => node.data.projectAssetId)
    .filter((value): value is string => typeof value === "string"))];
  return { target, sources, text, assetIds };
};
