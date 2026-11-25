# Spec: `devpanel shell` and `devpanel exec`

> This document describes the external behaviour and internal contract of the two commands.
> It is the authoritative reference for the CLI side. The API server, Tunnel Relay, and Shell Gateway are separate services; their contracts are summarised in §6 and §7.

---

## 1. Overview

```
devpanel shell <applicationId>
devpanel exec  <applicationId> -- <command> [args...]
```

Both commands open a multiplexed WebSocket tunnel to a container running inside a customer cluster. The CLI never connects directly to the cluster — all traffic is relayed through the DevPanel infrastructure.

```
CLI ──① POST /sessions (Bearer idToken)──► API server ──► Vault signs ticket
 ◄─────────── { sessionId, ticket, connectUrl, expiresAt } ───────────────┘

CLI ──② WSS connectUrl  (Authorization: Bearer <ticket>) ──► Tunnel Relay
                                relay redeems ticket, opens tunnel stream
                                              ══════════► Shell Gateway (customer cluster)
                                                            exec into pod/container
CLI ◄── channel 4 control:ready ── ⇄ stdin/stdout/stderr ⇄ ── channel 4 control:exit
```

---

## 2. Command Reference

### 2.1 `devpanel shell`

```
devpanel shell <applicationId> [options]
```

Opens a fully interactive terminal (TTY) in the primary container of an application.

| Option | Default | Description |
|---|---|---|
| `-w, --workspace <id>` | config / env | Workspace that owns the application |
| `-p, --project <id>` | config / env | Project that owns the application |
| `--container <name>` | *(API picks primary)* | Target container name |
| `--pod <name>` | *(Gateway picks a Ready pod)* | Pin to a specific pod |
| `--escape-char <char>` | `~` | Escape character; `none` disables escape processing |
| `--debug` | off | Print timing, sessionId, request IDs to stderr; redacts tokens |

**Requires an interactive terminal.** If `process.stdin.isTTY` is `false`, the command prints an error and exits with code 2.

### 2.2 `devpanel exec`

```
devpanel exec <applicationId> [options] -- <command> [args...]
```

Runs a one-off command non-interactively. Stdout and stderr arrive on separate streams and are written to the correct local descriptors. The process exits with the remote command's exit code.

| Option | Default | Description |
|---|---|---|
| `-w, --workspace <id>` | config / env | Workspace that owns the application |
| `-p, --project <id>` | config / env | Project that owns the application |
| `--container <name>` | *(API picks primary)* | Target container name |
| `--pod <name>` | *(Gateway picks a Ready pod)* | Pin to a specific pod |
| `-t, --tty` | off | Allocate a TTY; silently ignored if stdin is not a TTY |
| `-i, --stdin` | off | Forward local stdin to the command |
| `--debug` | off | Print timing, sessionId, request IDs to stderr; redacts tokens |

The separator `--` is **required** to distinguish CLI flags from the remote command. Missing command → error, exit code 2.

---

## 3. Workspace and Project Resolution

Both commands resolve workspace and project using this priority order (highest wins):

```
1. CLI flag          --workspace / --project
2. Environment var   DEVPANEL_WORKSPACE / DEVPANEL_PROJECT
3. Config file       ~/.devpanel/config.json  →  current.workspace / current.project
```

If neither workspace nor project can be resolved, the command exits with code 2 and instructs the user to run `devpanel config --workspace <id>`.

---

## 4. Authentication

### 4.1 Token check

Before calling the API, `getAuthenticatedCreds(cfg)` in `src/session/api.ts`:

1. Loads `~/.devpanel/credentials.json`.
2. Calls `isTokenExpired(creds)` — expires if `Date.now() >= expiresAt - 60 000`.
3. If expired, calls `refreshTokens(creds, cfg)` — POST `https://{cognitoDomain}/oauth2/token` with `grant_type=refresh_token`.
4. Saves the new credentials if refresh succeeds; throws `"Your session has expired. Run \"devpanel login\"."` if it fails.

### 4.2 401 during session creation

If the API returns `401`, `createSession()` attempts a single token refresh and retries the request. A second `401` is surfaced as the same error message.

### 4.3 Security rule

`idToken` is only sent to the DevPanel API (`apiUrl`). The WebSocket connection uses only the short-lived `ticket` returned by the API.

---

## 5. Session Lifecycle

### 5.1 Create session — POST /sessions

```
POST {apiUrl}/workspaces/{workspaceId}/projects/{projectId}/applications/{applicationId}/sessions
Authorization: Bearer {idToken}
Content-Type: application/json
X-Request-Id: {uuid}
User-Agent: devpanel-cli/{version} ({platform}/{arch})
```

Request body for `shell`:
```json
{
  "type": "shell",
  "container": "php",
  "pod": null,
  "tty": true,
  "cols": 220,
  "rows": 50,
  "term": "xterm-256color"
}
```

Request body for `exec`:
```json
{
  "type": "exec",
  "container": "php",
  "pod": null,
  "tty": false,
  "command": ["drush", "cr"]
}
```

- `cols`/`rows` — from `process.stdout.columns` / `process.stdout.rows`; omitted when `tty: false`.
- `term` — from `process.env.TERM`; defaults to `"xterm-256color"`.

Successful response — HTTP 201:
```json
{
  "sessionId":  "sess_8f2a",
  "ticket":     "eyJ…",
  "connectUrl": "wss://connect.devpanel.com/v1/sessions/sess_8f2a",
  "expiresAt":  "2026-11-25T10:00:30Z"
}
```

If `Date.now() > new Date(expiresAt).getTime() - 5000`, a fresh session is requested (once).

### 5.2 HTTP error mapping

| HTTP status / API code | Message shown to user |
|---|---|
| `400` | `Invalid request: <message>` |
| `401` | Refresh once; then `Your session has expired. Run "devpanel login".` |
| `403 forbidden` | `You don't have shell access to this application. Ask a workspace admin to grant the "shell" permission.` |
| `403 shell_disabled` | `Shell access is disabled for this workspace.` |
| `404` | `Application <id> not found in project <id> / workspace <id>.` |
| `409 container_not_found` | `Container "<name>" not found. Available: <list>.` |
| `412 mfa_required` | `MFA is required for this action. This CLI version doesn't support it yet.` |
| `426` | `This CLI version is no longer supported. Please upgrade.` |
| `429` | `Too many requests. Try again in <Retry-After>s.` |
| `503 agent_disconnected` | `The cluster for this application is not reachable right now. Your application is still running; only shell access is affected.` |
| other 5xx / network | `DevPanel API is unavailable (request id: <id>).` |

### 5.3 Open WebSocket

```
GET {connectUrl}
Authorization: Bearer {ticket}
Sec-WebSocket-Protocol: devpanel.shell.v1
User-Agent: devpanel-cli/{version} ({platform}/{arch})
X-Request-Id: {uuid}
```

Security checks before connecting:
- `connectUrl` scheme must be `wss://`.
- Hostname must match a suffix in `allowedConnectHosts` (e.g. `.devpanel.com`).
- Ticket is **only** in the `Authorization` header — never in the URL or query string.

Connection timeout: **10 seconds**. If the connection does not open within 10 seconds, the WebSocket is terminated and the command exits with code 255.

### 5.4 Wait for `control:ready`

After the WebSocket opens, the CLI waits up to **15 seconds** for a `control:ready` frame on channel 4. During this wait a spinner is shown on stderr (suppressed when `process.stderr.isTTY` is false).

If a `control:error` frame arrives before `ready`, the error code is mapped (see §7.3) and the command exits with code 255.

### 5.5 Data loop

Once `ready` is received:

**`shell` mode:**
- Raw mode is enabled (`process.stdin.setRawMode(true)`).
- Three concurrent event loops run until the session ends:
  - **stdin → WS (channel 0):** reads from `process.stdin`, processes escape sequences, sends to relay.
  - **WS → stdout/stderr:** channel 1 → `process.stdout`, channel 2 → `process.stderr`, channel 4 → control handler.
  - **resize:** `SIGWINCH` on Unix / 250 ms polling on Windows; debounced 50 ms; sends channel 3 JSON `{cols, rows}`.

**`exec` mode:**
- No raw mode unless `-t` is passed and `process.stdin.isTTY` is true.
- `-i`: `process.stdin` data → channel 0; `stdin 'end'` event → `control:stdin_eof` on channel 4.
- Without `-i`: stdin is not read (safe for CI).
- Stdout and stderr arrive on separate channels and are written to the correct local descriptors.

**Keepalive:** ping sent every **20 seconds**. If no pong or data is received for **60 seconds**, the connection is considered lost.

### 5.6 Session end

| Event | Behaviour |
|---|---|
| `control:exit { exit_code }` | Restore terminal → `process.exit(exit_code)` |
| `control:kill { reason }` | Print `[devpanel] Session terminated: <reason>` → exit 255 |
| `control:warn { message }` | Print `[devpanel] <message>` on stderr; continue |
| `control:error { code }` | Map code (§7.3), print error → exit 255 |
| WebSocket `close` (unexpected) | Print `Connection lost. The session has ended.` → exit 255 |
| Ping timeout | Same as unexpected close |

On exit, when stderr is a TTY:
```
Session ended (sess_8f2a).
```

---

## 6. WebSocket Frame Format

Each WebSocket binary message:

```
[1 byte: channel][N bytes: payload]    (N ≤ 32 768)
```

Payloads larger than 32 KiB are split into multiple messages (`encodeChunked`). The WebSocket framing itself provides message boundaries — no length prefix is needed.

| Channel | Direction | Payload |
|---|---|---|
| `0` stdin | CLI → relay | raw bytes |
| `1` stdout | relay → CLI | raw bytes |
| `2` stderr | relay → CLI | raw bytes (merged into stdout in TTY mode) |
| `3` resize | CLI → relay | UTF-8 JSON `{"cols":N,"rows":N}` |
| `4` control | both | UTF-8 JSON object with `"type"` field |

Control message types:

| `type` | Direction | Fields |
|---|---|---|
| `ready` | relay → CLI | — |
| `exit` | relay → CLI | `exit_code: number` |
| `warn` | relay → CLI | `message: string` |
| `kill` | relay → CLI | `reason: string` |
| `error` | relay → CLI | `code: string`, `ref_id?: string` |
| `stdin_eof` | CLI → relay | — |

---

## 7. Escape Sequences (`shell` only)

Processed only when the escape character is typed **at the start of a line** (after `\r`, or as the first character of the session). Default escape character: `~`.

| Sequence | Action |
|---|---|
| `~.` | Disconnect immediately (exit 255) |
| `~?` | Print escape sequence help to stderr |
| `~~` | Forward a single `~` to the container |
| `~<other>` | Forward `~<other>` literally |

Disabled with `--escape-char none`.

The escape character state is tracked in `EscapeProcessor` (`src/terminal/escape.ts`). `exec` mode does not process escape sequences.

---

## 8. Gateway Error Codes

Received in `control:error` frames from the Shell Gateway or Tunnel Relay:

| `code` | Message shown to user |
|---|---|
| `ticket_invalid`, `ticket_expired`, `ticket_replayed` | `Session ticket was rejected. Please try again.` |
| `ticket_wrong_cluster`, `namespace_forbidden` | `Access denied by the cluster gateway.` |
| `pod_not_found`, `pod_not_ready` | `No ready instance of this application is available (it may be deploying).` |
| `container_not_found` | `Container not found in the selected instance.` |
| `limit_exceeded` | `Too many open sessions. Close an existing session and try again.` |
| `agent_shutting_down` | `The cluster gateway is restarting. Please retry in a minute.` |
| `exec_failed`, `internal`, other | `Failed to start the session (ref: <ref_id>).` |

If the ticket is rejected **before** `control:ready` is received, the CLI requests a fresh session ticket once and reconnects.

---

## 9. Exit Codes

| Code | Situation |
|---|---|
| `0–254` | Exact exit code of the remote command |
| `255` | CLI-side error: network, auth failure, ticket rejection, timeout, disconnect, `~.`, `kill` |
| `2` | Bad usage: missing argument, invalid flag |

This matches `ssh` behaviour, making `devpanel exec` safe to use in scripts and CI pipelines.

---

## 10. `--debug` Mode

When `--debug` is passed (or `DEVPANEL_DEBUG=1`), each step prints a timestamped line to stderr:

```
[debug] Creating session via API
[debug] POST https://…/sessions (request-id: abc-123)
[debug] POST sessions status=201 elapsed=312ms
[debug] Opening WebSocket to connect.devpanel.com
[debug] WebSocket connection established
[debug] waitForReady: 48ms
[debug] Session ready: sess_8f2a
[debug] control:exit
[debug] WebSocket closed: 1000
```

**Never printed in debug output:** `idToken`, `accessToken`, `refreshToken`, `ticket`. Any string matching the JWT pattern (`eyJ…`) is automatically replaced with `[REDACTED]`.

---

## 11. Terminal Safety

The terminal state is restored under all circumstances:

| Situation | Handled by |
|---|---|
| Normal session end | `ws.on('close')` → `cleanup()` |
| `control:kill` / `control:error` | control handler → `cleanup()` |
| Network loss / ping timeout | `ws.on('error')` / ping timeout → `cleanup()` |
| `~.` escape | stdin handler → `cleanup()` |
| `SIGINT` (Ctrl+C forwarded in raw mode) | — forwarded to container as `\x03` |
| `SIGINT` / `SIGTERM` / `SIGHUP` (process signals) | `src/terminal/raw.ts` signal handlers |
| Uncaught exception | `process.on('uncaughtException')` → restore → exit 255 |

`process.stdin.setRawMode(false)` is called with a try/catch so a failure to restore does not mask the original error.

---

## 12. Source Files

| File | Responsibility |
|---|---|
| `src/commands/shell.ts` | CLI entry — validates TTY, resolves IDs, calls runner |
| `src/commands/exec.ts` | CLI entry — validates args, resolves IDs, calls runner |
| `src/session/api.ts` | POST /sessions, error mapping, token refresh on 401 |
| `src/session/wsconn.ts` | WebSocket open, URL validation, waitForReady, ping/pong |
| `src/session/frame.ts` | encode / decode binary frames |
| `src/session/runner.ts` | Full orchestration: ticket → WS → loop → exit code |
| `src/terminal/raw.ts` | setRawMode, signal handlers, cleanup |
| `src/terminal/resize.ts` | SIGWINCH / polling, debounce, send resize frame |
| `src/terminal/escape.ts` | Escape sequence state machine |
| `src/debug/logger.ts` | Timestamped debug lines, JWT redaction |
| `src/ui/spinner.ts` | Connecting… spinner on stderr |

---

## 13. Out of Scope (this CLI version)

- Connecting directly to customer clusters or reading kubeconfig.
- Step-up MFA (`412` returns a clear message; not handled interactively).
- Reconnect to an existing session after a network drop.
- `devpanel logs -f` and `devpanel port-forward`.
- Fuzzy name resolution (`devpanel shell my-app` by name rather than ID).
- Multi-language error messages (English only).
