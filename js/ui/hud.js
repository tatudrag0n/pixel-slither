// ============================================================================
// 数値表示とメッセージ
//
// 毎フレーム textContent を書き換えると重いので、直前の値と同じなら何もしない。
// ============================================================================

import { formatTime, formatNum } from '../core/util.js';
import { progress, areaOf } from '../game/state.js';

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

  /** 中身を入れ替える。値が同じなら何もしない。 */
  setHTML(id, html) {
    if (this.cache.get(`h:${id}`) === html) return;
    this.cache.set(`h:${id}`, html);
    const node = this.el[id];
    if (node) node.innerHTML = html;
  }

  /** 幅 (%) だけを更新する。 */
  setWidth(id, pct) {
    const key = `w:${id}`;
    const v = `${Math.max(0, Math.min(100, pct)).toFixed(2)}%`;
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    const node = this.el[id];
    if (node) node.style.width = v;
  }

  /** 個人戦用の表示。 */
  updateSolo(s) {
    const total = s.cols * s.rows;
    const p = progress(s);
    const pct = (p * 100).toFixed(1);
    this.set('progressText', `${pct}%`);
    this.setWidth('progressFill', p * 100);
    const pb = this.el.progressBar;
    if (pb) pb.setAttribute('aria-valuenow', pct);
    this.set('statMoves', formatNum(s.moves));
    this.set('statTime', formatTime(s.elapsed));
    this.set('statLeft', formatNum(total - s.painted));
  }

  /** 陣営戦用の表示。塗り面積を 2 本の棒で見せる。 */
  updateDuel(s) {
    const total = s.cols * s.rows;
    const mine = areaOf(s, s.me.color);
    const theirs = areaOf(s, s.rival ? s.rival.color : 0);
    const minePct = (mine / total) * 100;
    const theirPct = (theirs / total) * 100;
    this.setWidth('barMine', minePct);
    this.setWidth('barRival', theirPct);
    this.set('barMineText', `${minePct.toFixed(1)}%`);
    this.set('barRivalText', `${theirPct.toFixed(1)}%`);
    this.set('barMineName', s.me.name);
    this.set('barRivalName', s.rival ? s.rival.name : 'あいて');
    this.set('statMoves', formatNum(s.moves));
    this.set('statTime', formatTime(Math.max(0, s.left)));
    this.set('statLeft', formatNum(total - s.painted));
  }

  /** ベスト記録。 */
  updateRecord(record) {
    this.set('statBest', record ? `${formatNum(record.moves)} 手 / ${formatTime(record.time)}` : '—');
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
    if (!html || !html.length) {
      o.hidden = true;
      o.replaceChildren();
      return;
    }
    o.hidden = false;
    o.replaceChildren(...html);
  }
}
