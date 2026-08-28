import { createDefaultRulerLaneState } from '../../../timeline/tempo/rulerDefaults';
import type { ProjectFile } from '../types/project.types';

export function createInitialProjectFile(
  name: string,
  now: () => Date = () => new Date(),
): ProjectFile {
  const current = now();
  const timestamp = current.toISOString();
  const mainCompId = `comp-${current.getTime()}`;

  return {
    version: 1,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
    },
    media: [],
    compositions: [{
      id: mainCompId,
      name: 'Main Comp',
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 60,
      backgroundColor: '#000000',
      folderId: null,
      tracks: [
        { id: 'track-v1', name: 'Video 1', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false },
        { id: 'track-a1', name: 'Audio 1', type: 'audio', height: 40, locked: false, visible: true, muted: false, solo: false },
      ],
      clips: [],
      markers: [],
      ...createDefaultRulerLaneState(),
    }],
    folders: [],
    activeCompositionId: mainCompId,
    openCompositionIds: [mainCompId],
    expandedFolderIds: [],
  };
}
