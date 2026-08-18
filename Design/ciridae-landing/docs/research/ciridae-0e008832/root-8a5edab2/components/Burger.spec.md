# Burger Overlay Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Burger.tsx`
- **Screenshot:** `docs/design-references/ciridae-0e008832/root-8a5edab2/state-burger-open.png`
- **Interaction model:** click-driven (body.burger-open) with CSS transitions + GSAP staggers
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/burger.html` — copy ALL classes, structure, link hrefs, and the 4 logo SVG pieces (viewBox, data-morph, data-start, path d) EXACTLY.

## Structure (copy from extract; key parts)
`<div class="burger">` — full-screen fixed overlay (opacity/visibility transitions already in ported CSS: `.burger`, `.burger-open .burger`, `body.burger-open ...` rules in ciridae-behaviors.css)
- `<div class="container">` → `<div class="burger_body">` (flex column)
  - `<div class="burger_top grow">` → `<a href="/" class="burger_logo w-inline-block w--current">` → `<div class="logo-small">` with 4 `<svg class="logo-piece">` pieces (viewBox 0 0 1000 1153; each has data-morph + data-start + path fill=currentColor d=…)
  - `<div class="burger_list grow">` — links (copy hrefs):
    - `<a class="burger_item w-inline-block w--current go prevent" href="/">` → `<div class="f-40 caps -ls-06">HOME</div>`
    - `<a class="burger_item w-inline-block go prevent" href="/about">` → ABOUT
    - `<a class="burger_item w-inline-block go prevent" href="/blog/...">` → THE NEW INTELLIGENCE (copy exact href)
  - `<div class="burger_bottom grow">`
    - `<div class="h-flex-left-bottom sm-hide">` → `<div class="f-11 lh-110 caps font-mono">` (small label — copy text)
    - `<div class="burger_bottom-mid">` → `<div class="dot">` + `<div class="v-flex-center-center">` with `<a class="text-link w-inline-block">` ×2 → `<div class="caps lh-110 font-mono f-14">LINKEDIN</div>` / `X` (copy hrefs)
    - bottom line: `<div class="f-11 ...">ALL RIGHTS RESERVED <span data-year>©</span></div>` (copy classes)

## Behaviors (JS)
1. Listen for `body.burger-open` class changes (MutationObserver) OR accept a `open` prop. On open:
   - Logo: animate with shared `LogoPieces` component (pieces fade in + flubber-morph data-morph → data-start, 1.5s power2.inOut, piece stagger .1 from .2). Use `useLogoMorph`-style logic — simplest: use shared `LogoPieces` with the extracted pieces (it auto-animates on mount; render it only when open, or always render and animate via ref on open).
   - Items: CSS handles opacity stagger via `--delay` (ported `.burger-open .burger_item` rule). Set `--delay: i*0.1+0.2s` per item (i = index) via inline style.
   - Item hover blur: pure CSS (ported `.burger_item .f-40:after` uses `attr(data-text)` — set `data-text` attribute = item label on each `.f-40`).
   - `[data-year]` = current year via JS.
2. On close: CSS transitions handle fade-out (remove class).

## Text (verbatim)
HOME / ABOUT / THE NEW INTELLIGENCE / LINKEDIN / X / ALL RIGHTS RESERVED 2026© (year via JS) + the small f-11 label text (copy from extract)

## Responsive
- Ported CSS handles ≤991px (burger_top padding-top 60px etc.). Component: nothing extra.

## Export contract
```ts
export function Burger({ open }: { open: boolean })
```
- Renders `.burger` overlay only. The Nav toggles body class; the PAGE passes `open` derived from `body.burger-open` (page-level state) — or component self-subscribes via MutationObserver on body. Prefer prop.
- Logo pieces: extract the 4 pieces' `data-morph` and `data-start` strings from extract/burger.html into a `pieces: LogoPieceData[]` array, passed to shared `LogoPieces` from `../shared/LogoPieces`.
