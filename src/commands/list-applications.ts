import { isTokenExpired, loadConfig, loadCredentials } from '../config/store';

type StatusFilter = 'deployed' | 'undeployed' | 'paused' | 'upgrading' | 'all';

const VALID_STATUSES: StatusFilter[] = ['deployed', 'undeployed', 'paused', 'upgrading', 'all'];

interface Application {
  _id: string;
  status?: string;
  replicas?: number;
  originBranch?: string;
  project?: { name?: string, _id?: string };
  hostname?: string;
  deployedBy?: { rawInfo?: { email?: string } };
  deployedAt?: string;
  lastActivity?: {
    status?: string;
    action?: string;
    updatedAt?: string;
  };
}

function buildQuery(status: StatusFilter, size: number): string {
  const parts = [`pageSize=${size}`];
  if (status === 'deployed') parts.push('status=DEPLOY_APPLICATION_SUCCESS', 'replicas=1');
  else if (status === 'paused') parts.push('status=DEPLOY_APPLICATION_SUCCESS', 'replicas=0');
  else if (status === 'undeployed') parts.push('status=UNDEPLOY_APPLICATION_SUCCESS');
  else if (status === 'upgrading') parts.push('status=UPGRADING');
  return parts.join('&');
}

function statusLabel(app: Application): string {
  if (app.status === 'UNDEPLOY_APPLICATION_SUCCESS') return 'Not Deployed';
  const activity = app.lastActivity;
  if (!activity) return 'Not Deployed';
  if (['PENDING', 'IN_PROGRESS'].includes(activity.status ?? '')) return 'Processing';
  if (activity.status === 'ERROR') return 'Error';
  if (activity.status === 'SUCCESS' && activity.action !== 'UNDEPLOY_APPLICATION') {
    return (app.replicas ?? 0) > 0 ? 'Deployed' : 'Paused';
  }
  return 'Not Deployed';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().replace('T', ' ').substring(0, 16);
}

export async function listApplicationsCommand(opts: {
  workspaceId: string;
  size: number;
  status: StatusFilter;
}): Promise<void> {
  if (!VALID_STATUSES.includes(opts.status)) {
    console.error(`Invalid --status "${opts.status}". Valid values: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const creds = loadCredentials();
  if (!creds || isTokenExpired(creds)) {
    console.error('Not logged in. Run `devpanel login` first.');
    process.exit(1);
  }

  const { apiUrl } = loadConfig();

  const res = await fetch(
    `${apiUrl}/workspaces/${opts.workspaceId}/applications?${buildQuery(opts.status, opts.size)}`,
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

  const apps = (await res.json()) as Application[];

  if (apps.length === 0) {
    console.log('No applications found.');
    return;
  }

  const col = (s: string | undefined, width: number) =>
    (s ?? '—').substring(0, width).padEnd(width);

  const header = [
    col('ID', 26),
    col('STATUS', 12),
    col('PROJECT ID', 26),
    col('NAME', 32),
    col('URL', 42),
    col('DEPLOYED BY', 30),
    col('DEPLOYED AT', 16),
  ].join('  ');

  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));

  for (const app of apps) {
    const name = [app.originBranch, app.project?.name].filter(Boolean).join(' / ');
    const deployedAt = formatDate(app.deployedAt ?? app.lastActivity?.updatedAt);

    console.log(
      [
        col(app._id, 26),
        col(statusLabel(app), 12),
        col(app.project?._id, 26),
        col(name, 32),
        col(app.hostname, 42),
        col(app.deployedBy?.rawInfo?.email, 30),
        col(deployedAt, 16),
      ].join('  '),
    );
  }
}
