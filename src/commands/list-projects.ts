import { isTokenExpired, loadConfig, loadCredentials } from '../config/store';

interface Project {
  _id: string;
  name: string;
  projectType?: { name?: string };
  totalDeployedApplications?: number;
  totalPausedApplications?: number;
  totalNoDeployedApplications?: number;
  repositoryProvider?: string;
  repositoryOwner?: string;
  repositoryName?: string;
}

export async function listProjectsCommand(opts: {
  workspaceId: string;
  size: number;
}): Promise<void> {
  const creds = loadCredentials();
  if (!creds || isTokenExpired(creds)) {
    console.error('Not logged in. Run `devpanel login` first.');
    process.exit(1);
  }

  const { apiUrl } = loadConfig();

  const res = await fetch(
    `${apiUrl}/workspaces/${opts.workspaceId}/projects?pageSize=${opts.size}`,
    { headers: { Authorization: `Bearer ${creds.idToken}` } },
  );

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

  const projects = (await res.json()) as Project[];

  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }

  const col = (s: string | number | undefined, width: number) =>
    String(s ?? '—').substring(0, width).padEnd(width);

  const header = [
    col('ID', 26),
    col('TYPE', 18),
    col('NAME', 35),
    col('ACTIVE', 6),
    col('PAUSED', 6),
    col('INACTIVE', 8),
    col('PROVIDER', 10),
    col('REPOSITORY', 45),
  ].join('  ');

  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));

  for (const p of projects) {
    const repo =
      p.repositoryOwner && p.repositoryName
        ? `${p.repositoryOwner}/${p.repositoryName}`
        : (p.repositoryOwner ?? p.repositoryName);

    console.log(
      [
        col(p._id, 26),
        col(p.projectType?.name, 18),
        col(p.name, 35),
        col(p.totalDeployedApplications, 6),
        col(p.totalPausedApplications, 6),
        col(p.totalNoDeployedApplications, 8),
        col(p.repositoryProvider, 10),
        col(repo, 45),
      ].join('  '),
    );
  }
}
