import type { GuidedRect, GuidedTone } from '../../services/guidedActions';

interface GuidedTargetHighlightProps {
  rect: GuidedRect;
  tone?: GuidedTone;
}

export function GuidedTargetHighlight({ rect, tone = 'primary' }: GuidedTargetHighlightProps) {
  return (
    <div
      className={`guided-target-highlight guided-target-highlight--${tone}`}
      style={{
        height: rect.height,
        left: rect.x,
        top: rect.y,
        width: rect.width,
      }}
      aria-hidden="true"
    />
  );
}
