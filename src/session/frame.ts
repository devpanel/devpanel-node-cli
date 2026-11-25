export const CH_STDIN = 0;
export const CH_STDOUT = 1;
export const CH_STDERR = 2;
export const CH_RESIZE = 3;
export const CH_CONTROL = 4;

const MAX_PAYLOAD = 32 * 1024; // 32 KiB

export interface Frame {
  channel: number;
  payload: Buffer;
}

export function encode(channel: number, payload: Buffer | string): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  if (data.length > MAX_PAYLOAD) {
    throw new RangeError(`Payload length ${data.length} exceeds max ${MAX_PAYLOAD}`);
  }
  const frame = Buffer.allocUnsafe(1 + data.length);
  frame[0] = channel;
  data.copy(frame, 1);
  return frame;
}

export function decode(data: Buffer): Frame {
  if (data.length < 1) {
    throw new RangeError('Frame too short: missing channel byte');
  }
  return {
    channel: data[0],
    payload: data.slice(1),
  };
}

export function encodeResize(cols: number, rows: number): Buffer {
  return encode(CH_RESIZE, JSON.stringify({ cols, rows }));
}

export function encodeControl(msg: Record<string, unknown>): Buffer {
  return encode(CH_CONTROL, JSON.stringify(msg));
}

export function decodeControl(payload: Buffer): Record<string, unknown> {
  return JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
}

// Split a large buffer into frames of at most MAX_PAYLOAD bytes
export function encodeChunked(channel: number, data: Buffer): Buffer[] {
  if (data.length <= MAX_PAYLOAD) return [encode(channel, data)];
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += MAX_PAYLOAD) {
    chunks.push(encode(channel, data.slice(offset, offset + MAX_PAYLOAD)));
  }
  return chunks;
}
