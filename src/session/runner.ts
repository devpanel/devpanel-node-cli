import WebSocket from 'ws';
import crypto from 'crypto';
import { CliConfig, Credentials } from '../config/store';
import { debug, debugTiming } from '../debug/logger';
import { startSpinner } from '../ui/spinner';
import {
  CH_CONTROL,
  CH_RESIZE,
  CH_STDIN,
  CH_STDOUT,
  CH_STDERR,
  decode,
  encode,
  encodeChunked,
  encodeControl,
  encodeResize,
  decodeControl,
} from './frame';
import { createSession, CreateSessionRequest } from './api';
import {
  openWebSocket,
  waitForReady,
  setupPingPong,
  mapGatewayError,
  validateConnectUrl,
} from './wsconn';
import { enableRawMode, disableRawMode } from '../terminal/raw';
import { watchResize } from '../terminal/resize';
import { EscapeProcessor } from '../terminal/escape';

export interface RunnerOptions {
  workspaceId: string;
  projectId: string;
  applicationId: string;
  container?: string;
  pod?: string;
  mode: 'shell' | 'exec';
  tty: boolean;
  command?: string[];
  passStdin: boolean;
  escapeChar: string | null;
  creds: Credentials;
  cfg: CliConfig;
}

const EXIT_CLI_ERROR = 255;

export async function runSession(opts: RunnerOptions): Promise<number> {
  const { creds, cfg } = opts;

  // Build request body
  const request: CreateSessionRequest = {
    type: opts.mode,
    tty: opts.tty,
    container: opts.container,
    pod: opts.pod,
  };

  if (opts.tty) {
    request.cols = process.stdout.columns ?? 80;
    request.rows = process.stdout.rows ?? 24;
    request.term = process.env.TERM ?? 'xterm-256color';
  }

  if (opts.mode === 'exec' && opts.command) {
    request.command = opts.command;
  }

  // Step 1: Create session
  const t0 = Date.now();
  debug('Creating session via API');
  let session = await createSession({
    workspaceId: opts.workspaceId,
    projectId: opts.projectId,
    applicationId: opts.applicationId,
    request,
    creds,
    cfg,
  });
  debugTiming('createSession', t0);

  // Check ticket expiry; request a fresh one if needed (max once)
  const expiresAt = new Date(session.expiresAt).getTime();
  if (expiresAt - Date.now() < 5_000) {
    debug('Ticket near expiry, requesting fresh session');
    session = await createSession({
      workspaceId: opts.workspaceId,
      projectId: opts.projectId,
      applicationId: opts.applicationId,
      request,
      creds,
      cfg,
    });
  }

  // Step 2: Validate and open WebSocket
  validateConnectUrl(session.connectUrl, cfg.allowedConnectHosts);

  const spinner = startSpinner(
    `Connecting to ${opts.applicationId}${opts.container ? ` (${opts.container})` : ''}…`,
  );

  const reqId = crypto.randomUUID();
  let ws: WebSocket;
  try {
    const t1 = Date.now();
    ws = await openWebSocket({
      connectUrl: session.connectUrl,
      ticket: session.ticket,
      requestId: reqId,
      allowedHosts: cfg.allowedConnectHosts,
    });
    debugTiming('openWebSocket', t1);
  } catch (err) {
    spinner.stop();
    throw err;
  }

  // Step 3: Wait for control:ready
  try {
    const t2 = Date.now();
    await waitForReady(ws);
    debugTiming('waitForReady', t2);
  } catch (err) {
    spinner.stop();
    ws.terminate();
    throw err;
  }

  spinner.stop();
  debug(`Session ready: ${session.sessionId}`);

  // Step 4: Run the data loop
  return new Promise<number>((resolve) => {
    let exitCode = EXIT_CLI_ERROR;
    let usingRawMode = false;

    function cleanup(code: number) {
      if (usingRawMode) {
        disableRawMode();
        usingRawMode = false;
      }
      stopPing();
      stopResize();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
      resolve(code);
    }

    // Set up ping/pong keepalive
    const stopPing = setupPingPong(ws, () => {
      if (usingRawMode) {
        process.stderr.write('\r\nConnection lost. The session has ended. Tip: run long tasks inside tmux.\r\n');
      } else {
        process.stderr.write('\nConnection lost. The session has ended. Tip: run long tasks inside tmux.\n');
      }
      cleanup(EXIT_CLI_ERROR);
    });

    // Resize watcher placeholder; will be started after raw mode
    let stopResize: () => void = () => {};

    // Escape sequence processor (only for shell with TTY)
    const escape = new EscapeProcessor(opts.mode === 'shell' ? opts.escapeChar : null);

    // Enable raw mode + stdin → WS forwarding (for shell or exec -t/-i)
    if (opts.tty || opts.passStdin) {
      if (opts.tty) {
        enableRawMode();
        usingRawMode = true;

        // Start resize watcher
        stopResize = watchResize((cols, rows) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encodeResize(cols, rows), { binary: true });
            debug(`resize: ${cols}x${rows}`);
          }
        });
      }

      // stdin → WebSocket
      process.stdin.on('data', (data: Buffer) => {
        const result = escape.process(data);

        if (result.action === 'disconnect') {
          cleanup(EXIT_CLI_ERROR);
          return;
        }

        if (result.action === 'help') {
          if (usingRawMode) {
            process.stderr.write(escape.helpText());
          }
          return;
        }

        if (result.action === 'send' && result.data && ws.readyState === WebSocket.OPEN) {
          for (const frame of encodeChunked(CH_STDIN, result.data)) {
            ws.send(frame, { binary: true });
          }
        }
      });

      process.stdin.on('end', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeControl({ type: 'stdin_eof' }), { binary: true });
        }
      });
    }

    // WS → stdout/stderr + control messages
    ws.on('message', (data: WebSocket.RawData) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      let frame: ReturnType<typeof decode>;
      try {
        frame = decode(buf);
      } catch {
        return; // malformed frame
      }

      switch (frame.channel) {
        case CH_STDOUT:
          process.stdout.write(frame.payload);
          break;

        case CH_STDERR:
          process.stderr.write(frame.payload);
          break;

        case CH_CONTROL:
          handleControlMessage(frame.payload);
          break;
      }
    });

    function handleControlMessage(payload: Buffer) {
      let msg: Record<string, unknown>;
      try {
        msg = decodeControl(payload);
      } catch {
        return;
      }

      const type = msg.type as string;
      debug(`control:${type}`);

      switch (type) {
        case 'warn': {
          const prefix = usingRawMode ? '\r\n' : '\n';
          const suffix = usingRawMode ? '\r\n' : '\n';
          process.stderr.write(`${prefix}[devpanel] ${msg.message as string}${suffix}`);
          break;
        }

        case 'exit': {
          exitCode = typeof msg.exit_code === 'number' ? (msg.exit_code as number) : EXIT_CLI_ERROR;
          ws.close(1000, 'exit');
          break;
        }

        case 'kill': {
          const prefix = usingRawMode ? '\r\n' : '\n';
          const suffix = usingRawMode ? '\r\n' : '\n';
          process.stderr.write(`${prefix}[devpanel] Session terminated: ${msg.reason as string}${suffix}`);
          exitCode = EXIT_CLI_ERROR;
          ws.close(1000, 'kill');
          break;
        }

        case 'error': {
          const code = msg.code as string ?? 'internal';
          const refId = msg.ref_id as string | undefined;
          process.stderr.write(`\nError: ${mapGatewayError(code, refId)}\n`);
          exitCode = EXIT_CLI_ERROR;
          ws.close(1000, 'error');
          break;
        }
      }
    }

    ws.on('close', (code, reason) => {
      debug(`WebSocket closed: ${code} ${reason.toString()}`);

      if (usingRawMode && process.stderr.isTTY) {
        process.stderr.write(`\r\nSession ended (${session.sessionId}).\r\n`);
      } else if (process.stderr.isTTY) {
        process.stderr.write(`\nSession ended (${session.sessionId}).\n`);
      }

      cleanup(exitCode);
    });

    ws.on('error', (err) => {
      debug(`WebSocket error: ${err.message}`);
      if (usingRawMode) {
        process.stderr.write('\r\nConnection lost. The session has ended. Tip: run long tasks inside tmux.\r\n');
      } else {
        process.stderr.write('\nConnection lost. The session has ended.\n');
      }
      cleanup(EXIT_CLI_ERROR);
    });
  });
}
