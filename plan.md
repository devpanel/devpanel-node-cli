# Plan: lệnh `devpanel shell` và `devpanel exec` cho DevPanel CLI

> File này là đầu vào cho Claude Code. Đọc hết trước khi viết code.
> Phạm vi: **chỉ CLI**. API server, Tunnel Relay và Shell Gateway là các repo khác. File này định nghĩa hợp đồng (contract) mà CLI phải tuân theo khi làm việc với chúng.

---

## 0. Kết quả khảo sát codebase

CLI đã tồn tại, viết bằng **TypeScript**, dùng **`commander`** (không phải Go/cobra). Các phần đã có:

| Thành phần | File | Trạng thái |
|---|---|---|
| Entry point | `src/index.ts` | Có, dùng `commander` |
| Config & credentials | `src/config/store.ts` | Có — đọc/ghi `~/.devpanel/{config,credentials}.json` |
| Auth (PKCE) | `src/auth/pkce.ts`, `src/auth/server.ts` | Có — PKCE OAuth với AWS Cognito |
| Login / Logout | `src/commands/login.ts`, `logout.ts` | Có |
| List resources | `src/commands/list-*.ts` | Có |
| Upload | `src/commands/upload.ts` | Có |

**Viết tiếp bằng TypeScript**, tuân theo các quy ước đang có (xem `CLAUDE.md`).

---

## 1. Bối cảnh

```
devpanel shell <applicationId> --project <projectId> --workspace <workspaceId>

 CLI ─① POST .../sessions (Bearer idToken)──► API server ──► Vault ký ticket
  ◄──────────── { sessionId, ticket, connectUrl, expiresAt } ──┘
 CLI ─② WSS connectUrl (Authorization: Bearer <ticket>) ──► Tunnel Relay (Production)
                                       relay redeem ticket, mở stream qua tunnel
                                                    ══► Shell Gateway (Client cluster)
                                                          verify ticket, pods/exec ──► container
 CLI ◄── control:ready ── … ⇄ stdin/stdout ⇄ … ◄── control:exit {exit_code}
```

Việc của CLI gồm:
1. Gọi API xin ticket.
2. Mở WebSocket tới `connectUrl` bằng ticket.
3. Chuyển terminal sang raw mode và chuyển dữ liệu hai chiều.
4. Khôi phục terminal và thoát với đúng exit code của lệnh trong container.

**CLI không bao giờ** kết nối tới cluster của khách, không giữ kubeconfig, và không tự đọc nội dung ticket.

---

## 2. Nguyên tắc bảo mật (bắt buộc)

1. **`idToken` chỉ gửi tới API.** Không gửi `idToken` tới relay. WebSocket chỉ dùng ticket.
2. **Ticket chỉ nằm trong bộ nhớ:**
   - không ghi ra đĩa, không ghi log (kể cả khi bật `--debug`);
   - **không đặt trong URL hay query string**, chỉ gửi qua header `Authorization`;
   - mỗi ticket chỉ dùng một lần; kết nối thất bại thì xin ticket mới.
3. **Credentials lưu trong file** `~/.devpanel/credentials.json` với quyền `0600` (đã thực hiện trong `config/store.ts`). Không thêm keychain dependency — tránh native build issue khi cài bằng npm.
4. **Luôn kiểm tra TLS.** Hỗ trợ `HTTPS_PROXY`/`NO_PROXY` qua biến môi trường (Node.js `fetch` và thư viện `ws` tôn trọng các biến này).
5. **Kiểm tra `connectUrl`** do API trả về: phải dùng scheme `wss://`, và host phải khớp hậu tố trong `allowedConnectHosts` của config (mặc định `[".<domain>"]`). Không khớp thì từ chối kết nối.
6. **Luôn khôi phục terminal** trong mọi tình huống: thoát bình thường, lỗi, `uncaughtException`, SIGINT, SIGTERM, SIGHUP.
7. Không in chi tiết nội bộ (stack trace, body lỗi gốc) ra màn hình ở chế độ thường. Chỉ in khi bật `--debug`, và vẫn phải che ticket và `idToken`.

---

## 3. Các lệnh

### 3.1 Lệnh chính

```
devpanel shell <applicationId> [--project <projectId>] [--workspace <workspaceId>]
               [--container <name>] [--pod <name>] [--debug]

devpanel exec  <applicationId> [--project <projectId>] [--workspace <workspaceId>]
               [--container <name>] [--pod <name>] [-t|--tty] [-i|--stdin] [--debug]
               -- <command> [args...]
```

| Cờ | Mô tả |
|---|---|
| `--workspace` | Ghi đè workspace mặc định trong config |
| `--project` | Ghi đè project mặc định |
| `--container` | Container đích. Bỏ trống thì API chọn container mặc định của application |
| `--pod` | Chỉ định pod cụ thể (dùng khi debug). Bỏ trống thì Shell Gateway tự chọn pod Ready |
| `-t, --tty` | (`exec`) Cấp TTY. Mặc định là tắt |
| `-i, --stdin` | (`exec`) Chuyển stdin của máy local vào lệnh. Mặc định là tắt |
| `--debug` | In thời gian của từng bước, `sessionId` và request ID ra stderr (đã che ticket và token) |

**Thứ tự ưu tiên khi xác định workspace và project:** cờ dòng lệnh > `DEVPANEL_WORKSPACE`/`DEVPANEL_PROJECT` > `~/.devpanel/config.json`

---

## 4. Config

- Đường dẫn: `~/.devpanel/config.json` (tất cả hệ điều hành, theo quy ước đang có).
- Cấu trúc:
```json
{
  "apiUrl": "https://console.devpanel.com/api/v2",
  "cognitoDomain": "login.site.devpanel.com",
  "cognitoClientId": "...",
  "allowedConnectHosts": [".devpanel.com"],
  "current": {
    "workspace": "ws_123",
    "project": "prj_456"
  }
}
```
- Biến môi trường: `DEVPANEL_API_URL`, `DEVPANEL_COGNITO_DOMAIN`, `DEVPANEL_COGNITO_CLIENT_ID`, `DEVPANEL_WORKSPACE`, `DEVPANEL_PROJECT`, `DEVPANEL_DEBUG=1`.
- **File config không chứa token.**
- Thứ tự ưu tiên đọc (cao nhất thắng): `constants.ts` → `~/.devpanel/config.json` → biến môi trường (giống `config/store.ts` hiện tại, chỉ bổ sung các trường mới).

---

## 5. Xác thực

### 5.1 PKCE OAuth (đã có)

Luồng login hiện tại (`src/commands/login.ts`) dùng PKCE với AWS Cognito — **không thay đổi**. Kết quả lưu vào `~/.devpanel/credentials.json`:

```json
{
  "idToken": "eyJ…",
  "accessToken": "eyJ…",
  "refreshToken": "eyJ…",
  "expiresAt": 1234567890000,
  "email": "user@example.com"
}
```

### 5.2 Làm mới token

Khi `isTokenExpired(creds)` trả `true` **hoặc** API trả `401`:

1. POST tới `https://{cognitoDomain}/oauth2/token` với `grant_type=refresh_token`, `client_id` và `refresh_token`.
2. Lưu `idToken`, `accessToken`, `expiresAt` mới vào credentials.
3. Thử lại request gốc **một lần**. Vẫn `401` → báo người dùng chạy `devpanel login`.

```ts
// src/auth/refresh.ts
export async function refreshTokens(creds: Credentials): Promise<Credentials | null>
```

### 5.3 Gọi API

- Header: `Authorization: Bearer <idToken>`, `User-Agent: devpanel-cli/<version> (<platform>/<arch>)`, `X-Request-Id: <uuid>`.
- Dùng `crypto.randomUUID()` (Node ≥ 18) để tạo request ID.

---

## 6. Xin phiên từ API

### 6.1 Request

```
POST /workspaces/:workspaceId/projects/:projectId/applications/:applicationId/sessions
Content-Type: application/json
```
```json
{ "type": "shell", "container": "php", "pod": null, "tty": true, "cols": 120, "rows": 40, "term": "xterm-256color" }
{ "type": "exec",  "container": "php", "pod": null, "tty": false, "command": ["drush","cr"] }
```
- `cols`/`rows` lấy từ `process.stdout.columns` / `process.stdout.rows`. Không có TTY thì bỏ hai trường này.
- `term` lấy từ `process.env.TERM`. Không có thì dùng `xterm-256color`.

### 6.2 Response `201`

```json
{ "sessionId": "sess_8f2a", "ticket": "eyJ…", "connectUrl": "wss://connect.<domain>/v1/sessions/sess_8f2a", "expiresAt": "2026-11-22T09:00:60Z" }
```

### 6.3 Xử lý lỗi (in tiếng Anh, ngắn gọn, có hướng xử lý)

| HTTP / code | Thông báo |
|---|---|
| `400` | `Invalid request: <message from API>` |
| `401` | Làm mới token một lần. Vẫn lỗi: `Your session has expired. Run "devpanel login".` |
| `403 forbidden` | `You don't have shell access to this application. Ask a workspace admin to grant the "shell" permission.` |
| `403 shell_disabled` | `Shell access is disabled for this workspace.` |
| `404` | `Application <id> not found in project <id> / workspace <id>.` |
| `409 container_not_found` | `Container "<name>" not found. Available: <list if API returns it>.` |
| `412 mfa_required` | `MFA is required for this action. This CLI version doesn't support it yet.` |
| `426` | `This CLI version is no longer supported. Please upgrade.` |
| `429` | `Too many requests. Try again in <Retry-After>s.` |
| `503 agent_disconnected` | `The cluster for this application is not reachable right now. Your application is still running; only shell access is affected.` |
| `5xx` khác / lỗi mạng | `DevPanel API is unavailable (request id: <id>).` |

---

## 7. Kết nối WebSocket tới Tunnel Relay

- Kiểm tra `connectUrl` theo nguyên tắc 2.5.
- `new Date(expiresAt).getTime() - Date.now() < 5000` thì xin ticket mới, **tối đa 1 lần**.
- Header gửi kèm:
  - `Authorization: Bearer <ticket>`
  - `Sec-WebSocket-Protocol: devpanel.shell.v1`
  - `User-Agent` và `X-Request-Id`
- Thư viện: **`ws`** npm package (`npm install ws`; types: `@types/ws`). Truyền `headers` vào constructor của `WebSocket`.
- Timeout kết nối 10 giây (dùng `AbortSignal.timeout(10_000)`). Sau khi kết nối, chờ frame `control:ready` **tối đa 15 giây**.
- Nếu relay đóng kết nối trước khi gửi `ready`, đọc frame `control:error` (nếu có) và hiển thị theo mục 9.3.
- **Ping mỗi 20 giây** (`ws.ping()`). Quá 60 giây không nhận được pong hoặc dữ liệu thì coi như mất kết nối.
- Hiện spinner `Connecting to <applicationId> (<container>)…` trên stderr. Tắt spinner khi `process.stderr.isTTY` là `false`.

---

## 8. Định dạng message trên WebSocket (CLI ↔ Relay)

Mỗi WebSocket **binary message** là một frame: `[1 byte channel][payload]`. Không cần trường độ dài, vì WebSocket đã tự phân tách từng message. Payload tối đa 32 KiB. Dữ liệu dài hơn thì chia thành nhiều message.

| channel | Chiều | Payload |
|---|---|---|
| 0 stdin | CLI → relay | byte thô |
| 1 stdout | relay → CLI | byte thô |
| 2 stderr | relay → CLI | byte thô (chế độ TTY gộp vào stdout) |
| 3 resize | CLI → relay | JSON `{"cols":N,"rows":N}` |
| 4 control | hai chiều | JSON, xem mục 9 |

Ngoài ra, CLI gửi `{"type":"stdin_eof"}` trên channel 4 khi stdin local kết thúc (dùng cho `exec -i`).

> Relay chịu trách nhiệm chuyển đổi giữa định dạng này và định dạng frame có trường độ dài trên tunnel (đặc tả Shell Gateway, mục 6.3). Thay đổi nào ở đây phải được ghi vào `docs/shell/CONTRACT_CHANGES.md`.

Viết phần encode/decode thành module riêng `src/session/frame.ts`, có test đầy đủ.

```ts
// src/session/frame.ts
export const CH_STDIN   = 0;
export const CH_STDOUT  = 1;
export const CH_STDERR  = 2;
export const CH_RESIZE  = 3;
export const CH_CONTROL = 4;

export function encode(channel: number, payload: Buffer | string): Buffer
export function decode(data: Buffer): { channel: number; payload: Buffer }
```

---

## 9. Vòng đời phiên

### 9.1 Phiên `shell`

1. **Yêu cầu stdin là TTY.** Nếu `!process.stdin.isTTY`, báo:
```
Error: "devpanel shell" requires an interactive terminal. Use "devpanel exec <app> -- <cmd>" in scripts.
```
2. Khi nhận `ready`, bật **raw mode** bằng `process.stdin.setRawMode(true)`. Lưu trạng thái cũ, và khôi phục trong `finally`, trong signal handler (`SIGINT`, `SIGTERM`, `SIGHUP`), và trong `process.on('uncaughtException')`.
3. Chạy song song ba luồng bất đồng bộ, tất cả dừng qua một `AbortController` chung:
   - **stdin → WS:** `process.stdin.on('data', ...)` → gửi channel 0, và xử lý escape sequence (9.4).
   - **WS → stdout/stderr:** nhận message → ghi channel 1 ra `process.stdout`, channel 2 ra `process.stderr`, xử lý message control.
   - **resize:** `process.on('SIGWINCH', ...)` trên Unix; polling `process.stdout.columns/rows` mỗi 250ms trên Windows. Chỉ gửi khi kích thước thay đổi, gom các thay đổi liên tiếp trong 50ms thành một lần gửi (`setTimeout` debounce).
4. Ctrl+C và Ctrl+Z ở raw mode **được gửi vào container** như ký tự bình thường (`\x03`, `\x1a`), không làm thoát CLI.

### 9.2 Message control nhận từ relay

| `type` | Xử lý |
|---|---|
| `ready` | Tắt spinner, bật raw mode, bắt đầu chuyển dữ liệu |
| `warn` | In ra stderr trên một dòng riêng: `\r\n[devpanel] <message>\r\n` (raw mode nên phải có `\r`) |
| `exit` | Lưu `exit_code`, đóng WebSocket, khôi phục terminal, thoát |
| `kill` | In `\r\n[devpanel] Session terminated: <reason>\r\n`, rồi thoát với mã 255 |
| `error` | Hiển thị theo bảng 9.3, rồi thoát với mã 255 |

### 9.3 Mã lỗi từ Shell Gateway và relay

| code | Thông báo |
|---|---|
| `ticket_invalid`, `ticket_expired`, `ticket_replayed` | `Session ticket was rejected. Please try again.` (xin ticket mới **một lần** nếu chưa nhận `ready`) |
| `ticket_wrong_cluster`, `namespace_forbidden` | `Access denied by the cluster gateway.` |
| `pod_not_found`, `pod_not_ready` | `No ready instance of this application is available (it may be deploying).` |
| `container_not_found` | `Container not found in the selected instance.` |
| `limit_exceeded` | `Too many open sessions. Close an existing session and try again.` |
| `agent_shutting_down` | `The cluster gateway is restarting. Please retry in a minute.` |
| `exec_failed`, `internal`, khác | `Failed to start the session (ref: <ref_id>).` |

### 9.4 Escape sequence (giống ssh)

Chỉ có tác dụng khi ký tự `~` được gõ **ngay đầu dòng** (sau Enter `\r`, hoặc là phím đầu tiên của phiên):
- `~.`: ngắt phiên ngay lập tức (thoát với mã 255).
- `~?`: in danh sách escape sequence.
- `~~`: gửi một ký tự `~` thật.

Có cờ `--escape-char none` để tắt tính năng này.

### 9.5 Kết thúc phiên

- Khi kết thúc, in ra stderr (chỉ khi `process.stderr.isTTY`):
```
Session ended (sess_8f2a).
```
- **Mất kết nối giữa phiên:** khôi phục terminal, rồi in:
```
Connection lost. The session has ended. Tip: run long tasks inside tmux.
```

---

## 10. Phiên `exec`

- Mặc định **không TTY**: stdout và stderr đi trên hai channel riêng, ghi đúng ra `process.stdout` và `process.stderr`, nên script vẫn tách được hai luồng.
- `-t`: cấp TTY và bật raw mode **chỉ khi** `process.stdin.isTTY` là `true`. Nếu không, bỏ qua và in cảnh báo.
- `-i`: chuyển stdin local vào lệnh, rồi gửi `stdin_eof` khi `process.stdin` phát sự kiện `'end'`. Khi có `-i`, cảnh báo nếu stdin quá 10 MiB:
```
Warning: large stdin over the shell tunnel is slow. Use "devpanel upload" for files.
```
- Không có `-i` thì không đọc stdin, để lệnh không bị treo trong CI.
- **Phải có `--`** để tách cờ của CLI khỏi lệnh. Thiếu lệnh thì báo lỗi cách dùng.

---

## 11. Exit code

| Tình huống | Exit code |
|---|---|
| Lệnh trong container kết thúc | **Đúng exit code của lệnh đó** (0–255) |
| Lỗi của CLI: mạng, xác thực, API, ticket, mất kết nối, `~.`, bị kill | **255** (giống ssh) |
| Sai cú pháp lệnh (commander) | 2 |

Dùng `process.exit(code)` **sau khi** đã khôi phục terminal.

---

## 12. Chế độ `--debug`

In ra stderr, mỗi dòng có tiền tố `[debug]`:
- Thời gian (`Date.now()`) của từng bước: đọc config, lấy token, request tạo phiên, mở WebSocket, chờ `ready`.
- `sessionId`, `X-Request-Id`, status code, host của `connectUrl` (không in path nếu có ticket).
- Các message control nhận được (trừ nội dung stdin/stdout).

**Không bao giờ in** ticket, `idToken`, `accessToken`, `refreshToken` hay nội dung phiên. Viết test kiểm tra đầu ra của `--debug` không chứa chuỗi ticket.

---

## 13. Cấu trúc code (TypeScript, theo quy ước dự án)

```
src/
├── index.ts                        # entry point — đăng ký lệnh shell, exec
├── constants.ts                    # giá trị mặc định (đã có)
├── auth/
│   ├── pkce.ts                     # (đã có)
│   ├── server.ts                   # (đã có)
│   └── refresh.ts                  # MỚI: làm mới idToken bằng refreshToken
├── config/
│   └── store.ts                    # (đã có) — bổ sung allowedConnectHosts, current.workspace/project
├── session/
│   ├── frame.ts                    # MỚI: encode/decode binary frame theo channel
│   ├── api.ts                      # MỚI: POST sessions, ánh xạ lỗi HTTP → thông báo
│   ├── wsconn.ts                   # MỚI: mở WebSocket, ping/pong, timeout, kiểm tra connectUrl
│   └── runner.ts                   # MỚI: điều phối toàn bộ: ticket → kết nối → chuyển dữ liệu → exit code
├── terminal/
│   ├── raw.ts                      # MỚI: setRawMode, khôi phục, signal handler
│   ├── resize.ts                   # MỚI: SIGWINCH (Unix) + polling (Windows), debounce
│   └── escape.ts                   # MỚI: escape sequence ~. ~? ~~
├── ui/
│   └── spinner.ts                  # MỚI: spinner stderr-only, tắt khi không phải TTY
├── debug/
│   └── logger.ts                   # MỚI: in [debug], che ticket/token
└── commands/
    ├── login.ts                    # (đã có)
    ├── logout.ts                   # (đã có)
    ├── profile.ts                  # (đã có)
    ├── config.ts                   # (đã có) — bổ sung workspace/project set
    ├── list-*.ts                   # (đã có)
    ├── upload.ts                   # (đã có)
    ├── shell.ts                    # MỚI: devpanel shell
    └── exec.ts                     # MỚI: devpanel exec
```

---

## 14. Yêu cầu test

Thêm **Jest** (`npm install -D jest ts-jest @types/jest`) làm test runner.

**Unit test**
- `session/frame.ts`: encode/decode từng channel, payload rỗng, payload đúng 32 KiB, message hỏng, channel không tồn tại.
- `config/store.ts`: thứ tự ưu tiên constants → config.json → env, thiếu workspace hoặc project.
- `session/api.ts`: ánh xạ toàn bộ bảng lỗi 6.3; tự làm mới token khi gặp `401` (đúng một lần).
- `session/wsconn.ts`: từ chối `connectUrl` dạng `ws://`, host không khớp allowlist; ticket gửi trong header, **không có trong URL**.
- `terminal/escape.ts`: `~.` ở đầu dòng ngắt phiên, `~.` ở giữa dòng thì không, `~~` gửi một dấu `~`, `--escape-char none` tắt hẳn.
- `debug/logger.ts`: đầu ra không chứa ticket hay token.

**Test tích hợp** (dùng `ws` server giả lập trong cùng process Jest)
- Phiên `shell` đầy đủ: ready → gửi `echo hi` → nhận output → `exit 3` → CLI thoát với mã **3**.
- `exec -- false` trả 1; `exec -- sh -c 'echo out; echo err >&2'` tách đúng stdout và stderr.
- `exec -i` chuyển stdin và gửi `stdin_eof`.
- Relay trả `error: pod_not_ready` → đúng thông báo, mã 255.
- Ticket hết hạn trước khi kết nối → xin ticket mới đúng một lần.
- Không nhận `ready` sau 15 giây → timeout, mã 255.
- Mất kết nối giữa phiên → terminal được khôi phục, mã 255.
- Nhận `warn` và `kill` → in đúng thông báo.
- Resize được gửi đi, và các thay đổi liên tiếp được gom lại (debounce 50ms).

**CI:** `npm run build && npm test -- --forceExit`, chạy trên `ubuntu-latest` và `macos-latest`.

---

## 15. Phát hành (giai đoạn cuối)

- Publish lên npm: `npm publish --access public` (package `@devpanel/cli`).
- `prepublishOnly` đã chạy `npm run build` (đã có trong `package.json`).
- Cần cập nhật `version` trong `package.json` và `src/index.ts` trước mỗi lần publish.
- Kiểm tra phiên bản mới (tùy chọn, tối đa mỗi 24 giờ một lần, tắt được bằng `DEVPANEL_NO_UPDATE_CHECK=1`).

---

## 16. Thứ tự thực hiện cho Claude Code

Mỗi giai đoạn phải có test chạy xanh. Sau mỗi giai đoạn, dừng lại và tóm tắt cho tôi rồi mới làm tiếp.

1. **Khảo sát** (mục 0). ✅ Đã hoàn thành — CLI TypeScript với `commander`.
2. **Nền móng bổ sung:** `auth/refresh.ts`, bổ sung `allowedConnectHosts`/`current` vào `config/store.ts`, `ui/spinner.ts`, `debug/logger.ts`. Thêm Jest.
3. **`session/frame.ts` + test.** Viết test trước.
4. **`session/api.ts`:** POST sessions, ánh xạ lỗi, làm mới token khi `401`.
5. **`session/wsconn.ts`:** mở WebSocket, kiểm tra `connectUrl`, ping/pong, timeout.
6. **`session/runner.ts` + `terminal/`:** raw mode, khôi phục, resize, escape sequence.
7. **Lệnh `shell`** (`src/commands/shell.ts`), kèm toàn bộ test tích hợp.
8. **Lệnh `exec`** (`src/commands/exec.ts`) với `-t`, `-i`, tách stdout/stderr.
9. **`--debug`**, hoàn thiện thông báo lỗi, `docs/shell/USAGE.md`.
10. **Phát hành:** cập nhật version, publish npm.

---

## 17. Ngoài phạm vi

- API server, Tunnel Relay, Shell Gateway, WebUI.
- Dùng tên thay cho ID (`devpanel shell my-app`). Để sau, cần API hỗ trợ tìm theo tên.
- Step-up MFA (chỉ xử lý thông báo cho `412`).
- `devpanel logs -f`, `devpanel port-forward`.
- Kết nối lại vào phiên cũ sau khi rớt mạng.
- Giao diện đa ngôn ngữ (thông báo chỉ bằng tiếng Anh).

---

## 18. Quy tắc khi gặp điểm chưa rõ

- **Liên quan đến bảo mật** (mục 2, 5, 7, 12): **không tự đoán**. Dừng lại và hỏi.
- Khác quy ước codebase hiện có: theo codebase, rồi ghi vào `docs/shell/ASSUMPTIONS.md`.
- Thay đổi hợp đồng với API hoặc relay: ghi vào `docs/shell/CONTRACT_CHANGES.md`.

---

## 19. Placeholder cần thay

`<domain>`, `apiUrl` mặc định trong `constants.ts`, `allowedConnectHosts` mặc định, trang `/device` của WebUI (nếu dùng cho Device flow sau này), tiền tố PAT.
