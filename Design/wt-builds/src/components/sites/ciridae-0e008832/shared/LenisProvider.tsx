"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);

interface LenisContextValue {
  lenis: Lenis | null;
  stop: () => void;
  start: () => void;
}

const LenisContext = createContext<LenisContextValue>({
  lenis: null,
  stop: () => {},
  start: () => {},
});

export function useLenis(): LenisContextValue {
  return useContext(LenisContext);
}

/**
 * Target's Scroll module: Lenis (duration 1.4, easeOutExpo, smoothWheel,
 * wheelMultiplier 1.6) driven by the GSAP ticker, kept in sync with
 * ScrollTrigger. Also manages the body scroll-state classes the target uses:
 *  - `at-top`      when scrollY is 0
 *  - `scroll-down` while scrolling down (nav hides)
 *  - `past-first`  after passing the first viewport (nav logo visibility)
 * and the nav `data-color` switch driven by sections' `change-nav-color`
 * attributes.
 */
export function LenisProvider({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const lastScrollRef = useRef(0);

  useEffect(() => {
    const instance = new Lenis({
      duration: 1.4,
      easing: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1.6,
    });
    lenisRef.current = instance;
    setLenis(instance);

    gsap.ticker.add((time) => {
      instance.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
    instance.on("scroll", ScrollTrigger.update);

    const updateBodyState = () => {
      const y = window.scrollY;
      const body = document.body;
      if (y < 1) {
        body.classList.add("at-top");
      } else {
        body.classList.remove("at-top");
      }
      if (y > window.innerHeight * 0.5) {
        body.classList.add("past-first");
      } else {
        body.classList.remove("past-first");
      }
      if (y > lastScrollRef.current && y > 2) {
        body.classList.add("scroll-down");
      } else {
        body.classList.remove("scroll-down");
      }
      lastScrollRef.current = y;
    };

    const updateNavColor = () => {
      const nav = document.querySelector<HTMLElement>("nav");
      if (!nav) return;
      const mid = window.innerHeight * 0.5;
      const sections = [
        ...document.querySelectorAll<HTMLElement>("main section[change-nav-color]"),
      ];
      let color = "white";
      for (const s of sections) {
        const r = s.getBoundingClientRect();
        if (r.top <= mid && r.bottom > mid) {
          color = s.getAttribute("change-nav-color") ?? "white";
          break;
        }
      }
      nav.dataset.color = color;
    };

    const onScroll = () => {
      updateBodyState();
      updateNavColor();
    };
    instance.on("scroll", onScroll);
    updateBodyState();
    updateNavColor();

    const onResize = () => {
      ScrollTrigger.refresh();
      updateNavColor();
    };
    window.addEventListener("resize", onResize);

    // page loader gate: target hides main/nav until its entrance timeline runs
    document.querySelector("main")?.setAttribute("style", "visibility: visible");
    document.querySelector("nav")?.setAttribute("style", "visibility: visible");

    return () => {
      window.removeEventListener("resize", onResize);
      gsap.ticker.remove((time) => {
        instance.raf(time * 1000);
      });
      instance.destroy();
      lenisRef.current = null;
    };
  }, []);

  return (
    <LenisContext.Provider
      value={{
        lenis,
        stop: () => lenisRef.current?.stop(),
        start: () => lenisRef.current?.start(),
      }}
    >
      {children}
    </LenisContext.Provider>
  );
}
