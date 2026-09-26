// ============================================================================
// 絵の保存と書き出し
//
// 塗り絵は paint 配列 (Uint8Array) に入れている。
// localStorage に入れるときは 1 マスを 1 文字に詰め込んで Base64 にする。
// Node のテストから呼んでも困らないよう、DOM は使わない。
// ============================================================================

import { hexToRgb } from '../core/util.js';
import { hexOf } from '../data/colors.js';

/** 色番号 + 文字コード。'a' が 0 (未塗り)、'a'+20 まで使う。 */
const CH = 97;

/** paint 配列を Base64 文字列にする。 */
export function encodePaint(paint) {
  let s = '';
  for (let i = 0; i < paint.length; i++) s += String.fromCharCode(CH + paint[i]);
  return btoa(s);
}

/** Base64 文字列を paint 配列に戻す。 */
export function decodePaint(b64, length) {
  const bin = atob(b64);
  const out = new Uint8Array(length);
  for (let i = 0; i < length && i < bin.length; i++) {
    out[i] = Math.max(0, bin.charCodeAt(i) - CH);
  }
  return out;
}

/** 1 マス 1 ピクセルの RGBA 配列を作る。ImageData へ入れる直前の形。 */
export function paintToRGBA(paint, cols, rows, bgHex) {
  const bg = hexToRgb(bgHex);
  const out = new Uint8ClampedArray(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    const v = paint[i];
    const c = v ? hexToRgb(hexOf(v, bgHex)) : bg;
    const o = i * 4;
    out[o] = c[0];
    out[o + 1] = c[1];
    out[o + 2] = c[2];
    out[o + 3] = 255;
  }
  return out;
}

/** 塗り残しを数える。 */
export function countFilled(paint) {
  let n = 0;
  for (let i = 0; i < paint.length; i++) if (paint[i] !== 0) n += 1;
  return n;
}
