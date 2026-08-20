# Firefly 数据备份与恢复

## 真相与范围

- SQLite `/srv/firefly/data/firefly.db`：用户、项目、画布和媒体元数据。
- Redis AOF：会话、BullMQ 队列与短期缓存；不是项目历史真相。
- TOS：输入、成片、预览、海报、生成图片和画布资产。

备份任务使用当前不可变发布镜像执行 SQLite Online Backup，随后运行 `integrity_check`、SHA256、本地只读恢复和 TOS Head 验证。任何一步失败都视为备份失败。

## 恢复演练（不覆盖生产）

1. 选择最近的 `.db` 与对应 SHA256，确认备份年龄和 TOS 对象存在。
2. 恢复到新建临时目录，不得直接指向 `/srv/firefly/data/firefly.db`。
3. 以只读模式执行 `PRAGMA integrity_check`，核对 `schema_migrations`、用户数、任务数和媒体数。
4. 使用同一版本镜像执行 `node dist-server/migrate.js` 的 dry environment 验证兼容性。
5. 删除临时恢复目录；记录演练时间、备份名、revision 和结果。

## 生产恢复

1. 停止 Web 和全部 Workers，保留 Redis 与 TOS 不变。
2. 再做一次故障现场备份；不要覆盖原数据库。
3. 将选定备份复制为新的数据库路径，校验 SHA256 和 integrity。
4. 原子替换数据库文件，并确保 `.db-wal/.db-shm` 来自同一停机状态或不存在。
5. 运行对应镜像的显式迁移，先启动 Web readiness，再启动 Workers。
6. 验证两个用户隔离、任务列表、TOS 媒体重定向和队列恢复。

TOS 对象缺失时不要伪造 ready：使用受审计 CLI `task-rearchive`、`media-recover` 恢复；写操作必须设置 `FIREFLY_OPERATOR` 并精确重复 `--confirm <taskId>`。
