// ============================================================================
// 起動と配線
//
// DOM の配線と 1 tick のループだけを書く。
// ゲームの判断はすべて js/game/state.js にあり、ここは受け渡すだけの役。
// ============================================================================

import { clamp, stamp } from './core/util.js';
import { bindKeys, bindSwipe, bindPad } from './core/input.js';
import {
  initStore, saveState, loadData, saveRecord, clearSavedGame, defaultSnake,
} from './core/save.js';
import {
  createState, step, turn, setColor, restart, clearCanvas, setGrid,
  start, togglePause, maxLength, progress, countPainted,
} from './game/state.js';
import { COLORS, MAX_COLOR, KEY_SLOTS, BG, hexOf, nextColor } from './data/colors.js';
import { Renderer, exportCanvas } from './ui/render.js';
import { Palette } from './ui/palette.js';
import { Hud } from './ui/hud.js';

const $ = (id) => document.getElementById(id);

const el = {
  board: $('board'),
  boardWrap: $('boardWrap'),
  overlay: $('overlay'),
  progressBar: $('progressBar'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  statMoves: $('statMoves'),
  statTime: $('statTime'),
  statLeft: $('statLeft'),
  statBest: $('statBest'),
  btnPlay: $('btnPlay'),
  btnRestart: $('btnRestart'),
  btnEraser: $('btnEraser'),
  btnGuide: $('btnGuide'),
  btnExport: $('btnExport'),
  btnClear: $('btnClear'),
  palette: $('palette'),
  pad: $('pad'),
  inSpeed: $('inSpeed'),
  inLength: $('inLength'),
  inGrid: $('inGrid'),
  inWrap: $('inWrap'),
  inRisky: $('inRisky'),
  inBody: $('inBody'),
  inGridline: $('inGridline'),
  inLight: $('inLight'),
  inGuide: $('inGuide'),
  valSpeed: $('valSpeed'),
  valLength: $('valLength'),
  statusHint: $('statusHint'),
  toast: $('toast'),
};

const hud = new Hud(el);
const renderer = new Renderer(el.board, el.boardWrap);

let state = null;
let records = {};
let last = 0;
let acc = 0;
let saveTimer = 0;
let light = false;

/* ------------------------------------------------------------------ 初期化 */

function boot() {
  initStore();
  const loaded = loadData();
  records = loaded.records || {};
  state = loaded.state || createState();
  if (loaded.state) palette?.refresh();

  renderer.layout(state.cols, state.rows);
  renderer.setBg(light ? BG.light : BG.dark);
  syncControls();
  refreshStatus();
  last = performance.now();
  requestAnimationFrame(frame);
}

const palette = new Palette(el.palette, {
  onPick: (i) => pickColor(i),
  onCustomChange: () => {
    renderer.dirty = true;
    markDirty();
  },
});

/* -------------------------------------------------------------- 状態の操作 */

function pickColor(i) {
  if (i < 1 || i > MAX_COLOR) return;
  state.color = clamp(i, 1, MAX_COLOR);
  if (state.eraser) state.eraser = false;
  palette.select(state.color);
  syncControls();
  markDirty();
}

function cycleColor(step2) {
  state.color = nextColor(state.color, step2);
  if (state.eraser) state.eraser = false;
  palette.select(state.color);
  syncControls();
  markDirty();
}

function toggleEraser() {
  state.eraser = !state.eraser;
  syncControls();
  markDirty();
}

function doTurn(dir) {
  if (state.status === 'idle') start(state);
  if (!turn(state, dir)) return;
  refreshStatus();
  markDirty();
}

function doPlay() {
  const r = togglePause(state);
  acc = 0;
  last = performance.now();
  refreshStatus();
}

function doRestart() {
  restart(state);
  renderer.dirty = true;
  refreshStatus();
  markDirty();
  hud.toast('蛇を中央に戻した。絵は残っています');
}

function doClear() {
  if (!window.confirm('キャンバスを全消しします。よろしいですか?')) return;
  clearCanvas(state);
  clearSavedGame();
  renderer.dirty = true;
  refreshStatus();
  markDirty();
  hud.toast('全消ししました');
}

function doExport() {
  const c = exportCanvas(state, 16, light ? BG.light : BG.dark);
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pixel-slither-${stamp()}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
  hud.toast('PNG を書き出しました');
}

function loadGuideFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    renderer.setGuide(img);
    el.btnGuide.setAttribute('aria-pressed', 'true');
    hud.toast('下書きを読み込みました (G で表示/非表示)');
  };
  img.onerror = () => hud.toast('画像を読み込めませんでした');
  img.src = url;
}

/* ------------------------------------------------------------------ 表示 */

function syncControls() {
  el.inSpeed.value = String(state.speed);
  el.valSpeed.textContent = String(state.speed);
  el.inLength.max = String(maxLength(state));
  el.inLength.value = String(state.length);
  el.valLength.textContent = String(state.length);
  el.inGrid.value = state.gridId;
  el.inWrap.checked = state.wrap;
  el.inRisky.checked = state.risky;
  el.inBody.checked = state.showBody;
  el.inGridline.checked = state.showGrid;
  el.inLight.checked = light;
  el.btnEraser.setAttribute('aria-pressed', state.eraser ? 'true' : 'false');
  el.btnEraser.textContent = state.eraser ? '消しゴム (使用中)' : '消しゴム  F';
  if (!state.eraser) palette.select(state.color);
}

/** 状態が変わったときの案内。 */
function refreshStatus() {
  const st = state.status;
  el.btnPlay.innerHTML = st === 'running'
    ? '一時停止 <kbd>Space</kbd>'
    : st === 'paused' ? '再開 <kbd>Space</kbd>' : 'スタート <kbd>Space</kbd>';
  if (st === 'over') {
    const why = state.reason === 'wall' ? '壁に当たりました' : '自分の体に当たりました';
    el.statusHint.textContent = `${why}。R でやり直せます。`;
  } else if (state.won) {
    el.statusHint.textContent = '全マス塗りました。絵ができました。';
  } else if (st === 'paused') {
    el.statusHint.textContent = '一時停止中。キャンバスを全部塗るとクリア。';
  } else {
    el.statusHint.textContent = 'キャンバスを全部塗るとクリア。塗った色は消えない。';
  }
  showOverlay();
}

/** 終了やクリアしたときの重ねメッセージ。 */
function showOverlay() {
  if (state.status === 'over') {
    const why = state.reason === 'wall' ? '壁に当たりました' : '自分の体に当たりました';
    const nodes = [
      makeEl('h2', '終了'),
      makeEl('p', why),
      makeEl('button', 'やり直す (R)'),
    ];
    nodes[2].className = 'btn primary';
    nodes[2].addEventListener('click', doRestart);
    hud.overlay(nodes);
  } else if (state.won) {
    const rec = records[state.gridId];
    const isNew = rec && rec.moves === state.moves;
    const nodes = [
      makeEl('h2', 'クリア！'),
      makeEl('p', `${state.moves} 手 / ${formatSec(state.elapsed)}`),
      makeEl('p', isNew ? 'ベスト更新！' : ''),
    ];
    nodes[1].className = 'record';
    const btn = makeEl('button', 'もう一度 (C)');
    btn.className = 'btn primary';
    btn.addEventListener('click', doClear);
    nodes.push(btn);
    hud.overlay(nodes);
  } else {
    hud.overlay(null);
  }
}

/** 要素をさっと作る。 */
function makeEl(tag, text) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}

function formatSec(v) {
  const s = Math.floor(Math.max(0, v));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ ループ */

function frame(now) {
  const dt = now - last;
  last = now;

  if (state.status === 'running') {
    state.elapsed += Math.min(dt, 1000) / 1000;
    acc += dt;
    const interval = 1000 / state.speed;
    let guard = 0;
    while (acc >= interval && guard < 240) {
      acc -= interval;
      guard += 1;
      const ev = step(state);
      if (ev.type !== 'step') break;
    }
    if (state.status !== 'running' || state.won) {
      acc = 0;
      markDirty();
      onFinish();
    } else {
      markDirty();
    }
  }

  renderer.draw(state, false);
  hud.update(state, records[state.gridId]);
  saveTimer += dt;
  if (saveTimer > 2500) {
    saveTimer = 0;
    if (dirty) {
      dirty = false;
      saveState(state);
    }
  }
  requestAnimationFrame(frame);
}

/** クリアしたときの記録更新。 */
function onFinish() {
  refreshStatus();
  if (state.won) {
    const isNew = saveRecord(state.gridId, { moves: state.moves, time: Math.floor(state.elapsed) });
    records = loadRecordsSafe();
    if (isNew) hud.toast('ベスト記録を更新しました');
  }
}

function loadRecordsSafe() {
  const data = loadData();
  return (data && data.records) || {};
}

let dirty = false;
function markDirty() {
  dirty = true;
  renderer.dirty = true;
}

/* ------------------------------------------------------------------ 入力 */

bindKeys({
  onTurn: (dir) => doTurn(dir),
  onCommand: (cmd) => {
    if (cmd === 'play') doPlay();
    else if (cmd === 'prevColor') cycleColor(-1);
    else if (cmd === 'nextColor') cycleColor(1);
    else if (cmd === 'eraser') toggleEraser();
    else if (cmd === 'guide') toggleGuide();
    else if (cmd === 'body') { state.showBody = !state.showBody; syncControls(); markDirty(); }
    else if (cmd === 'grid') { state.showGrid = !state.showGrid; syncControls(); markDirty(); }
    else if (cmd === 'restart') doRestart();
    else if (cmd === 'clear') doClear();
    else if (cmd === 'export') doExport();
  },
  onColorKey: (n) => {
    const idx = KEY_SLOTS[n - 1];
    if (idx) pickColor(idx);
  },
});

bindSwipe(el.boardWrap, (dir) => doTurn(dir));
bindPad(el.pad, (dir) => doTurn(dir));

function toggleGuide() {
  if (!renderer.guide) {
    el.inGuide.click();
    return;
  }
  const on = renderer.toggleGuide();
  el.btnGuide.setAttribute('aria-pressed', on ? 'true' : 'false');
}

/* ------------------------------------------------------------- UI イベント */

el.btnPlay.addEventListener('click', doPlay);
el.btnRestart.addEventListener('click', doRestart);
el.btnClear.addEventListener('click', doClear);
el.btnExport.addEventListener('click', doExport);
el.btnEraser.addEventListener('click', toggleEraser);
el.btnGuide.addEventListener('click', toggleGuide);
el.inGuide.addEventListener('change', (e) => loadGuideFile(e.target.files[0]));

el.inSpeed.addEventListener('input', () => {
  state.speed = clamp(Number(el.inSpeed.value), 1, 30);
  el.valSpeed.textContent = String(state.speed);
  markDirty();
});

el.inLength.addEventListener('input', () => {
  const v = clamp(Number(el.inLength.value), 2, maxLength(state));
  state.length = v;
  el.valLength.textContent = String(v);
  if (state.snake.length !== v) {
    if (v < state.snake.length) state.snake.length = v;
    else while (state.snake.length < v) {
      const lastSeg = state.snake[state.snake.length - 1];
      state.snake.push({ x: (lastSeg.x - state.dir.x + state.cols) % state.cols, y: (lastSeg.y - state.dir.y + state.rows) % state.rows });
    }
  }
  markDirty();
});

el.inGrid.addEventListener('change', () => {
  if (state.painted > 0 && !window.confirm('大きさを変えると絵が消えます。よろしいですか?')) {
    el.inGrid.value = state.gridId;
    return;
  }
  setGrid(state, el.inGrid.value);
  renderer.layout(state.cols, state.rows);
  records = loadRecordsSafe();
  syncControls();
  refreshStatus();
  markDirty();
});

el.inWrap.addEventListener('change', () => { state.wrap = el.inWrap.checked; markDirty(); });
el.inRisky.addEventListener('change', () => { state.risky = el.inRisky.checked; markDirty(); });
el.inBody.addEventListener('change', () => { state.showBody = el.inBody.checked; markDirty(); });
el.inGridline.addEventListener('change', () => { state.showGrid = el.inGridline.checked; markDirty(); });
el.inLight.addEventListener('change', () => {
  light = el.inLight.checked;
  renderer.setBg(light ? BG.light : BG.dark);
  markDirty();
});

/* ------------------------------------------------------------- ライフサイクル */

const ro = new ResizeObserver(() => {
  if (state) renderer.layout(state.cols, state.rows);
});
ro.observe(el.boardWrap);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.status === 'running') {
    state.status = 'paused';
    refreshStatus();
  }
  last = performance.now();
  acc = 0;
});

window.addEventListener('pagehide', () => { saveState(state); });
window.addEventListener('beforeunload', () => { saveState(state); });

if (window.matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('touch');
}

boot();

/**
 * URL に ?debug=1 を付けたときだけ中身をのぞけるようにする。
 * ブラウザ実機のテスト (test/browser.test.js) から使う。
 */
if (new URLSearchParams(location.search).has('debug')) {
  window.__px = {
    get state() { return state; },
    renderer,
    palette,
    draw: () => {
      renderer.dirty = true;
      renderer.draw(state, true);
      hud.update(state, records[state.gridId]);
    },
    countPainted,
    save: () => saveState(state),
  };
}
