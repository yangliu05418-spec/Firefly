import { describe, expect, it } from 'vitest';
import { getClassicMediaColumnText } from '../../src/components/panels/media/list/classicListPlanning';
import type { MediaFile, SignalAssetItem } from '../../src/stores/mediaStore';

describe('classic media list type-specific columns', () => {
  it('shows audio-specific metadata in video-shaped columns', () => {
    const item = {
      id: 'audio-1',
      name: 'Voice.ogg',
      type: 'audio',
      parentId: null,
      createdAt: 1,
      url: 'blob:voice',
      duration: 12,
      audioCodec: 'opus',
      container: 'ogg',
      waveformChannels: [[0], [0]],
      audioProxyStatus: 'generating',
      audioProxyProgress: 37,
      stemInfo: {
        schemaVersion: 1,
        sourceMediaFileId: 'source-1',
        kind: 'vocals',
        label: 'Vocals',
        createdAt: 1,
      },
    } as MediaFile;

    expect(getClassicMediaColumnText(item, 'resolution')).toBe('2ch wave');
    expect(getClassicMediaColumnText(item, 'fps')).toBe('Vocals');
    expect(getClassicMediaColumnText(item, 'codec')).toBe('opus');
    expect(getClassicMediaColumnText(item, 'audio')).toBe('Proxy 37%');
  });

  it('uses still-image labels instead of empty audio/fps values', () => {
    const item = {
      id: 'image-1',
      name: 'Plate.png',
      type: 'image',
      parentId: null,
      createdAt: 1,
      url: 'blob:plate',
      width: 1920,
      height: 1080,
    } as MediaFile;

    expect(getClassicMediaColumnText(item, 'resolution')).toBe('1920\u00d71080');
    expect(getClassicMediaColumnText(item, 'fps')).toBe('Still');
    expect(getClassicMediaColumnText(item, 'codec')).toBe('Raster');
    expect(getClassicMediaColumnText(item, 'audio')).toBe('Image');
  });

  it('shows signal-provider details for signal assets', () => {
    const item = {
      id: 'signal-1',
      name: 'Data.json',
      type: 'signal',
      parentId: null,
      createdAt: 1,
      providerId: 'json-importer',
      signalKinds: ['table', 'scalar'],
      artifacts: [{ artifactId: 'a' }, { artifactId: 'b' }],
      diagnostics: [{ severity: 'warning', code: 'w', message: 'Check rows' }],
      asset: {
        source: {
          kind: 'file',
          extension: 'json',
        },
      },
    } as SignalAssetItem;

    expect(getClassicMediaColumnText(item, 'resolution')).toBe('table, scalar');
    expect(getClassicMediaColumnText(item, 'fps')).toBe('2 assets');
    expect(getClassicMediaColumnText(item, 'container')).toBe('json-importer');
    expect(getClassicMediaColumnText(item, 'codec')).toBe('json');
    expect(getClassicMediaColumnText(item, 'audio')).toBe('1 diag');
  });
});
