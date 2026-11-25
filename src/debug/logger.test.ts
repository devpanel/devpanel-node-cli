import { enableDebug, debug, debugTiming } from './logger';

describe('debug logger', () => {
  let stderrOutput: string[] = [];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrOutput = [];
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput.push(chunk.toString());
      return true;
    }) as typeof process.stderr.write;
    enableDebug();
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  test('output never contains a JWT ticket', () => {
    const fakeTicket = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SomeSignature123';
    debug(`Connecting with ticket=${fakeTicket}`);
    const all = stderrOutput.join('');
    expect(all).not.toContain(fakeTicket);
    expect(all).toContain('[REDACTED]');
  });

  test('output never contains a bearer token', () => {
    const fakeToken = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.tokenSignatureXYZ';
    debug(`Authorization: Bearer ${fakeToken}`);
    const all = stderrOutput.join('');
    expect(all).not.toContain(fakeToken);
    expect(all).toContain('[REDACTED]');
  });

  test('regular debug messages are printed with [debug] prefix', () => {
    debug('sessionId=sess_abc123');
    expect(stderrOutput.join('')).toContain('[debug] sessionId=sess_abc123');
  });

  test('debugTiming prints elapsed time', () => {
    debugTiming('request', Date.now() - 100);
    const all = stderrOutput.join('');
    expect(all).toContain('[debug] request:');
    expect(all).toMatch(/\d+ms/);
  });
});
