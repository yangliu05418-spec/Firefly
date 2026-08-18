# NewsBanner Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/NewsBanner.tsx`
- **Screenshot:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-01-hero-0.png` (top strip)
- **Interaction model:** time-driven (CSS keyframe shimmer)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/00-news-banner.html` — copy element classes, structure and text EXACTLY.

## Structure
`<a class="draft-news-banner-v2 w-inline-block" href="...">` (link to crucible early access — copy href from extract file)
- 2× `<div class="draft-banner-sweep-wrap">` each containing 2× `<div class="draft-banner-sweep draft-banner-sweep-a|b">` (shimmer layers, absolute)
- `<div class="draft-news-banner-inner-v2">` — flex row, gap (copy classes from extract), containing:
  - `draft-news-banner-label-v2` ×3: "NEWS", "JUN 15, 2026", "CRUCIBLE EARLY ACCESS IS NOW OPEN"
  - `draft-news-banner-dot-v2` ×2 (dots between labels — orange square? copy markup)
  - right side: "START NOW" link/button (copy markup + href from extract)

## Computed styles (live @1440)
- root: fixed, top 0, z-index 11, width 100%, height 40px, min-height 40px, background #050505, color #fff, padding 10px 20px, display flex row, justify-content center, align-items center, overflow hidden, font 14px/20px Pragmatica Cond.
- sweeps: absolute, width 62%/44% variants, linear-gradient(90deg, transparent, rgba(255,255,255,.08) 32%, rgba(255,255,255,.24) 50%, rgba(255,255,255,.08) 68%, transparent), filter blur(9px)/(14px), skew via keyframes.
- shimmer CSS is already ported: see `.draft-news-banner-v2`, `@keyframes dn1/dn2/ds1/ds2` in `src/styles/ciridae-utilities.css` (inline style #2 section). DO NOT rewrite these keyframes — they are already active globally.
- label dots/text: 14px Roboto Mono caps (f-14 font-mono caps classes) — copy classes from extract.

## Behaviors
- Pure CSS animation (already in utilities css). Component only renders markup. prefers-reduced-motion handled by ported CSS.

## Text (verbatim)
NEWS / JUN 15, 2026 / CRUCIBLE EARLY ACCESS IS NOW OPEN / START NOW

## Export contract
`export function NewsBanner()` — no props, `<a>` root. Used once at top of page.
