// ============================================================================
// パレット UI
//
// 色を 1 つずつ選ぶためのボタン群を作る。
// 1-9 と 0 はキーボードと連動、末尾の 4 枠は色自体を変えられる。
// ============================================================================

import { COLORS, MAX_COLOR, KEY_SLOTS, CUSTOM_FROM, setCustomColor } from '../data/colors.js';

/** キーラベルの表示。1-9 は数字、0 は 10 を表す。 */
function keyLabel(colorIdx) {
  const n = KEY_SLOTS.indexOf(colorIdx);
  if (n < 0) return '';
  return n === 9 ? '0' : String(n + 1);
}

export class Palette {
  /**
   * @param {HTMLElement} root
   * @param {object} h
   * @param {(colorIdx: number) => void} h.onPick
   * @param {() => void} h.onCustomChange カスタム色を変えた時
   */
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.buttons = new Map();
    this.inputs = [];
    this.build();
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      this.h.onPick(Number(b.dataset.color));
    });
  }

  /** ボタンを並べる。 */
  build() {
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= MAX_COLOR; i++) {
      const c = COLORS[i];
      const key = keyLabel(i);
      if (c.custom) {
        const wrap = document.createElement('div');
        wrap.className = 'swatch custom';
        const b = this.makeButton(i, c, key);
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'swatch-pick';
        input.value = c.hex;
        input.title = `${c.name} の色を変える`;
        input.setAttribute('aria-label', `${c.name} の色を変える`);
        input.addEventListener('input', () => {
          setCustomColor(i - CUSTOM_FROM, input.value);
          b.style.setProperty('--c', input.value);
          b.title = COLORS[i].name;
          this.h.onCustomChange(i);
        });
        wrap.append(b, input);
        this.inputs[i - CUSTOM_FROM] = input;
        this.buttons.set(i, b);
        frag.append(wrap);
      } else {
        const b = this.makeButton(i, c, key);
        this.buttons.set(i, b);
        frag.append(b);
      }
    }
    this.root.replaceChildren(frag);
  }

  /** 1 つの色ボタン。 */
  makeButton(i, c, key) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch-btn';
    b.dataset.color = String(i);
    b.style.setProperty('--c', c.hex);
    b.title = c.name;
    b.setAttribute('aria-label', `色 ${i} ${c.name}`);
    b.setAttribute('aria-pressed', 'false');
    const k = document.createElement('span');
    k.className = 'swatch-key';
    k.textContent = key;
    if (key) b.append(k);
    return b;
  }

  /** 選択中の色を反映する。 */
  select(colorIdx) {
    for (const [i, b] of this.buttons) {
      b.setAttribute('aria-pressed', i === colorIdx ? 'true' : 'false');
    }
  }

  /** 保存データから復元したカスタム色を反映する。 */
  refresh() {
    for (let i = CUSTOM_FROM; i <= MAX_COLOR; i++) {
      const b = this.buttons.get(i);
      if (b) b.style.setProperty('--c', COLORS[i].hex);
      const input = this.inputs[i - CUSTOM_FROM];
      if (input) input.value = COLORS[i].hex;
    }
  }
}
