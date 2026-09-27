// ============================================================================
// インターネットで対戦する
//
// PeerJS の公開シグナリングを使う。サーバーを自分で用意しないので、
// アカウントも費用もいらない。部屋コードは Peer の ID になる。
//
// ホスト側は PIX- を部屋コードの先頭に付けて Peer ID にする。
// ゲストは PIX-xxxxxx という ID へ接続する。
//
// CDN を読めない環境ではここは失敗する。その場合は別タブ方式を使う。
// ============================================================================

import { makeChannel } from './channel.js';

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'PIX-';
const OPEN_TIMEOUT = 20000;

let loading = null;

/** PeerJS を取ってくる。2 回目以降は読まない。 */
export function loadPeerJS() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (window.Peer) {
      resolve(window.Peer);
      return;
    }
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.async = true;
    s.onload = () => (window.Peer
      ? resolve(window.Peer)
      : reject(new Error('PeerJS が読み込めませんでした')));
    s.onerror = () => reject(new Error('PeerJS を取得できませんでした。ネット接続を確認してください'));
    document.head.append(s);
  });
  return loading;
}

/** 部屋コードを Peer の ID にする。 */
export function peerIdFromRoom(room) {
  return PREFIX + String(room).toUpperCase();
}

/** ホストとして部屋を作る。 */
export async function hostWithPeer(room) {
  const Peer = await loadPeerJS();
  const peer = new Peer(peerIdFromRoom(room), { debug: 1 });

  return new Promise((resolve, reject) => {
    let conn = null;
    let settled = false;
    const box = makeChannel({
      kind: 'peer',
      role: 'host',
      ready: true,
      label: 'ネット',
      send: (msg) => { if (conn && conn.open) conn.send({ msg }); },
      close: () => {
        try { if (conn) conn.close(); } catch { /* 無視 */ }
        peer.destroy();
      },
      onMessage: (cb) => { box._inbox = cb; },
      onStatus: (cb) => { box._say = cb; },
    });
    box.peerGone = () => { if (box._say) box._say('相手が切断しました'); };

    const bail = (msg) => {
      if (settled) return;
      settled = true;
      try { peer.destroy(); } catch { /* 無視 */ }
      reject(new Error(msg));
    };
    setTimeout(() => bail('公開シグナリングに入れませんでした'), OPEN_TIMEOUT);

    peer.on('error', (err) => bail(`接続できません: ${err.type || err.message}`));

    peer.on('open', () => {
      if (settled) return;
      settled = true;
      box._say('部屋を作りました。下のコードを相手に渡してください');
      resolve(box);
    });

    peer.on('connection', (c) => {
      conn = c;
      c.on('data', (d) => { if (d && d.msg && box._inbox) box._inbox(d.msg); });
      c.on('close', () => box.peerGone());
      if (box._say) box._say('参加がありました');
    });
  });
}

/** ゲストとして部屋に入る。 */
export async function joinWithPeer(room) {
  const Peer = await loadPeerJS();
  const peer = new Peer();

  return new Promise((resolve, reject) => {
    let settled = false;
    const box = makeChannel({
      kind: 'peer',
      role: 'guest',
      ready: true,
      label: 'ネット',
      send: (msg) => { if (conn.open) conn.send({ msg }); },
      close: () => {
        try { conn.close(); } catch { /* 無視 */ }
        peer.destroy();
      },
      onMessage: (cb) => { box._inbox = cb; },
      onStatus: (cb) => { box._say = cb; },
    });
    box.peerGone = () => { if (box._say) box._say('ホストが切断しました'); };

    const conn = peer.connect(peerIdFromRoom(room), {
      reliable: true,
      serialization: 'json',
    });

    const bail = (msg) => {
      if (settled) return;
      settled = true;
      try { conn.close(); } catch { /* 無視 */ }
      try { peer.destroy(); } catch { /* 無視 */ }
      reject(new Error(msg));
    };
    setTimeout(() => bail('その部屋は見つかりませんでした。コードを確かめてください'), OPEN_TIMEOUT);

    conn.on('open', () => {
      if (settled) return;
      settled = true;
      if (box._say) box._say('繋がりました');
      resolve(box);
    });
    conn.on('data', (d) => { if (d && d.msg && box._inbox) box._inbox(d.msg); });
    conn.on('error', () => { /* タイムアウトで処理する */ });
    peer.on('error', (err) => bail(`接続できません: ${err.type || err.message}`));
  });
}
