import type {
  SpectralImageLayer,
  SpectralImageLayerKeyframe,
} from '../../../../types/audio';
import type { MediaFile } from '../../../../stores/mediaStore/types';
import {
  formatFrequency,
  formatSeconds,
  SPECTRAL_LAYER_BLEND_MODES,
} from './audioEditStackHelpers';

interface SpectralLayerSectionProps {
  activeSpectralLayerCount: number;
  imageFilesById: Map<string, MediaFile>;
  spectralLayers: SpectralImageLayer[];
  onAddSpectralLayerKeyframe: (layer: SpectralImageLayer) => void;
  onRemoveSpectralLayer: (layerId: string) => void;
  onRemoveSpectralLayerKeyframe: (layer: SpectralImageLayer, keyframeId: string) => void;
  onToggleSpectralLayer: (layer: SpectralImageLayer) => void;
  onUpdateSpectralLayer: (layerId: string, patch: Partial<SpectralImageLayer>) => void;
  onUpdateSpectralLayerKeyframe: (
    layer: SpectralImageLayer,
    keyframeId: string,
    patch: Partial<SpectralImageLayerKeyframe>,
  ) => void;
}

export function SpectralLayerSection({
  activeSpectralLayerCount,
  imageFilesById,
  spectralLayers,
  onAddSpectralLayerKeyframe,
  onRemoveSpectralLayer,
  onRemoveSpectralLayerKeyframe,
  onToggleSpectralLayer,
  onUpdateSpectralLayer,
  onUpdateSpectralLayerKeyframe,
}: SpectralLayerSectionProps) {
  if (spectralLayers.length === 0) return null;

  return (
    <div className="audio-spectral-layer-section">
      <div className="audio-spectral-layer-section-header">
        <h4>Image-In-Spectrum Layers</h4>
        <span>{activeSpectralLayerCount} active</span>
      </div>
      <div className="audio-spectral-layer-list">
        {spectralLayers.map((layer) => {
          const imageFile = imageFilesById.get(layer.imageMediaFileId);
          return (
            <div key={layer.id} className={`audio-spectral-layer-card ${layer.enabled === false ? 'bypassed' : ''}`}>
              <div className="audio-spectral-layer-preview">
                {imageFile?.thumbnailUrl || imageFile?.url ? (
                  <img src={imageFile.thumbnailUrl || imageFile.url} alt="" />
                ) : (
                  <span>IMG</span>
                )}
              </div>
              <div className="audio-spectral-layer-main">
                <div className="audio-spectral-layer-title">
                  <strong>{imageFile?.name ?? layer.imageMediaFileId}</strong>
                  <span>{formatSeconds(layer.timeStart)} + {formatSeconds(layer.duration)}</span>
                </div>
                <div className="audio-spectral-layer-meta">
                  {formatFrequency(layer.frequencyMin)} - {formatFrequency(layer.frequencyMax)}
                  {layer.keyframes?.length ? ` | ${layer.keyframes.length} keyframes` : ''}
                </div>
                <div className="audio-spectral-layer-controls">
                  <label>
                    <span>Mode</span>
                    <select
                      value={layer.blendMode}
                      onChange={(event) => onUpdateSpectralLayer(layer.id, {
                        blendMode: event.currentTarget.value as SpectralImageLayer['blendMode'],
                      })}
                    >
                      {SPECTRAL_LAYER_BLEND_MODES.map(mode => (
                        <option key={mode} value={mode}>{mode}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Opacity</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={layer.opacity}
                      onChange={(event) => onUpdateSpectralLayer(layer.id, { opacity: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    <span>Gain</span>
                    <input
                      type="number"
                      min="-60"
                      max="24"
                      step="0.5"
                      value={layer.gainDb}
                      onChange={(event) => onUpdateSpectralLayer(layer.id, { gainDb: Number(event.currentTarget.value) })}
                    />
                  </label>
                </div>
                <div className="audio-spectral-layer-keyframes">
                  <div className="audio-spectral-layer-keyframe-header">
                    <span>Layer Keyframes</span>
                    <button className="btn btn-sm" onClick={() => onAddSpectralLayerKeyframe(layer)}>
                      Add at Playhead
                    </button>
                  </div>
                  {layer.keyframes?.length ? (
                    <div className="audio-spectral-layer-keyframe-list">
                      {layer.keyframes.map(keyframe => (
                        <div key={keyframe.id} className="audio-spectral-layer-keyframe-row">
                          <SpectralLayerKeyframeFields
                            keyframe={keyframe}
                            layer={layer}
                            onRemove={() => onRemoveSpectralLayerKeyframe(layer, keyframe.id)}
                            onUpdate={(patch) => onUpdateSpectralLayerKeyframe(layer, keyframe.id, patch)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="audio-spectral-layer-keyframe-empty">No layer automation</span>
                  )}
                </div>
              </div>
              <div className="audio-spectral-layer-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => onToggleSpectralLayer(layer)}
                >
                  {layer.enabled === false ? 'Enable' : 'Bypass'}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => onRemoveSpectralLayer(layer.id)}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SpectralLayerKeyframeFieldsProps {
  keyframe: SpectralImageLayerKeyframe;
  layer: SpectralImageLayer;
  onRemove: () => void;
  onUpdate: (patch: Partial<SpectralImageLayerKeyframe>) => void;
}

function SpectralLayerKeyframeFields({
  keyframe,
  layer,
  onRemove,
  onUpdate,
}: SpectralLayerKeyframeFieldsProps) {
  return (
    <>
      <label>
        <span>Time</span>
        <input
          type="number"
          min="0"
          max={layer.duration}
          step="0.01"
          value={keyframe.time}
          onChange={(event) => onUpdate({ time: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        <span>Opacity</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={keyframe.opacity ?? layer.opacity}
          onChange={(event) => onUpdate({ opacity: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        <span>Gain</span>
        <input
          type="number"
          min="-60"
          max="24"
          step="0.5"
          value={keyframe.gainDb ?? layer.gainDb}
          onChange={(event) => onUpdate({ gainDb: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        <span>Min Hz</span>
        <input
          type="number"
          min="0"
          step="10"
          value={keyframe.frequencyMin ?? layer.frequencyMin}
          onChange={(event) => onUpdate({ frequencyMin: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        <span>Max Hz</span>
        <input
          type="number"
          min="0"
          step="10"
          value={keyframe.frequencyMax ?? layer.frequencyMax}
          onChange={(event) => onUpdate({ frequencyMax: Number(event.currentTarget.value) })}
        />
      </label>
      <button className="btn btn-sm btn-danger" onClick={onRemove}>
        Remove
      </button>
    </>
  );
}
