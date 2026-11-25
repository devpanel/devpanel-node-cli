const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export interface Spinner {
  stop(): void;
}

export function startSpinner(message: string): Spinner {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${message}\n`);
    return { stop: () => {} };
  }

  let frame = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${FRAMES[frame % FRAMES.length]} ${message}`);
    frame++;
  }, INTERVAL_MS);

  return {
    stop() {
      clearInterval(timer);
      // Clear the spinner line
      process.stderr.write('\r\x1b[K');
    },
  };
}
