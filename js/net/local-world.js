// ============================================================================
// 巨大戦場のローカル版
//
// サーバーが無いときの代替。同じ共有盤コアを使い、
// このブラウザの中でボットを混ぜて回す。塗り面積の集計も同じ。
//
// サーバー配備後は、同じ画面が共有版に切り替わる。
// ============================================================================
// ============================================================================

import {
  createBoard, addPlayer, removePlayer, steer, step, countByColor, leaderboard,
  packPlayer, scatterPigments, BOARD_W, BOARD_H, MAX_SIZE, TEAM_COLORS,
  START_SIZE, MAX_PIGMENTS, START_LENGTH,
} from '../shared/board.js';
import { PaintLayer } from './paint-layer.js';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * ローカルな盤。SharedGame と同じ形 (turn / respawn / info) にする。
 */
export class LocalWorld {
  constructor(opt = {}) {
    this.board = createBoard(BOARD_W, BOARD_H);
    this.name = opt.name || '名無し';
    this.w = this.board.w;
    this.h = this.board.h;
    this.status = 'local';
    this.connected = true;
    this.id = 0;
    this.color = 1;
    this.paint = this.board.paint;
    this.players = new Map();
    this.pigments = this.board.pigments;
    this.leader = [];
    this.me = null;
    this.dead = false;
    this.tickNo = 0;
    this.counts = new Int32Array(TEAM_COLORS + 1);
    this.bots = [];
    this.layer = null;
    scatterPigments(this.board, MAX_PIGMENTS);
    this.layer = new PaintLayer(this.board.w, this.board.h, this.paint);
    this.spawn(START_SIZE, this.name);
    for (let i = 0; i < (opt.bots ?? 7); i++) this.addBot();
  }

  /** 蛇を 1 匹入れる。 */
  spawn(size, name) {
    const p = addPlayer(this.board, name, size);
    this.id = p.id;
    this.color = p.color;
    this.me = p;
    this.syncPlayers();
    return p;
  }

  /** ボットを足す。 */
  addBot() {
    const p = addPlayer(this.board, `ボット${this.bots.length + 1}`, START_SIZE + Math.floor(Math.random() * 6));
    this.bots.push(p);
    this.syncPlayers();
    return p;
  }

  /** 蛇の一覧を配信用の形に揃える。 */
  syncPlayers() {
    this.players = new Map();
    for (const p of this.board.players.values()) {
      this.players.set(p.id, packPlayer(p));
    }
    this.me = this.players.get(this.id) || null;
  }

  /** 1 tick 進める。 */
  loop() {
    this.tickNo += 1;
    for (const b of this.bots) this.think(b);
    step(this.board, this.tickNo);
    this.syncPlayers();
    // 変わったマスだけ layer に反映する。全部を描くと 2.4MB で重い。
    if (this.layer) this.layer.apply(this.paint, this.board.touched);
    if (this.tickNo % 20 === 0) this.updateLeader();
    // 死んだボットは別の色に生まれ直す (人口を保つ)。
    for (const b of this.bots) {
      if (!b.alive) {
        removePlayer(this.board, b.id);
        const n = addPlayer(this.board, b.name, START_SIZE + Math.floor(Math.random() * 8));
        const i = this.bots.indexOf(b);
        this.bots[i] = n;
      }
    }
  }

  /** ボットの次の一手。色素と自分の体を避ける。 */
  think(b) {
    if (!b.alive) return;
    const head = b.body[0];
    if (!head) return;
    const own = new Set(b.body.slice(0, -1).map((c) => c.y * this.w + c.x));
    let best = -1;
    let bestScore = -Infinity;
    for (let d = 0; d < 4; d++) {
      let x = head.x;
      let y = head.y;
      let score = 0;
      for (let k = 1; k <= 5; k++) {
        x += DIRS[d][0];
        y += DIRS[d][1];
        if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) {
          score += k === 1 ? -500 : -6 * k;
          break;
        }
        const i = y * this.w + x;
        if (own.has(i)) {
          score += k === 1 ? -400 : -8 * k;
          break;
        }
        const v = this.paint[i];
        if (v === 0) score += 12 / k;
        else if (v === b.color) score += -2 / k;
        else score += 8 / k;
      }
      // 自分の体は避ける。向きだけ変える。
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    if (best >= 0) steer(b, best, this.tickNo);
  }

  /** 向きを変える。 */
  turn(dir) {
    return steer(this.board.players.get(this.id), dir, this.tickNo);
  }

  /** 復活。 */
  respawn(color) {
    const p = this.board.players.get(this.id);
    if (p && p.alive) return false;
    removePlayer(this.board, this.id);
    const r = respawnWithColor(this.board, this.id, p ? p.name : this.name, color, this.counts);
    this.color = r;
    this.me = this.board.players.get(this.id);
    this.dead = false;
    this.syncPlayers();
    return true;
  }

  /** リーダー。 */
  updateLeader() {
    countByColor(this.paint, this.w, this.counts);
    this.leader = leaderboard(this.counts);
  }

  /** 陣営の面積率。 */
  areaRatio() {
    const total = this.w * this.h;
    const row = this.leader.find((r) => r.color === this.color);
    return row ? row.area / total : 0;
  }

  /** 使われている色。 */
  takenColors() {
    const used = new Set();
    for (const p of this.board.players.values()) if (p.alive) used.add(p.color);
    return used;
  }

  /** 状態。 */
  info() {
    const me = this.board.players.get(this.id);
    return {
      status: this.status,
      connected: true,
      id: this.id,
      color: this.color,
      size: me ? me.size : START_SIZE,
      kills: me ? me.kills : 0,
      score: me ? me.score : 0,
      players: this.board.players.size,
      dead: this.dead,
      area: this.areaRatio(),
      leader: this.leader.map((r) => [r.color, r.area]),
      local: true,
    };
  }
}

/** 色を選んで復活する。埋まっていれば別の色を渡す。 */
function respawnWithColor(board, id, name, want, counts) {
  void counts;
  const n = Number(want);
  const w = Number.isFinite(n) ? Math.min(TEAM_COLORS, Math.max(1, Math.round(n))) : 1;
  const free = !board.taken.has(w);
  const old = board.players.get(id);
  const kills = old ? old.kills : 0;
  const score = old ? old.score : 0;
  removePlayer(board, id);
  const p = addPlayer(board, name, START_SIZE);
  board.players.delete(p.id);
  if (!board.taken.has(p.color) && p.color !== w) board.taken.delete(p.color);
  if (free) {
    board.taken.add(w);
    p.color = w;
  }
  p.id = id;
  p.kills = kills;
  p.score = score;
  board.players.set(id, p);
  return p.color;
}

void MAX_SIZE;
void START_LENGTH;
