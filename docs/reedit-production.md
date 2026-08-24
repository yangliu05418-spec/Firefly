# 重新编辑 V2：生产运行手册

## 数据边界

- `creation_snapshots` 是提示词、参数与恢复质量的不可变真相。
- `creation_snapshot_references` 按 `binding_id` 保存顺序、类型、原始来源和任务级 TOS 副本。
- `reedit_session_links` 保证同一用户、来源类型和来源任务只对应一个兜底会话。
- Redis 只承担队列、短期锁和指标；清空 Redis 不得影响可恢复内容。
- Provider 只接收服务端生成的 `provider_prompt`。任何 `[[firefly-*]]` 标记到达 Provider 边界都会被拒绝。

## 上线顺序

1. 运行 `npm run db:migrate`，确认 Schema 版本为 10。迁移仅新增表、索引和列。
2. 保持 `REEDIT_V2_ENABLED=false`、`TASK_REFERENCE_ARCHIVE_ENABLED=false` 启动新镜像，确认 readiness。
3. 启用 `TASK_REFERENCE_ARCHIVE_ENABLED=true`，观察 Media Worker 的引用复制积压。
4. 启用 `REEDIT_V2_ENABLED=true`，执行图片和视频重新编辑 Smoke Test。
5. 可选运行 `npm run snapshots:backfill`。历史引用无法证明时会标记 `partial` 或 `unknown`，不会伪造精确恢复。

生产蓝绿脚本会先备份并迁移，再切换流量。数据库扩展不能通过回滚镜像删除；功能回滚只关闭两个开关并切回旧槽。

## Smoke Test

1. 创建带两张图片和一个视频引用的新任务，提示词中分别插入 `@` 素材。
2. 任务进入终态后点击“重新编辑”，核对素材名称、顺序、模式、比例、清晰度和时长。
3. 不点击发送，确认 Provider 任务数不变。
4. 刷新页面，确认草稿仍在；再删除原资产，确认任务级引用仍可恢复。
5. 在另一账号直接请求任务、快照引用和兜底会话，均应返回 404。

## 监控与处置

关注结构化事件：

- `provider_prompt_marker_blocked`：P0。立即关闭 `REEDIT_V2_ENABLED`，保留日志中的任务 ID，禁止重放原请求。
- `reedit_reference_promotion_failed`：检查 TOS CopyObject、Head、Range 和对象生命周期策略。
- `creation_reference_archive_stalled`：任务引用超过 30 分钟仍在归档；确认 Media Worker 和 `media` 队列健康。
- `provider_snapshot_asset_create_unknown`：等待确定性名称对账，禁止人工重复 CreateAsset。
- `reedit_failure_rate_high`：五分钟失败率超过 5%；按错误码区分权限、归档、能力调整和网络故障。

`health:audit` 会报告引用归档积压和重新编辑失败率。历史 `partial/unknown` 的预期缺失不计为基础设施故障。

## 删除与补偿

任务删除先写 SQLite 墓碑，再异步删除 Provider 资产和 `task-inputs/` 对象。后台完成事件使用状态条件更新，不能把 `delete_pending` 恢复成 `ready`。若删除响应丢失，先通过 `GetAsset` 对账；无法确认时保留墓碑并由 Media Worker 重试。
