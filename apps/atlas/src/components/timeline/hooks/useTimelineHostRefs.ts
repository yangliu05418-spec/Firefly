import { useRef } from 'react';

export function useTimelineHostRefs() {
  return {
    playheadRef: useRef<HTMLDivElement>(null),
    scrollWrapperRef: useRef<HTMLDivElement>(null),
    timelineBodyRef: useRef<HTMLDivElement>(null),
    timelineRef: useRef<HTMLDivElement>(null),
    trackLanesRef: useRef<HTMLDivElement>(null),
  };
}
