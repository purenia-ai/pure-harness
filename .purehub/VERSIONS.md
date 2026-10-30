# PureHub 版本记录

PURESNAKE 维护的 DeepSeek Harness 分支（PureHub Desktop）的版本台账。

- **上游号**跟随 `package.json`（当前 `0.2.1-alpha.3`），品牌改动不动它，避免每次合并上游都冲突。
- **我方发布号**用 `purehub-<上游号>.<序号>`，发布时打 tag `purehub-v<上游号>.<序号>`。
- 上游基线：`1683aa56d3`（origin/master，2026-10-15）。分叉点是 `d743267388`（upstream `release-0.2.1-alpha.2`，2026-10-09）。

## 版本

| 版本 | 日期 | 范围 | 改了什么 | 清单 | 修改人 |
|---|---|---|---|---|---|
| **purehub-0.2.1-alpha.3.1**<br>（当前） | 2026-10-15 | 构建提交 `61b1b0f022` | **首个 mac 包发布**：合并上游 `origin/master` **876 个提交**；appId → `com.purenia.purehub.desktop`；安装后的 CLI 改从 bundle 读 `CFBundleExecutable`（修 `dsh plugin …` 报 "No such file or directory"）+ 打包期断言；产物名补齐 `pure-harness-*`；构建号改用 `--build-version`；running-status / tray 素材取自 ZYY 分支 | 内部清单（不外链） | fan（品牌/打包）· fiona（设计资产）· leazxl / 张小龙 / ZYY（上游同步与素材） |
| **purehub-0.2.1-alpha.2.3** | 2026-10-14 | `94221a178e..06b5b4b3db`<br>2 提交 · 143 文件 | **品牌资产**：19 张设计师图 + 8 张引导插图同名替换；productName/协议名/桌面壳文案 → PureHub Desktop；onboarding 5 键文案；根 README + LICENSE 加 fork 非隶属声明；图标去灰底；badge skill 文案 → PureHub；思考 loading → 思考中；**hero 标语刻意保持 `探索未至之境`** | 内部清单（不外链） | fan（品牌应用）<br>fiona（设计资产） |
| purehub-0.2.1-alpha.2.2 | 2026-10-12 | `e884f37d11..94221a178e`<br>2 提交 · 24 文件 | **品牌接入**：新增 `ui-brand-pure` 包，占用 `sidebar.brand.mark` / `sidebar.brand.name` / `conversation.hero.brand.mark`；客户端构建标题 `DSH_CLIENT_TITLE` → PureHub | — | leazxl（实现）<br>张小龙（合并） |
| purehub-0.2.1-alpha.2.1 | 2026-10-09 ~ 10-11 | `d743267388..e884f37d11`<br>6 提交 · 47 文件 | **客户端定制**：DeepSeek 账号登录换成通用 OIDC SSO；接入 hub 模型目录并限制 `max_tokens`；Codex 模型的 OpenAI 协议路由；打包产物名 `pure-harness-*`；profile manifest 的 UTF-8 BOM 修复；登记 PureHub 公共 client id | — | leazxl |

**`.alpha.3.1` 的构建**（未签名）：

| 构建号 | 产物 | commit |
|---|---|---|
| `0.2.1-alpha.3.20261015.854` | `pure-harness-0.2.1-alpha.3.20261015.854-mac-arm64-unsigned.dmg`（253M） | `61b1b0f022`（产物内 `dshBuildCommit` 一致；`dshBuildDirty=true`，打包时工作区有未跟踪文件） |

tag：`purehub-v0.2.1-alpha.3.1`（指向构建提交 `61b1b0f022`）。

### 未记账的改动（`.2.3` 之后）

`.2.3` 与 `.alpha.3.1` 之间的全部内容已记入上面的发布行。**此后的改动**打包不会自动更新本文件，需要人工加行：

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
| `packages/bundle/base/cordis.patch.yml` | `llm-pi-ai` 行保持挂载且不 `disabled` —— 它是「自定义模型 API」表单写入的 settings namespace，缺了设置 → 模型的手动添加入口就消失；fork 的 hub 模型（`llm-pi-ai-account`、`llm-deepseek-account-purehub`）只能追加，不能替换掉手动入口 |
| `packages/bundle/web-app/cordis.patch.yml` | `ui-settings-models` 行保持挂载 —— 设置 → 模型页本身；缺了整页不可用 |

### 🟡 冲突时保留我方

| 文件 | 处理 |
|---|---|
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | 保留双方的 occupant 行 |
| `scripts/product-package-policy.ts` | 保留 `ui-brand-official` 标 optional 那行 |
| `tsconfig.base.json` / `tsconfig.client.json` | 保留新增包的聚合引用 |
| `apps/desktop/resources/*`、`installer/assets/*`、`renderer/assets/*` | 上游若改动，直接用我们的图覆盖 |
| `packages/client/ui-chat/src/client/chat/running-whale@2x.png` | **必须非空**（设计师包曾给空图，2026-10-15 已换成 PureHub 星标） |
| `apps/web/public/favicon*.svg`、`website/public/*` | 一般上游不动 |

### 🟢 安全（上游不会碰）

- `packages/client/ui-brand-pure/**`（整个新包）
- 桌面 / Web / 文档站的静态图片资源

### ⚠️ 两个已知坑（别重复踩）

- **`running-whale@2x.png` 曾被换成空图**（设计师包 v1/v2 都给 0/784 alpha 的全透明图），而它被 `ChatView.module.css` 当 alpha 遮罩用 → 思考中的动画标记完全不可见。2026-10-15 已由 `tray-icon-running-artwork` 换成 PureHub 星标（136/784）。**合任何图片包后都要检查这张非空。**
- **锁文件与快照不要手合**：`pnpm-lock.yaml` 冲突 → 任选一侧后 `pnpm install` 重新生成；`snapshots/web/**`、`tests/expected/**` 冲突 → `DSH_SNAPSHOT=refresh` 重录。

## 版本、构建、发布

三层分开，互相不污染：

| 层 | 值 | 谁定 | 出现在哪 |
|---|---|---|---|
| **产品版本** | `0.2.1-alpha.3` | `package.json`，**跟随上游不改** | 客户端构建记录 `DSH_CLIENT_VERSION`；**应用内「设置 → 通用 → 当前版本」与侧栏底部** |
| **构建号** | `0.2.1-alpha.3.<UTC 日期>.<序号>` | 打包命令行 `--build-version` | `Info.plist`、产物文件名、更新 feed、**「关于」面板（Finder 显示）** |
| **发布号** | `purehub-0.2.1-alpha.3.N` | git tag + 本文件 | 台账 |

**产品版本不动**的理由：上游每次发版都会改 `package.json` 的版本，我们跟着改就每次合并都冲突。构建号走 `--build-version`，只进产物、不进清单。

⚠️ **应用内的版本与系统层不一致**：客户端构建在 electron-builder 之前完成，`DSH_CLIENT_VERSION` 嵌的是产品版本，所以应用内只显示 `0.2.1-alpha.3`，看不到构建号；Finder / 关于面板显示的是 `0.2.1-alpha.3.<构建号>`。要让里外一致，需在 `package-target.ts` 调 `build:official` 之前把构建号注入 `DSH_CLIENT_VERSION`。

```sh
# 打包：脚本算好构建号，用 --build-version 传给打包入口（见下面的注意项）
./.purehub/package-desktop.sh package:mac:arm64:unsigned
./.purehub/package-desktop.sh package:win:x64:unsigned
./.purehub/package-desktop.sh --print                     # 只打印将使用的构建号
PUREHUB_BUILD_SEQ=2 ./.purehub/package-desktop.sh ...     # 手动指定当日序号
```

- 序号取 UTC `HHMM` 并去掉前导零（semver 不接受 `0602` 这类带前导零的数字标识符）；脚本内置校验，非法值在打包前就报错。
- ⚠️ **构建号必须走命令行 `--build-version`，不能设 `DSH_DESKTOP_BUILD_VERSION`**：打包入口从命令行取发布版本，并把该环境变量**覆盖**成产品版本（`package-target.ts`），所以外部 export 会被无声吞掉，产物就变成与上游同号的版本。`--build-version auto` 可让入口按当天已有产物自动编号（但它读本地产物用的是 `deepseek-harness-*` 正则，见待办）。
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
- **产物名 `deepseek-harness-*` 仍残留在这些地方**（`8d956a930e` 改名时漏掉；已修 `package-macos.ts` / `package-target.ts` / 对应夹具）：`desktop-build-version-discovery.ts`（正则 + bucket 前缀）、`desktop-upload-plan.ts`、`retain-desktop-ci.ts`、`installed-update-distribution.ts`。**`--build-version auto` 会因为正则不匹配而看不到本地产物。**
- **打包本机实测**（2026-10-15，Apple Silicon）：`package:mac:arm64:unsigned` 成功。两条环境前提：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（github 不可达）；以及**必须清掉 harness 注入的 `DSH_*` 变量**（`env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_SHELL -u DSH_WEB_URL`），否则打包版 Host 的 HTTP 冒烟会超时。
- **文档站源链接与测试不一致（2 个测试红，既有问题）**：`scripts/project-doc-site.ts` 的 `REPOSITORY_URL` 指向上游 GitHub，而 `scripts/project-doc-site.spec.ts` 期望本仓 `git.rongdetu.cn/snake/pure-harness`。要么改实现（需先确认本仓对外可达），要么把测试改回上游。