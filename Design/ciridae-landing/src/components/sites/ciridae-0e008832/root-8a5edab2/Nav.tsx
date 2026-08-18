"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { useLenis } from "../shared/LenisProvider";
import { LinkAnimation } from "../shared/TextScramble";

gsap.registerPlugin(ScrambleTextPlugin);

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const MENU_TEXT = "Menu";
const CLOSE_TEXT = "close";
const SWAP_STAGGER = 0.02;

function randomChar(): string {
  return CHARS.charAt(Math.floor(Math.random() * CHARS.length));
}

/**
 * Site navigation (target: ciridae.com home nav).
 *
 * Scroll-driven color switch + hide-on-scroll-down are handled by the ported
 * CSS (`body.at-top`, `body.scroll-down`, `nav[data-color=...]`) and by
 * LenisProvider (which owns the body classes and the `data-color` attribute),
 * so the component only wires the click-driven parts:
 *
 * - `.nav_burger` click toggles `body.burger-open` and stops/starts Lenis.
 *   A MutationObserver keeps the MENU <-> CLOSE char scramble swap in sync
 *   with the body class, so it also reverts when the Burger overlay closes
 *   itself.
 * - `.btn` click opens the popup (`document.querySelector(".popup")` gets
 *   `.active`) and stops Lenis; the Popup restarts Lenis on close itself.
 * - Hover scrambles on the "start now" / "Menu" texts come from the shared
 *   LinkAnimation component; the glow hover is ported CSS.
 */
export function Nav({
  onBurgerToggle,
}: {
  onBurgerToggle?: (open: boolean) => void;
}) {
  const { stop, start } = useLenis();
  const navRef = useRef<HTMLElement>(null);
  const menuCharsHostRef = useRef<HTMLSpanElement>(null);
  const closeCharsRef = useRef<HTMLSpanElement[]>([]);
  const swapTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const burgerOpenRef = useRef(false);

  // MENU <-> CLOSE swap timeline (closed -> open direction). Reversed to
  // close: MENU chars scramble back in, CLOSE chars scramble out. The MENU
  // chars live inside the shared LinkAnimation (hover scramble), so they are
  // located via their data-char spans.
  useEffect(() => {
    const root = navRef.current;
    const menuChars = menuCharsHostRef.current
      ? Array.from(
          menuCharsHostRef.current.querySelectorAll<HTMLSpanElement>("span[data-char]"),
        )
      : [];
    const closeChars = closeCharsRef.current;
    if (!root || menuChars.length === 0 || closeChars.length === 0) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        paused: true,
        defaults: { duration: 0.4, ease: "none", overwrite: "auto" },
      });
      // MENU chars scramble out (autoAlpha handled per char so the reveal
      // mirrors the shared TextScramble pattern)
      menuChars.forEach((char, i) => {
        tl.to(
          char,
          {
            scrambleText: { text: randomChar(), chars: CHARS, speed: 0.5 },
            autoAlpha: 0,
          },
          i * SWAP_STAGGER,
        );
      });
      // CLOSE chars scramble in
      closeChars.forEach((char, i) => {
        tl.fromTo(
          char,
          {
            autoAlpha: 0,
            scrambleText: { text: randomChar(), chars: CHARS, speed: 0.5 },
          },
          {
            autoAlpha: 1,
            scrambleText: {
              text: char.dataset.char ?? "",
              chars: CHARS,
              speed: 0.5,
            },
          },
          0.1 + i * SWAP_STAGGER,
        );
      });
      swapTimelineRef.current = tl;
    }, root);

    return () => {
      ctx.revert();
      swapTimelineRef.current = null;
    };
  }, []);

  // Keep the swap in sync with body.burger-open. The burger click toggles
  // the class below; the Burger overlay also removes it when closing itself.
  useEffect(() => {
    const update = () => {
      const open = document.body.classList.contains("burger-open");
      if (open === burgerOpenRef.current) return;
      burgerOpenRef.current = open;
      const tl = swapTimelineRef.current;
      if (tl) tl.reversed(!open).play();
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const handleBurgerClick = () => {
    const open = !document.body.classList.contains("burger-open");
    document.body.classList.toggle("burger-open", open);
    if (open) {
      stop();
    } else {
      start();
    }
    onBurgerToggle?.(open);
  };

  const handleStartNowClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    // The page owns the popup state (React-controlled class); signal it.
    window.dispatchEvent(new CustomEvent("ciridae:popup-open"));
    stop();
  };

  return (
    <nav ref={navRef} className="nav is-draft-home-copy-offset" data-color="white">
      <div className="nav_body">
        <div className="h-flex-left-center">
          <a href="mailto:info@ciridae.com" className="button w-inline-block">
            <div className="button_text">
              <div className="f-14 font-mono caps lh-110">start now</div>
            </div>
          </a>
          <a
            href="mailto:info@ciridae.com"
            className="btn absolute-hidden w-inline-block"
            onClick={handleStartNowClick}
          >
            <div className="btn_text">
              <div className="f-14 no-break font-mono caps lh-110" aria-label="start now">
                <LinkAnimation>start now</LinkAnimation>
              </div>
            </div>
          </a>
        </div>
        <Link href="/" aria-current="page" className="nav_logo w-inline-block w--current" />
        <div className="h-flex-right-center">
          <div className="nav_burger" onClick={handleBurgerClick}>
            <div className="btn_text sm-hide">
              <div className="f-14 font-mono caps lh-110" aria-label="Menu">
                <span
                  ref={menuCharsHostRef}
                  aria-hidden="true"
                  style={{ position: "relative", display: "block", textAlign: "start" }}
                >
                  <LinkAnimation>{MENU_TEXT}</LinkAnimation>
                </span>
              </div>
            </div>
            <div className="btn_text-close f-14 font-mono caps lh-110" aria-label="close">
              <div
                aria-hidden="true"
                style={{ position: "relative", display: "block", textAlign: "start" }}
              >
                {CLOSE_TEXT.split("").map((char, i) => (
                  <span
                    key={i}
                    ref={(el) => {
                      if (el) closeCharsRef.current[i] = el;
                    }}
                    aria-hidden="true"
                    data-char={char}
                    style={{
                      position: "relative",
                      display: "inline-block",
                      opacity: 0,
                      visibility: "hidden",
                    }}
                  >
                    {char}
                  </span>
                ))}
              </div>
            </div>
            <div className="nav_burger-lines">
              <div className="nav_burger-line" />
              <div className="nav_burger-line" />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
