// ============================================================================
// ゲームのロジック確認
//   node test/state.test.js
// ============================================================================

import {
  createState, step, turn, restart, clearCanvas, setGrid, start,
  paint, putPixel, countPainted, progress, maxLength, resetSnake,
} from '../js/game/state.js';

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

const at = (s, x, y) => s.paint[y * s.cols + x];

/** 配列を全部塗る。 */
function fillAll(s, color) {
  for (let i = 0; i < s.paint.length; i++) s.paint[i] = color;
  s.painted = countPainted(s.paint);
}

/* ------------------------------------------------------------------ 初期化 */

section('初期状態');
{
  const s = createState({ gridId: 's' });
  eq(s.cols, 32, 'S の幅');
  eq(s.rows, 20, 'S の高さ');
  eq(s.snake.length, 5, '初期の体の長さ');
  eq(s.painted, 0, '最初は未塗り');
  eq(s.status, 'idle', '最初は待機');
  eq(s.dir.x, 1, '最初は右向き');
  ok(s.snake[0].x === 16 && s.snake[0].y === 10, '頭は中央');
}

section('体の長さの上限');
{
  const s = createState({ gridId: 's', length: 99 });
  eq(s.length, maxLength(s), '長すぎる指定は丸められる');
  const t = createState({ gridId: 'l', length: 2 });
  eq(t.length, 2, '短い指定はそのまま');
}

/* ------------------------------------------------------------------ 塗り跡 */

section('しっぽが色を置く');
{
  const s = createState({ gridId: 's', color: 3, length: 3 });
  start(s);
  const tail0 = { ...s.snake[s.snake.length - 1] };
  step(s);
  eq(s.moves, 1, '手数が増える');
  eq(at(s, tail0.x, tail0.y), 3, 'しっぽが離れたマスに色が残る');
  eq(s.painted, 1, '塗り数が 1 増える');
  eq(s.snake.length, 3, '体長は変わらない');
  eq(s.snake[0].x, tail0.x + 3, '頭は 1 マスだけ進む');
}

section('色は頭の現在色');
{
  const s = createState({ gridId: 's', color: 5, length: 3 });
  start(s);
  for (let i = 0; i < 3; i++) step(s);
  s.color = 9;
  for (let i = 0; i < 3; i++) step(s);
  const seen = new Set();
  for (let i = 0; i < s.paint.length; i++) if (s.paint[i]) seen.add(s.paint[i]);
  ok(seen.has(5) && seen.has(9), '途中で変えた色が混ざる');
  ok(!seen.has(3), '使わない色は入らない');
  eq(seen.size, 2, '使った色だけが残る');
}

section('塗り直し');
{
  const s = createState({ gridId: 's', color: 2, length: 3, wrap: false });
  start(s);
  for (let i = 0; i < 3; i++) step(s);
  const first = s.painted;
  ok(first > 0, '塗れている');
  for (let i = 0; i < 3; i++) step(s);
  ok(s.painted > first, '別のマスが増えれば増える');
}

section('消しゴム');
{
  const s = createState({ gridId: 's', color: 6, length: 3, wrap: false });
  fillAll(s, 6);
  s.eraser = true;
  start(s);
  const before = s.painted;
  step(s);
  eq(s.painted, before - 1, '1 マスだけ消える');
  ok(s.paint.every((v) => v === 6 || v === 0), '0 が増える');
  for (let i = 0; i < 10; i++) step(s);
  ok(s.painted < before, '進むたびに減る');
}

/* ------------------------------------------------------------------ 画面 */

section('壁をまたぐ');
{
  const s = createState({ gridId: 's', wrap: true, length: 2 });
  s.snake = [{ x: 0, y: 5 }, { x: s.cols - 1, y: 5 }];
  s.dir = { x: -1, y: 0 };
  start(s);
  step(s);
  eq(s.snake[0].x, s.cols - 1, '左端から右端へ出る');
  eq(s.status, 'running', 'まだ動いている');
}

section('上下の境界');
{
  const s = createState({ gridId: 's', wrap: true, length: 2 });
  s.snake = [{ x: 5, y: 0 }, { x: 5, y: s.rows - 1 }];
  s.dir = { x: 0, y: -1 };
  start(s);
  step(s);
  eq(s.snake[0].y, s.rows - 1, '上から下へ出る');
}

section('壁で終了');
{
  const s = createState({ gridId: 's', wrap: false, length: 2 });
  s.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }];
  s.dir = { x: -1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'over', 'イベントが over');
  eq(s.reason, 'wall', '理由は壁');
  eq(s.status, 'over', '状態は over');
  const moves = s.moves;
  step(s);
  eq(s.moves, moves, '終了後は進まない');
}

/* ------------------------------------------------------------------ 衝突 */

section('自分の体に当たる');
{
  const s = createState({ gridId: 's', risky: true, length: 5, wrap: false });
  s.snake = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 6 },
    { x: 5, y: 6 },
    { x: 4, y: 6 },
  ];
  s.dir = { x: 1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'over', '当たって終了');
  eq(s.reason, 'body', '理由は体');
  eq(s.moves, 0, '手数は進まない');
}

section('尾のマスは空いてから通る');
{
  const s = createState({ gridId: 's', risky: true, length: 4, wrap: false });
  s.snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 5, y: 6 },
  ];
  s.dir = { x: 1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'step', '尾のマスへ進んでよい');
  eq(s.snake[0].x, 6, '1 マス進んだ');
}

section('自分の体の上は通れる');
{
  const s = createState({ gridId: 's', risky: false, length: 5, wrap: false });
  s.snake = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 6 },
    { x: 5, y: 6 },
    { x: 4, y: 6 },
  ];
  s.dir = { x: 1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'step', '体の上でも進める');
  eq(s.status, 'running', '終了しない');
}

/* ------------------------------------------------------------------ 操作 */

section('曲がる');
{
  const s = createState({ gridId: 's' });
  start(s);
  ok(!turn(s, 'right'), '同じ方向は受け付けない');
  ok(turn(s, 'up'), '上へ曲がれる');
  ok(!turn(s, 'down'), '逆方向は受け付けない');
  ok(turn(s, 'left'), '続けて左へ予約できる');
  step(s);
  eq(s.dir.y, -1, '上向きに進む');
  step(s);
  eq(s.dir.x, -1, '続いて左向きに進む');
  ok(!turn(s, 'nope'), '知らない向きは無視');
}

section('予約は 2 つまで');
{
  const s = createState({ gridId: 's', length: 3 });
  s.dir = { x: 1, y: 0 };
  ok(turn(s, 'up'), '1 つ目');
  ok(turn(s, 'left'), '2 つ目');
  ok(!turn(s, 'down'), '3 つ目は入れない');
  eq(s.queue.length, 2, '予約は 2 つ');
  ok(s.queue[0].y === -1, '1 つ目が先');
  ok(s.queue[1].x === -1, '2 つ目が後');
}

section('待機中は進まない');
{
  const s = createState({ gridId: 's' });
  const ev = step(s);
  eq(ev.type, 'idle', 'イベントが idle');
  eq(s.moves, 0, '手数は 0');
}

/* ------------------------------------------------------------------ クリア */

section('全マス塗るとクリア');
{
  const s = createState({ gridId: 's', color: 3, length: 2 });
  fillAll(s, 3);
  s.paint[0] = 0;
  s.painted = countPainted(s.paint);
  s.snake = [{ x: 1, y: 0 }, { x: 0, y: 0 }];
  s.dir = { x: 1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'win', 'クリア判定');
  eq(s.won, true, 'won が立つ');
  eq(s.status, 'won', '状態は won');
  eq(s.painted, s.cols * s.rows, '全マス塗り');
  eq(progress(s), 1, '進捗は 1');
  const moves = s.moves;
  step(s);
  eq(s.moves, moves, 'クリア後は進まない');
}

section('paint() と putPixel()');
{
  const s = createState({ gridId: 's' });
  s.color = 7;
  ok(paint(s, 2, 3), 'paint() は色を置く');
  eq(at(s, 2, 3), 7, 'paint() の色');
  eq(s.painted, 1, '塗り数が増える');
  ok(!paint(s, 2, 3), '同じ色は置きなおさない');
  s.eraser = true;
  ok(paint(s, 2, 3), '消しゴムは 0 を入れる');
  eq(at(s, 2, 3), 0, '空になる');
  eq(s.painted, 0, '塗り数が減る');
  ok(putPixel(s, 4, 4, 2), 'putPixel() は直接置ける');
  eq(s.painted, 1, 'putPixel() も数える');
  ok(!putPixel(s, 4, 4, 2), 'putPixel() も同色は無視');
  ok(putPixel(s, 4, 4, 0), '0 で消せる');
  ok(!putPixel(s, 4, 4, 0), 'すでに空なら何もしない');
  ok(!putPixel(s, 0, 0, 0), '空のマスは放置');
}

/* ------------------------------------------------------------------ 操作群 */

section('やり直し');
{
  const s = createState({ gridId: 's', color: 2, length: 4 });
  start(s);
  for (let i = 0; i < 20; i++) step(s);
  const painted = s.painted;
  ok(painted > 0, '塗れている');
  restart(s);
  eq(s.painted, painted, '絵は残る');
  eq(s.moves, 0, '手数は戻る');
  eq(s.elapsed, 0, '時間は戻る');
  eq(s.snake.length, 4, '体の長さは戻る');
  eq(s.status, 'idle', '状態は待機');
  eq(s.queue.length, 0, '予約も消える');
}

section('全消し');
{
  const s = createState({ gridId: 's' });
  start(s);
  for (let i = 0; i < 20; i++) step(s);
  clearCanvas(s);
  eq(s.painted, 0, '塗り数が 0');
  ok(s.paint.every((v) => v === 0), '配列も 0');
  eq(s.won, false, 'クリアは解除');
  eq(s.status, 'idle', '待機に戻る');
}

section('大きさの変更');
{
  const s = createState({ gridId: 's' });
  start(s);
  for (let i = 0; i < 30; i++) step(s);
  ok(s.painted > 0, '塗れている');
  ok(setGrid(s, 'l'), '大きさ変更できる');
  eq(s.cols, 60, 'L の幅');
  eq(s.rows, 36, 'L の高さ');
  eq(s.painted, 0, '絵は消える');
  eq(s.paint.length, 60 * 36, '配列を作り直す');
  ok(!setGrid(s, 'nope'), '知らない ID は無視');
  eq(s.cols, 60, '知らない ID でも変わらない');
}

section('リセット');
{
  const s = createState({ gridId: 's', length: 6 });
  s.snake = [];
  resetSnake(s);
  eq(s.snake.length, 6, '体長どおりに並ぶ');
  ok(s.snake[0].x > s.snake[5].x, '頭が右にある');
  let inside = true;
  for (const p of s.snake) if (p.x < 0 || p.x >= s.cols) inside = false;
  ok(inside, '範囲内');
}

section('引数なしでも動く');
{
  const s = createState();
  eq(s.gridId, 'm', '既定は M');
  ok(s.speed >= 1 && s.speed <= 30, '速さが範囲内');
  ok(s.color >= 1, '色番号が正');
  eq(s.wrap, true, '壁越しは有効');
  eq(s.risky, false, '体で死なない');
  ok(s.paint instanceof Uint8Array, '塗り配列がある');
}

/* ------------------------------------------------------------------ 通し */

section('実際に塗る (30x10 ぶんの動き)');
{
  const s = createState({ gridId: 's', length: 4, color: 2, speed: 20 });
  s.cols = 30;
  s.rows = 10;
  s.paint = new Uint8Array(300);
  s.snake = [{ x: 0, y: 0 }, { x: 29, y: 0 }, { x: 29, y: 1 }, { x: 28, y: 1 }];
  s.dir = { x: 1, y: 0 };
  s.painted = 0;
  start(s);
  const script = [
    'right', 'right', 'down', 'down', 'down', 'left', 'left', 'left', 'left',
    'up', 'up', 'up', 'right', 'right', 'right', 'right', 'right', 'right',
  ];
  for (const d of script) {
    turn(s, d);
    while (s.queue.length) step(s);
  }
  ok(s.painted > 0, '絵が残る');
  ok(s.painted <= script.length, '塗り数は手数を超えない');
  const uniq = new Set();
  for (let i = 0; i < s.paint.length; i++) if (s.paint[i]) uniq.add(s.paint[i]);
  ok(uniq.size <= 1, '1 色で塗った範囲だけ色がある');
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
