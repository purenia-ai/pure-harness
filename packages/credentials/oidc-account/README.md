---
description: "Standard OAuth2/OIDC SSO account provider: browser authorization code + PKCE login, token refresh, and account projection for the DeepSeekAccount service."
kind: "package-reference"
---

# @deepseek-ai/dsh-oidc-account

English | [中文](README.zh.md)

## Summary

`dsh-oidc-account` signs a deployment in through any standard OAuth2/OIDC identity provider: it completes an authorization code + PKCE login in the system browser, stores the access token (and optional refresh token) in the credential store, and supplies the token to inference routes. Choose it when users sign in with generic SSO — this fork defaults to `https://hub.puresnake.com` — instead of the proprietary platform protocol it replaces. The main boundary: a generic SSO exposes no wallet or bonus data, so balance features render as unavailable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Point the `deepseek-account` composition entry at this package:

```yaml
- id: deepseek-account
  name: '@deepseek-ai/dsh-oidc-account'
  config:
    issuer: 'https://hub.puresnake.com'
    displayName: PureHub
    clientId: ''
    inferenceOrigin: 'https://hub.puresnake.com'
```

The empty `clientId` is a deployment placeholder: fill in the public client ID registered at your SSO before shipping.

Endpoint resolution prefers explicit configuration (`authorizationEndpoint`, `tokenEndpoint`, `userinfoEndpoint`, `revocationEndpoint`, `endSessionEndpoint`); when absent and `discovery: true` (the default), it reads `{issuer}/.well-known/openid-configuration`. Every endpoint must share the issuer origin; HTTP is allowed only for a loopback development IdP with `allowLoopbackHttp: true`.

### Sign-in and credentials

`startSignIn` registers `/oauth/callback` on the local web server, builds the authorize URL locally (`response_type=code`, S256 PKCE, state), exchanges the approved code at the token endpoint, and commits the credential record `oidc-account/default`: `{version:1, token, issuer, refreshToken?, expiresAt?}`. A stored grant whose issuer differs from the configuration is deleted at startup.

### Token lifecycle

When an access token nears expiry (`refreshMarginMs`, default 60 seconds), `resolveToken` and account-detail queries run a `refresh_token` exchange inside the record store's cross-process lock with single-flight deduplication. An `invalid_grant` answer expires the credential and broadcasts `deepseek-account/session-expired`; a grant without a refresh token expires the same way once stale.

### Account details

`getProfile` reads userinfo and projects the configured claims: `claimId` (default `sub`), `claimName` (default `nickname`, falling back to `username`), `claimContact` (default `email`, falling back to `mobile`), `claimAvatar` (default `picture`). A generic SSO has no wallets or bonuses: `getBalance` reports `failed` (the UI renders its unavailable state linked to `usageUrl`) and bonus queries return empty.

### Sign-out and revocation

`signOut` deletes the local grant first, then calls the RFC 7009 `revocationEndpoint` in the background with exponential backoff (`logoutMaxRetries`, `logoutRetryDelayMs`); remote failures never restore the local grant.

<a id="understand-the-implementation"></a>
## Understand the implementation

The implementation is isomorphic to `@deepseek-ai/dsh-deepseek-account-platform`: the attempt state machine (initializing/waiting-browser/exchanging/committing/succeeded/cancelled/expired/failed), the exact `/oauth/callback` route with a timing-safe state comparison, the `ctx.authorization` flow commit contract, the signal-driven `watch` snapshots, and `installAccountTaskCancellation`. Only the protocol layer (standard OIDC endpoints and RFC 6749 errors in `src/oidc.ts`) and token refresh differ. The callback success page is rendered locally (bilingual) instead of redirecting to a platform page.

<a id="model-experience"></a>
## Model Experience

None, as account credentials only affect HTTP authentication and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

Does not change the model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Balance and bonuses are unavailable** — a generic SSO has no such concepts, so the balance card renders unavailable; wiring a proprietary billing API takes a future `balanceEndpoint` extension.
- **Public client assumption** — token requests omit `client_secret` by default (public client + PKCE); confidential clients may configure `clientSecret` and `clientSecretAuth`, though a secret shipped in a desktop installer is not truly secret.
- **Endpoints must share the issuer origin** — a deployment with endpoints on other origins needs an explicit configuration extension, not relaxed validation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
