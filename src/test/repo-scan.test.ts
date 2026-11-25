import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SRC, importSpecifiers, read, rel, stripComments, walk } from './scan';

const TRACKERS = new Set(['src/client/track.ts', 'src/server/core/track.ts']);
const TOKEN_FILES = new Set(['src/client/tokens.css', 'src/client/tokens.ts']);
const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/;

const appFiles = () =>
  walk(SRC, ['.ts', '.tsx']).filter((f) => !rel(f).startsWith('src/test/'));

describe('repository scans', () => {
  test('22.1 only the two tracker files import @devvit/analytics', () => {
    const offenders = appFiles()
      .filter((f) => !TRACKERS.has(rel(f)))
      .filter((f) =>
        importSpecifiers(stripComments(read(f))).some((s) =>
          s.startsWith('@devvit/analytics')
        )
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test('29.2 client and server never import each other', () => {
    const problems: string[] = [];
    for (const file of appFiles()) {
      const r = rel(file);
      const side = r.startsWith('src/client/')
        ? 'client'
        : r.startsWith('src/server/')
          ? 'server'
          : null;
      if (!side) continue;
      const other = path.join(SRC, side === 'client' ? 'server' : 'client');
      for (const spec of importSpecifiers(stripComments(read(file)))) {
        if (
          spec.startsWith('.') &&
          path.resolve(path.dirname(file), spec).startsWith(other)
        ) {
          problems.push(`${r} imports ${spec}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('26.1 colour literals appear only in the token files', () => {
    const offenders = walk(path.join(SRC, 'client'), [
      '.ts',
      '.tsx',
      '.css',
      '.html',
    ])
      .filter((f) => !TOKEN_FILES.has(rel(f)))
      .filter((f) => COLOUR_LITERAL.test(stripComments(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
    expect(COLOUR_LITERAL.test('color: #1a2b3c')).toBe(true);
    expect(COLOUR_LITERAL.test("getElementById('root')")).toBe(false);
  });
});
