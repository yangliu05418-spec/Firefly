import { useCallback } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';

export function useTimelineSourceMonitorDismiss() {
  return useCallback(() => {
    const { sourceMonitorFileId, setSourceMonitorFile } = useMediaStore.getState();
    if (sourceMonitorFileId) {
      setSourceMonitorFile(null);
    }
  }, []);
}
