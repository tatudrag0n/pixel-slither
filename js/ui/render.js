// ============================================================================
// 画面描画
//
// 塗り絵は 1 マス 1 ピクセルの layer に描いてから、補間なしで拡大する。
// これでドットの縁がぼけない。
// 体の下には paint があるので、絵の上に半透明で重なる。
// ============================================================================

import { paintToRGBA } from '../game/paint.js';
import { players } from '../game/state.js';
import { BG, GRID_LINE, hexOf } from '../data/colors.js';
import { mixHex, luminance, clamp } from '../core/util.js';

/** 体の色。頭の色を薄めたもの。 */
const BODY_ALPHA = 0.34;

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} wrap 大きさを決める親要素
   */
  constructor(canvas, wrap) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this.image = null;
    this.bg = BG.dark;
    this.cell = 16;
    this.cols = 0;
    this.rows = 0;
    this.guide = null;
    this.showGuide = false;
  }

  /** キャンバスの大きさを親要素に合わせて決める。 */
  layout(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const availW = Math.max(160, this.wrap.clientWidth);
    const budget = Math.max(200, window.innerHeight * (window.innerWidth < 900 ? 0.5 : 0.62));
    const cell = Math.max(6, Math.min(Math.floor(availW / cols), Math.floor(budget / rows), 28));
    this.cell = cell;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    this.canvas.width = Math.round(cols * cell * dpr);
    this.canvas.height = Math.round(rows * cell * dpr);
    this.canvas.style.width = `${cols * cell}px`;
    this.canvas.style.height = `${rows * cell}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.layer.width = cols;
    this.layer.height = rows;
    this.image = this.lctx.createImageData(cols, rows);
    this.dirty = true;
  }

  /** 背景色を変える。 */
  setBg(hex) {
    if (this.bg === hex) return;
    this.bg = hex;
    this.dirty = true;
  }

  /** 下書き画像を読み込む。 */
  setGuide(img) {
    this.guide = img || null;
    this.showGuide = !!img;
    this.dirty = true;
  }

  /** 下書きの表示を切り替える。 */
  toggleGuide(force) {
    this.showGuide = force === undefined ? !this.showGuide : !!force;
    return this.showGuide;
  }

  /** paint 配列を layer に落とす。 */
  sync(paint) {
    if (!this.image) return;
    this.image.data.set(paintToRGBA(paint, this.cols, this.rows, this.bg));
    this.lctx.putImageData(this.image, 0, 0);
    this.dirty = false;
  }

  /**
   * 1 フレーム描く。
   * @param {object} s ゲーム状態
   * @param {boolean} force layer を再構築する場合 true
   */
  draw(s, force) {
    if (this.dirty || force) this.sync(s.paint);
    const ctx = this.ctx;
    const { cell, cols, rows } = this;
    const w = cols * cell;
    const h = rows * cell;

    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, w, h);

    if (this.showGuide && this.guide) this.drawGuide(ctx, w, h);
    ctx.drawImage(this.layer, 0, 0, cols, rows, 0, 0, w, h);
    if (s.showGrid) this.drawGrid(ctx, w, h);
    if (s.showBody) {
      for (const p of players(s)) this.drawBody(p, cell);
    }
    for (const p of players(s)) this.drawHead(s, p, cell);
  }

  /** 下書き画像を背後に薄く敷く。 */
  drawGuide(ctx, w, h) {
    const img = this.guide;
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  /** 方眼。只読のガイド。 */
  drawGrid(ctx, w, h) {
    const { cell, cols, rows } = this;
    ctx.fillStyle = GRID_LINE;
    for (let x = 1; x < cols; x++) ctx.fillRect(Math.round(x * cell), 0, 1, h);
    for (let y = 1; y < rows; y++) ctx.fillRect(0, Math.round(y * cell), w, 1);
  }

  /** 体の部分。頭の色を薄く重ねる。 */
  drawBody(p, cell) {
    const ctx = this.ctx;
    if (!p.snake.length) return;
    const hex = hexOf(p.color, BG.light);
    ctx.save();
    ctx.globalAlpha = BODY_ALPHA;
    ctx.fillStyle = hex;
    for (let i = 1; i < p.snake.length; i++) {
      const c = p.snake[i];
      ctx.fillRect(c.x * cell, c.y * cell, cell, cell);
    }
    ctx.restore();
  }

  /** 頭。目と鼻を入れて向きが分かるようにする。 */
  drawHead(s, p, cell) {
    const ctx = this.ctx;
    const head = p.snake[0];
    if (!head) return;
    const hex = hexOf(p.color, BG.dark);
    const x = head.x * cell;
    const y = head.y * cell;
    const d = p.dir;
    const fwd = { x: d.x, y: d.y };
    const side = { x: -fwd.y, y: fwd.x };

    ctx.save();
    ctx.globalAlpha = p.alive ? 1 : 0.35;
    ctx.fillStyle = hex;
    ctx.fillRect(x, y, cell, cell);

    const line = Math.max(1, Math.round(cell * 0.1));
    const edge = mixHex(hex, '#000000', 0.5);
    ctx.fillStyle = edge;
    ctx.fillRect(x, y, cell, line);
    ctx.fillRect(x, y + cell - line, cell, line);
    ctx.fillRect(x, y, line, cell);
    ctx.fillRect(x + cell - line, y, line, cell);

    const eye = Math.max(2, Math.round(cell * 0.22));
    const dark = luminance(hex) > 140 ? '#1a1c22' : '#ffffff';
    const fx = (cell / 2) + fwd.x * cell * 0.14;
    const fy = (cell / 2) + fwd.y * cell * 0.14;
    const ox = side.x * cell * 0.2;
    const oy = side.y * cell * 0.2;
    ctx.fillStyle = dark;
    for (const sgn of [-1, 1]) {
      const ex = x + fx + ox * sgn - eye / 2;
      const ey = y + fy + oy * sgn - eye / 2;
      ctx.fillRect(Math.round(ex), Math.round(ey), eye, eye);
    }

    const nose = Math.max(1, Math.round(cell * 0.16));
    ctx.fillStyle = mixHex('#ef476f', hex, 0.35);
    const nx = x + (cell / 2) + fwd.x * (cell * 0.5) - nose / 2;
    const ny = y + (cell / 2) + fwd.y * (cell * 0.5) - nose / 2;
    ctx.fillRect(Math.round(nx), Math.round(ny), nose, nose);
    ctx.restore();
  }
}

/**
 * 1 マスを scale ピクセルの PNG データを作る。
 * @returns {HTMLCanvasElement}
 */
export function exportCanvas(s, scale, bgHex) {
  const out = document.createElement('canvas');
  out.width = s.cols * scale;
  out.height = s.rows * scale;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(s.cols, s.rows);
  img.data.set(paintToRGBA(s.paint, s.cols, s.rows, bgHex));
  const tmp = document.createElement('canvas');
  tmp.width = s.cols;
  tmp.height = s.rows;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, s.cols, s.rows, 0, 0, out.width, out.height);
  return out;
}
