---
description: "General 设置中的会话上传开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-sync

[English](README.md) | 中文

## 概述

在 **设置 → General** 提供两个开关：归档开关与思考内容开关。浏览器不保存任何状态：每次写入都通过共享配置表单落到 Host 设置文档。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 组合把它与 Host 插件一起挂载。General 行控制归档开关以及是否包含助手推理内容。批处理与重试见 [会话同步到 hub](../../session/session-sync-hub/README.zh.md#configuration)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

只要 Host 提供 `session-sync-hub` 命名空间，本包就贡献两行 `settings.general.item`。两者都读写共享配置表单，写入 `enabled` 与 `uploadReasoning`。插件自身不持有传输状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [设置表单](../ui-settings/README.zh.md) — Host 接受值与有序写入。
- [会话同步到 hub](../../session/session-sync-hub/README.zh.md) — 去抖、分批与接受水位。
- [Web 客户端](../../../docs/subsystems/web-client.zh.md) — 插件组合与设置位置。

<a id="model-experience"></a>
## 模型体验

### 同步控件

#### 模型看到什么

无。控件只写 Host 设置文档中的 `enabled`、`uploadReasoning` 与 `disabledSessions`，不贡献任何模型可见内容。

#### Token 影响

零模型输入 token。

#### KV Cache 影响

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 控件显示的是配置的静音状态，而不是某批上传的进度。
- 单会话静音属于 Host 设置文档，不随会话 Fork 迁移。

<a id="dev-note"></a>
### 开发备注

无。
