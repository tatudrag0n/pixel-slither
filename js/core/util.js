// ============================================================================
// 汎用ヘルパ
//
// ブラウザでも Node でも動く純粋関数だけを書く。
// DOM を触る処理は js/ui/ 側に置く。
// ============================================================================

/** 値を [min, max] に収める。 */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** min 以上 max 以下の整数。 */
export function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 配列からランダムに 1 つ取り出す。 */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 秒を "m:ss" に整形する。 */
export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 数値に桁区切りを付ける。 */
export function formatNum(n) {
  return n.toLocaleString('ja-JP');
}

/** "#rrggbb" を [r, g, b] にする。 */
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r, g, b] を "#rrggbb" にする。 */
export function rgbToHex(rgb) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`;
}

/** 色 a を色 b へ t の割合で混ぜて "#rrggbb" を返す。 */
export function mixHex(a, b, t) {
  const c1 = hexToRgb(a);
  const c2 = hexToRgb(b);
  const f = (x, y) => x + (y - x) * t;
  return rgbToHex([f(c1[0], c2[0]), f(c1[1], c2[1]), f(c1[2], c2[2])]);
}

/** 明度 (0-255)。目の色を白にするか黒にするかの判断に使う。 */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** 0 から n-1 までの配列。 */
export function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

/** 同じ値を重複して入れない push。 */
export function pushUnique(arr, v) {
  if (arr.includes(v)) return arr;
  arr.push(v);
  return arr;
}

/** 日時を "20260927-142530" 形式にする。ファイル名に使う。 */
export function stamp(d = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  const y = d.getFullYear();
  const mo = p(d.getMonth() + 1);
  const da = p(d.getDate());
  const hh = p(d.getHours());
  const mm = p(d.getMinutes());
  const ss = p(d.getSeconds());
  return `${y}${mo}${da}-${hh}${mm}${ss}`;
}
