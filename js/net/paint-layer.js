// ============================================================================
// 塗り盤の layer
//
// 2000 x 1200 = 240 万マスを 1 マス 1 ピクセルの canvas に置いてある。
// 画面には見えている範囲だけを切り出して描く。
//
// 差分の反映が重いので、変わったマスをまとめて putImageData を 1 回だけ呼ぶ。
// 変化が散らばっているときだけ全体を描く。
// ============================================================================

import { hexOf } from '../data/colors.js';

const EMPTY = [0x12, 0x14, 0x1a];

/** 1 マス 1 ピクセルの layer。 */
export class PaintLayer {
  /**
   * @param {number} w
   * @param {number} h
   * @param {Uint8Array} paint
   */
  constructor(w, h, paint) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(w, h);
    this.cells = 0;
    this.rebuilds = 0;
    if (paint) this.rebuild(paint);
    else this.clear();
  }

  /** layer を真っ白 (地の色) にする。 */
  clear() {
    const d = this.image.data;
    for (let i = 0; i < this.w * this.h; i++) {
      const o = i * 4;
      d[o] = EMPTY[0];
      d[o + 1] = EMPTY[1];
      d[o + 2] = EMPTY[2];
      d[o + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** 盤を全部 layer に描く。 */
  rebuild(paint) {
    const d = this.image.data;
    for (let i = 0; i < paint.length; i++) {
      const c = paint[i];
      const o = i * 4;
      if (c) {
        const rgb = hexToRgb(hexOf(c));
        d[o] = rgb[0];
        d[o + 1] = rgb[1];
        d[o + 2] = rgb[2];
      } else {
        d[o] = EMPTY[0];
        d[o + 1] = EMPTY[1];
        d[o + 2] = EMPTY[2];
      }
      d[o + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.rebuilds += 1;
  }

  /**
   * 変わったマスだけを layer に反映する。
   * @param {Uint8Array} paint 盤そのもの
   * @param {number[]} cells   変わった index
   * @returns {number} 書いたマス数
   */
  apply(paint, cells) {
    if (!cells || !cells.length) return 0;
    const d = this.image.data;
    const w = this.w;
    let minX = w;
    let minY = this.h;
    let maxX = -1;
    let maxY = -1;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell < 0 || cell >= paint.length) continue;
      const c = paint[cell];
      const o = cell * 4;
      if (c) {
        const rgb = hexToRgb(hexOf(c));
        d[o] = rgb[0];
        d[o + 1] = rgb[1];
        d[o + 2] = rgb[2];
      } else {
        d[o] = EMPTY[0];
        d[o + 1] = EMPTY[1];
        d[o + 2] = EMPTY[2];
      }
      d[o + 3] = 255;
      const x = cell % w;
      const y = (cell - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.cells += cells.length;
    if (maxX < 0) return 0;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw * bh > cells.length * 24) {
      this.ctx.putImageData(this.image, 0, 0);
    } else {
      this.ctx.putImageData(this.image, 0, 0, minX, minY, bw, bh);
    }
    return cells.length;
  }

  /** 見えている範囲を切り出して ctx に描く。 */
  blit(ctx, camX, camY, cols, rows, viewW, viewH) {
    ctx.drawImage(
      this.canvas,
      camX, camY, cols, rows,
      0, 0, viewW, viewH,
    );
  }
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
