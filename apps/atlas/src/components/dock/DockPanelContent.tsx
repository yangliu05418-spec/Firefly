// Maps panel type to actual component
// Note: Effects, Transcript, Analysis are now integrated into PropertiesPanel

import { lazy, Suspense } from 'react';
import type { DockPanel, PreviewPanelData, MultiPreviewPanelData } from '../../types/dock';
import { Preview } from '../preview/Preview';
import { PropertiesPanel } from '../panels/properties';
import { MediaPanel } from '../panels/MediaPanel';
import { Timeline } from '../timeline/Timeline';
import { normalizePreviewPanelSource } from '../../utils/previewPanelSource';
import { importAudioMixerPanel } from '../panels/audio-mixer/audioMixerPanelLoader';

// Lazy-loaded panels: only loaded when the user opens them
// This keeps the initial bundle small by deferring export pipeline,
// AI services and export code
const ExportPanel = lazy(() => import('../export/ExportPanel').then(m => ({ default: m.ExportPanel })));
const AudioMixerPanel = lazy(importAudioMixerPanel);
const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const NodeWorkspacePanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/nodes/NodeWorkspacePanel').then(m => ({ default: m.NodeWorkspacePanel })));
const MIDIMappingPanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/MIDIMappingPanel').then(m => ({ default: m.MIDIMappingPanel })));
const TransitionsPanel = lazy(() => import('../panels/TransitionsPanel').then(m => ({ default: m.TransitionsPanel })));
const SAM2Panel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/SAM2Panel').then(m => ({ default: m.SAM2Panel })));
const SceneDescriptionPanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/SceneDescriptionPanel').then(m => ({ default: m.SceneDescriptionPanel })));
const WaveformPanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/scopes/WaveformPanel').then(m => ({ default: m.WaveformPanel })));
const HistogramPanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/scopes/HistogramPanel').then(m => ({ default: m.HistogramPanel })));
const VectorscopePanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/scopes/VectorscopePanel').then(m => ({ default: m.VectorscopePanel })));
const MultiPreviewPanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../preview/MultiPreviewPanel').then(m => ({ default: m.MultiPreviewPanel })));
const HistoryPanel = lazy(() => import('../panels/HistoryPanel').then(m => ({ default: m.HistoryPanel })));
const CapturePanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../panels/capture/CapturePanel').then(m => ({ default: m.CapturePanel })));
const LandingPanel = IS_FIREFLY_VARIANT ? null : lazy(() => import('../../marketing/LandingPanel').then(m => ({ default: m.LandingPanel })));
const OriginalAtlasAgentPanel = IS_FIREFLY_VARIANT ? lazy(() => import('../../firefly/OriginalAtlasAgentPanel')) : null;

const DEFAULT_MULTI_PREVIEW_DATA: MultiPreviewPanelData = {
  sourceCompositionId: null,
  slots: [{ compositionId: null }, { compositionId: null }, { compositionId: null }, { compositionId: null }],
  showTransparencyGrid: false,
};

function PanelLoading() {
  return <div className="flex items-center justify-center h-full text-gray-500 text-sm">正在加载…</div>;
}

function UnavailablePanel() {
  return <div className="panel-placeholder">此功能未在 Firefly Atlas 中开放</div>;
}

interface DockPanelContentProps {
  panel: DockPanel;
}

export function DockPanelContent({ panel }: DockPanelContentProps) {
  switch (panel.type) {
    case 'start':
      if (OriginalAtlasAgentPanel) {
        return <Suspense fallback={<PanelLoading />}><OriginalAtlasAgentPanel /></Suspense>;
      }
      return LandingPanel ? <Suspense fallback={<PanelLoading />}><LandingPanel /></Suspense> : <UnavailablePanel />;
    case 'preview': {
      const previewData = panel.data as PreviewPanelData | undefined;
      return (
        <Preview
          panelId={panel.id}
          source={normalizePreviewPanelSource(previewData)}
          showTransparencyGrid={previewData?.showTransparencyGrid ?? false}
          initialEdit={previewData}
        />
      );
    }
    case 'multi-preview': {
      const mpData = (panel.data as MultiPreviewPanelData | undefined) ?? DEFAULT_MULTI_PREVIEW_DATA;
      return MultiPreviewPanel ? <Suspense fallback={<PanelLoading />}><MultiPreviewPanel panelId={panel.id} data={mpData} /></Suspense> : <UnavailablePanel />;
    }
    case 'export':
      return <Suspense fallback={<PanelLoading />}><ExportPanel /></Suspense>;
    case 'clip-properties':
      return <PropertiesPanel />;
    case 'audio-mixer':
      return <Suspense fallback={<PanelLoading />}><AudioMixerPanel /></Suspense>;
    case 'node-workspace':
      return NodeWorkspacePanel ? <Suspense fallback={<PanelLoading />}><NodeWorkspacePanel /></Suspense> : <UnavailablePanel />;
    case 'timeline':
      return <Timeline />;
    case 'media':
      return <MediaPanel />;
    case 'history':
      return <Suspense fallback={<PanelLoading />}><HistoryPanel /></Suspense>;
    case 'midi-mapping':
      return MIDIMappingPanel ? <Suspense fallback={<PanelLoading />}><MIDIMappingPanel /></Suspense> : <UnavailablePanel />;
    case 'capture':
      return CapturePanel ? <Suspense fallback={<PanelLoading />}><CapturePanel /></Suspense> : <UnavailablePanel />;
    case 'ai-segment':
      return SAM2Panel ? <Suspense fallback={<PanelLoading />}><SAM2Panel /></Suspense> : <UnavailablePanel />;
    case 'transitions':
      return <Suspense fallback={<PanelLoading />}><TransitionsPanel /></Suspense>;
    case 'atlas-agent':
      return OriginalAtlasAgentPanel ? <Suspense fallback={<PanelLoading />}><OriginalAtlasAgentPanel /></Suspense> : <UnavailablePanel />;
    case 'scene-description':
      return SceneDescriptionPanel ? <Suspense fallback={<PanelLoading />}><SceneDescriptionPanel /></Suspense> : <UnavailablePanel />;
    case 'scope-waveform':
      return WaveformPanel ? <Suspense fallback={<PanelLoading />}><WaveformPanel /></Suspense> : <UnavailablePanel />;
    case 'scope-histogram':
      return HistogramPanel ? <Suspense fallback={<PanelLoading />}><HistogramPanel /></Suspense> : <UnavailablePanel />;
    case 'scope-vectorscope':
      return VectorscopePanel ? <Suspense fallback={<PanelLoading />}><VectorscopePanel /></Suspense> : <UnavailablePanel />;
    default:
      return <div className="panel-placeholder">Unknown panel: {panel.type}</div>;
  }
}
