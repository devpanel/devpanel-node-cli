import { loadConfig, saveConfig, saveCurrentContext } from '../config/store';

export interface ConfigOptions {
  apiUrl?: string;
  cognitoDomain?: string;
  cognitoClientId?: string;
  workspace?: string;
  project?: string;
}

export async function configCommand(opts: ConfigOptions): Promise<void> {
  const hasApiUpdate =
    opts.apiUrl !== undefined ||
    opts.cognitoDomain !== undefined ||
    opts.cognitoClientId !== undefined;

  const hasContextUpdate = opts.workspace !== undefined || opts.project !== undefined;

  if (!hasApiUpdate && !hasContextUpdate) {
    const current = loadConfig();
    console.log('\nCurrent DevPanel CLI configuration:\n');
    console.log(`  API URL         ${current.apiUrl}`);
    console.log(`  Cognito Domain  ${current.cognitoDomain}`);
    console.log(`  Client ID       ${current.cognitoClientId}`);
    console.log(`  Workspace       ${current.current?.workspace ?? '(not set)'}`);
    console.log(`  Project         ${current.current?.project ?? '(not set)'}`);
    console.log();
    return;
  }

  if (hasApiUpdate) {
    const update: Parameters<typeof saveConfig>[0] = {};
    if (opts.apiUrl !== undefined) update.apiUrl = opts.apiUrl;
    if (opts.cognitoDomain !== undefined) update.cognitoDomain = opts.cognitoDomain;
    if (opts.cognitoClientId !== undefined) update.cognitoClientId = opts.cognitoClientId;
    saveConfig(update);
  }

  if (hasContextUpdate) {
    saveCurrentContext({
      workspace: opts.workspace,
      project: opts.project,
    });
  }

  const saved = loadConfig();
  console.log('\nConfig saved to ~/.devpanel/config.json');
  console.log(`  API URL         ${saved.apiUrl}`);
  console.log(`  Cognito Domain  ${saved.cognitoDomain}`);
  console.log(`  Client ID       ${saved.cognitoClientId}`);
  console.log(`  Workspace       ${saved.current?.workspace ?? '(not set)'}`);
  console.log(`  Project         ${saved.current?.project ?? '(not set)'}`);
  console.log();
}
