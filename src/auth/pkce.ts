import crypto from 'crypto';

export interface PkceChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePkce(): PkceChallenge {
  const codeVerifier = crypto.randomBytes(64).toString('base64url').slice(0, 128);

  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return { codeVerifier, codeChallenge };
}

export function buildAuthUrl(opts: {
  cognitoDomain: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: 'openid email profile aws.cognito.signin.user.admin',
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
    state: opts.state,
  });

  return `https://${opts.cognitoDomain}/oauth2/authorize?${params}`;
}

export interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
}

export async function exchangeCodeForTokens(opts: {
  cognitoDomain: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    code: opts.code,
    code_verifier: opts.codeVerifier,
  });

  const res = await fetch(`https://${opts.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

export function decodeIdTokenPayload(idToken: string): Record<string, unknown> {
  const [, payload] = idToken.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}
