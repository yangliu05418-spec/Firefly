# Points Section Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Points.tsx`
- **Screenshots:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-04-points-1.png`, `sec-04-points-2.png`, `sec-04-points-3.png`
- **Interaction model:** scroll-driven (sticky pin 250vh, scrubbed bg zoom + staggered card entrances) + hover (logo texture crossfade, pure CSS ported)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/04-points.html`

## Structure
`<section change-nav-color="white" class="section">` → `<div class="container">` → `<div class="points">` (height 250vh; margin-top -100vh — ported css; --scale: .1 initial — ported)
- `<div class="points_sticky">` (sticky top 0, height 100vh, flex row justify/align center)
  - `<div class="points_bg-parent">` (absolute, inset 0 -20px, z1, overflow hidden; ported mask-image linear-gradient(#000 0 70%, transparent 100%))
    - `<img src="/sites/ciridae-0e008832/root-8a5edab2/images/Hero.webp" class="img-cover" loading="lazy" />` (object-fit cover, 100% size)
  - `<div class="points_content">` (z2, grid 3 cols gap 20px, align-self center; 1fr 1fr 1fr)
    - 3× `<div class="points_item">` (aspect-ratio 453/595, padding 32px 0, border-radius 10px, bg rgba(173,173,173,.2), backdrop-filter blur(50px), color white, flex column justify space-between align center — ported css)
      - `<div class="v-flex-center-top gap-40">` (flex col align center gap 40px)
        - index: `<div class="f-16 caps ...">01</div>` (copy classes from extract)
        - title: `<div class="custom-descr text-center f-16 caps lh-120 -ls-02">Redesign the process</div>` (copy classes; 16px Pragmatica, caps)
      - `<div class="points_logo">` (width 7.75rem=124px, position relative) → `<div class="logo-pieces">` — logo piece SVGs (copy from extract 04-points.html; each item has its own set — item 1 & 3 share pieces A with `.top/.let-bot/.right-bot` classes, item 2 has `.bot/.top-right/.top-left` — copy EXACTLY including piece classes; ported CSS sets per-piece opacity .1 + hover states + texture crossfade + item 3 logo rotate(180deg))
      - `<div class="points_bottom f-15 lh-120 -ls-01 font-body">` (width 364px, opacity .8, text-align center — ported) → `<p>` description (15px Pragmatica, lh 18px, ls -0.01em)
- Item content (verbatim):
  1. index "01", title "Redesign the process", desc "The blueprint for an AI-first operation: engineers and business partners embed with your team, understand your operations, and deliver the plan. Estimated financial uplift, strategically scoped human and AI interactions, and a clearly mapped timeline."
  2. index "02", title "AI operates the business", desc "We build the operating system that runs your business. AI handles the scheduling, the close, the procurement, and the reporting. The work your team used to do manually. Custom software, shipped in weeks, on our platform."
  3. index "03", title "Humans operate the AI", desc "The scheduler that used to build schedules now approves the ones the AI proposes. The controller that used to close the books now reviews the close the AI ran. Faster results, without the slog."

## Scroll behavior (GSAP ScrollTrigger scrub, trigger `.points`, start "top top", end "bottom bottom")
Verified live observations (use as exact keyframes):
- bg-parent: `scale(1.2)` at progress 0 → `scale(1.0751)` at progress ~0.45 → `scale(~1.0)` at progress 1 (transform scale via gsap on the element, translate3d 0)
- items: translateY 1750px at progress 0 → 0 by end, STAGGERED: item1 = 1036px, item2 = 1370px, item3 = 1750px when item-scrub at progress ~0.45. Implement: each item i has its own sub-window: item i enters over progress [i*0.16, i*0.16+0.35] — translateY 1750→0 with ease none (scrub). (Tune in QA to match.)
- items initial style (server-render): `transform: translateY(1750px)`? NO — render normal; gsap sets initial at progress 0 on load via ScrollTrigger scrub (use immediateRender). Keep components SSR-safe (gsap in useEffect, useGSAP-like).

## Hover behavior
Pure CSS ported: `.points_item:hover .points_logo:before/:after` texture crossfade (TextureStep1/4/8.png — already referenced in ported CSS but URLs point at webflow CDN — OVERRIDE in component CSS module? NO: add a small CSS override in globals? Simplest: the ported rules reference remote textures; add local overrides inside this component with <style>? Not allowed (no inline styles per code style). ADD to ciridae-behaviors.css: `.points_item:nth-child(1) .points_logo:before, .points_item:nth-child(3) .points_logo:before { background-image: url(/sites/ciridae-0e008832/root-8a5edab2/images/TextureStep8.png) }` etc. — DO THIS in the component file via a `"use client"` + it's fine to extend globals.css. Coordinate: BUILDER edits `src/styles/ciridae-behaviors.css` appending 3 local texture overrides (Step8 for items 1&3, Step4 for item 2, Step1 for :after all items).

## Assets
- bg image: `/sites/ciridae-0e008832/root-8a5edab2/images/Hero.webp`
- textures: `/sites/ciridae-0e008832/root-8a5edab2/images/TextureStep1.png`, `TextureStep4.png`, `TextureStep8.png`

## Responsive
- ≤991px (ported css): points height auto; sticky static; content flex column gap 12px, padding 5rem 0; items padding 0 20px; bg-parent sticky 100vh margin -10px.

## Export contract
```ts
export function Points()
```
