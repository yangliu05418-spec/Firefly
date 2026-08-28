import { useMemo, useState } from 'react';

import {
  getAudioEqFactoryPresets,
  type AudioEqPreset,
} from '../../../../engine/audio/eq/AudioEqPresets';
import type { AudioEqParamsV2 } from '../../../../engine/audio/eq/AudioEqTypes';
import {
  createAndSaveAudioEqUserPreset,
  deleteAudioEqUserPreset,
  loadAudioEqPresetFavoriteIds,
  loadAudioEqUserPresets,
  toggleAudioEqPresetFavoriteId,
} from '../../../../services/audio/audioEqPresetStorage';
import type { FlexEqBrowserPresetView } from './controlTypes';

const FACTORY_PRESETS = getAudioEqFactoryPresets();

export type FlexEqPresetFilter = 'all' | 'favorites' | 'user';

export interface FlexEqBrowserPreset extends AudioEqPreset {
  source: 'factory' | 'user';
}

export function useFlexEqualizerPresetBrowser(
  normalized: AudioEqParamsV2,
  disabled: boolean,
) {
  const [userPresets, setUserPresets] = useState<AudioEqPreset[]>(() => loadAudioEqUserPresets());
  const [favoritePresetIds, setFavoritePresetIds] = useState<string[]>(() => loadAudioEqPresetFavoriteIds());
  const [presetQuery, setPresetQuery] = useState('');
  const [presetTagFilter, setPresetTagFilter] = useState('');
  const [presetFilter, setPresetFilter] = useState<FlexEqPresetFilter>('all');
  const [showPresetBrowser, setShowPresetBrowser] = useState(false);

  const browserPresets = useMemo<FlexEqBrowserPreset[]>(() => {
    const favorites = new Set(favoritePresetIds);
    return [
      ...FACTORY_PRESETS.map(preset => ({
        ...preset,
        source: 'factory' as const,
        favorite: preset.favorite || favorites.has(preset.id),
      })),
      ...userPresets.map(preset => ({
        ...preset,
        source: 'user' as const,
        favorite: preset.favorite || favorites.has(preset.id),
      })),
    ];
  }, [favoritePresetIds, userPresets]);

  const presetTags = useMemo(() => {
    const tags = new Set<string>();
    for (const preset of browserPresets) {
      for (const tag of preset.tags) tags.add(tag);
    }
    return [...tags].toSorted((a, b) => a.localeCompare(b));
  }, [browserPresets]);

  const filteredPresets = useMemo(() => {
    const query = presetQuery.trim().toLowerCase();
    return browserPresets.filter((preset) => {
      if (presetFilter === 'favorites' && !preset.favorite) return false;
      if (presetFilter === 'user' && preset.source !== 'user') return false;
      if (presetTagFilter && !preset.tags.includes(presetTagFilter)) return false;
      if (!query) return true;
      return preset.name.toLowerCase().includes(query) ||
        preset.tags.some(tag => tag.toLowerCase().includes(query));
    });
  }, [browserPresets, presetFilter, presetQuery, presetTagFilter]);

  const saveCurrentUserPreset = () => {
    if (disabled) return;
    const fallbackName = `EQ ${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt?.('Preset name', fallbackName)?.trim();
    if (!name) return;
    const tags = [
      normalized.audible.presetKind,
      normalized.audible.characterMode !== 'clean' ? normalized.audible.characterMode : undefined,
      normalized.audible.bands.some(band => band.dynamic?.enabled) ? 'dynamic' : undefined,
      normalized.audible.bands.some(band => band.spectralDynamics?.enabled) ? 'spectral' : undefined,
    ].filter((tag): tag is string => Boolean(tag));
    setUserPresets(createAndSaveAudioEqUserPreset({
      name,
      tags,
      params: normalized,
      favorite: false,
    }));
  };

  const deleteBrowserPreset = (preset: FlexEqBrowserPresetView) => {
    if (disabled || preset.source !== 'user') return;
    setUserPresets(deleteAudioEqUserPreset(preset.id));
  };

  const toggleBrowserPresetFavorite = (presetId: string) => {
    if (disabled) return;
    setFavoritePresetIds(toggleAudioEqPresetFavoriteId(presetId));
  };

  return {
    browserPresets,
    deleteBrowserPreset,
    filteredPresets,
    presetFilter,
    presetQuery,
    presetTagFilter,
    presetTags,
    saveCurrentUserPreset,
    setPresetFilter,
    setPresetQuery,
    setPresetTagFilter,
    setShowPresetBrowser,
    showPresetBrowser,
    toggleBrowserPresetFavorite,
  };
}
