// Bundle budget gate (Req 27.2 to 27.5, 27.8). Each emitted file is gzipped separately at
// level 6; source maps are excluded. The Launch_Screen total counts everything it can load,
// lazy chunks included; the Play_Screen total counts only its initial (static) load.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { INLINE_BUNDLE_MAX, GAME_BUNDLE_MAX } = await import(
  pathToFileURL(path.join(root, 'src/shared/constants.ts')).href
);
const devvit = JSON.parse(readFileSync(path.join(root, 'devvit.json'), 'utf8'));
const clientDir = path.join(root, devvit.post.dir);
const LAZY_ONLY = /^(Distribution|Leaderboard)\b/;

const STATIC_IMPORT =
  /\b(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
const HTML_REF = /\b(?:src|href)\s*=\s*["']([^"']+\.(?:js|css))["']/g;

const isAsset = (f) => f.endsWith('.js') || f.endsWith('.css');

function htmlRefs(htmlFile) {
  const html = readFileSync(htmlFile, 'utf8');
  return [...html.matchAll(HTML_REF)]
    .map((m) => m[1])
    .filter((ref) => !/^[a-z]+:\/\//i.test(ref))
    .map((ref) => path.join(clientDir, ref.replace(/^\.?\//, '')));
}

function jsDeps(file, followDynamic) {
  if (!file.endsWith('.js')) return [];
  const code = readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const refs = [...code.matchAll(STATIC_IMPORT)].map((m) => m[1]);
  if (followDynamic)
    refs.push(...[...code.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]));
  return refs.map((ref) => path.resolve(dir, ref)).filter(isAsset);
}

function closure(starts, followDynamic) {
  const seen = new Set();
  const queue = [...starts];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) continue;
    queue.push(...jsDeps(file, followDynamic));
  }
  return [...seen];
}

let failed = false;
const fail = (msg) => {
  console.error(`check-bundle: ${msg}`);
  failed = true;
};

function measure(label, entryName, budget, followDynamic) {
  const entry = devvit.post.entrypoints[entryName];
  const htmlFile = entry ? path.join(clientDir, entry.entry) : null;
  if (!htmlFile || !existsSync(htmlFile)) {
    fail(`${label}: no built HTML for entrypoint "${entryName}"`);
    return [];
  }
  const files = closure(htmlRefs(htmlFile), followDynamic);
  const missing = files.filter((f) => !existsSync(f));
  for (const f of missing)
    fail(`${label}: referenced file is missing: ${path.relative(root, f)}`);
  const present = files.filter((f) => existsSync(f));
  if (present.length === 0)
    fail(`${label}: entry has no JS or CSS output files`);
  let total = 0;
  for (const f of present) {
    const size = gzipSync(readFileSync(f), { level: 6 }).length;
    total += size;
    console.log(
      `  ${label}  ${path.relative(clientDir, f).padEnd(32)} ${String(size).padStart(8)} B gz`
    );
  }
  console.log(`${label}: ${total} B gz of ${budget} B budget`);
  if (total > budget)
    fail(`${label}: ${total} B gz exceeds the ${budget} B budget`);
  return present;
}

const launchFiles = measure(
  'Launch_Screen',
  'default',
  INLINE_BUNDLE_MAX,
  true
);
const gameFiles = measure('Play_Screen  ', 'game', GAME_BUNDLE_MAX, false);
void launchFiles;

for (const f of gameFiles) {
  if (LAZY_ONLY.test(path.basename(f))) {
    fail(
      `Play_Screen initial load includes lazy-only chunk ${path.basename(f)} (Req 27.4)`
    );
  }
}

if (failed) process.exit(1);
