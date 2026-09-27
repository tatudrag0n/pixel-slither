// ============================================================================
// 共有盤の Durable Object
//
// サイトを見てる全員が同じ 1 枚の巨大な盤を共有する。

// この DO が唯一の権威で、tick を回して判定し、WebSocket で配る。
//
//   クライアント →  {t:'j',n:名前} 参加
// サイトを見てる全員が同じ 1 枚の巨大な盤を共有する。
//                  {t:'r',c:色}   復活 (色を選んで入り直す)
//   サーバー →      {t:'w',...}   参加時の一式 (盤 + 蛇 + リーダー)
//                  {t:'f',...}   毎 tick の差分
//                  {t:'l',...}   リーダー更新 (1 秒に 1 回)
//                  {t:'o',...}   脱落した
//
// 盤は 2000x1200 = 240 万マス。paint は DO のメモリにUint8Array で持つ。
// Durable Object は 1 プロセスに 1 つだけ立つので、双方が同じ盤を見る。
// ============================================================================

import {
  createBoard, addPlayer, removePlayer, steer, step, countByColor, leaderboard,
  packPlayer, scatterPigments, spawnWithId, MAX_PLAYERS, MAX_PIGMENTS, TICK_MS,
  BOARD_W, BOARD_H, TEAM_COLORS, START_SIZE,
} from '../js/shared/board.js';

/** 配送 cycle 間隔。リーダーはこの tick ごとに更新する。 */
const LEADER_EVERY = 20;

/** 1 つの storage キーに保存するマス数。DO は 1 値 128KB まで。 */
const CHUNK = 60000;

export class SharedBoard {
  /**
   * @param {object} state Durable Object の永続状態
   * @param {object} env  バインディング
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map();
    this.board = createBoard(BOARD_W, BOARD_H);
    this.tickNo = 0;
    this.timer = null;
    this.nextPid = 1;
    this.leaderDirty = true;
    this.counts = new Int32Array(TEAM_COLORS + 1);
    this._load();
  }

  /**
   * fetch と WebSocket upgrade を受け渡す。

   * @param {Request} req
   */
  async fetch(req) {
    if (req.headers.get('Upgrade') === 'websocket') return this.onUpgrade(req);
    if (new URL(req.url).pathname === '/stats') {
      return new Response(JSON.stringify(this.stats()), {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return new Response('共有盤のサーバーです。WebSocket でつないでください。', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  /** 永続状態から復元する。大きさが変わっていたら作り直す。 */
  /** 永続状態から復元する。大きさが変わっていたら作り直す。 */
  _load() {
    const store = this.state.storage;
    const meta = store.get('meta');
    if (!meta || meta.w !== this.board.w || meta.h !== this.board.h) {
      scatterPigments(this.board, MAX_PIGMENTS);
      this.dirtyChunks = allChunks(this.board.paint.length);
      this.persist();
      return;
    }
    for (let i = 0; i < meta.n; i++) {
      const chunk = store.get(`p${i}`);
      if (!chunk) continue;
      this.board.paint.set(chunk, i * CHUNK);
    }
    this.board.pigments = meta.pigments || [];
    this.nextPid = meta.nextPid || 1;
    this.dirtyChunks = new Set();
  }

  /**
   * 盤を永続化する。paint は 60KB ずつに切って別キーにする。
   * 変わったチャンクだけ書くので、毎回 2.4MB 分は書き込まない。
   */
  persist() {
    const store = this.state.storage;
    const n = Math.ceil(this.board.paint.length / CHUNK);
    const writes = [];
    for (const i of this.dirtyChunks) {
      writes.push([`p${i}`, this.board.paint.slice(i * CHUNK, (i + 1) * CHUNK)]);
    }
    writes.push(['meta', {
      w: this.board.w,
      h: this.board.h,
      n,
      pigments: this.board.pigments,
      nextPid: this.nextPid,
      at: Date.now(),
    }]);
    store.put(writes);
    this.dirtyChunks = new Set();
  }

  /** 変わったマスを「どのチャンクか」に落とす。 */
  markDirty(touched) {
    for (let i = 0; i < touched.length; i++) {
      this.dirtyChunks.add(Math.floor(touched[i] / CHUNK));
    }
  }

  /* -------------------------------------------------------- WebSocket */

  /** 新しい接続。 */
  onUpgrade(req) {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const id = this.nextPid++;
    const sock = { id, ws: server, playerId: 0, seen: Date.now() };
    this.sockets.set(id, sock);

    server.addEventListener('message', (e) => {
      sock.seen = Date.now();
      this.onMessage(sock, e.data);
    });
    const drop = () => this.onClose(sock);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    this.ensureTimer();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 切断したら蛇を消す。 */
  onClose(sock) {
    this.sockets.delete(sock.id);
    if (sock.playerId) {
      removePlayer(this.board, sock.playerId);
      this.leaderDirty = true;
    }
    this.checkIdle();
  }

  /** クライアントからの操作。 */
  onMessage(sock, raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'j') {
      this.join(sock, m);
      return;
    }
    if (m.t === 'i') {
      const p = this.board.players.get(sock.playerId);
      if (p && typeof m.d === 'number') steer(p, m.d | 0, this.tickNo);
      return;
    }
    if (m.t === 'r') {
      this.respawn(sock, m);
      return;
    }
    if (m.t === 'p') {
      // 生存確認 (ping)。何も返さない。
      this.pong(sock);
    }
  }

  /** 参加。色は無償。 */
  join(sock, m) {
    if (this.sockets.size > MAX_PLAYERS) {
      this.send(sock, { t: 'x', m: '混み合っています。少し待ってください。' });
      return;
    }
    if (sock.playerId) {
      // すでに参加済み。名前だけ更新。
      const cur = this.board.players.get(sock.playerId);
      if (cur) cur.name = String(m.n || '名無し').slice(0, 16);
      this.send(sock, this.welcome(sock));
      return;
    }
    const p = addPlayer(this.board, m.n || '名無し', START_SIZE);
    sock.playerId = p.id;
    this.leaderDirty = true;
    this.send(sock, this.welcome(sock));
    this.broadcast({ t: 'p', v: [...this.board.players.values()].map(packPlayer) });
  }

  /**
   * 復活。色を選んで入り直す。
   * 本人がその色を空いていれば取る。埋まっていれば別の色を割り当てる。
   */
  respawn(sock, m) {
    if (!sock.playerId) return this.join(sock, m);
    const old = this.board.players.get(sock.playerId);
    if (old && old.alive) return;
    const name = m.n || (old ? old.name : '名無し');
    removePlayer(this.board, sock.playerId);
    const r = spawnWithId(this.board, sock.playerId, name, m.c);
    if (old) {
      r.player.kills = old.kills;
      r.player.score = old.score;
    }
    this.placeFor(r.player);
    sock.playerId = r.player.id;
    this.leaderDirty = true;
    this.send(sock, { t: 'y', c: r.color, p: packPlayer(r.player) });
    this.broadcast({ t: 'p', v: [...this.board.players.values()].map(packPlayer) });
  }

  /** 蛇の初期位置を決め直す。 */
  placeFor(p) {
    const len = 12;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = 20 + Math.floor(Math.random() * (this.board.w - 40));
      const y = 20 + Math.floor(Math.random() * (this.board.h - 40));
      p.x = x;
      p.y = y;
      p.fx = x;
      p.fy = y;
      p.dir = attempt % 4;
      p.body = [];
      const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][p.dir];
      for (let i = 0; i < len; i++) {
        p.body.push({ x: x - d[0] * i, y: y - d[1] * i });
      }
      let safe = true;
      for (const c of p.body) {
        if (c.x < 1 || c.y < 1 || c.x >= this.board.w - 1 || c.y >= this.board.h - 1) {
          safe = false;
          break;
        }
        for (const o of this.board.players.values()) {
          if (o === p || !o.alive) continue;
          const oh = o.body[0];
          if (!oh) continue;
          if (Math.abs(oh.x - c.x) < 14 && Math.abs(oh.y - c.y) < 14) {
            safe = false;
            break;
          }
        }
        if (!safe) break;
      }
      if (safe) return;
    }
  }

  /** 参加時の一式。 */
  welcome(sock) {
    const me = this.board.players.get(sock.playerId);
    return {
      t: 'w',
      w: this.board.w,
      h: this.board.h,
      id: sock.playerId,
      c: me ? me.color : 1,
      paint: encodeBase64(this.board.paint),
      p: [...this.board.players.values()].map(packPlayer),
      g: this.board.pigments.slice(0, 200),
      l: this.rows(),
      n: this.tickNo,
    };
  }

  /** 色ごとの面積。 */
  rows() {
    countByColor(this.board.paint, this.board.w, this.counts);
    return leaderboard(this.counts).map((r) => [r.color, r.area]);
  }

  /* ------------------------------------------------------------ ループ */

  /** タイマーを用意する。没有人なら止める。 */
  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.loop(), TICK_MS);
  }

  /** 誰もいないなら止める。 */
  checkIdle() {
    if (this.sockets.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 1 tick 進める。全員に配る。 */
  loop() {
    if (this.sockets.size === 0) {
      this.checkIdle();
      return;
    }
    this.tickNo += 1;
    const before = this.board.players.size;
    step(this.board, this.tickNo);
    this.markDirty(this.board.touched);

    // 落ちた蛇の通知。
    if (this.board.players.size !== before) this.leaderDirty = true;
    for (const sock of this.sockets.values()) {
      const p = this.board.players.get(sock.playerId);
      if (p && !p.alive && !p._notified) {
        p._notified = true;
        this.send(sock, { t: 'o', c: p.cause, k: p.kills, s: p.score, r: p.size });
      }
    }

    // 差分を配る。pigment は 2 秒に 1 回まとめて。
    const touched = this.board.touched;
    const frame = {
      t: 'f',
      n: this.tickNo,
      p: touched.length ? packCells(this.board.paint, touched) : '',
      v: [...this.board.players.values()].map(packPlayer),
    };
    if (this.tickNo % 40 === 0) {
      frame.g = this.board.pigments.slice(0, 200);
    }
    this.broadcast(frame);

    // リーダーは 1 秒に 1 回。
    if (this.leaderDirty || this.tickNo % LEADER_EVERY === 0) {
      this.leaderDirty = false;
      this.broadcast({ t: 'l', l: this.rows(), n: this.tickNo });
    }

    // 90 秒に 1 回保存。pigment と変わったチャンクだけ。
    if (this.tickNo % 1800 === 0) this.persist();
  }

  /* ---------------------------------------------------------- 配信 */

  /** 1 人に送る。 */
  send(sock, obj) {
    try {
      sock.ws.send(JSON.stringify(obj));
    } catch {
      this.sockets.delete(sock.id);
    }
  }

  /** 全員に送る。 */
  broadcast(obj) {
    const text = JSON.stringify(obj);
    for (const sock of this.sockets.values()) {
      try {
        sock.ws.send(text);
      } catch {
        this.sockets.delete(sock.id);
      }
    }
  }

  pong(sock) {
    this.send(sock, { t: 'k' });
  }

  /** 状態サマリー。/stats 用。 */
  stats() {
    const rows = this.rows();
    let painted = 0;
    for (const [, area] of rows) painted += area;
    return {
      w: this.board.w,
      h: this.board.h,
      total: this.board.w * this.board.h,
      painted,
      players: this.sockets.size,
      snakes: this.board.players.size,
      tick: this.tickNo,
      colors: rows.length,
      top: rows.slice(0, 5).map(([color, area]) => ({ color, area })),
    };
  }
}

/* --------------------------------------------------------------- 補助 */

/** 全チャンク番号。作り直しのときに全部書き直す用。 */
function allChunks(len) {
  const out = [];
  for (let i = 0; i < Math.ceil(len / CHUNK); i++) out.push(i);
  return out;
}

function clampColor(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return 1;
  return Math.min(TEAM_COLORS, Math.max(1, Math.round(v)));
}

/** TypedArray を Base64 にする。paint の一度きり」に使う。 */
export function encodeBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return btoa(s);
}

/** Base64 を Uint8Array にする。 */
export function decodeBase64(b64, len) {
  const bin = atob(b64);
  const out = new Uint8Array(len);
  for (let i = 0; i < len && i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** index と色を 1 本の文字列に詰める。 */
export function packCells(paint, cells) {
  let s = '';
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    s += String.fromCharCode(
      0x20 + (cell >> 8),
      0x20 + (cell & 0xff),
      0x20 + paint[cell],
    );
  }
  return s;
}
