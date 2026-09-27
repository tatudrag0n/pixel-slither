// ============================================================================
// 同じブラウザの別タブで対戦する
//
// BroadcastChannel を使う。サーバーもアカウントも要らない。
// 「2 窓並べて遊ぶ」と「同期のテスト」が同時にできる。
//
// 1 つめのタブ = ホスト。部屋コードを作って待つ。
// 2 つめのタブ = ゲスト。コードを入れると繋がる。
// ============================================================================

import { makeChannel } from './channel.js';

const PREFIX = 'pixel-slither.room.';

/** ホストとして部屋を開く。 */
export function hostWithTabs(room) {
  const bc = new BroadcastChannel(PREFIX + room);
  return makeChannel({
    kind: 'tabs',
    role: 'host',
    ready: true,
    label: '別タブ',
    send: (msg) => bc.postMessage({ from: 'host', msg }),
    close: () => bc.close(),
    onMessage: (cb) => {
      bc.onmessage = (e) => {
        if (e.data && e.data.from === 'guest') cb(e.data.msg);
      };
    },
    onStatus: (cb) => cb('待機中。同じブラウザで 2 つめのタブを開いてください。'),
  });
}

/** ゲストとして既存の部屋に入る。 */
export function joinWithTabs(room) {
  const bc = new BroadcastChannel(PREFIX + room);
  const box = makeChannel({
    kind: 'tabs',
    role: 'guest',
    ready: true,
    label: '別タブ',
    send: (msg) => bc.postMessage({ from: 'guest', msg }),
    close: () => bc.close(),
    onMessage: (cb) => {
      bc.onmessage = (e) => {
        if (e.data && e.data.from === 'host') cb(e.data.msg);
      };
    },
  });
  bc.postMessage({ from: 'guest', msg: { t: 'hello' } });
  return box;
}

/** このブラウザが別タブ方式を使えるか。 */
export function canUseTabs() {
  return typeof BroadcastChannel === 'function';
}
