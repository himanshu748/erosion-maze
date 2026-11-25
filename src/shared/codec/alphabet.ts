// base64url alphabet and MSB-first 6-bit packing shared by the three codecs (Req 7.1).
export const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Format version character for version 1 of every codec. */
export const VERSION_1 = 'A';

export type CodecField =
  | 'grid-size'
  | 'walls'
  | 'start'
  | 'exit'
  | 'cell-states'
  | 'heatmap-levels'
  | 'moves';
export type CodecError = {
  readonly kind: 'codec';
  readonly field: CodecField;
  readonly detail: string;
};

export const codecError = (field: CodecField, detail: string): CodecError => ({
  kind: 'codec',
  field,
  detail,
});

const VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUE[ALPHABET.charCodeAt(i)] = i;

/** Six-bit value of the character at `i`, or -1 when it is outside the alphabet. */
export function charValue(s: string, i: number): number {
  const code = s.charCodeAt(i);
  return code < 128 ? (VALUE[code] ?? -1) : -1;
}

/** Packs values most significant bit first, 6 bits per character, zero-padding the tail. */
export class BitWriter {
  private out = '';
  private acc = 0;
  private used = 0;

  write(value: number, bits: number): void {
    for (let b = bits - 1; b >= 0; b--) {
      this.acc = (this.acc << 1) | (Math.floor(value / 2 ** b) & 1);
      if (++this.used === 6) {
        this.out += ALPHABET[this.acc] ?? '';
        this.acc = 0;
        this.used = 0;
      }
    }
  }

  finish(): string {
    if (this.used > 0) this.write(0, 6 - this.used);
    return this.out;
  }
}

/** Reads bits most significant first from characters already checked against the alphabet. */
export class BitReader {
  private pos: number;
  private bit = 0;

  constructor(
    private readonly s: string,
    start: number
  ) {
    this.pos = start;
  }

  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const c = charValue(this.s, this.pos);
      v = v * 2 + ((c >> (5 - this.bit)) & 1);
      if (++this.bit === 6) {
        this.bit = 0;
        this.pos++;
      }
    }
    return v;
  }

  /** True when every bit left in the current character is 0 (the unique-encoding rule). */
  paddingIsZero(): boolean {
    if (this.bit === 0) return true;
    const c = charValue(this.s, this.pos);
    return (c & ((1 << (6 - this.bit)) - 1)) === 0;
  }
}

/** Index of the first character outside the alphabet at or after `from`, or -1. */
export function firstBadChar(s: string, from = 0): number {
  for (let i = from; i < s.length; i++) if (charValue(s, i) < 0) return i;
  return -1;
}
