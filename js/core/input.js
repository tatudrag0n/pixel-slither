// ============================================================================
// 入力
//
// キーボード (WASD / 矢印)、タッチのスワイプ、画面上のボタンを受ける。
// ゲーム側は「どの方向に曲がったか」だけ分かればよいので、
// キーの生データを呼び出し元へ渡さない。
// ============================================================================

import { DIRS } from '../game/state.js';

/** キーコードと名の対応。WASD と矢印の両方を受け付ける。 */
const KEYMAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
};

/** ブラウザ既定の操作を打ち消すキー。 */
const SWALLOW = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

/**
 * キーボード操作を登録する。
 * @param {object} h
 * @param {(dir: string) => void} h.onTurn
 * @param {(cmd: string) => void} h.onCommand
 * @param {(n: number) => void} h.onColorKey 1-9 と 0 (10) を受け取る
 */
export function bindKeys(h) {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const dir = KEYMAP[e.code];
    if (dir) {
      h.onTurn(dir);
      e.preventDefault();
      return;
    }

    if (/^Digit[0-9]$/.test(e.code) || /^Numpad[0-9]$/.test(e.code)) {
      const d = e.code.replace(/\D/g, '');
      const n = d === '0' ? 10 : Number(d);
      h.onColorKey(n);
      e.preventDefault();
      return;
    }

    const cmd = COMMANDS[e.code];
    if (cmd) {
      h.onCommand(cmd);
      e.preventDefault();
      return;
    }

    if (SWALLOW.has(e.code)) e.preventDefault();
  });
}

/** キーコード → コマンド名。 */
export const COMMANDS = {
  Space: 'play',
  KeyQ: 'prevColor',
  KeyE: 'nextColor',
  KeyF: 'eraser',
  KeyG: 'guide',
  KeyH: 'body',
  KeyJ: 'grid',
  KeyR: 'restart',
  KeyC: 'clear',
  KeyP: 'export',
};

/**
 * キャンバス上のスワイプを読む。指が一定以上動いたら方向を送る。
 * @param {HTMLElement} el
 * @param {(dir: string) => void} onTurn
 */
export function bindSwipe(el, onTurn) {
  let sx = 0;
  let sy = 0;
  let tracking = false;

  const THRESHOLD = 18;

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    tracking = true;
    sx = e.clientX;
    sy = e.clientY;
  });

  el.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
    if (Math.abs(dx) > Math.abs(dy)) onTurn(dx > 0 ? 'right' : 'left');
    else onTurn(dy > 0 ? 'down' : 'up');
    tracking = false;
  });

  const stop = () => { tracking = false; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('pointerleave', stop);
}

/** 画面上のボタンから方向を送る。 */
export function bindPad(el, onTurn) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]');
    if (!b) return;
    onTurn(b.dataset.dir);
  });
  return () => {
    for (const name of Object.keys(DIRS)) {
      const b = el.querySelector(`[data-dir="${name}"]`);
      if (b) b.blur();
    }
  };
}
