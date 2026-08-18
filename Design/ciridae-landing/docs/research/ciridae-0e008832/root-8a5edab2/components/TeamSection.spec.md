# TeamSection Specification (team-1 + team-2)

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/TeamSection.tsx` — ONE component, used TWICE with different content.
- **Screenshots:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-02-team-marquee.png` (team-1), `sec-07-team-2.png` (team-2)
- **Interaction model:** time-driven (marquee loops) + scroll reveal on headings
- **Verbatim markup sources:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/02-team-1.html` and `08-team-2.html`

## Two instances
### Instance A — team-1 (`.section[change-nav-color=black][section-light]`, NOT section-space)
- `<div class="container">` → `<div class="team">`
  - `<div class="backed-by">` → `<div class="custom-descr text-center f-14 font-mono lh-120 caps">` → rich-inherit → "OUR WORK IS BACKED BY" (heading p; copy classes)
  - `<div class="team_marque">` → `<div class="team_wrapper">` → `<div class="team_list is--static">` → 3× `<div class="team_item is--static">` each containing an inline SVG (copy each SVG verbatim from 02-team-1.html — they are the client logos)
  - static (is--static → no marquee loop; ported css `.team_list` flex; keep the `is--static` classes)
- Section padding: `.team` (flex column, align center, padding from base css — grep `.team`, `.team_marque` in ciridae-base.css: team_marque padding-top/bottom 122px, margin-bottom 20px)

### Instance B — team-2 (`.section.section-space[change-nav-color=black][section-light]`)
- `<div class="container">` → `<div class="team">`
  - `<div class="team_top">` (flex column, align center, gap 72px desktop / 35px ≤991 — base css)
    - `<div class="v-flex-center-top gap-40 sm-gap-30">`
      - label: `custom-descr text-center f-14 caps lh-90 -ls-02 font-mono` → rich-inherit → "OUR TEAM" (h3)
      - heading: `custom-descr text-center f-32 caps lh-105 -ls-02 sm-f-20` → rich-inherit → "WE'RE AI EXPERTS FROM THE WORLD'S LEADING ORGANIZATIONS" (h3)
  - `<div class="team_marque">` → FOUR `<div class="team_wrapper">` each with `<div class="team_list">` ×12 `<div class="team_item">` each containing `team-icon` SVG (45 team-icons total — copy each SVG verbatim from 08-team-2.html, in order)
  - Marquee: each team_wrapper loops horizontally via shared `useMarquee` hook from `../shared/marquee` (target's Marque module). Speed ~80px/s (tune to feel like target).
- Headings use shared `TextScramble` (scroll reveal, chars scramble in on enter viewport).

## TeamSection props
```ts
export type TeamVariant = "clients" | "experts";
export function TeamSection({ variant }: { variant: "clients" | "experts" })
```
- `clients` renders instance A markup; `experts` renders instance B markup.

## Responsive
- base css media queries handle: team_list gap 80px→48px, team_wrapper padding 40→24, team_top gap, sm-f-20 heading. Verify classes exist in extract (they do).

## Export contract
```ts
export { TeamSection, type TeamVariant };
```
