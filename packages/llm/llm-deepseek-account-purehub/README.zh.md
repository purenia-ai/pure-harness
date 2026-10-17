---
description: "fork 自有、以账号鉴权的 Messages 路由，读取 PureHub 网关的模型列表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek-account-purehub

[English](README.md) | 中文

## 概述

为 fork 的网关注册以账号鉴权的 Anthropic Messages 路由 `deepseek-account`。本包复用 [Messages 传输](../llm-deepseek/README.zh.md)与上游的账号列表缓存，并把上游 [`@deepseek-ai/dsh-llm-deepseek-account`](../llm-deepseek-account/README.zh.md) 的版本门禁换成部署自己的方言映射：网关的列表决定有哪些 id，`otherRoutePrefixes` 决定其中哪些属于另一个提供方路由。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

fork 的网关在 `/v1/messages` 提供 Anthropic Messages 方言，模型列表在 `/v1/models`。上游路由从 `baseURL` 的 origin 推导列表地址，且总是请求 `/models`，因此本包改为替换这条路由，而不是改上游包。

```yaml
- id: llm-deepseek-account-purehub
  name: '@deepseek-ai/dsh-llm-deepseek-account-purehub'
  config:
    baseURL: 'https://hub.puresnake.com/v1'
    authScheme: bearer
    maxTokens: 131072
    # `gpt` ids ride llm-pi-ai-account; every other listed id speaks Anthropic Messages here.
    otherRoutePrefixes:
      - gpt
    models:
      - id: glm-5.3
        name: glm-5.3
        inputModalities: [text, image]
```

账号 token 仅由 `deepseekAccount.resolveToken(url)` 提供，目标地址必须通过账号服务的来源校验。未登录或目标不允许账号鉴权时，请求以 `ACCOUNT_SIGN_IN_REQUIRED` 失败，目录为空；不会回退到 API key。

路由的目录来自账号的 `GET /v1/models` 列表（当 Messages `baseURL` 以 `/v1` 结尾时），否则来自 `GET /models`。网关可能对每种方言只回一份 OpenAI 形状的列表，且任何条目都不带 `api_capabilities`，所以列表本身不带方言信息；方言由 `otherRoutePrefixes` 声明。还没有加载到任何列表时，路由提供声明的那一组；没有声明时提供内置目录（`deepseek-flash` 与 `deepseek-v4-pro`）。

列出的 id 只要不被 `otherRoutePrefixes` 中的前缀划给另一个提供方路由，就会通过 Messages 提供；被划走的 id 会在发出请求之前以 `MODEL_UNSUPPORTED` 拒绝。没有被任何来源列出的 id 仍然可以按请求使用，因为 Messages 传输接受端点自有的任意 id。网关若标了 `api_capabilities.anthropic_messages`，该条目就带来名称、`context_window`、模态、输出上限与 system prompt 模式；对这些条目不带出的字段，由 `models` 声明同名字段，并按同 id 覆盖本构建的知识，未设字段继承，省略 `inputModalities` 读作文本专用。声明了但在已加载的列表里不存在的 id 保持隐藏并被报告，因为可用性由网关决定。不做 `client_requirements` 版本门禁。

`modelOverrides` 可调整单个模型而不替换整个目录，字段与继承规则同上游路由。

<a id="understand-the-implementation"></a>
## 理解实现

`src/config.ts` 解析本 fork 的配置：上游的账号设置加上 `models` 与 `otherRoutePrefixes`，后两者不会传到上游解析器。`src/index.ts` 复用上游包的 `AccountModelCatalog`、`requestModelListing` 与账号解析器，用 fork 的 `/v1/models` 推导覆盖解析出的列表地址，并通过共享 Messages 传输注册 `deepseek-account` 提供方。`src/resolve-catalog.ts` 是 fork 的目录解析：先丢掉属于另一个路由的 id，再按 id 依次叠加列表事实、声明与本构建的知识。

<a id="further-exploration"></a>
## 进一步探索

- [`@deepseek-ai/dsh-llm-deepseek-account`](../llm-deepseek-account/README.zh.md) — 本包替换的上游账号路由。
- [Messages](../llm-deepseek/README.zh.md) — 共享的协议传输。

<a id="model-experience"></a>
## 模型体验

### 已鉴权的模型请求

#### What the model sees

`deepseek-account` 请求不包含本插件添加的模型可见文本；请求由共享 Messages 传输序列化。

#### Token effect

鉴权和列表不增加输入 token。解析后的目录决定每个模型的上下文窗口和默认输出上限，每次请求记录的上下文与请求头会记下这些值。

#### KV Cache effect

凭据与目录可用性不进入模型输入；协议传输拥有请求前缀的序列化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 列表缓存只在内存中；没有网络时启动，在加载到列表之前使用声明的那一组或内置能力。
- 网关不标注方言，因此方言映射属于部署配置：新接一个说别的协议的上游时，既要在 `otherRoutePrefixes` 加前缀，也要有对应路由。
- 有意不做版本门禁；由网关的列表决定本账号能用哪些模型。
- 过滤在客户端执行；改过的客户端仍可以请求任意 id，除非服务端拒绝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
