# SecurityText Section Specification

## Overview
- **Target file:** `src/components/sites/ciridae-0e008832/root-8a5edab2/SecurityText.tsx`
- **Screenshot:** `docs/design-references/ciridae-0e008832/root-8a5edab2/sec-09-cta.png`
- **Interaction model:** scroll-driven reveal only (text-only section; the security timeline is NOT rendered on the target — verified: 0 `.security_timeline-item` elements in live DOM)
- **Verbatim markup source:** `docs/research/ciridae-0e008832/root-8a5edab2/extract/10-security-cta.html`

## Structure
`<section change-nav-color="white" class="section section-space">` → `<div class="container">` → `<div class="text-only">` → `<div class="v-flex-center-top gap-40 sm-gap-20">`
- label: `custom-descr text-center f-14 caps lh-90 -ls-02 font-mono` → rich-inherit → "SECURITY STANDARDS"
- heading: `custom-descr text-center f-32 caps lh-105 -ls-02 sm-f-20` → rich-inherit → "THE CIRIDAE PLATFORM IS BUILT ON SECURE, SOC 2–COMPLIANT INFRASTRUCTURE WITH END-TO-END ENCRYPTION, STRICT ACCESS CONTROLS, AND SCALABLE CLOUD ARCHITECTURE TO ENSURE YOUR AI-POWERED OPERATIONS REMAIN PROTECTED, COMPLIANT, AND RELIABLE, REGARDLESS OF HOW FAST YOU GROW."
(copy the rich-text markup incl. h-tags and em from the extract file)

## Behaviors
- TextScramble reveal for label; heading reveal: gsap fromTo autoAlpha 0→1, y 24→0, ease power2.out, dur .8, on ScrollTrigger enter (top 85%).

## Responsive
- `sm-f-20` on heading (ported); `sm-gap-20` (ported).

## Export contract
```ts
export function SecurityText()
```
