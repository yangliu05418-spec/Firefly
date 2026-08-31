import { beforeEach, describe, expect, it } from 'vitest';
import {
  FIREFLY_SHORTCUT_ONBOARDING_PRESETS,
  readFireflyShortcutOnboarding,
  writeFireflyShortcutOnboarding,
} from '../../src/firefly/shortcutOnboarding';

describe('Firefly shortcut onboarding', () => {
  beforeEach(() => localStorage.clear());

  it('only exposes the supported professional editor presets', () => {
    expect(FIREFLY_SHORTCUT_ONBOARDING_PRESETS.map((preset) => preset.id)).toEqual([
      'premiere',
      'davinci',
      'finalcut',
      'aftereffects',
    ]);
    expect(FIREFLY_SHORTCUT_ONBOARDING_PRESETS.every((preset) => (
      preset.monogram.length === 2 && !('logo' in preset)
    ))).toBe(true);
  });

  it('persists the completed choice independently for each Firefly user', () => {
    writeFireflyShortcutOnboarding('user-a', 'davinci');

    expect(readFireflyShortcutOnboarding('user-a')).toEqual({
      version: 1,
      completed: true,
      presetId: 'davinci',
    });
    expect(readFireflyShortcutOnboarding('user-b')).toBeNull();
  });

  it('rejects retired or malformed persisted preset values', () => {
    localStorage.setItem(
      'firefly:atlas:user-a:shortcut-onboarding:v1',
      JSON.stringify({ version: 1, completed: true, presetId: 'masterselects' }),
    );

    expect(readFireflyShortcutOnboarding('user-a')).toBeNull();
  });
});
