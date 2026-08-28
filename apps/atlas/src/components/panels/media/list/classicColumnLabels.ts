import type { MediaClassicColumnId } from './types';
import { originalUi } from '../../../../firefly/i18n/originalUi';

export const MEDIA_CLASSIC_COLUMN_LABELS: Record<MediaClassicColumnId, string> = {
  label: '\u25cf',
  name: originalUi('original.mediaName', 'Name'),
  badges: originalUi('original.mediaStatus', 'Status'),
  duration: originalUi('original.mediaDuration', 'Duration'),
  resolution: originalUi('original.mediaResolution', 'Resolution'),
  fps: 'FPS',
  container: originalUi('original.mediaContainer', 'Container'),
  codec: originalUi('original.mediaCodec', 'Codec'),
  audio: originalUi('original.mediaAudio', 'Audio'),
  bitrate: originalUi('original.mediaBitrate', 'Bitrate'),
  size: originalUi('original.mediaSize', 'Size'),
};
