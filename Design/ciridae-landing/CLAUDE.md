# Ciridae Landing — AI Transformation

ciridae.com 官网首页（landing page）的像素级复刻项目，从 `ai-website-cloner-template` 提取而来，可独立进行二次开发。

## Tech Stack
- **Framework:** Next.js 16 (App Router, React 19, TypeScript strict)
- **UI:** shadcn/ui (Radix primitives, Tailwind CSS v4)
- **Animation:** GSAP (ScrollTrigger / SplitText / ScrambleText), Lenis smooth scroll, Splide carousel, flubber (SVG 路径形变)
- **Fonts:** 自托管 Pragmatica Cond / Pragmatica / Roboto Mono (variable)
- **Deployment:** Vercel

## Commands
- `npm install` — 首次使用前安装依赖
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run lint` — ESLint check
- `npm run typecheck` — TypeScript check
- `npm run check` — Run lint + typecheck + build

## Project Structure (landing page)
```
src/
  app/
    page.tsx          # 首页组装：13 个 section 的渲染顺序 + burger/popup 状态
    layout.tsx        # 根布局、metadata、favicons
    globals.css       # 引入 shadcn + ciridae 移植样式（下方 4 个文件）
  styles/
    ciridae-fonts.css       # 自托管 @font-face
    ciridae-base.css        # 目标站 Webflow 样式（类名原样保留）
    ciridae-utilities.css   # 设计 token + 工具类 (f-*, lh-*, caps, gap-*, mb-*...)
    ciridae-behaviors.css   # 行为样式 (nav/burger/popup/points/builds/we-do/footer...)
  components/
    sites/ciridae-0e008832/
      shared/         # 共享模块：LenisProvider, TextScramble/LinkAnimation, LogoPieces, marquee
      root-8a5edab2/  # 页面组件：Hero, Nav, Burger, Popup, NewsBanner, TeamSection,
                      #            Builds, Points, QuoteEra, WeDo, Testimonials,
                      #            SecurityText, Footer
  types/
    ciridae-0e008832/ # 页面内容类型 + JSX 扩展
public/
  sites/ciridae-0e008832/  # 站点资源（图片/视频/字体/SEO），共享与页面级分开存放
docs/
  research/ciridae-0e008832/root-8a5edab2/   # 逆向研究产物：设计 token、行为、拓扑、组件规格、原始 HTML/CSS 提取
  design-references/ciridae-0e008832/root-8a5edab2/  # 桌面/移动端参考截图
scripts/
  pixel-diff.mjs      # QA 像素对比脚本: node scripts/pixel-diff.mjs <orig> <clone> [diff]
```

## 页面行为速查（复刻自目标站）
- 全局：Lenis 平滑滚动（duration 1.4 / easeOutExpo / wheelMultiplier 1.6）+ GSAP ticker 同步；`body.at-top` / `body.scroll-down` / `body.past-first` 状态类
- Nav：fixed 顶部 52px；随所在 section 的 `change-nav-color` 属性切换黑白；下滑隐藏；MENU 按钮切换 burger；START NOW 触发 popup（通过 `ciridae:popup-open` 自定义事件，页面持有 popup 状态）
- Builds / Points / WeDo：sticky 钉住 + ScrollTrigger scrub 动画；Points 卡片逐个上浮 + 背景缩放
- Testimonials：Splide 轮播 + 自定义箭头 + 计数器
- Footer：sticky 图片 + 玻璃面板 + 按钮文字纵向滚动（slot-reel）
- 入场：`main, nav {visibility:hidden}` 由 LenisProvider 在挂载后恢复；Hero 有独立的 GSAP 入场时间线（logo 模糊→清晰 + 文字逐字 scramble）

## 二次开发提示
- 设计 token 在 `src/styles/ciridae-utilities.css` 的 `:root`（颜色 --color--*、字号阶梯 --size--*、字体 --font--*）
- 组件规格与行为文档在 `docs/research/ciridae-0e008832/root-8a5edab2/`（BEHAVIORS.md / PAGE_TOPOLOGY.md / components/*.spec.md）
- 修改站点资源时注意 public/sites 下的命名空间（site-key: ciridae-0e008832, page-key: root-8a5edab2）
- flubber 通过具名导入使用：`const { interpolate } = await import("flubber")`（ESM 入口没有 default export）

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
