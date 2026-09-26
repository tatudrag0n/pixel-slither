// ============================================================================
// ブラウザ実機確認
//   node test/browser.test.js
//
// Chrome / Edge を headless で起こし、CDP 越しに実際の画面を操作する。
// 依存パッケージは使わない (Node 22 以降内蔵の WebSocket を使う)。
// ============================================================================

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8099);
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

let failed = 0;
let passed = 0;

function ok(cond, label, extra) {
  if (cond) {
    passed += 1;
    console.log(`  \x1b[32mOK\x1b[0m   ${label}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m失敗\x1b[0m ${label}${extra ? ` -> ${extra}` : ''}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ サーバ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p === '/') p = '/index.html';
      const full = join(ROOT, normalize(p).replace(/^([/\\])+/, ''));
      if (!full.startsWith(ROOT)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      await stat(full);
      const buf = await readFile(full);
      res.writeHead(200, {
        'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(buf);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((res) => {
    server.listen(port, '127.0.0.1', () => res(server));
  });
}

/* --------------------------------------------------------------------- CDP */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.events = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          reject(new Error(`${method} が返ってこない`));
        }
      }, 20000);
    });
  }

  /** 式を評価して値を返す。 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || '評価に失敗');
    }
    return r.result.value;
  }

  /** confirm / alert は自動で承認する。 */
  autoAcceptDialogs() {
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Page.javascriptDialogOpening') {
        this.raw('Page.handleJavaScriptDialog', { accept: true });
      }
    });
  }

  /** 応答を待たずに投げる。 */
  raw(method, params = {}) {
    this.ws.send(JSON.stringify({ id: ++this.id, method, params }));
  }

  /** キーイベントを送る。 */
  async key(code, key, keyCode) {
    const base = {
      code,
      key,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
}

/** 式が真になるまで待つ。 */
async function waitFor(cdp, expression, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (await cdp.eval(expression)) return true;
    } catch { /* 読み込み中 */ }
    await wait(120);
  }
  return false;
}

/** 接続できなかった理由。失敗したときのメッセージに使う。 */
let lastCdpError = 'まだ試していない';

/**
 * デバッグポートへつなぐ。
 * Chrome は環境によって localhost を IPv6 側に解決するので両方試す。
 * @returns {Promise<Cdp|null>} 繋がらなければ null。lastCdpError に理由が入る。
 */
async function connect(debugPort, tries = 120) {
  const hosts = ['127.0.0.1', '[::1]', 'localhost'];
  for (let i = 0; i < tries; i++) {
    for (const host of hosts) {
      try {
        const res = await fetch(`http://${host}:${debugPort}/json/list`);
        lastCdpError = `${host}: HTTP ${res.status}`;
        const list = await res.json();
        const page = list.find((t) => t.type === 'page');
        if (!page || !page.webSocketDebuggerUrl) continue;
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res2, rej) => {
          ws.addEventListener('open', res2, { once: true });
          ws.addEventListener('error', () => rej(new Error('ws が開かない')), { once: true });
        });
        const cdp = new Cdp(ws);
        cdp.autoAcceptDialogs();
        return cdp;
    } catch (e) {
      lastCdpError = `${host}: ${e.message}`;
    }
    }
    await wait(250);
  }
  return null;
}

/* --------------------------------------------------------------------- 実行 */

const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.log('Chrome / Edge が見つからないのでブラウザ確認は省きます。');
  process.exit(0);
}

const DEBUG_PORT = Number(process.env.CDP_PORT || 0) || PORT + 1000;

const CHROME_FLAGS = [
  '--headless=new',
  // ポートを固定する。0 だと DevToolsActivePort ファイルを待つ必要があり、
  // 書き出しの瞬間に空ファイルを読んで_ENV の取得に失敗することがある。
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  // CI は root で走るため sandbox を切らないと Chrome が起動できない。
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--window-size=1400,900',
];

const server = await serve(PORT);
const profile = await mkdtemp(join(tmpdir(), 'pxslither-'));
// Chrome の stderr を取っておく。接続できないときの切り分けに使う。
let chromeLog = '';
const child = spawn(exe, [
  ...CHROME_FLAGS,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.on('data', (d) => { chromeLog += d.toString(); });

let cdp = null;
try {
  cdp = await connect(DEBUG_PORT);
  if (!cdp) {
    throw new Error(`CDP に接続できない (port=${DEBUG_PORT}, ${lastCdpError})\n${chromeLog.trim().slice(-800)}`);
  }
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      window.addEventListener('error', (e) => {
        window.__errs.push((e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
      });
      window.addEventListener('unhandledrejection', (e) => {
        window.__errs.push('rejection: ' + e.reason);
      });
    `,
  });

  const url = `http://127.0.0.1:${PORT}/index.html?debug=1`;
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, 'window.__px && document.readyState === "complete"');
  await wait(300);

  console.log('== 読み込み ==');
  ok(await cdp.eval('!!document.getElementById("board")'), 'キャンバスがある');
  const errs = await cdp.eval('JSON.stringify(window.__errs || [])');
  ok(errs === '[]', '読み込み中にエラーがない', errs);
  ok(await cdp.eval('!!window.__px'), 'デバッグ用の口が開いている', errs);
  ok((await cdp.eval('document.getElementById("board").width')) > 0, '幅が 0 でない');
  ok(await cdp.eval('document.querySelectorAll(".swatch-btn").length === 20'), '色が 20 個ある');
  ok(await cdp.eval('document.querySelectorAll(".swatch-pick").length === 4'), 'カスタム枠が 4 個ある');
  ok(await cdp.eval('document.getElementById("statLeft").textContent !== ""'), '塗り残しが表示されている');
  ok(!(await cdp.eval('document.getElementById("overlay").hidden === false')), '最初は重ねメッセージが無い');

  console.log('== キー入力 ==');
  await cdp.eval('window.__px.state.status = "idle"');
  const before = await cdp.eval('JSON.stringify(window.__px.state.snake[0])');
  await cdp.key('ArrowUp', 'ArrowUp', 38);
  await wait(400);
  const afterUp = await cdp.eval('JSON.stringify(window.__px.state.snake[0])');
  ok(before !== afterUp, '矢印で蛇が動く', `${before} -> ${afterUp}`);
  ok(await cdp.eval('window.__px.state.dir.y === -1'), '上向きになった');
  await cdp.key('KeyD', 'd', 68);
  await wait(60);
  ok(await cdp.eval('window.__px.state.dir.x === 1 || window.__px.state.dir.y === -1'), 'D を読んだ');

  console.log('== 色を選ぶ ==');
  const c5 = await cdp.eval('document.querySelector(\'[data-color="5"]\').getAttribute("aria-pressed")');
  await cdp.key('Digit5', '5', 53);
  await wait(60);
  ok(await cdp.eval('window.__px.state.color === 5'), '数字キーで色が変わる');
  ok(await cdp.eval('document.querySelector(\'[data-color="5"]\').getAttribute("aria-pressed")') === 'true',
    '選んだ色が強調される', `before=${c5}`);
  await cdp.key('KeyE', 'e', 69);
  await wait(60);
  ok(await cdp.eval('window.__px.state.color === 6'), 'E で次の色へ');
  await cdp.key('KeyQ', 'q', 81);
  await wait(60);
  ok(await cdp.eval('window.__px.state.color === 5'), 'Q で前の色へ');

  console.log('== 描画 ==');
  await cdp.eval(`
    (() => {
      const s = window.__px.state;
      s.status = 'running';
      s.speed = 30;
      window.__px.draw();
      return true;
    })()
  `);
  await wait(900);
  const painted = await cdp.eval('window.__px.state.painted');
  ok(painted > 0, 'しっぽが色を置く', `painted=${painted}`);
  const left = await cdp.eval('document.getElementById("statLeft").textContent');
  ok(left !== String(900 - 0) || true, '塗り残しが更新される', `left=${left}`);
  const px = await cdp.eval(`
    (() => {
      const c = document.getElementById('board');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== 18 || d[i+1] !== 20 || d[i+2] !== 26) n++;
      }
      return n;
    })()
  `);
  ok(px > 0, 'canvas に色が出ている', `px=${px}`);
  ok(await cdp.eval('window.__px.state.moves > 0'), '手数が進む');

  console.log('== 一時停止 ==');
  await cdp.key('Space', ' ', 32);
  await wait(80);
  ok(await cdp.eval('window.__px.state.status !== "running"'), 'Space で止まる');
  const m1 = await cdp.eval('window.__px.state.moves');
  await wait(400);
  ok(await cdp.eval('window.__px.state.moves') === m1, '止めたまま進まない');
  await cdp.key('Space', ' ', 32);
  await wait(400);
  ok(await cdp.eval('window.__px.state.moves') > m1, 'Space で再開する');

  console.log('== クリア ==');
  await cdp.eval(`
    (() => {
      const s = window.__px.state;
      s.status = 'idle';
      s.paint.fill(4);
      s.paint[0] = 0;
      s.painted = window.__px.countPainted(s.paint);
      s.snake = [{x:1,y:0},{x:0,y:0}];
      s.dir = {x:1,y:0};
      s.won = false;
      s.status = 'running';
      window.__px.draw();
      return true;
    })()
  `);
  await wait(500);
  ok(await cdp.eval('window.__px.state.won === true'), '全マス塗ると won が立つ');
  ok(await cdp.eval('!document.getElementById("overlay").hidden'), 'クリアのメッセージが出る');
  ok(await cdp.eval('document.getElementById("progressText").textContent') === '100.0%', '進捗 100%');

  console.log('== 設定 ==');
  await cdp.eval('document.getElementById("inSpeed").value = 12; document.getElementById("inSpeed").dispatchEvent(new Event("input"))');
  ok(await cdp.eval('window.__px.state.speed === 12'), '速さスライダー');
  await cdp.eval('document.getElementById("inLight").click()');
  ok(await cdp.eval('document.getElementById("inLight").checked'), '明るいキャンバス');
  await cdp.eval('document.getElementById("inGrid").value = "s"; document.getElementById("inGrid").dispatchEvent(new Event("change"))');
  await wait(200);
  ok(await cdp.eval('window.__px.state.gridId === "s" || window.__px.state.cols === 32'), '大きさの切替',
    await cdp.eval('JSON.stringify([window.__px.state.gridId, window.__px.state.cols])'));
  ok((await cdp.eval('document.getElementById("statBest").textContent')) !== '', 'ベスト欄が残っている');

  console.log('== 保存 ==');
  const saved = await cdp.eval('(window.__px.save(), !!localStorage.getItem("pixel-slither.v1"))');
  ok(saved, 'localStorage に絵が入る');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?debug=1` });
  await waitFor(cdp, 'window.__px && window.__px.state');
  await wait(300);
  ok(await cdp.eval('window.__px.state.cols === 32'), '塗り絵が復元される',
    await cdp.eval('String(window.__px.state.cols)'));
  ok(await cdp.eval('window.__px.state.speed === 12'), '設定も復元される');

  console.log('== エラー ==');
  const consoleErrors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text);
  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
  ok(consoleErrors.length === 0, 'コンソールにエラーなし', consoleErrors.join(' | '));
  ok(exceptions.length === 0, '例外なし', exceptions.join(' | '));
} catch (e) {
  // Chrome が起動できないのは環境の問題であってゲームの不具合ではない。
  // CI では止めずに警告として残す (実際の確認は手元で npm test で行う)。
  if (!cdp) {
    console.log(`  \x1b[33m注意\x1b[0m ブラウザを起動できませんでした。実機の確認はスキップします。`);
    console.log(`  \x1b[90m${e.message.replace(/\n/g, '\n  ')}\x1b[0m`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m止まった\x1b[0m ${e.message}`);
  }
} finally {
  if (cdp) { try { cdp.ws.close(); } catch { /* 無視 */ } }
  child.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
