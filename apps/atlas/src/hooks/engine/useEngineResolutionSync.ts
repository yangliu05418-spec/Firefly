import { useEffect } from 'react';
import { Logger } from '../../services/logger';
import { renderHostPort } from '../../services/render/renderHostPort';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { PreviewQuality } from '../../stores/settingsStore';
import { resolvePreviewRenderResolution } from '../../components/preview/previewResolution';

const log = Logger.create('Engine');

function getEngineResolutionConfig(): {
  baseWidth: number;
  baseHeight: number;
  previewQuality: PreviewQuality;
} {
  const { previewQuality } = useSettingsStore.getState();
  const { activeCompositionId, compositions } = useMediaStore.getState();

  if (activeCompositionId) {
    const activeComp = compositions.find(c => c.id === activeCompositionId);
    if (activeComp) {
      return {
        baseWidth: activeComp.width,
        baseHeight: activeComp.height,
        previewQuality,
      };
    }
  }

  const { outputResolution } = useSettingsStore.getState();
  return {
    baseWidth: outputResolution.width,
    baseHeight: outputResolution.height,
    previewQuality,
  };
}

export function useEngineResolutionSync(isEngineReady: boolean): void {
  useEffect(() => {
    if (!isEngineReady) return;

    const updateResolution = () => {
      const { baseWidth, baseHeight, previewQuality } = getEngineResolutionConfig();
      const { width: scaledWidth, height: scaledHeight } = resolvePreviewRenderResolution(
        { width: baseWidth, height: baseHeight },
        previewQuality,
      );

      renderHostPort.setResolution(scaledWidth, scaledHeight);
      log.info(`Resolution set to ${scaledWidth}\u00d7${scaledHeight} (${previewQuality * 100}% of ${baseWidth}\u00d7${baseHeight})`);
    };

    updateResolution();

    const unsubscribeActiveComp = useMediaStore.subscribe(
      (state) => state.activeCompositionId,
      () => updateResolution()
    );

    const unsubscribeCompositions = useMediaStore.subscribe(
      (state) => state.compositions,
      () => updateResolution()
    );

    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => state.previewQuality,
      () => updateResolution()
    );

    return () => {
      unsubscribeActiveComp();
      unsubscribeCompositions();
      unsubscribeSettings();
    };
  }, [isEngineReady]);
}
