# 计划：登录态鉴权的自有插件市场（默认启用）

## Goal

PureHub Desktop 开箱内置自有插件市场：出厂预置索引源 `https://hub.puresnake.com/market/index.json`，浏览与安装都对 `hub.puresnake.com` origin 附账号 Bearer token（`deepseekAccount.resolveToken` 现取），未登录时市场显示「需要登录」而不发未鉴权请求。

## 设计基线（已获批准，2026-10-22）

- 默认启用（不要求登录事件触发）；索引源与安装都需登录鉴权；
- 方案 A：复用内置 `plugin-market` / `plugin-manager`，不新造市场实现；
- 开放小决策的批准答案：未登录 fail-fast 报 `sign-in-required`；token 仅对账号 origin 附加；登录态切换后刷新索引。

## 一处机制细化（相对批准稿）

批准稿写「出厂 profile 模板默认开启 plugin-market-bundle」。实现映射发现 `PROFILE_TEMPLATES` 只对**首次初始化**的 profile 生效，存量安装（含开发机）永远拿不到。**改为**：在 fork 的 `packages/bundle/base/cordis.patch.yml` 直接挂载 `plugin-market` 行、`packages/bundle/web-app/cordis.patch.yml` 挂载 `ui-plugin-market` 行，并从 `OPTIONAL_BUNDLES` 移除 `plugin-market-bundle`（避免与插件页开关双重挂载）。效果：所有存量与新建 profile 下次启动即生效，零迁移。代价：用户无法在插件页关闭市场（作为内置能力接受）。

## Baseline / Authority Refs

- 市场服务：`packages/boot/plugin-market`（fetch 于 `src/index.ts` `fetchIndex`，行 264-284）
- 安装管理器：`packages/boot/plugin-manager`（pnpm 拉起于 `src/operations.ts` 行 358 `execa`）
- 账号 token：`packages/credentials/deepseek-account/src/index.ts` `resolveToken(url): Promise<string | undefined>`（oidc 实现：origin 必须等于 `inferenceOrigin`，未登录/越源/mock 均返回 undefined）
- profile 模板：`packages/boot/app-boot/src/profile.ts`（`PROFILE_TEMPLATES.web` 行 183-185、`OPTIONAL_BUNDLES` 行 223-236）
- 桌面 profile 创建：`apps/desktop/src/project-manager.ts`（`WEB_PROFILE` 行 32）
- 格式契约：`packages/util/plugin-market-index`（索引格式 1 校验器）

## Tech Stack

TypeScript ESM / Cordis 插件 / zod(schemastery) Config / vitest（含 REAL-composition 规格）/ pnpm 子进程。

## Change Necessity

配置无法表达「fetch 带账号 token」与「pnpm 子进程按 host 注入鉴权」——市场服务与安装管理器均无任何鉴权钩子，必须改代码。最小代码边界：plugin-market 的 fetchIndex 头部构造、plugin-manager 的 pnpm 环境组装、base/web-app 组合补丁、app-boot 的可选 bundle 清单。

## TDD Route

- mode: auto → decision: **strict**（理由：行为变更 + 凭据/权限边界 + 生产者-消费者链路）
- RED：先写失败测试（鉴权头断言、未登录 fail-fast、pnpm env 注入、组合挂载），确认红；
- GREEN：最小实现使其转绿；REFACTOR：保持边界整洁。

## Compatibility Boundary

- `pluginMarket` / `pluginManager` 的服务契约不变（新增 Config 字段均有默认值，不挂载账号服务时行为与上游一致：不发 token、不做 fail-fast）；
- 第三方索引源行为完全不变（非 `authenticatedOrigins` 的源不附 token）；
- token 不落盘、不进 settings、不进 install-log（只存在于 pnpm 子进程环境）；
- `OPTIONAL_BUNDLES` 移除 `plugin-market-bundle` 后，`apps/web/tests/plugin-*.e2e.ts` 的数量断言来自常量本身，自动跟随。

## Tasks

### Task 1 — plugin-market：索引拉取鉴权化

**文件**：`packages/boot/plugin-market/src/index.ts`、`packages/boot/plugin-market/src/index-url.ts`（如需 origin 工具）、`packages/boot/plugin-market/tests/`（现有规格扩展）、README.md/README.zh.md/README.i18n.yaml。

**RED**（新规格）：
1. 挂载 stub `deepseekAccount`（`resolveToken` 对 hub origin 返回 `tok-1`），索引 URL 在 `authenticatedOrigins` 内 → 本地 HTTP 服务器断言收到 `Authorization: Bearer tok-1`；
2. 索引 URL 不在 `authenticatedOrigins` → 请求无 Authorization 头；
3. 未登录（resolveToken → undefined）+ 鉴权源 → 不发请求，`listIndexes` 报 `plugin-market/sign-in-required`；非鉴权源未登录 → 正常裸请求；
4. 未挂载 deepseekAccount → 与上游行为一致（裸请求，无 fail-fast）。

**GREEN**：`Config` 增加 `authenticatedOrigins: z.array(z.string()).default([]).volatile()`；`fetchIndex` 前：URL origin ∈ authenticatedOrigins 时 `ctx.get('deepseekAccount')?.resolveToken(url)`，得 token → 附 `Authorization: Bearer`；得 undefined（未登录或吊销）→ 抛 `RemoteError('plugin-market/sign-in-required', ...)` 不发请求；无账号服务或 origin 不在集合 → 原路径不动。`deepseekAccount` 用 `ctx.get`（可选服务规则），不进 `static inject`。

**兼容性**：上游默认 `authenticatedOrigins: []` 时逐字节等价现状。

### Task 2 — plugin-manager：pnpm 子进程按 host 注入鉴权

**文件**：`packages/boot/plugin-manager/src/index.ts`（Config + 调用点）、`src/operations.ts`（pnpm execa 环境组装）、`src/install-spec.ts`（取 spec 的 host 的既有工具）、`tests/` 扩展、README 双语。

**RED**：
1. 本地 HTTP 服务器扮演私有 registry/tarball host 且要求 Bearer；`installBundle` 目标 host ∈ `authenticatedOrigins` 且 resolveToken 有值 → pnpm 子进程环境带 `npm_config_//<host>/:_authToken=<token>`，安装成功；未注入则服务器 401、安装失败（对照）；
2. 目标 host 不在集合 → 子进程环境无该变量；
3. 未登录 → 以 `plugin-manager/sign-in-required` 在 pnpm 启动前拒绝（不动 profile 文件）；
4. install-log 流不含 token 值（断言输出无 token 串）。

**GREEN**：`Config` 增加 `authenticatedOrigins`；安装/查询路径在拉起 pnpm 前收集目标 host（registry 选项、spec 的 tarball/git host——git host 不注入，走 SSH/凭据助手既有路径），对鉴权集合内的 host 解析 token 并拼入子进程 env；未登录且需要鉴权 → 启动前拒绝；token 只存在于子进程 env，不写 `.npmrc`/`pnpm-workspace.yaml`。

**注意**：实现时先实证 pnpm v11 对 `npm_config_//host/:_authToken` 的 registry 与 tarball 下载均生效（RED 的第 1 条即该实证）；若 tarball host 不生效，回退方案 = 该形态先下载到临时文件再 `pnpm add file:`（不改变本任务接口）。

### Task 3 — 组合：出厂挂载市场（fork patch）

**文件**：`packages/bundle/base/cordis.patch.yml`（插入 `plugin-market` 行：`disabled: !!js "!ctx.get('profileContext')"`，`config: { indexes: ['https://hub.puresnake.com/market/index.json'], authenticatedOrigins: ['https://hub.puresnake.com'] }`；`plugin-manager` 行补 `authenticatedOrigins` 同值）、`packages/bundle/web-app/cordis.patch.yml`（插入 `ui-plugin-market` 行）、`packages/boot/app-boot/src/profile.ts`（`OPTIONAL_BUNDLES` 移除 plugin-market-bundle）、`packages/experimental/plugin-market-bundle/README.md` 双语（「默认禁用」改为「本 fork 出厂内置」陈述）+ i18n 重录。

**RED**：base/web-app 组合规格（REAL-composition 或既有 base.spec.ts 扩展）：web profile 启动后 `pluginMarket` 已挂载且 `listIndexes()` 含出厂 URL；插件页插件清单不再把 plugin-market-bundle 列为可开关项。

**GREEN**：按上改；随后 `pnpm run gen-doc-graphs`、`gen-config-catalog`、`gen-cordis-catalog` 等受影响生成目录重建。

### Task 4 — 验证与交付

- 聚焦规格：plugin-market / plugin-manager / app-boot / base / web-app 相关测试文件；
- `pnpm run build:artifacts && pnpm run build:check`；
- `pnpm run test:docs`（README 改动 + 生成目录）；
- 桌面打包冒烟：`pnpm run package:desktop:win:x64:unsigned`，新装 profile 首次启动看到「发现」页与出厂索引源（用户可视接缝的最终交付证据）；
- 提交拆分：Task 1/2/3 各自一个提交 + 生成目录/文档一个提交；推送 origin。

## Verification

按 Tasks 内命令；验收判据沿用批准稿（出厂可见、登录可浏览/安装、未登录显示需要登录、吊销后失败提示）。registry 与 tarball 两种安装形态各验一次。

## Risks

- pnpm env 鉴权对 tarball 形态不生效 → Task 2 内有回退方案；
- 上游下次合并触及 plugin-market/plugin-manager 同一区域 → 冲突面已知且小，合并时人工复核；
- 未登录→登录后索引不自动刷新（MVP 靠发现页「重试」；后续可在 fork 补 signed-in 事件自动 refresh）。

## Retirement

无旧路径退役。`plugin-market-bundle` 包保留发布（不再被模板/开关引用）；若未来确认无人引用，再单独走退役评估。
