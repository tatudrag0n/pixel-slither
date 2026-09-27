// ============================================================================
// 通信の土台
//
// 対戦の通信は「送信 (send)」「受信 (onMessage)」「閉じる」だけあれば足りる。
// AI / BroadcastChannel / PeerJS のどれでも同じ形にして、
// 上の層は方式を意識しないようにする。
//
// 役割:
//   host  = 実際に snake を進める人。状態を毎 tick 送る。
//   guest = 入力を送るだけの人。相手の入力を host に預けて状態を受け取る。
// ============================================================================

/** 通信の受け皿。 */
export function makeChannel(opts = {}) {
  return {
    kind: opts.kind || 'none',
    role: opts.role || 'guest',
    ready: opts.ready || false,
    send: opts.send || (() => {}),
    close: opts.close || (() => {}),
    onMessage: (cb) => { opts.onMessage(cb); },
    onStatus: (cb) => { if (opts.onStatus) opts.onStatus(cb); },
    label: opts.label || '',
  };
}

/** 部屋コードを作る。読み错的にもう一度打てる 6 文字。 */
export function makeRoomCode(n = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

/** 部屋コードの体裁を整える。大文字にして枝違いの文字を除く。 */
export function normalizeRoomCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

/** 部屋コードとして使える形か。 */
export function isRoomCode(text) {
  return /^[A-Z0-9]{4,8}$/.test(normalizeRoomCode(text));
}
