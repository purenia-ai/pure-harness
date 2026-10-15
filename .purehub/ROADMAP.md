# PureHub Desktop 功能规划

本文件是 PureHub Desktop（`pure-harness`）的功能路线图，与 [`VERSIONS.md`](VERSIONS.md)（版本台账）配套。
范围：插件体系、移动端远程、Pure 网页端、飞书 IM 连接器，以及为实现它们必须补齐的宿主能力。

上游基线：`1683aa56d3`（origin/master，2026-10-15）。本仓是 DeepSeek Harness 的修改版，品牌与业务能力层不得侵入上游代码路径；
所有新能力按仓库既定约定以**插件**形式提供（[AGENTS.md](../../AGENTS.md)："Plugins, not loop changes"）。

---

## 0. 现状盘点（规划的事实依据）

### 0.1 已经具备的基础设施

| 能力 | 载体 | 现状 |
|---|---|---|
| 插件装载 | `@deepseek-ai/dsh-app-boot`（bundle/patch 分层）、`@deepseek-ai/dsh-plugin-manager` | 成熟：profile → bundle → `cordis.patch.yml` 多层合并；每行可 `disabled` |
| 插件页 UI | `@deepseek-ai/dsh-client-ui-plugin-manager` | 成熟：侧栏 **Plugins** 页，装/卸/启停 bundle、看安装日志、详情页 |
| 官方可选 bundle 目录 | `OPTIONAL_BUNDLES`（`packages/boot/app-boot/src/profile.ts:223`）+ `officialBundleInstallTarget()` | 成熟：离线可见、按需安装，源安装走 `link:<workspace 包目录>`，发布安装走 `name@<运行版本>` |
| 客户端 UI 槽位 | `packages/client/ui-slots` + 生成的 `slot-catalog.ts` | 成熟：`ctx.slots.inject(key, …)`，槽位目录可由 `cordis_inspect what:"client"` 读给模型 |
| 斜杠命令 | `@deepseek-ai/dsh-client-ui-commands`（`ctx.commandUi`）+ Host `ctx.commands` | 成熟：`/xuanpin` 这类命令卡片即插件面板 |
| 工具注册 | `@deepseek-ai/dsh-tools`（`ctx.tools.register`） | 成熟：schema 自动进系统提示词 |
| Host HTTP 路由 | `@deepseek-ai/dsh-host-webserver`（`ctx.webServer`、`collectIndexInjections()`） | 成熟：插件可挂同源代理路由，浏览器零跨域 |
| 会话与提示词入口 | `ctx.sessions`（`SessionStore`）、`ctx.agents`（`AgentRegistry`）、`AgentRuntime.send(message, target, wakeup)` | 成熟：Host 侧可直接建会话、投递用户消息 |
| 远程访问授权 | `@deepseek-ai/dsh-api-remote-access`（principal / role / binding / `decide` / `allows` / 快照流） | **骨架已成，无业务方**：全仓 `grep registerPolicy` 只在 API 定义处出现，**没有任何插件注册过策略** |
| Client↔Host 传输 | `@deepseek-ai/dsh-api-gateway`（`/api/remote.mux` WebSocket、双向流、Peer 绑定） | 成熟：每个调用显式带 Peer，非 owner 调用走 RBAC |
| 对外部署 | `dsh --profile web --public-url … --trusted-host … --tls-cert/--tls-key` | 成熟：见 [`docs/user/guide/public-deployments.md`](../../docs/user/guide/public-deployments.md) |
| MCP | `@deepseek-ai/dsh-mcp-client`（stdio / Streamable HTTP）、`@deepseek-ai/dsh-mcp-resources` | 能用，但**只能写 `cordis.yml`**；无 UI、无运行时增删、无连接测试 |
| 凭据 | `@deepseek-ai/dsh-credentials`（`readRecord('oidc-account/default')`） | 成熟：插件复用登录用户 OIDC token，自动刷新 |

### 0.2 已经存在的业务插件（**不在本仓**，在 `~/Desktop/dsh-plugins`）

这是规划的关键输入：Pure 业务插件已经按一套自洽的模式落地了，路线图应当延续而不是重建这套模式。

```
~/Desktop/dsh-plugins/            pnpm workspace（packages/* 与 ozon-*）
├── packages/shared/              @purehub/dsh-shared，导出 hub-client / proxy-routes / sse-feed / shop-context
├── ozon-selection/               @purehub/dsh-ozon-selection  0.1.0  /xuanpin
├── ozon-review/                  @purehub/dsh-ozon-review     ——     /shenhe
└── ozon-listing/                 只有 README（未实现）
```

已确立的插件模式（**新插件一律照此实现**）：

- **一个包 = Host 半 + Client 半 + bundle 补丁**：`lib/index.js`（`main`）、`lib/client.js`（`dsh.client`）、`cordis.patch.yml`（`dsh.bundle.patch` 指向它）。
- **零服务器改动、零新增凭据**：Host 半用 `ctx.credentials.readRecord('oidc-account/default')` 拿登录态 OIDC token，
  经 `ctx.webServer` 挂同源代理（`/ozon-selection/api/*`）转发 `https://hub.puresnake.com/api/crosslist/*`；浏览器零跨域。
- **聊天与面板双向同步**：工具写结果 → `GET /<plugin>/api/events`（SSE）→ 面板渲染；面板动作 → 同名上游接口。
- **UI 是预置 React 组件，不是 A2UI**：LLM 只调工具，渲染零 token。
- **面板有两条落点**：会话内命令卡片（`conversation.chat.commandview`）与右侧常驻 tab（`sidebar.right.pane.tab` + `sidebarRightTabs`），两者互斥/嵌回。
- **跨面板共享状态**：`@purehub/dsh-shared/shop-context`（`ozon-suite.activeShop`），跨标签页靠 `storage` 事件、同页靠模块内广播。

### 0.3 生图现状

- 桌面 profile 已装第三方插件 **`dsh-image-gen@0.9.0`**（作者 shanliuling，Apache-2.0，npm 公开发布），
  桌面 profile patch 覆盖 `provider: xai`（包内默认 `google`）。
- 它已提供：对话生图与编辑、无限画布、Studio 批量、多模型对比、Prompt 灵感库、图库、本地 ComfyUI、订阅免 Key；
  支持 Gemini / OpenAI / Seedream / DashScope / xAI / ComfyUI 等。
- **本仓无任何生图代码**，也没有 PureHub 网关侧的生图入口/额度。

### 0.4 飞书现状

- 本仓无任何飞书/IM 代码。
- 运行环境已装 `lark-cli 1.0.57`（`/usr/local/bin/lark-cli`），并具备完整技能面：
  `lark-event`（长连接事件流，NDJSON）、`lark-im`（收发消息、群管理、文件收发）、`lark-approval`（审批查询与处理）、`lark-doc` / `lark-sheets` / `lark-base` 等。
- 即：**IM 连接器缺的不是飞书能力，而是"飞书事件 ↔ DSH 会话"的桥**。

### 0.5 移动端现状

- 有完整的 Web UI 与远程部署能力，但**没有任何"手机"相关功能**：无配对流程、无二维码、无分享授权策略、无移动端布局专项。
- `--public-url` / `--trusted-host` 是为反向代理设计的；桌面版默认只服务环回地址（`apps/desktop/src/host-process.ts` 只放行 localhost/127.0.0.1/[::1]）。
- `api-remote-access` 生来是给"非 owner 观战者"用的（设计见 `.agents/notes/implemented/architecture/2026-10-12-peer-principal-and-remote-access.md`），
  但那个观战者（上游 liveshare）不在这棵树上，所以**授权策略需要我们自己注册**。

### 0.6 差距清单

| # | 缺口 | 影响的功能 |
|---|---|---|
| G1 | 没有面向 `@purehub/*` 的插件目录、权限门控、一键安装/更新 | 插件库 |
| G2 | 没有宿主侧生图能力与额度，生图完全依赖第三方插件与用户自备 Key | 生图插件 |
| G3 | `ozon-listing` 未实现；三个 Ozon 插件不在任何可分发渠道里 | Ozon 插件族 |
| G4 | MCP 服务器只能改 `cordis.yml`，不能在产品内管理 | MCP 连接器 |
| G5 | 没有"非本机第二个客户端"的产品化路径（配对/授权/撤销/审计） | 手机远程、飞书连接器 |
| G6 | 没有任何外部消息入口（IM 消息 → 会话） | 飞书 IM 连接器 |
| G7 | 会话内缺少用户自定义快捷动作 | 会话快捷功能 |

---

## 1. 总体设计原则

1. **延续既有插件模式**：Host 半 + Client 半 + bundle 补丁；复用登录态凭据；面板不走 A2UI。新插件不得引入新凭据体系。
2. **能力按 seam 拆分**：每个新能力落成 Service Definition / Provider / Consumer 三角（如"生图"= 生图服务定义 + PureHub 网关 provider + 对话工具 consumer）。
3. **业务插件在仓外**：`@purehub/*` 业务插件继续独立仓库、独立发布；本仓只承载**插件库宿主**（目录服务 + UI）与**平台级插件**（MCP 连接器、移动端、飞书连接器）。
   理由：业务插件迭代快、可含业务数据，与上游合并节奏解耦；本仓升级不阻塞业务。
4. **默认安全**：所有对外入口（手机、飞书）默认关闭，开启即显式授权、可撤销、有审计；凭据只存 `credentials` 服务。
5. **不改上游行为**：优先用现有扩展点（工具、命令、槽位、路由、bundle 行）。确需改宿主时，改动进 `VERSIONS.md` 的"必须核对"表。
6. **每项功能自带验收**：单元测试 + 快照（keyless recorded-session）+ 手工 UI 验收路径，写进任务而不是事后补。

---

## 2. 插件

### 2.1 Pure 团队插件库

**目标**：在桌面/网页的 **Plugins** 页里，用户看到 Pure 团队维护的插件目录，按账号权限一键安装、更新、卸载；
未授权项可见但不可装（对应官网"不开放自助安装"当前策略，后续可放开）。

**关键决策（需确认）**：分发渠道三选一或组合。

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A. 复用官方可选目录 | 把 `@purehub/*` 加进 `OPTIONAL_BUNDLES` | 几乎零成本，UI 现成 | 需随本仓发版；无法按账号授权；不适合快速迭代 |
| B. 私有 registry | 自建 npm 私有源（Verdaccio / hub 托管），插件按正常包安装 | 版本与 semver 自然、pnpm 原生 | 需要 registry 运维与凭据下发 |
| C. hub 目录 + 授权下发（**推荐**） | Hub 下发 JSON 目录（含包名/版本/摘要/权限标签/安装源），Host 侧服务校验授权后用 `ctx.pluginManager` 安装 | 权限门控、灰度、可运营；不暴露公共源 | 需要 hub 侧接口与签名 |

推荐 **C 为主、A 为兜底**（离线或未登录时仍能用内置的官方可选目录）。

**新增包**：

| 包 | 面 | 职责 |
|---|---|---|
| `@purehub/dsh-plugin-library` | Host | `pluginLibrary` 服务：拉取目录（带 `oidc-account/default`）、校验签名与授权、转换为 `pluginManager` 调用、维护安装状态与失败诊断 |
| `@purehub/dsh-client-ui-plugin-library` | Client | 占 `plugins.item` / `plugins.detail.badge` / `plugins.detail.section` / `plugins.detail.actions` / `plugins.add.actions`：目录分区、权限标签、版本与更新、安装进度、失败重试 |

**流程**：

```
Plugins 页打开
  → ui-plugin-manager 读本地 bundle 清单（现有）
  → plugin-library 拉 hub 目录（带 OIDC token；失败降级到内置目录 + 明确提示）
  → 按 permission 标签渲染：可装 / 需申请（跳反馈通道）/ 已装
  → 安装：officialBundleInstallTarget 同款解析（源安装用 link:，发布安装用 name@version）
      → ctx.pluginManager（pnpm）→ 写 profile bundle 列表 → 提示重启或 HMR 生效
  → 卸载/更新：复用现有 remove/update 语义（失败后包保持未安装，与上游一致）
```

**要点**：
- 安装是**外部生效动作**，必须在 UI 明确二次确认，并像 `ozon_selection_pick` 那样把"费用/影响"写进工具与 UI 文案。
- 目录缓存与离线降级必须写清契约：拉不到目录 ≠ 没有插件。
- 记录安装来源与版本，作为后续"上游合并后插件是否还兼容"的排查依据。

**验收**：未登录 → 目录降级且提示；已登录未授权 → 可见不可装且给申请入口；授权 → 装成功且出现在 profile bundles；
安装中/失败/取消三态可恢复；插件页刷新后面板状态一致。

### 2.2 生图插件

**现状**：第三方 `dsh-image-gen@0.9.0` 已覆盖绝大多数交互形态（画布、批量、图库、多 provider）。

**决策（需确认）**：

| 方案 | 说明 |
|---|---|
| A. 直接内置第三方插件 | 把它列为 Pure 插件库的"官方内置"项，默认开启；成本最低 |
| B. 内置 + PureHub 网关生图 | 在 A 之上加一条 `purehub-image` provider：走 hub 计费与额度，用户零 Key |
| C. 完全自研 | 只有在前两者都满足不了（如必须在插件内嵌业务素材、审核、商用授权链路）时才做 |

**推荐 B**：A 保底可用（BYOK 用户），B 给不想配 Key 的用户统一入口。

**工作项**（按 B）：
1. **seam 定义**：`imageGeneration` 服务（请求：prompt / 参考图 / 尺寸 / 质量 / provider；返回：附件引用 + 元数据），
   落 `attachment` 服务（二进制不落会话，符合仓库既有约定）。
2. **PureHub provider**：Host 侧读 OIDC token 调 hub 生图接口；额度不足/未开通返回结构化错误，UI 给明确引导。
3. **对话工具**：`image_generate` / `image_edit`，与 `dsh-image-gen` 的工具命名**不冲突**（不同前缀），并处理两者同时启用的情况。
4. **落地形态**：结果进 `conversation.chat.message.images` / `tool.call.images` / `conversation.trajectory.images` 槽位；
   右侧图库 tab 走 `sidebar.right.pane.tab`。
5. **额度**：在 `shell.quota-notice` 槽位复用现有额度提示面。

**开放问题**：与第三方插件同时安装时的行为（共存 / 互斥 / 择一启用），需要在插件库层给出明确规则。

**验收**：未登录/无额度 → 明确失败文案；生成成功 → 图片进会话与图库、可再次编辑；失败可重试且不产生"未知结果"的悬挂状态。

### 2.3 Ozon 插件族

**现状**：`ozon-selection`（`/xuanpin`）与 `ozon-review`（`/shenhe`）已实现且在桌面 profile 里以 `link:` 安装；
`ozon-listing`（`/shangjia`）**只有 README**。

**工作项**：
1. **补齐 `ozon-listing`**：把选品 → 审核 → 上架串成链路；按店铺隔离；与选品/审核共享 `shop-context`；
   批量整理商品信息、生成上架素材、按店铺推进；所有外部生效动作与真实费用前置确认。
2. **三个插件统一到插件库**：脱离 `link:` 手工安装，改为从插件库安装（见 2.1），并纳入版本管理。
3. **`@purehub/dsh-shared` 补齐**：目前只有 `hub-client` / `proxy-routes` / `sse-feed` / `shop-context`；
   建议补 `auth-guard`（未登录统一提示）、`error-map`（hub 错误码 → 中文可执行提示）、`tool-confirm`（外部生效动作的确认协议）。
4. **语义一致性（重要）**：审核工具的"预审 vs 终审"分离必须与现有工具契约一致——
   浏览/汇报类请求不得触发终审；终审只由用户当前消息明确下达。这一条要写进插件 README 与工具描述。
5. **可观测**：每次调用记录店铺、SKU、动作、结果、耗时，便于对账。

**验收**：三个插件在插件库中可装可更新；`/xuanpin`→`/shenhe`→`/shangjia` 全链路在一个会话里走通；
重复落审/重复上架幂等；未登录提示正确；费用动作二次确认。

### 2.4 其余候选插件（"不限于"部分）

按业务价值排序，作为插件库上线后的自然扩张：

- **报表 / 数据看板**：店铺维度销售与审核漏斗，复用 `sidebar.right.pane.tab`。
- **素材中心**：生图产物与商品图的统一素材库，与 2.2 图库共用存储。
- **跨平台刊登**：除 Ozon 外的其他平台适配（架构上把"平台"抽成插件内的 adapter）。
- **意见反馈直连**：插件内反馈入口直接建单（官网已有反馈通道）。
- **团队共享**：团队级技能/提示词/AGENTS.md 模板下发。

---

## 3. 移动端（手机远程）

**目标场景**：用户在手机上查看/接管桌面正在跑的会话——看进度、审批、补一句需求、收完成通知。
**不做**：把手机当成完整工作台（长任务编排仍在桌面）。

### 3.1 分阶段

**P0 — 配对与访问（可用）**
1. 桌面端新增"手机远程"开关：默认关；打开后启动对外监听（或经隧道），生成**一次性配对码 + 二维码**。
2. 手机扫码 → 带一次性 token 打开 Web UI（窄屏）→ 兑换为设备会话（沿用 Connection 的 launch token / 签名 cookie 机制，
   不新造认证体系）。
3. **响应式专项**：按 `dsh-responsive-ui` 技能排查会话列表、会话头部、输入区、工具卡片在窄屏下的截断/换行/触控，
   只做必要的布局适配（不改信息架构）。

**P1 — 授权与安全（安全可用）**
1. 新 principal kind `share-viewer{shareId, actor}`（与 `api-remote-access` 的 principal 模型对齐），
   并**注册第一个 `registerPolicy`**：只读会话列表/内容 + 允许投递用户消息 + 禁止一切外部生效动作。
2. 授权管理页：查看在线设备、权限范围、到期时间；一键撤销（撤销后该 principal 的所有 Peer 立即全部被拒）。
3. **来源留痕**：外部来源的消息必须能与会话日志一起重建（仓库约定"model-visible ⟺ logged"）。
   上游 liveshare 曾在 session-controller 里加过 `prompt/origin` + `api-session/external-admission` 的语义，
   **本树没有这段代码**——需要在本仓实现同等语义，或在会话日志里记录等价的来源事件。
4. 审计：谁在什么时候从哪台设备投递了什么。

**P2 — 移动体验（好用）**
1. PWA（可加到主屏、离线壳、通知）；是否做原生壳另议。
2. 推送：任务完成、需要审批、出错。
3. 移动端审批：把审批请求做成手机上的原生交互（复用 `ui-approval` 的能力，不新造审批语义）。

### 3.2 依赖与风险

| 项 | 说明 |
|---|---|
| 依赖 | `api-remote-access`（策略注册）、`api-gateway`（Peer/流）、`host/webserver`（监听与 TLS）、`client/connection`（信任与令牌） |
| 风险 R1 | **暴露面**：桌面开监听即引入攻击面。缓解：默认关、一次性码短时效、绑定网卡/隧道二选一、必须 TLS 或经隧道、撤销即时生效 |
| 风险 R2 | **令牌泄露**：URL 携带凭据。缓解：配对码一次性 + 短 TTL + 设备绑定 + 可撤销 |
| 风险 R3 | **越权**：非 owner Peer 的每个调用都必须过 `decide()`；列表/流用 `allows()` 过滤；事件按资源放行 |
| 风险 R4 | **串会话**：同一账号多设备时，会话归属与"谁在输入"必须显式记录（见 P1-3） |
| 风险 R5 | 上游合并冲突：`api-remote-access` 与 liveshare 语义若上游落地，需按 `VERSIONS.md` 流程对齐 |

**验收**：默认关闭状态下无任何新增监听；配对成功后手机可只读浏览并投递消息；外部生效动作在手机上被拒且有明确提示；
撤销后 1 秒内旧设备调用全部失败；审计可回放一条完整来源链路。

---

## 4. Pure 网页端

### 4.1 MCP 连接器

**现状**：`dsh-mcp-client` 每台服务器一个 `cordis.yml` 条目，改配置要重启；没有 UI、没有连接测试、没有运行时增删。

**目标**：在产品内管理 MCP 服务器——新增/编辑/启停/删除/连接测试/查看工具清单，凭据走 `credentials` 服务。

**设计**：
1. **新 seam**：`mcpServers` 服务（Host）持有服务器注册表，提供 `list/add/update/remove/test/status`；
   `dsh-mcp-client` 从"读 cordis 配置"改为"消费注册表"（保留 cordis 配置作为初始来源，二者合并、冲突以产品设置为准，
   且**显式步骤**完成合并，不做隐式 `??` 兜底）。
2. **持久化**：走非会话存储（`packages/storage`），不写 `cordis.yml`——避免与 bundle 层/上游合并互相踩。
3. **凭据**：token/密钥存 `credentials`，UI 只显示掩码（复用 `ui-secret-mask`）。
4. **UI 落点**：`settings.section`（或在 Plugins 页加一个 MCP 子页），列表 + 详情 + 测试结果 + 工具清单；
   若上游有 `settings.plugins.tab` 之类的面，优先复用现有页而不是新开页。
5. **模型可见性**：连接器启用后工具进入系统提示词；服务器离线/握手失败必须**可见地失败**，不得静默跳过。

**验收**：新增服务器后工具无需重启即可用；连接失败给出可执行错误（命令不存在 / 认证失败 / 超时）；
停用后工具从提示词消失；凭据在日志与 UI 中均不出现明文；与 `cordis.yml` 既有条目不产生重复工具。

### 4.2 会话快捷功能

**目标**：把"每次都要打一遍"的操作变成一次点击。

**内容（按优先级）**：

| 优先级 | 功能 | 落点 |
|---|---|---|
| P0 | 会话头部快捷动作：继续 / 重试 / 总结 / 导出 | `conversation.session.header.actions` |
| P0 | 输入区快捷动作：常用提示词收藏、一键插入 | `conversation.input.left` / `conversation.input.right` / `conversation.composer.dock` |
| P1 | 打开当前会话的文件/终端/预览快捷入口 | `conversation.session.header.utilities` |
| P1 | 快捷切换：模型 / 权限模式 / 工作区 | 复用既有选择器，做"最近使用" |
| P2 | 命令面板（全应用级动作检索） | `shell.overlay` + `client/shortcuts` |
| P2 | 跨设备同步的快捷动作与收藏 | 随账号同步（需明确同步范围与冲突策略） |

**约定**：
- 快捷键通过 `ctx.shortcuts` 注册，**跟随设备**（桌面/网页默认值不同），与既有键位冲突检查共存。
- 新动作优先复用已有命令与工具，不新增并行实现。
- 文案走 locale 字典（`verify-client-ui-i18n` 会拦硬编码）。

**验收**：每个快捷动作可键盘触发、有 tooltip、在窄屏不溢出；键位冲突被拒绝并有可读提示；自定义项刷新后保留。

---

## 5. 飞书 IM 连接器

**目标**：在飞书里 @机器人 即可驱动桌面上的会话——发需求、看进度、审批、收产物；群聊里多人可协作。

**为什么可行**：`lark-cli` 已具备长连接事件流（`lark-event`，NDJSON，含 IM 消息/表情/群变更、VC、审批等）与完整 IM 收发能力（`lark-im`）；
DSH 侧有 `ctx.sessions` / `ctx.agents` / `AgentRuntime.send` 可以程序化投递用户消息。缺的只是"桥"。

**架构**：

```
飞书（长连接事件订阅 / 或 webhook）
   │  事件：im.message.receive_v1 等
   ▼
@purehub/dsh-feishu-connector（Host 插件）
   ├─ FeishuChannel：lark-cli 事件流消费（NDJSON，断线重连、去重）
   ├─ SessionRouter：chat_id / thread ↔ DSH 会话 映射（持久化）
   ├─ Admission：身份 → principal（open_id ↔ share-viewer 同族的 principal 模型）
   ├─ AgentRuntime.send(message, target, wakeup)
   └─ FeishuRenderer：会话事件 → 飞书消息/卡片（进度、完成、错误、审批按钮）
```

**关键设计**：

1. **路由与生命周期**：一个飞书会话（单聊或群话题）↔ 一个 DSH 会话；首次消息创建会话（工作区可配置默认值），
   `/new` `/list` `/switch` 之类的文本指令管理映射；映射持久化，重启不丢。
2. **出向渲染**：turn 结束 → 汇总消息（文本 + 产物附件）；需要审批 → **交互卡片**（通过/拒绝按钮），
   回写复用 DSH 审批语义（不新造审批状态）；错误 → 结构化可读文案。
3. **身份与权限**：`open_id` 映射到 principal；群聊默认只读，需显式授权才能投递消息或执行外部生效动作；
   白名单（哪些群 / 哪些人）必须显式配置，默认拒绝。
4. **凭据**：飞书自建应用的 `app_id` / `app_secret` 存 `credentials`；开通引导走一次性授权链接。
5. **部署形态**：默认**长连接**（NAT 友好，桌面场景无需公网回调）；webhook 模式作为服务器部署的可选形态。
6. **投递语义**：飞书消息可能重复/乱序——按 `message_id` 去重；发送失败要可见地报错，不能"消息石沉大海"。
7. **与移动端共享**：principal 模型、授权管理页、审计、通知中心三处能力应共用，不要各写一套。

**验收**：私聊 @机器人 能起会话并收到回复；群里按白名单生效；超长输出分片或转附件；审批卡片按钮回写成功；
断线重连不丢消息不重复执行；未授权用户被拒且有明确提示；`app_secret` 不出现在日志与 UI。

**开放问题**：飞书自建应用需要企业侧权限审批（事件订阅、消息发送、群读取等）；这是外部依赖，需提前发起。

---

## 6. 交付路线图

以"每期都能独立上线并被验证"为原则；工期为粗略人周，随团队规模变化。

### P0 · 打通（约 4–6 人周）

| 项 | 范围 | 依赖 | 验收 |
|---|---|---|---|
| 插件库骨架 | 目录服务 + Plugins 页扩展 + 三个 Ozon 插件上架 | hub 目录接口（可先用静态 JSON） | 装/卸/更新/失败恢复全通 |
| Ozon 上架插件 | `/shangjia`，串起选品→审核→上架 | `@purehub/dsh-shared` 补齐 | 全链路走通，动作幂等 |
| MCP 连接器 | 注册表服务 + 管理 UI + 连接测试 | `storage` / `credentials` | 免重启生效，失败可见 |
| 会话快捷功能 | 头部动作 + 输入区常用提示词 | `client/shortcuts` | 键位/窄屏/i18n 验收 |

### P1 · 扩展（约 6–8 人周）

| 项 | 范围 | 依赖 | 验收 |
|---|---|---|---|
| 手机远程 P0/P1 | 配对二维码 + 窄屏适配 + `share-viewer` 策略 + 撤销 + 审计 | `api-remote-access` 首次注册策略；来源留痕 | 默认无监听；撤销即时；越权被拒 |
| 生图接入 | `purehub-image` provider + 工具 + 图库 + 额度 | hub 生图接口 | 无 Key 可用；额度不足有引导 |
| 插件库自助安装 | hub 授权下发 + 权限门控 | hub 授权接口 | 未授权可见不可装 |

### P2 · 平台化（约 8–12 人周）

| 项 | 范围 | 依赖 | 验收 |
|---|---|---|---|
| 飞书 IM 连接器 | 长连接桥 + 路由 + 卡片 + 审批回写 | 飞书应用权限审批 | 私聊/群聊/审批/重连全通 |
| 移动端 P2 | PWA + 推送 + 手机审批 | P1 | 通知可达，审批可闭环 |
| 更多业务插件 | 报表 / 素材中心 / 跨平台刊登 | 插件库 | 按插件库标准上架 |

---

## 7. 横切关注点

1. **上游同步**：每期结束后更新 `VERSIONS.md` 的"必须核对"清单；新增的宿主改动（如 `share-viewer` 策略、
   `prompt/origin` 语义）要写进该表，避免被上游静默回退。
2. **版本与发布**：业务插件独立版本号；本仓沿用"产品版本跟随上游 + 构建号走环境变量 + 发布号 `purehub-<上游>.<序号>`"三层体系。
3. **安全基线**：所有外部入口默认关闭；凭据只进 `credentials`；生效动作二次确认；越权调用必须**失败得可见**。
4. **计费与额度**：生图、选品落审、上架、IM 调用都可能产生真实费用——需要统一额度提示面与用量可见性。
5. **观测**：插件安装/授权/远程/IM 四条链路都要有可对账的日志；失败必须能定位到"哪一步、哪一个外部系统"。
6. **文档与品牌**：用户可见文案走 locale 字典；官网（`PUREHUB_DESKTOP_INTRO.html` / 插件库页面）与实现保持同步，
   尤其"插件库开放程度"的表述要与 2.1 的实际策略一致。
7. **测试**：每项功能都要有单元 + 快照 + 手工 UI 验收路径；外部依赖（hub、飞书、生图 provider）要有可注入的 fake，
   保证 CI 无 Key 也能跑。

---

## 8. 需要先行确认的决策

| # | 问题 | 备选 | 建议 |
|---|---|---|---|
| D1 | 插件分发渠道 | 官方可选目录 / 私有 registry / hub 目录下发 | hub 目录为主，官方目录兜底 |
| D2 | 生图路线 | 内置第三方 / 内置+hub 网关 / 自研 | 内置 + hub 网关 |
| D3 | 插件库开放程度 | 完全不开放 / 申请制 / 自助安装 | 申请制起步，权限模型预留自助 |
| D4 | 移动端形态 | 响应式 Web / PWA / 原生壳 | Web→PWA，原生壳视需求 |
| D5 | 飞书应用归属 | 自建应用（企业审批） / 已有应用复用 | 自建，提前启动权限审批 |
| D6 | 业务插件代码位置 | 独立仓库（现状） / 并入本仓 `packages/purehub/*` | 独立仓库 |
| D7 | 与第三方 `dsh-image-gen` 的关系 | 共存 / 互斥 / 择一启用 | 共存但明确工具命名与默认 provider 规则 |
