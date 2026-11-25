import { enableDebug } from '../debug/logger';
import { loadConfig, resolveWorkspace, resolveProject } from '../config/store';
import { getAuthenticatedCreds } from '../session/api';
import { runSession } from '../session/runner';

const EXIT_CLI_ERROR = 255;
const STDIN_WARN_BYTES = 10 * 1024 * 1024; // 10 MiB

interface ExecOptions {
  workspace?: string;
  project?: string;
  container?: string;
  pod?: string;
  tty?: boolean;
  stdin?: boolean;
  debug?: boolean;
}

export async function execCommand(
  applicationId: string,
  opts: ExecOptions,
  command: string[],
): Promise<void> {
  if (opts.debug) enableDebug();

  if (command.length === 0) {
    console.error('Error: command is required after --');
    console.error('Usage: devpanel exec <applicationId> [options] -- <command> [args...]');
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

  let useTty = opts.tty ?? false;
  let passStdin = opts.stdin ?? false;

  // -t only effective if stdin is a TTY
  if (useTty && !process.stdin.isTTY) {
    process.stderr.write('Warning: --tty ignored because stdin is not a terminal.\n');
    useTty = false;
  }

  // Warn on large stdin
  if (passStdin) {
    let stdinBytes = 0;
    let warned = false;
    const originalOn = process.stdin.on.bind(process.stdin);
    process.stdin.on('data', (chunk: Buffer) => {
      stdinBytes += chunk.length;
      if (!warned && stdinBytes > STDIN_WARN_BYTES) {
        warned = true;
        process.stderr.write(
          'Warning: large stdin over the shell tunnel is slow. Use "devpanel upload" for files.\n',
        );
      }
    });
    // We just peeked — the runner will re-attach
    void originalOn; // suppress unused warning
  }

  let creds: Awaited<ReturnType<typeof getAuthenticatedCreds>>;
  try {
    creds = await getAuthenticatedCreds(cfg);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  let exitCode: number;
  try {
    exitCode = await runSession({
      workspaceId,
      projectId,
      applicationId,
      container: opts.container,
      pod: opts.pod,
      mode: 'exec',
      tty: useTty,
      command,
      passStdin,
      escapeChar: null, // no escape sequence for exec
      creds,
      cfg,
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(EXIT_CLI_ERROR);
  }

  process.exit(exitCode);
}
