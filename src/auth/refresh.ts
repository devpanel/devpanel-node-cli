import { CliConfig, Credentials, loadConfig, saveCredentials } from '../config/store';

export async function refreshTokens(
  creds: Credentials,
  cfg?: CliConfig,
): Promise<Credentials | null> {
  const config = cfg ?? loadConfig();

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.cognitoClientId,
    refresh_token: creds.refreshToken,
  });

  try {
    const res = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      id_token: string;
      access_token: string;
      expires_in: number;
    };

    const updated: Credentials = {
      ...creds,
      idToken: data.id_token,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    saveCredentials(updated);
    return updated;
  } catch {
    return null;
  }
}
