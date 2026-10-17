---
description: "由部署方账号服务鉴权的 pi-ai LLM 路由：逐请求解析 token、refresh 轮换与服务端吊销，适合登录制部署而非存储 API key。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-pi-ai-account

[English](README.md) | 中文

## 概述

`dsh-llm-pi-ai-account` 挂载通用 pi-ai 适配器，让每条配置的路由都通过部署方的账号服务鉴权，而不是读取存储的 API key。每个请求都解析一个新鲜账号 token，因此 refresh 轮换、服务端吊销和退出登录立即生效，本包自身不存储任何凭据。当你的网关复用 harness 已有的 SSO 登录时选择本包；主要边界是每条路由必须显式给出自己的 `baseURL` origin，且未登录的请求会以 `ACCOUNT_SIGN_IN_REQUIRED` 终止流。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

通用的 `@deepseek-ai/dsh-llm-pi-ai` 适配器为每条路由从存储的凭据引用（`apiKeyEnv`）取密钥。本包挂载同一个 pi-ai 适配器，唯一区别是：每个请求都通过 `deepseekAccount.resolveToken(origin)` 解析一个新鲜 token，origin 取自路由的 `baseURL`。因此 refresh 轮换、服务端吊销和退出登录都逐请求生效，本插件自己不存任何凭据。

### 最小配置

```yaml
- id: llm-pi-ai-account
  name: '@deepseek-ai/dsh-llm-pi-ai-account'
  config:
    providers:
      acme-gateway:
        displayName: Acme Gateway
        api: openai-completions
        baseURL: https://gateway.acme.example/v1
        models:
          - id: acme-large
```

`providers` 字典与通用 pi-ai 插件的形状一致；这里的每条路由都必须显式给出 `baseURL`，因为账号服务会按配置的推理 origin 校验请求目标。未登录的请求以 `ACCOUNT_SIGN_IN_REQUIRED` 终止流；`baseURL` origin 被账号服务拒绝的路由同样如此。

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 复用通用插件的 profile 解析器，用账号-backed 的 `resolveApiKey` 构造一个 `PiAiAdapter`，并注册配置的路由及可配置提供方目录项。路由集合是静态组合（部署 patch），所以在 apply 时注册一次即可，没有需要监听的设置文档。

<a id="further-exploration"></a>
## 进一步探索

- `@deepseek-ai/dsh-llm-pi-ai` —— 本包复用的通用适配器，含 profile schema 与协议表。
- `@deepseek-ai/dsh-deepseek-account` —— token 解析所经过的账号服务接缝。

<a id="model-experience"></a>
## 模型体验

间接承载挂载的路由：用户消息、工具结果与通用 pi-ai 适配器拥有全部模型可见 token；本包只负责其 HTTP 传输的鉴权。

#### KV Cache 影响

不改变模型请求前缀：账号 token 走 HTTP authorization 头，没有任何提供方将其视为可缓存的提示内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些约束说明账号路由何时合适、何时不合适。它们是当前包约束，不是任务积压。

- **每条路由都要求已登录账号**——没有有效授权时请求以 `ACCOUNT_SIGN_IN_REQUIRED` 终止流；不存在按路由回退到存储 API key 的路径。
- **被拒绝的 origin 会让整条路由失效**——账号服务拒绝某路由的 `baseURL` origin 时，该路由的每个请求都以同样方式失败；没有逐请求覆盖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
