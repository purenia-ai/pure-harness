# DSH 会话同步到 Hub 设计（一期）

> 2026-11-02 · 影响仓库：`pure-harness`（本期）、`purehub`（两处小改动）

## 1. 背景与目标

DSH 会话目前只落在本机 `~/.dsh/sessions/`（每会话一个只追加的 JSONL 日志）。hub 侧已有一套「本地 AI 会话归档」能力（`session_traces` / `session_trace_messages` 两表 + `POST /api/session-trace/save` + 只读查看页），但目前只接 `claude` / `codex` 两个 runtime。

本期把 DSH 会话接进同一条链路，目标：

1. **自动同步**：聊天过程中增量推送，不要求实时，允许缓冲。
2. **默认开启，可关闭**：全局开关默认开。
3. **按会话开关**：入口在会话右上菜单（`conversation.session.header.actions`）。

## 2. 范围

| 做 | 不做（二期） |
|---|---|
| 实时会话增量同步（进程存活期间） | 历史会话回填、离线补传旧会话 |
| 全局开关 + 单会话开关 | 服务端按用户隔离（沿用"所有上传对登录用户可见"） |
| 思考内容可配置上传（默认上传） | 思考内容单独成列/折叠展示 |
| 工具结果显式截断 | 全文检索、Run/Trace 关联 |
| 会话元信息（归属人/起止时间/谱系）落库 | 双向同步、冲突合并 |

## 3. 现状与复用

### 3.1 hub（purehub，只做两处小改动）

`f39c9a8`（2026-09-16）已实现：

- 写：`POST /api/session-trace/save`，`X-API-Key` / `Bearer` 鉴权（`long-sys ApiKeyAuthFilter`，路径已加入 `apikey.auth.paths`），分片追加、按 `(runtime, session_id)` upsert、消息按 `UNIQUE(trace_id, seq)` 幂等、`reset`/`finalBatch` 语义。
- 读：`GET /run/session-trace/list|show`（登录态）+ `session-traces.html` 查看页。

**必须改的两处：**

1. `pure-run/.../service/SessionTraceService.java` 的 `RUNTIMES` 增加 `dsh`（现在只允许 `claude`/`codex`，其他值 400）。
2. `pure-app/src/main/resources/static/session-traces.html` 的运行时筛选下拉与 `RUNTIME_LABEL` 增加 `dsh`。

**新增一张表 `session_trace_meta`**（会话级扩展，`session_traces` 不动）：

```sql
CREATE TABLE IF NOT EXISTS session_trace_meta (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id          INTEGER NOT NULL UNIQUE REFERENCES session_traces(id),
  owner_id          TEXT,     -- DSH 账号 id（getProfile().id）
  started_at        TEXT,     -- session.header.createdAt
  ended_at          TEXT,     -- 会话结束时写入（可空）
  last_event_at     TEXT,     -- 最后一条事件时间
  format_version    INTEGER,  -- sessionFormatVersion
  parent_session_id TEXT,     -- fork / 子会话
  agent_preset      TEXT,
  header_json       TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_trace_meta_owner ON session_trace_meta(owner_id);
CREATE INDEX IF NOT EXISTS idx_session_trace_meta_started ON session_trace_meta(started_at);
```

落法：新表用 `CREATE TABLE IF NOT EXISTS`（双方言幂等），写侧在 `save` 成功后 upsert；同时更新 `pure-run-{sqlite,mysql}.sql` 与 `RunJdbcConfig`；生产 MySQL 需手工执行迁移。

### 3.2 DSH 会话记录形态（映射来源）

- 路径：`~/.dsh/sessions/--<规范化 cwd>--/session-<id>/session.v<N>.jsonl.zstd`
- 只追加；默认 zstd **首帧只含 header，之后每个 append 批次一帧**；`compression: 'none'` 时为明文行
- header：`{type:'session', version, id, createdAt, cwd, isSeeded, delegationDepth, agentPreset?, parentSession?, origin?}`
- 事件行：`{type, seq, time, data, surfaceOp?, sourceEventSeqs?}`
- 核心事件：`turn/start|end`、`step/start|end`、`user/message`、`developer/message`、`system/message`、`assistant/message`（含 `content[]`：text / reasoning / tool-call，另有 `stream`、`usage`）、`tool/call`、`tool/result`、`request/header|context`、`session/title`

## 4. 架构

```
Host: session-sync-hub
  ctx.on('session/event' | 'session/disposed')
        │  按会话队列 + 去抖
        ▼
  映射器（事件 → hub messages[]）
        ▼
  批量 POST /api/session-trace/save（X-API-Key）
        ▼
  hub：session_traces + session_trace_messages + session_trace_meta
        ▼
  查看页 /run/session-trace/*

API: session-sync-controller（host 方法 + client 服务）
Client: ui-session-sync
  ├─ 设置页 General：全局开关（默认开）
  └─ conversation.session.header.actions：单会话开关 + 状态
```

三个包（对齐 jobs 的既有拆法）：

| 包 | 角色 |
|---|---|
| `packages/experimental/session-sync-hub` | Host 核心：采集、缓冲、映射、推送、水位 |
| `packages/api/session-sync-controller` | Host↔Client 方法：读取/写入单会话开关与同步状态 |
| `packages/client/ui-session-sync` | 设置开关 + 会话头菜单 + locale |

## 5. 数据映射

### 5.1 会话级

| hub 字段 | 来源 |
|---|---|
| `runtime` | 固定 `dsh` |
| `session_id` | DSH session id |
| `project_dir` | `header.cwd` |
| `title` | session title 服务（无则空） |
| `model` | 最近 `assistant/message.data.message.source.model` |
| `message_count` | `finalBatch` 时带 `messageTotal` |
| `uploaded_by` | 服务端从 API key 身份取 |
| `session_trace_meta.owner_id` | `ctx.deepseekAccount.getProfile().id` |
| `started_at` | `header.createdAt` |
| `last_event_at` | 最后一条已上传事件的 `time` |
| `ended_at` | `session/disposed` 或归档时 |
| `format_version` | `header.version` |
| `parent_session_id` / `agent_preset` / `header_json` | header 对应字段 / 原始 header |

`lines_*`、`skipped_lines`、`subagent_files_excluded`、`source_file/line`、`message_uuid`、`turn_id` 对 DSH 无意义，填 0 / null。

### 5.2 消息级

| DSH 事件 | hub 行 |
|---|---|
| `user/message` | `role=user`，`content`=文本拼接 |
| `assistant/message` | `role=assistant`，`content`=文本；`uploadReasoning=true` 时在前部插入 `【思考】` 段落（`content[type=reasoning]`）；`content[type=tool-call]` → `tool_name` / `tool_input` |
| `tool/result` | 合并到对应 assistant 行：`tool_result`（超 `toolResultCap` 截断并标 `toolResultTruncated=true` + `toolResultOriginalLength`） |
| `system/message` | `role=system`（`uploadSystemMessages=false` 时跳过） |
| `developer/message` | `role=developer`（同上） |
| 其他（turn/step/request/title/attempt/compaction/goal 等） | 不进消息，只推进水位 |

- `seq` = 事件 `seq`；`timestamp` = 事件 `time`
- 工具结果与调用按 `callId` 配对；没有对应 assistant 行的孤立 `tool/result` 单独成行（`role=tool`）
- 一期不使用 `reset`（DSH 日志只追加）；检测到同一 session id 的 `format_version` 变化时跳过并告警

## 6. 触发与缓冲

- 事件驱动：`session/event` 入队；每会话 **`debounceMs`（默认 5000）** 无新事件后触发一轮
- 触发阈值：pending `≥ maxBatchMessages（默认 200）` 或 `≥ maxBatchBytes（默认 2 MiB）` 立即触发
- 分片：按条数切，超字节再切（对齐 hub 端 200 条 / 2 MiB 约定）
- 顺序：同会话串行；跨会话并发上限 2；不阻塞聊天与模型请求
- 失败重试：指数退避 `1s → 60s`，队列保留；`401/404` 停止重试并标记"凭据或接口失效"
- 水位：`uploadedThroughSeq` 只有 HTTP 2xx 后前移；落库为会话日志事件 `session-sync-hub/delivery-accepted`（与会话日志上传同款做法，重启后从日志 fold 恢复）
- 收尾：平时 `finalBatch=false`；`session/disposed`、归档、或菜单「立即同步」时发 `finalBatch=true` + `messageTotal`
- 重启：从日志 fold 出水位继续；水位缺失时从 0 重推（hub 幂等，代价是流量）
- 列表页消息数：hub 只在末批冻结 `message_count`，因此会话进行中列表显示 0，详情页的 `messageTotal` 按实际行数统计；一期接受该差异，不额外发假末批

## 7. 开关与状态

| 层级 | 存储 | 默认 |
|---|---|---|
| 全局 | Host 配置 `enabled`（设置页 `settings.general.item` 一行） | **开** |
| 单会话 | 会话日志事件 `session-sync-hub/setting`（`{enabled: boolean}`，后写覆盖） | 跟随全局 |

优先级：全局关 → 全不同步；全局开 + 单会话关 → 该会话跳过。会话事件与水位同源存放，重启/回放/Fork 后状态一致。

## 8. 菜单入口

- slot：`conversation.session.header.actions`（`ui-jobs` 的 `JobListAction` 是同款范例），`order` 取 30 避开已有项
- 内容：勾选项「同步到服务器」+ 状态行（`已同步至第 N 条` / `等待上传 M 条` / `失败原因` / 未配置密钥）
- 交互：勾选立即写会话事件并唤醒队列；「立即同步」触发一次带 `finalBatch` 的收尾
- 文案走 locale 键（zh/en/ja/es/fr/de/ru/pt 八语）

## 9. 凭据与配置

```yaml
# cordis.patch.yml（fork）
- id: session-sync-hub
  name: '@deepseek-ai/dsh-session-sync-hub'
  config:
    endpoint: 'https://hub.puresnake.com'
    enabled: true
    uploadReasoning: true
    uploadSystemMessages: true
    toolResultCap: 8000
    debounceMs: 5000
    maxBatchMessages: 200
    maxBatchBytes: 2097152
```

- API key：`cordis.patch.yml` 用 `!!js` 读 `process.env.PUREHUB_SESSION_SYNC_KEY`，不落仓库、不落明文配置、不进日志
- 缺失 key：插件不启用；设置页与会话菜单显示「未配置密钥」
- 服务端需 `sys_api_key` 一条具备 `/api/session-trace/**` 权限的 key（`apikey.auth.paths` 已含该前缀）

## 10. 错误处理与可观测性

- 同步失败不打断会话：仅日志 + 菜单状态 + 设置页提示
- 日志字段：session 短 id、批次条数/字节、HTTP 状态、重试次数；不记录正文与 key
- `401/404`、配置缺失、`format_version` 变化 → 进入"停止同步"状态并在菜单显示原因
- `finalBatch` 失败不回退已同步数据；查看页按既有「上传未完成」语义展示

## 11. 测试

| 层 | 用例 |
|---|---|
| Host 映射 | 每类事件 → 行；reasoning 开关两种；工具结果截断；system/developer 开关；孤立 `tool/result` |
| Host 缓冲 | 去抖触发、阈值触发、同会话串行、并发上限、重试退避、401 停止 |
| Host 水位 | `delivery-accepted` fold、重启恢复、缺失时从 0 重推 |
| hub 写端 | runtime 白名单 `dsh`、`session_trace_meta` upsert、幂等重推、`finalBatch` 冻结 |
| API/Client | 单会话开关写读、状态行渲染、全局开关默认开、八语文案、i18n 门禁 |
| 端到端 | 本地 fake hub 校验分片/顺序/重推/截断；不依赖真实 hub |

## 12. 实施顺序

1. hub 三件小事：`RUNTIMES += dsh`、查看页筛选项、`session_trace_meta` DDL + upsert（含迁移与参考 SQL）
2. Host 包：采集/映射/缓冲/水位 + 单测（fake hub 端到端）
3. API 控制器 + 会话事件开关
4. Client 包：设置行 + 会话头菜单 + 八语 locale
5. 打包/配置示例/README + 本地联调（真实 hub 一次）

## 13. 风险与未决

| 项 | 说明 |
|---|---|
| `pure-app` 请求体上限 | 未实测，若默认 1 MiB 需下调 `maxBatchBytes`；实施第一步即验 |
| 生产 `apikey.auth.paths` | 需确认服务器外部 `app.yml` 已含 `/api/session-trace/**`（缺失则接口裸奔） |
| 水位事件量 | 每批一条 `delivery-accepted` 事件，会轻微增长会话日志；如不可接受改为每 N 批记一次 |
| 历史会话 | 一期不回填；查看页只看到启用后开始的会话 |
| 隐私 | 正文/思考/工具参数默认上传，需在设置页明示；不采集环境变量与文件内容以外的系统信息 |
