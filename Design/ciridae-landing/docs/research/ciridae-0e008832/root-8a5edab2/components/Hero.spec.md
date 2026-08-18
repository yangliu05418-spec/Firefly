# Hero Section Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Hero.tsx`
- **Screenshots:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-01-hero-0.png`, `sec-01-hero-600.png`
- **Interaction model:** load-timeline (GSAP entrance) + time-driven (bg video autoplay)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/01-hero.html`

## Structure
`<section change-nav-color="white" data-bg="/sites/ciridae-0e008832/root-8a5edab2/images/video-placeholder.webp" class="section">`
- section CSS already ported: `.section:has(.hero):after` gradient overlay (black 50% → transparent at 25%) is in ciridae-behaviors.css — requires the `:has(.hero)` structure, so keep `.hero` as direct child.
- `<div class="container">` → `<div class="hero">` (flex column, justify space-between, padding 122px 0 40px, min-height 100vh)
  1. `<Nav />` (import from `./Nav`)
  2. `<div class="hero_bg">` (absolute inset 0, z-index 0, overflow hidden):
     `<video class="video" loop muted playsinline autoPlay crossorigin="anonymous" poster="/sites/ciridae-0e008832/root-8a5edab2/images/video-placeholder.webp">`
     `<source src="/sites/ciridae-0e008832/root-8a5edab2/videos/hero_web.mp4" type="video/mp4" />`
     CSS: `.hero_bg video { scale: 1.1 }` (ported).
  3. `<div class="future_grid">` (display grid; grid-template-columns 40% 20% 40% — computed 560px 280px 560px at 1400px container; align-items center)
     - `<div class="future_split">` (flex row, justify flex-start, align center) → `<div class="relative">` → `<div class="f-16 caps lh-110">AUTOMATE THE MUNDANE</div>`
     - `<div class="v-flex-center-center">` (flex column, justify/align center) → `<div class="hero_logo">` → `<div class="logo-pieces">` + `<div class="logo-piece_chars">` + `<div class="text-logo">` (copy ALL logo markup from extract file — includes an SVG w-embed block; extract the logo-piece svg data into LogoPieceData[] for shared `LogoPieces`, and render the remaining children verbatim)
     - `<div class="future_split is-right">` (flex row, justify flex-end) → `<div class="relative">` → `<div class="f-16 caps lh-110">ACCELERATE THE REMARKABLE</div>`
  4. `<div class="v-flex-center-top gap-48 mb-40 sm-mb-24 sm-gap-16">` (flex column, align center, gap 48px, margin-bottom 40px)
     - `<div class="custom-descr text-center f-16 caps lh-90 -ls-02">` → `<div class="rich-inherit w-richtext">` → `<p>TODAY'S ECONOMY DEMANDS <em>AI Transformation.</em></p>` (check extract for exact em markup; copy)
     - `<a href="mailto:info@ciridae.com" class="btn w-inline-block">` → `<div class="btn_text">` → `<div class="f-14 font-mono caps lh-110">Start now.</div>` (copy exact classes + href from extract; hover scramble via shared LinkAnimation)

## Entrance timeline (GlobalLoader homeLoading equivalent — implement in Hero on mount)
gsap timeline, defaults {ease:"power2", duration:.8}:
1. set hero_bg autoAlpha 0 → fromTo autoAlpha 1 (dur .8, power1) — run at start
2. hero_logo: fromTo autoAlpha 0→1 at .3; blur 20px → 0 over 2.2s (`.hero_logo` initial `filter: blur(20px)` ported CSS — note ported css has `.hero_logo{filter:blur(20px)}`? verify: ciridae-behaviors.css has `.hero_logo{filter:blur(20px)}` — if present, animate to blur(0px) via gsap and leave inline)
3. side texts (.f-16): per char scrambleText (random char, speed .5) + autoAlpha 0→1, stagger .01, dur .4; left starts "<0.2", right "<0.1"
4. middle text (.rich-inherit p): lines fixed width/height + overflow hidden, then chars scramble in + autoAlpha (stagger .01)
5. bg + nav autoAlpha 0→1 (nav is inside Hero — fade `.hero_bg`; nav handled by LenisProvider visibility rule)
- Lenis starts after complete (useLenis().start()) — LenisProvider already runs; just call start in onComplete (it's already running, harmless).
- NOTE: `main, nav {visibility:hidden}` is ported CSS; LenisProvider already sets main/nav visible on mount. Keep that behavior.

## Logo pieces (extract from 01-hero.html)
- `.hero_logo > .logo-pieces`: pieces with data-morph/data-start — extract into LogoPieceData[] (shared LogoPieces handles the morph on mount). Render `logo-piece_chars` + `text-logo` + svg w-embed children verbatim alongside.

## Text (verbatim)
AUTOMATE THE MUNDANE / ACCELERATE THE REMARKABLE / TODAY'S ECONOMY DEMANDS AI Transformation. (em italic = font inherits; target's --font--accent is undefined → em inherits font) / Start now.

## Responsive
- future_grid columns → 1fr on mobile (check media query in ciridae-base.css for future_grid; if absent, implement: ≤991px grid-template-columns 1fr, gap from sm classes; ≤479px .f-16 → smaller via ported sm-f-* if present). Hero padding-top reduces (sm classes on hero — check extract classes).
- Video: object-fit cover, scale 1.1.

## Export contract
```ts
export function Hero()
```
- No props. Renders the full section incl. `<Nav/>`. Imports: `./Nav`, `../shared/LogoPieces`, `../shared/LinkAnimation` (for "Start now." hover scramble), `../shared/useLenis` not needed (provider auto-starts).
