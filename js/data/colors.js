// ============================================================================
// パレット
//
// paint 配列には 0 ではなく 1 始まりの色番号を保存する。
// 0 は「まだ塗られていない」を表す。
// 末尾の 4 枠はカスタム色で、UI のカラーピッカーから上書きできる。
// ============================================================================

/** 固定色 16 種。 */
export const BASE_COLORS = [
  { hex: '#ffffff', name: '白' },
  { hex: '#141821', name: '墨' },
  { hex: '#ef476f', name: '紅' },
  { hex: '#ff8c42', name: '橙' },
  { hex: '#ffd166', name: '黄' },
  { hex: '#8ac926', name: '若草' },
  { hex: '#06d6a0', name: '翡翠' },
  { hex: '#118ab2', name: '青' },
  { hex: '#4cc9f0', name: '水色' },
  { hex: '#7b5ea7', name: '藤' },
  { hex: '#c9a227', name: '金' },
  { hex: '#4361ee', name: '藍' },
  { hex: '#f15bb5', name: '桃' },
  { hex: '#8d99ae', name: '銀' },
  { hex: '#2d6a4f', name: '深緑' },
  { hex: '#b5651d', name: '土' },
];

/** カスタム枠の初期値。 */
export const CUSTOM_SEED = [
  { hex: '#00bbf9', name: 'カスタム 1' },
  { hex: '#d00000', name: 'カスタム 2' },
  { hex: '#5f0f40', name: 'カスタム 3' },
  { hex: '#00f5d4', name: 'カスタム 4' },
];

/** 色を 1 始まりで並べる。先頭は 0 (未塗り) の予約枠。 */
export const COLORS = [
  { hex: null, name: '未塗り', custom: false },
  ...BASE_COLORS.map((c) => ({ ...c, custom: false })),
  ...CUSTOM_SEED.map((c) => ({ ...c, custom: true })),
];

/** 枠で選べる最後の色番号。 */
export const MAX_COLOR = COLORS.length - 1;

/** カスタム枠の色番号の範囲。 */
export const CUSTOM_FROM = BASE_COLORS.length + 1;

/** 数字キーに割り当てられるのは 1-9 と 0 (=10)。 */
export const KEY_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** キャンバスの地の色。 */
export const BG = {
  dark: '#12141a',
  light: '#eef0f4',
};

/** 塗り残し表示に使う枠の色。 */
export const GRID_LINE = 'rgba(255,255,255,0.045)';

/** 色番号を "#rrggbb" にする。未塗りは指定した背景色を返す。 */
export function hexOf(colorIdx, fallback = BG.dark) {
  const c = COLORS[colorIdx];
  return c && c.hex ? c.hex : fallback;
}

/** 色を次の枠へ回す (末尾の次は先頭)。 */
export function nextColor(colorIdx, step = 1) {
  const n = (((colorIdx - 1 + step) % MAX_COLOR) + MAX_COLOR) % MAX_COLOR;
  return n + 1;
}

/** カスタム枠の色を変える。slot は 0 始まり。 */
export function setCustomColor(slot, hex) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= CUSTOM_SEED.length) return false;
  const idx = CUSTOM_FROM + slot;
  COLORS[idx] = { ...COLORS[idx], hex, name: `カスタム ${slot + 1}` };
  return true;
}

/** カスタム枠の現在の色を全て取り出す。 */
export function customColors() {
  const out = [];
  for (let i = CUSTOM_FROM; i <= MAX_COLOR; i++) out.push(COLORS[i].hex);
  return out;
}

/** カスタム枠の色を復元する。 */
export function applyCustomColors(list) {
  if (!Array.isArray(list)) return;
  list.forEach((hex, i) => setCustomColor(i, hex));
}
