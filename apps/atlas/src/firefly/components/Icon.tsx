import type { SVGProps } from 'react';

export type IconName = 'atlas' | 'arrow-left' | 'plus' | 'folder' | 'video' | 'image' | 'audio'
  | 'upload' | 'library' | 'timeline' | 'undo' | 'redo' | 'scissors' | 'trash' | 'volume'
  | 'mute' | 'export' | 'agent' | 'spark' | 'close' | 'more' | 'refresh' | 'check'
  | 'warning' | 'cloud' | 'device' | 'play' | 'pause' | 'search' | 'track' | 'lock' | 'unlock';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      <g {...common}>
        {name === 'atlas' && <><path d="M12 2.8 20.2 7v10L12 21.2 3.8 17V7Z" /><path d="m3.8 7 8.2 4.2L20.2 7M12 11.2v10M7.8 4.9 16 9.1v5L7.8 18.3Z" /></>}
        {name === 'arrow-left' && <><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></>}
        {name === 'plus' && <><path d="M12 5v14M5 12h14" /></>}
        {name === 'folder' && <path d="M3.5 7.5h6l2-2h9v13h-17Z" />}
        {name === 'video' && <><rect x="3.5" y="5" width="13" height="14" rx="2" /><path d="m16.5 10 4-2v8l-4-2" /></>}
        {name === 'image' && <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.2" cy="9" r="1.5" /><path d="m4 17 5-5 3.5 3.5 2-2L20 19" /></>}
        {name === 'audio' && <><path d="M9 18V6l9-2v12" /><circle cx="6" cy="18" r="3" /><circle cx="15" cy="16" r="3" /></>}
        {name === 'upload' && <><path d="m8 8 4-4 4 4M12 4v11" /><path d="M5 14v5h14v-5" /></>}
        {name === 'library' && <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18M12 7h5M12 11h5M12 15h3" /></>}
        {name === 'timeline' && <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 4v4M14 10v4M11 16v4" /></>}
        {name === 'undo' && <><path d="m9 7-5 5 5 5" /><path d="M4 12h10a6 6 0 0 1 6 6" /></>}
        {name === 'redo' && <><path d="m15 7 5 5-5 5" /><path d="M20 12H10a6 6 0 0 0-6 6" /></>}
        {name === 'scissors' && <><circle cx="6" cy="7" r="3" /><circle cx="6" cy="17" r="3" /><path d="m8.5 8.5 11 8.5M8.5 15.5 19.5 7" /></>}
        {name === 'trash' && <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>}
        {name === 'volume' && <><path d="M4 10v4h4l5 4V6l-5 4Z" /><path d="M16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>}
        {name === 'mute' && <><path d="M4 10v4h4l5 4V6l-5 4Z" /><path d="m17 10 4 4M21 10l-4 4" /></>}
        {name === 'export' && <><path d="M12 15V3M8 7l4-4 4 4" /><path d="M5 12v8h14v-8" /></>}
        {name === 'agent' && <><circle cx="12" cy="12" r="8" /><path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M6.4 6.4 5 5M19 19l-1.4-1.4M17.6 6.4 19 5M5 19l1.4-1.4" /><circle cx="12" cy="12" r="2.5" /></>}
        {name === 'spark' && <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4Z" />}
        {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
        {name === 'more' && <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>}
        {name === 'refresh' && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M18.4 9A7 7 0 0 0 6 6l-2 2M5.6 15A7 7 0 0 0 18 18l2-2" /></>}
        {name === 'check' && <path d="m5 12 4 4L19 6" />}
        {name === 'warning' && <><path d="M12 3 2.7 20h18.6Z" /><path d="M12 9v4M12 17h.01" /></>}
        {name === 'cloud' && <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 8.5 4.8 4.8 0 0 0 7 18Z" />}
        {name === 'device' && <><rect x="4" y="3" width="16" height="14" rx="2" /><path d="M9 21h6M12 17v4" /></>}
        {name === 'play' && <path d="m8 5 11 7-11 7Z" />}
        {name === 'pause' && <><path d="M9 5v14M15 5v14" /></>}
        {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>}
        {name === 'track' && <><path d="M4 7h16M4 17h16" /><rect x="7" y="4" width="7" height="6" rx="1" /><rect x="11" y="14" width="6" height="6" rx="1" /></>}
        {name === 'lock' && <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></>}
        {name === 'unlock' && <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M16 10V7a4 4 0 0 0-7.5-2M12 14v2" /></>}
      </g>
    </svg>
  );
}
