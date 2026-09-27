// ============================================================================
// 共有盤の Worker
//
// 入口はここ。すべての通信を 1 つの Durable Object の中に集める。
// DO は 1 つだけなので、全員が同じ 1 枚の盤を見る。
// Cloudflare Workers の無料枠で動く (一日 10 万リクエストまで)。
// ============================================================================
// DO は 1 つだけなので、全員が同じ 1 枚の盤を見る。
import { SharedBoard } from './board-do.js';

/** Durable Object クラスはエントリから出す必要がある。 */
export { SharedBoard };

/** DO の実体。 */
const BOARD = new SharedBoard();

export default {
  /**
   * @param {Request} req
    // 盤の要約。ブラウザから直接叩ける。
   * @param {object} ctx
   */
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 生きてるかの確認。
    if (url.pathname === '/health') {
      return json({ ok: true, at: Date.now() });
    }

    // 盤の要約。ブラウザから直接叩ける。
    if (url.pathname === '/stats') {
      const id = env.BOARD.idFromName('main');
      const stub = env.BOARD.get(id);
      return stub.fetch('https://do/stats');
    }

    // それ以外は全部 DO へ素通し。
    const id = env.BOARD.idFromName('main');
    const stub = env.BOARD.get(id);
    return stub.fetch(req);
  },
};

/** JSON を返す。 */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}
