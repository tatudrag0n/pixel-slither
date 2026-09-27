// ============================================================================
// AI と通信のロジック確認
//   node test/net.test.js
// ============================================================================

import { createState, start, step, areaOf, players, turn } from '../js/game/state.js';
import { chooseDir, LEVELS, LEVEL_LIST } from '../js/game/ai.js';
import { Netplay } from '../js/net/netplay.js';
import { makeRoomCode, normalizeRoomCode, isRoomCode } from '../js/net/channel.js';
import { encodePaint, decodePaint } from '../js/game/paint.js';

let failed = 0;
let passed = 0;

function ok(cond, label, extra) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  \x1b[31m失敗\x1b[0m ${label}${extra ? ` -> ${extra}` : ''}`);
  }
}

function eq(a, b, label) {
  ok(a === b, `${label} (期待 ${b} / 実際 ${a})`);
}

function section(name) {
  console.log(`\n== ${name} ==`);
}

/* ------------------------------------------------------------------ AI */

section('AI は常に合法な手を返す');
{
  const s = createState({ gridId: 's', mode: 'battle', length: 4 });
  let legal = true;
  let none = 0;
  for (let i = 0; i < 200; i++) {
    const d = chooseDir(s, s.rival, { level: 'normal', rand: 0.99 });
    if (d === null) {
      none += 1;
      break;
    }
    if (d === 'left' && s.rival.dir.x === 1) legal = false;
    if (d === 'up' && s.rival.dir.y === 1) legal = false;
    if (d === 'down' && s.rival.dir.y === -1) legal = false;
    if (d === 'right' && s.rival.dir.x === -1) legal = false;
    turn(s.rival, d);
    if (s.status !== 'running') start(s);
    step(s);
    if (s.rival.alive) turn(s.rival, d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left');
  }
  ok(legal, '逆方向に進まない');
  ok(none === 0, 'progressが 止まらない');
}

section('AI は未塗りを狙う');
{
  const s = createState({ gridId: 's', mode: 'battle', length: 3 });
  s.rival.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
  s.rival.dir = { x: 1, y: 0 };
  const d = chooseDir(s, s.rival, { level: 'hard', rand: 0.99 });
  ok(d === 'up' || d === 'down', '上下の未塗りを選ぶ', `got ${d}`);
}

section('AI は自分の色を避ける');
{
  // 盤面じゅうが自分の色で、1 マスだけ未塗りがある状態。
  const s = createState({ gridId: 's', mode: 'battle', length: 3, wrap: false });
  for (let i = 0; i < s.paint.length; i++) s.paint[i] = s.rival.color;
  s.paint[5 * s.cols + 4] = 0;
  s.rival.snake = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
  s.rival.dir = { x: 1, y: 0 };
  const d = chooseDir(s, s.rival, { level: 'hard', rand: 0.99 });
  eq(d, 'left', '唯一の未塗りを狙う');
}

section('AI は自分の体に入らない');
{
  // 上が未塗りで、下は自分の体。wrap は有効にして壁のペナルティをさせない。
  const s = createState({ gridId: 's', mode: 'battle', length: 5, wrap: true });
  s.rival.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
  s.rival.dir = { x: 1, y: 0 };
  const d = chooseDir(s, s.rival, { level: 'hard', rand: 0.99 });
  ok(d !== 'right', '自分の体を避ける', `got ${d}`);
  ok(d !== 'down', '次のマスに入っている体も避ける', `got ${d}`);
}

section('AI は壁，走进らない');
{
  const s = createState({ gridId: 's', mode: 'battle', length: 3, wrap: false });
  s.rival.snake = [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }];
  s.rival.dir = { x: 1, y: 0 };
  const d = chooseDir(s, s.rival, { level: 'hard', rand: 0.99 });
  ok(d !== 'left', '壁際で左に進まない', `got ${d}`);
}

section('AI の難易度');
{
  eq(LEVEL_LIST.length, 3, '3 段階');
  ok(LEVELS.easy.look < LEVELS.normal.look, 'やさしいは先読みが浅い');
  ok(LEVELS.normal.look < LEVELS.hard.look, 'つよいは先読みが深い');
  ok(LEVELS.easy.wander > LEVELS.hard.wander, 'やさしいは迷う回数が多い');
  const s = createState({ gridId: 's', mode: 'battle', length: 3 });
  const a = chooseDir(s, s.rival, { level: 'hard', rand: 0.99 });
  const b = chooseDir(s, s.rival, { level: 'hard', rand: 0.99 });
  ok(a === b, '難易度をつよくと同じ手を選ぶ');
  const c = chooseDir(s, s.rival, { level: 'easy', rand: 0.01 });
  ok(typeof c === 'string' || c === null, 'やさしいも手を返す');
}

section('落ちた AI は動かない');
{
  const s = createState({ gridId: 's', mode: 'battle' });
  s.rival.alive = false;
  eq(chooseDir(s, s.rival, {}), null, 'null が返る');
}

/* ------------------------------------------------------------ 部屋コード */

section('部屋コード');
{
  const code = makeRoomCode();
  eq(code.length, 6, '6 文字');
  ok(/^[A-Z0-9]{6}$/.test(code), '英大文字と数字だけ');
  ok(isRoomCode(code), '使える形');
  ok(!isRoomCode('ab'), '短すぎるのは不可');
  ok(!isRoomCode(''), '空は不可');
  eq(normalizeRoomCode(' pix-abc '), 'PIXABC', '読み错的.meを 直す');
  ok(isRoomCode('PIX-ABC'), 'ハイフンや空白は読み飛ばす');
  const many = new Set();
  for (let i = 0; i < 50; i++) many.add(makeRoomCode());
  ok(many.size > 40, 'コードが重複しにくい');
}

/* -------------------------------------------------------------- 通信の箱 */

/** 2 つの Netplay を直接線でつなぐ。 */
function linkPair() {
  const hostInbox = [];
  const guestInbox = [];
  const hostCh = {
    kind: 'test',
    role: 'host',
    ready: true,
    send: (m) => guestInbox.push(m),
    close: () => {},
    onMessage: (cb) => { hostCh._in = cb; },
  };
  const guestCh = {
    kind: 'test',
    role: 'guest',
    ready: true,
    send: (m) => hostInbox.push(m),
    close: () => {},
    onMessage: (cb) => { guestCh._in = cb; },
  };
  return { hostCh, guestCh, hostInbox, guestInbox };
}

function feed(ch, list) {
  for (const m of list) ch._in(m);
}

section('通信の往復');
{
  const { hostCh, guestCh, hostInbox, guestInbox } = linkPair();
  const hs = createState({ gridId: 's', mode: 'battle', color: 3, rivalColor: 4, length: 3 });
  const gs = createState({ gridId: 's', mode: 'battle', color: 5, rivalColor: 4, length: 3 });
  const host = new Netplay(hs, hostCh, { rivalColor: 4 });
  const guest = new Netplay(gs, guestCh, { rivalColor: 3 });
  ok(host.host, 'ホスト役');
  ok(!guest.host, 'ゲスト役');

  // ゲストが参加。ホストに join を送って絵一式を受け取る。
  feed(hostCh, [{ t: 'join', name: 'あいて', color: 5 }]);
  ok(guestInbox.length > 0, 'welcome がguest へ届いた');
  const w = guestInbox[0];
  ok(w && w.t === 'welcome', 'welcome が返る');
  eq(w.rivalColor, 3, 'ホストの色が伝わる');
  eq(hs.rival.color, 5, 'ホストは相手の色を受け取った');
  eq(hs.rival.isAi, false, '相手が AI でなくなる');
  eq(hs.status, 'running', 'ホストは待ち伏せを抜ける');
  eq(gs.rival.color, 3, 'ゲストはホストの色を受け取った');

  // ホストの絵がゲストに届いている。
  const before = gs.painted;
  for (let i = 0; i < 5; i++) {
    host.advance();
    step(hs);
    host.broadcast(hs.touched);
  }
  feed(guestCh, guestInbox.splice(0));
  // ホストの「me」はゲストから見ると相手、その逆も同様。
  eq(gs.rival.snake[0].x, hs.me.snake[0].x, 'ゲストから見た自分がホストの me と同じ位置に');
  eq(gs.me.snake[0].x, hs.rival.snake[0].x, 'ゲストの me がホストの rival と一致');
  eq(gs.me.snake[0].y, hs.rival.snake[0].y, '縦位置も一致');
  eq(gs.painted, hs.painted, '塗り面積が同じ');
  ok(gs.painted > before, '絵が伝わった');
}

section('入力はホストの操作になる');
{
  const { hostCh, guestCh, hostInbox } = linkPair();
  const hs = createState({ gridId: 's', mode: 'battle', color: 3, rivalColor: 4, length: 3 });
  const gs = createState({ gridId: 's', mode: 'battle', color: 5, length: 3 });
  const host = new Netplay(hs, hostCh, {});
  const guest = new Netplay(gs, guestCh, {});
  hs.status = 'running';

  guest.localInput('up');
  eq(hostInbox.length, 1, '入力が 1 つ送られた');
  eq(hostInbox[0].t, 'in', 'in という種類');
  eq(hostInbox[0].d, 'up', '上向き');
  feed(hostCh, hostInbox.splice(0));
  eq(host.inbox.length, 1, 'ホストが受け取った');
  host.advance();
  step(hs);
  eq(hs.rival.queue.length, 0, '予約は消費された');
  eq(hs.rival.dir.y, -1, '相手が上に曲がった');
  ok(hs.rival.snake[0].y < hs.rows / 2, '相手は上へ進んだ');
}

section('ホストは自分の入力をそのまま入れる');
{
  const { hostCh, guestCh } = linkPair();
  const hs = createState({ gridId: 's', mode: 'battle', length: 3 });
  const gs = createState({ gridId: 's', mode: 'battle', length: 3 });
  const host = new Netplay(hs, hostCh, {});
  const guest = new Netplay(gs, guestCh, {});
  guest.localInput('down');
  host.localInput('up');
  ok(hs.me.queue.length === 1, 'ホストの入力はそのまま');
  ok(gs.me.queue.length === 0, 'ゲストは送っただけ');
}

section('差分が絵だけを運ぶ');
{
  const { hostCh, guestCh, guestInbox } = linkPair();
  const hs = createState({ gridId: 's', mode: 'battle', color: 3, rivalColor: 4, length: 3 });
  const gs = createState({ gridId: 's', mode: 'battle', color: 5, rivalColor: 3, length: 3 });
  const host = new Netplay(hs, hostCh, {});
  const guest = new Netplay(gs, guestCh, {});
  hs.status = 'running';
  host.advance();
  step(hs);
  host.broadcast(hs.touched);
  const f = guestInbox.pop();
  ok(f && f.t === 'f', '毎 tick 1 フレーム');
  ok(Array.isArray(f.p), '塗り替えが入っている');
  ok(f.p.length <= 4, '1 フレームで変わるマスは少ない', `len=${f.p.length}`);
  ok(typeof f.l === 'number', '残り時間が入っている');
  ok(Array.isArray(f.s) && f.s.length === 2, '2 人の蛇');
  feed(guestCh, [f]);
  eq(gs.painted, hs.painted, '塗り面積が一致');
  eq(gs.left, hs.left, '残り時間が一致');
  ok(players(gs).length === 2, 'ゲストも 2 人');
}

section('残り時間の同期');
{
  const { hostCh, guestCh, guestInbox } = linkPair();
  const hs = createState({ gridId: 's', mode: 'battle', length: 3, seconds: 60 });
  const gs = createState({ gridId: 's', mode: 'battle', length: 3, seconds: 60 });
  const host = new Netplay(hs, hostCh, {});
  new Netplay(gs, guestCh, {});
  hs.status = 'running';
  hs.left = 12.5;
  host.broadcast([]);
  feed(guestCh, guestInbox.splice(0));
  eq(gs.left, 12.5, '残り時間が来信る');
  hs.status = 'over';
  host.broadcast([]);
  feed(guestCh, guestInbox.splice(0));
  eq(gs.status, 'over', '終了も伝わる');
}

section('参加時の絵一式');
{
  const { hostCh, guestCh, hostInbox, guestInbox } = linkPair();
  const hs = createState({ gridId: 's', mode: 'battle', color: 3, rivalColor: 4, length: 3 });
  const gs = createState({ gridId: 's', mode: 'battle', color: 5, length: 3 });
  const host = new Netplay(hs, hostCh, {});
  new Netplay(gs, guestCh, {});
  // ホストが途中まで途中まで塗った状態にする。
  for (let i = 0; i < 30; i++) {
    hs.paint[(i * 7) % hs.paint.length] = 3;
  }
  hs.painted = 30;
  const counts = areaOf(hs, 3);
  feed(hostCh, [{ t: 'join', color: 5 }]);
  const w = guestInbox[0];
  ok(w && w.t === 'welcome', 'welcome');
  const paint = decodePaint(w.paint, gs.cols * gs.rows);
  let same = true;
  for (let i = 0; i < paint.length; i++) if (paint[i] !== hs.paint[i]) same = false;
  ok(same, '絵が丸ごと届く');
  gs.paint = paint;
  eq(areaOf(gs, 3), counts, '面積も合う');
  ok(guestInbox.length === 1, 'welcome は 1 つだけ');
  void hostInbox;
}

section('切断の合図');
{
  const { hostCh, guestCh } = linkPair();
  const gs = createState({ gridId: 's', mode: 'battle' });
  let said = '';
  const g = new Netplay(gs, guestCh, { onStatus: (t) => { said = t; } });
  ok(g.connected, '最初はつながっている');
  feed(guestCh, [{ t: 'bye' }]);
  ok(!g.connected, '切断で false');
  ok(said.includes('切断'), '切断の文言が出る', said);
  void hostCh;
}

section('絵の Base64 経由の往復');
{
  const s = createState({ gridId: 's' });
  s.paint[0] = 3;
  s.paint[100] = 17;
  s.paint[639] = 20;
  const back = decodePaint(encodePaint(s.paint), s.paint.length);
  let same = true;
  for (let i = 0; i < s.paint.length; i++) if (back[i] !== s.paint[i]) same = false;
  ok(same, '往復しても同じ絵');
  eq(back.length, s.paint.length, '長さも戻る');
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
