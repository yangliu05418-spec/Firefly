import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Firefly localization boundary for the original Atlas editor', () => {
  it('uses the typed Chinese catalog in the Firefly production variant', async () => {
    vi.stubEnv('VITE_APP_VARIANT', 'firefly');
    vi.resetModules();
    const { originalUi } = await import('../../src/firefly/i18n/originalUi');

    expect(originalUi('original.favoriteLayouts', 'Favorite layouts')).toBe('常用布局');
    expect(originalUi('original.mediaDuration', 'Duration')).toBe('时长');
    expect(originalUi('original.timelineTools', 'Timeline tools')).toBe('时间线工具');
    expect(originalUi('original.previewComposition', 'Composition preview')).toBe('合成预览');
  });

  it('preserves upstream labels outside the Firefly variant', async () => {
    vi.stubEnv('VITE_APP_VARIANT', 'upstream');
    vi.resetModules();
    const { originalUi } = await import('../../src/firefly/i18n/originalUi');

    expect(originalUi('original.favoriteLayouts', 'Favorite layouts')).toBe('Favorite layouts');
  });
});
