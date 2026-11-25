const DEBOUNCE_MS = 50;
const POLL_MS = 250; // Windows polling interval

export type ResizeSender = (cols: number, rows: number) => void;

export function watchResize(send: ResizeSender): () => void {
  let lastCols = process.stdout.columns ?? 80;
  let lastRows = process.stdout.rows ?? 24;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const handler = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const cols = process.stdout.columns ?? 80;
      const rows = process.stdout.rows ?? 24;
      if (cols !== lastCols || rows !== lastRows) {
        lastCols = cols;
        lastRows = rows;
        send(cols, rows);
      }
    }, DEBOUNCE_MS);
  };

  if (process.platform !== 'win32') {
    process.on('SIGWINCH', handler);
    return () => {
      process.off('SIGWINCH', handler);
      clearTimeout(debounce);
    };
  } else {
    const interval = setInterval(handler, POLL_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(debounce);
    };
  }
}
