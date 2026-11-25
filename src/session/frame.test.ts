import {
  CH_CONTROL,
  CH_RESIZE,
  CH_STDIN,
  CH_STDOUT,
  decode,
  decodeControl,
  encode,
  encodeChunked,
  encodeControl,
  encodeResize,
} from './frame';

describe('frame encode/decode', () => {
  test('round-trip for each channel', () => {
    for (const ch of [0, 1, 2, 3, 4]) {
      const payload = Buffer.from('hello');
      const frame = encode(ch, payload);
      const result = decode(frame);
      expect(result.channel).toBe(ch);
      expect(result.payload).toEqual(payload);
    }
  });

  test('encode accepts string payload', () => {
    const frame = encode(CH_STDIN, 'world');
    const result = decode(frame);
    expect(result.payload.toString()).toBe('world');
  });

  test('empty payload round-trip', () => {
    const frame = encode(CH_STDOUT, Buffer.alloc(0));
    const result = decode(frame);
    expect(result.channel).toBe(CH_STDOUT);
    expect(result.payload.length).toBe(0);
  });

  test('exactly 32 KiB payload encodes successfully', () => {
    const payload = Buffer.alloc(32 * 1024, 0x41);
    const frame = encode(CH_STDIN, payload);
    const result = decode(frame);
    expect(result.payload.length).toBe(32 * 1024);
    expect(result.payload).toEqual(payload);
  });

  test('payload over 32 KiB throws RangeError', () => {
    const payload = Buffer.alloc(32 * 1024 + 1);
    expect(() => encode(CH_STDIN, payload)).toThrow(RangeError);
  });

  test('decode on empty buffer throws RangeError', () => {
    expect(() => decode(Buffer.alloc(0))).toThrow(RangeError);
  });

  test('encodeResize produces valid resize frame', () => {
    const frame = encodeResize(120, 40);
    const result = decode(frame);
    expect(result.channel).toBe(CH_RESIZE);
    const json = JSON.parse(result.payload.toString()) as { cols: number; rows: number };
    expect(json).toEqual({ cols: 120, rows: 40 });
  });

  test('encodeControl / decodeControl round-trip', () => {
    const msg = { type: 'exit', exit_code: 3 };
    const frame = encodeControl(msg);
    const result = decode(frame);
    expect(result.channel).toBe(CH_CONTROL);
    expect(decodeControl(result.payload)).toEqual(msg);
  });

  test('encodeChunked splits large data into frames ≤ 32 KiB', () => {
    const data = Buffer.alloc(70 * 1024, 0x42);
    const frames = encodeChunked(CH_STDIN, data);
    expect(frames.length).toBe(3); // 32k + 32k + 6k
    for (const f of frames) {
      expect(f.length - 1).toBeLessThanOrEqual(32 * 1024);
    }
    // Reassemble
    const payloads = frames.map((f) => decode(f).payload);
    const reassembled = Buffer.concat(payloads);
    expect(reassembled).toEqual(data);
  });

  test('encodeChunked with data ≤ 32 KiB returns single frame', () => {
    const data = Buffer.from('small');
    const frames = encodeChunked(CH_STDIN, data);
    expect(frames.length).toBe(1);
  });
});
