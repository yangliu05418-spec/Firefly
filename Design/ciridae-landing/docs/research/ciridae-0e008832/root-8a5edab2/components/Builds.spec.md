# Builds Section Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Builds.tsx`
- **Screenshots:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-03-builds-1.png`, `sec-03-builds-2.png`
- **Interaction model:** scroll-driven (sticky pin 250vh, scrubbed logo/mask/text animations)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/03-builds.html` (heading text, logo pieces, mask defs) + `extract/runtime-masks.html` (runtime `#logo-mask` clipPath, `builds_svg` embed)

## Structure
`<section change-nav-color="white" class="section">` → `<div class="container">` → `<div class="builds">` (height 250vh, position relative; section z-index 2 — ported css)
- `<div class="builds_svg w-embed">` — the SVG defs: copy the `<clipPath clipPathUnits="objectBoundingBox" id="logo-mask" transform="scale(0.001, 0.000867)">` with ALL its paths from extract/runtime-masks.html (the builds_svg w-embed block). This is REQUIRED by ported CSS `.builds_mask-parent{clip-path:url(#logo-mask)}`.
- `<div class="builds_sticky">` (sticky top 0, height 100vh, overflow clip, margin 0 -20px)
  - `<div class="builds_canvas">` — EMPTY container, absolute inset 0, z0 (target draws on canvas but it sits behind the black content — include empty div)
  - `<div class="builds_content section-space">` (bg black, padding 100px 0, flex col align center, z3, height 100vh, justify flex-start — add gap to space heading/logo like target)
    - `<div class="v-flex-center-top gap-40 relative z-2">` (width 931px)
      - label: `custom-descr text-center f-14 caps lh-90 -ls-02 font-mono` → rich-inherit → "AI TRANSFORMATION" (copy classes from extract)
      - heading: `custom-descr text-center f-72 caps lh-100 -ls-03` (copy classes from extract) → rich-inherit → "The first operating systems ran computers. Ours run companies." (copy exact em/p markup)
    - `<div class="builds_logo-parent">` (padding-top 65px, width 255px, flex row center; TALL — height 1422px, this is the scrub area)
      - `<div class="builds_logo">` (255×294, aspect 1000/1153, position relative) → `<div class="logo-pieces">` — the logo pieces (extract from 03-builds.html — copy data-morph/data-start paths)
      - `<div class="builds_mask-parent">` (absolute, centered, 255×294, opacity 0 initial, z2) → `<div class="builds_bg">` (absolute, 1440×1750, centered via transform translate(-50%,-50%) left/top 50% — copy inline styles from extract) → `<img src="/sites/ciridae-0e008832/root-8a5edab2/images/Hero.webp" class="img-cover" />` (object-fit cover, full size)

## Scroll behavior (GSAP ScrollTrigger scrub over `.builds` 250vh)
Trigger: `.builds`, start "top top", end "bottom bottom", scrub 1.
Timeline (approximate target choreography; endpoints verified by observation):
1. heading label+title: TextScramble reveals on enter (shared component)
2. logo pieces: opacity 0 → 1 progressively (each piece i over progress window i*0.08 → i*0.08+0.15)
3. builds_mask-parent opacity 0 → 1 (window 0.35 → 0.6)
4. builds_bg img scale 1.0 → 1.15 + subtle translate (window 0.35 → 1)
5. builds_logo scales slightly 1 → 0.96 (subtle parallax, window 0.6 → 1)
Keep it smooth and subtle; final values tuned in QA.

## Text (verbatim)
AI TRANSFORMATION / The first operating systems ran computers. Ours run companies.

## Assets
- Masked image: `/sites/ciridae-0e008832/root-8a5edab2/images/Hero.webp`

## Responsive
- ≤479px: builds_canvas masked (ported css). builds_logo-parent width scales via container; fine as-is.

## Export contract
```ts
export function Builds()
```
