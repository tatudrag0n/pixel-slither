// ============================================================================
// 絵の保存と復元
//   node test/save.test.js
// ============================================================================

import { encodePaint, decodePaint, paintToRGBA, countFilled } from '../js/game/paint.js';
import { COLORS, MAX_COLOR, CUSTOM_FROM, setCustomColor, customColors, applyCustomColors, nextColor, hexOf, BG } from '../js/data/colors.js';
import { hexToRgb, mixHex, luminance, formatTime, clamp } from '../js/core/util.js';

let failed = 0;
let passed = 0;

function ok(cond, label) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  \x1b[31m失敗\x1b[0m ${label}`);
  }
}

function eq(a, b, label) {
  ok(a === b, `${label} (期待 ${b} / 実際 ${a})`);
}

function section(name) {
  console.log(`\n== ${name} ==`);
}

/* ------------------------------------------------------------------ 符号化 */

section('Base64 で詰める');
{
  const paint = new Uint8Array(16);
  paint[0] = 0;
  paint[1] = 1;
  paint[2] = MAX_COLOR;
  paint[15] = 7;
  const b64 = encodePaint(paint);
  ok(typeof b64 === 'string' && b64.length > 0, '文字列が返る');
  const back = decodePaint(b64, 16);
  eq(back.length, 16, '長さが戻る');
  let same = true;
  for (let i = 0; i < 16; i++) if (back[i] !== paint[i]) same = false;
  ok(same, '中身が一致する');
  eq(countFilled(back), 3, '塗り数も一致');
}

section('空の絵');
{
  const paint = new Uint8Array(64);
  const back = decodePaint(encodePaint(paint), 64);
  ok(back.every((v) => v === 0), '全部 0');
  eq(encodePaint(paint), encodePaint(new Uint8Array(64)), '同じもの同士は同じ文字列');
}

section('短い文字列の復元');
{
  const back = decodePaint('YWJj', 10);
  eq(back.length, 10, '指定した長さになる');
  ok(back.slice(3).every((v) => v === 0), '足りない分は 0');
}

section('塗り数の数え上げ');
{
  const paint = new Uint8Array(10);
  paint[2] = 5;
  paint[9] = 1;
  eq(countFilled(paint), 2, '2 マス');
  eq(countFilled(new Uint8Array(10)), 0, '空なら 0');
}

/* ------------------------------------------------------------------ 色 */

section('色を 1 つ選ぶ');
{
  eq(COLORS.length, 21, '0 番 + 20 色');
  eq(hexOf(0, BG.dark), BG.dark, '0 番は地の色');
  ok(hexOf(1).startsWith('#'), '1 番は色');
  ok(hexOf(999, '#123456') === '#123456', '範囲外は指定した色');
  eq(hexOf(MAX_COLOR).length, 7, 'hex は 6 桁 + #');
}

section('色送り');
{
  eq(nextColor(1, 1), 2, '次の色');
  eq(nextColor(1, -1), MAX_COLOR, '前の色');
  eq(nextColor(MAX_COLOR, 1), 1, '末尾の次は先頭');
  eq(nextColor(1, 0), 1, '動かさない');
  eq(nextColor(3, 5), 8, '5 つ先');
  eq(nextColor(3, -5), 18, '5 つ前');
  eq(nextColor(10, 10), 20, '1 周する');
  eq(nextColor(10, 20), 10, '2 周しても同じ');
}

section('カスタム色');
{
  const before = customColors();
  eq(before.length, 4, '4 枠');
  ok(setCustomColor(0, '#123456'), '変えられる');
  eq(COLORS[CUSTOM_FROM].hex, '#123456', '色が入った');
  ok(!setCustomColor(9, '#123456'), '範囲外は不可');
  ok(!setCustomColor(-1, '#123456'), '負の数は不可');
  ok(!setCustomColor(1.5, '#123456'), '小数は不可');
  ok(!setCustomColor('0', '#123456'), '文字列も不可');
  eq(COLORS[3].hex, '#ef476f', '固定色は変わらない');
  applyCustomColors(['#0a0b0c', '#0d0e0f', '#101112', '#131415']);
  const after = customColors();
  eq(after[0], '#0a0b0c', '復元できる');
  eq(after[3], '#131415', '復元できる');
  applyCustomColors(before);
  eq(customColors()[0], before[0], '元に戻せる');
  ok(!applyCustomColors(null), '壊れた値は無視');
  ok(!applyCustomColors('x'), '文字列は無視');
}

/* ------------------------------------------------------------------ 画像 */

section('PNG 用のピクセル列');
{
  const paint = new Uint8Array(4);
  paint[1] = 3;
  const rgba = paintToRGBA(paint, 2, 2, '#101010');
  eq(rgba.length, 16, '2x2 で 16 バイト');
  const bg = hexToRgb('#101010');
  eq(rgba[0], bg[0], '未塗りは地の色');
  eq(rgba[3], 255, '不透明');
  const fg = hexToRgb(hexOf(3));
  eq(rgba[4], fg[0], '塗ったマスは色');
  eq(rgba[7], 255, '塗ったマスも不透明');
  let max = 0;
  for (const v of rgba) max = Math.max(max, v);
  ok(max >= 0 && max <= 255, '0-255 に収まる');
}

/* ------------------------------------------------------------------ 色計算 */

section('色の計算');
{
  const white = hexToRgb('#ffffff');
  const short = hexToRgb('#fff');
  ok(white[0] === 255 && white[1] === 255 && white[2] === 255, '白');
  ok(short[0] === 255 && short[2] === 255, '省略形');
  eq(white.join(','), '255,255,255', '並び順');
  eq(mixHex('#000000', '#ffffff', 0), '#000000', 't=0');
  eq(mixHex('#000000', '#ffffff', 1), '#ffffff', 't=1');
  eq(mixHex('#000000', '#ffffff', 0.5), '#808080', '中間');
  ok(luminance('#ffffff') > 250, '白は明るい');
  ok(luminance('#000000') < 5, '黒は暗い');
  ok(luminance('#ffd166') > luminance('#118ab2'), '黄色は青より明るい');
}

section('表示用の整形');
{
  eq(formatTime(0), '0:00', '0 秒');
  eq(formatTime(9), '0:09', '1 桁');
  eq(formatTime(61), '1:01', '1 分');
  eq(formatTime(600), '10:00', '10 分');
  eq(formatTime(-5), '0:00', '負は 0');
  eq(clamp(5, 1, 3), 3, '上限');
  eq(clamp(-1, 1, 3), 1, '下限');
  eq(clamp(2, 1, 3), 2, '範囲内');
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
