# PAGE_TOPOLOGY.md — ciridae.com home

Page: `data-transition-page="home"`. Body bg `--color--black` (#0b0b0b). Desktop content width via `.container` (max 1600ish, padding 20px desktop / 10px mobile). Fluid font system: `--size-unit:16`, `--size-container: clamp(992px,100vw,1920px)` (breakpoints 1920/991/767/479 redefine ideal/min/max).

## Structure (top → bottom, desktop 1440×900 viewport, total ~10934px)

| # | Section | Y range | Classes / hooks | Interaction |
|---|---|---|---|---|
| 0 | News banner | 0–40 (fixed) | `a.draft-news-banner-v2` (fixed top 0) | time (shimmer) |
| 1 | Hero | 0–900 | `section[change-nav-color=white][data-bg=video-placeholder]` > `.container` > `.hero` (contains `<nav>`, `.hero_bg` video, headline, `.burger` overlay) | load timeline + video |
| 2 | Team marquee 1 | 900–1249 | `section[change-nav-color=black][section-light]` > `.container` > `.team` (team_top + team_marque + team_bottom) | time (marquee loop) |
| 3 | Builds | 1249–3499 | `section[change-nav-color=white]` > `.container` > `.builds` (h 250vh, sticky) — canvas, builds_content (black), builds_logo, builds_mask-parent, builds_bg-parent | scroll pin + scrub |
| 4 | Points | 2599–4849 | `section[change-nav-color=white]` > `.container` > `.points` (h 250vh, sticky; margin-top -100vh overlap) — points_bg (clip-path mask, --scale zoom), points_content (3 cards) | scroll pin + scrub + hover |
| 5 | Quote "A new era" | 4849–5451 | `section.section-space[change-nav-color=white]` > `.era-wrap` (mono label + big f-32 quote) | scroll reveal |
| 6 | (hidden) case-study template | — | `section.is-hidden` (used by JS; not rendered) | — |
| 7 | We-do | 5451–7251 | `section[change-nav-color=white][data-module=WeDo]` > `.container` > `.we-do_parent` (h 200vh) > `.we-do` (sticky 100vh) — we-do_top + we-do_list (3 items) | hover flex accordion |
| 8 | Team 2 "OuR team" | 7251–7926 | `section.section-space[change-nav-color=black][section-light]` > `.container` > `.team` | time (marquee) |
| 9 | Testimonials | 7926–8845 | `section.section-space[change-nav-color=white][data-module=TestimonialsSplide]` > `.container` > `.testimonials` (Splide + custom arrows) | click (carousel) |
| 10 | Security standards | 8845–9404 | `section.section-space[change-nav-color=white]` — security_timeline with `--progress` lines | scroll progress |
| 11 | CTA text-only | (between 10 and footer) | `section.section-space[change-nav-color=white]` > `.container` > `.text-only` | scroll reveal |
| 12 | Footer | 9404–10934 | `footer.footer_section[data-module=Footer]` — footer_img (sticky 100vh) + footer_parent (margin-top -30vh) + footer panel (blur glass, canvas, marquee) | scroll + time |

NOTE: DOM order has 11 `section`s — sections 10/11 per attributes above (security + CTA). Verify exact order during extraction.

## Fixed / sticky overlays (z layers)
- News banner: fixed top 0, z above nav.
- Nav: fixed top 52px (inside hero section DOM, position fixed), left/right 20px. z above content.
- Burger overlay: full-screen fixed, z above nav (opacity 0 hidden default).
- Popup: full-screen fixed, z top (hidden default).
- Transition overlay: `.transition` full-screen (Barba transitions; unused for single-page clone).
- Builds: sticky within section. Points: sticky within section. We-do: sticky within section. Footer img: sticky; footer panel slides over.

## Dependencies
- Nav color depends on sections' `change-nav-color` attributes (IntersectionObserver-based).
- Footer canvas + marquee need Footer module JS.
- Points `#points-mask` and builds `#logo-mask` clipPaths are inline SVG defs rendered once in page (points_svg element inside points section; builds svg inside builds).
- All text split/reveal modules need GSAP SplitText+ScrambleText registration.
- Lenis must initialize before ScrollTriggers refresh.

## Page assembly notes for clone
- Root page: render sections in order; nav + burger + popup mounted once (nav inside hero section markup, burger overlay inside hero section too; popup at body level).
- Global provider: Lenis instance + GSAP ticker integration; body scroll-state classes (at-top / scroll-down / past-first).
- `main, nav` hidden until entrance timeline runs (client-only effect; guard SSR).
- Google-fonts-independent: self-host all 3 font families.
