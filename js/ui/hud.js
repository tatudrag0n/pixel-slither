// ============================================================================
// 数値表示とメッセージ
//
// 毎フレーム textContent を書き換えると重いので、
// 直前の値と同じならなにもしない。
// ============================================================================

import { formatTime, formatNum } from '../core/util.js';
import { progress } from '../game/state.js';

export class Hud {
  /**
   * @param {object} el id → 要素
   */
  constructor(el) {
    this.el = el;
    this.cache = new Map();
    this.toastTimer = 0;
  }

  /** 同じ値なら描かない。 */
  set(id, text) {
    if (this.cache.get(id) === text) return;
    this.cache.set(id, text);
    const node = this.el[id];
    if (node) node.textContent = text;
  }

  /** 画面上の数値をまとめて更新する。 */
  update(s, record) {
    const total = s.cols * s.rows;
    const p = progress(s);
    const pct = (p * 100).toFixed(1);
    this.set('progressText', `${pct}%`);
    const bar = this.el.progressFill;
    if (bar) bar.style.width = `${p * 100}%`;
    const pb = this.el.progressBar;
    if (pb) pb.setAttribute('aria-valuenow', pct);
    this.set('statMoves', formatNum(s.moves));
    this.set('statTime', formatTime(s.elapsed));
    this.set('statLeft', formatNum(total - s.painted));
    this.set('statBest', record ? `${formatNum(record.moves)} 手 / ${formatTime(record.time)}` : '—');
    this.set('colorName', s.eraser ? '消しゴム' : '');
  }

  /** 一時的なメッセージ。 */
  toast(msg, ms = 1600) {
    const t = this.el.toast;
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  /** キャンバスの上に重ねる説明。 */
  overlay(html) {
    const o = this.el.overlay;
    if (!o) return;
    if (!html) {
      o.hidden = true;
      o.replaceChildren();
      return;
    }
    o.hidden = false;
    o.replaceChildren(...html);
  }
}
