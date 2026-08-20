# Firefly Studio

企业级 AI 视频创作平台（Seedance 模型，飞书 SSO 登录）。前端 React 19 + Vite，后端 Express 5 + better-sqlite3，BullMQ + Redis 队列，TOS 对象存储。

## 功能

- **生成**：文本/首帧/首尾帧/编辑/续写/全能参考六种创作模式，多模型多比例，素材引用（@图片/@视频/@音频）
- **资产**：已归档成片（长期保留）+ 图片素材库（inputs/ 前缀 7 天生命周期）
- **画布（Canvas）**：无限画布工作台 —— 自由排版节点、连线、分组、框选、剪贴板、撤销/重做、小地图、缩放导航；从资产一键插入成片与图片（图片自动迁移到 canvas/ 长期存储）；自动保存（800ms 防抖 + 离页 flush + revision 乐观锁）
- **图片生成**：持久化异步任务；刷新、断网或 Web 重启后继续执行，结果长期保存到 TOS

## 运行架构

- Web 只承载飞书会话、权限、稳定媒体入口和任务 API。
- `generation` Worker 提交/轮询 Seedance；`media` Worker 归档、验证和清理 TOS；`image` Worker 执行 OpenRouter 图片任务。
- SQLite WAL 是用户、项目和媒体元数据的永久真相；Redis/BullMQ 只承担会话、队列、租约和短期缓存。
- 浏览器上传、视频预览和下载直连 TOS，媒体字节不经过 AWS Web。

## 画布（Canvas Feature）

独立于主工程的画布引擎，位于 `src/features/canvas/`：

| 目录 | 说明 |
|---|---|
| `core/` | 纯函数算法（视口/几何/框选/历史/剪贴板/连线/节点规格），100% 可单测 |
| `components/` | CanvasSurface（视口+网格）、CanvasNode、CanvasConnections、CanvasMinimap、CanvasToolbar、媒体插入弹层 |
| `canvas-store.ts` | zustand 文档状态（无 persist，持久化走 API） |
| `canvas-api.ts` | /api/canvases CRUD + 媒体导入 |
| `CanvasWorkspace.tsx` | 画布工作台（/studio/canvas/:id） |
| `CanvasProjectList.tsx` | 画布项目列表（/studio/canvas） |
| `useCanvasInteractions.ts` | 拖拽/框选/连线/剪贴板/撤销重做/快捷键接线 |
| `useCanvasAutosave.ts` | 自动保存 + 409 冲突处理 |

### 数据模型

- `canvas_projects`：画布项目（document_json 全量文档 + revision 乐观锁）
- `canvas_assets`：画布长期素材（canvas/ 前缀对象，从 inputs/ 迁移，规避 7 天生命周期）

### 媒体铁律

节点只存稳定引用（`mediaRef`：generation taskId 或 canvas-asset assetId），**绝不落签名 URL**；
渲染时经 `/api/generations/:id/media` 或 `/api/canvas-media/:assetId` 实时换取签名地址。

### 键盘快捷键（画布内）

| 按键 | 功能 |
|---|---|
| 滚轮 | 以光标为中心缩放 |
| 空格 / Ctrl + 拖拽 | 临时平移 |
| 中键拖拽 | 平移 |
| 空白处拖拽 | 框选 |
| Shift + 点击 | 追加/减选 |
| Ctrl/Cmd + C / V | 复制 / 粘贴 |
| Delete / Backspace | 删除选中 |
| Ctrl/Cmd + Z / Y | 撤销 / 重做 |
| 双击节点标题 | 重命名 |

## 开发

```bash
npm install
npm run db:migrate # 首次启动或切换版本前显式迁移
npm run dev        # vite + web + generation worker + image worker
npm test           # vitest（server/** 与 src/**）
npm run test:e2e   # Playwright Chromium 产品流程
npm run build      # vite build + tsc server
```

生产发布、回滚、恢复和事故处置见 [部署运行手册](docs/deployment-runbook.md)、[数据恢复手册](docs/data-recovery.md) 与 [事故响应手册](docs/incident-response.md)。

## 许可与来源声明

画布交互算法移植自 [infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT, Copyright (c) 2026 basketikun），
每个移植文件头部保留来源注释；许可证副本见 `docs/infinite-canvas-LICENSE.txt`。
