import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULTS } from '../constants';

const CONFIG_DIR = path.join(os.homedir(), '.devpanel');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface Credentials {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix ms
  email: string;
}

export interface CurrentContext {
  workspace?: string;
  project?: string;
}

export interface CliConfig {
  apiUrl: string;
  cognitoDomain: string;
  cognitoClientId: string;
  allowedConnectHosts: string[];
  current?: CurrentContext;
}

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function saveCredentials(creds: Credentials): void {
  ensureDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // already gone
  }
}

export function isTokenExpired(creds: Credentials): boolean {
  return Date.now() >= creds.expiresAt - 60_000; // 1 min buffer
}

export function loadConfig(): CliConfig {
  // Resolution order: baked-in constants → ~/.devpanel/config.json → env vars
  let cfg: CliConfig = {
    apiUrl: DEFAULTS.apiUrl,
    cognitoDomain: DEFAULTS.cognitoDomain,
    cognitoClientId: DEFAULTS.cognitoClientId,
    allowedConnectHosts: [...DEFAULTS.allowedConnectHosts],
  };

  try {
    const file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<CliConfig>;
    cfg = { ...cfg, ...file };
  } catch {
    /* config file absent — use defaults */
  }

  if (process.env.DEVPANEL_API_URL) cfg.apiUrl = process.env.DEVPANEL_API_URL;
  if (process.env.DEVPANEL_COGNITO_DOMAIN) cfg.cognitoDomain = process.env.DEVPANEL_COGNITO_DOMAIN;
  if (process.env.DEVPANEL_COGNITO_CLIENT_ID)
    cfg.cognitoClientId = process.env.DEVPANEL_COGNITO_CLIENT_ID;

  return cfg;
}

export function saveConfig(cfg: Partial<CliConfig>): void {
  ensureDir();
  const existing = loadConfig();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...cfg }, null, 2), { mode: 0o600 });
}

export function saveCurrentContext(ctx: CurrentContext): void {
  const existing = loadConfig();
  saveConfig({ ...existing, current: { ...existing.current, ...ctx } });
}

export function resolveWorkspace(flag?: string): string | undefined {
  return flag ?? process.env.DEVPANEL_WORKSPACE ?? loadConfig().current?.workspace;
}

export function resolveProject(flag?: string): string | undefined {
  return flag ?? process.env.DEVPANEL_PROJECT ?? loadConfig().current?.project;
}
