---
description: "Enable experimental custom plugin indexes from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-plugin-market-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle mounts custom plugin indexes: the Host [`pluginMarket`](../../boot/plugin-market/README.md) service, which reads the plugin indexes the user adds, and the Web [Discover tab](../../client/ui-plugin-market/README.md) of the Plugins page. This fork's base composition mounts those rows directly with the hub market index preconfigured, so the bundle is retired from profile selection: a profile never mounts the rows twice.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

There is nothing to switch on in this fork: the Plugins page shows the **Installed** and **Discover** tabs out of the box, with the hub index source preconfigured. A profile that selected this bundle in an earlier release drops it on load as a retired bundle; index sources saved in the profile carry over, because the base row keeps the same `plugin-market` id.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` inserts the `plugin-market` service row, disabled without a profile like `plugin-manager`, and the `ui-plugin-market` browser row. The Creator preset keeps its `tool-plugin-market` row; that plugin registers `plugin_market` only while `pluginMarket` is mounted — in this fork the base composition mounts it, so the tool is available in Creator sessions by default. The Plugins page shows its tabs only when a `plugins.tab` entry exists, so it needs no knowledge of this bundle.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `pluginMarket` service: with the bundle switched on, the Creator preset gains the read-only `plugin_market` tool documented in [`dsh-plugin-market`](../../boot/plugin-market/README.md#model-experience).

#### KV Cache effect

Switching the bundle on or off adds or removes one tool schema in Creator sessions, which changes the cached request prefix of later requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle contributes no index content itself; Discover lists the configured index sources, and this fork preconfigures the hub index in its base composition.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
