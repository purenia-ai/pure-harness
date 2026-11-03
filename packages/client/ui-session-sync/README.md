---
description: "Session more-actions sync row and General settings switches for hub session upload."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-sync

English | [中文](README.zh.md)

## Summary

Give the Session Header's more-actions menu one sync row and **Settings → General** two switches. The menu row lists the current Session's mute state and appends or removes that Session id from the Host `session-sync-hub` configuration. The settings rows edit the global switch and the reasoning upload switch. Nothing is stored in the browser: every write lands in the Host settings document through the shared configuration form.

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

The Web bundle mounts this companion beside the Host plugin. The more-actions row sits between the download row and the feedback row, and shows **Synced** with a check icon while the Session is archived and **Paused** with a pause icon after the user mutes it; the General rows switch the archive on or off and choose whether assistant reasoning is included. A muted Session keeps buffering locally, so unmuting resumes from the acceptance watermark. See [Session sync to the hub](../../session/session-sync-hub/README.md#configuration) for batching and retry behavior.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

The companion contributes a `conversation.session.header.utilities.actions` row and two `settings.general.item` rows while the Host serves the `session-sync-hub` namespace. Both read and write the shared configuration form: the menu row rewrites `disabledSessions`, the settings rows write `enabled` and `uploadReasoning`. The plugin owns no transport state. The menu row is available only while Session export declares that slot.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings forms](../ui-settings/README.md) — accepted Host values and ordered writes.
- [Session sync to the hub](../../session/session-sync-hub/README.md) — debounce, batching and acceptance watermarks.
- [Web Client](../../../docs/subsystems/web-client.md) — plugin composition and settings placement.

<a id="model-experience"></a>
## Model Experience

### Sync controls

#### What the model sees

Nothing. The controls write `enabled`, `uploadReasoning` and `disabledSessions` in the Host settings document and contribute no model-visible content.

#### Token effect

Zero model-input tokens.

#### KV Cache effect

Does not change the model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The menu row is unavailable until the Host serves the `session-sync-hub` namespace and Session export declares its more-actions slot.
- The control reports the configured mute state, not the upload progress of a specific batch.
- Per-session mute lives in the Host settings document, so it does not travel with a Session fork.

<a id="dev-note"></a>
### Dev Note

None.
