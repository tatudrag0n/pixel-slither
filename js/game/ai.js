// ============================================================================
// AI の相手
//
// 同じ盤面を 1 手で塗り合う。考え方は 4 つ:
//
//   1. その手で進める先 (最大 look マス先) をすべて評価する
//   2. 未塗り > 相手の色 > 自分の色 の順に高得点
//   3. 自分の体には絶対に入らない
//   4. 難易度によって先読みの深さとふらつきが変わる
//
// 評価できる手だけを候補にするので、進めないまま止まることはない。
// ============================================================================

import { DIRS } from './state.js';

/** 難易度。look が先読みするマス数、wander は迷う確率。 */
export const LEVELS = {
  easy: { id: 'easy', label: 'やさしい', look: 2, wander: 0.30, steal: 0.6 },
  normal: { id: 'normal', label: 'ふつう', look: 4, wander: 0.12, steal: 1.0 },
  hard: { id: 'hard', label: 'つよい', look: 7, wander: 0.04, steal: 1.4 },
};

export const LEVEL_LIST = Object.values(LEVELS);

/** 塗ったときの得点。 */
const SCORE = {
  blank: 10,
  rival: 6,
  mine: -3,
  /** すぐ壁にぶつかる。壁をまたぐ設定でないなら即死に等しい。 */
  wall: -1000,
  /** 自分の体にぶつかるのは即死。距離は問わない。 */
  body: -1000,
};

/**
 * AI の次の一手を決める。
 * @param {object} s  ゲーム状態
 * @param {object} p  AI のプレイヤー
 * @param {object} opt
 * @param {string} opt.level 'easy' | 'normal' | 'hard'
 * @param {number} opt.rand  0-1 の乱数
 * @returns {string|null} 向き名。何もしないなら null
 */
export function chooseDir(s, p, opt = {}) {
  const lv = LEVELS[opt.level] || LEVELS.normal;
  if (!p.alive || !p.snake.length) return null;

  if (opt.rand !== undefined && opt.rand < lv.wander) {
    return wander(s, p, opt.rand);
  }

  const head = p.snake[0];
  const own = new Set(p.snake.slice(0, -1).map((c) => cellIndex(s, c.x, c.y)));

  let best = null;
  let bestScore = -Infinity;
  for (const name of Object.keys(DIRS)) {
    const d = DIRS[name];
    const score = scorePath(s, p, head, d, own, lv);
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

/** その手で進んだときの評価。先読みして最大値を足す。 */
function scorePath(s, p, head, d, own, lv) {
  let x = head.x;
  let y = head.y;
  let total = 0;
  for (let step = 1; step <= lv.look; step++) {
    x += d.x;
    y += d.y;
    if (x < 0 || y < 0 || x >= s.cols || y >= s.rows) {
      if (!s.wrap) {
        // すぐ目の前は壁なら致命的。それより先なら毎 tick 見直すので
        // ここで打ち切って、塗れたぶんだけ残す。
        if (step === 1) return SCORE.wall;
        break;
      }
      x = (x + s.cols) % s.cols;
      y = (y + s.rows) % s.rows;
    }
    const i = cellIndex(s, x, y);
    if (own.has(i)) return SCORE.body;
    const v = s.paint[i];
    if (v === 0) total += SCORE.blank / step;
    else if (v === p.color) total += (SCORE.mine * lv.steal) / step;
    else total += (SCORE.rival * lv.steal) / step;
  }
  return total;
}

/** 迷う手を選ぶ。逆方向と壁は除非く。 */
function wander(s, p, r) {
  const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
  const names = Object.keys(DIRS).filter((n) => {
    const d = DIRS[n];
    if (last.x === -d.x && last.y === -d.y) return false;
    if (last.x === d.x && last.y === d.y) return false;
    if (!s.wrap) {
      const head = p.snake[0];
      const x = head.x + d.x;
      const y = head.y + d.y;
      if (x < 0 || y < 0 || x >= s.cols || y >= s.rows) return false;
    }
    return true;
  });
  if (!names.length) return null;
  return names[Math.floor(r * 997) % names.length];
}

function cellIndex(s, x, y) {
  return y * s.cols + x;
}
