// ============================================================================
// 起動と配線
//
// DOM の配線と 1 tick のループだけを書く。
// ゲームの判断はすべて js/game/state.js にあり、ここは受け渡すだけの役。
// ============================================================================

import { clamp, stamp, formatTime } from './core/util.js';
import { bindKeys, bindSwipe, bindPad } from './core/input.js';
import {
  initStore, saveState, loadData, saveRecord, clearSavedGame,
} from './core/save.js';
import {
  createState, step, turn, restart, clearCanvas, setGrid, start, togglePause,
  maxLength, players, areaOf, recount, timeUp, endRound,
} from './game/state.js';
import { MAX_COLOR, KEY_SLOTS, BG, nextColor } from './data/colors.js';
import { LEVELS, LEVEL_LIST } from './game/ai.js';
import { Renderer, exportCanvas } from './ui/render.js';
import { Palette } from './ui/palette.js';
import { Hud } from './ui/hud.js';
import { makeRoomCode, normalizeRoomCode, isRoomCode } from './net/channel.js';
import { hostWithTabs, joinWithTabs } from './net/tabs.js';
import { hostWithPeer, joinWithPeer } from './net/peer.js';
import { Netplay } from './net/netplay.js';

const $ = (id) => document.getElementById(id);

const el = {
  board: $('board'),
  boardWrap: $('boardWrap'),
  overlay: $('overlay'),
  progressBar: $('progressBar'),
  progressFill: $('progressFill'),
  progressText: $('progressText'),
  versus: $('versus'),
  barMine: $('barMine'),
  barRival: $('barRival'),
  barMineText: $('barMineText'),
  barRivalText: $('barRivalText'),
  barMineName: $('barMineName'),
  barRivalName: $('barRivalName'),
  statMoves: $('statMoves'),
  statTime: $('statTime'),
  statTimeLabel: $('statTimeLabel'),
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
  modeSeg: $('modeSeg'),
  modeHint: $('modeHint'),
  battlePanel: $('battlePanel'),
  foeAi: $('foeAi'),
  foeTabs: $('foeTabs'),
  foeNet: $('foeNet'),
  inLevel: $('inLevel'),
  valLevel: $('valLevel'),
  netBox: $('netBox'),
  netHost: $('netHost'),
  btnMakeRoom: $('btnMakeRoom'),
  btnJoin: $('btnJoin'),
  inRoom: $('inRoom'),
  roomCode: $('roomCode'),
  netStatus: $('netStatus'),
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
let net = null;
let currentChannel = null;
let last = 0;
let acc = 0;
let saveTimer = 0;
let light = false;
let dirty = false;
let foe = 'ai';
let room = makeRoomCode();
let level = LEVELS.normal.id;

const palette = new Palette(el.palette, {
  onPick: (i) => pickColor(i),
  onCustomChange: () => {
    renderer.dirty = true;
    markDirty();
  },
});

/* ------------------------------------------------------------------ 初期化 */

function boot() {
  initStore();
  const loaded = loadData();
  records = loaded.records || {};
  state = loaded.state || createState();
  level = state.aiLevel || level;

  renderer.layout(state.cols, state.rows);
  renderer.setBg(light ? BG.light : BG.dark);
  if (loaded.state) palette.refresh();
  applyMode(state.mode, { keepState: true });
  syncControls();
  refreshStatus();
  last = performance.now();
  requestAnimationFrame(frame);
}

function markDirty() {
  dirty = true;
  renderer.dirty = true;
}

/* -------------------------------------------------------------- 状態の操作 */

function pickColor(i) {
  if (i < 1 || i > MAX_COLOR) return;
  if (state.mode === 'battle' && state.rival && i === state.rival.color) {
    hud.toast('相手に使われている色は選べません');
    return;
  }
  state.me.color = i;
  if (state.rival && state.rival.color === i) {
    state.rival.color = nextColor(i, 1);
    syncControls();
  }
  palette.select(state.me.color);
  syncControls();
  markDirty();
}

function cycleColor(delta) {
  let c = state.me.color;
  for (let i = 0; i < MAX_COLOR; i++) {
    c = nextColor(c, delta);
    if (!state.rival || c !== state.rival.color) break;
  }
  pickColor(c);
}

function doTurn(dir) {
  if (state.status === 'idle') startPlay();
  if (net && !net.host) net.localInput(dir);
  else turn(state.me, dir);
  refreshStatus();
  markDirty();
}

/** 個人戦ならそのまま。陣営戦なら通信の具合を見て開始する。 */
function startPlay() {
  if (state.mode === 'battle' && foe !== 'ai') {
    if (!net) {
      hud.toast('先に部屋を作るか、コードを入れるか');
      return;
    }
    net.start();
    start(state);
    return;
  }
  start(state);
}

/** ホストなら、今の状態をすぐ送る。停止や開始を相手にも知らせるため。 */
function broadcastNow() {
  if (net && net.host) net.broadcast(state.touched || []);
}

function doPlay() {
  if (state.status === 'running') {
    togglePause(state);
  } else {
    startPlay();
  }
  acc = 0;
  last = performance.now();
  refreshStatus();
  broadcastNow();
}

function doRestart() {
  restart(state);
  renderer.dirty = true;
  if (net && net.host) net.armed = false;
  refreshStatus();
  markDirty();
  broadcastNow();
  hud.toast(state.mode === 'battle' ? 'START へ戻した。絵は残っています' : '蛇を中央に戻した。絵は残っています');
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

/* ------------------------------------------------------------------ モード */

function applyMode(mode, opt = {}) {
  const want = mode === 'battle' ? 'battle' : 'solo';
  if (state.mode !== want) {
    if (state.painted > 0 && !opt.keepState) {
      if (!window.confirm('モードを変えると絵が消えます。よろしいですか?')) {
        syncControls();
        return;
      }
    }
    const s = createState({
      mode: want,
      gridId: state.gridId,
      speed: state.speed,
      length: state.length,
      color: state.me.color,
      wrap: state.wrap,
      risky: state.risky,
      showBody: state.showBody,
      showGrid: state.showGrid,
      rivalColor: rivalColorFor(state.me.color),
      rivalName: 'あいて',
      rivalIsAi: true,
      aiLevel: level,
    });
    state = s;
    closeNet();
    renderer.layout(state.cols, state.rows);
    markDirty();
  }
  el.battlePanel.hidden = want !== 'battle';
  el.versus.hidden = want !== 'battle';
  el.progressBar.hidden = want === 'battle';
  el.statTimeLabel.textContent = want === 'battle' ? '残り' : '時間';
  for (const b of el.modeSeg.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.mode === want ? 'true' : 'false');
  }
  el.modeHint.textContent = want === 'battle'
    ? '陣営戦: 同じ盤面を 2 人で塗り合う。相手の色を塗り替えられる。時間切れの面積比で決着。'
    : '個人戦: 1 人でキャンバスを埋める。色を 1 つずつ選びながら動かします。';
  syncControls();
  refreshStatus();
}

/** 自分と重ならない相手の色を 1 つ選ぶ。 */
function rivalColorFor(mine) {
  for (let i = 1; i <= MAX_COLOR; i++) if (i !== mine) return i;
  return 1;
}

function setFoe(next) {
  foe = next;
  el.netBox.hidden = next === 'ai';
  if (next === 'ai' && net) closeNet();
  if (state.rival) state.rival.isAi = next === 'ai';
  syncControls();
  refreshStatus();
}

/* ------------------------------------------------------------------- 通信 */

function closeNet() {
  if (net) {
    try { net.ch.close(); } catch { /* 無視 */ }
    net = null;
  }
  el.roomCode.textContent = '—';
  el.netHost.hidden = false;
  el.btnJoin.disabled = false;
  el.btnMakeRoom.disabled = false;
}

function setNetStatus(text) {
  el.netStatus.textContent = text || 'まだつないでいません。';
}

function makeNet() {
  if (net) return net;
  net = new Netplay(state, currentChannel, {
    rivalColor: state.rival.color,
    rivalName: state.rival.name,
    rivalIsAi: foe === 'ai',
    level,
    onStatus: setNetStatus,
    onEnd: () => refreshStatus(),
  });
  state.aiLevel = level;
  return net;
}

async function hostRoom() {
  closeNet();
  el.btnMakeRoom.disabled = true;
  el.netStatus.textContent = '部屋を作っています…';
  try {
    currentChannel = foe === 'tabs' ? hostWithTabs(room) : await hostWithPeer(room);
    makeNet();
    el.roomCode.textContent = room;
    el.netHost.hidden = true;
    syncControls();
    refreshStatus();
  } catch (err) {
    setNetStatus(err.message);
    el.btnMakeRoom.disabled = false;
    room = makeRoomCode();
  }
}

async function joinRoom() {
  const code = normalizeRoomCode(el.inRoom.value);
  el.inRoom.value = code;
  if (!isRoomCode(code)) {
    setNetStatus('部屋コードが短すぎます (4 文字以上)');
    return;
  }
  closeNet();
  el.btnJoin.disabled = true;
  el.netStatus.textContent = 'つないでいます…';
  try {
    currentChannel = foe === 'tabs'
      ? joinWithTabs(code)
      : await joinWithPeer(code);
    const me = new Netplay(state, currentChannel, {      rivalColor: state.rival.color,
      rivalName: 'あいて',
      rivalIsAi: false,
      level,
      onStatus: setNetStatus,
      onEnd: () => refreshStatus(),
    });
    net = me;
    state.rival.isAi = false;
    renderer.dirty = true;
    currentChannel.send({ t: 'join', name: 'あなた', color: state.me.color });
    syncControls();
    refreshStatus();
  } catch (err) {
    setNetStatus(err.message);
    el.btnJoin.disabled = false;
  }
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
  el.inLevel.value = String(Math.max(0, LEVEL_LIST.findIndex((l) => l.id === level)));
  el.valLevel.textContent = (LEVELS[level] || LEVELS.normal).label;
  el.btnEraser.hidden = state.mode === 'battle';
  el.btnEraser.setAttribute('aria-pressed', 'false');
  el.btnEraser.textContent = '消しゴム  F';
  if (state.mode !== 'battle') palette.select(state.me.color);
  for (const r of [el.foeAi, el.foeTabs, el.foeNet]) r.checked = r.value === foe;
}

function refreshStatus() {
  const st = state.status;
  el.btnPlay.innerHTML = st === 'running'
    ? '一時停止 <kbd>Space</kbd>'
    : st === 'paused' ? '再開 <kbd>Space</kbd>' : 'スタート <kbd>Space</kbd>';

  if (state.mode === 'battle') {
    el.statusHint.textContent = battleHint(st);
  } else if (st === 'won') {
    el.statusHint.textContent = '全マス塗りました。絵ができました。';
  } else if (st === 'over') {
    el.statusHint.textContent = `${killReason(state)}。R でやり直せます。`;
  } else {
    el.statusHint.textContent = 'キャンバスを全部塗るとクリア。塗った色は消えない。';
  }
  showOverlay();
}

function battleHint(st) {
  if (!state.rival) return '準備中';
  if (st === 'over') return `${killReason(state)}。残り時間 ${formatTime(state.left)}。R でやり直せます。`;
  if (foe !== 'ai' && !net) return '部屋を作るか、コードを入れてつないでください。';
  if (st === 'running') return `${formatTime(state.left)} 後に決着。相手の色は塗り替えられる。`;
  if (st === 'paused') return '一時停止中。';
  return '準備完了。Space で開始。';
}

function killReason(s) {
  if (!s.me.alive) return s.me.killedBy === 'wall' ? '壁にぶつかった' : '自分の体に当たった';
  if (s.rival && !s.rival.alive) {
    return `${s.rival.name}が${s.rival.killedBy === 'wall' ? '壁にぶつかった' : '自分の体に当たった'}`;
  }
  return '時間切れ';
}

/** 終了やクリアしたときの重ねメッセージ。 */
function showOverlay() {
  if (state.mode === 'battle') return showDuelOverlay();
  if (state.status === 'over') {
    const why = killReason(state);
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
      makeEl('p', `${state.moves} 手 / ${formatTime(state.elapsed)}`),
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

function showDuelOverlay() {
  if (state.status === 'over') {
    const total = state.cols * state.rows;
    const mine = areaOf(state, state.me.color);
    const theirs = areaOf(state, state.rival ? state.rival.color : 0);
    const mp = (mine / total) * 100;
    const tp = (theirs / total) * 100;
    let title = '引き分け';
    if (mine > theirs) title = 'あなたの勝ち';
    else if (theirs > mine) title = `${state.rival.name}の勝ち`;
    const nodes = [
      makeEl('h2', title),
      makeEl('p', `あなた ${mp.toFixed(1)}%  /  ${state.rival ? state.rival.name : 'あいて'} ${tp.toFixed(1)}%`),
      makeEl('p', killReason(state)),
    ];
    nodes[1].className = 'record';
    const btn = makeEl('button', 'もう 1 本 (R)');
    btn.className = 'btn primary';
    btn.addEventListener('click', doRestart);
    nodes.push(btn);
    hud.overlay(nodes);
  } else {
    hud.overlay(null);
  }
}

function makeEl(tag, text) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}

/* ------------------------------------------------------------------ ループ */

let lastFrameAt = 0;

/** 1 フレーム進める。描画と進行をまとめる。 */
function frame(now) {
  const dt = Math.max(0, now - last);
  last = now;
  lastFrameAt = now;
  tick(dt, true);
  requestAnimationFrame(frame);
}

/**
 * 処理を回す。描画は draw 次第。
 * requestAnimationFrame はタブが背景になると止まるので、
 * ホストが別のタブに切り替わっても試合が凍らないように setInterval でも回す。
 */
function tick(dt, draw) {
  // ホストだけが snake を進める。ゲストは受け取ったフレームを描くだけ。
  const driving = !net || net.host;
  if (state.status === 'running' && driving) {
    if (state.mode === 'solo') {
      state.elapsed += Math.min(dt, 1000) / 1000;
    } else {
      state.left = Math.max(0, state.left - Math.min(dt, 1000) / 1000);
      if (timeUp(state)) {
        endRound(state);
        acc = 0;
        markDirty();
        onFinish();
        if (net && net.host) net.broadcast([]);
      }
    }
    if (state.status === 'running') {
      acc += dt;
      const interval = 1000 / state.speed;
      let guard = 0;
      while (acc >= interval && guard < 240) {
        acc -= interval;
        guard += 1;
        if (net && net.host) net.advance();
        const ev = step(state);
        if (net && net.host) net.broadcast(state.touched);
        if (ev.type !== 'step') break;
      }
    }
    if (state.status !== 'running' || state.won) {
      acc = 0;
      markDirty();
      onFinish();
      broadcastNow();
    } else {
      markDirty();
    }
  }

  if (draw) {
    renderer.draw(state, false);
    if (state.mode === 'battle') hud.updateDuel(state);
    else hud.updateSolo(state);
    hud.updateRecord(records[state.gridId]);
  }

  saveTimer += dt;
  if (saveTimer > 2500) {
    saveTimer = 0;
    if (dirty) {
      dirty = false;
      saveState(state);
    }
  }
}

/** rAF が止まっているときの保険。進行だけ進める。 */
setInterval(() => {
  const now = performance.now();
  if (now - lastFrameAt < 350) return;
  const dt = Math.max(0, now - last);
  last = now;
  tick(dt, false);
}, 200);

function onFinish() {
  if (state.mode === 'battle') {
    refreshStatus();
    return;
  }
  refreshStatus();
  if (state.won) {
    const isNew = saveRecord(state.gridId, {
      moves: state.moves,
      time: Math.floor(state.elapsed),
    });
    if (isNew) hud.toast('ベスト記録を更新しました');
  }
}

/* ------------------------------------------------------------------ 入力 */

bindKeys({
  onTurn: (dir) => doTurn(dir),
  onCommand: (cmd) => {
    if (cmd === 'play') doPlay();
    else if (cmd === 'prevColor') cycleColor(-1);
    else if (cmd === 'nextColor') cycleColor(1);
    else if (cmd === 'eraser') { if (state.mode === 'solo') toggleEraser(); }
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

function toggleEraser() {
  state.me.eraser = !state.me.eraser;
  syncControls();
  markDirty();
}

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

el.modeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (b) applyMode(b.dataset.mode);
});

for (const r of [el.foeAi, el.foeTabs, el.foeNet]) {
  r.addEventListener('change', () => setFoe(r.value));
}

el.inLevel.addEventListener('input', () => {
  const l = LEVEL_LIST[Number(el.inLevel.value)];
  if (!l) return;
  level = l.id;
  state.aiLevel = level;
  if (net) net.level = level;
  el.valLevel.textContent = l.label;
  markDirty();
});

el.btnMakeRoom.addEventListener('click', hostRoom);
el.btnJoin.addEventListener('click', joinRoom);
el.inRoom.addEventListener('input', () => {
  el.inRoom.value = normalizeRoomCode(el.inRoom.value);
});
el.inRoom.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

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
  for (const p of players(state)) {
    if (p.snake.length > v) p.snake.length = v;
    else {
      const lastSeg = p.snake[p.snake.length - 1];
      while (p.snake.length < v && lastSeg) {
        p.snake.push({
          x: (lastSeg.x - p.dir.x + state.cols) % state.cols,
          y: (lastSeg.y - p.dir.y + state.rows) % state.rows,
        });
      }
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
    get net() { return net; },
    get room() { return room; },
    renderer,
    palette,
    setFoe,
    hostRoom,
    joinRoom,
    draw: () => {
      renderer.dirty = true;
      renderer.draw(state, true);
    },
    recount,
    save: () => saveState(state),
  };
}
