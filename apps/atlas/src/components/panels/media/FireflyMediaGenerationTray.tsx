import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { FIREFLY_ATLAS_MEDIA_REFRESH_EVENT } from '../../../firefly/FireflyGeneratedMediaBridge';
import { useFireflyEmbedding } from '../../../firefly/FireflyEmbeddingContext';
import './FireflyMediaGenerationTray.css';

const channel = 'firefly.atlas.generate.v1';

export function FireflyMediaGenerationTray({ expanded, onExpandedChange }: { expanded: boolean; onExpandedChange: (expanded: boolean) => void }) {
  const embedding = useFireflyEmbedding();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [activated, setActivated] = useState(expanded);
  const stopEvent = useCallback((event: SyntheticEvent) => event.stopPropagation(), []);

  useEffect(() => {
    if (expanded) setActivated(true);
  }, [expanded]);

  useEffect(() => {
    if (!embedding) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as { channel?: unknown; type?: unknown; projectId?: unknown };
      if (message.channel !== channel || message.projectId !== embedding.projectId || typeof message.type !== 'string') return;
      if (message.type === 'CLOSE') onExpandedChange(false);
      if (message.type === 'OUTPUT_READY') window.dispatchEvent(new Event(FIREFLY_ATLAS_MEDIA_REFRESH_EVENT));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [embedding, onExpandedChange]);

  if (!embedding?.capabilities.generate) return null;
  return <>
    {!expanded && <div className="media-ai-tray media-ai-tray-collapsed firefly-generate-launcher" onMouseDown={stopEvent} onClick={stopEvent}>
      <button className="media-ai-tray-launch" type="button" onClick={() => { setActivated(true); onExpandedChange(true); }} title="打开 Firefly 生成素材">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 1.5 9.2 5 13 6.2 9.2 7.4 8 11 6.8 7.4 3 6.2 6.8 5 8 1.5Z"/><path d="m12.4 10.4.5 1.4 1.5.5-1.5.5-.5 1.4-.5-1.4-1.5-.5 1.5-.5.5-1.4Z"/></svg>
        <span>生成</span>
      </button>
    </div>}
    <div className={`firefly-generate-drawer ${expanded ? 'is-open' : ''}`} onMouseDown={stopEvent} onClick={stopEvent} aria-hidden={!expanded}>
      {activated && <iframe ref={frameRef} title="Firefly 生成素材" src={`/studio/generate-embed/?projectId=${encodeURIComponent(embedding.projectId)}`} loading="eager" />}
    </div>
  </>;
}
