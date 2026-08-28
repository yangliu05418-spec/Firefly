import type { PanelType } from '../../types/dock';
import type { MessageKey } from './keys';
import { translate } from './index';

const PANEL_MESSAGE_KEYS: Record<PanelType, MessageKey> = {
  start: 'panel.start',
  preview: 'panel.preview',
  'multi-preview': 'panel.multiPreview',
  timeline: 'panel.timeline',
  'clip-properties': 'panel.properties',
  history: 'panel.history',
  'audio-mixer': 'panel.audioMixer',
  'node-workspace': 'panel.nodes',
  media: 'panel.media',
  export: 'panel.export',
  'midi-mapping': 'panel.midiMapping',
  capture: 'panel.capture',
  transitions: 'panel.transitions',
  'atlas-agent': 'panel.atlasAgent',
  'ai-segment': 'panel.aiSegment',
  'scene-description': 'panel.sceneDescription',
  'scope-waveform': 'panel.waveform',
  'scope-histogram': 'panel.histogram',
  'scope-vectorscope': 'panel.vectorscope',
};

export const localizePanelTitle = (type: PanelType, fallback: string): string =>
  import.meta.env.VITE_APP_VARIANT === 'firefly'
    ? translate('zh-CN', PANEL_MESSAGE_KEYS[type])
    : fallback;

export { PANEL_MESSAGE_KEYS };
