// ============================================================================
// 巨大戦場の描画
//
// SharedGame (サーバー) と LocalWorld (ローカル) のどちらでも
// 同じ絵が描けるように 1 枚にまとめたもの。
// 盤は 2000 x 1200 なので、見えている範囲だけを layer から切り出して描く。
// ============================================================================

import { MAX_SIZE, speedForSize, brushForSize, lengthForSize } from '../shared/board.js';
import { hexOf } from '../data/colors.js';

const VIEW_COLS = 86;
const VIEW_ROWS = 54;
const EMPTY = '#12141a';

export class WorldRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} wrap
   */
  constructor(canvas, wrap) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.cell = 8;
    this.viewW = 0;
    this.viewH = 0;
    this.smoothX = 0;
    this.smoothY = 0;
    this.camX = 0;
    this.camY = 0;
    this.px = 0;
    this.snakes = 0;
  }

  /** 画面に合わせてマス幅を決める。 */
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
    this.smoothX = 0;
    this.smoothY = 0;
  }

  /**
   * 1 フレーム描く。
   * @param {object} layer PaintLayer。差し持ちで済み。
   * @param {object} me    自分のプレイヤー
   * @param {number} w     盤の幅
   * @param {number} h     盤の高さ
   * @param {Array}  pigments
   * @param {Map}   players
   */
  draw(layer, me, w, h, pigments, players) {
    if (!layer) return;
    const ctx = this.ctx;
    const cell = this.cell;

    // 自分の頭を中心にカメラ。
    const tx = me ? me.x : w / 2;
    const ty = me ? me.y : h / 2;
    this.smoothX += (tx - this.smoothX) * 0.18;
    this.smoothY += (ty - this.smoothY) * 0.18;
    const halfW = Math.floor(VIEW_COLS / 2);
    const halfH = Math.floor(VIEW_ROWS / 2);
    this.camX = clamp(Math.round(this.smoothX - halfW), 0, Math.max(0, w - VIEW_COLS));
    this.camY = clamp(Math.round(this.smoothY - halfH), 0, Math.max(0, h - VIEW_ROWS));

    ctx.fillStyle = EMPTY;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    layer.blit(ctx, this.camX, this.camY, VIEW_COLS, VIEW_ROWS, this.viewW, this.viewH);
    this.px = layer.cells;

    // 方眼。
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 1; x < VIEW_COLS; x++) ctx.fillRect(x * cell, 0, 1, this.viewH);
    for (let y = 1; y < VIEW_ROWS; y++) ctx.fillRect(0, y * cell, this.viewW, 1);

    // 色素。
    for (const g of pigments) {
      const sx = (g.x - this.camX) * cell;
      const sy = (g.y - this.camY) * cell;
      if (sx < -cell || sy < -cell || sx > this.viewW || sy > this.viewH) continue;
      const r = Math.max(1, Math.round(cell * 0.22));
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      ctx.fillStyle = '#fff6c9';
      ctx.fillRect(sx - r, sy - r + 1, r, r);
    }

    // 蛇。
    this.snakes = 0;
    for (const p of players.values()) {
      if (p.i === (me ? me.i : -1) || !p.a) continue;
      this.drawSnake(ctx, p, cell, 0.6);
      this.snakes += 1;
    }
    if (me && me.a) {
      this.drawSnake(ctx, me, cell, 1);
      this.snakes += 1;
    }
  }

  /** 蛇 1 本。 */
  drawSnake(ctx, p, cell, alpha) {
    const hx = (p.x - this.camX) * cell;
    const hy = (p.y - this.camY) * cell;
    if (hx < -cell * 4 || hy < -cell * 4 || hx > this.viewW + cell * 4 || hy > this.viewH + cell * 4) {
      return;
    }
    const dx = [0, 1, 0, -1][p.d] || 0;
    const dy = [-1, 0, 1, 0][p.d] || 0;
    const b = Math.max(2, Math.round(cell * (0.3 + 0.3 * (p.s / MAX_SIZE))));
    const len = Math.min(22, 3 + Math.floor(p.s / 2));
    const hex = hexOf(p.c);
    for (let i = 1; i < len; i++) {
      const sx = hx - dx * i * cell;
      const sy = hy - dy * i * cell;
      ctx.globalAlpha = alpha * (1 - (i / len) * 0.45);
      ctx.fillStyle = hex;
      ctx.fillRect(sx - b / 2, sy - b / 2, b, b);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hex;
    ctx.fillRect(hx - cell / 2, hy - cell / 2, cell, cell);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    const nose = Math.max(1, Math.round(cell * 0.16));
    ctx.fillRect(hx + dx * (cell / 2) - nose / 2, hy + dy * (cell / 2) - nose / 2, nose, nose);
    if (cell >= 5) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#e8ecf4';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${p.n || '名無し'} ${p.s}`, hx, hy - cell * 0.7);
    }
    ctx.globalAlpha = 1;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

void speedForSize;
void brushForSize;
void lengthForSize;
