---
description: "pi-ai LLM routes authenticated by the deployment's account service: per-request token resolution with refresh rotation and revocation, for deployments that sign in instead of storing API keys."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-pi-ai-account

English | [中文](README.zh.md)

## Summary

`dsh-llm-pi-ai-account` mounts the generic pi-ai adapter so every configured route authenticates through the deployment's account service instead of a stored API key. Each request resolves a fresh account token, so refresh rotation, server-side revocation, and sign-out take effect immediately, and the package stores no credential of its own. Choose it when your gateway sits behind the same SSO sign-in the harness already uses; the main boundary is that every route must name its own `baseURL` origin, and a signed-out request fails the stream with `ACCOUNT_SIGN_IN_REQUIRED`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The generic `@deepseek-ai/dsh-llm-pi-ai` adapter authenticates each route from a stored credential reference (`apiKeyEnv`). This package mounts the same pi-ai adapter with one difference: every request resolves a fresh token through `deepseekAccount.resolveToken(origin)`, where the origin comes from the route's `baseURL`. Refresh rotation, server-side revocation, and sign-out therefore apply per request, and this plugin stores no credential of its own.

### Minimal configuration

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

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/index.ts` resolves profiles with the generic plugin's own resolver, builds one `PiAiAdapter` with an account-backed `resolveApiKey`, and registers the configured routes plus their configurable-provider directory entries. The route set is static composition (deployment patch), so registration happens once at apply; there is no settings document to watch.

<a id="further-exploration"></a>
## Further Exploration

- `@deepseek-ai/dsh-llm-pi-ai` — the generic adapter this package reuses, including the profile schema and protocol table.
- `@deepseek-ai/dsh-deepseek-account` — the account service seam the token resolution goes through.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the mounted routes: user messages, tool results, and the generic pi-ai adapter own every model-visible token; this package only authenticates their HTTP transport.

#### KV Cache effect

Does not change the model request prefix: the account token travels in HTTP authorization, which no provider treats as cached prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints decide when account-backed routes fit and when they do not. They are current package constraints, not a task backlog.

- **Every route requires a signed-in account** — a request without a valid grant fails the stream with `ACCOUNT_SIGN_IN_REQUIRED`; no per-route fallback to a stored API key exists.
- **A refused origin rejects the whole route** — when the account service refuses a route's `baseURL` origin, every request on that route fails the same way; there is no per-request override.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
