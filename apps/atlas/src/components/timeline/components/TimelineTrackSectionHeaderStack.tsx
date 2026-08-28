import type { TimelineTrackSectionRenderState } from '../utils/timelineTrackSectionRenderState';
import {
  TimelineSectionHeaders,
  type TimelineSectionHeadersProps,
} from './TimelineSectionHeaders';

type TimelineTrackSectionHeaderStackProps = Omit<
  TimelineSectionHeadersProps,
  'isVideoSection' | 'sectionCollapsed' | 'sectionPhaseClass' | 'sectionTracks'
> & {
  sectionState: TimelineTrackSectionRenderState;
};

export function TimelineTrackSectionHeaderStack({
  sectionState,
  ...headerProps
}: TimelineTrackSectionHeaderStackProps) {
  return (
    <TimelineSectionHeaders
      {...headerProps}
      isVideoSection={sectionState.isVideoSection}
      sectionCollapsed={sectionState.sectionCollapsed}
      sectionPhaseClass={sectionState.sectionPhaseClass}
      sectionTracks={sectionState.sectionTracks}
    />
  );
}
