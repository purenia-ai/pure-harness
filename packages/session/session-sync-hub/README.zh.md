---
description: "把会话增量归档到 hub 的 session-trace 接口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-sync-hub

[English](README.md) | 中文

## 概述

在对话进行中把每个活动会话归档到 PureHub 的 `session_traces` 接口，并把每次目标变更镜像到 hub 的目标归档。该函数插件注入 `ctx.sessions`，并拥有记录"hub 已接受到哪一条"的 `session-sync-hub/delivery-accepted` 事件。上传与主循环并行：去抖窗口限制请求频率，按批次限制载荷大小，失败只推迟下一次尝试。

## 目录

- [配置](#configuration)
- [上传内容](#what-is-uploaded)
- [重试与水位](#retries-and-watermarks)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | `https://hub.puresnake.com` | hub 源站；插件自行追加 `/api/session-trace/save`。 |
| `enabled` | `true` | 全局开关；设置表单写入会覆盖这一组合层取值。 |
| `uploadReasoning` | `true` | 以 `【思考】` 段落归档助手推理内容。 |
| `uploadSystemMessages` | `true` | 归档 `system` 与 `developer` 提示。 |
| `uploadGoals` | `true` | 把 `goal/change` 快照镜像到 `/api/session-goal/save`。 |
| `toolResultCap` | `8000` | 单条工具结果超过该字符数时截断。 |
| `debounceMs` | `5000` | 最后一条归档事件之后的静默窗口，到时排空该会话队列。 |
| `maxBatchMessages` | `200` | 单次保存请求的最大行数。 |
| `maxBatchBytes` | `2097152` | 单次保存请求中 `messages` 序列化后的最大字节数。 |
| `maxBatchGoals` | `100` | 单次目标保存请求的最大快照数。 |
| `maxConcurrentSessions` | `2` | 同时排空队列的会话数上限。 |
| `disabledSessions` | `[]` | 用户静音的会话 id；由会话头动作增删。 |

每次请求都带当前登录账号的 access token（`Authorization: Bearer`）；插件按配置的 origin 通过 `ctx.deepseekAccount.resolveToken` 取得，从不保存；该 origin 必须与部署允许接收账号 token 的 origin 一致，否则取不到 token、不会上传。未登录时保留队列，登录后随下一条事件自动补传。

<a id="what-is-uploaded"></a>
## 上传内容

一个规范事件对应一行归档记录，行序号直接取事件自身的序列号：

| 事件 | 行 |
|---|---|
| `user/message` | `role=user`，拼接文本块 |
| `assistant/message` | `role=assistant`；开启思考上传时追加 `【思考】` |
| `system/message`、`developer/message` | `role=system` / `role=developer` |
| `tool/call` | `role=tool`，工具名与原始入参 |
| `tool/result` | `role=tool`，结果文本与显式截断字段 |

每次请求还携带文件解析型运行时没有的会话事实：`ownerId`（登录账号）、`startedAt`（会话头创建时间）、`lastEventAt`、`formatVersion`、`parentSessionId`、`agentPreset` 与原始会话头 JSON。hub 把它们存进 `session_trace_meta`。

### 目标快照

`goal/change` 事件不产生消息行，而是成为一条目标快照，走独立的 `/api/session-goal/save` 请求，与消息批次各自排队、各自重试：

| 事件 | 快照 |
|---|---|
| 携带完整目标的 `goal/change` | `goalId`、`revision`、`operation`、`phase`、`objective`、`maxGoalRounds`、`roundsStarted`、`blockedReason`，以及 ISO 格式的 `goalCreatedAt` / `goalUpdatedAt` |
| 携带清除墓碑的 `goal/change` | `goalId`、`revision`、`operation=clear`、`cleared=true` |

每次目标请求都带 `runtime`（`dsh`）、`sessionId` 与登录账号的 `ownerId`。hub 以 `(runtime, sessionId, goalId)` 做键、按 `revision` 去重，因此重发同一条快照不会产生第二份状态。映射不出完整快照的事件会被跳过，不会发出去。

<a id="retries-and-watermarks"></a>
## 重试与水位

请求成功后会追加 `session-sync-hub/delivery-accepted`，记录本批最后上传的序列号；后续窗口读取该标记，只重发其后的尾巴。请求失败会保留队列，并按指数退避重试，最长一分钟。`401` 通过 `rejectToken` 丢弃当前 token，下次尝试自动刷新；`404` 视为配置错误并停止该会话。被重定向到登录页不算接受成功：该批保留在队列里，等下一个窗口重试。会话销毁时用 `finalBatch` 与 `messageTotal` 冲洗剩余行，让 hub 冻结消息数。

目标快照有自己的队列与重试预算，任一接口失败都不会拖慢另一个。它的水位不是会话事件，而是 hub 自己的 `(runtime, sessionId, goalId, revision)` 键：重启或重试后重发的快照会被 hub 去重。目标路径返回 `404` 表示 hub 还没提供该归档：快照留在队列里，只记一条警告，下一次目标变更时再试，因此上线该接口不需要重启客户端。

<a id="model-experience"></a>
## 模型体验

### 会话归档

#### 模型看到什么

无。归档行是会话日志的镜像，与主循环并行上传；`enabled`、`uploadReasoning` 与 `disabledSessions` 只改变归档流量，不改变请求字段、提示词或工具 schema。

#### Token 影响

零模型输入 token；归档只增加发往 hub 的 HTTP 请求。

#### KV Cache 影响

不改变模型请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **仅活动会话** — 插件挂载前创建的会话不回填；归档从下一条事件开始。挂载前记录的目标快照同理。
- **依赖 hub 登录态** — 取不到账号 token 时插件只保留队列、不上传；登录后随下一条归档事件自动继续，无需重启。
- **目标归档依赖 hub 部署** — hub 尚未提供 `/api/session-goal/save` 时，快照留在队列里等下一次目标变更重试；消息归档不受影响。
- **会话列表存在设置文档** — 单会话静音属于 Host 设置文档，跟随机器而不随会话 Fork 迁移。
- **工具行不配对** — 调用与结果各占一行；要合并展示需要改 hub 查看页。
- **水位事件增长** — 每个接受的批次向会话日志追加一条小事件。
- **无 HTTP 回读** — 插件把 2xx 视为接受，不重新读取归档。

<a id="dev-note"></a>
### 开发备注

无。
