# QuoteEra Section Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/QuoteEra.tsx`
- **Screenshot:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-05-quote.png`
- **Interaction model:** scroll-driven reveal (TextScramble on entry)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/05-quote-era.html` (ignore the hidden `.case-study is-hidden` subtree — do NOT render it)

## Structure
`<section change-nav-color="white" class="section section-space">`
- `<div class="era-wrap">` (copy classes; centered column — copy from extract)
  - label: `<div class="custom-descr text-center f-14 font-mono lh-120 caps">` → rich-inherit → "A NEW ERA" (TextScramble reveal)
  - quotes: `<div class="custom-descr text-center f-14 lh-140 font-body">` (14px Pragmatica, lh 1.4, centered; max-width from inline --max-w in extract — copy) → rich-inherit with FOUR `<p>` (margins from .rich-inherit p rules, ported):
    1. "There are two kinds of services businesses now: the ones being transformed around AI and the ones being replaced by it."
    2. "We do the transformation."
    3. "We are engineers. We build AI-native operating systems. Software that operates the business while the team operates the software. We ship in weeks because we've built the platform that makes it possible: proprietary kits, vertical playbooks, production infrastructure. Every deployment makes the next one faster."
    4. "Our customers are the services businesses that compose the real economy and the investors behind them. We're entering a new productivity golden age, measuring progress through EBITDA, hours returned, and decisions made correctly at scale."
    (copy exact em/strong markup from extract — p2 "We do the transformation." may have em/strong styling)
- A `.container` sibling follows with the hidden case-study — OMIT it entirely.

## Behaviors
- TextScramble (shared) on the label; paragraphs reveal with a simple gsap fromTo autoAlpha 0→1 + y 20→0 stagger .15 on ScrollTrigger enter (target's TextAnimation module pattern — chars scramble for label, block fade for long paragraphs).

## Responsive
- Ported css/classes handle (era-wrap sm classes in extract).

## Export contract
```ts
export function QuoteEra()
```
