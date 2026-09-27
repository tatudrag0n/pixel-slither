// ============================================================================
// 対戦の同期
//
// ホストが snake を進め、状態を毎 tick 送る。ゲストは入力を送るだけ。
// 通信するのは「1 tick で変わったところ」だけなので軽い。
//
// 送るもの:
//   join  / welcome / bye   握手
//   in                      入力 (ゲスト → ホスト)
//   full                    参加時の絵一式
//   f                       毎 tick の差分
//
// 差分の例: 1 tick で しっぽが 1 マス色を変えたなら f.p = [[123, 4]] だけ。
// ============================================================================

import { put, players, turn, DIRS } from '../game/state.js';
import { encodePaint, decodePaint } from '../game/paint.js';
import { chooseDir } from '../game/ai.js';

/** 向き名と 1 文字の ID の対応。 */
const DIR_CODE = { right: 0, left: 1, up: 2, down: 3 };
const CODE_DIR = ['right', 'left', 'up', 'down'];

/** プレイヤーを送る形にする。 */
function packPlayer(p) {
  const flat = [p.color, p.alive ? 1 : 0, DIR_CODE[dirOf(p)] ?? 0];
  for (const c of p.snake) flat.push(c.x, c.y);
  return flat;
}

function dirOf(p) {
  const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
  if (last.y < 0) return 'up';
  if (last.y > 0) return 'down';
  if (last.x < 0) return 'left';
  return 'right';
}

function unpackPlayer(arr, p, s) {
  p.color = arr[0];
  p.alive = arr[1] === 1;
  const name = CODE_DIR[arr[2]] || 'right';
  p.dir = { ...DIRS[name] };
  p.queue = [];
  p.snake = [];
  for (let i = 3; i + 1 < arr.length; i += 2) {
    p.snake.push({ x: arr[i], y: arr[i + 1] });
  }
  void s;
}

export class Netplay {
  /**
   * @param {object} s       ゲーム状態 (個人戦でも陣営戦でもよい)
   * @param {object} channel makeChannel で作った通信
   * @param {object} opt
   * @param {string} opt.level AI の難易度 (ホスト側)
   * @param {number} opt.rivalColor
   * @param {string} opt.rivalName
   * @param {boolean} opt.rivalIsAi
   */
  constructor(s, channel, opt = {}) {
    this.s = s;
    this.ch = channel;
    this.host = channel.role === 'host';
    this.level = opt.level || 'normal';
    this.tickNo = 0;
    /** ホストが受け取って溜めた相手の入力。 */
    this.inbox = [];
    /** 接続の状況の文言。 */
    this.status = '';
    this.connected = true;
    this.onStatus = opt.onStatus || (() => {});
    this.onEnd = opt.onEnd || (() => {});
    this.armed = false;
    this.setupRival(opt);
    channel.onMessage((m) => this.recv(m));
    if (channel.onStatus) channel.onStatus((text) => this.say(text));
  }

  /** 相手プレイヤーを作る。AI なら isAi を立てる。 */
  setupRival(opt) {
    const s = this.s;
    if (s.mode !== 'battle' || !s.rival) return;
    s.rival.name = opt.rivalName || s.rival.name;
    s.rival.color = opt.rivalColor || s.rival.color;
    s.rival.isAi = opt.rivalIsAi !== false;
  }

  /** 通信の文言を UI に流す。 */
  say(text) {
    this.status = text;
    this.onStatus(text);
  }

  /* ------------------------------------------------------------ ホスト側 */

  /** 参加要求に応じ、絵一式を送る。 */
  acceptGuest(remote = {}) {
    if (!this.host) return;
    if (remote.color) this.s.rival.color = remote.color;
    if (remote.name) this.s.rival.name = remote.name;
    this.s.rival.isAi = false;
    this.ch.send({
      t: 'welcome',
      paint: encodePaint(this.s.paint),
      players: players(this.s).map(packPlayer),
      seconds: this.s.left,
      rivalColor: this.s.me.color,
    });
    this.say('参加がありました。開始できます。');
    this.start();
  }

  /** ホストは握手で吃完たら自動で開始する。 */
  start() {
    this.armed = true;
    if (this.s.status === 'idle') this.s.status = 'running';
  }

  /** 1 tick 進める。ホストだけ。 */
  advance() {
    if (!this.host) return;
    if (this.s.rival && this.s.rival.isAi && this.s.rival.alive) {
      const d = chooseDir(this.s, this.s.rival, { level: this.level, rand: Math.random() });
      if (d) turn(this.s.rival, d);
    }
    for (const d of this.inbox) turn(this.s.rival, d);
    this.inbox.length = 0;
    this.tickNo += 1;
  }

  /** 1 tick 進んだあと、差分を送る。ホストだけ。 */
  broadcast(touched) {
    if (!this.host) return;
    const s = this.s;
    this.ch.send({
      t: 'f',
      n: this.tickNo,
      l: Math.round(s.left * 1000),
      st: s.status,
      p: (touched || []).map((i) => [i, s.paint[i]]),
      s: players(s).map(packPlayer),
      e: s.rival ? (s.rival.alive ? 0 : 1) : 0,
    });
  }

  /* ------------------------------------------------------------ ゲスト側 */

  /** ゲストは入力を送るだけ。 */
  localInput(name) {
    if (!this.host) {
      this.ch.send({ t: 'in', d: name });
      return;
    }
    turn(this.s.me, name);
  }

  /* ------------------------------------------------------------ 受信処理 */

  recv(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      this.acceptGuest(m);
      return;
    }
    if (m.t === 'in') {
      if (this.host) this.inbox.push(m.d);
      return;
    }
    if (m.t === 'welcome') {
      this.applyFull(m);
      return;
    }
    if (m.t === 'f') {
      this.applyFrame(m);
      return;
    }
    if (m.t === 'bye') {
      this.connected = false;
      this.say('相手が切断しました');
    }
  }

  /** 参加時の絵一式を反映する。 */
  applyFull(m) {
    const s = this.s;
    if (m.paint) {
      s.paint = decodePaint(m.paint, s.cols * s.rows);
      recountCounts(s);
    }
    const me = s.me;
    const rival = s.rival;
    if (Array.isArray(m.players) && rival) {
      unpackPlayer(m.players[0], rival, s);
      unpackPlayer(m.players[1], me, s);
    }
    if (m.rivalColor) me.color = m.rivalColor;
    if (m.seconds) s.left = m.seconds;
    s.armed = true;
    this.armed = true;
    this.say('接続しました');
  }

  /** 毎 tick の差分を反映する。 */
  applyFrame(m) {
    const s = this.s;
    if (Array.isArray(m.p)) {
      for (const [i, c] of m.p) {
        const x = i % s.cols;
        const y = (i - x) / s.cols;
        put(s, x, y, c);
      }
    }
    if (Array.isArray(m.s) && s.rival) {
      unpackPlayer(m.s[0], s.rival, s);
      unpackPlayer(m.s[1], s.me, s);
    }
    if (typeof m.l === 'number') s.left = m.l / 1000;
    if (m.st && m.st !== s.status) {
      s.status = m.st;
      if (m.st === 'over' || m.st === 'won') this.onEnd(s);
    }
    this.tickNo = m.n;
  }

  /** 自分から見た相手の index。 */
  remoteIsFirst() {
    return !this.host;
  }
}

/** 塗り面積を数え直す。 */
function recountCounts(s) {
  s.counts.fill(0);
  let total = 0;
  for (let i = 0; i < s.paint.length; i++) {
    const v = s.paint[i];
    if (!v) continue;
    s.counts[v] += 1;
    total += 1;
  }
  s.painted = total;
}
