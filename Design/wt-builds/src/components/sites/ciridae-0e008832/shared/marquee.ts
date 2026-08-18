"use client";

import { useEffect, useRef } from "react";

/**
 * Infinite horizontal marquee loop (target's Marque module):
 * duplicates the list content once and translates the wrapper so the loop
 * is seamless, driven by requestAnimationFrame.
 */
export function useMarquee(speed = 80) {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let raf = 0;
    let offset = 0;
    let half = 0;
    let last = performance.now();

    const setup = () => {
      // duplicate inner content once for seamless loop
      const original = track.querySelector<HTMLElement>(":scope > *");
      if (!original) return;
      const clone = original.cloneNode(true) as HTMLElement;
      clone.setAttribute("aria-hidden", "true");
      track.appendChild(clone);
      half = original.offsetWidth;
      offset = 0;
    };
    setup();

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      offset = (offset + speed * dt) % half;
      track.style.transform = `translate3d(-${offset}px,0,0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      const clone = track.querySelector<HTMLElement>(":scope > [aria-hidden]");
      if (clone) track.removeChild(clone);
      track.style.transform = "";
    };
  }, [speed]);

  return trackRef;
}
