// ============================================================================
// 全部まとめて回す
//   npm test
//
//   js/ と test/ の構文を Node に確認してから、論理のテストを順に実行する。
//   最後に index.html が読んでいるファイルが全部あるかも見る。
// ============================================================================

import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** ディレクトリの中の .js を再帰的に集める。 */
async function collect(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await collect(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [
  ...(await collect(join(ROOT, 'js'))),
  ...(await collect(join(ROOT, 'server'))),
  ...(await collect(join(ROOT, 'test'))),
];

console.log(`== 構文のチェック ==\n  ${files.length} 個のファイルを見る`);
let syntaxBad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    syntaxBad += 1;
    console.log(`\x1b[31m  失敗\x1b[0m ${f.replace(ROOT, '')}`);
    console.log((r.stderr || '').split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`  ${files.length - syntaxBad} 個 / 失敗 ${syntaxBad}`);
if (syntaxBad) {
  console.log('\n=== 構文のチェックに失敗しました ===');
  process.exit(1);
}

/** テストを走らせる。 */
function run(name) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [join(ROOT, 'test', name)], { stdio: 'inherit' });
    p.on('exit', (code) => res(code ?? 1));
  });
}

/* ----------------------------------------------------- HTML のリンク確認 */

console.log('\n== index.html の読み込み先 ==');
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((v) => !/^(https?:|data:|#|mailto:)/.test(v));
let missing = 0;
for (const ref of refs) {
  try {
    await stat(join(ROOT, ref));
    console.log(`  \x1b[32mOK\x1b[0m   ${ref}`);
  } catch {
    missing += 1;
    console.log(`  \x1b[31m無い\x1b[0m ${ref}`);
  }
}
const needIds = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
console.log(`  参照 ${refs.length} 個 / id ${needIds.length} 個 / 無い ${missing}`);
if (missing) {
  console.log('\n=== 読めないファイルがあります ===');
  process.exit(1);
}

/* --------------------------------------------------------- id の一覧 */

/** main.js が参照している id を集める。 */
const mainSrc = await readFile(join(ROOT, 'js', 'main.js'), 'utf8');
const used = [...mainSrc.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
const notInHtml = [...new Set(used)].filter((id) => !needIds.includes(id));
console.log(`\n== main.js が使う id ==\n  ${new Set(used).size} 個 / HTML に無い ${notInHtml.length}`);
if (notInHtml.length) {
  console.log(`  \x1b[31m${notInHtml.join(', ')}\x1b[0m`);
  console.log('\n=== id が一致しません ===');
  process.exit(1);
}

/* ----------------------------------------------------------------- 実行 */

const suites = [
  'state.test.js',
  'save.test.js',
  'store.test.js',
  'net.test.js',
  'board.test.js',
  'shared.test.js',
  'client-life.test.js',
];
let failed = 0;
for (const s of suites) {
  console.log(`\n\x1b[36m######## ${s} ########\x1b[0m`);
  failed += await run(s);
}

console.log('\n\x1b[36m######## browser.test.js ########\x1b[0m');
failed += await run('browser.test.js');

console.log('\n\x1b[36m######## duel.test.js ########\x1b[0m');
failed += await run('duel.test.js');

console.log(failed
  ? '\n\x1b[31m=== テストに失敗しました ===\x1b[0m'
  : '\n\x1b[32m=== すべて通りました ===\x1b[0m');
process.exit(failed ? 1 : 0);
