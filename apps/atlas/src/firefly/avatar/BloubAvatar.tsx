import { useEffect, useId, useMemo, useState } from 'react';
import { BotEngine, type BotFrame } from './bloub/engine';
import { mixHex } from './bloub/skins';
import { DEMI_VIEWBOX, RAYON } from './bloub/repere';
import type { StateId } from './bloub/states';

type BloubAvatarProps = {
  state: StateId;
  size?: number;
  ink?: string;
  paper?: string;
  className?: string;
};

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function BloubAvatar({
  state,
  size = 54,
  ink = '#b8ddd2',
  paper = '#13171b',
  className,
}: BloubAvatarProps) {
  const maskId = `bloub-mask-${useId().replace(/:/g, '')}`;
  const gradientPrefix = `${maskId}-arc`;
  const engine = useMemo(() => new BotEngine(RAYON, state, null, null), []);
  const [frame, setFrame] = useState<BotFrame>(() => engine.sample(0));

  useEffect(() => {
    const now = performance.now() / 1000;
    engine.setState(state, now);
    if (prefersReducedMotion()) {
      setFrame(engine.sample(now + 0.8));
      return;
    }

    let animationFrame = 0;
    const render = (timestamp: number) => {
      setFrame(engine.sample(timestamp / 1000));
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, [engine, state]);

  const dotProps = (dot: BotFrame['dots'][number]) => {
    const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
    if (dot.d) {
      return {
        d: dot.d,
        transform: `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`,
        fill,
        opacity: dot.opacity,
      };
    }
    return { cx: dot.x, cy: dot.y, r: dot.r, fill, opacity: dot.opacity };
  };

  const renderDots = (prefix: string) => frame.dots.map((dot, index) => dot.d
    ? <path key={`${prefix}-${index}`} {...dotProps(dot)} />
    : <circle key={`${prefix}-${index}`} {...dotProps(dot)} />);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`${-DEMI_VIEWBOX} ${-DEMI_VIEWBOX} ${DEMI_VIEWBOX * 2} ${DEMI_VIEWBOX * 2}`}
      role="img"
      aria-label="Atlas Agent 状态"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-DEMI_VIEWBOX} y={-DEMI_VIEWBOX} width={DEMI_VIEWBOX * 2} height={DEMI_VIEWBOX * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, index) => <path key={index} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />)}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient key={arc.id} id={`${gradientPrefix}-${arc.id}`} gradientUnits="userSpaceOnUse" x1={arc.grad.x1} y1={arc.grad.y1} x2={arc.grad.x2} y2={arc.grad.y2}>
            {arc.grad.stops.map((color, index) => <stop key={index} offset={index / Math.max(1, arc.grad.stops.length - 1)} stopColor={color} />)}
          </linearGradient>
        ))}
      </defs>
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => <path key={`back-${arc.id}`} d={arc.back} stroke={`url(#${gradientPrefix}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />)}
      </g>
      {frame.dotsBehind && <g>{renderDots('behind')}</g>}
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}><rect x={-DEMI_VIEWBOX} y={-DEMI_VIEWBOX} width={DEMI_VIEWBOX * 2} height={DEMI_VIEWBOX * 2} fill={ink} /></g>
      </g>
      {!frame.dotsBehind && <g>{renderDots('front')}</g>}
      {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill="#1f7aff" />}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => <path key={`front-${arc.id}`} d={arc.front} stroke={`url(#${gradientPrefix}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />)}
      </g>
    </svg>
  );
}
