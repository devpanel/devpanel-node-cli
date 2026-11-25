import { isTokenExpired, loadConfig, loadCredentials } from '../config/store';

interface ProfileResponse {
  displayName?: string;
  email?: string;
  githubUsername?: string;
  gitlabUsername?: string;
  bitbucketUsername?: string;
}

export async function profileCommand(): Promise<void> {
  const creds = loadCredentials();
  if (!creds || isTokenExpired(creds)) {
    console.error('Not logged in. Run `devpanel login` first.');
    process.exit(1);
  }

  const { apiUrl } = loadConfig();

  const res = await fetch(`${apiUrl}/users/profile`, {
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

  const data = (await res.json()) as ProfileResponse;

  const row = (label: string, value?: string) =>
    console.log(`  ${label.padEnd(20)} ${value ?? '—'}`);

  console.log('\nProfile\n');
  row('Display name', data.displayName);
  row('Email', data.email);
  row('GitHub', data.githubUsername);
  row('GitLab', data.gitlabUsername);
  row('Bitbucket', data.bitbucketUsername);
  console.log();
}
