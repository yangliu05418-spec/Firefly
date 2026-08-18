# Popup Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/Popup.tsx`
- **Screenshot:** none yet (trigger: click START NOW in nav; screenshot via `state-burger-open.png` for style reference)
- **Interaction model:** click-driven overlay (`.popup.active`) + GSAP entrance timeline + click-to-copy email button
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/popup.html`

## Structure (copy classes exactly)
`<div data-module="Popup" class="popup">` (fixed full-screen; transitions already ported: `.popup`, `.popup.active`, `.popup_close` etc. in ciridae-behaviors.css)
- `<div class="popup_close">` (positioned top-right by JS to overlap MENU button: top: min(menuRect.top, 10)px, right: innerWidth - menuRect.right px, width/height = menu rect)
  - `<div class="f-14 font-mono caps lh-90" aria-label="close">` "close" chars
  - `<div class="popup_close-icon">` → `<div class="popup_close-lines">` ×2 (second `is-2`)
- `<div class="popup_body">` (flex column; padding-top 60px on ≤991px — ported)
  - `<div class="popup_logo">` → `<div class="logo-small">` logo pieces (3 pieces — copy from extract)
  - content (copy exact classes from extract): label "SHIFT NOW" (custom-descr caps f-20?), description `<p>` "WE'RE HERE TO HELP YOU UNLOCK WHAT'S NEXT." (custom-descr text-center f-16), heading "DROP US A LINE." (custom-descr text-center f-32 caps), email button `popup_btn` with "JS@CIRIDAE.COM", second heading "THE NEW INTELLIGENCE" (custom-descr text-center caps), phone "(610) 608-9634", `popup_bottom grow`: text-links LINKEDIN / X + "ALL RIGHTS RESERVED 2026©" ([data-year])
- Copy the full element list/order from extract file — it is authoritative.

## Behaviors (JS)
1. `active` prop (page toggles via Nav button). On activate: play entrance timeline (gsap, defaults power2 .8s):
   - logo pieces: fade in (opacity 0→1, stagger i*.1+.2) + morph data-morph→data-start via shared `LogoPieces` (1.5s power2.inOut)
   - description chars: scramble in (ScrambleText, random char, speed .5, dur .4, stagger .02) + autoAlpha 0→1, start .2
   - heading lines: line container overflow hidden height .9em; chars scramble in with delay = |i - len/2|*0.02 + line*0.1 + 0.4
   - email button autoAlpha 0→1 at .5
2. Email button: hover → scramble chars (LinkAnimation). Click → `navigator.clipboard.writeText('js@ciridae.com')`, scramble chars out, text becomes "Mail Copied", scramble back in, after 1.5s scramble back to "JS@CIRIDAE.COM".
3. Close: click `.popup_close` → remove .active; if body not burger-open → Lenis start (useLenis from shared).
4. `[data-year]` = current year.
5. Close button position: measure `.nav_burger` rect on open; set popup_close style top/right/width/height (see structure).

## Text (verbatim)
SHIFT NOW / WE'RE HERE TO HELP YOU UNLOCK WHAT'S NEXT. / DROP US A LINE. / JS@CIRIDAE.COM / THE NEW INTELLIGENCE / (610) 608-9634 / LINKEDIN / X / ALL RIGHTS RESERVED 2026©

## Export contract
```ts
export function Popup({ active, onClose }: { active: boolean; onClose: () => void })
```
- Renders `.popup` overlay. Uses shared `LogoPieces` + `LinkAnimation` from `../shared/*` and `useLenis()`.
