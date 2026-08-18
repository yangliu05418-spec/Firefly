"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomChar(): string {
  return CHARS.charAt(Math.floor(Math.random() * CHARS.length));
}

/**
 * Renders text split into per-character spans exactly like the target site's
 * runtime-split markup (aria-label on wrapper, aria-hidden char spans), then
 * reveals it with a scramble animation when it scrolls into view.
 *
 * Mirrors the target's TextAnimation module (GSAP SplitText + ScrambleText).
 */
export function TextScramble({
  text,
  className,
  lineClassName,
  charClassName,
  delay = 0,
  stagger = 0.02,
  duration = 0.4,
  once = true,
}: {
  text: string;
  className?: string;
  lineClassName?: string;
  charClassName?: string;
  delay?: number;
  stagger?: number;
  duration?: number;
  once?: boolean;
}) {
  const lineRef = useRef<HTMLDivElement>(null);
  const charsRef = useRef<HTMLSpanElement[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const trigger = ScrollTrigger.create({
      trigger: line,
      start: "top 90%",
      once,
      onEnter: () => setVisible(true),
    });
    return () => {
      trigger.kill();
    };
  }, [once]);

  useEffect(() => {
    const line = lineRef.current;
    if (!line || !visible) return;
    const ctx = gsap.context(() => {
      const chars = charsRef.current;
      gsap.fromTo(
        chars,
        { autoAlpha: 0 },
        {
          autoAlpha: 1,
          duration,
          stagger,
          delay,
          ease: "none",
          overwrite: "auto",
        },
      );
      chars.forEach((c, i) => {
        gsap.fromTo(
          c,
          { scrambleText: { text: randomChar(), chars: CHARS, speed: 0.5 } },
          {
            scrambleText: { text: c.dataset.char ?? "", chars: CHARS, speed: 0.5 },
            duration,
            delay: delay + i * stagger,
            ease: "none",
            overwrite: "auto",
          },
        );
      });
    }, line);
    return () => ctx.revert();
  }, [visible, delay, stagger, duration]);

  const chars = text.split("");

  return (
    <span aria-label={text} className={className}>
      <span
        ref={lineRef}
        aria-hidden="true"
        className={lineClassName}
        style={{ position: "relative", display: "block", textAlign: "start", overflow: "hidden", height: "1em" }}
      >
        {chars.map((c, i) => (
          <span
            key={i}
            ref={(el) => {
              if (el) charsRef.current[i] = el;
            }}
            aria-hidden="true"
            data-char={c}
            className={charClassName}
            style={{ position: "relative", display: "inline-block", whiteSpace: "pre" }}
          >
            {c}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Hover scramble for buttons/links (target's LinkAnimation module):
 * on mouseenter every char scrambles to a random glyph then settles back.
 */
export function LinkAnimation({
  children,
  className,
  duration = 0.4,
  stagger = 0.03,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
  stagger?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const charsRef = useRef<HTMLSpanElement[]>([]);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ctx = gsap.context(() => {
      const chars = charsRef.current;
      const tl = gsap.timeline({ paused: true });
      chars.forEach((c, i) => {
        tl.to(
          c,
          { scrambleText: { text: randomChar(), chars: CHARS, speed: 0.5 }, duration, ease: "power2.out" },
          i * stagger,
        ).to(
          c,
          { scrambleText: { text: c.dataset.char ?? "", chars: CHARS, speed: 0.5 }, duration, ease: "power2.out", overwrite: "auto" },
          i * stagger + duration,
        );
      });
      tlRef.current = tl;
      const onEnter = () => tl.restart();
      wrap.addEventListener("mouseenter", onEnter);
      return () => wrap.removeEventListener("mouseenter", onEnter);
    }, wrap);
    return () => ctx.revert();
  }, [duration, stagger]);

  return (
    <span ref={wrapRef} className={className} style={{ position: "relative", display: "block" }}>
      {typeof children === "string"
        ? children.split("").map((c, i) => (
            <span
              key={i}
              ref={(el) => {
                if (el) charsRef.current[i] = el;
              }}
              aria-hidden="true"
              data-char={c}
              style={{ position: "relative", display: "inline-block", whiteSpace: "pre" }}
            >
              {c}
            </span>
          ))
        : children}
    </span>
  );
}
