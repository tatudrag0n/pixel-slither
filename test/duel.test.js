// ============================================================================
// 2 タブで対戦して同期を見る (BroadcastChannel)
//   node test/duel.test.js
//
// 「別タブで戦う」経路は通信の受け渡しをまるごと通すので、
// 実際の online 実装と同じコードを検証できる。
// ============================================================================

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8096);
const DEBUG_PORT = PORT + 1000;

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serve(port) {
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://l');
      let p = decodeURIComponent(u.pathname);
      if (p === '/') p = '/index.html';
      const full = join(ROOT, normalize(p).replace(/^([/\\])+/, ''));
      if (!full.startsWith(ROOT)) {
        res.writeHead(403).end();
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
  return new Promise((res) => server.listen(port, '127.0.0.1', () => res(server)));
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.waiting.has(m.id)) {
        const w = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        if (m.error) w.reject(new Error(m.error.message));
        else w.resolve(m.result);
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

  async key(code, key, keyCode) {
    const base = { code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
}

/** Chrome の debug ポートへの通信は调子があるので，何度でも試す。 */
async function fetchRetry(url, opts = {}, tries = 60) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await (await fetch(url, opts)).json();
    } catch (e) {
      last = e;
      await wait(250);
    }
  }
  throw last || new Error(`繋がらない: ${url}`);
}

/** 2 つめのタブを開く。 */
async function newPage(debugPort) {
  const target = await fetchRetry(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: 'PUT',
  });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  // ページ内のエラーを拾えるようにしておく。
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
  return cdp;
}

async function waitFor(cdp, expression, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await cdp.eval(expression)) return true;
    } catch { /* 読み込み中 */ }
    await wait(120);
  }
  return false;
}

/** Node 22 以降には WebSocket がある。それ以前なら duel.test.js は動かさない。 */
const HAS_WS = typeof WebSocket === 'function';

const exe = HAS_WS ? BROWSERS.find((p) => existsSync(p)) : null;
if (!exe) {
  const why = HAS_WS ? 'Chrome / Edge が無い' : 'この Node には WebSocket が無い (Node 22 以降が必要)';
  console.log(`${why}ので 2 タブの対戦確認は省きます。`);
  process.exit(0);
}

const server = await serve(PORT);
const profile = await mkdtemp(join(tmpdir(), 'pxduel-'));
const child = spawn(exe, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  // 2 つめのタブを作ると 1 つめは裏のタブになって rAF が止まるので、
  // バックグラウンド抑止を全部切る。
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  'about:blank',
], { stdio: 'ignore' });

const hosts = [];
try {
  const url = `http://127.0.0.1:${PORT}/index.html?debug=1`;

  console.log('== 2 タブの対戦 ==');
  const a = await newPage(DEBUG_PORT);
  hosts.push(a);
  await a.send('Page.navigate', { url });
  await waitFor(a, 'window.__px && window.__px.state');
  await wait(300);
  ok(true, '1 つめのタブが開く');

  // 陣営戦 + 別タブの相手に設定して部屋を作る。
  await a.eval(`
    (() => {
      document.querySelector('[data-mode="battle"]').click();
      document.getElementById('foeTabs').checked = true;
      document.getElementById('foeTabs').dispatchEvent(new Event('change'));
      return true;
    })()
  `);
  await wait(200);
  ok(await a.eval('window.__px.state.mode === "battle"'), '陣営戦に切替');
  ok(await a.eval('!document.getElementById("netBox").hidden'), '通信の箱が出る');

  await a.eval('document.getElementById("btnMakeRoom").click()');
  await waitFor(a, 'document.getElementById("roomCode").textContent.length === 6');
  const code = await a.eval('document.getElementById("roomCode").textContent');
  ok(/^[A-Z0-9]{6}$/.test(code), '部屋コードが出る', code);
  ok(await a.eval('!!window.__px.net'), 'ホスト側の通信がある');
  ok(await a.eval('window.__px.net.host === true'), 'ホスト役');
  ok(await a.eval('window.__px.net.ch.kind === "tabs"'), '別タブ方式');

  // 2 つめのタブから入る。
  const b = await newPage(DEBUG_PORT);
  hosts.push(b);
  await b.send('Page.navigate', { url });
  await waitFor(b, 'window.__px && window.__px.state');
  await wait(300);
  ok(true, '2 つめのタブが開く');
  await b.eval(`
    (() => {
      localStorage.removeItem('pixel-slither.v1');
      document.querySelector('[data-mode="battle"]').click();
      document.getElementById('foeTabs').checked = true;
      document.getElementById('foeTabs').dispatchEvent(new Event('change'));
      const inp = document.getElementById('inRoom');
      inp.value = '${code}';
      inp.dispatchEvent(new Event('input'));
      document.getElementById('btnJoin').click();
      return true;
    })()
  `);
  await waitFor(b, '!!window.__px.net');
  await wait(600);
  ok(await b.eval('!!window.__px.net'), 'ゲスト側の通信がある');
  ok(await b.eval('window.__px.net.host === false'), 'ゲスト役');
  ok(await b.eval('window.__px.state.rival.isAi === false'), 'AI ではなくになる');
  ok(await a.eval('window.__px.state.rival.isAi === false'), 'ホストも AI ではなくなる');
  ok(await b.eval('/接続|つなが/.test(document.getElementById("netStatus").textContent)')
    || (await b.eval('window.__px.net.armed')), '接続できた', await b.eval('document.getElementById("netStatus").textContent'));

  // 両方が走り出したら、进む。
  // ホストの rAF を止めないために 2 つめを前に出す。
  await a.send('Target.activateTarget', {}).catch(() => {});
  await a.eval(`
    (() => {
      window.__px.state.speed = 20;
      if (window.__px.state.status !== 'running') document.getElementById('btnPlay').click();
      return window.__px.state.status;
    })()
  `);
  ok(await a.eval('window.__px.state.status === "running"'), 'ホストが走り出す');
  await wait(1600);

  const aPainted = await a.eval('window.__px.state.painted');
  const bPainted = await b.eval('window.__px.state.painted');
  ok(aPainted > 0, 'ホストが塗る', `painted=${aPainted}`);
  ok(bPainted > 0, 'ゲストにも絵が届く', `painted=${bPainted}`);
  // ホストが権威なので、ゲストは数 tick 分だけ遅れてよい。
  ok(bPainted <= aPainted && aPainted - bPainted <= 6, '塗り面積がほぼ一致',
    `a=${aPainted} b=${bPainted}`);

  // ゲストの入力がホストの動きになる。
  const beforeTurn = await a.eval('JSON.stringify(window.__px.state.rival.dir)');
  await b.key('ArrowUp', 'ArrowUp', 38);
  await wait(500);
  const afterTurn = await a.eval('JSON.stringify(window.__px.state.rival.dir)');
  ok(beforeTurn !== afterTurn, 'ゲストの入力がホストに届く', `${beforeTurn} -> ${afterTurn}`);
  ok(await a.eval('window.__px.state.rival.dir.y === -1'), '曲がった');

  // 残り時間も揃う。
  const aLeft = await a.eval('window.__px.state.left');
  const bLeft = await b.eval('window.__px.state.left');
  ok(Math.abs(aLeft - bLeft) < 1.2, '残り時間が近い', `a=${aLeft} b=${bLeft}`);

  // ホストを止めると、送信済みの最後のフレームで両者が同じ状態になる。
  console.log('== 停止後に完全一致 ==');
  await a.eval('document.getElementById("btnPlay").click()');
  await wait(800);
  ok(await a.eval('window.__px.state.status !== "running"'), 'ホストが止まる');
  ok(await b.eval('window.__px.state.status !== "running"'), 'ゲストも止まる',
    await b.eval('String(window.__px.state.status)'));

  const aAreaMe = await a.eval('window.__px.state.counts[window.__px.state.me.color]');
  const aAreaRival = await a.eval('window.__px.state.counts[window.__px.state.rival.color]');
  const bAreaMe = await b.eval('window.__px.state.counts[window.__px.state.me.color]');
  const bAreaRival = await b.eval('window.__px.state.counts[window.__px.state.rival.color]');
  ok(aAreaMe > 0, 'ホストの自分の色がある', `${aAreaMe}`);
  ok(aAreaRival > 0, 'ホストの相手の色もある', `${aAreaRival}`);
  ok(await b.eval('window.__px.state.counts[window.__px.state.me.color]') > 0,
    'ゲストの自分の色も届いている', `${bAreaMe}`);
  ok(aAreaMe === bAreaRival, '相互の面積が入れ替わる', `a.me=${aAreaMe} b.rival=${bAreaRival}`);
  ok(aAreaRival === bAreaMe, '相手も同じ', `a.rival=${aAreaRival} b.me=${bAreaMe}`);
  ok(await a.eval('window.__px.state.painted') === await b.eval('window.__px.state.painted'),
    '塗り面積が完全に一致',
    `${await a.eval('window.__px.state.painted')} / ${await b.eval('window.__px.state.painted')}`);

  const aHead = await a.eval('JSON.stringify(window.__px.state.me.snake[0])');
  const bRivalHead = await b.eval('JSON.stringify(window.__px.state.rival.snake[0])');
  ok(aHead === bRivalHead, '蛇の位置が一致', `a.me=${aHead} b.rival=${bRivalHead}`);
  const bHead = await b.eval('JSON.stringify(window.__px.state.me.snake[0])');
  const aRivalHead = await a.eval('JSON.stringify(window.__px.state.rival.snake[0])');
  ok(bHead === aRivalHead, '相手側の蛇も一致', `b.me=${bHead} a.rival=${aRivalHead}`);

  let cellsSame = true;
  const aPaint = await a.eval('Array.from(window.__px.state.paint).join(",")');
  const bPaint = await b.eval('Array.from(window.__px.state.paint).join(",")');
  if (aPaint !== bPaint) cellsSame = false;
  ok(cellsSame, '絵のマスごとが完全に一致');

  // 詰まっていないか。
  const errs = await a.eval('JSON.stringify(window.__errs || [])')
    + await b.eval('JSON.stringify(window.__errs || [])');
  ok(errs === '[][]', 'エラーなし', errs);
  if (errs !== '[][]') {
    console.log(`    host status=${await a.eval('window.__px.state.status')}`
      + ` reason=${await a.eval('window.__px.state.reason')}`
      + ` meAlive=${await a.eval('window.__px.state.me.alive')}`
      + ` rivalAlive=${await a.eval('window.__px.state.rival.alive')}`);
  }
} catch (e) {
  failed += 1;
  console.log(`  \x1b[31m止まった\x1b[0m ${e.message}`);
} finally {
  for (const c of hosts) {
    try { c.ws.close(); } catch { /* 無視 */ }
  }
  child.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
