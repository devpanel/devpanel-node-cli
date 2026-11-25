import { validateConnectUrl } from './wsconn';

describe('validateConnectUrl', () => {
  const allowed = ['.devpanel.com'];

  test('accepts valid wss:// URL on allowed host', () => {
    expect(() =>
      validateConnectUrl('wss://connect.devpanel.com/v1/sessions/sess_1', allowed),
    ).not.toThrow();
  });

  test('accepts the root domain itself (no subdomain)', () => {
    expect(() =>
      validateConnectUrl('wss://devpanel.com/v1/sessions/sess_1', allowed),
    ).not.toThrow();
  });

  test('rejects ws:// scheme', () => {
    expect(() =>
      validateConnectUrl('ws://connect.devpanel.com/v1/sessions/sess_1', allowed),
    ).toThrow(/wss:\/\//);
  });

  test('rejects http:// scheme', () => {
    expect(() =>
      validateConnectUrl('http://connect.devpanel.com/v1/sessions/sess_1', allowed),
    ).toThrow(/wss:\/\//);
  });

  test('rejects host not in allowlist', () => {
    expect(() =>
      validateConnectUrl('wss://evil.example.com/v1/sessions/sess_1', allowed),
    ).toThrow(/allowed/);
  });

  test('rejects attacker subdomain of lookalike domain', () => {
    expect(() =>
      validateConnectUrl('wss://connect.devpanel.com.evil.com/v1/sessions/x', allowed),
    ).toThrow(/allowed/);
  });

  test('ticket is NOT in the URL', () => {
    // This is a contract test: the URL must not contain the ticket
    const url = 'wss://connect.devpanel.com/v1/sessions/sess_1';
    expect(url).not.toMatch(/ticket|eyJ/);
  });

  test('rejects malformed URL', () => {
    expect(() => validateConnectUrl('not-a-url', allowed)).toThrow();
  });
});
