---
description: "PureHub brand occupants for the Web client's sidebar and hero slots; for maintainers adjusting the deployment brand."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-pure

English | [中文](README.zh.md)

## Summary

This package fills the Web client's sidebar brand slots and the blank-session hero mark with the PureHub mark and name, so the deployment's own identity replaces the upstream artwork without touching the shells that declare those slots. It has no runtime state and does not affect model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The package is mounted in the browser roster of the `web` profile in place of `@deepseek-ai/dsh-client-ui-brand-official`, and renders whenever the client is built with the `official` profile. Changing the brand means editing two constants in [`src/client/Brand.tsx`](src/client/Brand.tsx): `BRAND_NAME` names the product, and `MARK_PATH` holds the mark artwork as one path in a 24x24 view box.

### Build profile

`DSH_CLIENT_BUILD_PROFILE` gates the registration. An `official` build fills the sidebar slots and the hero slot; any other value leaves every slot on its declaring package's fallback — the fish mark, the local-build label, and the animated hero fish. The plugin still loads and validates in both cases; only the registration is profile-gated.

### Browser title

The sidebar row is artwork only. The document and window title come from the build environment (`DSH_CLIENT_TITLE`), outside the slot system.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The two sidebar occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on the sidebar declaration, so the set works whether this row activates before or after the declarer, withdraws both occupants when the declaration collapses, and leaves no partial brand mix during HMR. The hero occupant waits on the conversation declaration the same way. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [ui-brand-official](../ui-brand-official/README.md) — the upstream reference implementation this package replaces in the roster.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots; the upstream brand package must stay out of the roster while this one is mounted.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
