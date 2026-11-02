---
description: "Incremental Session archive upload to a hub session-trace endpoint."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-sync-hub

English | [中文](README.zh.md)

## Summary

Archive each live Session to a PureHub `session_traces` endpoint while the conversation runs. This function plugin injects `ctx.sessions` and owns the `session-sync-hub/delivery-accepted` event that records how far the hub has accepted. Uploads run beside the loop: a debounce window bounds request rate, per-request batching bounds payload size, and a failed attempt only postpones the next one.

## Table of Contents

- [Configuration](#configuration)
- [What is uploaded](#what-is-uploaded)
- [Retries and watermarks](#retries-and-watermarks)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `https://hub.puresnake.com` | Hub origin; the plugin appends `/api/session-trace/save`. |
| `enabled` | `true` | Global switch; a settings-form write replaces this composition layer. |
| `uploadReasoning` | `true` | Archive assistant reasoning as a `【思考】` section. |
| `uploadSystemMessages` | `true` | Archive `system` and `developer` prompts. |
| `toolResultCap` | `8000` | Truncate one archived tool result beyond this many characters. |
| `debounceMs` | `5000` | Quiet window after the last archived event before a Session's queue drains. |
| `maxBatchMessages` | `200` | Largest row count in one save request. |
| `maxBatchBytes` | `2097152` | Largest serialized `messages` array in one save request. |
| `maxConcurrentSessions` | `2` | Sessions whose queues may drain at the same time. |
| `disabledSessions` | `[]` | Session ids the user muted; the session-header action appends or removes one id. |

Every request carries the signed-in account's access token as `Authorization: Bearer`; the plugin resolves it for the configured origin through `ctx.deepseekAccount.resolveToken` and never stores it; the origin must match the deployment's account-token origin, otherwise no token resolves and nothing uploads. While signed out it keeps rows queued and uploads them after sign-in.

<a id="what-is-uploaded"></a>
## What is uploaded

One canonical event becomes one archived row, keyed by the event's own sequence:

| Event | Row |
|---|---|
| `user/message` | `role=user`, joined text blocks |
| `assistant/message` | `role=assistant`; text plus `【思考】` when reasoning upload is on |
| `system/message`, `developer/message` | `role=system` / `role=developer` |
| `tool/call` | `role=tool`, name and raw arguments |
| `tool/result` | `role=tool`, result text with explicit truncation fields |

Every request also carries session facts the file-parsing runtimes never had: `ownerId` (the signed-in account), `startedAt` (the Session header's creation time), `lastEventAt`, `formatVersion`, `parentSessionId`, `agentPreset`, and the raw header JSON. The hub stores them in `session_trace_meta`.

<a id="retries-and-watermarks"></a>
## Retries and watermarks

An accepted request appends `session-sync-hub/delivery-accepted` with the last uploaded sequence; later windows read that marker and resend only the suffix. A failed request keeps its rows queued and retries with exponential backoff up to one minute. A `401` discards the token through `rejectToken` so the next attempt refreshes it; a `404` stops the session as a configuration error. A redirect to the sign-in page is never treated as an acknowledgement: the batch stays queued and is retried with the next window. Session disposal flushes the remaining rows with `finalBatch` and `messageTotal`, so the hub can freeze the message count.

## Model Experience

### Session archive

#### What the model sees

Nothing. Archived rows mirror the Session log and are uploaded beside the loop; the `enabled`, `uploadReasoning` and `disabledSessions` settings change archive traffic only, never a request field, prompt or tool schema.

#### Token effect

Zero model-input tokens; archiving only adds HTTP requests to the hub.

#### KV Cache effect

Does not change the model request prefix.

## Known Limitations and Deferred Work

- **Live Sessions only** — sessions created before the plugin mounted are not backfilled; the archive starts with the next archived event.
- **Requires a hub sign-in** — without a stored account token the plugin keeps rows queued and uploads nothing; uploading resumes with the next archived event after sign-in, without a restart.
- **Settings-document session list** — per-session mute lives in the Host settings document, so it follows the machine rather than travelling with a Session fork.
- **Tool rows are not paired** — a call and its result render as two rows; joining them needs a hub-side view change.
- **Watermark growth** — each accepted batch appends one small event to the Session log.
- **No HTTP read-back** — the plugin treats a 2xx as acceptance and never re-reads the archive.

### Dev Note

None.
