# BEHAVIORS.md — https://www.ciridae.com/ (home)

All behaviors observed live + extracted from source (app.js, index-FoLuMWWn.js home module, module chunks, inline CSS, ciridae-vercel-index.css).

## Global systems

### Lenis smooth scroll
- Library: Lenis 1.3.4 (custom bundle in page). Active on `<html>` (class `lenis`).
- Config: `{ duration: 1.4, easing: t => 1 - Math.pow(2, -10*t) (easeOutExpo), smoothWheel: true, syncTouch: false, wheelMultiplier: 1.6 }`.
- Driven by GSAP ticker; ScrollTrigger.refresh on resize via `scroll` event.
- `html.lenis, html.lenis body { height: auto }`.

### Body scroll-state classes
- `body.at-top` at scrollY≈0; `body.scroll-down` when scrolling down (removed when scrolling up or at top).
- `body.past-first` after passing first viewport (used by logo-small visibility rules).

### Nav (`.nav`, fixed, top:52px, left/right 20px, z high)
- `nav[data-color=white]` → color white; `nav[data-color=black]` → color black. Toggled by JS watching sections with `change-nav-color` attribute (IntersectionObserver/ScrollTrigger): light sections (section-light) set black, dark sections set white.
- `.nav_body` (rounded pill): `background-color: color-mix(in srgb, currentColor, transparent 75%); backdrop-filter: blur(20px); transition: transform .8s, background-color .4s, color .4s, opacity .4s, backdrop-filter .4s` (all `var(--smooth)`).
- At top (`body.at-top`, ≥992px): nav_body transparent + blur(0).
- Scroll down (≥992px): nav_body `translate3d(0,-140%,0)` (hides); scroll up / at top: back to translateZ(0).
- Logo center (`.nav_logo .logo-small`) fades out via opacity when not past-first on home (desktop).
- Hover (desktop, hover:hover): `.btn:hover:before` glow ring (outline 3px currentColor + box-shadow 0 0 20px 10px currentColor, inset…, opacity .12, transition opacity .2s). Hidden when nav black. Also `.button:hover` glow (box-shadow 0 0 16px rgba(255,255,255,.18), inset 0 0 16px rgba(255,255,255,.14); text-shadow 0 0 16px rgba(255,255,255,.22), transition .25s ease).
- Mobile (≤991px): nav pointer-events none (body only); scroll-down hides; burger-open hides START NOW btn (opacity 0).

### LinkAnimation (buttons/links text)
- Text split into per-char spans (GSAP SplitText style, chars wrapped in overflow-hidden 1em-high containers).
- On mouseenter: scramble chars (ScrambleText, random alphanumeric, speed .5, stagger .02/.03) then settle to real char.

### News banner (`.draft-news-banner-v2`, fixed top 0, height 40px, above nav)
- Content: `NEWS · JUN 15, 2026 · CRUCIBLE EARLY ACCESS IS NOW OPEN` + `START NOW` (right, with sweep). Click → external link.
- Shimmer: two gradient sweeps (`.draft-banner-sweep-a/b`) animating translateX+skew+opacity, keyframes ds1 8s / ds2 11s ease-in-out infinite; overlay gradients dn1 12s / dn2 17s (before/after pseudo, blur 8/12px, linear-gradient white ~0f/29).
- prefers-reduced-motion: animations off.

### Burger menu (`.burger`, fixed full-screen overlay; trigger `.nav_burger` in nav)
- Open: click `.nav_burger` → `body.burger-open`; Lenis stops. Close: click again; Lenis restarts.
- Overlay transition: opacity 0→1 over .8s `var(--smooth)`, visibility delay 0.6s on close. Initial: opacity 0, visibility hidden, pointer-events none.
- Trigger text: "MENU" chars scramble out, "CLOSE" chars scramble in (GSAP ScrambleText, per char, speed .5, stagger .02); burger lines morph to X: line1 `translate(-50%,-50%) rotate(45deg)`, line2 `rotate(-45deg)`, width 50% (transition transform .6s var(--smooth), width .6s).
- Items (`.burger_item`): opacity 0 → staggered to 1 with `--delay: i*0.1+0.2s` (JS sets), transition opacity .6s var(--smooth) var(--delay).
- Item hover: pseudo `:after` with `attr(data-text)` duplicate text, blur(10px), opacity 0→.3 (transition .3s, delay .3s); other items dim to color-mix(currentColor, transparent 30%).
- Logo (`.burger_logo`): 3+ inline SVG `logo-piece`s; on open, paths morph from `data-morph` (tiny shapes) to `data-start` (full paths) via MorphSVG 1.5s power2.inOut; pieces fade in opacity 0→1.
- Footer inside burger: text-links (LINKEDIN, X), `ALL RIGHTS RESERVED <data-year>©` (JS fills year).
- Nav links inside burger: HOME, ABOUT, THE NEW INTELLIGENCE.

### Popup (`.popup`, fixed full-screen, data-module=Popup; trigger: nav "START NOW" `.btn` click)
- Open: click → `.popup.active`, Lenis stops; close via `.popup_close` (icon rotates 90deg on hover, transition .6s cubic-bezier(.84,0,.16,1)) or click outside? (close btn only, plus overlay maybe). Close re-enables Lenis.
- Transition: opacity 0→1 .8s var(--smooth); visibility delay .6s on close.
- popup_close positioned by JS to align with the MENU button rect (top: min(menuRect.top,10)px, right: window width - menuRect.right px, width/height of nav_burger).
- Content animates in (timeline, paused, defaults power2.ease .8s): logo pieces morph (as burger), description chars scramble in, heading lines reveal (line overflow-hidden height .9em, chars scramble+autoAlpha, delay = |i - len/2|*0.02 + line*0.1 + 0.4), inputs fade (stagger .1 from .6), submit fade .8.
- Email button (`.popup_btn`): hover scrambles text chars; click → copies email to clipboard, chars scramble out, text becomes "Mail Copied", scramble back in, then after 1.5s scrambles back to email.

### Page loader / hero entrance (GlobalLoader homeLoading timeline)
- On load: `main, nav { visibility: hidden }` → GSAP sets main autoAlpha 1.
- Timeline (paused, defaults power2 .8s): hero_bg autoAlpha 0→1 (.8s power1); logo autoAlpha 0→1 at .3, blur(20px)→blur(0) over 2.2s; left/right `.future_split .f-16` chars scramble in (stagger .01, autoAlpha 0→1); middle `.rich-inherit` text lines (fixed w/h, overflow hidden) chars scramble in; nav fades in with bg.
- Lenis starts on complete; safety timeout 3s sets blur(0) + lenis.start().
- Hero video: `scale: 1.1` via CSS; section overlay gradient `linear-gradient(to bottom, color-mix(black, transparent 50%), transparent 25%)` via `.section:has(.hero):after`.

### Hero logo morph (hero_logo, always)
- logo pieces: `data-morph` (abstract small shapes) → `data-start` (actual logo paths); GSAP MorphSVG; piece 1 at "<0.2", rest "<0.1"; pieces fromTo opacity 0→1; blur 20→0.

### Builds section (`.builds`, height 250vh, `.builds_sticky` sticky top 0, overflow clip, margin -1.25rem)
- Home module drives: canvas + builds_content (black bg) + builds_logo (morph) + builds_mask-parent (clip-path: url(#logo-mask) SVG mask) + builds_bg-parent (z2). Scroll-driven: bg image/mask scales/translates with scroll (ScrollTrigger scrub); logo pieces draw/morph; text reveals (TextAnimation module).
- On mobile ≤479px: builds_canvas gets mask-image linear-gradient(to top, transparent 0%, black 30%).

### Points section (`.points`, height 250vh, margin-top -100vh; `.points_sticky` sticky top 0 h 100vh)
- Scroll-driven pinned: `--scale` custom property from .1 → 1 driven by ScrollTrigger scrub (progress). `.points_bg` (inside points_bg-parent, absolute inset 0 -1.25rem, mask linear-gradient(#000 0 70%, transparent 100%)):
  - `clip-path: url(#points-mask)` (inline SVG clipPath — irregular blob).
  - width: calc(21.01vw * (1 - var(--scale) + var(--scale) * 13)); height: calc(24.27vw * …) — zooms ×13 as you scroll.
  - inner img: 100vw × 100vh, centered, scales with the clip.
- `.points_content`: 3-col grid (gap 20px), 3 `.points_item` cards (aspect 453/595, backdrop blur 50px, bg #adadad33, radius 10px, color white, flex column space-between, padding 32px top/bottom).
- Each item: logo (points_logo, width 7.75rem, composed of `logo-piece` inline SVGs with per-piece opacity .1 defaults per nth-child rules) + bottom text (width 364px, opacity .8, centered).
- Hover on item (CSS): logo texture crossfade — `:before` texture image (per-item TextureStep4/8.png) opacity .75 blur 10px → 0; `:after` TextureStep1.png opacity 0→.75; logo-piece opacities → 1 (!important). Transition .2s ease-in-out with visibility delays. Item 3 logo rotated 180deg.
- Mobile: content stacks (gap 12px), items padding 20px sides, bg-parent sticky h 100vh behind, section height auto.

### We-do section (`.we-do_parent`, height 200vh; `.we-do` sticky top 0, height 100vh; data-module=WeDo)
- `.we-do_top`: 2-col grid heading block (margin-bottom 80px).
- `.we-do_list`: flex row gap 10px, flex:1; 3 `.we-do_item` columns; each item: `flex: var(--flex)` (custom prop, JS-set); `.active` item flex:1. Transition: `flex .8s var(--smooth)`.
- Item content: image full-bg (`.we-do_img`, overflow clip, img scale 1.002) + overlay black 40% + centered content (z2): title (f-16 caps) + descr (absolute top 5.75rem, width 15.625rem, text-center) + `.line` (opacity 0 → 1 on active, transition .6s var(--smooth) var(--delay)).
- Active switching driven by hover/scroll (JS WeDo module; verify: hover-enter sets active).
- Mobile (≤991px): we-do_parent height auto; we-do static; list column; item padding 0; content padding 5.75rem top/bottom; descr static, margin-top 122px.

### Team marquees (`.team`, data-module=Marque on `.team_marque`)
- Structure: team_top (heading block, centered, gap 72px desktop) + team_marque (padding 122px top/bottom; margin-bottom 20px) + team_bottom (gap 60px centered).
- team_marque: horizontal `.team_list` (gap 80px desktop / 48px tablet) with `.team_wrapper` (padding 40px / 24px) items — `.team_item` width 5em, opacity .9, icons (`team-icon` 5em, aspect 1). JS Marque module loops/translates the list infinitely (velocity-based, direction).
- team_bottom: more icons/marque row.

### Quote section ("A new era", section-space, change-nav-color white)
- centered mono label (f-14), big `.custom-descr f-32 lh-140` quote text, TextAnimation reveal on scroll.

### Testimonials (data-module=TestimonialsSplide, section-space, dark bg)
- Splide carousel: `.splide__track` overflow visible, pagination + default arrows hidden; custom arrows (`.testimonials_arrow-parent`): hover → bg/border charcoal; `.inactive` → opacity .7 pointer-events none.
- Slides: `.testimonials_item-parent.active .testimonials_item > div { opacity: 1 }` vs default .7 (transition .4s var(--smooth)); parent user-select none.
- 6 images inside section (client quotes/cards + logos?).

### Security standards section (change-nav-color white, dark bg)
- `security_line` (min-width 480): relative, bg color-mix(currentColor, transparent 50%); `:before` overlay bg orange, `transform: scaleY(var(--progress, 0))` origin top center — vertical progress line driven by scroll (JS sets --progress per timeline item).
- `security_timeline-item`: tag chip bg #848484; content f-14/custom-descr opacity .3 (inactive items dimmed); active item content opacity 1 (JS toggles).
- Mobile ≤479px: vertical line pieces per item with orange fill `transform: translate(-50%) scaleY(var(--progress))`; after-element continuation line height 6.875rem.

### CTA / text-only section (change-nav-color white, section-space)
- Centered big text block + mono label; TextAnimation reveals. (Verify exact content in extraction.)

### Footer (data-module=Footer, `.footer_section` z3)
- `.footer_img` (height 100vh, sticky top 0): full-bleed image (`.img-cover`).
- `.footer_parent` (height 100vh, margin-top -30vh, padding 20px, z2): slides over the sticky image.
- `.footer` (inside parent, height 100%, padding 30px 20px, border-radius 10px, overflow clip, dark panel): `.footer_bg` (z -1, absolute inset 0, dark image/bg), `.footer_blur` (z2, bg color-mix(black, transparent 70%), backdrop blur 50px, absolute inset 0), `.footer_canvas` (z3, absolute inset -20px — canvas element, JS-drawn animation; on mobile? verify), footer content z2: footer_top (padding-top 122px desktop; centered flex col: big heading text "SAN FRANCISCO" style + logo width clamp(6.5625rem,7.29167vw,8.4375rem)), footer marquee text ("THIS IS SOME TEXT INSIDE OF A DIV BLOCK." repeated — verbatim placeholder from live site!), footer_bottom (gap 48px, space-between: nav links row + meta row "SAN FRANCISCO EST. 2025" + links + ALL RIGHTS RESERVED year).
- Mobile: footer padding 65px; footer_parent padding 10px; footer_mob-top column visible.

### Scroll reveal animations (TextAnimation module)
- Many `.custom-descr` blocks have data-module="TextAnimation": on scroll into view (IntersectionObserver/ScrollTrigger), text chars/lines scramble+reveal (autoAlpha 0→1, stagger). Applied to: era label, quote, we-do top, team top/bottom, testimonials label/heading, security label/heading, CTA text, etc.

## Interaction models (summary)
| Section | Model |
|---|---|
| News banner | time-driven (CSS keyframes shimmer) |
| Hero | load-timeline (blur/morph/scramble) + time (video autoplay) |
| Nav | scroll-driven (color switch, hide on scroll down) + hover glow + click (burger/popup) |
| Burger | click-driven overlay + timeline staggers |
| Popup | click-driven overlay + timeline + click copy-email |
| Team marquees | time-driven (JS marquee loop) |
| Builds | scroll-driven (sticky pin, scrub animations, logo draw) |
| Points | scroll-driven (sticky pin, --scale zoom of masked bg) + hover textures |
| Quote | scroll-driven reveal |
| We-do | hover/active-driven flex accordion (sticky pin) |
| Testimonials | click-driven (Splide carousel custom arrows) |
| Security | scroll-driven progress lines + item activation |
| CTA | scroll-driven reveal |
| Footer | scroll-driven (sticky image + panel slide) + time (canvas) |

## Tech equivalents for clone
- Lenis (npm `lenis`) — same config.
- GSAP (npm `gsap`) + ScrollTrigger + SplitText (free since 3.13) + ScrambleText (free since 3.13) — same API.
- MorphSVG: PAID GSAP plugin. Clone approach: implement logo morph with CSS transition between two `<path d>` values where geometrically compatible, or precompute interpolation with `flubber`-style JS, or simply crossfade pieces + blur (visual approximation). Fallback: animate opacity+scale+blur of pieces and skip true path morph; or interpolate using `d` attribute with matching point counts (data-morph paths have different point counts — use flubber npm package for accurate morph).
- Splide (npm `@splidejs/splide`) — testimonials.
- No Barba needed (single page). Page-transition loader not required.
