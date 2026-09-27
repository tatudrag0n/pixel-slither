// ============================================================================
// 共有盤のクライアント
//
// サーバーが権威。こっちは自分の手元だけ追従する。
//
//   ・盤は 2000 x 1200 = 240 万マス。1 マス 1 バイト。
//     全部を 1 マス 1 ピクセルの layer に入れて、見えている範囲だけ切り出して描く。
//   ・初回だけ 2.4MB の Base64 で盤が飛んでくる。
//   ・以後は「	index と色」だけ来る。layer のその 1 マスだけ書き換える。
//   ・色ごとの面積はサーバーが数える。クライアントでは数えない。
// ============================================================================

import {
  MAX_SIZE, speedForSize, brushForSize, lengthForSize,
} from '../shared/board.js';
import { hexOf } from '../data/colors.js';
import { PaintLayer } from './paint-layer.js';

/** 画面に見えるマス数。 */
const VIEW_COLS = 84;
const VIEW_ROWS = 52;

const EMPTY_RGB = [0x12, 0x14, 0x1a];

/** サーバーに	request 送った答えを受ける 1 セッション。 */
export class SharedGame {
  /**
   * @param {object} opt
   * @param {HTMLCanvasElement} opt.canvas
   * @param {string} opt.url   サーバーの URL (wss://...)
   * @param {string} opt.name  自分の名前
   * @param {(m: string) => void} opt.say
   */
  constructor(opt) {
    this.canvas = opt.canvas;
    this.ctx = opt.canvas.getContext('2d');
    this.url = opt.url;
    this.name = opt.name || '名無し';
    this.say = opt.say || (() => {});

    this.ws = null;
    this.status = 'idle';
    this.connected = false;
    this.id = 0;
    this.color = 1;
    this.w = 0;
    this.h = 0;
    this.paint = new Uint8Array(0);
    this.layer = null;
    this.lctx = null;
    this.image = null;
    /** layer に書き戻す必要があるマス。 */
    this.dirty = [];
    this.players = new Map();
    this.pigments = [];
    this.leader = [];
    this.me = null;
    this.cell = 8;
    this.viewW = 0;
    this.viewH = 0;
    this.camX = 0;
    this.camY = 0;
    this.smoothX = 0;
    this.smoothY = 0;
    this.queue = [];
    this.dead = false;
    this.retry = 0;
    this.retryTimer = 0;
    this.pingTimer = 0;
    this.lastTick = 0;
    this.received = 0;
    this.paintedBytes = 0;

    this.onColorNeed = opt.onColorNeed || (() => {});
    this.onJoin = opt.onJoin || (() => {});
    this.onDead = opt.onDead || (() => {});
    this.onLeader = opt.onLeader || (() => {});
  }

  /* ------------------------------------------------------------ 接続 */

  /** サーバーにつなぐ。 */
  connect() {
    if (this.ws) return;
    this.status = 'linking';
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.failed('接続できません。サーバー の URL を確認してください。');
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.connected = true;
      this.retry = 0;
      this.status = 'online';
      this.send({ t: 'j', n: this.name });
      this.startPing();
    });
    ws.addEventListener('message', (e) => this.onMessage(e.data));
    ws.addEventListener('close', () => this.onClose());
    ws.addEventListener('error', () => this.onClose());
  }

  /** 切���れたら自動で繋ぎ直す。 */
  onClose() {
    this.connected = false;
    this.stopPing();
    if (this.ws && this.ws.readyState <= 1) this.ws = null;
    this.ws = null;
    if (this.status === 'failed') return;
    this.status = 'offline';
    this.retry += 1;
    if (this.retry > 5) {
      this.failed('サーバーに接続できません。時間をおいて試してください。');
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), 1000 * this.retry);
  }

  failed(msg) {
    this.status = 'failed';
    this.say(msg);
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'p' }), 20000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }

  /* ------------------------------------------------------ 受信 */

  onMessage(raw) {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'w':
        this.applyWelcome(m);
        break;
      case 'f':
        this.applyFrame(m);
        break;
      case 'l':
        this.leader = toLeader(m.l);
        this.onLeader(this.leader, this.w * this.h);
        break;
      case 'p':
        this.applyPlayers(m.v);
        break;
      case 'y':
        this.color = m.c;
        this.dead = false;
        this.queue = [];
        this.applyPlayers([m.p]);
        this.say(`復活しました。色は ${m.c} です。`);
        break;
      case 'o':
        this.dead = true;
        this.applyPlayers(this.me ? [this.me] : []);
        this.onDead(m);
        break;
      case 'x':
        this.say(m.m);
        break;
      default:
        break;
    }
    this.received += 1;
  }

  /** 参加時の一式。盤全体は初回だけ。 */
  applyWelcome(m) {
    this.w = m.w;
    this.h = m.h;
    this.id = m.id;
    this.color = m.c;
    this.paint = decodeBase64(m.paint, this.w * this.h);
    this.pigments = m.g || [];
    this.leader = toLeader(m.l);
    this.layer = new PaintLayer(this.w, this.h, this.paint);
    this.applyPlayers(m.p);
    this.dead = false;
    this.me = this.players.get(this.id) || null;
    if (this.me) {
      this.smoothX = this.me.x;
      this.smoothY = this.me.y;
    }
    this.onJoin(this.me, this.color, this.takenColors());
    this.onLeader(this.leader, this.w * this.h);
    this.say('共有盤に参加しました。');
  }

  /** 蛇の一覧。 */
  applyPlayers(list) {
    if (!Array.isArray(list)) return;
    const next = new Map();
    for (const p of list) next.set(p.i, p);
    this.players = next;
    this.me = next.get(this.id) || null;
  }

  /** 毎 tick の差分。 */
  applyFrame(m) {
    this.lastTick = m.n;
    if (m.p) this.applyCells(m.p);
    this.applyPlayers(m.v);
    if (m.g) this.pigments = m.g;
  }

  /** 塗られたマスを layer に反射する。
   *  1 マスずつ putImageData すると遅いので、まとめた範囲を 1 回だけ書く。 */
  applyCells(packed) {
    const cells = [];
    for (let i = 0; i + 2 < packed.length; i += 3) {
      const hi = packed.charCodeAt(i) - 0x20;
      const lo = packed.charCodeAt(i + 1) - 0x20;
      const color = packed.charCodeAt(i + 2) - 0x20;
      const cell = (hi << 8) | lo;
      if (cell < 0 || cell >= this.paint.length) continue;
      this.paint[cell] = color;
      cells.push(cell);
    }
    this.paintedBytes += cells.length;
    if (this.layer) this.layer.apply(this.paint, cells);
  }

  /** layer を 1 度だけ作る。 */
  setupLayer() {
    this.layer = document.createElement('canvas');
    this.layer.width = this.w;
    this.layer.height = this.h;
    this.lctx = this.layer.getContext('2d');
    this.image = this.lctx.createImageData(this.w, this.h);
    const d = this.image.data;
    for (let i = 0; i < this.paint.length; i++) {
      const c = this.paint[i];
      const o = i * 4;
      if (c) {
        const rgb = hexToRgb(hexOf(c));
        d[o] = rgb[0];
        d[o + 1] = rgb[1];
        d[o + 2] = rgb[2];
      } else {
        d[o] = EMPTY_RGB[0];
        d[o + 1] = EMPTY_RGB[1];
        d[o + 2] = EMPTY_RGB[2];
      }
      d[o + 3] = 255;
    }
    this.lctx.putImageData(this.image, 0, 0);
  }

  /* -------------------------------------------------------- 操作 */

  /** 向きを変える。 */
  turn(dir) {
    if (this.dead) return false;
    const last = this.queue.length
      ? this.queue[this.queue.length - 1]
      : (this.me ? this.me.d : 1);
    if (dir === last) return false;
    if (dir === (last + 2) % 4) return false;
    if (this.queue.length >= 2) return false;
    this.queue.push(dir);
    this.send({ t: 'i', d: dir });
    return true;
  }

  /** 復活する。色を選んで送る。 */
  respawn(color) {
    this.dead = false;
    this.queue = [];
    this.color = color;
    this.send({ t: 'r', c: color });
  }

  /* -------------------------------------------------------- 描画 */

  /** 画面サイズに合わせてマス幅を決める。 */
  layout(availW, availH) {
    const cell = Math.max(
      2,
      Math.min(Math.floor(availW / VIEW_COLS), Math.floor(availH / VIEW_ROWS), 20),
    );
    this.cell = cell;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = VIEW_COLS * cell;
    const h = VIEW_ROWS * cell;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.viewW = w;
    this.viewH = h;
  }

  /** 1 フレーム描く。 */
  draw() {
    const ctx = this.ctx;
    const cell = this.cell;
    if (!this.layer) return;
    ctx.fillStyle = '#12141a';
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // 自分の頭を中心にカメラ。
    const me = this.me;
    const tx = me ? me.x : this.w / 2;
    const ty = me ? this.h : this.h / 2;
    const tyFix = me ? me.y : this.h / 2;
    this.smoothX += (tx - this.smoothX) * 0.18;
    this.smoothY += (tyFix - this.smoothY) * 0.18;
    const halfW = Math.floor(VIEW_COLS / 2);
    const halfH = Math.floor(VIEW_ROWS / 2);
    this.camX = clampInt(Math.round(this.smoothX - halfW), 0, Math.max(0, this.w - VIEW_COLS));
    this.camY = clampInt(Math.round(this.smoothY - halfH), 0, Math.max(0, this.h - VIEW_ROWS));

    // 盤。見えている範囲だけを切り出して拡大。
    ctx.drawImage(
      this.layer,
      this.camX, this.camY, VIEW_COLS, VIEW_ROWS,
      0, 0, this.viewW, this.viewH,
    );

    // 方眼。
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 1; x < VIEW_COLS; x++) ctx.fillRect(x * cell, 0, 1, this.viewH);
    for (let y = 1; y < VIEW_ROWS; y++) ctx.fillRect(0, y * cell, this.viewW, 1);

    // 色素。
    for (const g of this.pigments) {
      const sx = (g.x - this.camX) * cell;
      const sy = (g.y - this.camY) * cell;
      if (sx < -cell || sy < -cell || sx > this.viewW || sy > this.viewH) continue;
      const r = Math.max(1, Math.round(cell * 0.2));
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      ctx.fillStyle = '#fff6c9';
      ctx.fillRect(sx - r, sy - r + 1, r, r);
    }

    // 他の蛇。死んでいるものは描かない。
    for (const p of this.players.values()) {
      if (p.i === this.id || !p.a) continue;
      this.drawSnake(ctx, p, cell, 0.6);
    }
    // 自分。
    if (me && me.a) this.drawSnake(ctx, me, cell, 1);
  }

  /** 蛇 1 本を描く。 */
  drawSnake(ctx, p, cell, alpha) {
    const hx = (p.x - this.camX) * cell;
    const hy = (p.y - this.camY) * cell;
    ctx.globalAlpha = alpha;
    if (hx < -cell * 4 || hy < -cell * 4 || hx > this.viewW + cell * 4 || hy > this.viewH + cell * 4) {
      ctx.globalAlpha = 1;
      return;
    }
    const hex = hexOf(p.c);
    const dx = [0, 1, 0, -1][p.d] || 0;
    const dy = [-1, 0, 1, 0][p.d] || 0;
    const b = Math.max(2, Math.round(cell * (0.35 + 0.25 * (p.s / MAX_SIZE))));
    const len = Math.min(20, 3 + Math.floor(p.s / 2));
    ctx.fillStyle = hex;
    // 体。頭から 1 マスずつ逆に。
    for (let i = 1; i < len; i++) {
      const sx = hx - dx * i * cell;
      const sy = hy - dy * i * cell;
      ctx.globalAlpha = alpha * (1 - (i / len) * 0.5);
      ctx.fillRect(sx - b / 2, sy - b / 2, b, b);
    }
    ctx.globalAlpha = alpha;
    // 頭。
    ctx.fillRect(hx - cell / 2, hy - cell / 2, cell, cell);
    // 鼻。
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    const nose = Math.max(1, Math.round(cell * 0.16));
    ctx.fillRect(
      hx + dx * (cell / 2) - nose / 2,
      hy + dy * (cell / 2) - nose / 2,
      nose, nose,
    );
    // 名前と大きさ。
    if (cell >= 5) {
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#e8ecf4';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.n || '名無し'} ${p.s}`, hx, hy - cell * 0.7);
    }
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------- 補助 */

  /** 自分の陣営の面積率 (0-1)。 */
  areaRatio() {
    const total = this.w * this.h;
    if (!total) return 0;
    const mine = this.leader.find((r) => r.color === this.color);
    return mine ? mine.area / total : 0;
  }

  /** 今使われている色。 */
  takenColors() {
    const used = new Set();
    for (const p of this.players.values()) {
      if (p.a) used.add(p.c);
    }
    return used;
  }

  /** 自分の情報。 */
  info() {
    const me = this.me;
    return {
      status: this.status,
      connected: this.connected,
      id: this.id,
      color: this.color,
      size: me ? me.s : 3,
      kills: me ? me.k : 0,
      score: me ? me.sc : 0,
      speed: me ? speedForSize(me.s) : 0,
      brush: me ? brushForSize(me.s) : 2,
      length: me ? lengthForSize(me.s) : 12,
      players: this.players.size,
      dead: this.dead,
      area: this.areaRatio(),
      leader: this.leader,
      pigments: this.pigments.length,
      received: this.received,
      painted: this.paintedBytes,
    };
  }

  /** 全部閉じる。 */
  close() {
    clearTimeout(this.retryTimer);
    this.stopPing();
    if (this.ws) {
      try { this.ws.close(); } catch { /* 無視 */ }
    }
    this.ws = null;
    this.connected = false;
    this.status = 'offline';
  }
}

/* --------------------------------------------------------- 補助 */

function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function toLeader(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(([color, area]) => ({ color, area }));
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Base64 を Uint8Array に。 */
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
