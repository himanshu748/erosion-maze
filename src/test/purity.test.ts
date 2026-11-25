import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SRC, importSpecifiers, read, rel, stripComments, walk } from './scan';

// Shared_Core must stay pure: no Devvit, clock, randomness, locale, network or storage.
const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/\bDate\.now\b/, 'Date.now'],
  [/\bperformance\.now\b/, 'performance.now'],
  [/\bnew\s+Date\s*\(\s*\)/, 'argument-free new Date()'],
  [
    /\.(?:getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|getTimezoneOffset|setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds|setMilliseconds)\s*\(/,
    'local-time Date method',
  ],
  [/\btoLocale\w*/, 'toLocale*'],
  [/\bIntl\b/, 'Intl'],
  [/\bMath\.random\b/, 'Math.random'],
  [/\bcrypto\b/, 'crypto'],
  [/\bfetch\s*\(/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
];

function badImport(spec: string, file: string): string | null {
  if (spec === 'devvit' || spec.startsWith('@devvit/'))
    return `Devvit import ${spec}`;
  if (/^(?:node:)?fs(?:\/promises)?$/.test(spec)) return `fs import ${spec}`;
  if (spec.startsWith('.')) {
    const target = path.resolve(path.dirname(file), spec);
    if (!target.startsWith(path.join(SRC, 'shared')))
      return `import outside src/shared: ${spec}`;
  }
  return null;
}

describe('Shared_Core purity', () => {
  test('29.3 and 29.9 shared core purity scan', () => {
    const problems: string[] = [];
    for (const file of walk(path.join(SRC, 'shared'), ['.ts', '.tsx'])) {
      const code = stripComments(read(file));
      for (const spec of importSpecifiers(code)) {
        const why = badImport(spec, file);
        if (why) problems.push(`${rel(file)}: ${why}`);
      }
      for (const [re, name] of FORBIDDEN) {
        if (re.test(code)) problems.push(`${rel(file)}: uses ${name}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('the scan flags forbidden code', () => {
    const sample = stripComments(
      'const t = Date.now(); // Intl in a comment is fine\nMath.random();'
    );
    const hits = FORBIDDEN.filter(([re]) => re.test(sample)).map(
      ([, name]) => name
    );
    expect(hits).toEqual(['Date.now', 'Math.random']);
    expect(
      badImport('@devvit/web/server', path.join(SRC, 'shared/x.ts'))
    ).not.toBeNull();
    expect(
      badImport('../server/x', path.join(SRC, 'shared/x.ts'))
    ).not.toBeNull();
    expect(badImport('./maze', path.join(SRC, 'shared/x.ts'))).toBeNull();
  });
});
