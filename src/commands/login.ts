import crypto from 'crypto';
import open from 'open';
import {
  buildAuthUrl,
  decodeIdTokenPayload,
  exchangeCodeForTokens,
  generatePkce,
} from '../auth/pkce';
import { findFreePort, waitForCallback } from '../auth/server';
import { isTokenExpired, loadConfig, loadCredentials, saveCredentials } from '../config/store';

export async function loginCommand(): Promise<void> {
  const cfg = loadConfig();

  if (!cfg.cognitoDomain || !cfg.cognitoClientId) {
    console.error('Internal error: missing Cognito configuration.');
    process.exit(1);
  }

  // Check existing session
  const existing = loadCredentials();
  if (existing && !isTokenExpired(existing)) {
    console.log(`Already logged in as ${existing.email}`);
    console.log('Run `devpanel logout` to switch accounts.');
    return;
  }

  const port = await findFreePort(9876);
  const redirectUri = `http://localhost:${port}/callback`;

  const { codeVerifier, codeChallenge } = generatePkce();
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = buildAuthUrl({
    cognitoDomain: cfg.cognitoDomain,
    clientId: cfg.cognitoClientId,
    redirectUri,
    codeChallenge,
    state,
  });

  console.log('\nOpening your browser to log in with DevPanel SSO...');
  console.log('If the browser does not open, visit:\n');
  console.log(`  ${authUrl}\n`);

  await open(authUrl);

  console.log('Waiting for authentication...');

  let callbackResult: { code: string; state: string };
  try {
    callbackResult = await waitForCallback(port, state);
  } catch (err) {
    console.error(`\nLogin failed: ${(err as Error).message}`);
    process.exit(1);
  }

  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens({
      cognitoDomain: cfg.cognitoDomain,
      clientId: cfg.cognitoClientId,
      redirectUri,
      code: callbackResult.code,
      codeVerifier,
    });
  } catch (err) {
    console.error(`\nToken exchange failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const payload = decodeIdTokenPayload(tokens.id_token);
  const email = (payload['email'] as string | undefined) ?? 'unknown';

  saveCredentials({
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    email,
  });

  console.log(`\nLogged in as ${email}`);
  console.log('Credentials saved to ~/.devpanel/credentials.json');
}
