/**
 * WsHub — WebSocket 枢纽（Durable Object）
 *
 * 为什么需要 DO：Cloudflare Worker 的进程内内存（Map）是每个 isolate 一份，
 * HTTP 请求与 WebSocket 连接常落在不同 isolate，广播必然丢失（已在线上 e2e 实证）。
 * DO 是单实例：所有同用户的 WebSocket 连接、广播、在线状态都集中在这里，保证可靠投递。
 *
 * 职责：
 * 1. /ws 升级：校验 token → 建立 WebSocket → 注册连接 → 维护在线状态
 * 2. /broadcast：向指定用户的全部在线连接推送事件
 * 3. /presence：兼容旧客户端心跳（仅内存）
 * 4. /online：查询当前在线用户
 */

const PRESENCE_TTL_MS = 90 * 1000;

export class WsHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.conns = new Map();   // userId -> Set<serverSocket>
    this.presence = new Map(); // userId -> lastSeen
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- WebSocket 接入 ----
    if (request.headers.get('Upgrade') === 'websocket') {
      try {
        const token = url.searchParams.get('token') || '';
        const session = await this.env.DB.prepare(
          'SELECT employee_id FROM sessions WHERE token = ? AND expires_at > ?'
        ).bind(token, Date.now()).first();
        if (!session) {
          return new Response('Unauthorized', { status: 401 });
        }
        const userId = session.employee_id;

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.accept();
        this.touchPresence(userId);

        if (!this.conns.has(userId)) this.conns.set(userId, new Set());
        this.conns.get(userId).add(server);

        server.addEventListener('close', () => {
          this.touchPresence(userId); // 断线后 90 秒内仍显示在线
          const set = this.conns.get(userId);
          if (set) {
            set.delete(server);
            if (set.size === 0) this.conns.delete(userId);
          }
        });

        server.addEventListener('error', () => {
          const set = this.conns.get(userId);
          if (set) set.delete(server);
        });

        return new Response(null, { status: 101, webSocket: client });
      } catch (e) {
        console.error('WsHub /ws error:', e && e.stack ? e.stack : String(e));
        return new Response('WsHub error: ' + String(e && e.message || e), { status: 500 });
      }
    }

    // ---- 广播（由 Worker 的 HTTP 处理流程调用）----
    if (path === '/broadcast' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { /* 忽略非法 JSON */ }
      const { userId, event } = body;
      const set = this.conns.get(userId);
      if (set) {
        const msg = JSON.stringify(event);
        for (const ws of set) {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      }
      return json({ ok: true });
    }

    // ---- 在线心跳（兼容旧客户端，仅内存）----
    if (path === '/presence' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { /* 忽略非法 JSON */ }
      if (body.employeeId) this.touchPresence(body.employeeId);
      return json({ ok: true, employeeId: body.employeeId || null });
    }

    // ---- 在线状态查询 ----
    if (path === '/online' && request.method === 'GET') {
      const now = Date.now();
      const online = {};
      for (const [uid, ts] of this.presence) {
        if (now - ts < PRESENCE_TTL_MS) online[uid] = true;
      }
      return json({ online });
    }

    return new Response('Not Found', { status: 404 });
  }

  touchPresence(userId) {
    this.presence.set(userId, Date.now());
    // 防止 map 无限增长（仅清理超时条目）
    if (this.presence.size > 500) {
      const now = Date.now();
      for (const [uid, ts] of this.presence) {
        if (now - ts >= PRESENCE_TTL_MS) this.presence.delete(uid);
      }
    }
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
