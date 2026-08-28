import type { CompositionVideoBakeOverlayRegion } from '../utils/timelineHostTypes';

interface TimelineCompositionVideoBakeRegionsProps {
  bakeRegionHeight: number;
  duration: number;
  formatTime: (time: number) => string;
  onBakeRegion: (regionId: string) => void;
  onRemoveRegion: (regionId: string) => void;
  onUnbakeRegion: (regionId: string) => void;
  regions: CompositionVideoBakeOverlayRegion[];
  timeToPixel: (time: number) => number;
}

export function TimelineCompositionVideoBakeRegions({
  bakeRegionHeight,
  duration,
  formatTime,
  onBakeRegion,
  onRemoveRegion,
  onUnbakeRegion,
  regions,
  timeToPixel,
}: TimelineCompositionVideoBakeRegionsProps) {
  if (regions.length === 0) return null;

  const layerHeight = Math.max(1, bakeRegionHeight);

  return (
    <div className="timeline-video-bake-region-layer" style={{ height: layerHeight }}>
      {regions.map((region) => {
        const start = Math.max(0, Math.min(duration, Math.min(region.startTime, region.endTime)));
        const end = Math.max(start, Math.min(duration, Math.max(region.startTime, region.endTime)));
        if (end <= start) return null;

        return (
          <div
            key={region.id}
            className={`timeline-video-bake-region status-${region.status ?? 'marked'} ${region.selection ? 'selection' : ''}`}
            style={{
              left: timeToPixel(start),
              width: Math.max(3, timeToPixel(end - start)),
              height: layerHeight,
            }}
            title={`Video bake: ${formatTime(start)} - ${formatTime(end)}${region.status === 'baking' && region.progress !== undefined ? ` (${Math.round(region.progress)}%)` : ''}`}
          >
            {region.status === 'baking' && region.progress !== undefined && (
              <div
                className="timeline-video-bake-region-progress"
                style={{ width: `${Math.max(0, Math.min(100, region.progress))}%` }}
              />
            )}
            {!region.selection && (
              <div className="timeline-video-bake-region-controls">
                <button
                  type="button"
                  className="timeline-video-bake-btn"
                  disabled={region.status === 'baking'}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (region.status === 'baked') {
                      onUnbakeRegion(region.id);
                      return;
                    }
                    onBakeRegion(region.id);
                  }}
                  title={region.status === 'baked' ? 'Unbake video region' : 'Bake video region'}
                >
                  {region.status === 'baked'
                    ? 'Unbake'
                    : region.status === 'baking'
                      ? `${Math.round(region.progress ?? 0)}%`
                      : 'Bake'}
                </button>
                <button
                  type="button"
                  className="timeline-video-bake-btn remove"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemoveRegion(region.id);
                  }}
                  title="Remove video bake region"
                >
                  x
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
