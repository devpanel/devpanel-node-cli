import { EscapeProcessor } from './escape';

function ep(char: string | null = '~') {
  return new EscapeProcessor(char);
}

function buf(s: string) {
  return Buffer.from(s);
}

describe('EscapeProcessor', () => {
  test('regular input is forwarded', () => {
    const r = ep().process(buf('hello'));
    expect(r.action).toBe('send');
    expect(r.data?.toString()).toBe('hello');
  });

  test('~. at start of session disconnects', () => {
    const p = ep();
    // at line start by default
    const r1 = p.process(buf('~'));
    expect(r1.action).toBe('drop'); // pending
    const r2 = p.process(buf('.'));
    expect(r2.action).toBe('disconnect');
  });

  test('~. in the middle of a line does not disconnect', () => {
    const p = ep();
    // Send 'a' first to move off line start
    p.process(buf('a'));
    const r1 = p.process(buf('~'));
    expect(r1.action).toBe('send'); // forwarded, not at line start
  });

  test('~~ sends a literal ~', () => {
    const p = ep();
    const r1 = p.process(buf('~'));
    expect(r1.action).toBe('drop');
    const r2 = p.process(buf('~'));
    expect(r2.action).toBe('send');
    expect(r2.data?.toString()).toBe('~');
  });

  test('~? returns help action', () => {
    const p = ep();
    p.process(buf('~'));
    const r = p.process(buf('?'));
    expect(r.action).toBe('help');
  });

  test('~<unknown> forwards both chars literally', () => {
    const p = ep();
    p.process(buf('~'));
    const r = p.process(buf('x'));
    expect(r.action).toBe('send');
    expect(r.data?.toString()).toBe('~x');
  });

  test('after Enter key, back at line start', () => {
    const p = ep();
    // Start is at line start
    p.process(buf('hello'));   // moves off line start
    p.process(buf('\r'));      // back to line start
    const r1 = p.process(buf('~'));
    expect(r1.action).toBe('drop');
    const r2 = p.process(buf('.'));
    expect(r2.action).toBe('disconnect');
  });

  test('escape char none: everything is forwarded', () => {
    const p = ep(null);
    const r = p.process(buf('~.'));
    expect(r.action).toBe('send');
    expect(r.data?.toString()).toBe('~.');
  });

  test('helpText contains the escape char', () => {
    const p = ep('~');
    const help = p.helpText();
    expect(help).toContain('~.');
    expect(help).toContain('~~');
  });
});
