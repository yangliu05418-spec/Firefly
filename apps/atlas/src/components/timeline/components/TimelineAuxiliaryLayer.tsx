import type { ComponentProps } from 'react';
import { MarkerContextMenu } from '../MarkerContextMenu';
import { MulticamDialog } from '../MulticamDialog';
import { PickWhipCables } from './PickWhipCables';
import { TimelineContextMenu } from '../TimelineContextMenu';
import { TimelineEmptyContextMenu } from '../TimelineEmptyContextMenu';
import { TrackContextMenu } from '../TrackContextMenu';
import { InOutContextMenu } from '../InOutContextMenu';

export interface TimelineAuxiliaryLayerProps {
  emptyContextMenuProps: ComponentProps<typeof TimelineEmptyContextMenu>;
  inOutContextMenuProps: ComponentProps<typeof InOutContextMenu>;
  markerContextMenuProps: ComponentProps<typeof MarkerContextMenu>;
  multicamDialogProps: ComponentProps<typeof MulticamDialog>;
  pickWhipProps: ComponentProps<typeof PickWhipCables>;
  timelineContextMenuProps: ComponentProps<typeof TimelineContextMenu>;
  trackContextMenuProps: ComponentProps<typeof TrackContextMenu>;
}

export function TimelineAuxiliaryLayer({
  emptyContextMenuProps,
  inOutContextMenuProps,
  markerContextMenuProps,
  multicamDialogProps,
  pickWhipProps,
  timelineContextMenuProps,
  trackContextMenuProps,
}: TimelineAuxiliaryLayerProps) {
  return (
    <>
      <PickWhipCables {...pickWhipProps} />
      <TimelineContextMenu {...timelineContextMenuProps} />
      <TimelineEmptyContextMenu {...emptyContextMenuProps} />
      <TrackContextMenu {...trackContextMenuProps} />
      <MarkerContextMenu {...markerContextMenuProps} />
      <InOutContextMenu {...inOutContextMenuProps} />
      <MulticamDialog {...multicamDialogProps} />
    </>
  );
}
