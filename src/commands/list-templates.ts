import { isTokenExpired, loadConfig, loadCredentials } from '../config/store';

interface Template {
  _id: string;
  name: string;
  projectType?: string;
  status?: string;
  defaultImageTag?: string;
  repoUrl?: string;
  team?: {
    name?: string;
    email?: string;
  };
}

export async function listTemplatesCommand(opts: { size: number }): Promise<void> {
  const creds = loadCredentials();
  if (!creds || isTokenExpired(creds)) {
    console.error('Not logged in. Run `devpanel login` first.');
    process.exit(1);
  }

  const { apiUrl } = loadConfig();

  const res = await fetch(`${apiUrl}/catalogs?pageSize=${opts.size}`, {
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

  const templates = (await res.json()) as Template[];

  if (templates.length === 0) {
    console.log('No templates found.');
    return;
  }

  const col = (s: string | undefined, width: number) =>
    (s ?? '—').substring(0, width).padEnd(width);

  const header = [
    col('ID', 26),
    col('NAME', 22),
    col('TYPE', 14),
    col('STATUS', 12),
    col('MANAGED BY', 32),
    col('IMAGE TAG', 16),
    col('REPO URL', 40),
  ].join('  ');

  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));

  for (const t of templates) {
    const managedBy =
      t.team?.name && t.team?.email
        ? `${t.team.name} - ${t.team.email}`
        : (t.team?.name ?? t.team?.email);

    console.log(
      [
        col(t._id, 26),
        col(t.name, 22),
        col(t.projectType, 14),
        col(t.status, 12),
        col(managedBy, 32),
        col(t.defaultImageTag, 16),
        col(t.repoUrl, 40),
      ].join('  '),
    );
  }
}
