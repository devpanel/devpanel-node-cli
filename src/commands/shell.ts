import { enableDebug } from '../debug/logger';
import { loadConfig, resolveWorkspace, resolveProject } from '../config/store';
import { getAuthenticatedCreds } from '../session/api';
import { runSession } from '../session/runner';

interface ShellOptions {
  workspace?: string;
  project?: string;
  container?: string;
  pod?: string;
  escapeChar?: string;
  debug?: boolean;
}

export async function shellCommand(applicationId: string, opts: ShellOptions): Promise<void> {
  if (opts.debug) enableDebug();

  if (!process.stdin.isTTY) {
    console.error(
      'Error: "devpanel shell" requires an interactive terminal. ' +
        'Use "devpanel exec <app> -- <cmd>" in scripts.',
    );
    process.exit(2);
  }

  const cfg = loadConfig();
  const workspaceId = resolveWorkspace(opts.workspace);
  const projectId = resolveProject(opts.project);

  if (!workspaceId) {
    console.error('Error: --workspace is required (or set it with `devpanel config`).');
    process.exit(2);
  }
  if (!projectId) {
    console.error('Error: --project is required (or set it with `devpanel config`).');
    process.exit(2);
  }

  let creds: Awaited<ReturnType<typeof getAuthenticatedCreds>>;
  try {
    creds = await getAuthenticatedCreds(cfg);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const escapeChar = opts.escapeChar === 'none' ? null : (opts.escapeChar ?? '~');

  let exitCode: number;
  try {
    exitCode = await runSession({
      workspaceId,
      projectId,
      applicationId,
      container: opts.container,
      pod: opts.pod,
      mode: 'shell',
      tty: true,
      passStdin: true,
      escapeChar,
      creds,
      cfg,
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(EXIT_CLI_ERROR);
  }

  process.exit(exitCode);
}

const EXIT_CLI_ERROR = 255;
