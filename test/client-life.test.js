// SharedGame (クライアント側) の接続の生き死にを、fake WebSocket で回す。
//   node test/client-life.test.js
//
// 実サーバーにはつながらない。ネットワークなしで、再接続と「出る」の挙動を見る。
import { SharedGame } from '../js/net/shared-game.js';

/* ---------------------------------------------------------------- 道具 */

let passed = 0;
let failed = 0;
const eq = (a, b, name, info = '') => {
  if (a === b) { passed++; console.log(`  \x1b[32mOK\x1b[0m   ${name}`); return; }
  failed++;
  console.log(`  \x1b[31m失敗\x1b[0m ${name}${info ? ` -> ${info}` : ''} (期待 ${b}, 実際 ${a})`);
};
const ok = (v, name, info = '') => eq(!!v, true, name, info);
const section = (t) => console.log(`\n== ${t} ==`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 張られた本数を数え、サーバーが事件を起こせる偽の WebSocket。 */
function installFakeWS() {
  const made = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.listeners = { message: [], close: [], error: [], open: [] };
      made.push(this);
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.fire('close'); }
    fire(type, ev = {}) { for (const fn of this.listeners[type] || []) fn({ data: null, ...ev }); }
    open() { this.readyState = 1; this.fire('open'); }
  }
  globalThis.WebSocket = FakeWS;
  return made;
}

/** 描画はしないが、コンストラクタが getContext を呼ぶので空の器を用意する。 */
function fakeCanvas() {
  const noop = () => {};
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ({
      canvas: null,
      clearRect: noop,
      fillRect: noop,
      drawImage: noop,
      putImageData: noop,
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      imageSmoothingEnabled: true,
    }),
    addEventListener: noop,
  };
}

function makeGame(url = 'wss://example.invalid') {
  return new SharedGame({ canvas: fakeCanvas(), url, name: 'test', say: () => {} });
}

/** 再接続のタイマーを潰して、次の回をすぐ試せるようにする。 */
function skipRetry(g) {
  if (g.retryTimer) { clearTimeout(g.retryTimer); g.retryTimer = 0; }
}

/* ---------------------------------------------------------------- 試験 */

section('接続は 1 本だけ');
{
  const made = installFakeWS();
  const g = makeGame();
  eq(made.length, 0, '作っただけでは繋がらない');
  g.connect();
  eq(made.length, 1, 'connect() で 1 本張る', String(made.length));
  g.connect();
  eq(made.length, 1, '二重に張らない', String(made.length));
  g.close();
}

section('サーバーが切ったら自動で繋ぎ直す');
{
  const made = installFakeWS();
  const g = makeGame();
  g.connect();
  made[0].open();
  ok(g.connected, '開いたら connected が true', String(g.connected));
  g.send({ t: 'j', n: 'x' });
  eq(JSON.parse(made[0].sent[0]).t, 'j', '参加メッセージを送った');
  made[0].fire('close');
  ok(!g.connected, '切れたら connected が false');
  eq(g.status, 'offline', 'status が offline になる', g.status);
  await wait(1400);
  eq(made.length, 2, '1 秒後に張り直した', String(made.length));
  g.close();
}

section('「出る」を押したら繋ぎ直さない');
{
  const made = installFakeWS();
  const g = makeGame();
  g.connect();
  made[0].open();
  g.close();
  ok(!g.connected, '切断できた', String(g.connected));
  await wait(1600);
  eq(made.length, 1, '張り直さない', String(made.length));
  ok(!g.connected, 'connected は false のまま', String(g.connected));
  eq(g.quit, true, 'quit が立っている', String(g.quit));
}

section('「出る」のあとに connect() を呼んでも戻らない');
{
  const made = installFakeWS();
  const g = makeGame();
  g.connect();
  made[0].open();
  g.close();
  g.connect();
  eq(made.length, 1, '何もしない', String(made.length));
  g.quit = false;
  g.connect();
  eq(made.length, 2, 'quit を戻せば再び張れる', String(made.length));
  g.close();
}

section('5 回続けて切れたら「接続できません」');
{
  const made = installFakeWS();
  const said = [];
  const g = new SharedGame({
    canvas: fakeCanvas(),
    url: 'wss://example.invalid',
    name: 't',
    say: (s) => said.push(s),
  });
  for (let i = 0; i < 8 && g.status !== 'failed'; i++) {
    g.connect();
    const sock = made[made.length - 1];
    // 開かずに切る。開くと retry が 0 に戻るので、失敗の回数が数えられない。
    sock.fire('close');
    skipRetry(g);
  }
  eq(g.status, 'failed', '最終的に failed になる', g.status);
  ok(said.join(' ').includes('接続できません'), 'メッセージが出た', said.join(' | '));
  ok(made.length <= 6, '6 回以上張り直さない', String(made.length));
  g.close();
}

console.log(`\n${failed ? '\x1b[31m' : '\x1b[32m'}${passed} 件成功 / ${failed} 件失敗\x1b[0m`);
process.exit(failed ? 1 : 0);
