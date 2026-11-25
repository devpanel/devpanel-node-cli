import os from 'os';
import { refreshTokens } from '../auth/refresh';
import { CliConfig, Credentials, loadConfig, loadCredentials, saveCredentials } from '../config/store';
import { debug } from '../debug/logger';
import { CLI_VERSION } from '../constants';

export interface CreateSessionRequest {
  type: 'shell' | 'exec';
  container?: string;
  pod?: string;
  tty: boolean;
  cols?: number;
  rows?: number;
  term?: string;
  command?: string[];
}

export interface SessionInfo {
  sessionId: string;
  ticket: string;
  connectUrl: string;
  expiresAt: string;
}

function userAgent(): string {
  return `devpanel-cli/${CLI_VERSION} (${os.platform()}/${os.arch()})`;
}

function requestId(): string {
  return crypto.randomUUID();
}

function mapHttpError(
  status: number,
  body: string,
  applicationId: string,
  projectId: string,
  workspaceId: string,
  reqId: string,
): string {
  try {
    const json = JSON.parse(body) as { message?: string; code?: string };
    const code = json.code ?? '';
    const message = json.message ?? body;

    if (status === 400) return `Invalid request: ${message}`;
    if (status === 401) return 'Your session has expired. Run "devpanel login".';
    if (status === 403 && code === 'shell_disabled')
      return 'Shell access is disabled for this workspace.';
    if (status === 403)
      return 'You don\'t have shell access to this application. Ask a workspace admin to grant the "shell" permission.';
    if (status === 404)
      return `Application ${applicationId} not found in project ${projectId} / workspace ${workspaceId}.`;
    if (status === 409 && code === 'container_not_found') {
      const avail = (json as { available?: string[] }).available;
      const list = avail ? ` Available: ${avail.join(', ')}.` : '';
      return `Container not found.${list}`;
    }
    if (status === 412) return 'MFA is required for this action. This CLI version doesn\'t support it yet.';
    if (status === 426) return 'This CLI version is no longer supported. Please upgrade.';
    if (status === 429) {
      const retryAfter = '';
      return `Too many requests. Try again${retryAfter ? ` in ${retryAfter}s` : ' later'}.`;
    }
    if (status === 503 && code === 'agent_disconnected')
      return 'The cluster for this application is not reachable right now. Your application is still running; only shell access is affected.';
  } catch {
    // fall through to generic
  }
  return `DevPanel API is unavailable (request id: ${reqId}).`;
}

async function doCreateSession(
  workspaceId: string,
  projectId: string,
  applicationId: string,
  request: CreateSessionRequest,
  creds: Credentials,
  cfg: CliConfig,
  reqId: string,
): Promise<{ res: Response; reqId: string }> {
  const url = `${cfg.apiUrl}/workspaces/${workspaceId}/projects/${projectId}/applications/${applicationId}/sessions`;
  debug(`POST ${url} (request-id: ${reqId})`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${creds.idToken}`,
      'User-Agent': userAgent(),
      'X-Request-Id': reqId,
    },
    body: JSON.stringify(request),
  });

  return { res, reqId };
}

export async function createSession(opts: {
  workspaceId: string;
  projectId: string;
  applicationId: string;
  request: CreateSessionRequest;
  creds: Credentials;
  cfg: CliConfig;
}): Promise<SessionInfo> {
  const { workspaceId, projectId, applicationId, request } = opts;
  let { creds, cfg } = opts;
  const reqId = requestId();
  const startMs = Date.now();

  let { res } = await doCreateSession(
    workspaceId, projectId, applicationId, request, creds, cfg, reqId,
  );

  debug(`POST sessions status=${res.status} elapsed=${Date.now() - startMs}ms`);

  // Attempt token refresh once on 401
  if (res.status === 401) {
    debug('Received 401, attempting token refresh');
    cfg = cfg ?? loadConfig();
    const refreshed = await refreshTokens(creds, cfg);
    if (refreshed) {
      creds = refreshed;
      saveCredentials(creds);
      const retry = await doCreateSession(
        workspaceId, projectId, applicationId, request, creds, cfg, requestId(),
      );
      res = retry.res;
      debug(`Retry status=${res.status}`);
    }
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      mapHttpError(res.status, body, applicationId, projectId, workspaceId, reqId),
    );
  }

  const data = (await res.json()) as SessionInfo;
  debug(`sessionId=${data.sessionId} connectUrl host=${new URL(data.connectUrl).hostname}`);
  return data;
}

export async function getAuthenticatedCreds(cfg: CliConfig): Promise<Credentials> {
  let creds = loadCredentials();
  if (!creds) {
    throw new Error('Not logged in. Run `devpanel login` first.');
  }

  // Proactively refresh if expired
  const { isTokenExpired } = await import('../config/store');
  if (isTokenExpired(creds)) {
    debug('Token expired, attempting proactive refresh');
    const refreshed = await refreshTokens(creds, cfg);
    if (!refreshed) {
      throw new Error('Your session has expired. Run "devpanel login".');
    }
    creds = refreshed;
  }

  return creds;
}
