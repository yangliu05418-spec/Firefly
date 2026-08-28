import { describe, expect, it } from 'vitest';

import {
  TIMELINE_EXTERNAL_DROP_MIME_TYPES,
  canRouteTimelineExternalDropCommandToTrack,
  planTimelineExternalDropCommand,
} from '../../src/timeline';

function planDrop(params: {
  data?: Record<string, string>;
  fileCount?: number;
  types?: string[];
}) {
  const data = params.data ?? {};
  return planTimelineExternalDropCommand({
    fileCount: params.fileCount,
    types: params.types ?? Object.keys(data),
    getData: (mimeType) => data[mimeType] ?? '',
  });
}

describe('timeline external drop command planner', () => {
  it('plans panel item drops from MIME data before falling back to files', () => {
    expect(planDrop({
      data: {
        [TIMELINE_EXTERNAL_DROP_MIME_TYPES.text]: 'text-1',
      },
      fileCount: 1,
    })).toEqual({
      kind: 'text',
      itemId: 'text-1',
      mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.text,
    });
  });

  it('plans media-panel and external-file drops as separate command kinds', () => {
    expect(planDrop({
      data: {
        [TIMELINE_EXTERNAL_DROP_MIME_TYPES.mediaFile]: 'media-1',
      },
    })).toEqual({
      kind: 'media-file',
      itemId: 'media-1',
      mimeType: TIMELINE_EXTERNAL_DROP_MIME_TYPES.mediaFile,
    });

    expect(planDrop({ fileCount: 2 })).toEqual({ kind: 'external-files' });
  });

  it('keeps visual commands off audio tracks while leaving media commands for importer validation', () => {
    const textCommand = planDrop({
      data: {
        [TIMELINE_EXTERNAL_DROP_MIME_TYPES.text]: 'text-1',
      },
    });
    const mediaCommand = planDrop({
      data: {
        [TIMELINE_EXTERNAL_DROP_MIME_TYPES.mediaFile]: 'media-1',
      },
    });
    const externalFilesCommand = planDrop({ fileCount: 1 });

    expect(canRouteTimelineExternalDropCommandToTrack(textCommand, 'video')).toBe(true);
    expect(canRouteTimelineExternalDropCommandToTrack(textCommand, 'audio')).toBe(false);
    expect(canRouteTimelineExternalDropCommandToTrack(mediaCommand, 'audio')).toBe(true);
    expect(canRouteTimelineExternalDropCommandToTrack(externalFilesCommand, 'audio')).toBe(true);
  });

  it('rejects empty command data', () => {
    const command = planDrop({
      data: {
        [TIMELINE_EXTERNAL_DROP_MIME_TYPES.solid]: '',
      },
    });

    expect(command).toEqual({ kind: 'none' });
    expect(canRouteTimelineExternalDropCommandToTrack(command, 'video')).toBe(false);
  });
});
