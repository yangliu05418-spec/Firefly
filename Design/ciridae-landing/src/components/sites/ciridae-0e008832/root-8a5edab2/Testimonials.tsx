"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Splide from "@splidejs/splide";
import { TextScramble } from "../shared/TextScramble";
import type { Testimonial } from "@/types/ciridae-0e008832/home";

const IMAGES = "/sites/ciridae-0e008832/root-8a5edab2/images";

/** Verbatim copy of the target's testimonial CMS collection. */
const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "What sets Ciridae apart is how fast they think and how fast they build. Their technical capabilities are legitimately impressive. Not just impressive for an AI startup, just impressive full stop. They feel less like a vendor and more like a true transformation partner genuinely invested in driving value.",
    author: "Jarryd Hill",
    role: "Chief Operating Officer of Atom",
    image: `${IMAGES}/atom_logo.png`,
  },
  {
    quote: "Ciridae's system isn't just transformational for us—it's revolutionary.",
    author: "Bryan Knodel",
    role: "CFO of Knight Commercial",
    image: `${IMAGES}/KNIGHT-COMMERCIAL.png`,
  },
  {
    quote:
      "Ciridae shipped high-impact solutions quickly and helped architect our long-term AI strategy. They’re simply the best; true partners every step of the way.",
    author: "Francesco Boccardo",
    role: "HEAD OF GEN AI AT BV TECH",
    image: `${IMAGES}/BV-TECH-1.png`,
  },
  {
    quote:
      "Ciridae was so good we wanted them on our cap table. In just one month, Ciridae quickly understood our business, identified the biggest generative AI opportunities and risks, and gave us a clear path toward becoming an AI-first company.",
    author: "JOSH ALBOM",
    role: "CEO OF FACTUA",
    image: `${IMAGES}/factua-logo-1.png`,
  },
  {
    quote:
      "This is the best vendor experience we’ve ever had. I wouldn’t have thought 80% of the capabilities being delivered were possible just 9 months ago.",
    author: "Finance Team",
    role: "Construction Services",
  },
  {
    quote: "Using Ciridae’s platform was so easy, I thought I missed a step.",
    author: "Account Executive",
    role: "Construction Services",
  },
];

/** Quote mark glyph (17x18), fill matches the target's orange token. */
function QuoteIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 17 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16.9517 17.4319L10.6157 17.4319V8.40792C10.6157 3.99192 13.6877 1.62392 16.9517 0.919922V4.37592C15.2237 4.88792 13.7517 6.29592 13.7517 8.40792V10.4559L16.9517 10.4559L16.9517 17.4319ZM6.39166 17.4319H0.0556641L0.0556641 8.40792C0.0556641 3.99192 3.12766 1.62392 6.39166 0.919922L6.39166 4.37592C4.66366 4.88792 3.19166 6.29592 3.19166 8.40792V10.4559L6.39166 10.4559L6.39166 17.4319Z"
        fill="var(--color--orange)"
      />
    </svg>
  );
}

/** Left chevron (9x8), inherits currentColor like the target. */
function ArrowLeftIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 9 8" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.99436 7.77137H5.71413L3.45127 5.43309C3.19482 5.16154 2.84784 4.85983 2.56122 4.58829C3.19482 4.60337 3.49653 4.60337 3.79824 4.60337H8.53516V3.39651H3.79824C3.49653 3.39651 3.2099 3.39651 2.56122 3.4116C2.84784 3.14006 3.19482 2.79309 3.46636 2.52154L5.71413 0.228516L3.99436 0.228516L0.464302 3.99994L3.99436 7.77137Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Right chevron (9x8), inherits currentColor like the target. */
function ArrowRightIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 9 8" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5.00564 7.77137H3.28587L5.54873 5.43309C5.80518 5.16154 6.15216 4.85983 6.43878 4.58829C5.80518 4.60337 5.50347 4.60337 5.20176 4.60337H0.464844V3.39651H5.20176C5.50347 3.39651 5.7901 3.39651 6.43878 3.4116C6.15216 3.14006 5.80518 2.79309 5.53364 2.52154L3.28587 0.228516L5.00564 0.228516L8.5357 3.99994L5.00564 7.77137Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Client logo. Slides without a logo keep the target's hidden placeholder img. */
function TestimonialLogo({ src }: { src?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- verbatim target markup
  return <img alt="" className={src ? undefined : "w-dyn-bind-empty"} src={src} />;
}

export function Testimonials() {
  const rootRef = useRef<HTMLDivElement>(null);
  const splideRef = useRef<Splide | null>(null);
  const [current, setCurrent] = useState(1);
  const [prevDisabled, setPrevDisabled] = useState(true);
  const [nextDisabled, setNextDisabled] = useState(false);

  const sync = useCallback(() => {
    const splide = splideRef.current;
    if (!splide) return;
    setCurrent(splide.index + 1);
    setPrevDisabled(splide.index === 0);
    setNextDisabled(splide.index >= splide.length - 1);
    splide.Components.Elements.slides.forEach((slide, i) => {
      slide.classList.toggle("active", i === splide.index);
    });
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const splide = new Splide(root, {
      type: "slide",
      autoWidth: true,
      gap: "1.25rem",
      arrows: false,
      pagination: false,
    });
    splideRef.current = splide;
    splide.on("mounted", sync);
    splide.on("moved", sync);
    splide.mount();
    return () => {
      splide.destroy(true);
      splideRef.current = null;
    };
  }, [sync]);

  const goPrev = () => splideRef.current?.go("<");
  const goNext = () => splideRef.current?.go(">");

  return (
    <section change-nav-color="white" data-module="TestimonialsSplide" className="section section-space">
      <div className="container">
        <div className="testimonials">
          <div className="v-flex-center-top gap-40 sm-gap-30">
            <div
              className="custom-descr text-center f-14 caps lh-90 -ls-02 font-mono"
              style={{ "--max-w": "32ch", "--sm-fixed-w": "20.4rem" } as CSSProperties}
            >
              <div className="rich-inherit w-richtext">
                <h3 aria-label="testimonials">
                  <TextScramble text="testimonials" className="w-inline-block" />
                </h3>
              </div>
            </div>
            <div
              className="custom-descr text-center f-32 caps lh-105 -ls-02 sm-f-20"
              style={{ "--max-w": "24ch" } as CSSProperties}
            >
              <div className="rich-inherit w-richtext">
                <h3 aria-label="What our partners say">
                  <TextScramble text="What our partners say" className="w-inline-block" />
                </h3>
              </div>
            </div>
          </div>
          <div className="v-flex-stretch-top gap-24">
            <div className="splide" ref={rootRef}>
              <div className="testimonials_wrapper w-dyn-list splide__track">
                <div className="testimonials_list w-dyn-items splide__list">
                  {TESTIMONIALS.map((t) => (
                    <div key={t.author} className="testimonials_item-parent w-dyn-item splide__slide">
                      <div className="testimonials_item">
                        <div className="v-flex-left-top gap-40">
                          <div className="testimonials_icon">
                            <div className="svg w-embed">
                              <QuoteIcon />
                            </div>
                          </div>
                          <div className="testimonials_text">
                            <p className="f-24 lh-120 font-body -ls-02">{t.quote}</p>
                          </div>
                        </div>
                        <div className="h-flex-between-bottom sm-v-flex-right-top sm-gap-24">
                          <div className="testimonials_logo sm-order-last">
                            <TestimonialLogo src={t.image} />
                          </div>
                          <div className="v-flex-right-top gap-16">
                            <div className="testimonials_name">
                              <div className="f-14 font-mono lh-100 caps">{t.author}</div>
                            </div>
                            <div className="h-flex-left-stretch">
                              <div className="f-14 font-mono lh-120 caps">{t.role}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="h-flex-between-center">
              <div className="testimonials_indexes f-11 font-mono">
                <div data-current="">{current}</div>
                <div>/</div>
                <div data-length="">{TESTIMONIALS.length}</div>
              </div>
              <div className="testimonials_arrows">
                <div
                  data-prev=""
                  role="button"
                  aria-label="Previous testimonial"
                  className={`testimonials_arrow-parent${prevDisabled ? " inactive" : ""}`}
                  onClick={goPrev}
                >
                  <div className="testimonials_arrow">
                    <div className="svg w-embed">
                      <ArrowLeftIcon />
                    </div>
                  </div>
                </div>
                <div
                  data-next=""
                  role="button"
                  aria-label="Next testimonial"
                  className={`testimonials_arrow-parent${nextDisabled ? " inactive" : ""}`}
                  onClick={goNext}
                >
                  <div className="testimonials_arrow">
                    <div className="svg w-embed">
                      <ArrowRightIcon />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
