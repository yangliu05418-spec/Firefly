import { useEffect, useState } from 'react';

type TimelineAIMarkerFeedbackAction = 'add' | 'remove';

interface TimelineAIMarkerFeedbackDetail {
  markerId: string;
  action: TimelineAIMarkerFeedbackAction;
}

export function useTimelineAIMarkerFeedback(): Map<string, TimelineAIMarkerFeedbackAction> {
  const [aiAnimatedMarkers, setAiAnimatedMarkers] =
    useState<Map<string, TimelineAIMarkerFeedbackAction>>(new Map());

  useEffect(() => {
    const handler = (event: Event) => {
      const { markerId, action } = (event as CustomEvent<TimelineAIMarkerFeedbackDetail>).detail;
      setAiAnimatedMarkers((previous) => {
        const next = new Map(previous);
        next.set(markerId, action);
        return next;
      });

      setTimeout(() => {
        setAiAnimatedMarkers((previous) => {
          const next = new Map(previous);
          next.delete(markerId);
          return next;
        });
      }, action === 'add' ? 400 : 300);
    };

    window.addEventListener('ai-marker-feedback', handler);
    return () => window.removeEventListener('ai-marker-feedback', handler);
  }, []);

  return aiAnimatedMarkers;
}
