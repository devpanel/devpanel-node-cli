# DevPanel CLI

Command-line interface for [DevPanel](https://devpanel.com) — manage workspaces, projects, applications, and open interactive shells directly from your terminal.

## Installation

```bash
npm install -g @devpanel/cli
```

Or install from source:

```bash
git clone <repo>
cd cli
npm install
npm run build
npm install -g .
```

Requires **Node.js ≥ 18**.

## Quick Start

```bash
# 1. Log in
devpanel login

# 2. Set your default workspace and project (saves to ~/.devpanel/config.json)
devpanel config --workspace ws_abc123 --project prj_xyz456

# 3. Open a shell
devpanel shell <applicationId>

# 4. Run a one-off command
devpanel exec <applicationId> -- drush cr
```

## Commands

### Authentication

```bash
devpanel login       # Open browser for SSO login (PKCE OAuth)
devpanel logout      # Remove stored credentials
devpanel profile     # Show your account info
```

### Configuration

```bash
devpanel config                              # Show current config
devpanel config --workspace <workspaceId>    # Set default workspace
devpanel config --project <projectId>        # Set default project
devpanel config --apiUrl <url>               # Override API URL (self-hosted)
```

Config is stored in `~/.devpanel/config.json`. You can also use environment variables (see below).

### Listing Resources

```bash
devpanel list workspaces
devpanel list templates

devpanel list projects   -w <workspaceId>
devpanel list applications -w <workspaceId> [--status deployed|paused|all]
```

All list commands support `-s <number>` to control page size.

### File Upload

```bash
devpanel upload <file> -w <workspaceId> -p <projectId> -a <applicationId>
```

Uploads a file to `$APP_ROOT` inside the application container via a presigned S3 URL.

### Interactive Shell

```bash
devpanel shell <applicationId> [options]
```

Opens a fully interactive terminal session in an application container.

| Option | Description |
|---|---|
| `-w, --workspace <id>` | Workspace ID (overrides config) |
| `-p, --project <id>` | Project ID (overrides config) |
| `--container <name>` | Target container (default: primary container) |
| `--pod <name>` | Target specific pod (useful for debugging) |
| `--escape-char <char>` | Escape character (default: `~`, use `none` to disable) |
| `--debug` | Print timing and session info to stderr |

**Escape sequences** (type at the start of a line):

| Sequence | Action |
|---|---|
| `~.` | Disconnect immediately |
| `~?` | Show escape sequence help |
| `~~` | Send a literal `~` |

### Run a Command (non-interactive)

```bash
devpanel exec <applicationId> [options] -- <command> [args...]
```

Runs a command in a container and exits with its exit code. Stdout and stderr are streamed separately, so the output is scriptable.

| Option | Description |
|---|---|
| `-w, --workspace <id>` | Workspace ID (overrides config) |
| `-p, --project <id>` | Project ID (overrides config) |
| `--container <name>` | Target container |
| `--pod <name>` | Target specific pod |
| `-t, --tty` | Allocate a TTY (requires interactive terminal) |
| `-i, --stdin` | Pass local stdin to the command |
| `--debug` | Print timing and session info to stderr |

Examples:

```bash
# Clear Drupal cache
devpanel exec myapp -- drush cr

# Run with stdin piped in
echo "SELECT 1" | devpanel exec myapp -i -- mysql -u root

# Interactive command with TTY
devpanel exec myapp -t -- bash
```

## Environment Variables

| Variable | Description |
|---|---|
| `DEVPANEL_API_URL` | Override API base URL |
| `DEVPANEL_COGNITO_DOMAIN` | Override Cognito hosted UI domain |
| `DEVPANEL_COGNITO_CLIENT_ID` | Override Cognito client ID |
| `DEVPANEL_WORKSPACE` | Default workspace ID |
| `DEVPANEL_PROJECT` | Default project ID |
| `DEVPANEL_DEBUG=1` | Enable debug output |

**Priority order (highest wins):** CLI flag > environment variable > `~/.devpanel/config.json` > built-in defaults.

## Exit Codes

| Code | Meaning |
|---|---|
| `0–254` | Exit code of the remote command |
| `255` | CLI error (network, auth, timeout, disconnect) |
| `2` | Bad usage / missing argument |

This matches the behaviour of `ssh`, so `devpanel exec` is safe to use in CI scripts.

## Security

- Authentication uses **PKCE OAuth** — no client secret is embedded in the binary.
- Credentials are stored in `~/.devpanel/credentials.json` with mode `0600`.
- Shell sessions use a short-lived **ticket** that is only sent in the `Authorization` header — never in the URL.
- The `--debug` flag redacts all tokens from output automatically.
- `connectUrl` is validated against an allowlist before the WebSocket is opened.

## Development

```bash
npm install
npm run dev        # ts-node (uses local .env for config overrides)
npm run build      # compile to dist/
npm test           # run unit tests (Jest)
npm run lint       # ESLint
npm run format     # Prettier
```

Create a `.env` file in the project root for local development:

```env
DEVPANEL_API_URL=http://localhost/api/v2
DEVPANEL_COGNITO_DOMAIN=login.site.devpanel.com
DEVPANEL_COGNITO_CLIENT_ID=your-client-id
```

## License

MIT
