import { useEffect, useMemo, useState } from 'react';

import type { TimelineRulerCacheRange } from '../types';

type TimelineCacheRangeSource = () => Array<{ start: number; end: number }>;

interface UseTimelineRulerCacheRangesProps {
  proxyEnabled: boolean;
  getProxyCachedRanges: TimelineCacheRangeSource;
  getScrubCachedRanges: TimelineCacheRangeSource;
}

export function useTimelineRulerCacheRanges({
  proxyEnabled,
  getProxyCachedRanges,
  getScrubCachedRanges,
}: UseTimelineRulerCacheRangesProps): TimelineRulerCacheRange[] {
  const [scrubCacheRevision, setScrubCacheRevision] = useState(0);

  useEffect(() => {
    const handleScrubCacheUpdated = () => {
      setScrubCacheRevision((revision) => (revision + 1) % 1000000);
    };

    window.addEventListener('masterselects:scrub-cache-updated', handleScrubCacheUpdated);
    return () => {
      window.removeEventListener('masterselects:scrub-cache-updated', handleScrubCacheUpdated);
    };
  }, []);

  return useMemo(() => {
    if (proxyEnabled) {
      return getProxyCachedRanges().map((range) => ({ ...range, type: 'proxy' as const }));
    }

    void scrubCacheRevision;
    return getScrubCachedRanges().map((range) => ({ ...range, type: 'cache' as const }));
  }, [getProxyCachedRanges, getScrubCachedRanges, proxyEnabled, scrubCacheRevision]);
}
