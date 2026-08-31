import { useEffect } from 'react';

import { Toolbar, type FireflyEmbeddedToolbarContext } from './components/common/Toolbar';
import { HistoryActionToast } from './components/common/HistoryActionToast';
import { ProjectLoadProgressOverlay } from './components/common/ProjectLoadProgressOverlay';
import { ShortcutDisplayOverlay } from './components/common/ShortcutDisplayOverlay';
import { DockContainer } from './components/dock';
import { GuidedActionOverlay } from './components/guidedActions/GuidedActionOverlay';
import { useBackNavigationGuard } from './hooks/useBackNavigationGuard';
import { useClipPanelSync } from './hooks/useClipPanelSync';
import { useGlobalHistory } from './hooks/useGlobalHistory';
import { useGlobalSelectWheel } from './hooks/useGlobalSelectWheel';
import { useLiveInputFeedbackCoordinator } from './hooks/useLiveInputFeedbackCoordinator';
import { useMIDIRuntime } from './hooks/useMIDIRuntime';
import { usePageZoom } from './hooks/usePageZoom';
import { usePointerFocusHandoff } from './hooks/usePointerFocusHandoff';
import { useTheme } from './hooks/useTheme';
import { audioRoutingManager } from './services/audioRoutingManager';
import { useUiSettingsStore } from './stores/uiSettingsStore';
import { FireflyEmbeddingProvider } from './firefly/FireflyEmbeddingContext';
import { FireflyGeneratedMediaBridge } from './firefly/FireflyGeneratedMediaBridge';
import { FireflyShortcutOnboardingGate } from './firefly/FireflyShortcutOnboardingGate';
import './styles/app-shell.css';
import './styles/shared-controls.css';

/**
 * Firefly's production shell around the original Atlas editor components.
 * Editing stores, media runtime, Dock, Preview and Timeline remain the original
 * implementation; only MasterSelects authentication/commercial/tutorial chrome
 * is intentionally excluded from this entry graph.
 */
export default function FireflyEmbeddedEditor({ fireflyEmbedded }: { fireflyEmbedded: FireflyEmbeddedToolbarContext }) {
  useTheme();
  useGlobalSelectWheel();
  useBackNavigationGuard();
  usePageZoom();
  usePointerFocusHandoff();
  const { historyNotice, clearHistoryNotice } = useGlobalHistory();
  useClipPanelSync();
  useMIDIRuntime();
  useLiveInputFeedbackCoordinator();

  const audioOutputDeviceId = useUiSettingsStore((state) => state.audioOutputDeviceId);
  const audioLatencyHint = useUiSettingsStore((state) => state.audioLatencyHint);
  useEffect(() => {
    audioRoutingManager.setLatencyHint(audioLatencyHint);
    void audioRoutingManager.setOutputDevice(audioOutputDeviceId);
  }, [audioLatencyHint, audioOutputDeviceId]);

  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', preventBrowserContextMenu, { capture: true });
    return () => document.removeEventListener('contextmenu', preventBrowserContextMenu, { capture: true });
  }, []);

  return (
    <FireflyEmbeddingProvider value={fireflyEmbedded}>
      <div className="app app--editor-layout app--toolbar-visible">
        <Toolbar fireflyEmbedded={fireflyEmbedded} />
        <DockContainer />
        <FireflyGeneratedMediaBridge />
        <GuidedActionOverlay />
        <ShortcutDisplayOverlay />
        <ProjectLoadProgressOverlay />
        <HistoryActionToast notice={historyNotice} onDone={clearHistoryNotice} />
        <FireflyShortcutOnboardingGate user={fireflyEmbedded.user} />
      </div>
    </FireflyEmbeddingProvider>
  );
}
