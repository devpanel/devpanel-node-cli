const ENTER = Buffer.from('\r');

export type EscapeAction = 'send' | 'disconnect' | 'help' | 'drop';

export interface EscapeResult {
  action: EscapeAction;
  // data to forward when action === 'send'
  data?: Buffer;
}

export class EscapeProcessor {
  private escapeChar: string | null;
  private atLineStart = true;
  private pendingEscape = false;

  constructor(escapeChar: string | null = '~') {
    this.escapeChar = escapeChar;
  }

  process(input: Buffer): EscapeResult {
    // Escape processing disabled
    if (this.escapeChar === null) {
      this.updateLineStart(input);
      return { action: 'send', data: input };
    }

    const escByte = Buffer.from(this.escapeChar)[0];

    if (this.pendingEscape) {
      this.pendingEscape = false;
      const ch = input[0];

      if (ch === escByte) {
        // ~~ → send single ~
        this.atLineStart = false;
        return { action: 'send', data: Buffer.from(this.escapeChar) };
      }
      if (ch === 0x2e /* '.' */) {
        return { action: 'disconnect' };
      }
      if (ch === 0x3f /* '?' */) {
        return { action: 'help' };
      }
      // Unknown escape: forward the escape char + this byte literally
      this.atLineStart = false;
      return { action: 'send', data: Buffer.concat([Buffer.from(this.escapeChar), input]) };
    }

    if (this.atLineStart && input[0] === escByte) {
      if (input.length === 1) {
        // Need next byte to decide
        this.pendingEscape = true;
        return { action: 'drop' };
      }
      // More bytes follow — process recursively: drop the ~ and process rest
      this.pendingEscape = true;
      const result = this.process(input.slice(1));
      return result;
    }

    this.updateLineStart(input);
    return { action: 'send', data: input };
  }

  private updateLineStart(data: Buffer): void {
    // We're at start of line after a \r (Enter in raw mode)
    for (let i = 0; i < data.length; i++) {
      this.atLineStart = data[i] === ENTER[0];
    }
  }

  helpText(): string {
    const ec = this.escapeChar ?? '~';
    return (
      `\r\n[devpanel] Escape sequences (must be at start of line):\r\n` +
      `  ${ec}.  Disconnect immediately\r\n` +
      `  ${ec}?  List escape sequences\r\n` +
      `  ${ec}${ec} Send a literal "${ec}"\r\n`
    );
  }
}
