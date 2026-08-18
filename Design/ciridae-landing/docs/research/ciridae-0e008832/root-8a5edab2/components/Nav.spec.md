# Nav Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Nav.tsx`
- **Screenshot:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-01-hero-0.png`
- **Interaction model:** scroll-driven (color switch + hide on scroll-down) + click-driven (burger trigger, popup trigger) + hover (glow)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/nav.html`

## Structure (copy classes exactly)
`<nav class="nav is-draft-home-copy-offset" data-color="white">` (data-color toggles black/white; managed by LenisProvider already — do NOT implement color logic, just read `data-color` attribute)
- `<div class="nav_body">` (rounded pill; bg from currentColor mix + backdrop blur — CSS already ported in ciridae-behaviors.css)
  - `<div class="h-flex-left-center">`
    - `<a href="mailto:info@ciridae.com" class="button w-inline-block">` → `<div class="button_text">` → `<div class="f-14 font-mono caps lh-110">start now</div>` (lowercase)
    - `<a href="mailto:info@ciridae.com" class="btn absolute-hidden w-inline-block">` → `<div class="btn_text">` → `<div class="f-14 no-break font-mono caps lh-110" aria-label="start now">` containing char spans for "start now" (use shared `LinkAnimation` component from `../shared/TextScramble` for this one)
  - `<a href="/" class="nav_logo w-inline-block w--current">` — EMPTY (target's nav logo is genuinely empty; width 60px, height 0)
  - `<div class="h-flex-right-center">`
    - `<div class="nav_burger">` (click → toggle burger; contract below)
      - `<div class="btn_text sm-hide">` → `<div class="f-14 font-mono caps lh-110" aria-label="Menu">` chars "Menu" (LinkAnimation hover scramble)
      - `<div class="btn_text-close f-14 font-mono caps lh-110" aria-label="close">` chars "close" (hidden until burger open — ported CSS handles visibility)
      - `<div class="nav_burger-lines">` 2× `<div class="nav_burger-line">` (morph to X via ported CSS)

## Computed styles (live @1440)
- nav: position fixed; top 52px; left/right 10px; width 1420px; z-index 10; height ~53.4px (nav_body height: padding/radius from ported CSS `nav_body` rules — grep `nav_body` in ciridae-behaviors.css + webflow classes in ciridae-base.css).
- nav_body: border-radius (from base css), padding ~10px 20px (verify in base css), display flex, justify space-between, align center.
- On scroll: `body.at-top` → transparent pill; `body.scroll-down` → translate3d(0,-140%,0). ALL CSS ALREADY PORTED in ciridae-behaviors.css (`body.at-top nav .nav_body`, `body.scroll-down nav .nav_body`, `.nav_burger-line`, `body.burger-open ...`). Component does NOT need to implement these — LenisProvider toggles body classes.

## Behaviors (JS in component)
1. Burger click: `.nav_burger` click → `document.body.classList.toggle("burger-open")` and stop/start Lenis via `useLenis()` from `../shared/LenisProvider`. When opening: also dispatch no other work — the Burger overlay component handles its own animations (contract below).
2. Popup click: `.btn` click → add `.active` to `.popup` element (querySelector('.popup')) and stop Lenis. Popup close restarts Lenis itself.
3. Hover: LinkAnimation scramble on button/menu texts (shared component). Glow hover is pure CSS (ported).
4. Menu/Close char scramble swap on burger toggle: use shared `LinkAnimation`-style scramble — simpler: keep both texts always in DOM (btn_text-close visibility handled by CSS `body.burger-open` rules? — ported CSS shows `.burger-open` rules handle burger lines; btn_text-close shows via Burger module JS in target). Implement: on burger open, scramble MENU chars out + CLOSE chars in (gsap.to with scrambleText, chars autoAlpha 0/1, stagger .02). Use gsap + ScrambleTextPlugin (registered in shared TextScramble module).

## Text (verbatim)
"start now" (button), "start now" (btn), "Menu", "close"

## Responsive (ported CSS handles; verify classes only)
- ≤991px: nav pointer-events none; nav_body pointer-events all; `.btn` hides on burger-open (ported).

## Export contract
```ts
export function Nav({ onBurgerToggle }: { onBurgerToggle?: (open: boolean) => void })
```
- Renders ONLY the `<nav>` element (no burger overlay inside). The target has a dead duplicate burger inside nav — DO NOT reproduce it.
- Nav does not render `<Burger/>`. The page assembles Burger separately (target has it in div.global).
- Uses `useLenis()` from `../shared/LenisProvider` to stop/start scroll on popup open.
