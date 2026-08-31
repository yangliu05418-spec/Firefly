import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewQuality } from '../../stores/settingsStore';
import { useMediaStore } from '../../stores/mediaStore';

interface PreviewBottomControlsProps {
  previewQuality: PreviewQuality;
  setPreviewQuality: (quality: PreviewQuality) => void;
  viewZoom: number;
  setViewZoom: (zoom: number) => void;
}

const QUALITY_OPTIONS: Array<{ value: PreviewQuality; label: string; detail: string }> = [
  { value: 1, label: '原画', detail: '100%' },
  { value: 0.5, label: '清晰', detail: '50%' },
  { value: 0.25, label: '流畅', detail: '25%' },
  { value: 0.125, label: '低清', detail: '12.5%' },
];

const RATIO_OPTIONS = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '4:3', width: 1440, height: 1080 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '3:4', width: 1080, height: 1440 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '21:9', width: 2560, height: 1080 },
] as const;

export function PreviewBottomControls({ previewQuality, setPreviewQuality, viewZoom, setViewZoom }: PreviewBottomControlsProps) {
  const [menu, setMenu] = useState<'quality' | 'zoom' | 'ratio' | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const composition = useMediaStore((state) => state.compositions.find((item) => item.id === state.activeCompositionId));
  const updateComposition = useMediaStore((state) => state.updateComposition);
  const qualityLabel = QUALITY_OPTIONS.find((item) => item.value === previewQuality)?.label ?? '原画';
  const currentRatio = useMemo(() => {
    if (!composition?.width || !composition.height) return '比例';
    const match = RATIO_OPTIONS.find((item) => Math.abs(item.width / item.height - composition.width / composition.height) < 0.01);
    return match?.label ?? `${composition.width}:${composition.height}`;
  }, [composition?.height, composition?.width]);

  useEffect(() => {
    if (!menu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);

  const toggle = (next: typeof menu) => setMenu((current) => current === next ? null : next);
  const fullscreen = async () => {
    const target = hostRef.current?.closest('.preview-container') as HTMLElement | null;
    if (!target) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await target.requestFullscreen();
    } catch { /* The browser can reject fullscreen outside an eligible user gesture. */ }
  };

  return <div className="preview-controls-bottom" ref={hostRef}>
    <div className="preview-bottom-control">
      <button type="button" className="preview-tool-button" onClick={() => toggle('quality')} aria-expanded={menu === 'quality'} title="预览画质">
        {qualityLabel}<span aria-hidden="true">⌄</span>
      </button>
      {menu === 'quality' && <div className="preview-tool-menu">{QUALITY_OPTIONS.map((item) => <button type="button" key={item.value} className={item.value === previewQuality ? 'active' : ''} onClick={() => { setPreviewQuality(item.value); setMenu(null); }}><span>{item.label}</span><small>{item.detail}</small></button>)}</div>}
    </div>

    <div className="preview-bottom-control">
      <button type="button" className="preview-tool-button" onClick={() => toggle('zoom')} aria-expanded={menu === 'zoom'} title="预览缩放">
        {Math.round(viewZoom * 100)}%<span aria-hidden="true">⌄</span>
      </button>
      {menu === 'zoom' && <div className="preview-tool-menu">{[0.25, 0.5, 0.75, 1, 1.5, 2].map((zoom) => <button type="button" key={zoom} className={zoom === viewZoom ? 'active' : ''} onClick={() => { setViewZoom(zoom); setMenu(null); }}><span>{Math.round(zoom * 100)}%</span></button>)}</div>}
    </div>

    <div className="preview-bottom-control">
      <button type="button" className="preview-tool-button" onClick={() => toggle('ratio')} aria-expanded={menu === 'ratio'} title="项目画幅比例">
        {currentRatio}<span aria-hidden="true">⌄</span>
      </button>
      {menu === 'ratio' && <div className="preview-tool-menu preview-ratio-menu">{RATIO_OPTIONS.map((item) => <button type="button" key={item.label} className={item.label === currentRatio ? 'active' : ''} onClick={() => { if (activeCompositionId) updateComposition(activeCompositionId, { width: item.width, height: item.height }); setMenu(null); }}><span>{item.label}</span><small>{item.width} × {item.height}</small></button>)}</div>}
    </div>

    <button type="button" className="preview-tool-button preview-fullscreen-button" onClick={() => void fullscreen()} title="全屏预览" aria-label="全屏预览">
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" /></svg>
    </button>
  </div>;
}
