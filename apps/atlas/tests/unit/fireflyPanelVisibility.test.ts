import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Firefly panel picker boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps unshipped AI, capture, 3D and scope panels out of the View menu', async () => {
    vi.stubEnv('VITE_APP_VARIANT', 'firefly');
    vi.resetModules();

    const { VIEW_CORE_PANEL_TYPES, VIEW_AI_PANEL_TYPES } = await import(
      '../../src/components/common/toolbar/viewPanelConfig'
    );

    expect(VIEW_CORE_PANEL_TYPES).toEqual([
      'preview',
      'timeline',
      'clip-properties',
      'history',
      'audio-mixer',
      'media',
      'export',
    ]);
    expect(VIEW_AI_PANEL_TYPES).toEqual(['atlas-agent']);
  });

  it('mounts the Firefly Agent in the factory Agent Mode start panel', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/components/dock/DockPanelContent.tsx'),
      'utf8',
    );

    expect(source).toMatch(/case 'start':[\s\S]*if \(OriginalAtlasAgentPanel\)[\s\S]*<OriginalAtlasAgentPanel/);
  });
});
