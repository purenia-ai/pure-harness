# PureHub 版本记录

PURESNAKE 维护的 DeepSeek Harness 分支（PureHub Desktop）的版本台账。

- **上游号**跟随 `package.json`（当前 `0.2.1-alpha.2`），品牌改动不动它，避免每次合并上游都冲突。
- **我方发布号**用 `purehub-<上游号>.<序号>`，发布时打 tag `purehub-v<上游号>.<序号>`。
- 上游基线：`d743267388`（upstream `release-0.2.1-alpha.2`，2026-10-09）。

## 版本

| 版本 | 日期 | 范围 | 改了什么 | 清单 | 修改人 |
|---|---|---|---|---|---|
| **purehub-0.2.1-alpha.2.3**<br>（当前） | 2026-10-14 | `94221a178e..06b5b4b3db`<br>2 提交 · 143 文件 | **品牌资产**：19 张设计师图 + 8 张引导插图同名替换；productName/协议名/桌面壳文案 → PureHub Desktop；onboarding 5 键文案；根 README + LICENSE 加 fork 非隶属声明；图标去灰底；badge skill 文案 → PureHub；思考 loading → 思考中；**hero 标语刻意保持 `探索未至之境`** | [清单](https://hub.puresnake.com/p/pom/brand-replacement-checklist.html?token=f436d9c826224830a8f45953b0b2c287) | fan（品牌应用）<br>fiona（设计资产） |
| purehub-0.2.1-alpha.2.2 | 2026-10-12 | `e884f37d11..94221a178e`<br>2 提交 · 24 文件 | **品牌接入**：新增 `ui-brand-pure` 包，占用 `sidebar.brand.mark` / `sidebar.brand.name` / `conversation.hero.brand.mark`；客户端构建标题 `DSH_CLIENT_TITLE` → PureHub | — | leazxl（实现）<br>张小龙（合并） |
| purehub-0.2.1-alpha.2.1 | 2026-10-09 ~ 10-11 | `d743267388..e884f37d11`<br>6 提交 · 47 文件 | **客户端定制**：DeepSeek 账号登录换成通用 OIDC SSO；接入 hub 模型目录并限制 `max_tokens`；Codex 模型的 OpenAI 协议路由；打包产物名 `pure-harness-*`；profile manifest 的 UTF-8 BOM 修复；登记 PureHub 公共 client id | — | leazxl |

### 未记账的改动（`.2.3` 之后，尚未形成发布）

打包**不会**自动更新本文件。以下改动已在 `feat/purehub-brand-replacement` 上，但还没有对应的发布行：

| 提交 | 内容 |
|---|---|
| `aa979a80c4` | appId → `com.purenia.purehub.desktop`；新增 `.purehub/package-desktop.sh` |
| `99b49aca28` | 合入 `origin/feedback-form-url` |
| `1f1c1e62d8` | 合入 `origin/master`（876 提交） |
| `51b45a33d9` | 合入 `origin/tray-icon-running-artwork` |
| `390bb34eeb` | 安装后的 CLI 改为从 bundle 读 `CFBundleExecutable` + 打包期断言 |

要形成发布，就按下面「发版」加一行、打 tag；否则打包出来的产物只有**构建号**可追溯，台账里查不到。

## 上游更新注意项

上游每次发版后，按此表逐条核对；**只加不删**（历史踩过的坑要留住）。

### 🔴 必须核对（被上游静默回退就出事故）

| 文件 | 看什么 |
|---|---|
| `packages/bundle/web-app/cordis.patch.yml` | 装配行仍是 `ui-brand-pure`（品牌是否还挂得上） |
| `packages/bundle/web-app/package.json` | 依赖仍是 `ui-brand-pure` |
| `scripts/client-build-environment.ts` | `DSH_CLIENT_TITLE` → `PureHub` |
| `apps/desktop/scripts/electron-builder-config.mjs` | `productName` / 协议名 → `PureHub Desktop` |
| `apps/desktop/src/locale.ts`、`main.ts` | 桌面壳产品名、About 面板 |
| `apps/desktop/tests/expected/**`（20+ 个） | 菜单 / 致命弹窗 / welcome 的产品名期望 |
| `packages/client/ui-chat/src/client/locale.ts` | `chat.deepDiving` → 思考中 / Thinking |
| `packages/client/ui-conversation/src/client/locales.ts` | `hero.headline`：**我们保持 `探索未至之境` / `Into the Unknown`**（刻意不改） |
| `packages/client/ui-settings-account/src/client/locales/onboarding.ts` + `locales.ts` | 引导页与账号面板的 5+2 条文案 → PureHub Desktop |
| 5 个 locale 文件（plugin-manager / settings-account×2 / models / documentpreview-office） | `DeepSeek Harness` → `PureHub Desktop` |
| `packages/experimental/skill-badge/**` | badge 文案 → `powered by PureHub`；**图片必须是我们那版**（设计师包会盖回 dsp 版） |
| `README.md` / `README.zh.md` / `README.i18n.yaml` | 标题 + fork 非隶属声明；改完必须重录 i18n hash |
| `LICENSE` | PURESNAKE 修改声明与上游 MIT 版权并存 |

### 🟡 冲突时保留我方

| 文件 | 处理 |
|---|---|
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | 保留双方的 occupant 行 |
| `scripts/product-package-policy.ts` | 保留 `ui-brand-official` 标 optional 那行 |
| `tsconfig.base.json` / `tsconfig.client.json` | 保留新增包的聚合引用 |
| `apps/desktop/resources/*`、`installer/assets/*`、`renderer/assets/*` | 上游若改动，直接用我们的图覆盖 |
| `packages/client/ui-chat/src/client/chat/running-whale@2x.png` | **必须非空**（设计师包给的是空图，见下） |
| `apps/web/public/favicon*.svg`、`website/public/*` | 一般上游不动 |

### 🟢 安全（上游不会碰）

- `packages/client/ui-brand-pure/**`（整个新包）
- 桌面 / Web / 文档站的静态图片资源

### ⚠️ 两个已知坑（别重复踩）

- **`running-whale@2x.png` 是空图**：设计师包 v1/v2 都给 0/784 alpha 的全透明图，而它被 `ChatView.module.css` 当 alpha 遮罩用 → 思考中的动画标记完全不可见。上游若把该文件换回有内容的版本反而是好事。
- **锁文件与快照不要手合**：`pnpm-lock.yaml` 冲突 → 任选一侧后 `pnpm install` 重新生成；`snapshots/web/**`、`tests/expected/**` 冲突 → `DSH_SNAPSHOT=refresh` 重录。

## 版本、构建、发布

三层分开，互相不污染：

| 层 | 值 | 谁定 | 出现在哪 |
|---|---|---|---|
| **产品版本** | `0.2.1-alpha.2` | `package.json`，**跟随上游不改** | 客户端构建记录 `DSH_CLIENT_VERSION` |
| **构建号** | `0.2.1-alpha.2.<UTC 日期>.<序号>` | 打包时传 `DSH_DESKTOP_BUILD_VERSION` | `Info.plist`、产物文件名、更新 feed、**「关于」面板** |
| **发布号** | `purehub-0.2.1-alpha.2.N` | git tag + 本文件 | 台账 |

**产品版本不动**的理由：上游每次发版都会改 `package.json` 的版本，我们跟着改就每次合并都冲突。构建号走环境变量，进得了产物、进不了清单。

```sh
# 打包：构建号自动算，commit 自动从 git 读并写进产物
./.purehub/package-desktop.sh package:mac:arm64:unsigned
./.purehub/package-desktop.sh package:win:x64:unsigned
./.purehub/package-desktop.sh --print                     # 只打印将使用的构建号
PUREHUB_BUILD_SEQ=2 ./.purehub/package-desktop.sh ...     # 手动指定当日序号
```

- 序号取 UTC `HHMM` 并去掉前导零（semver 不接受 `0602` 这类带前导零的数字标识符）；脚本内置校验，非法值在打包前就报错。
- **commit 不需要传**：`apps/desktop/scripts/package-target.ts` 打包时自己读 `git rev-parse HEAD` 与工作区脏标记，写进产物元数据 `dshBuildCommit` / `dshBuildDirty`。
- 构建号必须**扩展**产品版本且**不能带 `+build` 元数据**（electron-updater 用 semver 比大小，元数据不参与优先级会撞车）。

**appId**：`com.purenia.purehub.desktop`（2026-10-15 从 `com.deepseek.harness` 改）。改前 PureHub 版与上游版 bundle id 相同，在 macOS LaunchServices 里会被当成同一个应用，Dock/更新/通知都可能互相串。

## 发版

```sh
# 1. 合上游（冲突按上表处理）
git fetch origin && git merge origin/master

# 2. 本文件顶部表格加一行（版本 / 日期 / 范围 / 改了什么 / 清单 / 修改人）

# 3. 打 tag 并推送
git tag purehub-v<上游号>.<序号> -m "upstream=<上游提交> brand=<本版提交> checklist=<URL>"
git push origin HEAD && git push origin --tags
```

**清单 HTML 的版本关联**：发布页名要带版本（`brand-replacement-checklist-v<版本>.html`）。当前所有版本共用同名页面，**发新版会把旧版清单覆盖掉**；如需历史留存，把当版 HTML 作为 release 附件再存一份。

## 分支同步记录

| 日期 | 动作 | 结果 |
|---|---|---|
| 2026-10-15 | 合入 `origin/master`（**领先 876 个提交**） | 冲突 4 个（`apps/desktop/README{,.zh,.i18n}.yaml`、`prepare-windows-ci.mjs`）；**13 项品牌面逐条核对全部存活**；锁文件随上游更新，`pnpm install` 后一致 |
| 2026-10-15 | 合入 `origin/tray-icon-running-artwork`（ZYY） | `running-whale@2x.png` **自动取其 PureHub 星标**；`tray-windows.ico` 冲突 → 取其深色板版 |
| 2026-10-15 | 合入 `origin/feedback-form-url`（ZYY） | 干净；带回 5 个 locale 文件的品牌词改名 |

> 上游基线由 `d743267388` 更新为 `origin/master` 的 `1683aa56d3`。

## 待办

- **`running-whale@2x.png` 已修**：ZYY 的 `tray-icon-running-artwork` 给了 PureHub 星标（136/784 alpha），不再是空图；master 也修过同一问题（还原成原始鲸鱼 APNG）。两版都进过冲突，最终取 ZYY 的品牌正确版本。
- ⚠️ **tray 图标与生成器不一致**：`apps/desktop/resources/tray-windows.ico` 由 `pnpm run render:tray-icon` 从 `resources/icon-windows.svg` 生成，而**生成器精确重现的是设计师版（浅色板 #F7F8FA + 黑标）**，不是 ZYY 的深色板版。**下次跑生成器会覆盖 ZYY 的改动**。要么同步改源 SVG，要么明确该文件不走生成器。
- **appId 已改、构建号脚本已加**（2026-10-15）：`com.deepseek.harness` → `com.purenia.purehub.desktop`；新增 `.purehub/package-desktop.sh`。appId 文案随 master 的重构迁到了 `apps/desktop/packaging/README.md`（原 `apps/desktop/README.md` 那段已被上游拆走）。
- 清单页面名尚未带版本号，历史清单会被覆盖。
- **文档站源链接与测试不一致（2 个测试红，既有问题）**：`scripts/project-doc-site.ts` 的 `REPOSITORY_URL` 指向上游 GitHub，而 `scripts/project-doc-site.spec.ts` 期望本仓 `git.rongdetu.cn/snake/pure-harness`。要么改实现（需先确认本仓对外可达），要么把测试改回上游。