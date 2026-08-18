"use client";

import { useState, type CSSProperties } from "react";
import { TextScramble } from "../shared/TextScramble";
import "./we-do.css";

/** Style object allowing the target's CSS custom properties. */
type WeDoStyle = CSSProperties & Record<`--${string}`, string | number>;

const IMAGES_BASE = "/sites/ciridae-0e008832/root-8a5edab2/images";

interface WeDoItem {
  index: string;
  title: string;
  image: string;
  /** Pre-split description lines, verbatim from the target's runtime markup. */
  lines: string[];
}

const WE_DO_ITEMS: WeDoItem[] = [
  {
    index: "01",
    title: "AI operating system",
    image: "pawel-czerwinski.webp",
    lines: [
      "A purpose-built operating system that ",
      "replaces the patchwork of ERPs, ",
      "spreadsheets, and disconnected point ",
      "solutions most industrial businesses run ",
      "on. Every workflow, from project ",
      "management, financials, CRM, AP/AR, ",
      "to reporting, is built to mirror how the ",
      "business actually operates, unified in a ",
      "single system that compounds in value ",
      "as the business grows.",
    ],
  },
  {
    index: "02",
    title: "Scheduling",
    image: "numbers-bg-new.webp",
    lines: [
      "AI-powered scheduling ingests work ",
      "order data, technician skills, ",
      "certifications, and routing constraints to ",
      "automatically generate optimized ",
      "schedules across a large field workforce. ",
      "Schedulers review AI-proposals with ",
      "confidence scores, make targeted ",
      "adjustments, and approve, so the ",
      "system earns trust while dramatically ",
      "reducing the time and effort required to ",
      "build.",
    ],
  },
  {
    index: "03",
    title: "Vendor management",
    image: "jane-sakharova.webp",
    lines: [
      "From onboarding and document ",
      "collection to payment approvals and ",
      "compliance tracking, automate the full ",
      "vendor lifecycle with AI handling the ",
      "coordination overhead that typically ",
      "requires dedicated staff. The system ",
      "surfaces exceptions, enforces approval ",
      "workflows, and integrates directly with ",
      "your financial stack, so your team ",
      "focuses on vendor relationships, not ",
      "administrative overhead.",
    ],
  },
  {
    index: "04",
    title: "customer order expediting",
    image: "blog-img-01.png",
    lines: [
      "AI continuously monitors inbound order ",
      "activity, triages customer ",
      "communications, and routes urgent ",
      "requests without manual intervention, ",
      "saving the equivalent of a full-time ",
      "headcount per workflow. Every email ",
      "handled, every status update logged, ",
      "and every exception flagged is tracked ",
      "against measurable cost savings, giving ",
      "operations teams real visibility into what ",
      "automation is actually delivering.",
    ],
  },
];

/**
 * We-do section — sticky flex accordion (target's WeDo module):
 * `.we-do_parent` (200vh) pins `.we-do` (100vh, sticky) while the user
 * scrolls; hovering a column sets it `.active` so it grows to `flex: 1`
 * (`.we-do_item{flex:var(--flex)}` → `.we-do_item.active{flex:1}`, transition
 * `flex .8s var(--smooth)`) and its description `.line`s fade in staggered by
 * `--delay`.
 *
 * Markup, classes, and copy are verbatim from extract/07-we-do.html.
 */
export function WeDo() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <section change-nav-color="white" data-module="WeDo" className="section">
      <div className="container">
        <div className="we-do_parent">
          <div className="we-do section-space">
            <div className="v-flex-center-top gap-40 relative z-2">
              <div
                style={{ "--max-w": "32ch", "--sm-max-w": "20.4rem" } as WeDoStyle}
                data-module="TextAnimation"
                className="custom-descr text-center f-16 caps lh-90 -ls-02"
              >
                <div className="rich-inherit w-richtext">
                  <h3 className="heading-4">
                    <TextScramble text="systems, not tools" />
                  </h3>
                </div>
              </div>
              <div
                style={{ "--max-w": "76ch", "--sm-max-w": "20.4rem" } as WeDoStyle}
                data-module="TextAnimation"
                className="custom-descr f-32 caps lh-105 -ls-02 sm-f-20 text-center"
              >
                <div className="rich-inherit w-richtext">
                  <p>
                    <TextScramble
                      text="designed to run core operations from one intelligent foundation."
                      lineClassName="we-do_text-center"
                    />
                  </p>
                </div>
              </div>
            </div>
            <div className="we-do_list">
              {WE_DO_ITEMS.map((item, i) => (
                <div
                  key={item.index}
                  className={`we-do_item${i === activeIndex ? " active" : ""}`}
                  style={{ "--flex": 0.25 } as WeDoStyle}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => setActiveIndex(i)}
                >
                  <div className="we-do_content">
                    <div className="tag">
                      <div className="f-11 font-mono lh-110 caps">{item.index}</div>
                    </div>
                    <div
                      style={{ "--max-w": "50ch" } as WeDoStyle}
                      className="custom-descr f-16 caps text-center"
                    >
                      <div className="rich-inherit w-richtext">
                        <p>{item.title}</p>
                      </div>
                    </div>
                    <div className="we-do_descr">
                      <div
                        style={{ "--max-w": "50ch" } as WeDoStyle}
                        className="custom-descr font-body f-14 lh-120"
                      >
                        <div className="rich-inherit w-richtext">
                          <div aria-label={item.lines.map((l) => l.trim()).join(" ")}>
                            {item.lines.map((line, j) => (
                              <div
                                key={j}
                                aria-hidden="true"
                                className="line"
                                style={
                                  {
                                    position: "relative",
                                    display: "block",
                                    textAlign: "center",
                                    "--delay": `${j / 10}s`,
                                  } as WeDoStyle
                                }
                              >
                                {line}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="we-do_img">
                    {/* eslint-disable-next-line @next/next/no-img-element -- target uses a plain lazy img */}
                    <img
                      src={`${IMAGES_BASE}/${item.image}`}
                      alt=""
                      loading="lazy"
                      className="img-cover"
                    />
                    <div className="we-do_img-overlay" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
