# Firefly Canvas 功能接入准备文档

> 状态：**M1–M5 全部交付**（feature/canvas-m1 … feature/canvas-m5，未合并 main）
> 交付说明：图片迁移采用同步 TOS copyObject（替代原计划的异步媒体队列 job，避免"copying"僵尸节点，失败原子化）；媒体插入提供双入口（工作台内「插入素材」+ 资产页「插入画布」）；UX QA 报告见 docs/canvas-ux-qa.md
> 基线 commit: bb09ad3；最新：M5 分支头部
> 参考实现：infinite-canvas-main（MIT, Copyright (c) 2026 basketikun）

## 0. 结论摘要

采纳前期调研的总体方案：**不合并工程、不用 iframe，提取画布交互算法，在 Firefly 内建立独立 Canvas Feature（src/features/canvas），重写状态、持久化与 UI 外壳**。

本次复核确认了前期调研的所有关键判断，并补充了以下新事实：

| 项目 | 前期调研 | 复核结果 |
|---|---|---|
| infinite-canvas.tsx | 约 226 行 | 257 行 ✓ |
| project.tsx | 接近 3000 行 | 3030 行 ✓ |
| 前端自动化测试 | 无 | 确认无（web/ 无 vitest 配置；仅 canvas-agent 的 Node 测试，与画布 UI 无关）✓ |
| use-canvas-store.ts:37 | IndexedDB 固定 Key | 确认：zustand persist → localForage，400ms debounce 批量写 ✓ |
| 依赖 | zustand + localforage 等 | 确认 zustand ^5.0.12 / nanoid ^5.1.11 为轻量核心依赖；antd6/tailwind4/router7/motion 为外壳依赖 ✓ |
| 许可 | MIT 需保留声明 | 确认 MIT (c) 2026 basketikun，复制的文件须带来源注释 ✓ |

## 1. 可复用资产清单（经源码核实）

### 1.1 原样可搬（纯函数/无外部 UI 依赖）

| 文件 | 行数 | 内容 | 备注 |
|---|---|---|---|
| `web/src/lib/canvas/canvas-node-geometry.ts` | 70 | nodeBounds / findGroupDropTarget / snapNodesIntoGroup / findContainingGroupId / getConnectionTargetAnchor / normalizeConnection | 分组拖拽吸附 + 连线方向规范化的核心 |
| `web/src/lib/canvas/canvas-node-size.ts` | 15 | fitNodeSize / nodeSizeFromRatio | 图片/视频节点尺寸适配 |
| `web/src/lib/keyboard-event.ts` | 19 | isImeComposing / isPlainEnterKey | IME 输入法判定，快捷键防冲突基础 |
| `web/src/lib/canvas-theme.ts` | 61 | canvasThemes light/dark token 表 | 纯数据，可直接复用（或只取 dark） |
| `web/src/types/canvas.ts` | 138 | Position / ViewportTransform / CanvasNodeData / CanvasConnection / SelectionBox / ContextMenuState | 裁剪掉 Agent/Config 相关字段后全量可用 |

### 1.2 需小幅改造后复用（依赖注入或删插件耦合）

| 文件 | 行数 | 改造点 |
|---|---|---|
| `components/canvas/infinite-canvas.tsx` | 257 | 核心视口交互：滚轮缩放（指数因子 1.1^(delta/100)，0.05–5 倍）、Space/Ctrl 临时平移、中键平移、rAF 节流、网格背景（lines/dots/blank 三种）。改造：useThemeStore → 主题 props；去掉 antd 选择器（.ant-modal 等）的 wheel 排除 |
| `components/canvas/canvas-connections.tsx` | 72 | 贝塞尔连线（曲率 = max(dx*0.5, 50)）、16px 透明命中层、虚线拖拽预览、吸附端点。改造：canvasThemes 传参 |
| `components/canvas/canvas-mini-map.tsx` | 122 | 240x160 小地图：worldBounds 计算（±500 padding）、toMinimap/toWorld 双向换算、视口矩形、拖拽跳转。改造：去 getNodeDefinition（改读节点 type→颜色映射表） |
| `components/canvas/canvas-zoom-controls.tsx` | 78 | 缩放滑杆 5–500% + 重置 + 小地图开关 + 快捷键弹窗。改造：antd Button/Tooltip/Modal → Firefly 自有样式 |
| `components/canvas/canvas-node.tsx` | 820 | 节点渲染+交互：选中描边、hover 关联高亮、标题双击重命名、文本双击编辑、四角缩放（min 220x160、图片/视频 keepRatio）、连接把手。改造：删 pluginHost/buildNodeContext/renderPanel/i18n，内容渲染改为 Firefly 的图片/视频组件 |
| `lib/canvas/canvas-node-factory.ts` | 62 | createCanvasNode（id 格式 `{type}-{ts}-{rand}`，position 以中心点输入）。改造：去 AiConfig/UploadedImage 依赖，id 改 nanoid |
| `lib/canvas/node-registry.ts` + `nodes/builtin-nodes.tsx` | 48+33 | 节点定义注册表（内置 6 类：text/image/video/audio/config/group，含默认尺寸/小地图颜色/keepAspectRatio）。改造：删插件注册机制，保留内置常量表（config 节点 P0 不需要） |
| `constant/canvas.ts` | 50 | NODE_DEFAULT_SIZE / NODE_SPECS 默认尺寸表。改造：去 i18n title |

### 1.3 project.tsx 中需抽取的交互算法（当前与 UI/Agent 混编，约 1000 行）

| 算法 | 位置（行） | 要点 |
|---|---|---|
| 坐标转换 | 451 | screenToCanvas: `(client - viewport.xy) / k`；getCanvasCenter 视口中心 |
| 框选 | 973+1171 | mousedown 记录 startWorld + additive(shift)；pointermove 中 AABB 相交判定逐节点加入选中集；buttons===0 时取消 |
| 多选 | 1010 | selectNodeByEvent：shift/meta/ctrl 切换；capture 阶段选中 + bubble 阶段拖拽（pendingSelectionRef 去重） |
| 节点拖拽 | 1025+1119+1200 | 拖拽集合含分组子节点；>3px 判定 hasMoved；rAF 节流更新；结束时机 finishNodeDrag 做 group drop target 吸附（snapNodesIntoGroup）与 findContainingGroupId 归属更新；纯点击（未移动）时打开编辑面板 |
| 节点缩放 | 1411+canvas-node | 四角 handle；keepRatio（图片/视频默认）；min 220x160；resize 期间 window mousemove |
| 连线 | 1413+530+1213 | 命中半径 CONNECTION_HANDLE_HIT_RADIUS=40px、节点外扩 32px；松开时 connectNodes + normalizeConnection；未命中节点则打开"连线创建菜单"（P0 可省略，直接取消） |
| 剪贴板 | 779/799/1320 | 复制保留组内连线；粘贴居中、id 全量重映射（含 groupId、connections）、title 追加 " Copy"；系统剪贴板粘贴图片/文本自动建节点 |
| 撤销/重做 | 160+931+376 | historyRef{past,future} + lastHistoryRef；180ms debounce 提交、50 步上限（slice(-49)）、future 在提交时清空；拖拽/缩放期间 historyPausedRef 暂停；applyHistory 整体恢复 nodes/connections/选中态 |
| 快捷键 | 1332 | 仅当 target 非 input/textarea/select/contenteditable 时生效；Ctrl/Cmd+Z/Y 撤销重做、A 全选、C 复制、V 粘贴、Delete/Backspace 删除、Escape 清空（先查 window.getSelection() 文本避免劫持复制） |
| 视口辅助 | 800-930 | resetViewport（居中）、setZoomScale（绕视口中心缩放）、focusNode（450ms easeOutCubic 动画、自适应 k） |
| 保存节奏 | 376-424 | 文档变更 → updateProject（zustand persist 400ms debounce）；viewport 单独 500ms debounce |

### 1.4 完全不迁移（确认）

- components/agent/、stores/use-agent-store.ts、pages/canvas/hooks/use-agent-bridge.ts（Agent 体系）
- components/prompts/、stores/use-prompt-source-store.ts、services/api/prompts.ts（提示词库）
- 插件运行时：plugin-loader/plugin-registry/plugin-runtime/plugin-node-context/canvas-plugin-manager-modal、plugins/ 目录
- 图片/音频/视频生成 API、services/api/image.ts、use-config-store（AI 生成配置）
- Config 节点、canvas-node-generation.ts、canvas-node-prompt-panel.tsx、canvas-resource-mention-textarea.tsx
- 遮罩/扩图/切图/角度/超分等节点编辑对话框
- canvas-export.ts / zip 导入导出（可作为后续里程碑）
- localforage 持久化、webdav-sync、app-sync
- i18n、canvas-theme 的主题联动（Firefly 固定暗色即可）

## 2. Firefly 目标结构（微调后）

```text
src/features/canvas/
├── CanvasWorkspace.tsx        # 画布工作台（替代 CanvasComingSoon，接管 /studio/canvas 路由）
├── CanvasProjectList.tsx      # 项目列表（新建/重命名/删除）
├── core/                      # 纯逻辑，100% 可单测
│   ├── viewport.ts            # 坐标转换 screenToCanvas/canvasCenter/缩放
│   ├── geometry.ts            # 从 canvas-node-geometry.ts 迁移 + fitNodeSize
│   ├── selection.ts           # 框选 AABB 判定 + 多选集合运算
│   ├── history.ts             # 撤销重做（180ms debounce、50 步、引用快照）
│   ├── clipboard.ts           # 复制/粘贴（id 重映射）
│   ├── connections.ts         # normalizeConnection + 命中判定 + 贝塞尔路径
│   └── nodes.ts               # 节点工厂 + 内置节点规格表（含 group 逻辑）
├── components/
│   ├── CanvasSurface.tsx      # 来自 infinite-canvas.tsx（视口容器+网格）
│   ├── CanvasNode.tsx         # 来自 canvas-node.tsx（裁剪版）
│   ├── CanvasConnections.tsx  # 来自 canvas-connections.tsx
│   ├── CanvasToolbar.tsx      # 工具切换 select/pan + 撤销重做 + 缩放 + 背景模式
│   ├── CanvasMinimap.tsx      # 来自 canvas-mini-map.tsx
│   └── nodes/
│       ├── TextNode.tsx
│       ├── ImageNode.tsx      # 复用 TaskCard 的 IntersectionObserver 懒加载模式
│       ├── VideoNode.tsx      # 复用 TaskCard 的 video 播放/断线重连模式
│       └── GroupNode.tsx
├── canvas-store.ts            # zustand（无 persist 中间件，持久化走 API 层）
├── canvas-api.ts              # /api/canvases CRUD + 媒体引用解析
└── canvas-types.ts            # 裁剪后的 CanvasDocumentV1 类型
```

新增依赖（仅 2 个）：`zustand@^5`、`nanoid@^5`（与参考实现同版本族）。

## 3. 数据模型与 API

```sql
CREATE TABLE IF NOT EXISTS canvas_projects (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  document_json TEXT NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX IF NOT EXISTS canvas_projects_owner_idx ON canvas_projects(owner_id, updated_at DESC);
```

```ts
type CanvasDocumentV1 = {
  version: 1;
  viewport: ViewportTransform;        // {x,y,k}
  background: "lines" | "dots" | "blank";
  nodes: CanvasNode[];                // {id,type,title,position,width,height,metadata}
  connections: CanvasConnection[];    // {id,fromNodeId,toNodeId}
};
```

API（全部 requireAuth，跨用户统一 404，参照现有任务权限模式 canAccessTask）：

```text
GET    /api/canvases                 → { Items: [{id,title,nodeCount,updatedAt}], HasMore }
POST   /api/canvases                 → 201 {id,title}（body: {title}）
GET    /api/canvases/:id             → {id,title,revision,document}
PUT    /api/canvases/:id             → body {revision, document}；revision 不符 → 409
DELETE /api/canvases/:id             → 204（软删 + 异步清理 TOS canvas/ 对象）
```

写入策略（采纳前期方案并细化）：
1. 画布内所有编辑走 zustand（即时、流畅），无 persist 中间件；
2. 变更后 800ms debounce PUT 全量 document_json（DAU 5 规模文档 < 1MB，全量足够）；
3. revision 乐观锁：PUT 携带上次读到的 revision，不符返回 409，前端提示"已在其他标签页被修改"并加载服务端版本；
4. visibilitychange / beforeunload / 离开 /studio/canvas 路由时强制 flush；
5. 删除画布 = 软删 + mediaQueue 异步清理引用对象。

## 4. 媒体桥接与生命周期（重点风险）

**铁律：节点只存稳定引用，不存签名 URL。**

```ts
type CanvasMediaReference =
  | { source: "generation"; taskId: string }      // 显示时 GET /api/generations/:id/media 换取 302 签名地址
  | { source: "canvas-asset"; assetId: string };   // 长期画布素材，对象在 canvas/ 前缀
```

TOS 生命周期现状（tos-admin.ts 配置）：
- `inputs/` → 7 天自动删除（上传素材 + user_assets 引用的对象）
- `outputs/` → 长期（成片，与任务同生命周期）
- `previews/` / `posters/` → 长期
- `backups/` → 长期

**决策（P0）**：画布节点只允许插入**已归档成片**（generation 引用，outputs/ 长期安全）。AssetArchive 的"插入画布"按钮把 taskId 写入节点。图片节点 P0 的素材来源有两个选项，需要开发前定夺：
- A. 从 ImageAssetManager 插入 → 对象在 inputs/ 会 7 天失效 → 必须加"复制到 canvas/"前缀的迁移任务（新增 TOS copy + media 队列 job），约 +1 天工作量；
- B. 系统剪贴板粘贴图片 → 需要新增画布专属上传接口（`POST /api/canvas-assets`，TOS key: `canvas/{hash}/{userId}/{canvasId}/{assetId}/{safeName}`，长期保留），约 +1.5 天；
- C. P0 图片节点只做占位（无媒体）→ 0 成本但体验打折。
建议：P0 选 A（插入现有图片素材并同步迁移），与视频成片路径一致走"资产 → 画布"单向流程；画布内独立上传与 canvas/ 前缀统一在 P1。

**视频节点渲染必须沿用 TaskCard 的懒加载模式**（IntersectionObserver rootMargin 480px、preload metadata、断线自动重连、播放位置保留），避免多节点带宽竞争——这一点已验证为 Firefly 现有代码中可直接复用的成熟模式（src/App.tsx TaskCard）。

## 5. 测试计划（先补测试再迁移）

原项目零测试，下列纯逻辑迁移前必须先行落地 vitest 用例（沿用 Firefly 现有 vitest 配置，server/**/*.test.ts 与 src/**/*.test.ts 均支持）：

1. **geometry**：nodeBounds 边界；findGroupDropTarget 分层/拒绝自拖；snapNodesIntoGroup 三种越界方向 + 尺寸大于容器时左对齐；findContainingGroupId 中心点归属；normalizeConnection 的 Config 规则裁剪后保留 group 互斥与自连拒绝。
2. **viewport**：screenToCanvas 在 x/y/k 组合下的逆变换正确性（往返一致）；setZoomScale 绕中心缩放不漂移；focusNode 目标 k 计算。
3. **selection**：框选 AABB 相交（含贴边、含负方向框选）；additive 模式初始集合保留；拖拽 3px 阈值判定 click vs drag。
4. **history**：180ms debounce 合并连续编辑；50 步上限 FIFO；undo/redo 后 future 清空；拖拽暂停期间不产生新历史。
5. **clipboard**：粘贴 id 全量重映射（nodes/groupId/connections 一致性）；居中偏移计算；" Copy" 后缀。
6. **connections**：40px 命中半径；normalizeConnection 方向；连线删除时级联。

迁移顺序：core/ 纯函数 + 测试 → CanvasSurface/CanvasNode 渲染 → 交互接线（拖拽/框选/连线）→ 持久化 API → 媒体桥接 → UI 外壳打磨。

## 6. 风险清单与对策

| 风险 | 对策 |
|---|---|
| 快捷键与 Firefly 输入框冲突 | 复用参考实现的 target 排除模式（input/textarea/select/contenteditable）+ isImeComposing；Firefly 的 PromptEditor 是 contenteditable，天然被排除 ✓ |
| 历史快照内存 | 50 步上限 + 快照只存引用（原实现即引用拷贝）；media Blob 不进 metadata（P0 无 Blob） |
| 签名 URL 过期 | 铁律：只存 taskId/assetId，渲染时实时换 URL；preview-url-cache 的稳定 URL 模式可复用于画布节点 |
| inputs/ 7 天生命周期 | 见 §4 决策 A：插入时迁移到 canvas/ 前缀 |
| 多标签页覆盖 | revision 乐观锁 + 409 冲突提示 |
| 视频带宽竞争 | 懒加载模式复用 TaskCard |
| 许可合规 | 迁移文件头部加注释：`// Ported from infinite-canvas (MIT) https://github.com/basketikun/infinite-canvas Copyright (c) 2026 basketikun`；根目录 docs/ 保留 LICENSE 副本 |
| 原项目无测试 | §5 先行补测试再迁移（每个 core 模块随测试一起合入） |
| antd/tailwind 污染 | 不引入任何原 UI 依赖；样式全部走 Firefly 自有 CSS 变量体系（styles.css） |

## 7. 里程碑

- **M0 已交付**：git 初始化 + 基线备份（bb09ad3）+ 远端推送（https://github.com/yangliu05418-spec/Firefly.git）
- **M1 基础设施**：依赖安装（zustand/nanoid）；canvas_projects 表 + /api/canvases CRUD + 测试；路由替换 CanvasComingSoon → CanvasProjectList
- **M2 画布核心**：core/ 纯函数迁移 + 测试；CanvasSurface/CanvasNode/连线/小地图/缩放控件（Firefly 样式）
- **M3 交互**：拖拽/框选/多选/剪贴板/撤销重做/快捷键接线 + 交互测试
- **M4 媒体桥接**：AssetArchive"插入画布" + generation 引用渲染 + 懒加载视频节点；图片节点迁移决策落地
- **M5 打磨**：自动保存 flush、409 冲突、删除清理、项目列表分页、README 与许可声明
