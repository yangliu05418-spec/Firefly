# Output Plan — https://www.ciridae.com/

## Targets

| URL | Origin | App root | Site key | Page key | Route |
|---|---|---|---|---|---|
| `https://www.ciridae.com/` | `https://www.ciridae.com` | `.` | `ciridae-0e008832` | `root-8a5edab2` | `/` → `src/app/page.tsx` |

## Output namespaces

- Artifact root: `docs/research/ciridae-0e008832/root-8a5edab2/`
- Component specs: `docs/research/ciridae-0e008832/root-8a5edab2/components/`
- Screenshot root: `docs/design-references/ciridae-0e008832/root-8a5edab2/`
- Page components: `src/components/sites/ciridae-0e008832/root-8a5edab2/`
- Same-site shared components: `src/components/sites/ciridae-0e008832/shared/`
- Page assets: `public/sites/ciridae-0e008832/root-8a5edab2/`
- Same-site shared assets (fonts): `public/sites/ciridae-0e008832/shared/`
- Downloader: `scripts/download-assets-ciridae-0e008832-root-8a5edab2.mjs`

## Route & scaffold decisions

- `src/app/` contains only the untouched template scaffold (placeholder `page.tsx`) → replace `src/app/page.tsx` with the clone (allowed for first single-URL clone in untouched template). No existing routes affected.
- Base build currently fails: `next/font/google` cannot reach `fonts.googleapis.com` from this network. Fixed in foundation by self-hosting the target's real fonts via `next/font/local` (replaces Geist entirely).

## Shared foundation files to change

- `src/app/layout.tsx` — replace Geist/Geist Mono with self-hosted Pragmatica, Pragmatica Cond, Roboto Mono; metadata (title/description/favicons).
- `src/app/globals.css` — replace scaffold demo tokens with ciridae.com design tokens + site-wide behaviors (custom scrollbar, scroll-snap, keyframes).
- `src/app/favicon.ico` — replace with target favicon.

## Collision check

No existing cloned or user-authored routes, research folders, screenshots, component namespaces, or public assets exist. All planned outputs are unique. No collisions to resolve.

## Connectivity notes

- Shell (npm/curl) CAN reach: `fonts.gstatic.com`, `ciridae.vercel.app`.
- Shell CANNOT reach: `cdn.prod.website-files.com` (Webflow CDN — hosts images + Pragmatica fonts) → download via in-browser fetch (page context) and write to disk.
- Browser (Chrome MCP) CAN reach everything (page fully loaded).
