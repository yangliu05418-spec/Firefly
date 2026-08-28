import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineToolId } from '../../../stores/timeline/types';
import type { TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';
import { runTimelinePlacementCommand } from '../../../services/timelinePlacementCommands';
import { TIMELINE_TOOL_DEFINITION_BY_ID } from './registry';

const PLACEMENT_COMMAND_TOOL_IDS = new Set<TimelineToolId>([
  'insert',
  'overwrite',
  'replace',
  'fit-to-fill',
  'append-at-end',
  'place-on-top',
  'ripple-overwrite',
]);

function isPlacementCommandToolId(toolId: TimelineToolId): toolId is TimelinePlacementMode {
  return PLACEMENT_COMMAND_TOOL_IDS.has(toolId);
}

export function runTimelineToolCommand(toolId: TimelineToolId): boolean {
  const definition = TIMELINE_TOOL_DEFINITION_BY_ID[toolId];
  if (!definition || definition.kind !== 'command') return false;

  const timeline = useTimelineStore.getState();
  if (timeline.isExporting && definition.mutatesTimeline) return true;

  if (toolId === 'split-at-playhead') {
    timeline.splitClipAtPlayhead();
  } else if (toolId === 'split-all-at-playhead') {
    timeline.splitAllClipsAtTime(timeline.playheadPosition);
  } else if (toolId === 'ripple-delete') {
    timeline.rippleDeleteSelection();
  } else if (toolId === 'delete-gap') {
    timeline.deleteGapAtTime(timeline.playheadPosition);
  } else if (toolId === 'trim-start-to-playhead') {
    timeline.trimSelectedClipEdgeToPlayhead('start');
  } else if (toolId === 'trim-end-to-playhead') {
    timeline.trimSelectedClipEdgeToPlayhead('end');
  } else if (toolId === 'ripple-trim-start-to-playhead') {
    timeline.rippleTrimSelectedClipEdgeToPlayhead('start');
  } else if (toolId === 'ripple-trim-end-to-playhead') {
    timeline.rippleTrimSelectedClipEdgeToPlayhead('end');
  } else if (toolId === 'lift-range') {
    timeline.liftTimelineRange();
  } else if (toolId === 'extract-range') {
    timeline.extractTimelineRange();
  } else if (toolId === 'marker') {
    timeline.addMarker(timeline.playheadPosition);
  } else if (toolId === 'in-point') {
    timeline.setInPointAtPlayhead();
  } else if (toolId === 'out-point') {
    timeline.setOutPointAtPlayhead();
  } else if (isPlacementCommandToolId(toolId)) {
    void runTimelinePlacementCommand(toolId);
  } else {
    return false;
  }

  return true;
}
