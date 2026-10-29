# Tunnel protocol `hookline.v1`

The CLI (`hookline listen`, `hookline tail`) receives captured requests over a WebSocket and, optionally, answers them. This document is the specification. The Go types live in `packages/protocol` (shared by the edge and the CLI) and are mirrored for TypeScript in `packages/shared/src/tunnel.ts`.

## Connection

```
GET /v1/tunnel HTTP/1.1
Upgrade: websocket
Sec-WebSocket-Protocol: hookline.v1
Authorization: Bearer hk_live_...
```

- The API key needs the `tunnel` scope. A missing or invalid key gets `401`, a key without the scope `403`, before the upgrade. Bodies are JSON: `{"error": {"code", "message"}}`.
- The client must offer the subprotocol `hookline.v1`; a connection without it is closed with `4000`.
- The URL is advertised by the web app at `GET /api/v1/cli/config` (`tunnel_url`). Behind Caddy it is `wss://<domain>/v1/tunnel`.

## Frames

Every frame is one JSON **text** message with a `type`. Receivers ignore fields they do not know and frame types they do not know, so additions never break older peers. Incompatible changes get a new version (`hookline.v2`).

| Direction  | Type       | Fields                                                                                                                                                                                                                        |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI → edge | `hello`    | `protocol: 1`, `cli_version`, `endpoints: [slug]` (1–10), `sync: bool`, `last_request_id?`                                                                                                                                    |
| edge → CLI | `ready`    | `session_id`, `endpoints: [{id, slug, url, name, response_mode}]`, `limits: {max_message_bytes, ping_interval_ms, concurrent_tunnels}`                                                                                        |
| edge → CLI | `request`  | `id`, `endpoint_id`, `method`, `path` (below `/h/{slug}`), `query` (raw, no `?`), `headers` (`[[name, value], ...]`), `body_b64`, `body_size`, `received_at`, `body_omitted?`, `sync_deadline_ms?`, `replayed?`, `replay_of?` |
| CLI → edge | `response` | `id` (the request's), `status` (200–599), `headers`, `body_b64`, `duration_ms`                                                                                                                                                |
| both       | `error`    | `id?` (the request it concerns), `code`, `message`                                                                                                                                                                            |
| both       | `ping`     | (none); answer with `pong`                                                                                                                                                                                                    |
| both       | `pong`     | (none)                                                                                                                                                                                                                        |
| edge → CLI | `goaway`   | `reason`, `reconnect_after_ms`                                                                                                                                                                                                |

### Session

1. The client sends `hello` within 10 seconds. The edge checks that every slug belongs to the key's organization and that the organization has a free tunnel slot (plan limit `concurrent_tunnels`, counted across all edge instances).
2. The edge answers `ready`, then streams `request` frames as the endpoints capture them.
3. With `last_request_id` (the newest request the client saw before a reconnect), the edge first replays newer requests, at most 100 and at most 10 minutes old, marked `"replayed": true`. A request can arrive both replayed and live; clients de-duplicate by `id`.
4. A request sent again from the dashboard or API ("replay to CLI") arrives as a `request` frame with a new `id` and `replay_of` set to the captured request's ID. It is never a sync request.
5. Bodies travel base64-encoded. A body that would not fit in a frame (over about 720 KiB) is left out: `body_omitted: true`, `body_size` is the real size, and the client forwards the request without it.

### Answers and sync mode

A client may answer each request with `response` (what its local target returned) or `error` (codes `target_unreachable`, `timeout`). Answers matter only for endpoints in **CLI sync** response mode and only from sessions that said `"sync": true` in `hello`:

- Intake subscribes to `tunnel:resp:{requestId}`, publishes the request with `sync_deadline_ms`, and waits that long (the endpoint's `sync_timeout_ms`, 1–30 s).
- The first `response` wins and is returned to the original sender: its status, its headers (through the same allow-list as custom responses) and body. Hookline's sandbox `Content-Security-Policy` and `nosniff` headers stay.
- An `error` answer, no connected sync session, or the deadline passing sends the endpoint's static response instead.

Responses are capped by the frame size; the CLI truncates local response bodies at 512 KiB.

### Keep-alive

Both sides send `ping` every 20 seconds (`limits.ping_interval_ms`) and answer `ping` with `pong`. A peer from which nothing has arrived for three intervals is considered gone: the edge closes with `4011`, the client reconnects.

### Limits and errors

- Frames over **1 MiB** are answered with an `error` frame (`message_too_large`); the session continues. Frames over 4 MiB close the connection with `1009`.
- Malformed frames get `error` with `invalid_message`; the session continues. A second `hello` is an error too.
- A client whose queue of unsent frames grows past 256 is closed with `4029` and resumes after reconnecting.

## Close codes

| Code   | Meaning                                                            | Client should             |
| ------ | ------------------------------------------------------------------ | ------------------------- |
| `1000` | Normal close (the CLI quit)                                        | stop                      |
| `1001` | The edge is restarting (after `goaway`)                            | reconnect after the delay |
| `1009` | A frame exceeded 4 MiB                                             | reconnect                 |
| `4000` | Protocol violation (no subprotocol, no `hello`, malformed `hello`) | stop and report           |
| `4001` | The API key was revoked                                            | stop; log in again        |
| `4004` | An endpoint in `hello` does not exist in the organization          | stop                      |
| `4008` | The plan's concurrent tunnel limit is reached                      | retry later               |
| `4010` | `hello.protocol` is newer than the edge supports                   | stop; use a matching CLI  |
| `4011` | Nothing received for three ping intervals                          | reconnect                 |
| `4029` | The client read too slowly                                         | reconnect and resume      |

Before closing with a 4xxx code the edge sends an `error` frame whose `message` explains what to do.

## Reconnecting

Clients reconnect with exponential backoff and full jitter (1 s up to 30 s), starting over once a session has been ready, and resume with `last_request_id`. On `goaway` they wait `reconnect_after_ms` (spread by the edge between 0.25 and 2.25 s so a deploy does not stampede the remaining instances) instead of backing off.

## Routing across edge instances

```
sender ─▶ edge A (intake) ── PUBLISH tunnel:ep:{endpointId} ──▶ Redis ──▶ edge B ─▶ CLI
                     ▲                                                     │
                     └──── tunnel:resp:{requestId} (sync answers) ◀────────┘
```

- Each edge process holds one Redis connection for all `tunnel:ep:*` subscriptions of its sessions and one for the `tunnel:resp:*` channels intake waits on (`services/edge/internal/pubsub`).
- Every session listening on an endpoint receives its requests; in sync mode the first answer wins.
- Sessions are recorded in the sorted sets `tunnel:org:{orgId}` (plan limit) and `tunnel:ep-sessions:{endpointId}` (the dashboard's "connected CLI" count), scored by an expiry that every ping extends, so a crashed instance's sessions disappear within 90 seconds. Joins and leaves publish a `tunnels` event on the endpoint's live stream.
- Without Redis, tunnels do not receive requests (intake keeps capturing). Session time is added to `usage_daily.tunnel_minutes` when a session ends.

## Example

```jsonc
// CLI → edge
{"type":"hello","protocol":1,"cli_version":"1.4.0","endpoints":["Hk3n9QpZx2Lm"],"sync":true}
// edge → CLI
{"type":"ready","session_id":"5f0c…","endpoints":[{"id":"0192…","slug":"Hk3n9QpZx2Lm","url":"https://hookline.example.com/h/Hk3n9QpZx2Lm","name":"Stripe","response_mode":"cli_sync"}],"limits":{"max_message_bytes":1048576,"ping_interval_ms":20000,"concurrent_tunnels":5}}
{"type":"request","id":"0192…","endpoint_id":"0192…","method":"POST","path":"/stripe","query":"","headers":[["Content-Type","application/json"],["Stripe-Signature","t=…"]],"body_b64":"eyJpZCI6ImV2dF8xIn0=","body_size":15,"received_at":"2026-10-29T12:04:31.123456Z","sync_deadline_ms":10000}
// CLI → edge
{"type":"response","id":"0192…","status":200,"headers":[["Content-Type","application/json"]],"body_b64":"eyJvayI6dHJ1ZX0=","duration_ms":38.2}
```
