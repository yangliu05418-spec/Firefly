"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { TextScramble } from "../shared/TextScramble";

gsap.registerPlugin(ScrollTrigger);

const LABEL = "Security standards";
const HEADING =
  "The Ciridae platform is built on secure, SOC 2–compliant infrastructure with end-to-end encryption, strict access controls, and scalable cloud architecture to ensure your AI-powered operations remain protected, compliant, and reliable, regardless of how fast you grow.";

/**
 * Security standards CTA section (target extract 10-security-cta.html).
 * Text-only section: mono label revealed via shared TextScramble, body
 * heading revealed with a gsap autoAlpha + y fade on ScrollTrigger enter.
 * The security timeline is not rendered (verified absent in the live DOM).
 */
export function SecurityText() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const heading = headingRef.current;
    if (!section || !heading) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        heading,
        { autoAlpha: 0, y: 24 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: {
            trigger: section,
            start: "top 85%",
            once: true,
          },
        },
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} change-nav-color="white" className="section section-space">
      <div className="container">
        <div className="text-only">
          <div className="v-flex-center-top gap-40 sm-gap-20">
            <div
              className="custom-descr text-center f-14 caps lh-90 -ls-02 font-mono"
              style={{ "--max-w": "32ch", "--sm-fixed-w": "20.4rem" } as CSSProperties}
            >
              <div className="rich-inherit w-richtext">
                <h3>
                  <TextScramble text={LABEL} />
                </h3>
              </div>
            </div>
            <div
              className="custom-descr text-center f-32 caps lh-105 -ls-02 sm-f-20"
              style={{ "--max-w": "70ch" } as CSSProperties}
            >
              <div className="rich-inherit w-richtext">
                <p ref={headingRef}>{HEADING}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
