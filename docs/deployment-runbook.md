# Firefly 生产发布运行手册

## 发布边界

- 开发基线是受保护的 `release/candidate-3`；生产只能部署 GHCR 的 `sha256` digest，禁止使用浮动 tag。
- 每个 P0/P1/P2 版本独立 PR。CI 必须通过 Source safety、Node、Chromium、容器健康和漏洞门禁。
- `production` Environment 必须人工批准。发布者不能跳过备份、迁移、readiness 或五分钟观察窗。

## GitHub 配置

Secrets：`PROD_SSH_PRIVATE_KEY`、`PROD_SSH_HOST_KEY`、`GHCR_PULL_TOKEN`、`FEISHU_WEBHOOK_URL`。其中 GHCR Token 只授予 `read:packages`。

Variables：`PROD_HOST`、`PROD_USER`、`PROD_DOMAIN`。真实集成另使用 `INTEGRATION_*` Secrets/Variables，PR 与 Fork 永远不能读取。

## 发布前

1. 确认 PR 合并 SHA、CI 结果和生成的镜像 digest。
2. 使用 `npm run admin -- queue-status` 检查队列；活动任务不阻止发布，但必须确认新旧 Worker 支持锁过期恢复。
3. 检查最近备份不超过八小时，并完成最新备份的只读恢复校验。
4. Schema 变更只能 expand-only；确认旧镜像仍能读取迁移后的数据库。
5. 涉及 root-owned 发布脚本或 systemd unit 时，先由主机管理员从已审核源码运行 `ops/bootstrap-deploy-host.sh`，不得授权 deploy 用户任意 sudo。

## 蓝绿切流

批准 GitHub `production` 后，root-owned 入口自动：获取发布锁、按 digest 拉镜像、备份与 TOS Head 校验、执行一次迁移、在 8090/8091 空闲槽启动 Web、连续三次 readiness、启动候选 Workers、原子更新 Nginx、旧 Workers 有界退出，并每十秒观察五分钟。

验收：

- `/api/health/live` 返回候选 revision/digest。
- `/api/health/ready` 连续成功，schema version 与发布一致。
- 登录 Cookie 不失效；Generation、Media、Preview、Image 队列可读。
- Nginx 无重复 `server_name`；候选容器无重启；TOS 可达。

## 回滚

- readiness、Nginx 校验或观察窗连续两次失败会在 60 秒内自动切回旧端口并重启旧 Workers。
- 成功发布后旧 Web 保留 30 分钟。即时回滚使用 `/etc/firefly/release.env` 中上一 digest，不修改数据库。
- 若新版本包含非向后兼容迁移，禁止自动回滚；此类迁移不得进入蓝绿版本。

每次成功、失败、回滚和备份异常都通过飞书发送版本、阶段、耗时和 Case ID，不包含 Prompt、签名 URL 或密钥。
