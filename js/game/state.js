// ============================================================================
// ゲーム本体
//
// 1 tick = 蛇が 1 マス進むこと。
// 進むたび「しっぽが離れたマス」に頭の現在色が残る。その色は消えない。
// キャンバス全マスが塗られたらクリア。
//
// このファイルは DOM に依存しない。将来オンライン化する場合は
// step() の入出力をそのまま送受信できる形にしてある。
// ============================================================================

import { clamp } from '../core/util.js';
import { MAX_COLOR } from '../data/colors.js';

/** キャンバスの大きさ。 */
export const GRIDS = {
  s: { id: 's', label: 'S', cols: 32, rows: 20 },
  m: { id: 'm', label: 'M', cols: 44, rows: 26 },
  l: { id: 'l', label: 'L', cols: 60, rows: 36 },
};

export const GRID_LIST = Object.values(GRIDS);

/** 体の長さの上限。キャンバスの小さい半分のマス数まで。 */
export function maxLength(s) {
  return clamp(Math.floor(Math.min(s.cols, s.rows) / 2), 2, 16);
}

/** 向き。 */
export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * 初期状態を作る。
 * @param {object} opt
 * @param {string} opt.gridId
 * @param {number} opt.speed  1 マス進む秒数(毎秒マス数)
 * @param {number} opt.length 体長
 * @param {number} opt.color  頭の色番号
 * @param {boolean} opt.wrap  壁をまたぐか
 * @param {boolean} opt.risky 自分の体に当たると終了するか
 */
export function createState(opt = {}) {
  const grid = GRIDS[opt.gridId] || GRIDS.m;
  const s = {
    gridId: grid.id,
    cols: grid.cols,
    rows: grid.rows,
    paint: new Uint8Array(grid.cols * grid.rows),
    painted: 0,
    snake: [],
    dir: { x: 1, y: 0 },
    queue: [],
    color: clamp(opt.color || 3, 1, MAX_COLOR),
    eraser: !!opt.eraser,
    speed: clamp(opt.speed || 7, 1, 30),
    length: 1,
    wrap: opt.wrap !== false,
    risky: !!opt.risky,
    showBody: opt.showBody !== false,
    showGrid: opt.showGrid !== false,
    status: 'idle',
    won: false,
    moves: 0,
    elapsed: 0,
    reason: '',
  };
  s.length = clamp(opt.length || 5, 2, maxLength(s));
  resetSnake(s);
  return s;
}

/** 蛇を中央に戻す。塗り絵は消さない。 */
export function resetSnake(s) {
  const cy = s.rows >> 1;
  const cx = s.cols >> 1;
  s.snake = [];
  for (let i = 0; i < s.length; i++) {
    s.snake.push({ x: (cx - i + s.cols) % s.cols, y: cy });
  }
  s.dir = { x: 1, y: 0 };
  s.queue = [];
}

/** 蛇を中央に戻す。塗った絵はそのまま。 */
export function restart(s) {
  resetSnake(s);
  s.status = 'idle';
  s.won = false;
  s.moves = 0;
  s.elapsed = 0;
  s.reason = '';
}

/** キャンバスを全消しする。 */
export function clearCanvas(s) {
  s.paint.fill(0);
  s.painted = 0;
  s.won = false;
  s.status = 'idle';
  s.reason = '';
}

/** キャンバスの大きさを変える。絵は消える。 */
export function setGrid(s, gridId) {
  const grid = GRIDS[gridId];
  if (!grid) return false;
  s.gridId = grid.id;
  s.cols = grid.cols;
  s.rows = grid.rows;
  s.paint = new Uint8Array(grid.cols * grid.rows);
  s.painted = 0;
  s.length = clamp(s.length, 2, maxLength(s));
  restart(s);
  return true;
}

/** 走行をはじめる。 */
export function start(s) {
  if (s.status === 'won' || s.status === 'over') return false;
  s.status = 'running';
  return true;
}

/** 停止と再開を入れ替える。 */
export function togglePause(s) {
  if (s.status === 'running') s.status = 'paused';
  else if (s.status === 'paused') s.status = 'running';
  else start(s);
  return s.status;
}

/** 処理を 1 マス進める。戻り値はイベント。 */
export function step(s) {
  if (s.status !== 'running') return { type: 'idle' };
  if (s.won || s.status === 'over') return { type: 'idle' };

  if (s.queue.length) s.dir = s.queue.shift();

  const head = s.snake[0];
  let nx = head.x + s.dir.x;
  let ny = head.y + s.dir.y;

  const outside = nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows;
  if (outside) {
    if (!s.wrap) return die(s, 'wall');
    nx = (nx + s.cols) % s.cols;
    ny = (ny + s.rows) % s.rows;
  }

  if (s.risky && hitsBody(s, nx, ny)) return die(s, 'body');

  s.snake.unshift({ x: nx, y: ny });
  const tail = s.snake.pop();
  paint(s, tail.x, tail.y);
  s.moves += 1;

  if (!s.won && s.painted === s.cols * s.rows) {
    s.won = true;
    s.status = 'won';
    return { type: 'win', moves: s.moves, elapsed: s.elapsed };
  }
  return { type: 'step', head: { x: nx, y: ny }, tail };
}

/** 進行不能で終わらせる。 */
function die(s, cause) {
  s.status = 'over';
  s.reason = cause;
  return { type: 'over', cause };
}

/** 自分の体に重なるか。尾は同時に動くので対象外。 */
function hitsBody(s, x, y) {
  const n = s.snake.length;
  for (let i = 1; i < n - 1; i++) {
    if (s.snake[i].x === x && s.snake[i].y === y) return true;
  }
  return false;
}

/** 1 マスに色を置く。0 を入れると消える。 */
export function paint(s, x, y) {
  const i = y * s.cols + x;
  const v = s.eraser ? 0 : s.color;
  if (s.paint[i] === v) return false;
  if (v === 0) s.painted = Math.max(0, s.painted - 1);
  else if (s.paint[i] === 0) s.painted += 1;
  s.paint[i] = v;
  return true;
}

/** 1 マスに色を直接置く。paint() と違い進行状態は弄らない。 */
export function putPixel(s, x, y, colorIdx) {
  const i = y * s.cols + x;
  const v = colorIdx || 0;
  if (s.paint[i] === v) return false;
  if (v === 0) s.painted = Math.max(0, s.painted - 1);
  else if (s.paint[i] === 0) s.painted += 1;
  s.paint[i] = v;
  return true;
}

/**
 * 進行方向を変える。連続した操作を取りこぼさないよう 2 つまで予約する。
 * @param {object} s
 * @param {string} name 'up' 'down' 'left' 'right'
 */
export function turn(s, name) {
  const d = DIRS[name];
  if (!d) return false;
  if (s.queue.length >= 2) return false;
  const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
  if (last.x === -d.x && last.y === -d.y) return false;
  if (last.x === d.x && last.y === d.y) return false;
  s.queue.push({ x: d.x, y: d.y });
  return true;
}

/** 頭の色を変える。消しゴムはそのまま。 */
export function setColor(s, colorIdx) {
  const v = clamp(colorIdx, 1, MAX_COLOR);
  if (s.color === v) return false;
  s.color = v;
  return true;
}

/** 描画済みのマス数。保存データを復元したときの検算用。 */
export function countPainted(paint) {
  let n = 0;
  for (let i = 0; i < paint.length; i++) if (paint[i] !== 0) n += 1;
  return n;
}

/** 進捗率 (0-1)。 */
export function progress(s) {
  return s.painted / (s.cols * s.rows);
}
