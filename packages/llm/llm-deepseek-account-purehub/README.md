---
description: "Fork-owned account-authenticated Messages route that reads the PureHub gateway's model listing."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek-account-purehub

English | [中文](README.zh.md)

## Summary

Register the account-authenticated Anthropic Messages route `deepseek-account` for the fork's gateway. This package reuses the [Messages transport](../llm-deepseek/README.md) and the upstream account listing cache, and replaces the upstream [`@deepseek-ai/dsh-llm-deepseek-account`](../llm-deepseek-account/README.md) version gating with the deployment's own dialect map: the gateway's listing decides which ids exist, and `otherRoutePrefixes` decides which of them belong to another provider route.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The fork's gateway serves the Anthropic Messages dialect at `/v1/messages` and the model listing at `/v1/models`. The upstream route derives its listing endpoint from the `baseURL` origin and always asks for `/models`, so this package replaces that route instead of patching the upstream package.

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

Only `deepseekAccount.resolveToken(url)` supplies the token; the account service validates the destination. Signed-out or ineligible requests fail with `ACCOUNT_SIGN_IN_REQUIRED` and discovery returns an empty catalog. The route never falls back to an API key.

The catalog comes from the account's `GET /v1/models` listing when the Messages `baseURL` ends in `/v1`, and from `GET /models` otherwise. A gateway may answer one OpenAI-shaped listing for every dialect and mark no entry with `api_capabilities`, so the listing carries no dialect information; `otherRoutePrefixes` is how the deployment states it. Before any listing loads, the route serves the declared set, or the built-in catalog (`deepseek-flash` and `deepseek-v4-pro`) when nothing is declared.

A listed id is offered through Messages unless a prefix in `otherRoutePrefixes` gives it to another provider route, which reports `MODEL_UNSUPPORTED` before any request. An id listed by no source is still accepted on request, as the Messages transport accepts any endpoint id. A gateway that does mark `api_capabilities.anthropic_messages` supplies name, `context_window`, modalities, output cap, and system prompt mode for that entry; a `models` declaration states the same fields for entries the listing leaves bare and layers over this build's knowledge for the same id, so unset fields inherit and an omitted `inputModalities` reads as text-only. A declared id absent from a loaded listing stays hidden and is reported, because the gateway decides availability. Deployment version gating through `client_requirements` is not applied.

`modelOverrides` adjusts single models without replacing the catalog, with the same fields and inheritance the upstream route documents.

## Understand the implementation

`src/config.ts` resolves this fork's configuration: the upstream account settings plus `models` and `otherRoutePrefixes`, which the upstream resolver never sees. `src/index.ts` reuses `AccountModelCatalog`, `requestModelListing`, and the upstream account resolver, overrides the resolved catalog URL with the fork's `/v1/models` derivation, and registers the `deepseek-account` provider through the shared Messages transport. `src/resolve-catalog.ts` is the fork's catalog resolution: it drops the ids another route owns, then layers the listing's facts, the declaration, and this build's knowledge per id.

## Further Exploration

- [`@deepseek-ai/dsh-llm-deepseek-account`](../llm-deepseek-account/README.md) — the upstream account route this package replaces.
- [Messages](../llm-deepseek/README.md) — the shared protocol transport.

<a id="model-experience"></a>
## Model Experience

### Authenticated model requests

#### What the model sees

Requests on `deepseek-account` add no model-visible text from this plugin; the shared Messages transport serializes requests.

#### Token effect

Authentication and the listing add no input tokens. The resolved catalog sets each model's context window and default output cap, which each request's logged context and header record.

#### KV Cache effect

Credentials and catalog availability do not enter model input; the protocol transport owns request-prefix serialization.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The listing cache lives in memory; a start without network serves the declared set, or bundled capabilities, until a listing loads.
- The gateway marks no dialect, so the dialect map is a deployment setting: a new upstream that speaks another protocol needs a prefix here as well as a route.
- Version gating is deliberately absent; the gateway's listing selects the models this account may use.
- The filter runs in this client; a modified client can still request any id unless the service rejects it.
