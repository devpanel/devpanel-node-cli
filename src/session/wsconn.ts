import WebSocket from 'ws';
import os from 'os';
import { debug } from '../debug/logger';
import { CLI_VERSION } from '../constants';

const CONNECT_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 15_000;
const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 60_000;

function userAgent(): string {
  return `devpanel-cli/${CLI_VERSION} (${os.platform()}/${os.arch()})`;
}

export function validateConnectUrl(url: string, allowedHosts: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid connectUrl: "${url}"`);
  }

  if (parsed.protocol !== 'wss:') {
    throw new Error(
      `connectUrl must use wss:// scheme, got: "${parsed.protocol.replace(':', '')}"`,
    );
  }

  const host = parsed.hostname;
  const allowed = allowedHosts.some((suffix) => {
    if (suffix.startsWith('.')) return host === suffix.slice(1) || host.endsWith(suffix);
    return host === suffix;
  });

  if (!allowed) {
    throw new Error(
      `connectUrl host "${host}" is not in the allowed hosts list. Refusing connection.`,
    );
  }
}

export interface WsConnection {
  ws: WebSocket;
  stop(): void;
}

export function openWebSocket(opts: {
  connectUrl: string;
  ticket: string;
  requestId: string;
  allowedHosts: string[];
}): Promise<WebSocket> {
  const { connectUrl, ticket, requestId, allowedHosts } = opts;

  validateConnectUrl(connectUrl, allowedHosts);

  return new Promise<WebSocket>((resolve, reject) => {
    debug(`Opening WebSocket to ${new URL(connectUrl).hostname}`);

    const ws = new WebSocket(connectUrl, ['devpanel.shell.v1'], {
      headers: {
        Authorization: `Bearer ${ticket}`,
        'User-Agent': userAgent(),
        'X-Request-Id': requestId,
      },
    });

    const connectTimer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Connection timeout after 10 seconds.'));
    }, CONNECT_TIMEOUT_MS);

    ws.once('open', () => {
      clearTimeout(connectTimer);
      debug('WebSocket connection established');
      resolve(ws);
    });

    ws.once('error', (err) => {
      clearTimeout(connectTimer);
      reject(new Error(`WebSocket error: ${err.message}`));
    });
  });
}

export function waitForReady(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for session to become ready (15s).'));
    }, READY_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('close', onClose);
      ws.off('error', onError);
    }

    function onMessage(data: WebSocket.RawData) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf.length < 1) return;

      const channel = buf[0];
      if (channel !== 4) return; // only control channel

      try {
        const msg = JSON.parse(buf.slice(1).toString('utf8')) as { type: string; message?: string; code?: string; ref_id?: string };
        debug(`control:${msg.type}`);

        if (msg.type === 'ready') {
          cleanup();
          resolve();
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(mapGatewayError(msg.code ?? 'internal', msg.ref_id)));
        }
      } catch {
        // ignore malformed control frames
      }
    }

    function onClose(code: number, reason: Buffer) {
      cleanup();
      reject(new Error(`WebSocket closed before ready (${code}: ${reason.toString()})`));
    }

    function onError(err: Error) {
      cleanup();
      reject(new Error(`WebSocket error before ready: ${err.message}`));
    }

    ws.on('message', onMessage);
    ws.once('close', onClose);
    ws.once('error', onError);
  });
}

export function mapGatewayError(code: string, refId?: string): string {
  switch (code) {
    case 'ticket_invalid':
    case 'ticket_expired':
    case 'ticket_replayed':
      return 'Session ticket was rejected. Please try again.';
    case 'ticket_wrong_cluster':
    case 'namespace_forbidden':
      return 'Access denied by the cluster gateway.';
    case 'pod_not_found':
    case 'pod_not_ready':
      return 'No ready instance of this application is available (it may be deploying).';
    case 'container_not_found':
      return 'Container not found in the selected instance.';
    case 'limit_exceeded':
      return 'Too many open sessions. Close an existing session and try again.';
    case 'agent_shutting_down':
      return 'The cluster gateway is restarting. Please retry in a minute.';
    default:
      return `Failed to start the session${refId ? ` (ref: ${refId})` : ''}.`;
  }
}

export function setupPingPong(ws: WebSocket, onTimeout: () => void): () => void {
  let lastPong = Date.now();

  const pingInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (Date.now() - lastPong > PONG_TIMEOUT_MS) {
      debug('Ping timeout: no pong received in 60s');
      onTimeout();
      return;
    }

    ws.ping();
    debug('ping sent');
  }, PING_INTERVAL_MS);

  ws.on('pong', () => {
    lastPong = Date.now();
    debug('pong received');
  });

  return () => clearInterval(pingInterval);
}
