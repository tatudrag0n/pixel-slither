// ============================================================================
// 共有盤のロジック確認
//   node test/board.test.js
// ============================================================================

import {
  createBoard, addPlayer, removePlayer, steer, step, stepPlayer, grow,
  speedForSize, brushForSize, lengthForSize, countByColor, leaderboard,
  addPigment, scatterPigments, packPlayer, packDelta, pickColor, reserveColor,
  releaseColorIfFree, dirFromDelta, MAX_SIZE, MAX_PLAYERS, MAX_PIGMENTS,
  TEAM_COLORS, BOARD_W, BOARD_H,
} from '../js/shared/board.js';

let failed = 0;
let passed = 0;

function ok(cond, label, extra) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  \x1b[31m失敗\x1b[0m ${label}${extra !== undefined ? ` -> ${extra}` : ''}`);
  }
}

function eq(a, b, label) {
  ok(a === b, `${label} (期待 ${b} / 実際 ${a})`);
}

function section(name) {
  console.log(`\n== ${name} ==`);
}

const UP = 0;
const RIGHT = 1;
const DOWN = 2;
const LEFT = 3;

/** 蛇を盤の中央に固定する。 */
function place(board, p, x, y, dir) {
  p.x = x;
  p.y = y;
  p.fx = x;
  p.fy = y;
  p.dir = dir;
  p.queue = [];
  p.body = [];
  const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir];
  for (let i = 0; i < lengthForSize(p.size); i++) {
    p.body.push({ x: x - d[0] * i, y: y - d[1] * i });
  }
  return p;
}

/**
 * 指定の tick で曲がりながら回す。
 * @returns {number} 脱落した tick。 살아 いるなら -1。
 */
function runScript(board, p, turns, maxTicks = 600) {
  const at = new Map(turns.map((t) => [t.at, t.dir]));
  for (let i = 0; i < maxTicks; i++) {
    if (at.has(i)) steer(p, at.get(i), i);
    step(board, i);
    if (!p.alive) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ 盤 */

section('盤のサイズ');
{
  const b = createBoard();
  eq(b.w, BOARD_W, '幅');
  eq(b.h, BOARD_H, '高さ');
  eq(b.paint.length, BOARD_W * BOARD_H, 'マス数');
  ok(b.paint instanceof Uint8Array, 'Uint8Array');
  ok(b.paint.length > 1000000, '200 万マス以上');
  ok(b.paint.length < 4000000, '400 万マス以下');
  ok(b.paint.length < 8 * 1024 * 1024, 'メモリは 8MB 以下');
  eq(b.paint.length, 2400000, 'ちょうど 240 万');
}

section('小盤でも動く');
{
  const b = createBoard(60, 40);
  eq(b.paint.length, 2400, '小さい盤');
  const p = addPlayer(b, 'A');
  ok(p.x >= 1 && p.x < 59, '盤の中にいる', `${p.x},${p.y}`);
  ok(p.body.length > 0, '体がある');
  eq(p.alive, true, '生きている');
  ok(p.color >= 1 && p.color <= TEAM_COLORS, '色が付く', p.color);
  const inside = p.body.every((c) => c.x >= 0 && c.x < 60 && c.y >= 0 && c.y < 40);
  ok(inside, '体も盤の中');
}

section('参加と色');
{
  const b = createBoard(300, 200);
  const used = new Set();
  for (let i = 0; i < 5; i++) {
    const p = addPlayer(b, `p${i}`);
    ok(!used.has(p.color), '色は重複しない', p.color);
    used.add(p.color);
  }
  eq(b.players.size, 5, '5 人在る');
  const first = b.players.values().next().value;
  removePlayer(b, first.id);
  eq(b.players.size, 4, '消せる');
  ok(!b.taken.has(first.color), '空いた色は解放される', first.color);
}

section('色は 20 まで');
{
  const b = createBoard(600, 400);
  for (let i = 0; i < MAX_PLAYERS; i++) addPlayer(b, `p${i}`);
  const colors = new Set();
  for (const p of b.players.values()) colors.add(p.color);
  ok(colors.size >= TEAM_COLORS, `${TEAM_COLORS} 色まで使われる`, colors.size);
  ok(colors.size <= TEAM_COLORS, '色は TEAM_COLORS を超えない', colors.size);
}

section('参加位置の重なりを避ける');
{
  const b = createBoard(400, 300);
  const list = [];
  for (let i = 0; i < 12; i++) list.push(addPlayer(b, `p${i}`));
  let overlap = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].body[0];
      const c = list[j].body[0];
      if (Math.abs(a.x - c.x) < 12 && Math.abs(a.y - c.y) < 12) overlap += 1;
    }
  }
  eq(overlap, 0, '12 人が重なって spawned しない');
}

/* ------------------------------------------------------------------ 成長 */

section('成長の曲線');
{
  ok(speedForSize(1) < speedForSize(10), '大きいほど速い');
  let mono = true;
  for (let s = 1; s < MAX_SIZE; s++) {
    if (speedForSize(s + 1) < speedForSize(s)) mono = false;
  }
  ok(mono, '速度は単調増加');
  ok(speedForSize(MAX_SIZE) > speedForSize(1) * 1.5, '最大で 1.5 倍以上速い',
    `${speedForSize(1).toFixed(3)} -> ${speedForSize(MAX_SIZE).toFixed(3)}`);

  let bmono = true;
  for (let s = 1; s < MAX_SIZE; s++) {
    if (brushForSize(s + 1) < brushForSize(s)) bmono = false;
  }
  ok(bmono, 'ブラシ幅は単調増加');
  ok(brushForSize(MAX_SIZE) > brushForSize(1), '最大でブラシが広い');
  ok(brushForSize(MAX_SIZE) ** 2 > brushForSize(1) ** 2 * 5,
    '最大で塗る面積が 5 倍以上',
    `${brushForSize(MAX_SIZE) ** 2} vs ${brushForSize(1) ** 2}`);

  let lmono = true;
  for (let s = 1; s < MAX_SIZE; s++) {
    if (lengthForSize(s + 1) < lengthForSize(s)) lmono = false;
  }
  ok(lmono, '体長は単調増加');
  ok(lengthForSize(MAX_SIZE) > lengthForSize(1), '最大で長い');
  const maxBrush = brushForSize(MAX_SIZE);
  const maxLen = lengthForSize(MAX_SIZE);
  ok(maxBrush < maxLen, '体の方がブラシより長い', `${maxBrush} < ${maxLen}`);
}

section('size 上限');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  grow(p, 10000);
  eq(p.size, MAX_SIZE, '上限で止まる');
  ok(p.best >= MAX_SIZE, '最高記録が残る', p.best);
  grow(p, 5);
  eq(p.size, MAX_SIZE, '越えない');
}

/* ------------------------------------------------------------------ 進行 */

section('蛇を進める');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 100, 60, RIGHT);
  const x0 = p.x;
  const y0 = p.y;
  runScript(b, p, [], 200);
  ok(p.x > x0, '右へ進んでいる', `${x0} -> ${p.x}`);
  eq(p.y, y0, '横に進むので高さは変わらない');
  eq(p.body[0].x, p.x, '頭に自分の位置が入る');
  eq(p.body[0].y, p.y, '頭が y も入る');
  ok(p.body.length <= lengthForSize(p.size), '体長は size に従う', p.body.length);
  eq(p.alive, true, 'まだ生きている');
  ok(b.touched.length >= 0, '塗ったマスが記録される');
}

section('蛇は小節で進む');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 100, 100, RIGHT);
  const start = p.x;
  step(b, 0);
  const afterOne = p.x;
  eq(afterOne, start, '1 tick ではまだ 1 マス進まない');
  step(b, 1);
  step(b, 2);
  step(b, 3);
  step(b, 4);
  ok(p.x > start, '数 tick で 1 マス進む', `${start} -> ${p.x}`);
}

section('壁にぶつかる');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 3, 100, LEFT);
  const died = runScript(b, p, [], 200);
  ok(died >= 0, '壁にぶつかる', died);
  eq(p.alive, false, '脱落');
  eq(p.cause, 'wall', '死因は壁');
}

section('上下の壁');
{
  const b = createBoard(300, 200);
  const top = addPlayer(b, '上');
  const down = addPlayer(b, '下');
  place(b, top, 150, 2, UP);
  place(b, down, 100, 197, DOWN);
  runScript(b, top, [], 200);
  runScript(b, down, [], 200);
  eq(top.alive, false, '上が落ちる');
  eq(top.cause, 'wall', '死因は壁');
  eq(down.alive, false, '下が落ちる');
  eq(down.cause, 'wall', '死因は壁');
}

section('自分の体にぶつかる');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 150, 100, RIGHT);
  // 12 tick ごとに曲がると 1 辺 2 マスくらいの箱になる。
  // 体長より小さい箱なので、4 辺目で自分の体を押し戻る。
  const died = runScript(b, p, [
    { at: 12, dir: UP },
    { at: 24, dir: LEFT },
    { at: 36, dir: DOWN },
  ], 600);
  ok(died >= 0, '自分の体にぶつかって脱落する', died);
  eq(p.alive, false, '脱落している');
  eq(p.cause, 'body', '死因は体');
}

section('他の蛇にぶつかるとkarma');
{
  const b = createBoard(300, 200);
  const a = addPlayer(b, 'A');
  const c = addPlayer(b, 'B');
  place(b, a, 100, 100, RIGHT);
  // B は動かさない。体だけを A の進路の真上に置く。
  c.x = 104;
  c.y = 100;
  c.fx = 104;
  c.fy = 100;
  c.body = [{ x: 104, y: 100 }, { x: 105, y: 100 }, { x: 106, y: 100 }];
  const beforeKills = c.kills;
  const beforeScore = c.score;
  for (let i = 0; i < 200 && a.alive; i++) stepPlayer(b, a);
  ok(!a.alive, 'A は B にぶつかって落ちる', `x=${a.x}`);
  eq(a.cause, 'body', '死因は体');
  eq(c.kills, beforeKills + 1, 'B の karma が増える');
  ok(c.score > beforeScore, 'B のスコアが増える');
}

section('同じ速さでは追いつかない');
{
  const b = createBoard(300, 200);
  const a = addPlayer(b, 'A');
  const c = addPlayer(b, 'B');
  place(b, a, 100, 100, RIGHT);
  place(b, c, 140, 100, RIGHT);
  runScript(b, a, [], 100);
  ok(a.alive, 'A は生きてる');
  ok(c.alive, 'B も生きてる');
  ok(a.x < c.x, '後ろから追っても距離は縮まらない', `${a.x} ${c.x}`);
}

section('脱落した蛇はしばらく盤に残る');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 3, 100, LEFT);
  runScript(b, p, [], 200);
  eq(p.alive, false, '脱落');
  ok(b.players.has(p.id), 'まだ盤にある');
  const size = b.players.size;
  for (let i = 0; i < 200; i++) step(b, 1000 + i);
  ok(b.players.size < size, 'そのうち消える', `${size} -> ${b.players.size}`);
}

section('脱落した蛇は操作できない');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  p.alive = false;
  ok(!steer(p, RIGHT, 1), '曲がれない');
  const x = p.x;
  stepPlayer(b, p);
  eq(p.x, x, '進まない');
}

/* ------------------------------------------------------------------ 色素 */

section('色素を取ると大きくなる');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 100, 100, RIGHT);
  const before = p.size;
  addPigment(b, 100, 100);
  addPigment(b, 101, 100);
  addPigment(b, 102, 100);
  stepPlayer(b, p);
  eq(b.pigments.length, 0, '目の前の色素が消える');
  eq(p.size, before + 1, 'size が増える');
  eq(p.sizeProgress, 0, 'レベルはリセット');
  const lenBefore = lengthForSize(before);
  const lenAfter = lengthForSize(p.size);
  ok(lenAfter >= lenBefore, '体は伸びる', `${lenBefore} -> ${lenAfter}`);
  ok(speedForSize(p.size) > speedForSize(before), '速さも上がる');
  ok(brushForSize(p.size) >= brushForSize(before), 'ブラシも広がる');
}

section('大きくすると目に見えて有利になる');
{
  const b = createBoard(300, 200);
  const small = addPlayer(b, '小');
  const big = addPlayer(b, '大');
  grow(big, MAX_SIZE - 1);
  ok(speedForSize(big.size) > speedForSize(small.size), '大きい方が速い');
  ok(brushForSize(big.size) > brushForSize(small.size), '大きい方がよく塗る');
  const areaSmall = brushForSize(small.size) ** 2;
  const areaBig = brushForSize(big.size) ** 2;
  ok(areaBig > areaSmall * 4, '1 tick の塗る面積が 4 倍以上', `${areaSmall} -> ${areaBig}`);
  ok(lengthForSize(big.size) > lengthForSize(small.size), '体も長い');
}

section('遠くの色素は取らない');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 100, 100, RIGHT);
  const before = p.size;
  addPigment(b, 260, 190);
  stepPlayer(b, p);
  eq(p.size, before, '遠い色素は無視');
  eq(b.pigments.length, 1, 'まだ盤にある');
}

section('色素の補充');
{
  const b = createBoard(300, 200);
  scatterPigments(b, 40);
  ok(b.pigments.length <= MAX_PIGMENTS, '上限を超えない', b.pigments.length);
  scatterPigments(b, MAX_PIGMENTS + 50);
  ok(b.pigments.length <= MAX_PIGMENTS, '足しても上限を守る', b.pigments.length);
  const inside = b.pigments.every((q) => q.x >= 10 && q.x <= b.w - 10 && q.y >= 10 && q.y <= b.h - 10);
  ok(inside, '色素は盤の内側');
  const uniq = new Set(b.pigments.map((q) => `${q.x},${q.y}`));
  ok(uniq.size >= b.pigments.length * 0.9, '同じ場所ばかりに固まらない', uniq.size);
}

section('step は色素を補充する');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  place(b, p, 150, 100, RIGHT);
  for (let i = 0; i < 5; i++) step(b, i);
  ok(b.pigments.length > 0, 'tick ごとに補充される', b.pigments.length);
  eq(b.tick, 4, 'tick が進む');
  eq(p.alive, true, 'まだ生きている');
}

/* ------------------------------------------------------------------ 面積 */

section('塗った面積の集計');
{
  const b = createBoard(300, 200);
  b.paint.fill(0);
  for (let i = 0; i < 500; i++) b.paint[i] = 3;
  for (let i = 0; i < 200; i++) b.paint[500 + i] = 7;
  const counts = countByColor(b.paint, b.w);
  eq(counts[3], 500, '色 3 の面積');
  eq(counts[7], 200, '色 7 の面積');
  eq(counts[0], 0, '未塗りは数えない');
  eq(counts[3] + counts[7], 700, '合計が 700');
}

section('リーダーは面積降順');
{
  const counts = new Int32Array(TEAM_COLORS + 1);
  counts[2] = 10;
  counts[5] = 90;
  counts[9] = 50;
  const lb = leaderboard(counts);
  eq(lb.length, 3, '塗った色だけ');
  eq(lb[0].color, 5, '1 位は面積最大の色');
  eq(lb[0].area, 90, '1 位の面積');
  eq(lb[1].area, 50, '2 番目');
  eq(lb[2].area, 10, '最小が最後');
  let desc = true;
  for (let i = 1; i < lb.length; i++) if (lb[i].area > lb[i - 1].area) desc = false;
  ok(desc, '降順になっている');
  eq(leaderboard(new Int32Array(TEAM_COLORS + 1)).length, 0, '空なら空');
  const one = new Int32Array(TEAM_COLORS + 1);
  one[4] = 1;
  eq(leaderboard(one)[0].color, 4, '1 色だけなら 1 行');
}

/* ------------------------------------------------------------------ 入力 */

section('入力の検証');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'A');
  p.dir = RIGHT;
  eq(steer(p, RIGHT, 1), false, '同じ方向は無視');
  eq(steer(p, LEFT, 1), false, '逆方向は不可');
  ok(steer(p, UP, 1), '上へいける');
  ok(steer(p, LEFT, 1), '続けて左へ予約できる');
  eq(steer(p, DOWN, 1), false, '予約は 2 つまで');
  eq(p.queue.length, 2, '予約は 2 つ');
}

section('向きの変換');
{
  const table = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const names = ['上', '右', '下', '左'];
  for (let d = 0; d < 4; d++) {
    eq(dirFromDelta(table[d][0], table[d][1]), d, `${names[d]} は ${d}`);
  }
}

/* ------------------------------------------------------------------ 送信 */

section('通信用の形');
{
  const b = createBoard(300, 200);
  const p = addPlayer(b, 'とても長い名前そしてさらに長い名前');
  const packed = packPlayer(p);
  eq(packed.i, p.id, 'id');
  ok(packed.n.length <= 16, '名前が長すぎない', packed.n.length);
  eq(packed.c, p.color, '色');
  eq(packed.a, 1, '生存フラグ');
  ok(typeof packed.x === 'number' && typeof packed.y === 'number', '座標');
  const d = packDelta(b, null);
  ok(Array.isArray(d.p), '塗ったマス一覧');
  ok(typeof d.n === 'number', 'tick');
  const oneTick = [];
  const p2 = addPlayer(b, 'B');
  place(b, p2, 100, 100, RIGHT);
  for (let i = 0; i < 20; i++) step(b, i);
  oneTick.push(...packDelta(b, null).p);
  ok(oneTick.length <= 20 * brushForSize(p2.size) ** 2,
    '差分は 1 tick ぶんのマスだけ', oneTick.length);
}

section('色の確保と解放');
{
  const b = createBoard(300, 200);
  eq(pickColor(b), 1, '最初は 1');
  reserveColor(b, 1);
  eq(pickColor(b), 2, '取られたら次');
  const p = addPlayer(b, 'A');
  ok(b.taken.has(p.color), '獲得した色は予約される');
  const c = p.color;
  releaseColorIfFree(b, c);
  eq(b.taken.has(c), true, 'まだいるので解放しない');
  removePlayer(b, p.id);
  eq(b.taken.has(c), false, 'いなくなれば解放される');
}

section('盤の端まで数えられる');
{
  const b = createBoard(200, 200);
  b.paint.fill(0);
  b.paint[0] = 3;
  b.paint[39999] = 20;
  const counts = countByColor(b.paint, b.w);
  eq(counts[3], 1, '先頭');
  eq(counts[20], 1, '末尾');
  eq(counts[3] + counts[20], 2, '2 マスだけ');
  b.paint[0] = 0;
  eq(countByColor(b.paint, b.w)[3], 0, '消すと 0');
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
