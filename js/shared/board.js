// ============================================================================
// 共有盤のコア
//
// サイトを見てる全員が同じ 1 枚の巨大な盤を共有する。
// このファイルはブラウザでも Durable Object でも動く。DOM にも
// Cloudflare の API にも依存しない純ロジックだけを書く。
// サーバーが権威を持つ。クライアントは描画だけを行う。
// 判定 (体当たり・色素取得・面積) は必ずサーバー側で行う。
//
// 4 つの主な仕組み:
//   1. 巨大盤 … 1 マス 1 バイト。2000x1200 = 240 万マス。
//   2. 蛇     … 自分のしっぽが色を置く。体当たりで脱落。
//   3. 色素   … 盤上に散る小さな粒。取ると大きくなる。
//   4. 成長   … 色素を取るほど 速度・ブラシ幅・体長が増えて，占領面積が加速。
// ============================================================================

/** 盤の大きさ。既定は 2000 x 1200 マス (240 万マス = 2.4MB)。 */
export const BOARD_W = 2000;
export const BOARD_H = 1200;

/** 1 tick の長さ (ms)。サーバは 20 tick/秒で回す。 */
export const TICK_MS = 50;

/** 参加できる最大人数。 */
export const MAX_PLAYERS = 64;

/** 蛇の初期の体長。 */
export const START_LENGTH = 12;

/** 色素の初期サイズ (半径)。取得ごとに増える。 */
export const START_SIZE = 3;

/** 1 隻あたりの最大サイズ。 */
export const MAX_SIZE = 48;

/** 色素をいくつ取ると大きさが 1 増えるか。 */
export const PIGMENT_PER_LEVEL = 3;

/** 速度は size に応じて緩やかに上がる。 */
export const BASE_SPEED = 0.14;   // マス/tick
export const MAX_SPEED = 0.34;

/** 繁殖しすぎ防止: 色は 20 色。 */
export const TEAM_COLORS = 20;

/** 色素が同時にいくつまで置けるか。 */
export const MAX_PIGMENTS = 220;

/**  inactivity で脱落した蛇を消すまでの tick。 */
export const DEATH_LINGER = 30;

const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** 座標から 0-3 の向き番号へ。 */
export function dirFromDelta(dx, dy) {
  if (dy < 0) return 0;
  if (dx > 0) return 1;
  if (dy > 0) return 2;
  return 3;
}

/**
 * 新しい盤を作る。paint は 0 (未塗り) で埋まった TypedArray。
 * @param {number} [w]
 * @param {number} [h]
 */
export function createBoard(w = BOARD_W, h = BOARD_H) {
  return {
    w,
    h,
    paint: new Uint8Array(w * h),
    /** 色素の配列 [{x, y, tier}] */
    pigments: [],
    players: new Map(),
    nextId: 1,
    /** 色を、报名順に 1 つずつ割り当てる。 */
    taken: new Set(),
    tick: 0,
    /** この tick で変わったマス。サーバが配信に使う。 */
    touched: [],
  };
}

/**
 * 色 空いているこの一座。人気色は避けるため、报名順に回す。
 * @returns {number} 1..TEAM_COLORS
 */
export function pickColor(board) {
  for (let c = 1; c <= TEAM_COLORS; c++) {
    if (!board.taken.has(c)) return c;
  }
  // 全部埋まっていれば 1 から選ぶ (取得はできなくなる)。
  return 1;
}

/** 色を予約済みにする。 */
export function reserveColor(board, c) {
  board.taken.add(c);
}

/** 色を解放する。蛇がいなくなった色だけ。 */
export function releaseColorIfFree(board, c) {
  for (const p of board.players.values()) {
    if (p.alive && p.color === c) return;
  }
  board.taken.delete(c);
}

/**
 * size から速さ (マス/tick) を求める。大きいほど速い。
 * size は 1 始まり���最大���。
 * @param {number} size
 * @returns {number}
 */
export function speedForSize(size) {
  const t = (Math.min(size, MAX_SIZE) - 1) / (MAX_SIZE - 1);
  return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * Math.sqrt(t);
}

/**
 * size からブラシ幅 (何マス角) を求める。
 * size 1 で 1 マス、大きいほど 2 マス角。
 * @param {number} size
 * @returns {number}
 */
export function brushForSize(size) {
  if (size >= 30) return 5;
  if (size >= 18) return 4;
  if (size >= 8) return 3;
  return 2;
}

/**
 * size から体長を求める。size 1 で START_LENGTH、大きいほど長い。
 * @param {number} size
 * @returns {number}
 */
export function lengthForSize(size) {
  return START_LENGTH + Math.floor((size - 1) * 0.6);
}

/** 蛇を作る。色を選んで入盤する。 */
export function addPlayer(board, name, size = START_SIZE) {
  const id = board.nextId++;
  const color = pickColor(board);
  reserveColor(board, color);
  const p = {
    id,
    name: String(name || '名無しの蛇').slice(0, 16),
    color,
    size,
    sizeProgress: 0,
    alive: true,
    x: 0,
    y: 0,
    dir: 1,
    queue: [],
    body: [],
    score: 0,
    kills: 0,
    best: 0,
    lastInput: 0,
    /** 脱落してから消えるまでの tick。 */
    linger: 0,
  };
  placeAtSafeSpot(board, p);
  board.players.set(id, p);
  return p;
}

/** 蛇を安全な場所 (色素の近く) に置く。 */
function placeAtSafeSpot(board, p) {
  const len = lengthForSize(p.size);
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = 20 + Math.floor(Math.random() * (board.w - 40));
    const y = 20 + Math.floor(Math.random() * (board.h - 40));
    p.x = x;
    p.y = y;
    p.dir = attempt % 4;
    p.body = [];
    const h = p.x;
    const v = p.y;
    for (let i = 0; i < len; i++) {
      p.body.push({ x: h - DIRS[p.dir].x * i, y: v - DIRS[p.dir].y * i });
    }
    if (isSafe(board, p)) return;
  }
}

/** 生まれSemiplace が他の蛇と重ならないか。 */
function isSafe(board, p) {
  if (p.body.length === 0) return true;
  const head = p.body[0];
  for (const cell of p.body) {
    if (cell.x < 1 || cell.y < 1 || cell.x >= board.w - 1 || cell.y >= board.h - 1) return false;
    for (const other of board.players.values()) {
      if (other === p || !other.alive) continue;
      const oh = other.body[0];
      if (!oh) continue;
      const dx = Math.abs(oh.x - cell.x);
      const dy = Math.abs(oh.y - cell.y);
      if (dx < 14 && dy < 14) return false;
    }
  }
  return true;
}

/**
 * 指定した識別子と色で蛇を入盤させる。復活に使う。
 * 色が既に他の蛇に使われていれば、空いている色を代わりに割り当てる。
 * @returns {{player: object, color: number, wanted: number}}
 */
export function spawnWithId(board, id, name, wantColor) {
  const want = clampColor(wantColor);
  const free = !board.taken.has(want);
  const p = addPlayer(board, name);
  // addPlayer が取った色を一旦戻し、编号と色を決定する。
  board.players.delete(p.id);
  releaseColorIfFree(board, p.color);
  p.id = id;
  if (free) {
    p.color = want;
    reserveColor(board, want);
  }
  p.kills = 0;
  p.score = 0;
  board.players.set(id, p);
  return { player: p, color: p.color, wanted: want };
}

/** 色番号を 1..TEAM_COLORS に収める。 */
function clampColor(c) {
  const v = Number(c);
  if (!Number.isFinite(v)) return 1;
  const n = Math.round(v);
  if (n < 1) return 1;
  if (n > TEAM_COLORS) return TEAM_COLORS;
  return n;
}

/** 蛇を盤から消す。色は空いていれば解放。 */
export function removePlayer(board, id) {
  const p = board.players.get(id);
  if (!p) return null;
  // 先に盤から消してから色を判定する。順序を逆にすると
  // 自分自身を見て色を解放できない。
  board.players.delete(id);
  releaseColorIfFree(board, p.color);
  return p;
}

/** 蛇の向きを変える。逆向きと連打は受け付けない。 */
export function steer(p, dir, now) {
  if (!p.alive) return false;
  p.lastInput = now;
  if (p.queue.length >= 2) return false;
  const last = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
  if (last === dir) return false;
  const opposite = (last + 2) % 4;
  if (dir === opposite) return false;
  p.queue.push(dir);
  return true;
}

/** size を 1 増やす。最大まで。 */
export function grow(p, amount = 1) {
  const before = p.size;
  p.size = Math.min(MAX_SIZE, p.size + amount);
  if (p.size > before) p.best = Math.max(p.best, p.size);
  return p.size - before;
}

/** 蛇 1 隻を 1 tick 進める。描画はしない。 */
export function stepPlayer(board, p) {
  if (!p.alive) {
    p.linger -= 1;
    if (p.linger <= 0) board.players.delete(p.id);
    return;
  }

  if (p.queue.length) p.dir = p.queue.shift();
  // 1 tick に 1 マス届かないので、座標は float で持つ。
  const speed = speedForSize(p.size);
  p.fx = (p.fx === undefined ? p.x : p.fx) + DIRS[p.dir].x * speed;
  p.fy = (p.fy === undefined ? p.y : p.fy) + DIRS[p.dir].y * speed;
  p.x = Math.round(p.fx);
  p.y = Math.round(p.fy);

  // 盤の外に出たら壁。脱落。
  if (p.x < 1 || p.y < 1 || p.x >= board.w - 1 || p.y >= board.h - 1) {
    die(board, p, 'wall');
    return;
  }

  // まだ同じマスなら体は伸ばさない。伸ばすと頭が重なり、
  // 次の tick に自分を当成ててしまう。
  const head = p.body[0];
  const moved = !head || head.x !== p.x || head.y !== p.y;
  if (!moved) {
    collectPigments(board, p);
    paintAt(board, p, p.x, p.y, p.color);
    return;
  }

  // 自分の体に当たる。尾の 1 マスは空くので除外。
  for (let i = 1; i < p.body.length - 1; i++) {
    const c = p.body[i];
    if (c.x === p.x && c.y === p.y) {
      die(board, p, 'body');
      return;
    }
  }

  // 前にいる蛇の体にぶつかると脱落して、その蛇の karma が入る。
  for (const other of board.players.values()) {
    if (other === p || !other.alive) continue;
    const oh = other.body[0];
    if (!oh || (oh.x === p.x && oh.y === p.y)) continue;
    for (let i = 0; i < other.body.length; i++) {
      const c = other.body[i];
      if (c.x === p.x && c.y === p.y) {
        die(board, p, 'body');
        other.kills += 1;
        other.score += 25;
        return;
      }
    }
  }

  // 体を伸ばす。頭を一歩前に出し、size に応じた長さに整える。
  p.body.unshift({ x: p.x, y: p.y });
  const want = lengthForSize(p.size);
  while (p.body.length > want) p.body.pop();

  collectPigments(board, p);
  paintAt(board, p, p.x, p.y, p.color);
}

/** 脱落。snake は盤からすぐには消えない。 */
function die(board, p, cause) {
  if (!p.alive) return;
  p.alive = false;
  p.cause = cause;
  p.linger = DEATH_LINGER;
}

/** 蛇の頭まわりの色素を取る。 */
function collectPigments(board, p) {
  const r = p.size;
  for (let i = board.pigments.length - 1; i >= 0; i--) {
    const pig = board.pigments[i];
    const dx = pig.x - p.x;
    const dy = pig.y - p.y;
    if (dx * dx + dy * dy > r * r) continue;
    board.pigments.splice(i, 1);
    p.sizeProgress += 1;
    if (p.sizeProgress >= PIGMENT_PER_LEVEL) {
      p.sizeProgress = 0;
      grow(p, 1);
    }
  }
}

/** (x, y) を中心にブラシ幅で色を置く。 */
function paintAt(board, p, x, y, color) {
  const b = brushForSize(p.size);
  const half = Math.floor((b - 1) / 2);
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= board.w || ny >= board.h) continue;
      const i = ny * board.w + nx;
      if (board.paint[i] !== color) {
        board.paint[i] = color;
        board.touched.push(i);
      }
    }
  }
  p.score += b * b;
}

/** 色素を足す。上限を超えたら古いのを捨てる。 */
export function addPigment(board, x, y, tier = 1) {
  if (board.pigments.length >= MAX_PIGMENTS) {
    board.pigments.shift();
  }
  board.pigments.push({ x, y, tier });
}

/** ランダムな場所に色素を撒く。 */
export function scatterPigments(board, count) {
  const target = Math.min(MAX_PIGMENTS, count);
  while (board.pigments.length < target) {
    addPigment(
      board,
      10 + Math.floor(Math.random() * (board.w - 20)),
      10 + Math.floor(Math.random() * (board.h - 20)),
      1,
    );
  }
}

/** 盤全体を 1 tick 進める。pigment の補充も行う。 */
export function step(board, tickNo) {
  board.tick = tickNo;
  board.touched.length = 0;
  for (const p of board.players.values()) {
    stepPlayer(board, p);
  }
  scatterPigments(board, MAX_PIGMENTS);
}

/**
 * 色ごとの塗り面積を数える。
 * @param {Uint8Array} paint
 * @param {number} w
 * @returns {Int32Array} 長さ TEAM_COLORS+1。添字が色番号。
 */
export function countByColor(paint, w, out) {
  const counts = out || new Int32Array(TEAM_COLORS + 1);
  counts.fill(0);
  for (let i = 0; i < paint.length; i++) {
    const c = paint[i];
    if (c !== 0) counts[c] += 1;
  }
  return counts;
}

/** 塗り面積が多い順に並べたリーダー。 */
export function leaderboard(counts) {
  const rows = [];
  for (let c = 1; c <= TEAM_COLORS; c++) {
    if (counts[c] > 0) rows.push({ color: c, area: counts[c] });
  }
  rows.sort((a, b) => b.area - a.area);
  return rows;
}

/** 蛇 1 隻の通信用の見た目を作る。 */
export function packPlayer(p) {
  return {
    i: p.id,
    n: p.name,
    c: p.color,
    s: p.size,
    x: p.x,
    y: p.y,
    d: p.dir,
    a: p.alive ? 1 : 0,
    k: p.kills,
    sc: p.score,
  };
}

/** 1 tick の差分を配送用の形にする。 */
export function packDelta(board, counts) {
  return {
    t: 'f',
    n: board.tick,
    // 変わったマスだけ。index と色だけ，我已经很小了。
    p: board.touched,
    g: board.pigments.length,
  };
}
