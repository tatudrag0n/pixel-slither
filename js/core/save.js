// ============================================================================
// 保存
//
// ブラウザの localStorage に絵と設定とベスト記録を入れる。
// 保存できない環境 (プライベートモードなど) でも遊べるように、
// 失敗したらページ内のメモリへ落とす。
// ============================================================================

import { encodePaint, decodePaint, countFilled } from '../game/paint.js';
import { GRIDS, maxLength, countPainted } from '../game/state.js';
import { clamp } from './util.js';
import { customColors, applyCustomColors, MAX_COLOR } from '../data/colors.js';

const KEY = 'pixel-slither.v1';

/** localStorage が使えないときの代用。 */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

let store = null;

/** 保存先を用意する。渡されなければ window.localStorage を使う。 */
export function initStore(storage) {
  try {
    const s = storage || window.localStorage;
    const probe = '__px_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    store = s;
  } catch {
    store = memoryStorage();
  }
  return store;
}

function getStore() {
  return store || initStore();
}

function read() {
  try {
    const raw = getStore().getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(obj) {
  try {
    getStore().setItem(KEY, JSON.stringify(obj));
    return true;
  } catch {
    return false;
  }
}

/** 現在の状態を保存する。 */
export function saveState(s) {
  const data = read() || {};
  data.savedAt = Date.now();
  data.custom = customColors();
  data.records = data.records || {};
  data.game = {
    gridId: s.gridId,
    paint: encodePaint(s.paint),
    color: s.color,
    eraser: s.eraser,
    speed: s.speed,
    length: s.length,
    wrap: s.wrap,
    risky: s.risky,
    showBody: s.showBody,
    showGrid: s.showGrid,
    moves: s.moves,
    elapsed: s.elapsed,
    status: s.status === 'running' || s.status === 'paused' ? s.status : 'idle',
    won: s.won,
    snake: s.snake.map((p) => [p.x, p.y]),
    dir: [s.dir.x, s.dir.y],
  };
  return write(data);
}

/** 復元したオブジェクトを返す。保存する絵が無ければ state は null。 */
export function loadData() {
  const data = read();
  if (!data) return { state: null, records: {} };
  if (Array.isArray(data.custom)) applyCustomColors(data.custom);
  if (data.game) {
    const g = data.game;
    const grid = GRIDS[g.gridId] || GRIDS.m;
    const paint = decodePaint(g.paint || '', grid.cols * grid.rows);
    const filled = countFilled(paint);
    const s = {
      gridId: grid.id,
      cols: grid.cols,
      rows: grid.rows,
      paint,
      painted: countPainted(paint),
      color: clamp(g.color || 3, 1, MAX_COLOR),
      eraser: !!g.eraser,
      speed: clamp(g.speed || 7, 1, 30),
      length: 3,
      wrap: g.wrap !== false,
      risky: !!g.risky,
      showBody: g.showBody !== false,
      showGrid: g.showGrid !== false,
      status: g.won ? 'won' : (g.status === 'idle' ? 'idle' : 'paused'),
      won: !!g.won,
      moves: g.moves || 0,
      elapsed: g.elapsed || 0,
      reason: '',
      snake: [],
      dir: { x: 1, y: 0 },
      queue: [],
    };
    s.length = clamp(g.length || 5, 2, maxLength(s));
    const body = Array.isArray(g.snake) ? g.snake : [];
    const ok = body.length === s.length
      && body.every((p) => Array.isArray(p)
        && p[0] >= 0 && p[0] < s.cols && p[1] >= 0 && p[1] < s.rows);
    if (ok) s.snake = body.map((p) => ({ x: p[0], y: p[1] }));
    else s.snake = defaultSnake(s);
    if (Array.isArray(g.dir) && (g.dir[0] || g.dir[1])) {
      s.dir = { x: Math.sign(g.dir[0]) || 0, y: Math.sign(g.dir[1]) || 0 };
      if (!s.dir.x && !s.dir.y) s.dir = { x: 1, y: 0 };
    }
    if (filled !== s.painted) s.painted = filled;
    return { state: s, records: data.records || {} };
  }
  return { state: null, records: data.records || {} };
}

/** 保存データが無いときの初期蛇。 */
export function defaultSnake(s) {
  const cy = s.rows >> 1;
  const cx = s.cols >> 1;
  const body = [];
  for (let i = 0; i < s.length; i++) {
    body.push({ x: (cx - i + s.cols) % s.cols, y: cy });
  }
  return body;
}

/** ベスト記録一覧。 */
export function loadRecords() {
  const data = read();
  return (data && data.records) || {};
}

/**
 * クリア記録を保存する。
 * @returns {boolean} 記録更新なら true
 */
export function saveRecord(gridId, rec) {
  const data = read() || {};
  data.records = data.records || {};
  const cur = data.records[gridId];
  const better = !cur || rec.moves < cur.moves;
  if (better) {
    data.records[gridId] = { ...rec, at: Date.now() };
    write(data);
    return true;
  }
  write(data);
  return false;
}

/** 絵だけを消す。ベスト記録は残す。 */
export function clearSavedGame() {
  const data = read();
  if (!data) return;
  delete data.game;
  write(data);
}

/** 記録も含めて全部消す。 */
export function wipeAll() {
  try {
    getStore().removeItem(KEY);
  } catch {
    /* 何もしない */
  }
}
