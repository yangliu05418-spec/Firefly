# 文本生成

在创作类型中选择“文本生成”。28 个固定 OpenRouter 模型按 11 个供应商分组，可搜索、筛选和滚动选择。

## 请求契约

- POST `/api/text-generations`，仅登录用户可用，必须拥有提交的创作会话，同源写请求检查沿用主应用。
- 模型请求仅包含 `model`、`stream: true`、一条 `role: user` 消息。输入原样保留，不追加系统提示词、历史、工具或输出 token 限制。
- 无额外 Prompt 字数上限；沿用应用 HTTP 请求体保护。供应商的上下文窗口仍然有效。
- 不自动更换模型或重试生成，避免不确定失败后重复计费。每个请求 UUID 24 小时内去重，每用户最多 3 个并行文本请求。
- SSE 支持注释心跳、UTF-8 分片、流中错误、断流检测和背压。Nginx 关闭该路由缓冲与自动上游重试。
- 最长请求 10 分钟；停止、导航和断开连接中止上游连接。部分供应商仍可能完成已接纳请求并计费。

## 保存与边界

文本结果和草稿按用户、创作会话存于本浏览器 IndexedDB，刷新可恢复；不承诺云端同步。显式退出清理该用户文本记录。结果只用于查看，绝不自动构成后续请求上下文。中断后保留已收到文字，不自动重发。

## 运维

服务端复用 `OPENROUTER_API_KEYS`，不得将密钥写入前端、仓库或日志。轮换通过现有密钥文件和蓝绿容器更新完成。日志只记录用户/会话/请求/模型 ID、耗时及结构化错误码，不记录 Prompt、输出或认证信息。

无 Schema 变更；回滚上一镜像即可移除入口，不影响图片、视频、Atlas 或已有媒体。

## 官方依据

- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart)
- [Streaming](https://openrouter.ai/docs/api_reference/streaming)
- [Models API](https://openrouter.ai/api/v1/models)

2026-09-20：通过新密钥的可用模型目录核对全部 28 个 ID，并对 OpenAI、Anthropic、Google 各一个指定模型进行真实流式冒烟。目录可用不等同于所有模型完成真实生成验收。
