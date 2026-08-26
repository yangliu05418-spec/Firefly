# Firefly 可观测性与用户旅程 SLO

## 事件入口

- Web与全部Worker将结构化 JSON 写入标准输出；生产容器统一使用 Docker `journald` 驱动和 `firefly/<container>` 标签。当前主机已启用持久化 journal，因此日志跨容器集中查询且不需要新增常驻采集服务。
- 浏览器通过受登录与同源保护的 `POST /api/client-events` 上报允许列表事件；接口按用户限制为每分钟 120 条。
- 用户旅程事件同时写入 Redis Stream `observability:events`（约 100,000 条上限）作为单机架构的集中事件索引。事件不保存 Prompt、媒体签名 URL、Cookie、邮箱或密钥。
- `npm run observability:report -- 200` 输出最近 200 条集中事件和最近 60 分钟 SLO 摘要。生产中应在当前发布镜像内运行，并复用只读运维环境。
- 主机执行 `sudo firefly-logs 60 500` 可按时间顺序读取最近60分钟、最多500条Web与Worker日志；输出统一为NDJSON并带容器名。

## 核心 SLO

健康审计每 5 分钟计算最近 15 分钟窗口。少于 5 个样本时只展示数据，不告警。

| Journey | 可用性目标 | P95 目标 | 成功定义 |
| --- | ---: | ---: | --- |
| `studio_bootstrap` | 99% | 5s | 模型、会话、生成历史完成首屏恢复 |
| `asset_archive_view` | 99% | 3s | 资产归档页面进入可交互状态 |
| `poster_load` | 99% | 5s | 海报图片完成浏览器解码并进入 `ready` 状态 |

SLO 触发后，现有 `firefly-health-audit.timer` 会产生 `slo_<journey>_breached` 状态，并复用飞书状态变化告警。恢复时发送恢复事件，避免重复刷屏。

## 前端错误采集

- 捕获 React 渲染错误、`window.error`、未处理 Promise rejection 与资源加载错误。
- 同一错误指纹一分钟内只发送一次；URL会在浏览器侧清洗。
- React 根错误边界提供明确恢复页，重新载入不会重新提交后台生成任务。
- `frontend_runtime` 只作为错误流统计，不伪造成功分母，因此不单独计算可用性 SLO。

## 海报诊断顺序

1. 任务响应必须为 `posterStatus=ready` 且包含 `posterUrl`；`processing` 不应包含 URL。
2. 浏览器中的 `.archive-card__poster` 必须满足 `complete=true`、`naturalWidth>0`、`data-recovery-state=ready`、计算后 `opacity=1`。
3. `poster_load` 失败先检查集中事件中的任务 ID与错误码，再检查 Media Worker 的 `tos_poster_*` 结构化日志。
4. 海报失败不能阻止视频预览和下载；卡片保留明确的恢复占位。
