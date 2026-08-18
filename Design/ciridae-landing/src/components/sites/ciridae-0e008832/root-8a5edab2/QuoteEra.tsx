"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TextScramble } from "../shared/TextScramble";

gsap.registerPlugin(ScrollTrigger);

const QUOTES = [
  "There are two kinds of services businesses now: the ones being transformed around AI and the ones being replaced by it.",
  "We do the transformation.",
  "We are engineers. We build AI-native operating systems. Software that operates the business while the team operates the software. We ship in weeks because we've built the platform that makes it possible: proprietary kits, vertical playbooks, production infrastructure. Every deployment makes the next one faster.",
  "Our customers are the services businesses that compose the real economy and the investors behind them. We’re entering a new productivity golden age, measuring progress through EBITDA, hours returned, and decisions made correctly at scale.",
];

/**
 * QuoteEra — section 05 of the target home page: the "A NEW ERA" label plus
 * the four manifesto paragraphs that introduce the company.
 *
 * Interaction mirrors the target's TextAnimation module: the label scrambles
 * in character-by-character (shared TextScramble), while the long paragraphs
 * reveal as a block fade (autoAlpha 0→1 with a 20px rise, staggered 0.15s)
 * when the block enters the viewport.
 *
 * Markup and classes copied verbatim from the extract (the sibling `.container`
 * with the hidden `.case-study` subtree is omitted). The section's
 * `change-nav-color="white"` attribute drives the nav color switch in
 * LenisProvider.
 */
export function QuoteEra() {
  const quotesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const quotes = quotesRef.current;
    if (!quotes) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        quotes.querySelectorAll<HTMLElement>(":scope > .rich-inherit > p"),
        { autoAlpha: 0, y: 20 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          ease: "power2.out",
          stagger: 0.15,
          scrollTrigger: {
            trigger: quotes,
            start: "top 90%",
            once: true,
          },
        },
      );
    }, quotes);
    return () => ctx.revert();
  }, []);

  return (
    <section change-nav-color="white" className="section section-space">
      <div className="era-wrap">
        <TextScramble
          text="A NEW ERA"
          className="custom-descr text-center f-14 font-mono lh-120 caps"
        />
        <div
          ref={quotesRef}
          className="custom-descr text-center f-14 lh-140 font-body"
          style={{ "--max-w": "50ch", "--sm-max-w": "20.4rem" } as CSSProperties}
        >
          <div className="rich-inherit w-richtext">
            {QUOTES.map((quote, i) => (
              <p key={i}>{quote}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
