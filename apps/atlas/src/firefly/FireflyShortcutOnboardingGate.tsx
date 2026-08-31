import { useCallback, useEffect, useMemo, useState } from 'react';

import { TutorialSetupOverlay } from '../components/common/tutorial/TutorialSetupOverlay';
import { useSettingsStore } from '../stores/settingsStore';
import type { FireflyEmbeddingValue } from './FireflyEmbeddingContext';
import {
  readFireflyShortcutOnboarding,
  writeFireflyShortcutOnboarding,
  type FireflyShortcutPresetId,
} from './shortcutOnboarding';

export function FireflyShortcutOnboardingGate({
  user,
}: {
  user: FireflyEmbeddingValue['user'];
}) {
  const userKey = useMemo(
    () => user.id?.trim() || user.email.trim().toLowerCase(),
    [user.email, user.id],
  );
  const setUserBackground = useSettingsStore((state) => state.setUserBackground);
  const setActiveShortcutPreset = useSettingsStore((state) => state.setActiveShortcutPreset);
  const activeShortcutPreset = useSettingsStore((state) => state.activeShortcutPreset);
  const [completed, setCompleted] = useState(
    () => readFireflyShortcutOnboarding(userKey) !== null,
  );

  useEffect(() => {
    const record = readFireflyShortcutOnboarding(userKey);
    if (!record) {
      setCompleted(false);
      return;
    }
    setUserBackground(record.presetId);
    if (activeShortcutPreset !== record.presetId) {
      setActiveShortcutPreset(record.presetId);
    }
    setCompleted(true);
  }, [activeShortcutPreset, setActiveShortcutPreset, setUserBackground, userKey]);

  const handleComplete = useCallback((presetId: FireflyShortcutPresetId) => {
    setUserBackground(presetId);
    setActiveShortcutPreset(presetId);
    writeFireflyShortcutOnboarding(userKey, presetId);
    setCompleted(true);
  }, [setActiveShortcutPreset, setUserBackground, userKey]);

  if (completed) return null;

  return (
    <TutorialSetupOverlay
      required
      onCancel={() => undefined}
      onComplete={handleComplete}
    />
  );
}
