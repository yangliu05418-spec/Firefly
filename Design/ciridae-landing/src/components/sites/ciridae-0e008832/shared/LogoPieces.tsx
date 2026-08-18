"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

gsap.registerPlugin(gsap);

export interface LogoPieceData {
  /** SVG viewBox, e.g. "0 0 1000 1153" */
  viewBox: string;
  /** abstract start shape path (data-morph) */
  morph: string;
  /** final logo path (data-start / the real piece) */
  start: string;
}

/**
 * The target's morphing logo: several SVG "pieces" that animate from an
 * abstract blob shape (data-morph) into the real logo paths (data-start),
 * with each piece fading in. Uses flubber for path interpolation (the
 * target uses the paid MorphSVG plugin; flubber is the MIT equivalent).
 */
export function LogoPieces({
  pieces,
  className,
  pieceClassName = "logo-piece",
}: {
  pieces: LogoPieceData[];
  className?: string;
  pieceClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || pieces.length === 0) return;
    let cancelled = false;
    const ctx = gsap.context(() => {
      gsap.set(root.querySelectorAll(`.${pieceClassName.split(" ")[0]}`), { opacity: 0 });
    }, root);
    void (async () => {
      const { interpolate } = await import("flubber");
      if (cancelled) return;
      const paths = root.querySelectorAll<SVGPathElement>("path");
      const interpolators = pieces.map((p) =>
        interpolate(p.morph, p.start, { maxSegmentLength: 2 }),
      );
      const timeline = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut", duration: 1.5 } });
      const pieceEls = root.querySelectorAll<HTMLElement>(`.${pieceClassName.split(" ")[0]}`);
      pieceEls.forEach((el, i) => {
        const path = paths[i];
        if (!path) return;
        const target = interpolators[i];
        const obj = { t: 0 };
        timeline.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, i * 0.1 + 0.2);
        timeline.to(
          obj,
          {
            t: 1,
            duration: 1.5,
            ease: "power2.inOut",
            onUpdate: () => {
              path.setAttribute("d", target(obj.t));
            },
          },
          i * 0.1 + 0.2,
        );
      });
      if (!cancelled) timeline.play();
    })();
    return () => {
      cancelled = true;
      ctx.revert();
    };
  }, [pieces, pieceClassName]);

  return (
    <div ref={rootRef} className={className}>
      {pieces.map((p, i) => (
        <svg key={i} viewBox={p.viewBox} data-morph={p.morph} data-start={p.start} className={pieceClassName}>
          <path fill="currentColor" d={p.start} />
        </svg>
      ))}
    </div>
  );
}
