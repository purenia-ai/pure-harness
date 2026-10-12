# @deepseek-ai/dsh-llm-pi-ai-account

English | [中文](README.zh.md)

pi-ai-backed LLM routes authenticated by the deployment's **account service** instead of a stored API key.

## Use this package

The generic `@deepseek-ai/dsh-llm-pi-ai` adapter authenticates each route from a stored credential reference (`apiKeyEnv`). This package mounts the same pi-ai adapter with one difference: every request resolves a fresh token through `deepseekAccount.resolveToken(origin)`, where the origin comes from the route's `baseURL`. Refresh rotation, server-side revocation, and sign-out therefore apply per request, and this plugin stores no credential of its own.

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

The `providers` dict is the same shape the generic pi-ai plugin accepts; every route here must name its own `baseURL` because the account service validates the request origin against its configured inference origin. A signed-out request fails the stream with `ACCOUNT_SIGN_IN_REQUIRED`; a route whose `baseURL` origin the account refuses fails the same way.

## Understand the implementation

`src/index.ts` resolves profiles with the generic plugin's own resolver, builds one `PiAiAdapter` with an account-backed `resolveApiKey`, and registers the configured routes plus their configurable-provider directory entries. The route set is static composition (deployment patch), so registration happens once at apply; there is no settings document to watch.

## Further exploration

- `@deepseek-ai/dsh-llm-pi-ai` — the generic adapter this package reuses, including the profile schema and protocol table.
- `@deepseek-ai/dsh-deepseek-account` — the account service seam the token resolution goes through.
