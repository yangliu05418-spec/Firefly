// Source monitor placement command bar — presentational buttons that preview
// timeline placement commands on hover/focus and run them via the entry callback.

import {
  clearTimelinePlacementCommandPreview,
  showTimelinePlacementCommandPreview,
} from '../../../services/timelinePlacementCommands';
import type { TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';
import { TIMELINE_TOOL_ICONS } from '../../timeline/tools/toolIcons';

const SOURCE_MONITOR_PLACEMENT_COMMANDS: Array<{
  mode: TimelinePlacementMode;
  label: string;
  title: string;
}> = [
  { mode: 'insert', label: 'Insert', title: 'Insert source at playhead' },
  { mode: 'overwrite', label: 'Overwrite', title: 'Overwrite at playhead' },
  { mode: 'replace', label: 'Replace', title: 'Replace selected clip or range' },
  { mode: 'fit-to-fill', label: 'Fit', title: 'Fit source to selected clip or range' },
  { mode: 'append-at-end', label: 'Append', title: 'Append source at track end' },
  { mode: 'place-on-top', label: 'Top', title: 'Place source on top track' },
  { mode: 'ripple-overwrite', label: 'Ripple Overwrite', title: 'Ripple overwrite selected range' },
];

interface SourceMonitorPlacementCommandsProps {
  pendingPlacementMode: TimelinePlacementMode | null;
  onRunCommand: (mode: TimelinePlacementMode) => void;
}

export function SourceMonitorPlacementCommands({
  pendingPlacementMode,
  onRunCommand,
}: SourceMonitorPlacementCommandsProps) {
  return (
    <div className="source-monitor-edit-commands" aria-label="Source edit commands">
      {SOURCE_MONITOR_PLACEMENT_COMMANDS.map((command) => {
        const CommandIcon = TIMELINE_TOOL_ICONS[command.mode];
        return (
          <button
            key={command.mode}
            className={`btn btn-sm source-monitor-icon-btn source-monitor-command-btn ${pendingPlacementMode === command.mode ? 'btn-active' : ''}`}
            onClick={() => onRunCommand(command.mode)}
            onMouseEnter={() => showTimelinePlacementCommandPreview(command.mode)}
            onMouseLeave={() => clearTimelinePlacementCommandPreview(command.mode)}
            onFocus={() => showTimelinePlacementCommandPreview(command.mode)}
            onBlur={() => clearTimelinePlacementCommandPreview(command.mode)}
            disabled={pendingPlacementMode !== null}
            title={command.title}
            aria-label={command.label}
          >
            <CommandIcon size={14} stroke={2.2} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
