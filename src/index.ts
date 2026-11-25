#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// Load .env from the CLI project directory silently (dev convenience).
// In production (globally installed) the file won't exist and this is a no-op.
(function loadEnv(filePath: string) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* .env absent — that's fine */
  }
})(path.resolve(__dirname, '..', '.env'));

import { Command } from 'commander';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { profileCommand } from './commands/profile';
import { listWorkspacesCommand } from './commands/list-workspaces';
import { listTemplatesCommand } from './commands/list-templates';
import { listProjectsCommand } from './commands/list-projects';
import { listApplicationsCommand } from './commands/list-applications';
import { configCommand } from './commands/config';
import { uploadCommand } from './commands/upload';
import { shellCommand } from './commands/shell';
import { execCommand } from './commands/exec';

const program = new Command();

program
  .name('devpanel')
  .description('DevPanel CLI — manage your workspaces and applications')
  .version('0.1.0');

program
  .command('login')
  .description('Log in to DevPanel via browser SSO')
  .action(async () => {
    await loginCommand();
  });

program
  .command('logout')
  .description('Log out and remove stored credentials')
  .action(() => {
    logoutCommand();
  });

program
  .command('profile')
  .description('Show your DevPanel profile')
  .action(async () => {
    await profileCommand();
  });

program
  .command('upload <file>')
  .description('Upload a file to $APP_ROOT of the application container')
  .requiredOption('-w, --workspace <workspaceId>', 'Workspace ID')
  .requiredOption('-p, --project <projectId>', 'Project ID')
  .requiredOption('-a, --application <applicationId>', 'Application ID')
  .action(async (file, opts) => {
    await uploadCommand(file, opts);
  });

program
  .command('config')
  .description('View or update CLI configuration')
  .option('--apiUrl <url>', 'API endpoint URL')
  .option('--cognitoDomain <domain>', 'Cognito hosted UI domain')
  .option('--cognitoClientId <clientId>', 'Cognito app client ID')
  .option('-w, --workspace <workspaceId>', 'Set default workspace ID')
  .option('-p, --project <projectId>', 'Set default project ID')
  .action(async (opts) => {
    await configCommand(opts);
  });

function parseSize(val: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1) {
    console.error(`--size must be a positive integer, got: "${val}"`);
    process.exit(1);
  }
  return n;
}

const list = program.command('list').description('List resources');

list
  .command('workspaces')
  .description('List your workspaces')
  .option('-s, --size <number>', 'Number of results per page', parseSize, 12)
  .action(async (opts) => {
    await listWorkspacesCommand({ size: opts.size });
  });

list
  .command('templates')
  .description('List available templates')
  .option('-s, --size <number>', 'Number of results per page', parseSize, 12)
  .action(async (opts) => {
    await listTemplatesCommand({ size: opts.size });
  });

list
  .command('projects')
  .description('List projects within a workspace')
  .requiredOption('-w, --workspaces <workspaceId>', 'Workspace ID')
  .option('-s, --size <number>', 'Number of results per page', parseSize, 12)
  .action(async (opts) => {
    await listProjectsCommand({ workspaceId: opts.workspaces, size: opts.size });
  });

list
  .command('applications')
  .description('List applications within a workspace')
  .requiredOption('-w, --workspaces <workspaceId>', 'Workspace ID')
  .option('-s, --size <number>', 'Number of results per page', parseSize, 25)
  .option('--status <status>', 'Filter: deployed, undeployed, paused, upgrading, all', 'deployed')
  .action(async (opts) => {
    await listApplicationsCommand({
      workspaceId: opts.workspaces,
      size: opts.size,
      status: opts.status,
    });
  });

program
  .command('shell <applicationId>')
  .description('Open an interactive shell in an application container')
  .option('-w, --workspace <workspaceId>', 'Workspace ID (overrides config)')
  .option('-p, --project <projectId>', 'Project ID (overrides config)')
  .option('--container <name>', 'Target container name')
  .option('--pod <name>', 'Target pod name (for debugging)')
  .option('--escape-char <char>', 'Escape character (default: ~, use "none" to disable)', '~')
  .option('--debug', 'Print debug timing and session info to stderr')
  .action(async (applicationId: string, opts: Record<string, string | boolean | undefined>) => {
    await shellCommand(applicationId, {
      workspace: opts.workspace as string | undefined,
      project: opts.project as string | undefined,
      container: opts.container as string | undefined,
      pod: opts.pod as string | undefined,
      escapeChar: opts.escapeChar as string | undefined,
      debug: opts.debug as boolean | undefined,
    });
  });

program
  .command('exec <applicationId>')
  .description('Run a one-off command in an application container')
  .option('-w, --workspace <workspaceId>', 'Workspace ID (overrides config)')
  .option('-p, --project <projectId>', 'Project ID (overrides config)')
  .option('--container <name>', 'Target container name')
  .option('--pod <name>', 'Target pod name (for debugging)')
  .option('-t, --tty', 'Allocate a TTY (requires interactive terminal)')
  .option('-i, --stdin', 'Pass local stdin into the command')
  .option('--debug', 'Print debug timing and session info to stderr')
  .allowUnknownOption()
  .action(async (applicationId: string, opts: Record<string, string | boolean | undefined>, cmd) => {
    // Extract the command after `--`
    const rawArgs: string[] = cmd.args ?? [];
    const sepIdx = process.argv.indexOf('--');
    const command = sepIdx !== -1 ? process.argv.slice(sepIdx + 1) : rawArgs;
    await execCommand(applicationId, {
      workspace: opts.workspace as string | undefined,
      project: opts.project as string | undefined,
      container: opts.container as string | undefined,
      pod: opts.pod as string | undefined,
      tty: opts.tty as boolean | undefined,
      stdin: opts.stdin as boolean | undefined,
      debug: opts.debug as boolean | undefined,
    }, command);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
