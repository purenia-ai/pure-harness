---
description: "Standard OAuth2/OIDC SSO account provider: browser authorization code + PKCE login, token refresh, and account projection for the DeepSeekAccount service."
kind: "package-reference"
---

# @deepseek-ai/dsh-oidc-account

[English](README.md) | 中文

## 概述

`dsh-oidc-account` 是 `DeepSeekAccount` 服务的标准 OIDC 实现：通过系统浏览器完成 authorization code + PKCE 登录，把 access token（及可选 refresh token）存入凭据存储，并向推理路由提供 token。它替换 `@deepseek-ai/dsh-deepseek-account-platform` 的私有 `auth_init/auth_exchange` 协议，对接任何标准 OAuth2/OIDC 身份提供方（本 fork 默认指向 `https://hub.puresnake.com`）。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在组合中把 `deepseek-account` 条目的 `name` 指向本包：

```yaml
- id: deepseek-account
  name: '@deepseek-ai/dsh-oidc-account'
  config:
    issuer: 'https://hub.puresnake.com'
    displayName: PureHub
    clientId: ''
    inferenceOrigin: 'https://hub.puresnake.com'
```

`clientId` 留空为部署占位：发布前填入在 SSO 注册的公开客户端 ID。

端点解析优先取显式配置（`authorizationEndpoint`、`tokenEndpoint`、`userinfoEndpoint`、`revocationEndpoint`、`endSessionEndpoint`），缺失且 `discovery: true`（默认）时读取 `{issuer}/.well-known/openid-configuration`。所有端点必须与 issuer 同源；HTTP 仅允许 `allowLoopbackHttp: true` 的本机开发 IdP。

### 登录与凭据

`startSignIn` 在本机 webServer 上注册 `/oauth/callback`，本地构造 authorize URL（`response_type=code`、S256 PKCE、state），浏览器批准后以 `authorization_code` 兑换 token 并提交凭据记录 `oidc-account/default`：`{version:1, token, issuer, refreshToken?, expiresAt?}`。issuer 与配置不一致的存量在启动时删除。

### Token 生命周期

access token 临近过期（`refreshMarginMs`，默认 60 秒）时，`resolveToken` 与账号详情查询会在 `modifyRecord` 的跨进程锁内执行 `refresh_token` 兑换并单飞去重；SSO 返回 `invalid_grant` 会使凭据失效并广播 `deepseek-account/session-expired`。没有 refresh token 且已过期的授权同样失效。

### 账号详情

`getProfile` 读取 userinfo 并按 `claimId`（默认 `sub`）、`claimName`（默认 `nickname`，回退 `username`）、`claimContact`（默认 `email`，回退 `mobile`）、`claimAvatar`（默认 `picture`）投影。通用 SSO 没有钱包与赠金：`getBalance` 返回 `failed`（UI 显示不可用并链接到 `usageUrl`），赠金接口返回空。

### 退登与撤销

`signOut` 先删除本地凭据，再按指数退避（`logoutMaxRetries`、`logoutRetryDelayMs`）后台调用 RFC 7009 `revocationEndpoint`；远程失败不会恢复本地登录态。

<a id="understand-the-implementation"></a>
## 理解实现

实现与 `@deepseek-ai/dsh-deepseek-account-platform` 同构：attempt 状态机（initializing/waiting-browser/exchanging/committing/succeeded/cancelled/expired/failed）、`/oauth/callback` 精确路由与 state 定时安全比较、`ctx.authorization` flow 提交确认、`watch` 信号驱动快照、`installAccountTaskCancellation`。差异仅在协议层（标准 OIDC 端点与 RFC 6749 错误，`src/oidc.ts`）和 token 刷新。回调成功页由本地渲染（bilingual），不再跳转平台页面。

<a id="model-experience"></a>
## 模型体验

无，因为账号凭证只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache 影响

不改变模型请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **余额与赠金不可用**——通用 SSO 没有对应概念，余额卡片显示不可用；接入自有计费 API 需要扩展一个 `balanceEndpoint`。
- **公开客户端假设**——默认不带 `client_secret`（公开客户端 + PKCE）；机密客户端可配置 `clientSecret` 与 `clientSecretAuth`，但把 secret 打进桌面安装包并不真正保密。
- **端点与 issuer 强制同源**——端点分布在其他源时需要扩展配置而不是放宽校验。
