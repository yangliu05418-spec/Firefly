import type { ComponentProps } from 'react';
import { buildTimelineTrackSectionRenderState } from '../utils/timelineTrackSectionRenderState';
import { TimelineTrackSectionFrame } from './TimelineTrackSectionFrame';
import { TimelineTrackSectionHeaderStack } from './TimelineTrackSectionHeaderStack';
import { TimelineTrackSectionLaneStack } from './TimelineTrackSectionLaneStack';

type TrackSectionRenderStateProps = Parameters<typeof buildTimelineTrackSectionRenderState>[0];
type TrackSectionFrameProps = ComponentProps<typeof TimelineTrackSectionFrame>;
type TrackSectionHeaderStackProps = ComponentProps<typeof TimelineTrackSectionHeaderStack>;
type TrackSectionLaneStackProps = ComponentProps<typeof TimelineTrackSectionLaneStack>;

type TrackSectionFrameStaticProps = Omit<
  TrackSectionFrameProps,
  | 'headerContent'
  | 'lanesContent'
  | 'sectionCollapsed'
  | 'sectionContextTrackHeight'
  | 'sectionHeight'
  | 'sectionKind'
  | 'sectionPhaseClass'
  | 'sectionScrollY'
  | 'sectionViewportRef'
>;

type TrackSectionHeaderStaticProps = Omit<
  TrackSectionHeaderStackProps,
  'sectionKind' | 'sectionState'
>;

type TrackSectionLaneStaticProps = Omit<
  TrackSectionLaneStackProps,
  'sectionKind' | 'sectionState'
>;

interface TimelineTrackSectionRendererProps {
  frameProps: TrackSectionFrameStaticProps;
  headerProps: TrackSectionHeaderStaticProps;
  laneProps: TrackSectionLaneStaticProps;
  renderStateProps: TrackSectionRenderStateProps;
}

export function TimelineTrackSectionRenderer({
  frameProps,
  headerProps,
  laneProps,
  renderStateProps,
}: TimelineTrackSectionRendererProps) {
  const sectionState = buildTimelineTrackSectionRenderState(renderStateProps);
  const { sectionKind } = renderStateProps;

  return (
    <TimelineTrackSectionFrame
      {...frameProps}
      headerContent={(
        <TimelineTrackSectionHeaderStack
          {...headerProps}
          sectionKind={sectionKind}
          sectionState={sectionState}
        />
      )}
      lanesContent={(
        <TimelineTrackSectionLaneStack
          {...laneProps}
          sectionKind={sectionKind}
          sectionState={sectionState}
        />
      )}
      sectionCollapsed={sectionState.sectionCollapsed}
      sectionContextTrackHeight={sectionState.sectionContextTrackHeight}
      sectionHeight={sectionState.sectionHeight}
      sectionKind={sectionKind}
      sectionPhaseClass={sectionState.sectionPhaseClass}
      sectionScrollY={sectionState.sectionScrollY}
      sectionViewportRef={sectionState.sectionViewportRef}
    />
  );
}
