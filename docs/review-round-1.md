# Code Review Round 1 — 定位、核实与修复报告

> 分支：fix/review-round-1（基于 feature/canvas-m5）
> 范围：server/（任务媒体状态机、TOS 抓取、上传/注册、权限、资产引用、Feishu 绑定）+ src/（状态文案、删除按钮、素材状态预检）
> 验证：125 个测试全绿（新增 7 个）、前后端类型检查零错误、生产构建通过

## 核实结论一览

| # | 发现 | 核实结果 | 处置 |
|---|---|---|---|
| P0-1 | 媒体可用性状态机过严，归档中/回退态不可预览 | ✅ 属实：publicTask 仅在 ready 时暴露 videoUrl，archiving/fallback/failed 期间上游临时源可播放却不可见 | 修复 |
| P0-2 | TOS 抓取缺少强制超时与可追踪元数据 | ⚠️ 部分属实：已有 deadline(120s)+轮询+指数退避；缺 fetchTaskId/轮次/错误结构化持久化，恢复循环无上限 | 修复 |
| P0-3 | 归档失败易误判终态 | ⚠️ 部分属实：status 保持 succeeded（未误判），但 videoUrl 隐藏且临时源过期后永久不可看 | 修复 |
| P0-4 | 上传/注册双栈耦合，引用链不一致 | ✅ 属实（legacy 后端）：legacy complete 不登记 media_objects，引用形态与 TOS 分叉；注册期报错误导 | 修复 |
| P1-5 | 共享可见性过宽且边界混淆 | ⚠️ 属实但属设计：shared 全可见（团队历史，明示意图）；删除/写入边界未统一 | 修复（明确策略） |
| P1-6 | 共享任务无法清理 | ✅ 属实：softDeleteTask 限定 visibility='private'，owner 也无法删自己的 shared 任务 | 修复 |
| P1-7 | 资产占用 LIKE 模糊匹配 | ✅ 属实：request_json LIKE 存在 id 前缀误判 | 修复 |
| P1-8 | Feishu 绑定唯一性阻断 | ❌ 判定为安全设计：企业邮箱是 SSO 身份锚点，阻断新 open_id 冒领可防账号接管；改动反而引入接管风险 | 不改行为，补审计日志 + 注释 |
| P1-9 | 资产注册等待策略不透明 | ⚠️ 部分属实：前端已禁用非 Active 素材；服务端等待 3 分钟后报错无错误码、Failed 文案误导 | 修复 |

## P0-1 修复：分层媒体可用性

server/task-public.ts：
- ready → 稳定 Firefly 路由（/api/generations/:id/media?rev=）
- archiving / fallback / failed → 暴露上游临时源 videoUrl + videoExpiresAt + mediaSource:'upstream'（可播放但非最终态）
- 临时源过期 → 不再暴露；前端 TaskCard 已具备 expired/archiving/failed 文案基座，footer 增加「临时源预览中，归档完成后将提供稳定入口」
- 安全不变：sourceVideoUrl/sourceVideoExpiresAt 字段仍从公开投影剥离

同步收紧下游消费：AssetArchive 与画布「插入素材」只接受 mediaStatus=ready 的成片（画布铁律：只引用稳定媒体）。

## P0-2/P0-3 修复：抓取可追踪性 + 恢复上限 + 分层保护

- generation_tasks 新增列（含既有库 ALTER 迁移）：fetch_task_id / media_attempts / media_last_error
- archive-output 执行中：fetchTaskId 持久化到任务（observer.taskCreated），失败时写结构化 trace（phase/code/statusCode/message/elapsedMs）
- 恢复轮次上限 MAX_MEDIA_RECOVERY_ATTEMPTS=3：recoverableMediaTasks 查询与 worker 失败处理器同步封顶，超限停止自动重试并输出 tos_recovery_exhausted 日志
- 归档失败不再影响任务终态：status 保持 succeeded（生成本身成功），临时源在有效期内持续可预览；最终态文案沿用「成片归档待恢复」

## P0-4 修复：统一素材引用形态

- 新增 server/media-url.ts resolveUploadMediaUrl()：唯一入口解析「上传素材 → 可访问地址」
  - inputs/（TOS）→ 签名 URL
  - legacy/（本地存储）→ HMAC 媒体路由（与 /api/uploads/:id/complete 同一套 token 语义）
- legacy complete 现在同样登记 media_objects（kind=input），与 TOS 路径引用形态一致
- legacy + localhost origin 时 fail-fast 抛出明确错误（提示配置公网 PUBLIC_ORIGIN 或启用 TOS）
- asset-registration 的 deps.sign → deps.resolveMediaUrl（异步、按存储后端解析）

## P1-5/P1-6 修复：共享任务删除权限矩阵

策略（已注释固化）：shared = 团队历史只读可见；**owner 可删除自己的任务（private 与 shared 一致）**，读者不可删。
- server/db.ts softDeleteTask：去掉 visibility='private' 限制，保留 owner_id 校验
- 前端 TaskCard 删除按钮：visibility!=='shared' → canDelete（task.ownerId === user.id）
- 遗留无 ownerId 的旧 shared 任务保持不可删（无可归属主体，符合只读语义）

## P1-7 修复：资产占用结构化精确匹配

isUserAssetInActiveTask 由 `request_json LIKE '%id%' ESCAPE` 改为
`json_each(request_json, '$.assets') + json_extract(entry.value, '$.assetId') = ?` 精确匹配：
- 消除 id 前缀误判（asset-abc 不再命中 asset-abcdef）
- 非活动任务、uploadId 形态引用不会误阻塞删除

## P1-8 核实结论：安全设计，不改行为

upsertFromFeishu 的邮箱唯一性阻断是**防账号接管控制**（企业邮箱 = SSO 身份锚点）。
若按建议改为 tenant+open_id 主键，新 open_id 可冒领任意邮箱进入企业账号。
处置：保留强校验，新增 auth_binding_conflict 结构化审计日志与意图注释；管理员介入路径（disableByEmail）不变。

## P1-9 修复：资产注册错误码 + 前端预检

- AssetRegistrationRejected 携带结构化 code：ASSET_REAL_PERSON / ASSET_NOT_OWNED / ASSET_PROVIDER_FAILED / ASSET_PROCESSING_TIMEOUT
- waitForActive：Failed 文案细分（不再一律指向真人认证）；超时消息带等待秒数
- respondError 透传 code 到响应体（前端 api.ts 无需改动即兼容）
- 前端：LibraryPanel 携带 Status → attachMentionAsset 预检 Processing/Failed 并给出明确提示（配合原有禁用按钮形成双保险）

## 回归与新增测试

- task-public.test.ts：重写为分层可用性断言（archiving/fallback/failed 暴露临时源、过期隐藏、ready 稳定路由、非 succeeded 不暴露）
- auth-isolation.test.ts：+shared 删除矩阵、+结构化引用匹配（含前缀负例）、+trace 字段持久化与恢复上限
- asset-registration.test.ts：+ASSET_PROCESSING_TIMEOUT / ASSET_PROVIDER_FAILED 错误码断言，deps 改 resolveMediaUrl

## 遗留建议（非本次范围）

1. 恢复耗尽后的任务提供人工「重新归档」入口（需管理端或用户侧显式重试按钮）
2. 多窗口协作与共享审计报表可作为后续独立项目