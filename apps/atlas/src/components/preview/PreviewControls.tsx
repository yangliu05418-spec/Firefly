// Preview top toolbar: source selector, edit mode toggle, zoom controls

import React from 'react';
import type { Composition } from '../../stores/mediaStore/types';
import { isUserVisibleComposition } from '../../stores/mediaStore/compositionVisibility';
import type { TimelineTrack } from '../../types';
import type { PreviewPanelSource } from '../../types/dock';
import {
  getCompositionVideoTracks,
  getPreviewLayerLabel,
  isSamePreviewPanelSource,
} from '../../utils/previewPanelSource';
import { originalUi } from '../../firefly/i18n/originalUi';

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const ui = (zh: string, en: string) => IS_FIREFLY_VARIANT ? zh : en;

interface PreviewControlsProps {
  // Source monitor
  sourceMonitorActive: boolean;
  sourceMonitorFileName: string | null;
  closeSourceMonitor: () => void;
  // Edit mode
  editMode: boolean;
  canEdit: boolean;
  setEditMode: (v: boolean) => void;
  showEditViewControls: boolean;
  sceneObjectOverlayEnabled: boolean;
  setSceneObjectOverlayEnabled: (v: boolean) => void;
  viewZoom: number;
  resetView: () => void;
  // Source selector
  source: PreviewPanelSource;
  sourceLabel: string;
  activeCompositionId: string | null;
  activeCompositionVideoTracks: TimelineTrack[];
  selectorOpen: boolean;
  setSelectorOpen: (v: boolean) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownStyle: React.CSSProperties;
  compositions: Composition[];
  setPanelSource: (source: PreviewPanelSource) => void;
}

export function PreviewControls({
  sourceMonitorActive,
  sourceMonitorFileName,
  closeSourceMonitor,
  editMode,
  canEdit,
  setEditMode,
  showEditViewControls,
  sceneObjectOverlayEnabled,
  setSceneObjectOverlayEnabled,
  viewZoom,
  resetView,
  source,
  sourceLabel,
  activeCompositionId,
  activeCompositionVideoTracks,
  selectorOpen,
  setSelectorOpen,
  dropdownRef,
  dropdownStyle,
  compositions,
  setPanelSource,
}: PreviewControlsProps) {
  const visibleCompositions = compositions.filter(isUserVisibleComposition);
  const renderLayerOptions = (compositionId: string | null) => {
    const videoTracks = getCompositionVideoTracks(
      compositionId,
      compositions,
      activeCompositionId,
      activeCompositionVideoTracks,
    );

    return videoTracks.map((track, layerIndex) => {
      const layerSource: PreviewPanelSource = {
        type: 'layer-index',
        compositionId,
        layerIndex,
      };

      return (
        <button
          key={`${compositionId ?? 'active'}-layer-${layerIndex}`}
          className={`preview-comp-option layer-option ${isSamePreviewPanelSource(source, layerSource) ? 'active' : ''}`}
          onClick={() => {
            setPanelSource(layerSource);
            setSelectorOpen(false);
          }}
        >
          {getPreviewLayerLabel(layerIndex, track.name)}
        </button>
      );
    });
  };

  return (
    <div className="preview-controls">
      {sourceMonitorActive ? (
        <>
          <span className="preview-source-label" title={sourceMonitorFileName ?? undefined}>
            {sourceMonitorFileName}
          </span>
          <button
            className="preview-close-source-btn"
            onClick={closeSourceMonitor}
            title={ui('关闭源监视器 [Esc]', 'Close source monitor [Esc]')}
          >
            x
          </button>
        </>
      ) : (
        <>
          <button
            className={`preview-edit-btn ${editMode ? 'active' : ''}`}
            onClick={() => canEdit && setEditMode(!editMode)}
            title={canEdit ? ui('切换编辑模式 [Tab]', 'Toggle Edit Mode [Tab]') : ui('编辑模式仅适用于完整的当前合成', 'Edit mode only works on the full active composition')}
            disabled={!canEdit}
          >
            {originalUi('original.previewEdit', 'Edit')}
          </button>
          {canEdit && (
            <button
              type="button"
              className={`preview-scene-toggle-btn ${sceneObjectOverlayEnabled ? 'active' : ''}`}
              onClick={() => setSceneObjectOverlayEnabled(!sceneObjectOverlayEnabled)}
              title={sceneObjectOverlayEnabled
                ? originalUi('original.previewHideHandles', 'Hide scene handles')
                : originalUi('original.previewShowHandles', 'Show scene handles')}
              aria-label={sceneObjectOverlayEnabled
                ? originalUi('original.previewHideHandles', 'Hide scene handles')
                : originalUi('original.previewShowHandles', 'Show scene handles')}
              aria-pressed={sceneObjectOverlayEnabled}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 8h5" />
                <path d="M8 8V3" />
                <path d="M8 8l-3.5 3.5" />
                <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
              </svg>
            </button>
          )}
          {showEditViewControls && canEdit && (
            <>
              <span className="preview-zoom-label">{Math.round(viewZoom * 100)}%</span>
              <button
                className="preview-reset-btn"
                onClick={resetView}
                title={ui('重置视图', 'Reset View')}
              >
                {ui('重置', 'Reset')}
              </button>
            </>
          )}
          <div className="preview-comp-dropdown-wrapper">
            <button
              className="preview-comp-dropdown-btn"
              onClick={() => setSelectorOpen(!selectorOpen)}
              title={ui('选择预览源', 'Select preview source')}
            >
              <span className="preview-comp-name">
                {sourceLabel === 'Active' ? originalUi('original.previewActive', 'Active') : sourceLabel}
              </span>
              <span className="preview-comp-arrow">v</span>
            </button>
            {selectorOpen && (
              <div className="preview-comp-dropdown" ref={dropdownRef} style={dropdownStyle}>
                <div className="preview-comp-group-label">{ui('动态', 'Dynamic')}</div>
                <button
                  className={`preview-comp-option ${source.type === 'activeComp' ? 'active' : ''}`}
                  onClick={() => {
                    setPanelSource({ type: 'activeComp' });
                    setSelectorOpen(false);
                  }}
                >
                  {originalUi('original.previewActive', 'Active Composition')}
                </button>
                {renderLayerOptions(null)}
                <div className="preview-comp-separator" />
                <div className="preview-comp-group-label">{ui('合成', 'Compositions')}</div>
                {visibleCompositions.map((comp) => (
                  <React.Fragment key={comp.id}>
                    <button
                      className={`preview-comp-option ${
                        source.type === 'composition' && source.compositionId === comp.id ? 'active' : ''
                      }`}
                      onClick={() => {
                        setPanelSource({ type: 'composition', compositionId: comp.id });
                        setSelectorOpen(false);
                      }}
                    >
                      {comp.name}
                    </button>
                    {renderLayerOptions(comp.id)}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
