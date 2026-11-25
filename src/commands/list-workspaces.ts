import { isTokenExpired, loadConfig, loadCredentials } from '../config/store';

interface Workspace {
  _id: string;
  name: string;
  namespace?: string;
  status?: string;
  environment?: {
    cloudAccount?: {
      provider?: string;
    };
  };
}

export async function listWorkspacesCommand(opts: { size: number }): Promise<void> {
  const creds = loadCredentials();
  if (!creds || isTokenExpired(creds)) {
    console.error('Not logged in. Run `devpanel login` first.');
    process.exit(1);
  }

  const { apiUrl } = loadConfig();

  const res = await fetch(`${apiUrl}/workspaces?pageSize=${opts.size}`, {
    headers: { Authorization: `Bearer ${creds.idToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { message?: string };
      console.error(`Error (${res.status}): ${json.message ?? text}`);
    } catch {
      console.error(`Error (${res.status}): ${text}`);
    }
    process.exit(1);
  }

  const workspaces = (await res.json()) as Workspace[];

  if (workspaces.length === 0) {
    console.log('No workspaces found.');
    return;
  }

  const col = (s: string | undefined, width: number) =>
    (s ?? '—').substring(0, width).padEnd(width);

  const header = [
    col('ID', 26),
    col('NAME', 24),
    col('NAMESPACE', 40),
    col('STATUS', 14),
    col('PROVIDER', 12),
  ].join('  ');

  const divider = '-'.repeat(header.length);

  console.log(`\n${header}`);
  console.log(divider);

  for (const ws of workspaces) {
    const provider = ws.environment?.cloudAccount?.provider;
    console.log(
      [
        col(ws._id, 26),
        col(ws.name, 24),
        col(ws.namespace, 40),
        col(ws.status, 14),
        col(provider, 12),
      ].join('  '),
    );
  }
}
