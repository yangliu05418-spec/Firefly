# WeDo Section Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/WeDo.tsx`
- **Screenshots:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-06-we-do-1.png`, `sec-06-we-do-2.png`
- **Interaction model:** hover-driven flex accordion (item.active expands; flex transition .8s cubic-bezier(.76,0,.24,1)) inside sticky pin (200vh)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/07-we-do.html`

## Structure
`<section change-nav-color="white" data-module="WeDo" class="section">` → `<div class="container">` → `<div class="we-do_parent">` (height 200vh, position relative)
- `<div class="we-do section-space">` (sticky top 0, height 100vh, padding 100px 0, flex column — ported)
  - `<div class="v-flex-center-top gap-40 relative z-2">` (width 100%, flex col align center gap 40px)
    - label: `custom-descr text-center f-14 caps lh-90 -ls-02 font-mono` → rich-inherit → "SYSTEMS, NOT TOOLS" (h3; copy classes)
    - heading: `custom-descr text-center f-32 caps lh-105 -ls-02 sm-f-20` → rich-inherit → "designed to run core operations from one intelligent foundation." (h3; copy classes)
  - `<div class="we-do_list">` (flex row, gap 10px, flex 1)
    - 4× `<div class="we-do_item">` (flex column justify center align center, padding-bottom 80px, position relative; inline style `--flex: 0.25`; ported css: `.we-do_item{flex:var(--flex);transition:flex .8s var(--smooth)}`, `.we-do_item.active{flex:1}`)
      - `<div class="we-do_img">` (absolute inset 0, overflow clip) → `<img class="img-cover" />` (scale 1.002 — ported) + `<div class="we-do_img-overlay">` (black, opacity .4, absolute inset 0)
      - `<div class="we-do_content">` (relative z2, flex col align center gap 20px)
        - `<div class="tag">` (padding 5px 11px, border-radius 1440px, border 1px solid rgba(255,255,255,.8)) "01"
        - `<div class="custom-descr f-16 caps text-center">` title (16px Pragmatica caps, margin 10px 0 — richtext p margins)
        - `<div class="line">` (copy markup/classes from extract; opacity 0 default → 1 on active — ported css)
      - `<div class="we-do_descr">` (absolute top 92px, width 250px, left/right -39px → centered) → `<div class="custom-descr font-body f-14 lh-120">` → `<p>` description (14px Pragmatica lh 16.8 ls -0.02em)
- Item 1 has class `active` initially.

## Items content (verbatim, 4 items)
1. "01" / "AI operating system" / desc "A purpose-built operating system that replaces the patchwork of ERPs, spreadsheets, and disconnected point solutions most industrial businesses run on. Every workflow, from project management, financials, CRM, AP/AR, to reporting, is built to mirror how the business actually operates, unified in a single system that compounds in value as the business grows." / image: pawel-czerwinski.webp
2. "02" / "Scheduling" / desc "AI-powered scheduling ingests work order data, technician skills, certifications, and routing constraints to automatically generate optimized schedules across a large field workforce. Schedulers review AI-proposals with confidence scores, make targeted adjustments, and approve, so the system earns trust while dramatically reducing the time and effort required to build." / image: numbers-bg-new.webp
3. "03" / "Vendor management" / desc "From onboarding and document collection to payment approvals and compliance tracking, automate the full vendor lifecycle with AI handling the coordination overhead that typically requires dedicated staff. The system surfaces exceptions, enforces approval workflows, and integrates directly with your financial stack, so your team focuses on vendor relationships, not administrative overhead." / image: jane-sakharova.webp
4. "04" / "customer order expediting" / desc "AI continuously monitors inbound order activity, triages customer communications, and routes urgent requests without manual intervention, saving the equivalent of a full-time headcount per workflow. Every email handled, every status update logged, and every exception flagged is tracked against measurable cost savings, giving operations teams real visibility into what automation is actually delivering." / image: blog-img-01.png
(verify image→item mapping in extract 07-we-do.html; use that order)

## Behaviors (JS)
- mouseenter on `.we-do_item` → set active (remove .active from others, add to hovered). No click handler (hover-driven on desktop).
- TextScramble reveal for label+heading (shared component).
- The `.line` element: active item shows (CSS handles opacity via `.we-do_item.active .line` — ported with --delay; set `--delay` per item as in extract).

## Assets (base path `/sites/ciridae-0e008832/root-8a5edab2/images/`)
pawel-czerwinski.webp, numbers-bg-new.webp, jane-sakharova.webp, blog-img-01.png

## Responsive
- ≤991px (ported): parent height auto; we-do static; list column; content padding 5.75rem 0; descr static margin-top 122px; items padding 0.

## Export contract
```ts
export function WeDo()
```
