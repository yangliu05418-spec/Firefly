"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { LinkAnimation } from "../shared/TextScramble";
import { LogoPieces } from "../shared/LogoPieces";
import { useLenis } from "../shared/LenisProvider";

gsap.registerPlugin(ScrambleTextPlugin);

const SCRAMBLE_CHARS = "abcdefghijklmnopqrstuvwxyz";
const EMAIL = "js@ciridae.com";
const MAIL_COPIED = "Mail Copied";
/** zero-width joiner — the "hidden" line the target uses for popup bottom spacing */
const ZWJ = "‍";
/** pop directional formatting mark present verbatim in the target's tel href/label */
const PHONE_PDF = "‬";

const HEADING_LINES = [
  "We're here to help you unlock",
  "what's next.",
  "Drop us a line.",
];

const LOGO_PIECES = [
  {
    viewBox: "0 0 1000 1153",
    morph:
      "M490.5 195C490.5 189.477 494.977 185 500.5 185V185C506.023 185 510.5 189.477 510.5 195V195C510.5 200.523 506.023 205 500.5 205V205C494.977 205 490.5 200.523 490.5 195V195Z",
    start:
      "M696.243 195.315C696.243 197.944 694.108 200.078 691.478 200.078C597.635 200.078 550.523 200.078 528.091 222.506C505.659 244.934 505.659 292.019 505.659 385.865C505.659 388.495 503.525 390.629 500.895 390.629C498.265 390.629 496.13 388.495 496.13 385.865C496.13 292.019 496.13 244.934 473.718 222.506C451.286 200.078 404.174 200.078 310.311 200.078C307.681 200.078 305.547 197.944 305.547 195.315C305.547 192.685 307.681 190.551 310.311 190.551C404.174 190.551 451.286 190.551 473.718 168.123C496.13 145.695 496.13 98.61 496.13 4.76377C496.13 2.13417 498.265 0 500.895 0C503.525 0 505.659 2.13417 505.659 4.76377C505.659 98.61 505.659 145.695 528.091 168.123C550.523 190.551 597.635 190.551 691.478 190.551C694.108 190.551 696.243 192.685 696.243 195.315Z",
  },
  {
    viewBox: "0 0 1000 1153",
    morph:
      "M162 386C162 380.477 166.477 376 172 376V376C177.523 376 182 380.477 182 386V386C182 391.523 177.523 396 172 396V396C166.477 396 162 391.523 162 386V386Z",
    start:
      "M343.036 481.151C342.559 481.112 342.083 481.17 341.625 481.284C340.463 481.608 339.395 482.37 338.728 483.513C337.89 484.962 337.909 486.657 338.614 488.048C337.852 488.048 337.089 487.839 336.403 487.439C336.327 487.401 336.251 487.343 336.174 487.305C336.136 487.286 336.098 487.267 336.06 487.229C255.005 440.449 210.626 414.625 180.018 422.819C149.41 431.031 125.873 471.771 79.0088 552.908C79.0088 552.908 78.9326 553.041 78.9135 553.098C78.0178 554.623 76.4169 555.48 74.7779 555.48C73.9774 555.48 73.1579 555.27 72.3956 554.832C70.8709 553.956 70.0133 552.355 70.0133 550.716C70.0133 549.897 70.2229 549.078 70.6613 548.334C70.6803 548.277 70.7184 548.201 70.7566 548.163C70.8137 548.049 70.8518 547.972 70.909 547.877C117.659 466.912 141.12 426.21 132.925 395.646C124.711 365.006 83.9259 341.454 2.64206 294.54C1.11739 293.663 0.259766 292.063 0.259766 290.424C0.259766 289.605 0.469407 288.785 0.888691 288.023C2.22277 285.755 5.1387 284.974 7.40664 286.289C7.48288 286.327 7.55911 286.384 7.63534 286.422L7.74969 286.48C88.8048 333.279 129.532 356.755 160.121 348.542C190.729 340.348 214.285 299.609 261.13 218.472C261.13 218.472 261.207 218.339 261.245 218.281C262.56 216.014 265.476 215.233 267.744 216.547C269.268 217.424 270.126 219.025 270.126 220.663C270.126 221.483 269.916 222.302 269.497 223.045C269.459 223.102 269.421 223.16 269.383 223.217C269.325 223.331 269.287 223.407 269.23 223.484C222.48 304.468 199.019 345.169 207.214 375.734C215.428 406.374 259.903 432.274 341.168 479.188C342.006 479.664 342.635 480.35 343.036 481.151Z",
  },
  {
    viewBox: "0 0 1000 1153",
    morph:
      "M818 386C818 380.477 822.477 376 828 376V376C833.523 376 838 380.477 838 386V386C838 391.523 833.523 396 828 396V396C822.477 396 818 391.523 818 386V386Z",
    start:
      "M731.76 216.459C734.028 215.145 736.943 215.926 738.258 218.213C738.296 218.27 738.335 218.327 738.373 218.384C785.218 299.539 808.774 340.26 839.382 348.473C869.989 356.666 910.755 333.152 991.943 286.296C991.944 286.277 991.982 286.277 992.02 286.258C992.039 286.239 992.078 286.22 992.097 286.201C994.365 284.887 997.28 285.668 998.614 287.954C999.034 288.697 999.243 289.517 999.243 290.336H999.224C999.224 291.975 998.366 293.576 996.842 294.452C996.804 294.471 996.784 294.49 996.746 294.509C996.727 294.528 996.708 294.528 996.689 294.547C915.52 341.403 874.754 364.955 866.559 395.558C858.364 426.141 881.825 466.844 928.575 547.809C928.632 547.885 928.67 547.98 928.708 548.056H928.728C928.766 548.113 928.803 548.17 928.822 548.228C929.261 548.99 929.471 549.809 929.471 550.609C929.471 552.248 928.613 553.849 927.088 554.744C926.326 555.163 925.506 555.373 924.706 555.373C923.067 555.373 921.466 554.516 920.57 552.991C920.532 552.934 920.513 552.876 920.475 552.819C873.629 471.683 850.092 430.944 819.466 422.75C788.858 414.537 744.684 440.038 663.495 486.895C663.476 486.914 663.457 486.914 663.438 486.933C663.4 486.952 663.381 486.971 663.343 486.971C662.523 487.447 661.608 487.657 660.731 487.6C660.733 487.598 660.734 487.596 660.735 487.595L660.443 487.574C658.989 487.428 657.634 486.589 656.848 485.231C656.409 484.469 656.199 483.65 656.199 482.85C656.218 481.956 656.446 481.101 656.92 480.34L657.077 480.101C657.461 479.555 657.961 479.086 658.578 478.72C658.616 478.701 658.654 478.7 658.673 478.682C658.673 478.663 658.711 478.663 658.73 478.644C739.919 431.787 784.075 406.266 792.289 375.664C800.484 345.081 777.022 304.379 730.272 223.414C730.215 223.319 730.177 223.243 730.12 223.167C730.12 223.167 730.044 223.034 730.006 222.977C729.568 222.214 729.377 221.395 729.377 220.595C729.377 218.937 730.235 217.336 731.76 216.459Z",
  },
  {
    viewBox: "0 0 1000 1153",
    morph:
      "M489 577C489 571.477 493.477 567 499 567V567C504.523 567 509 571.477 509 577V577C509 582.523 504.523 587 499 587V587C493.477 587 489 582.523 489 577V577Z",
    start:
      "M337.064 478.422C337.521 478.308 337.998 478.25 338.474 478.288C339.237 478.307 339.98 478.517 340.685 478.917L420.331 524.896C469.349 553.174 529.706 553.137 578.686 524.802L657.798 479.012C658.594 478.559 659.46 478.351 660.296 478.38C660.297 478.378 660.299 478.375 660.301 478.373C660.398 478.378 660.496 478.386 660.593 478.396C662.094 478.522 663.507 479.349 664.335 480.746C665.23 482.289 665.154 484.081 664.315 485.529C664.313 485.534 664.276 485.607 664.239 485.644C663.858 486.31 663.305 486.863 662.581 487.282L582.974 533.338C534.109 561.597 503.996 613.808 504.015 670.249V761.809C504.015 762.799 503.73 763.714 503.216 764.477C502.358 765.734 500.928 766.572 499.289 766.572C498.412 766.572 497.612 766.343 496.926 765.943C496.106 765.467 495.439 764.781 495.039 763.942C494.696 763.314 494.524 762.571 494.524 761.809L494.486 669.944C494.486 613.446 464.317 561.273 415.394 533.033L335.921 487.168C335.082 486.692 334.435 485.987 334.053 485.186C333.348 483.796 333.329 482.099 334.168 480.651C334.835 479.508 335.902 478.746 337.064 478.422Z",
  },
];

const lineStyle: CSSProperties = { position: "relative", display: "block" };

/** Runtime-split char markup identical to the target's SplitText output (aria-hidden char divs). */
function CharSpans({ text, charClass }: { text: string; charClass?: string }) {
  return (
    <>
      {text.split("").map((c, i) => (
        <div
          key={i}
          className={charClass}
          aria-hidden="true"
          data-char={c}
          style={{ position: "relative", display: "inline-block" }}
        >
          {c}
        </div>
      ))}
    </>
  );
}

/**
 * Ciridae "DROP US A LINE" popup (target's Popup module).
 * Fixed full-screen overlay toggled by the nav; on open it runs the target's
 * GSAP entrance timeline (logo morph + scramble reveals) and the email button
 * copies JS@CIRIDAE.COM to the clipboard with a scramble in/out cycle.
 */
export function Popup({ active, onClose }: { active: boolean; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLDivElement>(null);
  const descrRef = useRef<HTMLDivElement>(null);
  const secondHeadingRef = useRef<HTMLDivElement>(null);
  const headingLinesRef = useRef<(HTMLDivElement | null)[]>([]);
  const btnWrapRef = useRef<HTMLDivElement>(null);
  const hoverTlRef = useRef<gsap.core.Timeline | null>(null);
  const busyRef = useRef(false);

  const [mailText, setMailText] = useState(EMAIL);
  const { start } = useLenis();

  // Entrance timeline (target's animateIn): scramble reveals with expo.out defaults.
  useEffect(() => {
    if (!active) return;
    const root = rootRef.current;
    if (!root) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out", duration: 0.8 } });
      const scramble = () => ({ chars: SCRAMBLE_CHARS, text: "{original}", speed: 0.5 });

      const descr = descrRef.current;
      if (descr) {
        const chars = descr.querySelectorAll<HTMLElement>("[data-char]");
        chars.forEach((c, i) => {
          const pos = i * 0.02 + 0.2;
          tl.fromTo(c, { autoAlpha: 0 }, { autoAlpha: 1 }, pos);
          tl.from(c, { scrambleText: scramble(), duration: 0.4, overwrite: "auto" }, pos);
        });
      }

      headingLinesRef.current.forEach((line, i) => {
        if (!line) return;
        const chars = line.querySelectorAll<HTMLElement>(".char");
        chars.forEach((c, o) => {
          const pos = Math.abs(o - chars.length / 2) * 0.02 + i * 0.1 + 0.4;
          tl.fromTo(c, { autoAlpha: 0 }, { autoAlpha: 1 }, pos);
          tl.from(c, { scrambleText: scramble(), duration: 0.4, overwrite: "auto" }, pos);
        });
      });

      const secondHeading = secondHeadingRef.current;
      if (secondHeading) {
        const chars = secondHeading.querySelectorAll<HTMLElement>("[data-char]");
        chars.forEach((c, o) => {
          const pos = Math.abs(o - chars.length / 2) * 0.02 + 0.6;
          tl.fromTo(c, { autoAlpha: 0 }, { autoAlpha: 1 }, pos);
          tl.from(c, { scrambleText: scramble(), duration: 0.4, overwrite: "auto" }, pos);
        });
      }

      const btn = btnWrapRef.current;
      if (btn) {
        tl.fromTo(btn, { autoAlpha: 0 }, { autoAlpha: 1 }, 0.5);
      }

      tl.play();
    }, root);
    return () => ctx.revert();
  }, [active]);

  // Close button overlaps the nav burger: position it over the burger rect.
  useEffect(() => {
    if (!active) return;
    const closeEl = closeRef.current;
    const navBurger = document.querySelector<HTMLElement>(".nav_burger");
    if (!closeEl || !navBurger) return;
    const r = navBurger.getBoundingClientRect();
    closeEl.style.top = `${Math.min(r.top, 10)}px`;
    closeEl.style.right = `${window.innerWidth - r.right}px`;
    closeEl.style.width = `${r.width}px`;
    closeEl.style.height = `${r.height}px`;
  }, [active]);

  // Email button hover scramble (target's btnTl).
  useEffect(() => {
    const wrap = btnWrapRef.current;
    if (!wrap) return;
    const onEnter = () => {
      if (busyRef.current) return;
      const chars = wrap.querySelectorAll<HTMLElement>("[data-char]");
      if (chars.length === 0) return;
      hoverTlRef.current?.kill();
      const tl = gsap.timeline();
      chars.forEach((c, i) => {
        tl.from(
          c,
          { scrambleText: { chars: SCRAMBLE_CHARS, text: "{original}", speed: 0.5 }, duration: 0.4, overwrite: "auto" },
          i * 0.02,
        );
      });
      hoverTlRef.current = tl;
    };
    wrap.addEventListener("mouseenter", onEnter);
    return () => {
      wrap.removeEventListener("mouseenter", onEnter);
      hoverTlRef.current?.kill();
    };
  }, []);

  // Click-to-copy cycle: scramble out -> "Mail Copied" -> hold -> back to email.
  const handleMailClick = () => {
    const wrap = btnWrapRef.current;
    if (!wrap || busyRef.current) return;
    busyRef.current = true;
    wrap.style.width = `${wrap.offsetWidth}px`;
    void navigator.clipboard.writeText(EMAIL);
    const chars = wrap.querySelectorAll<HTMLElement>("[data-char]");
    const leaveTl = gsap.timeline({
      onComplete: () => {
        setMailText(MAIL_COPIED);
      },
    });
    leaveTl.to(chars, { autoAlpha: 0, duration: 0.4, stagger: 0.02 });
    leaveTl.to(
      chars,
      { scrambleText: { chars: SCRAMBLE_CHARS, text: "{original}", speed: 0.5 }, duration: 0.4, stagger: 0.02 },
      "<",
    );
  };

  // Reveal the freshly swapped mail text, then leave it again (or finish).
  useLayoutEffect(() => {
    const wrap = btnWrapRef.current;
    if (!wrap || !busyRef.current) return;
    const chars = wrap.querySelectorAll<HTMLElement>("[data-char]");
    const copied = mailText === MAIL_COPIED;
    const tl = gsap.timeline({
      onComplete: () => {
        if (copied) {
          setMailText(EMAIL);
        } else {
          busyRef.current = false;
          wrap.style.width = "auto";
        }
      },
    });
    tl.fromTo(chars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, stagger: 0.02 });
    tl.from(
      chars,
      { scrambleText: { chars: SCRAMBLE_CHARS, text: "{original}", speed: 0.5 }, duration: 0.4, stagger: 0.02 },
      "<",
    );
    if (copied) {
      tl.to(chars, { autoAlpha: 0, duration: 0.4, stagger: 0.02 }, "+=1.5");
      tl.to(
        chars,
        { scrambleText: { chars: SCRAMBLE_CHARS, text: "{original}", speed: 0.5 }, duration: 0.4, stagger: 0.02 },
        "<",
      );
    }
    return () => {
      tl.kill();
    };
  }, [mailText]);

  const handleClose = () => {
    onClose();
    if (!document.body.classList.contains("burger-open")) {
      start();
    }
  };

  return (
    <div ref={rootRef} data-module="Popup" data-popup="join" className={`popup${active ? " active" : ""}`}>
      <div ref={closeRef} className="popup_close" onClick={handleClose}>
        <div className="f-14 font-mono caps lh-90" aria-label="close">
          <LinkAnimation>close</LinkAnimation>
        </div>
        <div className="popup_close-icon">
          <div className="popup_close-lines" />
          <div className="popup_close-lines is-2" />
        </div>
      </div>
      <div className="popup_body">
        {active && (
          <div className="popup_logo">
            <LogoPieces className="logo-small" pieces={LOGO_PIECES} />
          </div>
        )}
        <div className="popup_content">
          <div className="v-flex-center-top gap-48 mb-40 sm-mb-24 sm-gap-16">
            <div
              ref={descrRef}
              style={{ "--max-w": "32ch", "--sm-fixed-w": "20.4rem" } as CSSProperties}
              className="custom-descr text-center f-16 caps lh-90 -ls-02"
            >
              <div className="rich-inherit w-richtext">
                <p aria-label="Shift now">
                  <div aria-hidden="true" style={{ ...lineStyle, textAlign: "center" }}>
                    <CharSpans text="Shift now" />
                  </div>
                </p>
              </div>
            </div>
          </div>
          <div
            style={{ "--max-w": "22ch", "--sm-fixed-w": "22ch" } as CSSProperties}
            className="custom-descr text-center f-32 caps lh-90 -ls-02 mb-72 sm-mb-40"
          >
            <div className="rich-inherit w-richtext">
              <p aria-label="We're here to help you unlock what's next. Drop us a line.">
                {HEADING_LINES.map((line, i) => (
                  <div
                    key={i}
                    ref={(el) => {
                      headingLinesRef.current[i] = el;
                    }}
                    aria-hidden="true"
                    style={{
                      ...lineStyle,
                      textAlign: "center",
                      overflow: "hidden",
                      height: "0.9em",
                      width: "100%",
                    }}
                  >
                    <CharSpans text={line} charClass="char" />
                  </div>
                ))}
              </p>
            </div>
          </div>
          <div className="popup_btn" ref={btnWrapRef} onClick={handleMailClick}>
            <a href="#" data-wf--button--variant="base" className="button w-inline-block">
              <div className="button_text">
                <div className="f-14 font-mono caps lh-110" aria-label={mailText}>
                  <div aria-hidden="true" style={{ ...lineStyle, textAlign: "start", overflow: "hidden", height: "1em" }}>
                    <CharSpans text={mailText} />
                  </div>
                </div>
              </div>
            </a>
          </div>
        </div>
        <div className="popup_bottom grow">
          <div className="h-flex-left-bottom">
            <div className="f-11 lh-110 caps font-mono">The new intelligence</div>
          </div>
          <div className="burger_bottom-mid is-popup">
            <div className="popup_bottom-info">
              <div
                ref={secondHeadingRef}
                style={{ "--max-w": "31ch", "--sm-fixed-w": "31ch" } as CSSProperties}
                className="custom-descr text-center font-mono caps lh-110 f-14"
              >
                <div className="rich-inherit w-richtext">
                  <p aria-label={ZWJ}>
                    <div
                      aria-hidden="true"
                      style={{ ...lineStyle, textAlign: "center", overflow: "hidden", height: "0.9em", width: "100%" }}
                    >
                      <CharSpans text={ZWJ} charClass="char" />
                    </div>
                  </p>
                </div>
              </div>
              <a href={`tel:+16106089634${PHONE_PDF}`} className="text-link w-inline-block">
                <div className="caps lh-110 font-mono f-14" aria-label={`(610) 608-9634${PHONE_PDF}`}>
                  <LinkAnimation>{`(610) 608-9634${PHONE_PDF}`}</LinkAnimation>
                </div>
              </a>
            </div>
            <div className="dot" />
            <div className="v-flex-center-center">
              <a href="https://www.linkedin.com/company/ciridae/" className="text-link w-inline-block">
                <div className="caps lh-110 font-mono f-14" aria-label="Linkedin">
                  <LinkAnimation>Linkedin</LinkAnimation>
                </div>
              </a>
              <a href="https://x.com/TheCiridae" className="text-link w-inline-block">
                <div className="caps lh-110 font-mono f-14" aria-label="x">
                  <LinkAnimation>x</LinkAnimation>
                </div>
              </a>
            </div>
            <div className="dot" />
          </div>
          <div className="h-flex-right-bottom">
            <div className="f-11 lh-110 caps font-mono">
              All rights reserved <span data-year="">{new Date().getFullYear()}</span>©
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
