import { useState, type KeyboardEvent } from 'react';

import {
  normalizeVectorAnimationRenderDimension,
  type VectorAnimationClipSettings,
} from '../../../../types/vectorAnimation';
import { formatDimensionValue } from './lottieMappings';
import type { LottieSettingsUpdater, ResolutionDraft } from './lottieTabTypes';

interface UseLottieResolutionDraftArgs {
  settings: VectorAnimationClipSettings;
  metadataWidth: number | undefined;
  metadataHeight: number | undefined;
  resolutionLinked: boolean;
  updateSettings: LottieSettingsUpdater;
}

export function useLottieResolutionDraft({
  settings,
  metadataWidth,
  metadataHeight,
  resolutionLinked,
  updateSettings,
}: UseLottieResolutionDraftArgs) {
  const resolutionSourceWidth = formatDimensionValue(settings.renderWidth ?? metadataWidth);
  const resolutionSourceHeight = formatDimensionValue(settings.renderHeight ?? metadataHeight);
  const resolutionSourceKey = `${resolutionSourceWidth}:${resolutionSourceHeight}`;
  const [resolutionDraftState, setResolutionDraftState] = useState<ResolutionDraft>(() => ({
    sourceKey: resolutionSourceKey,
    width: resolutionSourceWidth,
    height: resolutionSourceHeight,
  }));
  const resolutionDraft: ResolutionDraft = resolutionDraftState.sourceKey === resolutionSourceKey
    ? resolutionDraftState
    : {
        sourceKey: resolutionSourceKey,
        width: resolutionSourceWidth,
        height: resolutionSourceHeight,
      };

  const commitRenderDimensions = (draft: Pick<ResolutionDraft, 'width' | 'height'> = resolutionDraft) => {
    const width = normalizeVectorAnimationRenderDimension(Number(draft.width));
    const height = normalizeVectorAnimationRenderDimension(Number(draft.height));
    updateSettings({ renderWidth: width, renderHeight: height });
  };

  const updateRenderDimensionDraft = (axis: 'width' | 'height', value: string) => {
    setResolutionDraftState((current) => {
      const base = current.sourceKey === resolutionSourceKey
        ? current
        : {
            sourceKey: resolutionSourceKey,
            width: resolutionSourceWidth,
            height: resolutionSourceHeight,
          };
      return resolutionLinked
        ? { ...base, width: value, height: value }
        : { ...base, [axis]: value };
    });
  };

  const handleResolutionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitRenderDimensions();
      event.currentTarget.blur();
    }
  };

  const resetRenderDimensions = () => {
    const width = formatDimensionValue(metadataWidth);
    const height = formatDimensionValue(metadataHeight);
    setResolutionDraftState({ sourceKey: `${width}:${height}`, width, height });
    updateSettings({ renderWidth: undefined, renderHeight: undefined });
  };

  return {
    resolutionDraft,
    commitRenderDimensions,
    updateRenderDimensionDraft,
    handleResolutionKeyDown,
    resetRenderDimensions,
  };
}
