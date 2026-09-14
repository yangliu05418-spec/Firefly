# 本地工作区维护

## 单一开发入口

默认在 `E:\Downloads\AIGC` 根目录开发。`apps/atlas` 是产品实际使用的 Atlas 子应用；根目录的 `Atlas`、`Design`、`bloub-main` 等原始参考素材不能被当成运行版本，也不要因名字相似而删除。

集成代码使用 `origin/release/candidate-3`。保留 `main` 和其他发布分支，不强推、不以旧分支覆盖新代码。历史功能 PR 可能经过 squash 合并，不能仅凭“原分支不是集成分支祖先”判断功能未合并，更不能将所有旧分支重新合并。

每项开发工作在最新集成版本上建立一个 `codex/` 分支；优先复用根目录。确需并行隔离时才创建临时 worktree，通常不超过两个。不要为每次修复复制整个仓库及依赖目录。

## 依赖与产物

- 根目录依赖由根 `package-lock.json` 管理；Atlas 依赖由 `apps/atlas/package-lock.json` 管理。
- 按 CI/Dockerfile 的 Node 版本安装依赖。更换依赖版本或平台时使用 `npm ci`，不复用不同锁文件或不同平台的 `node_modules`。
- 根目录校验：`npm run typecheck`、`npm test`、`npm run build`。
- Atlas 单独安装依赖并执行其类型检查、Firefly 发布测试和构建；构建环境设置 `VITE_APP_VARIANT=firefly`。
- `node_modules`、构建输出、Playwright 报告和旧发布压缩包不是源代码备份。需要时重建，不按版本永久堆积。
- 本地整理记录放在 `.local-maintenance/`，不要上传到 Git、Docker 构建上下文或对外共享，其中可能含本地数据与恢复资料。

## 清理前的检查

1. 检查 Git 状态、未跟踪文件、被忽略的数据库及环境配置，确认没有正在工作的进程。
2. 检查 PR 合并状态；本地独有提交保留 Git 引用，未提交改动保存到命名 stash 或补丁，独有文件单独校验备份。
3. Windows 上先确认绝对路径位于本项目内，识别 Junction；不能跟随链接删除另一份工作区或当前依赖目录。
4. 用 `git worktree remove` 清理已确认干净的临时工作区，不使用强制参数跳过未提交内容检查。
5. 本地数据库、上传文件、凭据、设计源素材和用户导出的记录默认保留。不得执行全局 Docker prune、删除其他项目，或因本地清理变更服务器。
6. 清理后检查 Git refs、当前分支状态及类型检查/测试。保留一份近期的恢复记录，不建立层层重复的仓库备份。

## 2026-09-14 整理基线

业务源码对齐 `release/candidate-3@13d2a28d`（并发 10，PR #161）。工作区整理提交只调整忽略规则和本说明，不修改业务逻辑、不部署服务。

原根目录的未提交内容保存于命名包含 `workspace-consolidation-20260914` 的 stash。恢复时先审查补丁并在独立分支处理，不直接将旧目录的删除记录或旧需求说明覆盖到最新代码。详细清单和恢复 bundle 见本机 `.local-maintenance/20260914/`。
