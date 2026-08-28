export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#4ade80" strokeWidth="1.5" />
      <path d="M4.5 8.2l2.1 2.1L11.5 5.7" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#f87171" strokeWidth="1.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L1 14h14L8 2z" stroke="#fbbf24" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6v4M8 12v.5" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SuccessBigIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke="#4ade80" strokeWidth="2" />
      <path d="M14 24l7 7L34 17" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: 'matanyone-spin 0.8s linear infinite' }}
    >
      <circle cx="8" cy="8" r="6.5" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
      <path d="M14.5 8a6.5 6.5 0 00-6.5-6.5" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
