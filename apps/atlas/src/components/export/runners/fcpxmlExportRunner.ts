import { downloadFCPXML } from '../../../services/export/fcpxmlExport';
import type { Composition } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';

export interface FcpxmlExportRunnerInput {
  getActiveComposition: () => Composition | undefined;
  filename: string;
  fps: number;
  width: number;
  height: number;
  includeAudio: boolean;
}

export function runFcpxmlExport(input: FcpxmlExportRunnerInput): void {
  const { clips, tracks, duration: timelineDuration } = useTimelineStore.getState();
  const activeComp = input.getActiveComposition();

  downloadFCPXML(clips, tracks, timelineDuration, {
    projectName: activeComp?.name || input.filename || 'MasterSelects Export',
    frameRate: activeComp?.frameRate || input.fps,
    width: activeComp?.width || input.width,
    height: activeComp?.height || input.height,
    includeAudio: input.includeAudio,
  });
}
