import type { FlexEqBrowserPresetView } from './controlTypes';

interface PresetBrowserPanelProps {
  compact: boolean;
  disabled: boolean;
  presetQuery: string;
  presetTagFilter: string;
  presetFilter: 'all' | 'favorites' | 'user';
  presetTags: readonly string[];
  filteredPresets: readonly FlexEqBrowserPresetView[];
  setPresetQuery: (value: string) => void;
  setPresetTagFilter: (value: string) => void;
  setPresetFilter: (value: 'all' | 'favorites' | 'user') => void;
  saveCurrentUserPreset: () => void;
  applyBrowserPreset: (presetId: string) => void;
  toggleBrowserPresetFavorite: (presetId: string) => void;
  deleteBrowserPreset: (preset: FlexEqBrowserPresetView) => void;
}

export function PresetBrowserPanel({
  compact,
  disabled,
  presetQuery,
  presetTagFilter,
  presetFilter,
  presetTags,
  filteredPresets,
  setPresetQuery,
  setPresetTagFilter,
  setPresetFilter,
  saveCurrentUserPreset,
  applyBrowserPreset,
  toggleBrowserPresetFavorite,
  deleteBrowserPreset,
}: PresetBrowserPanelProps) {
  return (
    <div className="flex-eq-preset-browser">
      <div className="flex-eq-preset-tools">
        <input
          value={presetQuery}
          disabled={disabled}
          aria-label="Search EQ presets"
          placeholder="Search presets"
          onChange={(event) => setPresetQuery(event.currentTarget.value)}
        />
        <select
          value={presetTagFilter}
          disabled={disabled}
          aria-label="Preset tag filter"
          onChange={(event) => setPresetTagFilter(event.currentTarget.value)}
        >
          <option value="">Tags</option>
          {presetTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <div className="flex-eq-preset-filter" role="group" aria-label="Preset filter">
          {(['all', 'favorites', 'user'] as const).map(filter => (
            <button key={filter} type="button" className={presetFilter === filter ? 'active' : ''} disabled={disabled} onClick={() => setPresetFilter(filter)}>
              {filter === 'all' ? 'All' : filter === 'favorites' ? 'Fav' : 'User'}
            </button>
          ))}
        </div>
        <button type="button" disabled={disabled} onClick={saveCurrentUserPreset}>Save</button>
      </div>
      <div className="flex-eq-preset-list" role="list" aria-label="EQ presets">
        {filteredPresets.slice(0, compact ? 6 : 10).map(preset => (
          <div key={`${preset.source}:${preset.id}`} className="flex-eq-preset-pill" role="listitem">
            <button type="button" className="flex-eq-preset-main" disabled={disabled} onClick={() => applyBrowserPreset(preset.id)}>
              <span>{preset.name}</span>
              <small>{preset.tags.slice(0, 2).join(' / ') || preset.source}</small>
            </button>
            <button type="button" className={preset.favorite ? 'active' : ''} disabled={disabled} aria-label={`Favorite ${preset.name}`} onClick={() => toggleBrowserPresetFavorite(preset.id)}>
              Fav
            </button>
            {preset.source === 'user' && (
              <button type="button" disabled={disabled} aria-label={`Delete ${preset.name}`} onClick={() => deleteBrowserPreset(preset)}>
                x
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
