// ============================================================================
// 共有盤のサーバー確認
//   node test/shared.test.js
//
// Cloudflare の型を宙fake して、Durable Object のロジックを
// 実際に回す。デプロイしなくても配線の正しい���が分かる。
// デプロイしなくても配線の正しい���が分かる。

import { SharedBoard, encodeBase64, decodeBase64, packCells } from '../server/board-do.js';
import { createBoard, addPlayer, MAX_SIZE, TEAM_COLORS } from '../js/shared/board.js';

/* ---------------------------------------------------------------- fake */

function fakeStorage() {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    put: (kv) => {
      const list = Array.isArray(kv) ? kv : Object.entries(kv);
      for (const [k, v] of list) m.set(k, v);
    },
    delete: (k) => m.delete(k),
    keys: () => [...m.keys()],
    size: () => m.size,
  };
}

/** 送られた文字列を溜めるだけのソケット。 */
function fakeSocket(id) {
  const out = [];
  const handlers = {};
  const sock = {
    id,
    playerId: 0,
    seen: 0,
    out,
    handlers,
    ws: {
      open: true,
      send(text) {
        if (sock.ws.open) out.push(text);
      },
      close() {
        sock.ws.open = false;
      },
      addEventListener(name, fn) {
        handlers[name] = fn;
      },
    },
    /** 中身を全部 JSON にして返す。 */
    drain() {
      return this.out.splice(0).map((t) => JSON.parse(t));
    },
    /** 種類 type のフレームだけを返す。 */
    of(type) {
      return this.out.splice(0).map((t) => JSON.parse(t)).filter((m) => m.t === type);
    },
  };
  return sock;
}

function makeDo(storage) {
  const dobj = new SharedBoard({ storage }, {});
  // 巨大な盤を作らないで済むよう、小さめにして tick を直接回せるようにする。
  return dobj;
}

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

/* ------------------------------------------------------------- 符号化 */

section('Base64 の往復');
{
  const src = new Uint8Array(1000);
  for (let i = 0; i < src.length; i++) src[i] = (i * 7) % 21;
  const back = decodeBase64(encodeBase64(src), src.length);
  let same = true;
  for (let i = 0; i < src.length; i++) if (back[i] !== src[i]) same = false;
  ok(same, '1KB 往復');
  ok(back.length === src.length, '長さが戻る');
  const big = new Uint8Array(2400000);
  ok(decodeBase64(encodeBase64(big), big.length).length === 2400000, '240 万マスも扱える');
  const short = decodeBase64('AAA', 10);
  eq(short.length, 10, '短い文字列でも指定した長さ');
  let allZero = true;
  for (let i = 0; i < short.length; i++) if (short[i] !== 0) allZero = false;
  ok(allZero, '足りない分は 0');
}

section('塗ったマスの詰め方');
{
  const paint = new Uint8Array(1000);
  paint[0] = 3;
  paint[300] = 17;
  paint[999] = 1;
  const s = packCells(paint, [0, 300, 999]);
  eq(s.length, 9, '1 マス 3 文字');
  const read = (i) => s.charCodeAt(i * 3 + 2) - 0x20;
  const idx = (i) => (s.charCodeAt(i * 3) - 0x20) * 256 + (s.charCodeAt(i * 3 + 1) - 0x20);
  eq(read(0), 3, '先頭の色');
  eq(idx(0), 0, '先頭の index');
  eq(read(1), 17, '真ん中の色');
  eq(idx(1), 300, '真ん中の index');
  eq(read(2), 1, '末尾の色');
  eq(idx(2), 999, '末尾の index');
  eq(packCells(paint, []), '', '空なら空文字');
}

/* --------------------------------------------------------- DO の動き */

section('参加');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'アリス' }));
  const w = a.of('w');
  eq(w.length, 1, 'welcome が 1 つ');
  const msg = w[0];
  eq(msg.t, 'w', 'welcome');
  eq(msg.id, a.playerId, '自分の識別子が入ってる');
  ok(msg.w > 0 && msg.h > 0, '盤の大きさが来る', `${msg.w}x${msg.h}`);
  ok(typeof msg.paint === 'string' && msg.paint.length > 0, '盤が Base64 で来る');
  ok(Array.isArray(msg.p) && msg.p.length === 1, '蛇が 1 匹');
  eq(msg.p[0].n, 'アリス', '名前');
  ok(msg.c >= 1 && msg.c <= TEAM_COLORS, '色が付く', msg.c);
  ok(Array.isArray(msg.g), 'pigment が来る');
  ok(Array.isArray(msg.l), 'リーダーが来る');
  eq(d.board.players.size, 1, '盤に 1 匹');
}

section('人数制限');
{
  const d = makeDo(fakeStorage());
  const socks = [];
  for (let i = 0; i < 70; i++) {
    const s = fakeSocket(i + 1);
    socks.push(s);
    d.sockets.set(s.id, s);
    d.onMessage(s, JSON.stringify({ t: 'j', n: `p${i}` }));
  }
  const rejected = socks.filter((s) => s.out.some(() => true));
  void rejected;
  const full = socks.filter((s) => {
    const msgs = s.out.splice(0).map((t) => JSON.parse(t));
    return msgs.some((m) => m.t === 'x');
  });
  ok(full.length > 0, '溢れた者には拒否が返る', full.length);
  ok(d.board.players.size <= 64, '盤の蛇は 64 以下', d.board.players.size);
}

section('tick を回すと配る');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  a.out.length = 0;
  for (let i = 0; i < 30; i++) d.loop();
  const frames = a.drain().filter((m) => m.t === 'f');
  ok(frames.length >= 20, '毎 tick フレームが来る', frames.length);
  eq(frames[0].n, 1, 'tick 番号が並ぶ');
  let painted = 0;
  for (const f of frames) if (f.p) painted += f.p.length / 3;
  ok(painted > 0, '塗ったマスが配られる', painted);
  const leader = a.drain().length;
  void leader;
  const l = d.rows();
  ok(l.length >= 1, 'リーダーが取れる', JSON.stringify(l));
  ok(l[0][1] > 0, '先頭の色に面積がある', l[0][1]);
}

section('差分に色が含まれる');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  a.out.length = 0;
  for (let i = 0; i < 20; i++) d.loop();
  const frames = a.drain().filter((m) => m.t === 'f' && m.p);
  const last = frames[frames.length - 1];
  const cells = [];
  for (let i = 0; i + 2 < last.p.length; i += 3) {
    const idx = (last.p.charCodeAt(i) - 0x20) * 256 + (last.p.charCodeAt(i + 1) - 0x20);
    const color = last.p.charCodeAt(i + 2) - 0x20;
    cells.push([idx, color]);
  }
  ok(cells.length > 0, 'マスと色が入ってる', cells.length);
  const myColor = d.board.players.get(a.playerId).color;
  ok(cells.every(([, c]) => c === myColor), '自分の色になっている',
    cells.map((x) => x[1]).join(','));
  let match = true;
  for (const [idx, color] of cells) if (d.board.paint[idx] !== color) match = false;
  ok(match, '盤の状態と一致する');
}

section('入力が届く');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  const p = d.board.players.get(a.playerId);
  p.dir = 1;
  d.onMessage(a, JSON.stringify({ t: 'i', d: 0 }));
  eq(p.queue.length, 1, '予約に入る');
  eq(p.queue[0], 0, '上向き');
  d.onMessage(a, JSON.stringify({ t: 'i', d: 2 }));
  eq(p.queue.length, 1, '逆方向は入らない');
  d.onMessage(a, '{壊れた JSON}');
  ok(p.alive, '壊れた JSON で死なない');
  d.onMessage(a, JSON.stringify({ t: 'x' }));
  ok(p.alive, '知らない種類は無視');
}

section('切断で蛇が消える');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  const b = fakeSocket(2);
  d.sockets.set(a.id, a);
  d.sockets.set(b.id, b);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  d.onMessage(b, JSON.stringify({ t: 'j', n: 'B' }));
  eq(d.board.players.size, 2, '2 匹');
  const colorA = d.board.players.get(a.playerId).color;
  d.onClose(a);
  eq(d.board.players.size, 1, '切れた側が消える');
  eq(d.sockets.size, 1, 'ソケットも消える');
  ok(!d.board.taken.has(colorA), '色が解放される', colorA);
}

section('脱落の通知');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  const p = d.board.players.get(a.playerId);
  a.out.length = 0;
  // 盤の端に置いて壁へ衝突させる。
  p.x = 2;
  p.y = 2;
  p.fx = 2;
  p.fy = 2;
  p.dir = 3;
  p.body = [{ x: 2, y: 2 }];
  for (let i = 0; i < 40 && p.alive; i++) d.loop();
  ok(!p.alive, '脱落する');
  const gone = a.drain().filter((m) => m.t === 'o');
  eq(gone.length, 1, '脱落が 1 回だけ伝わる');
  eq(gone[0].c, 'wall', '死因も来る');
  ok(typeof gone[0].s === 'number', 'サイズも来る');
}

section('復活で色を選べる');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  const p = d.board.players.get(a.playerId);
  const myId = p.id;
  p.alive = false;
  p.linger = 0;
  a.out.length = 0;
  const want = p.color === 7 ? 9 : 7;
  d.onMessage(a, JSON.stringify({ t: 'r', c: want }));
  const yes = a.of('y');
  eq(yes.length, 1, '復活の応答が来る');
  eq(yes[0].c, want, '選んだ色で入ってる');
  const back = d.board.players.get(myId);
  ok(back, '同じ id で戻ってくる', myId);
  eq(back.color, want, '色が反映されている');
  eq(back.alive, true, '生きている');
  ok(back.body.length > 0, '体がある');
  ok(back.x > 0 && back.x < d.board.w, '盤の中', `${back.x},${back.y}`);
}

section('生きているときは復活できない');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  a.out.length = 0;
  d.onMessage(a, JSON.stringify({ t: 'r', c: 15 }));
  eq(a.drain().filter((m) => m.t === 'y').length, 0, '無視される');
  const p = d.board.players.get(a.playerId);
  ok(p.alive, 'まだ生きている');
}

section('使われている色は渡らない');
{
  const d = makeDo(fakeStorage());
  const a = fakeSocket(1);
  const b = fakeSocket(2);
  d.sockets.set(a.id, a);
  d.sockets.set(b.id, b);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  d.onMessage(b, JSON.stringify({ t: 'j', n: 'B' }));
  const pa = d.board.players.get(a.playerId);
  const pb = d.board.players.get(b.playerId);
  const taken = pb.color;
  pa.alive = false;
  pa.linger = 0;
  a.out.length = 0;
  d.onMessage(a, JSON.stringify({ t: 'r', c: taken }));
  const yes = a.of('y');
  eq(yes.length, 1, '応答は来る');
  ok(yes[0].c !== taken, '使われている色は譲らない', `${yes[0].c} vs ${taken}`);
}

section('保存と復元');
{
  const storage = fakeStorage();
  const d = new SharedBoard({ storage }, {});
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  for (let i = 0; i < 40; i++) d.loop();
  d.persist();
  const keys = storage.keys();
  ok(keys.includes('meta'), 'meta がある');
  ok(keys.some((k) => k.startsWith('p')), 'paint のチャンクがある', keys.length);
  const meta = storage.get('meta');
  ok(meta.w > 0, 'meta に幅');
  ok(Array.isArray(meta.pigments), 'meta に pigment');
  ok(meta.n > 1, 'チャンク数が 2 以上', meta.n);

  // 新しい DO を作って復元できる。
  const d2 = new SharedBoard({ storage }, {});
  let same = 0;
  for (let i = 0; i < 5000; i++) {
    if (d2.board.paint[i] === d.board.paint[i]) same += 1;
  }
  eq(same, 5000, '復元した盤が一致する');
  eq(d2.board.pigments.length, d.board.pigments.length, 'pigment も戻る');
}

section('変更したチャンクだけ書く');
{
  const storage = fakeStorage();
  const d = new SharedBoard({ storage }, {});
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  for (let i = 0; i < 40; i++) d.loop();
  d.persist();
  eq(d.dirtyChunks.size, 0, '保存後は空');
  // 少し回してまた保存する。前回より書き���先が減っているはず。
  for (let i = 0; i < 40; i++) d.loop();
  ok(d.dirtyChunks.size < 40, '全部は書き直さない', d.dirtyChunks.size);
  d.persist();
  eq(d.dirtyChunks.size, 0, '保存後はまた空');
}

section('レイアウトや直さない');
{
  const d = new SharedBoard({ storage: fakeStorage() }, {});
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  eq(d.sockets.size, 1, '1 人');
  d.ensureTimer();
  ok(d.timer, 'タイマーが立つ');
  d.onClose(a);
  eq(d.sockets.size, 0, '切れると 0');
  ok(!d.timer, '誰もいなければタイマーを止める');
}

section('盤のサマリー');
{
  const d = new SharedBoard({ storage: fakeStorage() }, {});
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  for (let i = 0; i < 20; i++) d.loop();
  const st = d.stats();
  eq(st.players, 1, '参加人数');
  eq(st.snakes, 1, '蛇の人数');
  ok(st.total === d.board.w * d.board.h, '総マス');
  ok(st.painted > 0, '塗ったマス');
  ok(st.top.length >= 1, '上位阵営');
  ok(st.top[0].area > 0, '1 位は面積がある');
}

section('色の上限');
{
  const d = new SharedBoard({ storage: fakeStorage() }, {});
  const socks = [];
  for (let i = 0; i < 30; i++) {
    const s = fakeSocket(i + 1);
    socks.push(s);
    d.sockets.set(s.id, s);
    d.onMessage(s, JSON.stringify({ t: 'j', n: `p${i}` }));
  }
  const colors = new Set();
  for (const p of d.board.players.values()) colors.add(p.color);
  ok(colors.size <= TEAM_COLORS, `色は ${TEAM_COLORS} 以下`, colors.size);
  ok(colors.size > 1, '色が分散している', colors.size);
}

section('小さい盤でも壊れない');
{
  const d = new SharedBoard({ storage: fakeStorage() }, {});
  d.board = createBoard(300, 200);
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  for (let i = 0; i < 200; i++) d.loop();
  ok(true, '200 tick 耐える');
  ok(d.rows().length >= 1, '面積が出る');
}

section('.MAX_SIZE を越えない');
{
  const d = new SharedBoard({ storage: fakeStorage() }, {});
  const a = fakeSocket(1);
  d.sockets.set(a.id, a);
  d.onMessage(a, JSON.stringify({ t: 'j', n: 'A' }));
  const p = d.board.players.get(a.playerId);
  p.size = MAX_SIZE;
  for (let i = 0; i < 30; i++) d.loop();
  ok(p.size <= MAX_SIZE, 'size が上限を超えない', p.size);
  void p;
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
