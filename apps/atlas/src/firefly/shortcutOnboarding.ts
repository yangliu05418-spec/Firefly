import type { ShortcutPresetId } from '../services/shortcutTypes';

export const FIREFLY_SHORTCUT_ONBOARDING_PRESETS = [
  { id: 'premiere', label: 'Premiere Pro', monogram: 'Pr' },
  { id: 'davinci', label: 'DaVinci Resolve', monogram: 'Dr' },
  { id: 'finalcut', label: 'Final Cut Pro', monogram: 'Fc' },
  { id: 'aftereffects', label: 'After Effects', monogram: 'Ae' },
] as const satisfies ReadonlyArray<{
  id: ShortcutPresetId;
  label: string;
  monogram: string;
}>;

export type FireflyShortcutPresetId = typeof FIREFLY_SHORTCUT_ONBOARDING_PRESETS[number]['id'];

export interface FireflyShortcutOnboardingRecord {
  version: 1;
  completed: true;
  presetId: FireflyShortcutPresetId;
}

const ALLOWED_PRESETS = new Set<string>(
  FIREFLY_SHORTCUT_ONBOARDING_PRESETS.map((preset) => preset.id),
);

export function fireflyShortcutOnboardingStorageKey(userId: string): string {
  return `firefly:atlas:${encodeURIComponent(userId)}:shortcut-onboarding:v1`;
}

export function readFireflyShortcutOnboarding(
  userId: string,
): FireflyShortcutOnboardingRecord | null {
  try {
    const raw = localStorage.getItem(fireflyShortcutOnboardingStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FireflyShortcutOnboardingRecord>;
    if (
      parsed.version !== 1
      || parsed.completed !== true
      || typeof parsed.presetId !== 'string'
      || !ALLOWED_PRESETS.has(parsed.presetId)
    ) {
      return null;
    }
    return parsed as FireflyShortcutOnboardingRecord;
  } catch {
    return null;
  }
}

export function writeFireflyShortcutOnboarding(
  userId: string,
  presetId: FireflyShortcutPresetId,
): FireflyShortcutOnboardingRecord {
  if (!ALLOWED_PRESETS.has(presetId)) {
    throw new Error('FIREFLY_SHORTCUT_PRESET_UNSUPPORTED');
  }
  const record: FireflyShortcutOnboardingRecord = {
    version: 1,
    completed: true,
    presetId,
  };
  try {
    localStorage.setItem(
      fireflyShortcutOnboardingStorageKey(userId),
      JSON.stringify(record),
    );
  } catch {
    // Storage restrictions must never prevent the editor from opening. The
    // onboarding will be offered again on the next visit if persistence failed.
  }
  return record;
}
