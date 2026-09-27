// ============================================================================
// 保存数据的来回
//   node test/store.test.js
// ============================================================================

import {
  initStore, saveState, loadData, saveRecord, loadRecords, clearSavedGame, wipeAll,
} from '../js/core/save.js';
import { createState, start, step, recount } from '../js/game/state.js';
import { setCustomColor, customColors, COLORS, CUSTOM_FROM } from '../js/data/colors.js';

/** ブラウザの localStorage と同じだけの器。 */
function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

let failed = 0;
let passed = 0;

function ok(cond, label) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  \x1b[31m失敗\x1b[0m ${label}`);
  }
}

function eq(a, b, label) {
  ok(a === b, `${label} (期待 ${b} / 実際 ${a})`);
}

function section(name) {
  console.log(`\n== ${name} ==`);
}

const store = fakeStorage();
initStore(store);

/* ------------------------------------------------------------------ 保存 */

section('絵を保存して戻す');
{
  const s = createState({ gridId: 's', color: 8, length: 4, speed: 11 });
  start(s);
  for (let i = 0; i < 25; i++) step(s);
  ok(s.painted > 0, '塗れている');
  saveState(s);

  const back = loadData();
  ok(back && back.state, '復元できた');
  const t = back.state;
  eq(t.cols, s.cols, '幅が同じ');
  eq(t.rows, s.rows, '高さが同じ');
  eq(t.me.color, 8, '頭の色が戻る');
  eq(t.speed, 11, '速さが戻る');
  eq(t.length, 4, '体長が戻る');
  eq(t.moves, s.moves, '手数が戻る');
  eq(t.painted, s.painted, '塗り数が戻る');
  eq(t.paint.length, s.paint.length, '配列の長さが同じ');
  let same = true;
  for (let i = 0; i < s.paint.length; i++) if (t.paint[i] !== s.paint[i]) same = false;
  ok(same, '絵が完全に一致');
  eq(t.me.snake.length, s.me.snake.length, '体の長さも戻る');
  ok(t.me.snake[0].x === s.me.snake[0].x && t.me.snake[0].y === s.me.snake[0].y, '頭の位置が戻る');
  eq(t.status, 'paused', '走行中は一時停止で戻る');
}

section('待機状態は待機のまま戻る');
{
  const s = createState({ gridId: 's' });
  saveState(s);
  eq(loadData().state.status, 'idle', 'idle のまま');
}

section('一時停止は一時停止で戻る');
{
  const s = createState({ gridId: 's' });
  s.status = 'paused';
  saveState(s);
  eq(loadData().state.status, 'paused', 'paused のまま');
}

section('クリア済みの状態も戻る');
{
  const s = createState({ gridId: 's' });
  s.status = 'won';
  s.won = true;
  saveState(s);
  const t = loadData().state;
  eq(t.won, true, 'won が立つ');
  eq(t.status, 'won', '状態も won');
  eq(t.moves, 0, '手数は戻る');
}

section('カスタム色も戻る');
{
  const s = createState({ gridId: 's' });
  setCustomColor(0, '#abcdef');
  setCustomColor(1, '#fedcba');
  saveState(s);
  setCustomColor(0, '#000000');
  setCustomColor(1, '#111111');
  loadData();
  eq(COLORS[CUSTOM_FROM].hex, '#abcdef', '1 つ目が戻る');
  eq(COLORS[CUSTOM_FROM + 1].hex, '#fedcba', '2 つ目が戻る');
  setCustomColor(0, '#00bbf9');
  setCustomColor(1, '#d00000');
}

/* ------------------------------------------------------------------ 防御 */

section('壊れたデータにも耐える');
{
  const bad = fakeStorage({ 'pixel-slither.v1': '{これは JSON ではない' });
  const s = createState({ gridId: 's' });
  const before = customColors();
  saveState(s);
  const saved = store.dump();
  initStore(bad);
  bad.setItem('pixel-slither.v1', saved['pixel-slither.v1']);
  const t = createState({ gridId: 's' });
  ok(loadData() !== undefined, '読めなくても例外を投げない');
  initStore(store);
  ok(Array.isArray(customColors()), '色は残る');
  ok(customColors().length === before.length, '色の数は変わらない');
  void t;
}

section('蛇の座標が範囲外なら中央に戻す');
{
  const s = createState({ gridId: 's', length: 4 });
  saveState(s);
  const raw = JSON.parse(store.getItem('pixel-slither.v1'));
  raw.game.snake = [[999, 999], [1, 1], [2, 2], [3, 3]];
  store.setItem('pixel-slither.v1', JSON.stringify(raw));
  const t = loadData().state;
  eq(t.me.snake.length, 4, '長さは保つ');
  let inside = true;
  for (const p of t.me.snake) if (p.x < 0 || p.x >= t.cols || p.y < 0 || p.y >= t.rows) inside = false;
  ok(inside, '全部キャンバスの中');
}

section('体の長さが変わっていた場合');
{
  const s = createState({ gridId: 's', length: 5 });
  saveState(s);
  const raw = JSON.parse(store.getItem('pixel-slither.v1'));
  raw.game.snake = [[1, 1], [2, 1]];
  store.setItem('pixel-slither.v1', JSON.stringify(raw));
  const t = loadData().state;
  eq(t.me.snake.length, 5, '設定どおりの長さになる');
  ok(t.me.snake[0].x === 16 && t.me.snake[0].y === 10, '頭は中央');
}

section('塗った数の検算');
{
  const s = createState({ gridId: 's' });
  for (let i = 0; i < 50; i++) s.paint[i] = (i % 5) + 1;
  recount(s);
  saveState(s);
  const raw = JSON.parse(store.getItem('pixel-slither.v1'));
  raw.game.painted = 999;
  store.setItem('pixel-slither.v1', JSON.stringify(raw));
  const t = loadData().state;
  eq(t.painted, 50, '配列から数え直す');
}

/* ------------------------------------------------------------------ 記録 */

section('ベスト記録');
{
  clearSavedGame();
  ok(saveRecord('s', { moves: 500, time: 70 }), '初めてなら記録される');
  ok(!saveRecord('s', { moves: 500, time: 70 }), '同じ手数では更新されない');
  ok(!saveRecord('s', { moves: 600, time: 90 }), '遅い記録は捨てられる');
  ok(saveRecord('s', { moves: 400, time: 90 }), '速い記録は入る');
  const rec = loadRecords().s;
  eq(rec.moves, 400, '手数が残る');
  eq(rec.time, 90, '時間が残る');
  ok(!saveRecord('s', { moves: 450, time: 50 }), '手数が多い記録は入れない');
  eq(loadRecords().s.moves, 400, '記録が変わらない');
  ok(saveRecord('m', { moves: 999, time: 99 }), '大きさが違えば別枠');
  eq(loadRecords().m.moves, 999, '別の枠に保存');
  eq(loadRecords().s.moves, 400, '元の枠はそのまま');
  ok(saveState(createState({ gridId: 's' })), '記録を残したまま絵を保存できる');
  eq(loadRecords().s.moves, 400, '絵を保存しても記録は残る');
}

section('全消しと全削除');
{
  clearSavedGame();
  const raw = JSON.parse(store.getItem('pixel-slither.v1'));
  ok(!raw.game, '絵だけ消える');
  ok(raw.records, '記録は残る');
  wipeAll();
  eq(store.getItem('pixel-slither.v1'), null, '何も残らない');
  ok(loadData().state === null, '保存する絵が無ければ state は null');
  ok(loadRecords() && !loadRecords().s, '記録も空');
}

section('保存できない環境');
{
  const broken = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('quota'); },
  };
  initStore(broken);
  const s = createState({ gridId: 's' });
  ok(saveState(s), '書き込めない環境でも代用の領域に残る');
  ok(wipeAll() === undefined, '削除も例外を投げない');
  initStore(store);
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
