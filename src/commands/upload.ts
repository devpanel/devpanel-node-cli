import fs from 'fs';
import path from 'path';
import { isTokenExpired, loadConfig, loadCredentials } from '../config/store';

type ActivityStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'ERROR';

async function apiError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { message?: string };
    return `Error (${res.status}): ${json.message ?? text}`;
  } catch {
    return `Error (${res.status}): ${text}`;
  }
}

function pollActivity(
  apiUrl: string,
  activityId: string,
  idToken: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/activities/${activityId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (!res.ok) {
          clearInterval(interval);
          reject(new Error(await apiError(res)));
          return;
        }

        const { status } = (await res.json()) as { status: ActivityStatus };

        if (status === 'PENDING' || status === 'IN_PROGRESS') {
          process.stdout.write('.');
          return;
        }

        clearInterval(interval);
        process.stdout.write('\n');

        if (status === 'ERROR') {
          reject(new Error('Import failed on the server.'));
        } else {
          resolve();
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 5000);
  });
}

export async function uploadCommand(
  filePath: string,
  opts: { workspace: string; project: string; application: string },
): Promise<void> {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const filename = path.basename(filePath);
  const creds = loadCredentials();
  if (!creds || isTokenExpired(creds)) {
    console.error('Not logged in. Run `devpanel login` first.');
    process.exit(1);
  }

  const { apiUrl } = loadConfig();
  const { workspace: wId, project: pId, application: aId } = opts;
  const authHeader = { Authorization: `Bearer ${creds.idToken}` };
  const jsonHeader = { ...authHeader, 'Content-Type': 'application/json' };

  // Step 1: Get presigned upload URL + download URL
  console.log(`Requesting upload URL for "${filename}"...`);

  const presignedRes = await fetch(
    `${apiUrl}/workspaces/${wId}/projects/${pId}/applications/${aId}/presigned-upload`,
    { method: 'POST', headers: jsonHeader, body: JSON.stringify({ filename }) },
  );

  if (!presignedRes.ok) {
    console.error(await apiError(presignedRes));
    process.exit(1);
  }

  const { uploadURL, downloadURL } = (await presignedRes.json()) as {
    uploadURL: string;
    downloadURL: string;
  };

  // Step 2: Upload file to presigned URL
  console.log(`Uploading "${filename}"...`);

  const uploadRes = await fetch(uploadURL, {
    method: 'PUT',
    body: fs.readFileSync(filePath),
  });

  if (!uploadRes.ok) {
    console.error(`Upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
    process.exit(1);
  }

  // Step 3: Trigger server-side import
  console.log('Importing file into container...');

  const importRes = await fetch(
    `${apiUrl}/workspaces/${wId}/projects/${pId}/applications/${aId}/import-file`,
    { method: 'POST', headers: jsonHeader, body: JSON.stringify({ filename, downloadURL }) },
  );

  if (!importRes.ok) {
    console.error(await apiError(importRes));
    process.exit(1);
  }

  const { activityId } = (await importRes.json()) as { activityId: string };

  // Step 4: Poll activity status every 5s
  process.stdout.write('Waiting for import to complete');

  let importError: Error | undefined;
  try {
    await pollActivity(apiUrl, activityId, creds.idToken);
    console.log(`"${filename}" imported successfully to $APP_ROOT.`);
  } catch (err) {
    importError = err as Error;
  } finally {
    // Step 5: Clean up the uploaded file from S3
    await fetch(
      `${apiUrl}/workspaces/${wId}/projects/${pId}/applications/${aId}/presigned-upload`,
      { method: 'PATCH', headers: jsonHeader, body: JSON.stringify({ filename }) },
    ).catch(() => {/* best-effort cleanup — ignore errors */});
  }

  if (importError) {
    console.error(importError.message);
    process.exit(1);
  }
}
