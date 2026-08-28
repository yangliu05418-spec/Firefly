export function ListViewIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="1" y="2" width="14" height="2" rx="0.5" />
      <rect x="1" y="7" width="14" height="2" rx="0.5" />
      <rect x="1" y="12" width="14" height="2" rx="0.5" />
    </svg>
  );
}

export function NodeViewIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="2" />
      <circle cx="13" cy="4" r="2" />
      <circle cx="13" cy="12" r="2" />
      <path d="M4.8 7.2 11.2 4.8v1.4L5.3 8.5l5.9 2.3v1.4L4.8 9.8V7.2Z" />
    </svg>
  );
}

export function SetAllKeyframesIcon() {
  return (
    <svg className="color-keyframe-all-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 2.5 6.4 5 4 7.5 1.6 5 4 2.5Z" />
      <path d="M4 8.5 6.4 11 4 13.5 1.6 11 4 8.5Z" />
      <path d="M10 2.5 12.4 5 10 7.5 7.6 5 10 2.5Z" />
      <path d="M12 9.2v5.2M9.4 11.8h5.2" />
    </svg>
  );
}

export function InspectorToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M10 2v12" />
      <path
        d={collapsed ? 'M5.2 8 8.2 5v6L5.2 8Z' : 'M8 8 5 5v6l3-3Z'}
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
