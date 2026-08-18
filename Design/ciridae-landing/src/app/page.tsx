"use client";

import { useEffect, useState } from "react";
import { LenisProvider } from "@/components/sites/ciridae-0e008832/shared/LenisProvider";
import { NewsBanner } from "@/components/sites/ciridae-0e008832/root-8a5edab2/NewsBanner";
import { Hero } from "@/components/sites/ciridae-0e008832/root-8a5edab2/Hero";
import { TeamSection } from "@/components/sites/ciridae-0e008832/root-8a5edab2/TeamSection";
import { Builds } from "@/components/sites/ciridae-0e008832/root-8a5edab2/Builds";
import { Points } from "@/components/sites/ciridae-0e008832/root-8a5edab2/Points";
import { QuoteEra } from "@/components/sites/ciridae-0e008832/root-8a5edab2/QuoteEra";
import { WeDo } from "@/components/sites/ciridae-0e008832/root-8a5edab2/WeDo";
import { Testimonials } from "@/components/sites/ciridae-0e008832/root-8a5edab2/Testimonials";
import { SecurityText } from "@/components/sites/ciridae-0e008832/root-8a5edab2/SecurityText";
import { Footer } from "@/components/sites/ciridae-0e008832/root-8a5edab2/Footer";
import { Burger } from "@/components/sites/ciridae-0e008832/root-8a5edab2/Burger";
import { Popup } from "@/components/sites/ciridae-0e008832/root-8a5edab2/Popup";

/**
 * ciridae.com home clone — section order mirrors the target's main
 * element: news banner, hero (nav + video), team marquee, builds,
 * points, quote, we-do, team 2, testimonials, security text, footer.
 */
export default function Home() {
  const [burgerOpen, setBurgerOpen] = useState(false);
  const [popupActive, setPopupActive] = useState(false);

  useEffect(() => {
    const onPopupOpen = () => setPopupActive(true);
    window.addEventListener("ciridae:popup-open", onPopupOpen);
    return () => window.removeEventListener("ciridae:popup-open", onPopupOpen);
  }, []);

  return (
    <LenisProvider>
      <div className="global">
        <Burger open={burgerOpen} />
        <Popup active={popupActive} onClose={() => setPopupActive(false)} />
      </div>
      <main className="main" data-transition-page="home">
        <NewsBanner />
        <Hero onBurgerToggle={setBurgerOpen} />
        <TeamSection variant="clients" />
        <Builds />
        <Points />
        <QuoteEra />
        <WeDo />
        <TeamSection variant="experts" />
        <Testimonials />
        <SecurityText />
        <Footer />
      </main>
    </LenisProvider>
  );
}
