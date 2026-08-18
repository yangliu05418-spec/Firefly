"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ElementType, type Ref } from "react";
import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { Nav } from "./Nav";
import { LogoPieces, type LogoPieceData } from "../shared/LogoPieces";
import { useLenis } from "../shared/LenisProvider";

gsap.registerPlugin(ScrambleTextPlugin);

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomChar(): string {
  return CHARS.charAt(Math.floor(Math.random() * CHARS.length));
}

const HERO_VIDEO = "/sites/ciridae-0e008832/root-8a5edab2/videos/hero_web.mp4";
const HERO_POSTER = "/sites/ciridae-0e008832/root-8a5edab2/images/video-placeholder.webp";

/** The four logo pieces (target markup: viewBox, data-morph, d; data-start present on the first). */
const HERO_PIECES: LogoPieceData[] = [
  {
    viewBox: "0 0 1000 1153",
    morph: "M490 195C490 189.477 494.477 185 500 185V185C505.523 185 510 189.477 510 195V195C510 200.523 505.523 205 500 205V205C494.477 205 490 200.523 490 195V195Z",
    start: "M695.742 195.315C695.742 197.944 693.607 200.078 690.977 200.078C597.134 200.078 550.022 200.078 527.59 222.506C505.158 244.934 505.158 292.019 505.158 385.865C505.158 388.495 503.024 390.629 500.394 390.629C497.764 390.629 495.629 388.495 495.629 385.865C495.629 292.019 495.629 244.934 473.217 222.506C450.785 200.078 403.673 200.078 309.81 200.078C307.18 200.078 305.046 197.944 305.046 195.315C305.046 192.685 307.18 190.551 309.81 190.551C403.673 190.551 450.785 190.551 473.217 168.123C495.629 145.695 495.629 98.61 495.629 4.76377C495.629 2.13417 497.764 0 500.394 0C503.024 0 505.158 2.13417 505.158 4.76377C505.158 98.61 505.158 145.695 527.59 168.123C550.022 190.551 597.134 190.551 690.977 190.551C693.607 190.551 695.742 192.685 695.742 195.315Z",
  },
  {
    viewBox: "0 0 1000 1153",
    morph: "M162 386C162 380.477 166.477 376 172 376V376C177.523 376 182 380.477 182 386V386C182 391.523 177.523 396 172 396V396C166.477 396 162 391.523 162 386V386Z",
    start: "M343.036 481.151C342.56 481.112 342.084 481.17 341.626 481.284C340.464 481.608 339.396 482.37 338.729 483.513C337.891 484.962 337.91 486.657 338.615 488.048C337.853 488.048 337.09 487.839 336.404 487.439C336.328 487.401 336.252 487.343 336.175 487.305C336.137 487.286 336.099 487.267 336.061 487.229C255.006 440.449 210.627 414.625 180.019 422.819C149.411 431.031 125.874 471.771 79.0098 552.908C79.0098 552.908 78.9336 553.041 78.9145 553.098C78.0188 554.623 76.4179 555.48 74.7788 555.48C73.9784 555.48 73.1589 555.27 72.3966 554.832C70.8719 553.956 70.0143 552.355 70.0143 550.716C70.0143 549.897 70.2239 549.078 70.6622 548.334C70.6813 548.277 70.7194 548.201 70.7575 548.163C70.8147 548.049 70.8528 547.972 70.91 547.877C117.66 466.912 141.121 426.21 132.926 395.646C124.712 365.006 83.9268 341.454 2.64303 294.54C1.11837 293.663 0.260742 292.063 0.260742 290.424C0.260742 289.605 0.470384 288.785 0.889667 288.023C2.22375 285.755 5.13968 284.974 7.40762 286.289C7.48385 286.327 7.56009 286.384 7.63632 286.422L7.75067 286.48C88.8058 333.279 129.533 356.755 160.122 348.542C190.73 340.348 214.286 299.609 261.131 218.472C261.131 218.472 261.207 218.339 261.246 218.281C262.561 216.014 265.477 215.233 267.745 216.547C269.269 217.424 270.127 219.025 270.127 220.663C270.127 221.483 269.917 222.302 269.498 223.045C269.46 223.102 269.422 223.16 269.384 223.217C269.326 223.331 269.288 223.407 269.231 223.484C222.481 304.468 199.02 345.169 207.215 375.734C215.429 406.374 259.904 432.274 341.169 479.188C342.007 479.664 342.636 480.35 343.036 481.151Z",
  },
  {
    viewBox: "0 0 1000 1153",
    morph: "M818 386C818 380.477 822.477 376 828 376V376C833.523 376 838 380.477 838 386V386C838 391.523 833.523 396 828 396V396C822.477 396 818 391.523 818 386V386Z",
    start: "M731.759 216.459C734.027 215.145 736.942 215.926 738.257 218.213C738.295 218.27 738.334 218.327 738.372 218.384C785.217 299.539 808.773 340.26 839.381 348.473C869.989 356.666 910.754 333.152 991.942 286.296C991.943 286.277 991.981 286.277 992.019 286.258C992.038 286.239 992.077 286.22 992.096 286.201C994.364 284.887 997.279 285.668 998.613 287.954C999.033 288.697 999.242 289.517 999.242 290.336H999.223C999.223 291.975 998.365 293.576 996.841 294.452C996.803 294.471 996.783 294.49 996.745 294.509C996.726 294.528 996.707 294.528 996.688 294.547C915.519 341.403 874.753 364.955 866.558 395.558C858.363 426.141 881.824 466.844 928.574 547.809C928.631 547.885 928.669 547.98 928.707 548.056H928.727C928.765 548.113 928.802 548.17 928.821 548.228C929.26 548.99 929.47 549.809 929.47 550.609C929.47 552.248 928.612 553.849 927.087 554.744C926.325 555.163 925.505 555.373 924.705 555.373C923.066 555.373 921.465 554.516 920.569 552.991C920.531 552.934 920.512 552.877 920.474 552.819C873.628 471.683 850.092 430.944 819.465 422.75C788.857 414.537 744.683 440.038 663.494 486.895C663.475 486.914 663.456 486.914 663.437 486.933C663.399 486.952 663.38 486.971 663.342 486.971C662.522 487.447 661.607 487.657 660.73 487.6C660.732 487.598 660.733 487.596 660.734 487.595L660.442 487.574C658.988 487.428 657.633 486.589 656.847 485.231C656.408 484.469 656.198 483.65 656.198 482.85C656.217 481.956 656.445 481.101 656.919 480.34L657.076 480.101C657.46 479.555 657.96 479.086 658.577 478.72C658.615 478.701 658.653 478.7 658.672 478.682C658.672 478.663 658.71 478.663 658.729 478.644C739.918 431.787 784.074 406.267 792.288 375.664C800.483 345.081 777.021 304.379 730.271 223.414C730.214 223.319 730.176 223.243 730.119 223.167C730.119 223.167 730.043 223.034 730.005 222.977C729.567 222.214 729.376 221.395 729.376 220.595C729.376 218.937 730.234 217.336 731.759 216.459Z",
  },
  {
    viewBox: "0 0 1000 1153",
    morph: "M489 577C489 571.477 493.477 567 499 567V567C504.523 567 509 571.477 509 577V577C509 582.523 504.523 587 499 587V587C493.477 587 489 582.523 489 577V577Z",
    start: "M337.063 478.422C337.521 478.308 337.997 478.25 338.474 478.288C339.236 478.307 339.979 478.517 340.685 478.917L420.329 524.896C469.347 553.174 529.706 553.137 578.686 524.802L657.796 479.012C658.593 478.559 659.459 478.351 660.295 478.38C660.296 478.378 660.298 478.375 660.3 478.373C660.397 478.378 660.495 478.386 660.592 478.396C662.093 478.522 663.506 479.349 664.333 480.746C665.229 482.29 665.153 484.081 664.314 485.529C664.313 485.533 664.275 485.606 664.238 485.644C663.857 486.31 663.304 486.863 662.58 487.282L582.974 533.338C534.108 561.597 503.996 613.808 504.015 670.249V761.809C504.015 762.799 503.728 763.714 503.214 764.477C502.356 765.734 500.927 766.572 499.288 766.572C498.411 766.572 497.611 766.344 496.925 765.943C496.105 765.467 495.438 764.781 495.038 763.942C494.695 763.314 494.523 762.571 494.523 761.809L494.485 669.944C494.485 613.446 464.316 561.273 415.394 533.033L335.92 487.168C335.081 486.692 334.434 485.986 334.053 485.186C333.348 483.795 333.329 482.099 334.167 480.651C334.834 479.508 335.901 478.746 337.063 478.422Z",
  },
];

/** CIRIDAE wordmark paths (target: .text-logo svg, viewBox 0 0 136 20, fill currentColor). */
const WORDMARK_PATHS: string[] = [
"M0.925781 10.3626C0.925781 4.85665 4.56026 0.726563 9.57057 0.726563L20.9696 0.726563V4.58045L11.4988 4.58045C9.54475 4.58045 8.44254 5.68267 8.44254 7.63672L8.44254 13.0884C8.44254 15.0167 9.54475 16.1447 11.4988 16.1447L20.9696 16.1447V19.9986L9.57057 19.9986C4.56026 19.9986 0.925781 15.8685 0.925781 10.3626Z",
"M23.6406 0.726562L30.525 0.726563L30.525 19.9986H23.6406L23.6406 0.726562Z",
"M33.5547 0.726562L50.075 0.726563C53.4333 0.726563 55.8855 3.09361 55.8855 6.28927C55.8855 9.48492 53.4359 11.852 50.075 11.852H48.534L56.2443 20.0012H47.6254L40.3564 11.63V20.0012H33.5547V0.729146V0.726562ZM40.3564 4.27844V9.15194H46.4147C47.8474 9.15194 48.645 8.40852 48.645 7.11529V6.31766C48.645 5.05024 47.8474 4.28102 46.4147 4.28102L40.3564 4.28102V4.27844Z",
"M57.9766 0.726562L64.8609 0.726563V19.9986H57.9766V0.726562Z",
"M67.8868 0.72641L81.6529 0.72641C86.6632 0.72641 90.2977 4.8565 90.2977 10.3624C90.2977 15.8683 86.6632 19.9984 81.6529 19.9984L67.8868 19.9984V0.72641ZM82.7809 13.4471V7.28034C82.7809 5.3263 81.6529 4.22407 79.7246 4.22407L74.6859 4.22407V16.5033H79.7246C81.6529 16.5033 82.7809 15.3753 82.7809 13.4471Z",
"M98.5596 0.726563L106.353 0.726563L115.385 19.9986H107.979L106.244 16.0621L96.2777 16.0621L94.4605 19.9986H89.5586L98.5622 0.726563H98.5596ZM104.561 12.2908L101.311 5.05025L97.9788 12.2908H104.559H104.561Z",
"M117.004 0.726562L135.23 0.726563V4.49784L123.723 4.49784V8.13232L135.23 8.13232V11.8494L123.723 11.8494V16.1989L135.23 16.1989V19.9986L117.004 19.9986V0.726562Z"
];

/**
 * Splits text into per-character inline-blocks exactly like the target's
 * runtime SplitText output: aria-label on the wrapper, aria-hidden line div,
 * characters as inline-block divs with spaces as plain text nodes.
 */
function ScrambleLine({
  text,
  className,
  tag: Tag = "div",
  center = false,
  lineRef,
}: {
  text: string;
  className?: string;
  tag?: ElementType;
  center?: boolean;
  lineRef?: Ref<HTMLDivElement>;
}) {
  return (
    <Tag aria-label={text} className={className}>
      <div
        ref={lineRef}
        aria-hidden="true"
        style={{
          position: "relative",
          display: "block",
          textAlign: center ? "center" : "left",
          ...(center ? { overflow: "hidden", height: "1em" } : null),
        }}
      >
        {text.split("").map((c, i) =>
          c === " " ? (
            " "
          ) : (
            <div key={i} aria-hidden="true" style={{ position: "relative", display: "inline-block" }}>
              {c}
            </div>
          ),
        )}
      </div>
    </Tag>
  );
}

export function Hero({ onBurgerToggle }: { onBurgerToggle?: (open: boolean) => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  const leftLineRef = useRef<HTMLDivElement>(null);
  const rightLineRef = useRef<HTMLDivElement>(null);
  const middleLineRef = useRef<HTMLDivElement>(null);
  const lenis = useLenis();

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const bg = section.querySelector<HTMLElement>(".hero_bg");
    const logo = section.querySelector<HTMLElement>(".hero_logo");
    const nav = section.querySelector<HTMLElement>("nav");
    if (!bg || !logo || !nav) return;

    // Freeze the middle line at its natural width so the scramble does not
    // reflow the centered block (the target sets an explicit measured width).
    const middleLine = middleLineRef.current;
    if (middleLine) {
      const freeze = () => {
        middleLine.style.width = `${middleLine.offsetWidth}px`;
      };
      freeze();
      if (document.fonts) {
        void document.fonts.ready.then(freeze);
      }
    }

    const ctx = gsap.context(() => {
      gsap.set(bg, { autoAlpha: 0 });

      if (!lenis.lenis) return;

      const charsOf = (line: HTMLDivElement | null) =>
        line
          ? Array.from(line.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
          : [];
      const leftChars = charsOf(leftLineRef.current);
      const rightChars = charsOf(rightLineRef.current);
      const middleChars = charsOf(middleLineRef.current);

      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: "power2", duration: 0.8 },
        onStart: () => {
          lenis.stop();
          gsap.set(logo, { filter: "blur(20px)" });
        },
        onComplete: () => {
          lenis.start();
        },
      });

      const scramble = { chars: CHARS, text: randomChar(), speed: 0.5 };

      tl.fromTo(bg, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1 }, 0.3)
        .fromTo(logo, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1 }, 0.3)
        .to(logo, { filter: "blur(0px)", duration: 2.2 }, "<")
        .from(leftChars, { scrambleText: { ...scramble }, duration: 0.4, stagger: 0.01 }, "<0.2")
        .fromTo(leftChars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, stagger: 0.01 }, "-=0.8")
        .from(rightChars, { scrambleText: { ...scramble }, duration: 0.4, stagger: 0.01 }, "<0.1")
        .fromTo(rightChars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, stagger: 0.01 }, "<0.1")
        .from(middleChars, { scrambleText: { ...scramble }, duration: 0.4, stagger: 0.01 }, "<0.2")
        .fromTo(middleChars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, stagger: 0.01 }, "<")
        .fromTo([bg, nav], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: "power1" }, "<");

      const playTimer = window.setTimeout(() => tl.play(), 10);
      const safetyTimer = window.setTimeout(() => {
        gsap.set(logo, { filter: "blur(0px)" });
        lenis.start();
      }, 3000);

      return () => {
        window.clearTimeout(playTimer);
        window.clearTimeout(safetyTimer);
        tl.kill();
      };
    }, section);

    return () => ctx.revert();
  }, [lenis]);

  return (
    <section change-nav-color="white" data-bg={HERO_POSTER} className="section" ref={sectionRef}>
      <div className="container">
        <div className="hero">
          <Nav onBurgerToggle={onBurgerToggle} />
          <div />
          <div className="future_grid">
            <div className="future_split">
              <div className="relative">
                <ScrambleLine text="automate the mundane" className="f-16 caps lh-110" lineRef={leftLineRef} />
              </div>
            </div>
            <div className="v-flex-center-center">
              <div className="hero_logo">
                <div className="logo-pieces">
                  <LogoPieces pieces={HERO_PIECES} />
                  <div className="logo-piece_chars">
                    <div className="text-logo">
                      <div className="svg w-embed">
                        <svg width="100%" height="100%" viewBox="0 0 136 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          {WORDMARK_PATHS.map((d) => (
                            <path key={d} d={d} fill="currentColor" />
                          ))}
                        </svg>
                      </div>
                    </div>
                  </div>
                  <svg viewBox="0 0 1000 1153" data-morph="" className="logo-piece">
                    <path fill="currentColor" d="" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="future_split is-right">
              <div className="relative">
                <ScrambleLine text="accelerate the remarkable" className="f-16 caps lh-110" lineRef={rightLineRef} />
              </div>
            </div>
          </div>
          <div className="v-flex-center-top">
            <div
              style={{ "--max-w": "50ch" } as CSSProperties}
              data-module=""
              className="custom-descr text-center caps f-16 lh-100 -ls-02"
            >
              <div className="rich-inherit w-richtext">
                <ScrambleLine text="Today's Economy demands" tag="h3" center lineRef={middleLineRef} />
                <p>{"AI\u00A0Transformation."}</p>
                <p>Start now.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="hero_bg">
        <video loop muted playsInline autoPlay crossOrigin="anonymous" poster={HERO_POSTER} className="video">
          <source src={HERO_VIDEO} type="video/mp4" />
        </video>
      </div>
    </section>
  );
}
