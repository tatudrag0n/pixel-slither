// ============================================================================
// 保存
//
// ブラウザの localStorage に絵と設定とベスト記録を入れる。
// 保存できない環境 (プライベートモードなど) でも遊べるように、
// 失敗したらページ内のメモリへ落とす。
// ============================================================================

import { encodePaint, decodePaint, countFilled } from '../game/paint.js';
import {
  GRIDS, createState, maxLength, recount, resetSnake,
} from '../game/state.js';
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
    mode: s.mode,
    gridId: s.gridId,
    paint: encodePaint(s.paint),
    color: s.me.color,
    eraser: !!s.me.eraser,
    rivalColor: s.rival ? s.rival.color : 0,
    rivalName: s.rival ? s.rival.name : '',
    speed: s.speed,
    length: s.length,
    wrap: s.wrap,
    risky: s.risky,
    showBody: s.showBody,
    showGrid: s.showGrid,
    aiLevel: s.aiLevel || 'normal',
    moves: s.moves,
    elapsed: s.elapsed,
    left: s.left,
    status: s.status === 'running' || s.status === 'paused' ? s.status : 'idle',
    won: s.won,
    snake: s.me.snake.map((p) => [p.x, p.y]),
    dir: [s.me.dir.x, s.me.dir.y],
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
    const mode = g.mode === 'battle' ? 'battle' : 'solo';
    const color = clamp(g.color || 3, 1, MAX_COLOR);
    const s = createState({
      mode,
      gridId: grid.id,
      color,
      rivalColor: clamp(g.rivalColor || (color === 4 ? 5 : 4), 1, MAX_COLOR),
      rivalName: g.rivalName || 'あいて',
      rivalIsAi: true,
      speed: g.speed,
      length: g.length,
      wrap: g.wrap !== false,
      risky: !!g.risky,
      showBody: g.showBody !== false,
      showGrid: g.showGrid !== false,
      seconds: g.left,
    });
    s.paint = paint;
    s.painted = filled;
    recount(s);
    s.me.color = color;
    s.me.eraser = !!g.eraser;
    s.aiLevel = g.aiLevel || 'normal';
    s.status = g.won ? 'won' : (g.status === 'idle' ? 'idle' : 'paused');
    s.won = !!g.won;
    s.moves = g.moves || 0;
    s.elapsed = g.elapsed || 0;
    s.left = g.left || s.left;

    const body = Array.isArray(g.snake) ? g.snake : [];
    const ok = body.length === s.length
      && body.every((p) => Array.isArray(p)
        && p[0] >= 0 && p[0] < s.cols && p[1] >= 0 && p[1] < s.rows);
    if (ok) s.me.snake = body.map((p) => ({ x: p[0], y: p[1] }));
    else resetSnake(s, s.me);
    if (Array.isArray(g.dir) && (g.dir[0] || g.dir[1])) {
      s.me.dir = { x: Math.sign(g.dir[0]) || 0, y: Math.sign(g.dir[1]) || 0 };
      if (!s.me.dir.x && !s.me.dir.y) s.me.dir = { x: 1, y: 0 };
    }
    if (s.rival) resetSnake(s, s.rival);
    return { state: s, records: data.records || {} };
  }
  return { state: null, records: data.records || {} };
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
