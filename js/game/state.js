// ============================================================================
// ゲーム本体
//
// 1 tick = 全プレイヤーが 1 マス進むこと。
// 進むたび「しっぽが離れたマス」にそのプレイヤーの現在色が残る。色は消えない。
// 陣営戦では相手の色を塗り替えられるので、塗った数が入れ替わっていく。
// 個人戦は全マスが塗られたらクリア、陣営戦は時間切れの塗り面積比で決着。
//
// このファイルは DOM に依存しない。オンラインでは
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

/** 陣営戦の制限時間 (秒)。 */
export const ROUND_SECONDS = 180;

/** 体の長さの上限。キャンバスの小さい側の半分のマス数まで。 */
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

/** 向き名。座標から復元するときに使う。 */
export function dirName(d) {
  if (d.y < 0) return 'up';
  if (d.y > 0) return 'down';
  if (d.x < 0) return 'left';
  return 'right';
}

/**
 * 1 人のプレイヤー。
 * @param {object} o
 * @param {number} o.color     頭の色番号
 * @param {string} o.name
 * @param {boolean} o.isLocal  手前のプレイヤーか
 * @param {boolean} o.isAi     AI か
 */
export function createPlayer(o = {}) {
  return {
    id: o.id || 'p1',
    name: o.name || 'あなた',
    color: clamp(o.color || 3, 1, MAX_COLOR),
    eraser: false,
    isLocal: o.isLocal !== false,
    isAi: !!o.isAi,
    snake: [],
    dir: { x: 1, y: 0 },
    queue: [],
    alive: true,
    killedBy: '',
  };
}

/**
 * 初期状態を作る。
 * @param {object} opt
 * @param {string} opt.mode     'solo' | 'battle'
 * @param {string} opt.gridId
 * @param {number} opt.speed    毎秒何マス
 * @param {number} opt.length   体長
 * @param {number} opt.color    自分の色
 * @param {number} opt.rivalColor 相手の色
 * @param {number} opt.seconds  制限時間
 */
export function createState(opt = {}) {
  const grid = GRIDS[opt.gridId] || GRIDS.m;
  const mode = opt.mode === 'battle' ? 'battle' : 'solo';
  const s = {
    mode,
    gridId: grid.id,
    cols: grid.cols,
    rows: grid.rows,
    paint: new Uint8Array(grid.cols * grid.rows),
    /** 色番号ごとの塗り面積。0 番は「まだ塗られていない」。 */
    counts: new Uint32Array(MAX_COLOR + 1),
    painted: 0,
    me: createPlayer({ id: 'p1', name: 'あなた', color: opt.color || 3, isLocal: true }),
    rival: null,
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
    left: opt.seconds || ROUND_SECONDS,
    reason: '',
  };
  s.length = clamp(opt.length || 5, 2, maxLength(s));
  if (mode === 'battle') {
    s.rival = createPlayer({
      id: 'p2',
      name: opt.rivalName || 'あいて',
      color: opt.rivalColor || 4,
      isLocal: false,
      isAi: opt.rivalIsAi !== false,
    });
    s.seconds = s.left;
  }
  resetSnakes(s);
  return s;
}

/** 参加しているプレイヤー一覧。陣営戦では 2 人。 */
export function players(s) {
  return s.rival ? [s.me, s.rival] : [s.me];
}

/** 自分から見た相手のプレイヤー。個人戦では null。 */
export function opponentOf(s, p) {
  if (!s.rival) return null;
  return p === s.me ? s.rival : s.me;
}

/** 蛇を中央に戻す。塗り絵は消さない。 */
export function resetSnake(s, p) {
  const cy = s.rows >> 1;
  const cx = s.cols >> 1;
  const back = p === s.me ? 0 : 4;
  p.snake = [];
  for (let i = 0; i < s.length; i++) {
    p.snake.push({ x: (cx - i - back + s.cols) % s.cols, y: cy });
  }
  p.dir = { x: 1, y: 0 };
  p.queue = [];
  p.alive = true;
  p.killedBy = '';
}

/** 全員を中央に戻す。絵はそのまま。 */
export function resetSnakes(s) {
  for (const p of players(s)) resetSnake(s, p);
}

/** やり直し。塗った絵は残る。 */
export function restart(s) {
  resetSnakes(s);
  s.status = 'idle';
  s.won = false;
  s.moves = 0;
  s.elapsed = 0;
  s.left = s.seconds || ROUND_SECONDS;
  s.reason = '';
}

/** 全消し。面積も 0 に戻す。 */
export function clearCanvas(s) {
  s.paint.fill(0);
  s.counts.fill(0);
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
  s.counts = new Uint32Array(MAX_COLOR + 1);
  s.painted = 0;
  s.length = clamp(s.length, 2, maxLength(s));
  restart(s);
  return true;
}

/** 走行をはじめる。 */
export function start(s) {
  if (s.status === 'over' || s.status === 'won') return false;
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

/**
 * 1 tick 進める。戻り値はイベント。
 * 個人戦なら自分だけ、陣営戦なら 2 人とも進める。
 * 塗られたマスは s.touched に積まれる (paint() を使う側で使う)。
 */
export function step(s) {
  if (s.status !== 'running') return { type: 'idle' };
  if (s.won) return { type: 'idle' };
  s.touched = [];

  let ended = false;
  for (const p of players(s)) {
    const ev = stepPlayer(s, p);
    if (ev.type === 'over') {
      ended = true;
      s.status = 'over';
      s.reason = ev.cause;
    }
  }
  s.moves += 1;

  if (ended) return { type: 'over' };
  if (!s.won && s.painted === s.cols * s.rows) {
    s.won = true;
    s.status = 'won';
    return { type: 'win', moves: s.moves, elapsed: s.elapsed };
  }
  return { type: 'step' };
}

/** 1 人分を進める。 */
function stepPlayer(s, p) {
  if (!p.alive) return { type: 'dead' };
  if (p.queue.length) p.dir = p.queue.shift();

  const head = p.snake[0];
  let nx = head.x + p.dir.x;
  let ny = head.y + p.dir.y;

  const outside = nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows;
  if (outside) {
    if (!s.wrap) {
      p.alive = false;
      p.killedBy = 'wall';
      return { type: 'over', cause: 'wall', player: p };
    }
    nx = (nx + s.cols) % s.cols;
    ny = (ny + s.rows) % s.rows;
  }

  // 個人戦は「自分で物にぶつからない」設定にできる。
  // 陣営戦ではぶつかった瞬間に脱落する。
  if ((s.mode === 'battle' || s.risky) && hitsBody(s, p, nx, ny)) {
    p.alive = false;
    p.killedBy = 'body';
    return { type: 'over', cause: 'body', player: p };
  }

  p.snake.unshift({ x: nx, y: ny });
  const tail = p.snake.pop();
  const color = p.eraser ? 0 : p.color;
  if (put(s, tail.x, tail.y, color)) s.touched.push(tail.y * s.cols + tail.x);
  return { type: 'moved', player: p, head: { x: nx, y: ny } };
}

/** 自分の体に重なるか。尾は同時に動くので対象外。 */
function hitsBody(s, p, x, y) {
  const n = p.snake.length;
  for (let i = 1; i < n - 1; i++) {
    if (p.snake[i].x === x && p.snake[i].y === y) return true;
  }
  return false;
}

/**
 * 1 マスに色を置く。色が変わったときだけ true を返す。
 * 塗り面積も同時に更新する。
 */
export function put(s, x, y, colorIdx) {
  const i = y * s.cols + x;
  const v = colorIdx || 0;
  if (s.paint[i] === v) return false;
  if (v === 0) s.painted = Math.max(0, s.painted - 1);
  else if (s.paint[i] === 0) s.painted += 1;
  s.counts[s.paint[i]] -= 1;
  s.counts[v] += 1;
  s.paint[i] = v;
  return true;
}

/** しっぽが色を置く。消しゴムなら 0 を入れる。 */
export function paint(s, p, x, y) {
  return put(s, x, y, p.eraser ? 0 : p.color);
}

/** 直接 1 マスを塗る。進行状態は変えない。 */
export function putPixel(s, x, y, colorIdx) {
  return put(s, x, y, colorIdx);
}

/** 塗り面積 (0 を除く) を数え直す。読み込み後の検算用。 */
export function recount(s) {
  s.counts.fill(0);
  let total = 0;
  for (let i = 0; i < s.paint.length; i++) {
    const v = s.paint[i];
    if (!v) continue;
    s.counts[v] += 1;
    total += 1;
  }
  s.painted = total;
  return total;
}

/** ある色の塗り面積。 */
export function areaOf(s, colorIdx) {
  return s.counts[colorIdx] || 0;
}

/** 塗り面積 (%) を出す。塗られていないマスも分母に含める。 */
export function areaPercent(s, colorIdx) {
  return areaOf(s, colorIdx) / (s.cols * s.rows);
}

/** 進捗率 (0-1)。個人戦で「どれだけ塗ったか」を表す。 */
export function progress(s) {
  return s.painted / (s.cols * s.rows);
}

/** 待ち時間が 0 なら true。時間切れの判定に使う。 */
export function timeUp(s) {
  return s.mode === 'battle' && s.left <= 0;
}

/** ラウンドを終わらせる。時間切れ。個人戦では何もしない。 */
export function endRound(s) {
  if (s.mode !== 'battle') return false;
  if (s.status === 'over') return false;
  s.status = 'over';
  return true;
}

/**
 * 進行方向を変える。連続した操作を取りこぼさないよう 2 つまで予約する。
 * @param {object} p プレイヤー
 * @param {string} name 'up' 'down' 'left' 'right'
 */
export function turn(p, name) {
  const d = DIRS[name];
  if (!d) return false;
  if (!p.alive) return false;
  if (p.queue.length >= 2) return false;
  const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
  if (last.x === -d.x && last.y === -d.y) return false;
  if (last.x === d.x && last.y === d.y) return false;
  p.queue.push({ x: d.x, y: d.y });
  return true;
}

/** 頭の色を変える。個人戦用。 */
export function setColor(s, colorIdx) {
  const v = clamp(colorIdx, 1, MAX_COLOR);
  if (s.me.color === v) return false;
  s.me.color = v;
  return true;
}
