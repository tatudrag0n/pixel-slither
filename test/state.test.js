// ============================================================================
// ゲームのロジック確認
//   node test/state.test.js
// ============================================================================

import {
  createState, step, turn, restart, clearCanvas, setGrid, start,
  put, putPixel, progress, maxLength, resetSnake, recount,
  players, opponentOf, areaOf, areaPercent, timeUp, endRound, setColor,
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
  s.painted = s.paint.length;
  recount(s);
}

/* ------------------------------------------------------------------ 初期化 */

section('初期状態');
{
  const s = createState({ gridId: 's' });
  eq(s.mode, 'solo', '既定は個人戦');
  eq(s.cols, 32, 'S の幅');
  eq(s.rows, 20, 'S の高さ');
  eq(s.me.snake.length, 5, '初期の体の長さ');
  eq(s.painted, 0, '最初は未塗り');
  eq(s.status, 'idle', '最初は待機');
  eq(s.me.dir.x, 1, '最初は右向き');
  ok(s.me.snake[0].x === 16 && s.me.snake[0].y === 10, '頭は中央');
  ok(s.rival === null, '個人戦に相手はいない');
  eq(players(s).length, 1, '参加者は 1 人');
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
  const tail0 = { ...s.me.snake[s.me.snake.length - 1] };
  step(s);
  eq(s.moves, 1, '手数が増える');
  eq(at(s, tail0.x, tail0.y), 3, 'しっぽが離れたマスに色が残る');
  eq(s.painted, 1, '塗り数が 1 増える');
  eq(areaOf(s, 3), 1, '面積も 1');
  eq(s.me.snake.length, 3, '体長は変わらない');
  eq(s.me.snake[0].x, tail0.x + 3, '頭は 1 マスだけ進む');
  eq(s.touched.length, 1, '変化したマスを 1 個 知らせる');
  eq(s.touched[0], tail0.y * s.cols + tail0.x, 'しっぽのマス番号');
}

section('色は頭の現在色');
{
  const s = createState({ gridId: 's', color: 5, length: 3 });
  start(s);
  for (let i = 0; i < 3; i++) step(s);
  setColor(s, 9);
  for (let i = 0; i < 3; i++) step(s);
  const seen = new Set();
  for (let i = 0; i < s.paint.length; i++) if (s.paint[i]) seen.add(s.paint[i]);
  ok(seen.has(5) && seen.has(9), '途中で変えた色が混ざる');
  ok(!seen.has(3), '使わない色は入らない');
  eq(seen.size, 2, '使った色だけが残る');
  eq(areaOf(s, 5) + areaOf(s, 9), 6, '面積の合計が塗り数');
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
  ok(s.painted === areaOf(s, 2), '面積と塗り数が合う');
}

section('消しゴム');
{
  const s = createState({ gridId: 's', color: 6, length: 3, wrap: false });
  fillAll(s, 6);
  s.me.eraser = true;
  start(s);
  const before = s.painted;
  step(s);
  eq(s.painted, before - 1, '1 マスだけ消える');
  eq(areaOf(s, 6), before - 1, '面積も減る');
  ok(s.paint.every((v) => v === 6 || v === 0), '0 が増える');
  for (let i = 0; i < 10; i++) step(s);
  ok(s.painted < before, '進むたびに減る');
}

/* ------------------------------------------------------------------ 画面 */

section('壁をまたぐ');
{
  const s = createState({ gridId: 's', wrap: true, length: 2 });
  s.me.snake = [{ x: 0, y: 5 }, { x: s.cols - 1, y: 5 }];
  s.me.dir = { x: -1, y: 0 };
  start(s);
  step(s);
  eq(s.me.snake[0].x, s.cols - 1, '左端から右端へ出る');
  eq(s.status, 'running', 'まだ動いている');
}

section('上下の境界');
{
  const s = createState({ gridId: 's', wrap: true, length: 2 });
  s.me.snake = [{ x: 5, y: 0 }, { x: 5, y: s.rows - 1 }];
  s.me.dir = { x: 0, y: -1 };
  start(s);
  step(s);
  eq(s.me.snake[0].y, s.rows - 1, '上から下へ出る');
}

section('壁で終了');
{
  const s = createState({ gridId: 's', wrap: false, length: 2 });
  s.me.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }];
  s.me.dir = { x: -1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'over', 'イベントが over');
  eq(s.status, 'over', '状態は over');
  eq(s.me.alive, false, '脱落した');
  eq(s.me.killedBy, 'wall', '死因は壁');
  const moves = s.moves;
  step(s);
  eq(s.moves, moves, '終了後は進まない');
}

/* ------------------------------------------------------------------ 衝突 */

section('自分の体に当たる');
{
  const s = createState({ gridId: 's', length: 5, wrap: false });
  s.risky = true;
  s.me.snake = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 6 },
    { x: 5, y: 6 },
    { x: 4, y: 6 },
  ];
  s.me.dir = { x: 1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'over', '当たって終了');
  eq(s.me.killedBy, 'body', '死因は体');
  ok(s.me.snake[0].x === 5, '頭は動いてない');
  ok(!s.me.alive, '脱落した');
}

section('尾のマスは空いてから通る');
{
  const s = createState({ gridId: 's', length: 4, wrap: false });
  s.risky = true;
  s.me.snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
    { x: 5, y: 6 },
  ];
  s.me.dir = { x: 1, y: 0 };
  start(s);
  const ev = step(s);
  eq(ev.type, 'step', '尾のマスへ進んでよい');
  eq(s.me.snake[0].x, 6, '1 マス進んだ');
}

section('自分の体の上は通れる');
{
  const s = createState({ gridId: 's', length: 5, wrap: false });
  s.risky = false;
  s.me.snake = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 6 },
    { x: 5, y: 6 },
    { x: 4, y: 6 },
  ];
  s.me.dir = { x: 1, y: 0 };
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
  ok(!turn(s.me, 'right'), '同じ方向は受け付けない');
  ok(turn(s.me, 'up'), '上へ曲がれる');
  ok(!turn(s.me, 'down'), '逆方向は受け付けない');
  ok(turn(s.me, 'left'), '続けて左へ予約できる');
  step(s);
  eq(s.me.dir.y, -1, '上向きに進む');
  step(s);
  eq(s.me.dir.x, -1, '続いて左向きに進む');
  ok(!turn(s.me, 'nope'), '知らない向きは無視');
}

section('予約は 2 つまで');
{
  const s = createState({ gridId: 's', length: 3 });
  s.me.dir = { x: 1, y: 0 };
  ok(turn(s.me, 'up'), '1 つ目');
  ok(turn(s.me, 'left'), '2 つ目');
  ok(!turn(s.me, 'down'), '3 つ目は入れない');
  eq(s.me.queue.length, 2, '予約は 2 つ');
  ok(s.me.queue[0].y === -1, '1 つ目が先');
  ok(s.me.queue[1].x === -1, '2 つ目が後');
}

section('待機中は進まない');
{
  const s = createState({ gridId: 's' });
  const ev = step(s);
  eq(ev.type, 'idle', 'イベントが idle');
  eq(s.moves, 0, '手数は 0');
}

section('落ちた蛇は操作できない');
{
  const s = createState({ gridId: 's' });
  s.me.alive = false;
  ok(!turn(s.me, 'up'), '落ちたら曲がれない');
}

/* ------------------------------------------------------------------ クリア */

section('全マス塗るとクリア');
{
  const s = createState({ gridId: 's', color: 3, length: 2 });
  fillAll(s, 3);
  s.paint[0] = 0;
  recount(s);
  s.me.snake = [{ x: 1, y: 0 }, { x: 0, y: 0 }];
  s.me.dir = { x: 1, y: 0 };
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

section('put() と putPixel()');
{
  const s = createState({ gridId: 's' });
  ok(put(s, 2, 3, 7), 'put() は色を置く');
  eq(at(s, 2, 3), 7, 'put() の色');
  eq(s.painted, 1, '塗り数が増える');
  eq(areaOf(s, 7), 1, '面積が増える');
  ok(!put(s, 2, 3, 7), '同じ色は置きなおさない');
  ok(put(s, 2, 3, 0), '0 で消せる');
  eq(s.painted, 0, '塗り数が減る');
  eq(areaOf(s, 7), 0, '面積が減る');
  ok(!put(s, 0, 0, 0), '空のマスは放置');
  ok(putPixel(s, 4, 4, 2), 'putPixel() は直接置ける');
  ok(!putPixel(s, 4, 4, 2), 'putPixel() も同色は無視');
  ok(putPixel(s, 4, 4, 0), '0 で消せる');
  ok(!putPixel(s, 4, 4, 0), 'すでに空なら何もしない');
}

section('塗り直しで面積が動く');
{
  const s = createState({ gridId: 's' });
  put(s, 1, 1, 3);
  eq(areaOf(s, 3), 1, '3 の面積が 1');
  put(s, 1, 1, 4);
  eq(areaOf(s, 3), 0, '3 の面積は 0 になる');
  eq(areaOf(s, 4), 1, '4 の面積が 1');
  eq(s.painted, 1, '塗り数は変わらない');
  ok(s.painted === areaOf(s, 3) + areaOf(s, 4), '面積の合計が塗り数');
}

section('数え直し');
{
  const s = createState({ gridId: 's' });
  s.paint[0] = 5;
  s.paint[9] = 6;
  s.paint[10] = 5;
  s.painted = 999;
  const n = recount(s);
  eq(n, 3, '3 マス');
  eq(s.painted, 3, '塗り数も直る');
  eq(areaOf(s, 5), 2, '5 は 2 マス');
  eq(areaOf(s, 6), 1, '6 は 1 マス');
  eq(areaPercent(s, 5), 2 / (s.cols * s.rows), '割合が合う');
}

/* ------------------------------------------------------------------ 陣営戦 */

section('陣営戦の基本');
{
  const s = createState({ gridId: 's', mode: 'battle', color: 3, rivalColor: 4, length: 4 });
  eq(s.mode, 'battle', 'モードが陣営戦');
  ok(s.rival !== null, '相手がいる');
  eq(players(s).length, 2, '参加者は 2 人');
  eq(s.rival.color, 4, '相手は別の色');
  ok(s.rival.color !== s.me.color, '色は重ならない');
  ok(s.left > 0, '残り時間がある');
  ok(s.rival.isAi, '既定は AI');
  ok(s.me.isLocal, '自分は手前');
  ok(!s.rival.isLocal, '相手は Columns先');
  ok(s.rival.snake[0].x !== s.me.snake[0].x, '2 人は別々に始まる');
  eq(opponentOf(s, s.me), s.rival, '相手の取得');
  eq(opponentOf(s, s.rival), s.me, '相手から見た自分');
  eq(opponentOf(createState(), s.me), null, '個人戦なら null');
}

section('陣営戦の両方が進む');
{
  const s = createState({ gridId: 's', mode: 'battle', color: 3, rivalColor: 4, length: 3 });
  s.me.dir = { x: 1, y: 0 };
  s.me.snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
  s.rival.dir = { x: -1, y: 0 };
  s.rival.snake = [{ x: 25, y: 5 }, { x: 26, y: 5 }, { x: 27, y: 5 }];
  start(s);
  step(s);
  eq(s.moves, 1, '1 tick で 2 人とも');
  eq(s.me.snake[0].x, 6, '自分は右へ');
  eq(s.rival.snake[0].x, 24, '相手は左へ');
  eq(s.painted, 2, '2 マス塗れる');
  ok(areaOf(s, 3) >= 1, '自分の色がある');
  ok(areaOf(s, 4) >= 1, '相手の色がある');
  eq(s.me.snake.length, 3, '体長は変わらない');
  eq(s.rival.snake.length, 3, '相手も変わらない');
  eq(s.status, 'running', 'まだ動いている');
}

section('相手の色を塗り替えられる');
{
  const s = createState({ gridId: 's', mode: 'battle', color: 3, rivalColor: 4, length: 2 });
  put(s, 5, 5, 4);
  eq(areaOf(s, 4), 1, 'まず相手が塗る');
  step(s);
  ok(put(s, 5, 5, 3), '自分の色を置ける');
  eq(areaOf(s, 4), 0, '相手の面積が減る');
  eq(areaOf(s, 3), 1, '自分の面積が増える');
  eq(s.painted, 1, '塗り数は変わらない');
  eq(at(s, 5, 5), 3, 'マスの持ち主が変わる');
}

section('時間切れで終わる');
{
  const s = createState({ gridId: 's', mode: 'battle', seconds: 10, length: 2 });
  eq(s.left, 10, '残り時間');
  ok(!timeUp(s), 'まだ時間がある');
  start(s);
  s.left = 0;
  ok(timeUp(s), '時間切れ');
  ok(endRound(s), 'ラウンド終了できる');
  eq(s.status, 'over', '状態は over');
  ok(!endRound(s), '2 回目は止まる');
  const ev = step(s);
  eq(ev.type, 'idle', '終了後は進まない');
}

section('個人戦は時間切れで終わらない');
{
  const s = createState({ gridId: 's', seconds: 1 });
  s.left = 0;
  ok(!timeUp(s), '個人戦ではしない');
  ok(!endRound(s), '個人戦ではしない');
}

section('片方が落ちても残りは動く');
{
  const s = createState({ gridId: 's', mode: 'battle', length: 2, wrap: false });
  s.rival.snake = [{ x: 0, y: 3 }, { x: 1, y: 3 }];
  s.rival.dir = { x: -1, y: 0 };
  start(s);
  step(s);
  eq(s.rival.alive, false, '相手が脱落');
  eq(s.status, 'over', 'ラウンド終了');
  const before = areaOf(s, 4);
  const s2 = createState({ gridId: 's', mode: 'battle', length: 2 });
  s2.rival.alive = false;
  start(s2);
  step(s2);
  eq(s2.me.snake.length, 2, '自分は進む');
  ok(areaOf(s2, 3) >= 1, '自分は塗れる');
  void before;
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
  eq(areaOf(s, 2), painted, '面積も残る');
  eq(s.moves, 0, '手数は戻る');
  eq(s.elapsed, 0, '時間は戻る');
  eq(s.me.snake.length, 4, '体の長さは戻る');
  eq(s.status, 'idle', '状態は待機');
  eq(s.me.queue.length, 0, '予約も消える');
  ok(s.me.alive, '再び生きている');
}

section('陣営戦のやり直しは時間も戻る');
{
  const s = createState({ gridId: 's', mode: 'battle', length: 3, seconds: 30 });
  start(s);
  for (let i = 0; i < 20; i++) step(s);
  s.left = 3;
  restart(s);
  eq(s.left, 30, '残り時間が戻る');
  eq(s.me.alive && s.rival.alive, true, '2 人とも復帰');
}

section('全消し');
{
  const s = createState({ gridId: 's' });
  start(s);
  for (let i = 0; i < 20; i++) step(s);
  clearCanvas(s);
  eq(s.painted, 0, '塗り数が 0');
  ok(s.paint.every((v) => v === 0), '配列も 0');
  eq(areaOf(s, s.me.color), 0, '面積も 0');
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
  s.me.snake = [];
  resetSnake(s, s.me);
  eq(s.me.snake.length, 6, '体長どおりに並ぶ');
  ok(s.me.snake[0].x > s.me.snake[5].x, '頭が右にある');
  let inside = true;
  for (const p of s.me.snake) if (p.x < 0 || p.x >= s.cols) inside = false;
  ok(inside, '範囲内');
}

section('引数なしでも動く');
{
  const s = createState();
  eq(s.gridId, 'm', '既定は M');
  ok(s.speed >= 1 && s.speed <= 30, '速さが範囲内');
  ok(s.me.color >= 1, '色番号が正');
  eq(s.wrap, true, '壁越しは有効');
  eq(s.risky, false, '既定は死なない');
  ok(s.paint instanceof Uint8Array, '塗り配列がある');
  ok(s.counts instanceof Uint32Array, '面積配列がある');
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
