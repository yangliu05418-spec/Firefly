# Footer Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Footer.tsx`
- **Screenshots:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-10-footer-1.png`, `sec-10-footer-2.png`
- **Interaction model:** scroll-driven (sticky image + panel slides over) + time-driven (button text crawl)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/11-footer.html` — COPY ALL classes/structure/hrefs/SVGs exactly.

## Structure
`<footer data-module="Footer" class="footer_section">` (z-index 3, relative)
- `<div class="footer_img">` (height 100vh, position sticky, top 0, overflow clip) → `<img class="img-cover" src="/sites/ciridae-0e008832/root-8a5edab2/images/footer-img-03.webp" />`
- `<div class="footer_parent">` (z2, height 100vh, margin-top -30vh, padding 20px, position relative) → `<div class="footer">` (height 100%, padding 30px 20px, border-radius 10px, flex column, overflow clip, dark glass — ported css has footer_bg/footer_blur/footer_canvas layers; copy those from extract: `footer_bg` (bg image/bg), `footer_blur` (backdrop blur 50px + black 70% mix), `footer_canvas` (empty div — target draws on canvas; include empty))
  - `<div class="footer_mob-top">` (display none desktop): "SAN FRANCISCO" + "EST. 2025" (f-14 font-mono lh-110 caps)
  - `<div class="footer_top">` (padding-top 122px desktop, flex 1, justify center, align flex-start): `<a href="/" class="footer_logo w-inline-block w--current">` (width clamp(6.5625rem,7.29167vw,8.4375rem)) with logo-pieces + logo-piece_chars + text-logo + svg w-embed — copy the full SVG content from extract (this is the big SAN FRANCISCO logo mark)
  - `<div class="v-flex-stretch-between grow">` → `<div class="grid-3col sm-v-flex-center-between sm-h-full">` (3 columns):
    - col1 `v-flex-left-center sm-hide`: `<div class="f-14 font-mono lh-110 caps">EST. 2025</div>`
    - col2 `h-flex-center-center gap-16` — 6 buttons (copy order/hrefs from extract):
      - 3× `<a class="btn absolute-hidden w-inline-block" href="mailto:info@ciridae.com">` with btn_text containing ~9 stacked `<div>This is some text inside of a div block.</div>` lines (the crawl marquee) — the f-14 no-break font-mono caps lh-110 wrapper
      - 1× btn absolute-hidden with `<div class="f-14 no-break font-mono caps lh-110">start now</div>` (single line, lowercase)
      - `<a class="button w-inline-block" href="mailto:info@ciridae.com">` → button_text → "Start now"
      - `<a class="button w-inline-block" href="mailto:jobs@ciridae.com">` → button_text → "Join us"
    - col3 `v-flex-right-center sm-hide`: text links (copy from extract): "home" / "about" links + "ALL RIGHTS RESERVED" + `[data-year]` © — copy exact classes/hrefs/order
- (any remaining footer_bottom rows — copy from extract exactly)

## Behaviors (JS)
1. Sticky scroll effect is pure CSS (ported footer rules) — nothing to do.
2. The 3 placeholder buttons' text crawl: vertical infinite loop — translateY of the stacked-text block from 0 to -(lineHeight × 8) [9 lines, 1 visible], stepped every ~0.4s (discrete jumps like a slot reel; rAF-driven). Each of the 3 buttons offset by a different phase (0, 1, 2 steps). Implement with a small rAF loop + transform on the inner text wrapper.
3. `[data-year]` = current year.
4. footer_logo pieces: subtle morph on scroll into view via shared LogoPieces (optional — target Footer module animates them; keep simple fade-in via ScrollTrigger).

## Text (verbatim)
SAN FRANCISCO / EST. 2025 / start now / Start now / Join us / home / about / ALL RIGHTS RESERVED 2026© / "This is some text inside of a div block." ×9 per marquee button

## Responsive
- Ported css: ≤991px footer padding 65px; footer_parent padding 10px; footer_mob-top visible (column, centered); footer_top padding-top 0, centered.

## Export contract
```ts
export function Footer()
```
