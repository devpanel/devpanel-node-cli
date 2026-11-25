# CLAUDE.md — DevPanel CLI

TypeScript CLI (`devpanel`) distributed via npm. Runtime dependencies: `commander`, `open`, `ws`. All auth is PKCE OAuth with AWS Cognito — no client secret.

## Commands

```bash
npm run build      # tsc → dist/
npm run dev        # ts-node src/index.ts (uses local .env)
npm test           # jest --forceExit (unit tests only)
node dist/index.js # run compiled output directly
npm install -g .   # install globally as 'devpanel'
```

## File Map

```
src/
├── index.ts                        # entry point — registers all commands, loads .env silently
├── constants.ts                    # production defaults + CLI_VERSION
├── auth/
│   ├── pkce.ts                     # PKCE helpers: generatePkce, buildAuthUrl, exchangeCodeForTokens, decodeIdTokenPayload
│   ├── server.ts                   # one-shot local HTTP server: findFreePort, waitForCallback
│   └── refresh.ts                  # refreshTokens(creds) — POST Cognito /oauth2/token with refresh_token
├── config/
│   └── store.ts                    # ~/.devpanel/ read/write: loadConfig, loadCredentials, saveCredentials,
│                                   #   clearCredentials, isTokenExpired, saveCurrentContext,
│                                   #   resolveWorkspace, resolveProject
├── debug/
│   └── logger.ts                   # debug(msg), debugTiming(label, startMs) — redacts JWTs automatically
├── ui/
│   └── spinner.ts                  # startSpinner(message) → { stop() } — no-op when stderr is not TTY
├── session/
│   ├── frame.ts                    # encode/decode binary WebSocket frames: CH_STDIN/STDOUT/STDERR/RESIZE/CONTROL
│   ├── api.ts                      # createSession(), getAuthenticatedCreds() — maps all HTTP errors to messages
│   ├── wsconn.ts                   # validateConnectUrl(), openWebSocket(), waitForReady(), setupPingPong()
│   └── runner.ts                   # runSession(opts) — full orchestration: ticket → WS → loop → exit code
├── terminal/
│   ├── raw.ts                      # enableRawMode(), disableRawMode(), onCleanup() — restores on SIGINT/SIGTERM/SIGHUP
│   ├── resize.ts                   # watchResize(send) — SIGWINCH on Unix, polling on Windows, 50ms debounce
│   └── escape.ts                   # EscapeProcessor — handles ~. ~? ~~ at start of line
└── commands/
    ├── login.ts                    # devpanel login — PKCE flow, opens browser, saves tokens
    ├── logout.ts                   # devpanel logout — clears ~/.devpanel/credentials.json
    ├── profile.ts                  # devpanel profile — GET /users/profile
    ├── config.ts                   # devpanel config [--workspace] [--project] [--apiUrl] …
    ├── list-workspaces.ts          # devpanel list workspaces
    ├── list-projects.ts            # devpanel list projects -w <workspaceId>
    ├── list-templates.ts           # devpanel list templates
    ├── list-applications.ts        # devpanel list applications -w <workspaceId>
    ├── upload.ts                   # devpanel upload <file> -w … -p … -a …
    ├── shell.ts                    # devpanel shell <appId> — interactive TTY shell
    └── exec.ts                     # devpanel exec <appId> -- <cmd> — one-off command
```

## Adding a New Command

1. Create `src/commands/<name>.ts` and export an async `<name>Command()` function.
2. Import and register it in `src/index.ts` using `program.command(...)`.
3. Run `npm run build`.

Pattern every command follows:
```ts
import { loadConfig, resolveWorkspace, resolveProject } from '../config/store';
import { getAuthenticatedCreds } from '../session/api';

export async function myCommand(appId: string, opts: { workspace?: string; project?: string }): Promise<void> {
  const cfg = loadConfig();
  const workspaceId = resolveWorkspace(opts.workspace);
  const projectId   = resolveProject(opts.project);
  const creds = await getAuthenticatedCreds(cfg); // auto-refreshes token; throws if not logged in
  const res = await fetch(`${cfg.apiUrl}/some-path`, {
    headers: { Authorization: `Bearer ${creds.idToken}` },
  });
  // ...
}
```

## Auth Flow (`devpanel login`)

1. `findFreePort(9876)` — finds a free local port
2. `generatePkce()` — creates `codeVerifier` + `codeChallenge` (SHA-256/base64url)
3. `buildAuthUrl(...)` — Cognito Hosted UI URL with PKCE params
4. `open(authUrl)` — opens default browser
5. `waitForCallback(port, state)` — local HTTP server listens on `http://localhost:{port}/callback`
6. `exchangeCodeForTokens(...)` — POST to `https://{cognitoDomain}/oauth2/token`
7. `decodeIdTokenPayload(idToken)` — extracts `email` from JWT (no verification needed here)
8. `saveCredentials(...)` — writes `~/.devpanel/credentials.json` (mode 0600)

## Token Refresh

`getAuthenticatedCreds(cfg)` checks `isTokenExpired` and calls `refreshTokens(creds, cfg)` automatically before any API call. On `401` from an API, `createSession()` also retries once after refreshing. If refresh fails, the user is prompted to run `devpanel login`.

## Shell / Exec Flow

```
devpanel shell <appId>  →  POST /sessions (Bearer idToken)
                        →  validate connectUrl (must be wss://, host in allowedConnectHosts)
                        →  WebSocket with Authorization: Bearer <ticket>  (ticket never in URL)
                        →  wait control:ready  →  raw mode + stdin/stdout loop
                        →  control:exit { exit_code }  →  restore terminal  →  process.exit(code)
```

Key invariants:
- `idToken` only goes to the API. The WebSocket uses a short-lived `ticket` only.
- Ticket is kept in memory only — never written to disk or logged.
- Terminal is always restored: normal exit, error, SIGINT, SIGTERM, SIGHUP, `uncaughtException`.
- `--debug` output redacts all JWTs automatically (`eyJ…` → `[REDACTED]`).

## Config Resolution Order (highest wins)

```
constants.ts (baked-in production values)
  → ~/.devpanel/config.json  (written by `devpanel config`)
    → env vars: DEVPANEL_API_URL, DEVPANEL_COGNITO_DOMAIN, DEVPANEL_COGNITO_CLIENT_ID,
                DEVPANEL_WORKSPACE, DEVPANEL_PROJECT
```

`resolveWorkspace(flag?)` and `resolveProject(flag?)` apply this order: CLI flag > env var > config file.

## Config File (`~/.devpanel/config.json`)

```json
{
  "apiUrl": "https://console.devpanel.com/api/v2",
  "cognitoDomain": "login.site.devpanel.com",
  "cognitoClientId": "...",
  "allowedConnectHosts": [".devpanel.com"],
  "current": {
    "workspace": "ws_123",
    "project":   "prj_456"
  }
}
```

## Credentials File (`~/.devpanel/credentials.json`)

```json
{
  "idToken":      "eyJ…",
  "accessToken":  "eyJ…",
  "refreshToken": "eyJ…",
  "expiresAt":    1234567890000,
  "email":        "user@example.com"
}
```

`isTokenExpired` checks `expiresAt - 60s`. Stored with mode `0600`.

## Local Dev `.env`

```env
DEVPANEL_API_URL=http://localhost/api/v2
DEVPANEL_COGNITO_DOMAIN=login.site.devpanel.com
DEVPANEL_COGNITO_CLIENT_ID=6vs705tbkogckspnlo5iq3o00s
```

Loaded by an inline parser in `index.ts` (no dotenv package). Only sets keys not already in `process.env`. Silent if file absent.

## API Conventions

- Base URL: `loadConfig().apiUrl`
- Auth: `Authorization: Bearer {idToken}` on every request
- Extra headers: `User-Agent: devpanel-cli/<version> (<platform>/<arch>)`, `X-Request-Id: <uuid>`
- List endpoints return `{ data: T[], total: number }`
- Session endpoint: `POST /workspaces/:wId/projects/:pId/applications/:aId/sessions`
- Table output uses fixed-width `col(str, width)` helper — truncates at column width, pads with spaces

## WebSocket Frame Format

Each binary message: `[1 byte channel][payload]`. Max payload 32 KiB; larger data is split by `encodeChunked`.

| channel | direction | content |
|---------|-----------|---------|
| 0 stdin | CLI→relay | raw bytes |
| 1 stdout | relay→CLI | raw bytes |
| 2 stderr | relay→CLI | raw bytes |
| 3 resize | CLI→relay | `{"cols":N,"rows":N}` |
| 4 control | both | JSON — `ready`, `exit`, `warn`, `kill`, `error`, `stdin_eof` |

## Key Decisions

- **PKCE only** — no client secret; safe to ship in a public npm package
- **No dotenv package** — inline parser avoids v18's default console output
- **No keychain dependency** — credentials in `~/.devpanel/credentials.json` (mode 0600) to avoid native build issues on npm install
- **`open` v8** — last CommonJS-compatible version; v9+ is ESM-only
- **`ws` package** — WebSocket client for shell/exec; passes headers for ticket auth
- **Node ≥ 18** — uses native `fetch`, `crypto.randomUUID()`, `crypto.randomBytes`, `Buffer.from(..., 'base64url')`
- **`devpanel config`** — only needed for self-hosted DevPanel instances or to set default workspace/project
