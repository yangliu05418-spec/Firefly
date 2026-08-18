# Testimonials Section Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Testimonials.tsx`
- **Screenshots:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-08-testimonials-1.png`, `sec-08-testimonials-2.png`
- **Interaction model:** click-driven (Splide carousel with custom arrows) + scroll reveal on heading
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/09-testimonials.html`

## Structure
`<section change-nav-color="white" data-module="TestimonialsSplide" class="section section-space">` → `<div class="container">` → `<div class="testimonials">`
- heading block: `v-flex-center-top gap-40 sm-gap-30` → label `custom-descr text-center f-14 caps lh-90 -ls-02 font-mono` "TESTIMONIALS" + heading `custom-descr text-center f-32 caps lh-105 -ls-02 sm-f-20` "WHAT OUR PARTNERS SAY" (TextScramble reveals)
- carousel block: `v-flex-stretch-top gap-24` → splide structure (copy classes from extract):
  - `.splide` root (class list incl. splide--slide — use @splidejs/splide with type:"slide")
  - `.testimonials_wrapper w-dyn-list splide__track` → `.testimonials_list w-dyn-items splide__list` → 6 slides `.testimonials_item-parent w-dyn-item splide__slide`
    - each: `.testimonials_item` → `v-flex-left-top gap-40` (testimonials_icon svg — copy inline SVG from extract — + testimonials_text with `<p class="f-24 lh-120 font-body -ls-02">` quote) + `h-flex-between-bottom sm-v-flex-right-top sm-gap-24` (testimonials_logo img + name block: `testimonials_name` + `f-14 font-mono lh-100 caps` author + role line — copy classes)
  - arrows + counter: copy `.testimonials_arrow-parent` ×2 (prev/next — inline arrow SVGs) + counter "1 / 6" markup from extract (custom classes)
- Slide data (verbatim; images = client logos in `/sites/ciridae-0e008832/root-8a5edab2/images/`):
  1. quote "What sets Ciridae apart is how fast they think and how fast they build. Their technical capabilities are legitimately impressive. Not just impressive for an AI startup, just impressive full stop. They feel less like a vendor and more like a true transformation partner genuinely invested in driving value." — author "Jarryd Hill", role "Chief Operating Officer of Atom", logo atom_logo.png
  2. quote "Ciridae's system isn't just transformational for us—it's revolutionary." — "Bryan Knodel", "CFO of Knight Commercial", logo KNIGHT-COMMERCIAL.png
  3. quote "Ciridae shipped high-impact solutions quickly and helped architect our long-term AI strategy. They're simply the best; true partners every step of the way." — "Francesco Boccardo", "HEAD OF GEN AI AT BV TECH", logo BV-TECH-1.png
  4. quote "Ciridae was so good we wanted them on our cap table. In just one month, Ciridae quickly understood our business, identified the biggest generative AI opportunities and risks, and gave us a clear path toward becoming an AI-first company." — "JOSH ALBOM", "CEO OF FACTUA", logo factua-logo-1.png
  5. quote "This is the best vendor experience we've ever had. I wouldn't have thought 80% of the capabilities being delivered were possible just 9 months ago." — "Finance Team", "Construction Services", NO logo image (the 2 placeholder imgs are `w-dyn-bind-empty` Webflow placeholders — omit them; leave logo slot empty)
  6. quote "Using Ciridae's platform was so easy, I thought I missed a step." — "Account Executive", "Construction Services", no logo
  (verify quote→author mapping order in extract file)

## Behaviors
- Splide options: type "slide", perPage 1, perMove 1, gap 24px (target uses custom arrows + counter; hide default pagination/arrows — ported CSS already hides them). Track overflow visible (ported css `.testimonials .splide__track{overflow:visible}`).
- Active slide: `.testimonials_item-parent.active` → inner opacity 1 (non-active .7 — ported css). Add `active` class to current slide + remove from others on move events.
- Arrows: click → splide.go('+1'/'-1'); disabled state: add `.inactive` when at ends (ported css dims + pointer-events none); hover bg charcoal (ported).
- Counter text: currentIndex+1 + " / " + length, updates on move.

## Responsive
- ≤991px: extract classes (sm-*) — copy from extract file.

## Export contract
```ts
export function Testimonials()
```
