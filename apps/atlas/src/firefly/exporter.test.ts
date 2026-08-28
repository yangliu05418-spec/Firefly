import { describe, expect, it } from 'vitest';
import { buildExportManifest, MAX_EXPORT_DURATION_SECONDS } from './exporter';
import { createEmptyDocument, type AtlasAsset } from './model';
import { createEditorHistory, editorReducer } from './timeline';

describe('export manifest', () => {
  it('contains only timeline assets and rejects an empty timeline', () => {
    const empty = createEmptyDocument('project-1', '片场');
    expect(() => buildExportManifest(empty)).toThrow(/时间线为空/);
    const asset: AtlasAsset = { id: 'asset-1', name: 'take.mp4', kind: 'video', mimeType: 'video/mp4', size: 1, duration: 8, status: 'ready', source: 'firefly', mediaUrl: '/media' };
    let history = createEditorHistory(empty);
    history = editorReducer(history, { type: 'add-assets', assets: [asset, { ...asset, id: 'unused' }] });
    history = editorReducer(history, { type: 'add-clip', assetId: asset.id });
    expect(buildExportManifest(history.present)).toMatchObject({ duration: 8, assets: [{ id: 'asset-1' }] });
  });

  it('rejects timelines longer than the ten-minute product boundary', () => {
    const document = createEmptyDocument('project-1', '片场');
    const asset = { id: 'asset-1', name: '长片', kind: 'video' as const, mimeType: 'video/mp4', size: 1, duration: MAX_EXPORT_DURATION_SECONDS + 1, status: 'ready' as const, source: 'local' as const };
    document.assets.push(asset);
    document.clips.push({
      id: 'clip-1', assetId: asset.id, trackId: document.tracks[0]!.id, name: asset.name,
      startTime: 0, duration: MAX_EXPORT_DURATION_SECONDS + 1, inPoint: 0, outPoint: MAX_EXPORT_DURATION_SECONDS + 1,
      volume: 1, muted: false, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, transitionIn: 'none', transitionDuration: 0,
    });
    expect(() => buildExportManifest(document)).toThrow(/最长支持10分钟/);
  });
});
