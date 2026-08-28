import { describe, expect, it } from 'vitest';
import { reconcileProjectAssets } from './asset-reconciliation';
import { createEmptyDocument, type AtlasAsset } from './model';

const asset = (overrides: Partial<AtlasAsset> = {}): AtlasAsset => ({
  id: 'remote-1', name: 'take.mp4', kind: 'video', mimeType: 'video/mp4', size: 100,
  duration: 10, status: 'ready', source: 'firefly', mediaUrl: '/api/media/remote-1', ...overrides,
});

describe('project asset reconciliation', () => {
  it('binds an unambiguous archived upload without changing clip-local IDs', () => {
    const document = createEmptyDocument('project-1', '片场');
    document.assets = [asset({ id: 'local-1', source: 'local', sourceId: undefined, status: 'uploading', mediaUrl: undefined, objectUrl: 'blob:local' })];
    document.clips = [{
      id: 'clip-1', assetId: 'local-1', trackId: document.tracks[0]!.id, name: 'take.mp4', startTime: 0, duration: 10,
      inPoint: 0, outPoint: 10, volume: 1, muted: false, transitionIn: 'none',
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    }];
    const reconciled = reconcileProjectAssets(document, [asset()]);
    expect(reconciled.assets[0]).toMatchObject({ id: 'local-1', sourceId: 'remote-1', status: 'ready', objectUrl: 'blob:local' });
    expect(reconciled.clips[0]!.assetId).toBe('local-1');
  });

  it('updates exact server assets and appends assets missing from the checkpoint', () => {
    const document = createEmptyDocument('project-1', '片场');
    document.assets = [asset({ status: 'uploading', mediaUrl: undefined })];
    const reconciled = reconcileProjectAssets(document, [asset(), asset({ id: 'remote-2', name: 'other.png', kind: 'image', mimeType: 'image/png' })]);
    expect(reconciled.assets).toHaveLength(2);
    expect(reconciled.assets[0]).toMatchObject({ id: 'remote-1', status: 'ready' });
    expect(reconciled.assets[1]).toMatchObject({ id: 'remote-2' });
  });

  it('does not guess when multiple server assets share the same metadata', () => {
    const document = createEmptyDocument('project-1', '片场');
    document.assets = [asset({ id: 'local-1', source: 'local', sourceId: undefined, status: 'uploading' })];
    const reconciled = reconcileProjectAssets(document, [asset(), asset({ id: 'remote-2' })]);
    expect(reconciled.assets[0]).toMatchObject({ id: 'local-1', sourceId: undefined, status: 'uploading' });
    expect(reconciled.assets.map((item) => item.id)).toEqual(['local-1', 'remote-1', 'remote-2']);
  });
});
