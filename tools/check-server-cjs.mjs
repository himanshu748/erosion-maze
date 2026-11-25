// The server bundle must be CommonJS (Req 29.7). vm.Script compiles classic scripts only,
// so any top-level `import` or `export` statement is a SyntaxError here.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devvit = JSON.parse(readFileSync(path.join(root, 'devvit.json'), 'utf8'));
const file = path.join(root, devvit.server.dir, devvit.server.entry);

if (!existsSync(file)) {
  console.error(
    `check-server-cjs: missing server bundle ${path.relative(root, file)}`
  );
  process.exit(1);
}
try {
  new vm.Script(readFileSync(file, 'utf8'), { filename: file });
} catch (err) {
  console.error(
    `check-server-cjs: ${path.relative(root, file)} is not a CommonJS script`
  );
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
console.log(`check-server-cjs: ${path.relative(root, file)} is CommonJS`);
