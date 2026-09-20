import type { ReactNode } from "react";

/** Shared visual shell; generation engines own only their inputs and controls. */
export function ComposerFrame({ compact = false, children }: { compact?: boolean; children: ReactNode }) {
  return <div className={`composer ${compact ? "composer--compact" : ""}`} onClick={(event) => event.stopPropagation()}>
    {!compact && <h1>今晚，想创造什么？</h1>}
    <div className="composer-shell">{children}</div>
  </div>;
}
