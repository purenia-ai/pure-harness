# @deepseek-ai/dsh-llm-pi-ai-account

[English](README.md) | 中文

由部署方**账号服务**（而非存储的 API key）鉴权的 pi-ai LLM 路由。

## 使用本包

通用的 `@deepseek-ai/dsh-llm-pi-ai` 适配器为每条路由从存储的凭据引用（`apiKeyEnv`）取密钥。本包挂载同一个 pi-ai 适配器，唯一区别是：每个请求都通过 `deepseekAccount.resolveToken(origin)` 解析一个新鲜 token，origin 取自路由的 `baseURL`。因此 refresh 轮换、服务端吊销和退出登录都逐请求生效，本插件自己不存任何凭据。

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

## 理解实现

`src/index.ts` 复用通用插件的 profile 解析器，用账号-backed 的 `resolveApiKey` 构造一个 `PiAiAdapter`，并注册配置的路由及可配置提供方目录项。路由集合是静态组合（部署 patch），所以在 apply 时注册一次即可，没有需要监听的设置文档。

## 进一步探索

- `@deepseek-ai/dsh-llm-pi-ai` —— 本包复用的通用适配器，含 profile schema 与协议表。
- `@deepseek-ai/dsh-deepseek-account` —— token 解析所经过的账号服务接缝。
