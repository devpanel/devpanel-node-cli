let enabled = false;

export function enableDebug(): void {
  enabled = true;
}

export function isDebugEnabled(): boolean {
  return enabled;
}

// Redact JWTs and long opaque tokens from debug output
function redact(s: string): string {
  // JWT pattern: three base64url segments
  return s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[REDACTED]');
}

export function debug(msg: string): void {
  if (!enabled) return;
  process.stderr.write(`[debug] ${redact(msg)}\n`);
}

export function debugTiming(label: string, startMs: number): void {
  if (!enabled) return;
  const elapsed = Date.now() - startMs;
  process.stderr.write(`[debug] ${label}: ${elapsed}ms\n`);
}
