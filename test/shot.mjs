// ============================================================================
// 画面の写真を残す
//   node test/shot.mjs
//
// 揃った絵を作って撮る。README のスクリーンショット用。
// ============================================================================

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8097);
const OUT = process.argv[2] || join(ROOT, 'docs', 'screenshot.png');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) {
  console.log('ブラウザが無いので撮りません。');
  process.exit(0);
}

const server = await serve(PORT);
const profile = await mkdtemp(join(tmpdir(), 'pxshot-'));
const child = spawn(exe, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--window-size=1280,860',
  'about:blank',
], { stdio: 'ignore' });

try {
  let port = 0;
  for (let i = 0; i < 80 && !port; i++) {
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
    } catch { await wait(125); }
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) w.rej(new Error(m.error.message));
      else w.res(m.result);
    }
  });
  const send = (method, params = {}) => {
    const i = ++id;
    return new Promise((res, rej) => {
      waiting.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => rej(new Error(method)), 20000);
    });
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '失敗');
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 860, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?debug=1` });
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!!(window.__px && window.__px.state)')) break;
    await wait(100);
  }
  await wait(500);

  // 見栄えの絵を置いてから撮る。
  await evaluate(`
    (() => {
      const px = window.__px;
      const s = px.state;
      s.cols = 44; s.rows = 26;
      s.paint = new Uint8Array(44 * 26);
      s.gridId = 'm';
      const C = 44;
      const put = (x, y, c) => { s.paint[y * C + x] = c; };
      const disc = (cx, cy, r, c) => {
        for (let y = 0; y < 26; y++) for (let x = 0; x < C; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, c);
        }
      };
      // 背景
      for (let i = 0; i < s.paint.length; i++) s.paint[i] = 8;
      // 星
      disc(9, 7, 4, 1);
      disc(35, 5, 2, 1);
      disc(20, 20, 2, 1);
      // 月
      for (let y = 0; y < 26; y++) for (let x = 0; x < C; x++) {
        const d = (x - 34) ** 2 + (y - 9) ** 2;
        if (d <= 36) put(x, y, 5);
        if (d <= 26 && (x - 31) ** 2 + (y - 7) ** 2 > 26) put(x, y, 8);
      }
      // 山
      for (let x = 0; x < C; x++) {
        const h = Math.round(16 + Math.sin(x / 4) * 3 + (x > 22 ? 2 : 0));
        for (let y = h; y < 26; y++) put(x, y, 16);
        if (h % 3 === 0) put(x, h, 1);
      }
      // 木
      for (let y = 12; y < 22; y++) put(8, y, 13);
      for (let y = 9; y < 14; y++) for (let x = 5; x < 12; x++) {
        if ((x - 8) ** 2 + (y - 11) ** 2 <= 9) put(x, y, 7);
      }
      px.recount(s);
      s.me.snake = [{x: 20, y: 6}, {x: 19, y: 6}, {x: 18, y: 6}, {x: 18, y: 5}, {x: 18, y: 4}];
      s.me.dir = { x: 1, y: 0 };
      s.me.color = 4;
      s.status = 'idle';
      px.draw();
      document.getElementById('btnPlay').textContent = 'スタート  Space';
      return true;
    })()
  `);
  await wait(500);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`撮った: ${OUT}`);
  ws.close();
} catch (e) {
  console.log(`撮れませんでした: ${e.message}`);
} finally {
  child.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
