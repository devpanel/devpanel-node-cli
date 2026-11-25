type SignalHandler = () => void;

const handlers: SignalHandler[] = [];
let restored = false;

function restoreTerminal(): void {
  if (restored) return;
  restored = true;
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // best effort
  }
  process.stdin.pause();
}

function registerSignals(): void {
  const cleanup = () => {
    restoreTerminal();
    for (const h of handlers) h();
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('SIGHUP', cleanup);
  process.once('uncaughtException', (err) => {
    restoreTerminal();
    process.stderr.write(`\r\nUnhandled error: ${err.message}\r\n`);
    process.exit(255);
  });
}

export function enableRawMode(): void {
  restored = false;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  registerSignals();
}

export function disableRawMode(): void {
  restoreTerminal();
}

export function onCleanup(fn: SignalHandler): void {
  handlers.push(fn);
}
