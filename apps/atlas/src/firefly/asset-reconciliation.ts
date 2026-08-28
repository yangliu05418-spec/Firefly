import type { AtlasAsset, AtlasDocument } from './model';

const assetSignature = (asset: AtlasAsset) => [asset.name, asset.kind, asset.mimeType, asset.size].join('\u0000');

/**
 * Reconciles the durable server asset ledger into a locally restored document.
 * Local IDs are intentionally preserved because timeline clips reference them.
 * Ambiguous metadata matches are never guessed.
 */
export function reconcileProjectAssets(document: AtlasDocument, remoteAssets: AtlasAsset[]): AtlasDocument {
  const remoteById = new Map(remoteAssets.map((asset) => [asset.id, asset]));
  const remoteBySignature = new Map<string, AtlasAsset[]>();
  for (const asset of remoteAssets) {
    const signature = assetSignature(asset);
    remoteBySignature.set(signature, [...(remoteBySignature.get(signature) ?? []), asset]);
  }
  const claimed = new Set<string>();
  const assets = document.assets.map((local) => {
    let remote = remoteById.get(local.id) ?? (local.sourceId ? remoteById.get(local.sourceId) : undefined);
    if (!remote && local.source === 'local' && !local.sourceId) {
      const candidates = (remoteBySignature.get(assetSignature(local)) ?? []).filter((candidate) => !claimed.has(candidate.id));
      if (candidates.length === 1) remote = candidates[0];
    }
    if (!remote || claimed.has(remote.id)) return local;
    claimed.add(remote.id);
    return {
      ...local,
      name: remote.name,
      kind: remote.kind,
      mimeType: remote.mimeType,
      size: remote.size,
      duration: remote.duration || local.duration,
      width: remote.width ?? local.width,
      height: remote.height ?? local.height,
      status: remote.status,
      sourceId: remote.id,
      mediaUrl: remote.mediaUrl,
      posterUrl: remote.posterUrl,
      error: remote.error,
    };
  });
  for (const remote of remoteAssets) {
    if (!claimed.has(remote.id)) assets.push(remote);
  }
  return { ...document, assets };
}
