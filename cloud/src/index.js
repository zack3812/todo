/**
 * NexusDesk Cloud Worker
 *
 * 功能：
 * 1. 用户认证（工号登录、改密、session）
 * 2. 权限管理（admin/user）
 * 3. 待办 D1 存储 + WebSocket 实时推送
 * 4. 管理后台静态页面
 * 5. 钉钉事件回调（预留）
 *
 * 存储：核心数据（users / sessions / todos）存 Cloudflare D1；在线状态走进程内内存。
 */

import { verifyDingtalkCallback } from './dingtalk.js';
import { WsHub } from './ws-hub.js';

// WsHub（Durable Object）必须从入口模块导出，wrangler 才能找到并绑定
export { WsHub };

// ========== 工具函数 ==========

async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

// D1 行 → 领域对象（列名 snake_case → camelCase）
function normalizeUser(row) {
  if (!row) return null;
  return {
    employeeId: row.employee_id,
    name: row.name,
    role: row.role,
    passwordHash: row.password_hash,
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at,
  };
}

function normalizeTodo(row) {
  if (!row) return null;
  return {
    todoId: row.todo_id,
    employeeId: row.employee_id,
    text: row.text,
    project: row.project,
    priority: row.priority,
    done: !!row.done,
    dueTime: row.due_time,
    status: row.status,
    progressText: row.progress_text,
    nextWeek: row.next_week,
    clientUpdatedAt: row.client_updated_at,
    updatedAt: row.updated_at,
  };
}

async function getSession(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT employee_id, expires_at FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  const userRow = await env.DB.prepare(
    'SELECT * FROM users WHERE employee_id = ?'
  ).bind(row.employee_id).first();
  return normalizeUser(userRow);
}

async function requireAuth(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  const user = await getSession(env, token);
  return user;
}

// ========== WebSocket 连接管理 ==========

/** @type {Map<string, Set<WebSocket>>} userId -> connections */
// WebSocket 连接与广播统一由 WsHub（Durable Object）承载：
// Worker isolate 内存不共享，进程内 Map 无法保证跨请求广播送达（线上 e2e 已实证）。
// 必须通过 idFromName 取固定实例 stub 再 fetch：同一实例才能同时持有连接与广播。
const HUB_NAME = 'default-hub';
function hubStub(env) {
  const id = env.WS_HUB.idFromName(HUB_NAME);
  return env.WS_HUB.get(id);
}

async function broadcastToUser(env, userId, event) {
  try {
    const stub = hubStub(env);
    await stub.fetch(new Request('https://hub/broadcast', {
      method: 'POST',
      body: JSON.stringify({ userId, event }),
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (e) { /* 广播失败不阻断主流程 */ }
}

async function fetchOnlineMap(env) {
  try {
    const stub = hubStub(env);
    const res = await stub.fetch(new Request('https://hub/online'));
    if (res.ok) {
      const data = await res.json();
      return data.online || {};
    }
  } catch (e) { /* 枢纽不可用时按离线处理 */ }
  return {};
}

// ========== HTTP 路由 ==========

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // ---- 静态前端 ----
    if (path === '/' || path === '/index.html' || path === '/login') {
      return serveAdminPage();
    }
    if (path === '/app.css') return serveCss();
    if (path === '/app.js') return serveAppJs();

    // ---- 健康检查 ----
    if (path === '/health') {
      return json({ status: 'ok', service: 'nexusdesk-cloud' });
    }

    // ---- 认证 API ----
    if (path === '/api/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    if (path === '/api/change-password' && request.method === 'POST') {
      return handleChangePassword(request, env);
    }
    if (path === '/api/me' && request.method === 'GET') {
      return handleMe(request, env);
    }

    // ---- 管理 API ----
    if (path === '/api/admin/users' && request.method === 'GET') {
      return handleListUsers(request, env);
    }
    if (path === '/api/admin/users' && request.method === 'POST') {
      return handleCreateUser(request, env);
    }
    if (path === '/api/admin/todos' && request.method === 'GET') {
      return handleAllTodos(request, env);
    }

    // ---- 桌面端待办同步 ----
    if (path === '/api/todo/sync' && request.method === 'POST') {
      return handleTodoSync(request, env);
    }

    // ---- 在线心跳 ----
    if (path === '/api/presence' && request.method === 'POST') {
      return handlePresence(request, env);
    }

    // ---- 我的待办 ----
    if (path === '/api/my/todos' && request.method === 'GET') {
      return handleMyTodos(request, env);
    }

    // ---- WebSocket ----
    if (path === '/ws') {
      return handleWebSocket(request, env);
    }

    // ---- 钉钉回调 ----
    if (path === '/webhook/dingtalk') {
      return handleDingtalkCallback(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ========== 认证处理 ==========

async function handleLogin(request, env) {
  const body = await request.json();
  const { employeeId, password } = body;
  if (!employeeId || !password) {
    return json({ error: '工号和密码不能为空' }, 400);
  }

  const user = normalizeUser(await env.DB.prepare(
    'SELECT * FROM users WHERE employee_id = ?'
  ).bind(String(employeeId)).first());

  // 工号必须由管理员预先创建，避免攻击者抢注任意工号。
  if (!user) {
    return json({ error: '工号或密码错误' }, 401);
  }

  // 验证密码（默认密码=工号，或用户改过的密码）
  const inputHash = await sha256(employeeId + ':' + password);
  const defaultPasswordMatches = password === employeeId;

  if (user.passwordHash !== inputHash && !(user.mustChangePassword && defaultPasswordMatches)) {
    return json({ error: '工号或密码错误' }, 401);
  }

  // 创建 session（7 天）
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token, employee_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.employeeId, now, now + 60 * 60 * 24 * 7 * 1000).run();
  // 顺带清理过期会话，避免表无限膨胀
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();

  return json({
    token,
    user: {
      employeeId: user.employeeId,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
}

async function handleChangePassword(request, env) {
  const user = await requireAuth(env, request);
  if (!user) return json({ error: '未登录' }, 401);

  const body = await request.json();
  const { oldPassword, newPassword } = body;
  if (!newPassword || newPassword.length < 4) {
    return json({ error: '新密码至少4位' }, 400);
  }

  // 验证旧密码
  const oldHash = await sha256(user.employeeId + ':' + oldPassword);
  const defaultPasswordMatches = oldPassword === user.employeeId;
  if (user.passwordHash !== oldHash && !(user.mustChangePassword && defaultPasswordMatches)) {
    return json({ error: '原密码错误' }, 401);
  }

  // 更新密码
  const newHash = await sha256(user.employeeId + ':' + newPassword);
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE employee_id = ?'
  ).bind(newHash, user.employeeId).run();

  return json({ ok: true });
}

async function handleMe(request, env) {
  const user = await requireAuth(env, request);
  if (!user) return json({ error: '未登录' }, 401);
  return json({
    employeeId: user.employeeId,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
}

// ========== 在线状态（进程内内存，替代高频 KV 写入） ==========
// 说明：单实例 Worker 下内存 Map 足够（10 用户量级）；若未来多实例部署，
// 请改用 Durable Objects 或让心跳落库，勿退回 KV 高频写。
// 在线状态由 WsHub（Durable Object）统一维护

// 在线心跳：仅更新 DO 内存，零 DB 写入。桌面端新版已不再调用，保留以兼容旧客户端。
async function handlePresence(request, env) {
  const user = await requireAuth(env, request);
  if (!user) return json({ error: '未登录' }, 401);
  const stub = hubStub(env);
  await stub.fetch(new Request('https://hub/presence', {
    method: 'POST',
    body: JSON.stringify({ employeeId: user.employeeId }),
    headers: { 'Content-Type': 'application/json' },
  }));
  return json({ ok: true, employeeId: user.employeeId });
}

// ========== 管理 API ==========

async function handleListUsers(request, env) {
  const user = await requireAuth(env, request);
  if (!user || user.role !== 'admin') return json({ error: '需要管理员权限' }, 403);

  const { results } = await env.DB.prepare(
    'SELECT * FROM users ORDER BY created_at ASC'
  ).all();
  const onlineMap = await fetchOnlineMap(env);
  const users = (results || []).map((row) => {
    const u = normalizeUser(row);
    return {
      employeeId: escapeHtml(u.employeeId),
      name: escapeHtml(u.name),
      role: u.role,
      createdAt: u.createdAt,
      mustChangePassword: u.mustChangePassword,
      online: !!onlineMap[u.employeeId],
    };
  });
  return json({ users });
}

async function handleCreateUser(request, env) {
  const admin = await requireAuth(env, request);
  if (!admin || admin.role !== 'admin') return json({ error: '需要管理员权限' }, 403);

  const body = await request.json();
  const { employeeId, name, role } = body;
  if (!employeeId) return json({ error: '工号不能为空' }, 400);

  const existing = await env.DB.prepare(
    'SELECT employee_id FROM users WHERE employee_id = ?'
  ).bind(String(employeeId)).first();
  if (existing) return json({ error: '该工号已存在' }, 409);

  const passwordHash = await sha256(employeeId + ':default:' + employeeId);
  const user = {
    employeeId,
    name: name || employeeId,
    role: role === 'admin' ? 'admin' : 'user',
    mustChangePassword: true,
    createdAt: Date.now(),
  };
  await env.DB.prepare(
    'INSERT INTO users (employee_id, name, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).bind(user.employeeId, user.name, user.role, passwordHash, user.createdAt).run();

  return json({ ok: true, user: { employeeId: user.employeeId, name: user.name, role: user.role } });
}

async function handleAllTodos(request, env) {
  const admin = await requireAuth(env, request);
  if (!admin || admin.role !== 'admin') return json({ error: '需要管理员权限' }, 403);

  const { results } = await env.DB.prepare(
    'SELECT * FROM todos ORDER BY updated_at DESC'
  ).all();
  const todos = (results || []).map((row) => {
    const t = normalizeTodo(row);
    return {
      ...t,
      employeeId: escapeHtml(t.employeeId),
      text: escapeHtml(t.text),
      project: escapeHtml(t.project),
    };
  });

  // 按用户分组统计
  const byUser = {};
  for (const t of todos) {
    if (!byUser[t.employeeId]) byUser[t.employeeId] = { total: 0, done: 0, active: 0 };
    byUser[t.employeeId].total++;
    if (t.done) byUser[t.employeeId].done++;
    else byUser[t.employeeId].active++;
  }

  return json({ todos, byUser, total: todos.length });
}

// ========== 桌面端待办同步 ==========

async function handleMyTodos(request, env) {
  const user = await requireAuth(env, request);
  if (!user) return json({ error: '未登录' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT * FROM todos WHERE employee_id = ?'
  ).bind(user.employeeId).all();
  const todos = (results || []).map(normalizeTodo);
  todos.sort((a, b) => (b.clientUpdatedAt || 0) - (a.clientUpdatedAt || 0));
  return json({ todos });
}

async function handleTodoSync(request, env) {
  const user = await requireAuth(env, request);
  if (!user) return json({ error: '未登录' }, 401);

  const body = await request.json();
  const { todoId, action, ...data } = body;

  if (
    typeof todoId !== 'string'
    || !/^[a-zA-Z0-9_-]{1,160}$/.test(todoId)
    || !['create', 'update', 'complete', 'delete'].includes(action)
  ) {
    return json({ error: '无效的待办请求' }, 400);
  }

  if (action === 'delete') {
    await env.DB.prepare(
      'DELETE FROM todos WHERE employee_id = ? AND todo_id = ?'
    ).bind(user.employeeId, todoId).run();
    await broadcastToUser(env, user.employeeId, { event: 'todo.delete', todoId, source: 'cloud' });
    return json({ ok: true });
  }

  const current = await env.DB.prepare(
    'SELECT client_updated_at, updated_at FROM todos WHERE employee_id = ? AND todo_id = ?'
  ).bind(user.employeeId, todoId).first();
  const clientUpdatedAt = Number(data.clientUpdatedAt);
  if (
    current
    && Number.isFinite(clientUpdatedAt)
    && Number(current.client_updated_at || current.updated_at) > clientUpdatedAt
  ) {
    return json({ ok: false, error: 'stale_update' }, 409);
  }

  // 保存或更新待办（UPSERT，幂等）
  const todo = {
    todoId,
    employeeId: user.employeeId,
    text: String(data.text || '').slice(0, 4000),
    project: String(data.project || '').slice(0, 240),
    priority: ['P0', 'P1', 'P2', 'P3'].includes(data.priority) ? data.priority : 'P3',
    done: data.done ? 1 : 0,
    dueTime: data.dueTime ? String(data.dueTime).slice(0, 80) : null,
    status: data.status ? String(data.status).slice(0, 20) : '',
    progressText: data.progressText ? String(data.progressText).slice(0, 1200) : '',
    nextWeek: data.nextWeek ? String(data.nextWeek).slice(0, 1200) : '',
    clientUpdatedAt: Number.isFinite(clientUpdatedAt) ? clientUpdatedAt : Date.now(),
    updatedAt: Date.now(),
  };
  await env.DB.prepare(
    `INSERT INTO todos
      (employee_id, todo_id, text, project, priority, done, due_time, status, progress_text, next_week, client_updated_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, todo_id) DO UPDATE SET
       text = excluded.text,
       project = excluded.project,
       priority = excluded.priority,
       done = excluded.done,
       due_time = excluded.due_time,
       status = excluded.status,
       progress_text = excluded.progress_text,
       next_week = excluded.next_week,
       client_updated_at = excluded.client_updated_at,
       updated_at = excluded.updated_at`
  ).bind(
    todo.employeeId, todo.todoId, todo.text, todo.project, todo.priority, todo.done,
    todo.dueTime, todo.status, todo.progressText, todo.nextWeek,
    todo.clientUpdatedAt, todo.updatedAt
  ).run();

  // 广播给同用户其他设备
  await broadcastToUser(env, user.employeeId, {
    event: action === 'complete' ? 'todo.complete' : action === 'update' ? 'todo.update' : 'todo.create',
    todoId,
    source: 'cloud',
    payload: todo,
  });

  return json({ ok: true });
}

// ========== WebSocket ==========

async function handleWebSocket(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('Expected websocket', { status: 400 });
  }
  // token 校验、连接建立、广播与在线状态统一由 WsHub（Durable Object）处理
  const stub = hubStub(env);
  return stub.fetch(request);
}

// ========== 钉钉回调（预留） ==========

async function handleDingtalkCallback(request, env) {
  const body = await request.text();
  const timestamp = request.headers.get('timestamp') || request.headers.get('x-dingtalk-timestamp') || '';
  const nonce = request.headers.get('nonce') || request.headers.get('x-dingtalk-nonce') || '';
  const signature = request.headers.get('signature') || request.headers.get('x-dingtalk-signature') || '';
  const token = env.DINGTALK_CALLBACK_TOKEN || '';
  if (!token || !await verifyDingtalkCallback(signature, timestamp, nonce, body, token)) {
    return json({ error: 'invalid_signature' }, 401);
  }
  return json({ code: 0, msg: 'ok' });
}

// ========== 前端页面 ==========

function serveAdminPage() { return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); }
function serveCss() { return new Response(CSS, { headers: { 'Content-Type': 'text/css' } }); }
function serveAppJs() { return new Response(APP_JS, { headers: { 'Content-Type': 'application/javascript' } }); }

const HTML = "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"><title>NexusDesk</title><link rel=\"stylesheet\" href=\"/app.css\"></head><body><div id=\"app\"></div><script src=\"/app.js\"></script></body></html>";
const CSS = ":root {\n  --bg: #f4f5f7;\n  --surface: #ffffff;\n  --surface-2: #f5f6f8;\n  --surface-3: #ebedf0;\n  --border: #e6e8ec;\n  --border-strong: #d5d9e0;\n  --text: #1b1d23;\n  --text-2: #5c6270;\n  --text-3: #9aa1ad;\n  --accent: #34c759;\n  --accent-hover: #2bb84e;\n  --accent-dim: rgba(52, 199, 89, 0.1);\n  --orange: #ff9500;\n  --orange-dim: rgba(255, 149, 0, 0.12);\n  --blue: #007aff;\n  --blue-dim: rgba(0, 122, 255, 0.1);\n  --red: #ff3b30;\n  --red-dim: rgba(255, 59, 48, 0.1);\n  --purple: #af52de;\n  --purple-dim: rgba(175, 82, 222, 0.1);\n  --gray: #8e8e93;\n  --gray-dim: rgba(142, 142, 147, 0.12);\n  --radius: 14px;\n  --radius-lg: 20px;\n  --shadow: 0 2px 10px rgba(0, 0, 0, 0.05);\n  --shadow-hover: 0 10px 28px rgba(0, 0, 0, 0.09);\n  --font: -apple-system, BlinkMacSystemFont, \"SF Pro Display\", \"PingFang SC\", \"Segoe UI\", \"Microsoft YaHei\", sans-serif;\n}\n\n* { margin: 0; padding: 0; box-sizing: border-box; }\nhtml, body { height: 100%; }\nbody {\n  background: var(--bg);\n  color: var(--text);\n  font-family: var(--font);\n  -webkit-font-smoothing: antialiased;\n  line-height: 1.55;\n  font-size: 15px;\n}\n\n/* ===== 动效 ===== */\n@keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }\n@keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }\n@keyframes popIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }\n@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }\n.fade-up { animation: fadeUp .5s cubic-bezier(0.22, 1, 0.36, 1) both; }\n.fade-up-1 { animation-delay: .05s; }\n.fade-up-2 { animation-delay: .1s; }\n.fade-up-3 { animation-delay: .15s; }\n.fade-up-4 { animation-delay: .2s; }\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }\n}\n\n/* ===== 登录页 ===== */\n.login-page {\n  min-height: 100vh;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 32px;\n  background:\n    radial-gradient(600px 400px at 15% 10%, rgba(52, 199, 89, 0.07), transparent 60%),\n    radial-gradient(500px 380px at 85% 90%, rgba(0, 122, 255, 0.06), transparent 60%),\n    var(--bg);\n}\n.login-card {\n  width: 100%;\n  max-width: 940px;\n  background: var(--surface);\n  border-radius: var(--radius-lg);\n  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.08);\n  display: grid;\n  grid-template-columns: 1.05fr 1fr;\n  overflow: hidden;\n  animation: fadeUp .6s cubic-bezier(0.22, 1, 0.36, 1) both;\n}\n.login-left {\n  background: linear-gradient(160deg, #1d1f27 0%, #2b2f3a 55%, #333a46 100%);\n  padding: 52px 44px;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  position: relative;\n  overflow: hidden;\n}\n.login-left::before {\n  content: \"\";\n  position: absolute;\n  width: 420px; height: 420px;\n  border-radius: 50%;\n  background: radial-gradient(circle, rgba(52, 199, 89, 0.18) 0%, transparent 70%);\n  top: -120px; right: -120px;\n}\n.login-left::after {\n  content: \"\";\n  position: absolute;\n  width: 260px; height: 260px;\n  border-radius: 50%;\n  background: radial-gradient(circle, rgba(0, 122, 255, 0.12) 0%, transparent 70%);\n  bottom: -80px; left: -60px;\n}\n.login-left-inner { position: relative; z-index: 1; }\n.brand-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; }\n.brand-logo .mark {\n  width: 40px; height: 40px;\n  border-radius: 11px;\n  background: var(--accent);\n  display: flex; align-items: center; justify-content: center;\n  font-size: 20px; font-weight: 800; color: #fff;\n  box-shadow: 0 6px 18px rgba(52, 199, 89, 0.35);\n}\n.brand-logo .name { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.01em; }\n.brand-headline { font-size: 34px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; color: #fff; margin-bottom: 14px; }\n.brand-sub { font-size: 15px; color: rgba(255, 255, 255, 0.65); line-height: 1.75; margin-bottom: 34px; }\n.brand-features { display: flex; flex-direction: column; gap: 14px; }\n.brand-feature {\n  display: flex; align-items: center; gap: 14px;\n  font-size: 14px; color: rgba(255, 255, 255, 0.85);\n  opacity: 0;\n  animation: slideIn .5s ease forwards;\n}\n.brand-feature:nth-child(1) { animation-delay: .2s; }\n.brand-feature:nth-child(2) { animation-delay: .3s; }\n.brand-feature:nth-child(3) { animation-delay: .4s; }\n.brand-feature .icon {\n  width: 34px; height: 34px;\n  border-radius: 9px;\n  background: rgba(255, 255, 255, 0.1);\n  display: flex; align-items: center; justify-content: center;\n  flex-shrink: 0; font-size: 16px;\n}\n.login-right { padding: 52px 46px; display: flex; flex-direction: column; justify-content: center; }\n.login-right h2 { font-size: 26px; font-weight: 700; margin-bottom: 4px; letter-spacing: -0.01em; }\n.login-right .sub { font-size: 14px; color: var(--text-3); margin-bottom: 30px; }\n.field { margin-bottom: 18px; }\n.field label { display: block; font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 7px; }\n.field input {\n  width: 100%;\n  background: var(--surface-2);\n  border: 1.5px solid transparent;\n  color: var(--text);\n  padding: 13px 15px;\n  border-radius: 11px;\n  font-size: 15px;\n  font-family: var(--font);\n  outline: none;\n  transition: border-color .15s, background .15s, box-shadow .15s;\n}\n.field input:focus { border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-dim); }\n.field input::placeholder { color: var(--text-3); }\n.btn-primary {\n  width: 100%;\n  background: var(--accent);\n  color: #fff;\n  border: none;\n  padding: 14px;\n  border-radius: 11px;\n  font-size: 15px;\n  font-weight: 600;\n  font-family: var(--font);\n  cursor: pointer;\n  margin-top: 10px;\n  transition: background .15s, transform .1s, box-shadow .15s;\n  box-shadow: 0 6px 18px rgba(52, 199, 89, 0.3);\n}\n.btn-primary:hover { background: var(--accent-hover); }\n.btn-primary:active { transform: scale(0.98); }\n.btn-primary:disabled { opacity: .55; cursor: default; box-shadow: none; }\n.error-msg {\n  color: var(--red);\n  font-size: 13px;\n  margin-top: 12px;\n  padding: 11px 14px;\n  background: var(--red-dim);\n  border-radius: 9px;\n  border: 1px solid rgba(255, 59, 48, 0.15);\n}\n.create-user-form {\n  display: flex;\n  gap: 14px;\n  align-items: flex-end;\n  flex-wrap: wrap;\n  margin-bottom: 6px;\n}\n.create-user-form .field { margin-bottom: 0; flex: 1 1 180px; min-width: 0; }\n.create-user-form .btn-primary { flex: 0 0 auto; padding: 11px 22px; }\n.form-hint { font-size: 12px; color: var(--text-3); margin-top: 10px; }\n.ok-msg {\n  color: var(--accent);\n  font-size: 13px;\n  margin-top: 12px;\n  padding: 11px 14px;\n  background: var(--accent-dim);\n  border-radius: 9px;\n  border: 1px solid rgba(52, 199, 89, 0.15);\n}\n.login-footer { margin-top: 22px; font-size: 13px; color: var(--text-3); text-align: center; }\n\n/* ===== 主框架 ===== */\n.dash { display: flex; min-height: 100vh; }\n.sidebar {\n  width: 230px;\n  background: var(--surface);\n  border-right: 1px solid var(--border);\n  display: flex;\n  flex-direction: column;\n  padding: 22px 14px;\n  flex-shrink: 0;\n  position: sticky;\n  top: 0;\n  height: 100vh;\n}\n.sidebar-logo { display: flex; align-items: center; gap: 11px; padding: 0 8px 24px; }\n.sidebar-logo .mark {\n  width: 32px; height: 32px;\n  border-radius: 9px;\n  background: var(--accent);\n  display: flex; align-items: center; justify-content: center;\n  font-size: 16px; font-weight: 800; color: #fff;\n  box-shadow: 0 4px 12px rgba(52, 199, 89, 0.3);\n}\n.sidebar-logo .name { font-size: 16px; font-weight: 700; }\n.nav-item {\n  display: flex; align-items: center; gap: 11px;\n  padding: 11px 13px;\n  font-size: 14px;\n  color: var(--text-2);\n  cursor: pointer;\n  border-radius: 10px;\n  transition: background .15s, color .15s, transform .1s;\n  margin-bottom: 3px;\n  font-weight: 500;\n}\n.nav-item:hover { background: var(--surface-2); color: var(--text); }\n.nav-item:active { transform: scale(0.98); }\n.nav-item.active { background: var(--accent-dim); color: var(--accent); font-weight: 600; }\n.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }\n.topbar {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 18px 32px;\n  background: var(--surface);\n  border-bottom: 1px solid var(--border);\n  position: sticky;\n  top: 0;\n  z-index: 20;\n}\n.topbar-title { font-size: 18px; font-weight: 700; }\n.topbar-right { display: flex; align-items: center; gap: 14px; }\n.avatar {\n  width: 36px; height: 36px;\n  border-radius: 50%;\n  background: var(--accent);\n  color: #fff;\n  display: flex; align-items: center; justify-content: center;\n  font-size: 15px; font-weight: 600;\n  box-shadow: 0 3px 10px rgba(52, 199, 89, 0.3);\n}\n.user-info { display: flex; flex-direction: column; align-items: flex-end; }\n.user-name { font-size: 14px; font-weight: 600; }\n.user-role { font-size: 12px; color: var(--text-3); }\n.btn-ghost {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  color: var(--text-2);\n  padding: 8px 15px;\n  border-radius: 9px;\n  font-size: 13px;\n  font-family: var(--font);\n  cursor: pointer;\n  transition: all .15s;\n  font-weight: 500;\n}\n.btn-ghost:hover { border-color: var(--border-strong); color: var(--text); background: var(--surface-2); }\n.btn-ghost:active { transform: scale(0.97); }\n.dash-body { flex: 1; padding: 28px; overflow-y: auto; max-width: 1240px; width: 100%; margin: 0 auto; }\n\n/* ===== 页面标题 ===== */\n.page-title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 5px; }\n.page-sub { font-size: 14px; color: var(--text-3); margin-bottom: 26px; }\n\n/* ===== 统计卡片 ===== */\n.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }\n.stat-card {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  padding: 20px;\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  box-shadow: var(--shadow);\n  transition: transform .2s, box-shadow .2s;\n  cursor: pointer;\n}\n.stat-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }\n.stat-icon {\n  width: 44px; height: 44px;\n  border-radius: 12px;\n  display: flex; align-items: center; justify-content: center;\n  font-size: 20px; flex-shrink: 0;\n}\n.stat-icon.blue { background: var(--blue-dim); }\n.stat-icon.gray { background: var(--gray-dim); }\n.stat-icon.orange { background: var(--orange-dim); }\n.stat-icon.green { background: var(--accent-dim); }\n.stat-num { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }\n.stat-label { font-size: 12px; color: var(--text-3); margin-top: 4px; }\n\n/* ===== 面板 ===== */\n.panel {\n  background: var(--surface);\n  border: 1px solid var(--border);\n  border-radius: var(--radius);\n  padding: 22px;\n  margin-bottom: 16px;\n  box-shadow: var(--shadow);\n}\n.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }\n.panel-title { font-size: 15px; font-weight: 700; }\n.panel-count { font-size: 13px; color: var(--text-3); }\n\n/* ===== 用户分组 ===== */\n.user-group { margin-bottom: 18px; animation: fadeUp .4s cubic-bezier(0.22, 1, 0.36, 1) both; }\n.user-group-head {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 14px 16px;\n  background: var(--surface-2);\n  border: 1px solid var(--border);\n  border-radius: 12px;\n  cursor: pointer;\n  transition: background .15s ease, border-color .15s ease;\n}\n.user-group-head:hover { background: var(--surface-3); border-color: var(--border-strong); }\n.user-group-title { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 10px; }\n.user-group-avatar {\n  display: inline-flex; align-items: center; justify-content: center;\n  width: 26px; height: 26px;\n  border-radius: 50%;\n  background: var(--accent);\n  color: #fff;\n  font-size: 13px; font-weight: 700;\n}\n.user-group-count { font-size: 13px; color: var(--text-3); display: flex; align-items: center; gap: 8px; }\n.user-group-body { margin: 12px 0 0 16px; border-left: 2px solid var(--border); padding-left: 16px; }\n.user-group-collapsed { margin: 0 0 0 16px; border-left: 2px solid var(--border); padding: 12px 0 0 16px; }\n\n/* ===== 四象限 ===== */\n.quadrant { margin-bottom: 16px; }\n.quadrant-head {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 10px 14px;\n  border-radius: 10px;\n  margin-bottom: 6px;\n  font-weight: 600;\n}\n.quadrant-P0 { background: var(--red-dim); color: #d62a20; }\n.quadrant-P1 { background: var(--orange-dim); color: #d97706; }\n.quadrant-P2 { background: var(--blue-dim); color: var(--blue); }\n.quadrant-P3 { background: var(--accent-dim); color: var(--accent); }\n.quadrant-title { font-size: 14px; }\n.quadrant-count { font-size: 12px; font-weight: 500; opacity: .75; }\n\n/* ===== 待办行 ===== */\n.todo-row {\n  display: flex;\n  align-items: flex-start;\n  gap: 12px;\n  padding: 13px 12px;\n  border-bottom: 1px solid var(--border);\n  transition: background .12s;\n  cursor: pointer;\n  border-radius: 8px;\n  margin: 0 -4px;\n}\n.todo-row:hover { background: var(--surface-2); }\n.todo-row:last-child { border-bottom: none; }\n.todo-row.done .todo-text { opacity: .45; text-decoration: line-through; }\n.todo-check {\n  width: 22px; height: 22px;\n  border-radius: 7px;\n  border: 1.5px solid var(--border-strong);\n  display: flex; align-items: center; justify-content: center;\n  flex-shrink: 0;\n  font-size: 12px; color: #fff;\n  transition: all .15s;\n  margin-top: 1px;\n}\n.todo-row.done .todo-check { background: var(--accent); border-color: var(--accent); }\n.todo-main { flex: 1; min-width: 0; }\n.todo-title-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n.todo-text { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.todo-project {\n  font-size: 12px;\n  color: var(--text-2);\n  background: var(--surface-3);\n  padding: 2px 8px;\n  border-radius: 6px;\n  white-space: nowrap;\n  font-weight: 500;\n}\n.todo-meta { display: flex; align-items: center; gap: 10px; margin-top: 5px; flex-wrap: wrap; }\n.todo-due { font-size: 12px; color: var(--text-3); }\n.todo-who { font-size: 12px; color: var(--text-3); }\n.todo-progress-preview {\n  font-size: 13px;\n  color: var(--text-2);\n  background: var(--surface-2);\n  border-left: 3px solid var(--accent);\n  padding: 6px 10px;\n  border-radius: 0 8px 8px 0;\n  margin-top: 7px;\n  line-height: 1.6;\n  overflow: hidden;\n}\n.todo-progress-preview.next { border-left-color: var(--blue); }\n.todo-progress-label { font-weight: 600; color: var(--text); margin-right: 6px; }\n\n/* ===== 状态标签 ===== */\n.status-badge {\n  display: inline-block;\n  padding: 3px 10px;\n  border-radius: 999px;\n  font-size: 12px;\n  font-weight: 600;\n  white-space: nowrap;\n  border: 1px solid transparent;\n}\n.st-done { background: var(--accent-dim); color: var(--accent); border-color: rgba(52, 199, 89, 0.25); }\n.st-active { background: var(--blue-dim); color: var(--blue); border-color: rgba(0, 122, 255, 0.25); }\n.st-late { background: var(--red-dim); color: var(--red); border-color: rgba(255, 59, 48, 0.25); }\n.st-new { background: var(--gray-dim); color: var(--text-2); border-color: rgba(142, 142, 147, 0.25); }\n\n/* ===== 表格（成员页） ===== */\ntable { width: 100%; border-collapse: collapse; }\nth { text-align: left; font-size: 12px; font-weight: 600; color: var(--text-3); padding: 0 0 12px; border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: .03em; }\ntd { padding: 14px 0; border-bottom: 1px solid var(--border); font-size: 15px; }\ntr:last-child td { border-bottom: none; }\ntr { transition: background .12s; }\ntbody tr:hover { background: var(--surface-2); }\n.badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }\n.badge-admin { background: var(--accent-dim); color: var(--accent); }\n.badge-user { background: var(--gray-dim); color: var(--text-2); }\n.online-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; vertical-align: middle; }\n.online-dot.on { background: var(--accent); box-shadow: 0 0 8px rgba(52, 199, 89, 0.6); }\n.online-dot.off { background: var(--gray); opacity: .45; }\n\n/* ===== 空状态 ===== */\n.empty {\n  color: var(--text-3);\n  font-size: 14px;\n  text-align: center;\n  padding: 44px 0;\n  line-height: 1.8;\n}\n.empty-icon { font-size: 38px; margin-bottom: 10px; opacity: .6; }\n\n/* ===== 设置页 ===== */\n.settings-row { display: flex; justify-content: space-between; align-items: center; padding: 15px 2px; border-bottom: 1px solid var(--border); }\n.settings-row:last-child { border-bottom: none; }\n.settings-label { font-size: 15px; font-weight: 500; }\n.settings-value { font-size: 14px; color: var(--text-2); }\n\n/* ===== 骨架屏 ===== */\n.skeleton {\n  background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);\n  background-size: 200% 100%;\n  animation: shimmer 1.5s infinite;\n}\n\n/* ===== 详情弹窗 ===== */\n.modal-mask {\n  position: fixed; top: 0; left: 0; right: 0; bottom: 0;\n  background: rgba(15, 17, 22, 0.5);\n  z-index: 999;\n  display: flex; align-items: center; justify-content: center;\n  padding: 20px;\n  backdrop-filter: blur(3px);\n  animation: fadeUp .2s ease both;\n}\n.modal-card {\n  background: var(--surface);\n  border-radius: 18px;\n  padding: 30px;\n  max-width: 520px;\n  width: 100%;\n  max-height: 88vh;\n  overflow-y: auto;\n  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.22);\n  animation: popIn .25s cubic-bezier(0.22, 1, 0.36, 1) both;\n}\n.modal-title { font-size: 20px; font-weight: 700; margin-bottom: 20px; line-height: 1.4; }\n.modal-row { display: flex; margin-bottom: 13px; font-size: 14px; }\n.modal-row .k { width: 90px; flex-shrink: 0; color: var(--text-3); font-weight: 500; }\n.modal-row .v { flex: 1; color: var(--text); white-space: pre-wrap; word-break: break-word; }\n.modal-row .v.status-val { display: inline-block; }\n.modal-section {\n  background: var(--surface-2);\n  border-radius: 10px;\n  padding: 12px 14px;\n  margin-bottom: 12px;\n  font-size: 14px;\n  line-height: 1.65;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n.modal-section .sec-label { font-weight: 700; color: var(--text); display: block; margin-bottom: 4px; }\n.modal-section.green { border-left: 3px solid var(--accent); }\n.modal-section.blue { border-left: 3px solid var(--blue); }\n.btn-close {\n  width: 100%;\n  background: var(--accent);\n  color: #fff;\n  border: none;\n  padding: 13px;\n  border-radius: 11px;\n  font-size: 15px;\n  font-weight: 600;\n  font-family: var(--font);\n  cursor: pointer;\n  margin-top: 8px;\n  transition: background .15s, transform .1s;\n  box-shadow: 0 6px 18px rgba(52, 199, 89, 0.3);\n}\n.btn-close:hover { background: var(--accent-hover); }\n.btn-close:active { transform: scale(0.98); }\n\n/* ===== 响应式 ===== */\n@media (max-width: 960px) {\n  .login-card { grid-template-columns: 1fr; }\n  .login-left { display: none; }\n  .stats-grid { grid-template-columns: repeat(2, 1fr); }\n  .sidebar { display: none; }\n  .topbar { padding: 14px 18px; }\n  .dash-body { padding: 18px; }\n}\n";;;;;
const APP_JS = "var token = localStorage.getItem('nexusdesk_token') || '';\nvar user = JSON.parse(localStorage.getItem('nexusdesk_user') || 'null');\nvar currentTab = 'todos';\nvar expandedUsers = {};\n\nvar QUADRANTS = [\n  { key: 'P0', label: '重要且紧急', icon: '🔴' },\n  { key: 'P1', label: '重要不紧急', icon: '🟠' },\n  { key: 'P2', label: '紧急不重要', icon: '🔵' },\n  { key: 'P3', label: '日常事务', icon: '🟢' }\n];\n\nfunction esc(s) {\n  return String(s == null ? '' : s)\n    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')\n    .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');\n}\n\nfunction fmtDate(v) {\n  if (!v) return '';\n  var d = new Date(v);\n  if (Number.isNaN(d.getTime())) return '';\n  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });\n}\nfunction fmtFull(v) {\n  if (!v) return '';\n  var d = new Date(v);\n  if (Number.isNaN(d.getTime())) return '';\n  return d.toLocaleString('zh-CN');\n}\nfunction statusOf(x) {\n  return x.done ? '已完成' : (x.status || '进行中');\n}\nfunction statusCls(x) {\n  return x.done ? 'st-done' : (x.status === '延期' ? 'st-late' : (x.status === '未开始' ? 'st-new' : 'st-active'));\n}\n\nasync function api(path, opts) {\n  opts = opts || {};\n  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});\n  if (token) opts.headers['Authorization'] = 'Bearer ' + token;\n  var res = await fetch(path, opts);\n  if (res.status === 401) { logout(); throw new Error('unauthorized'); }\n  return res.json();\n}\n\nfunction logout() {\n  token = ''; user = null;\n  localStorage.removeItem('nexusdesk_token');\n  localStorage.removeItem('nexusdesk_user');\n  render();\n}\n\nfunction render() {\n  var app = document.getElementById('app');\n  if (!token || !user) return renderLogin(app);\n  if (user.mustChangePassword) return renderChangePwd(app);\n  renderDashboard(app);\n}\n\nfunction el(html) {\n  var d = document.createElement('div');\n  d.innerHTML = html;\n  return d.firstElementChild;\n}\n\nfunction avatarText() {\n  var n = (user.name || user.employeeId || 'U').toString();\n  return n.charAt(0).toUpperCase();\n}\n\n/* ===== 登录 ===== */\nfunction renderLogin(app) {\n  app.innerHTML = '';\n  var page = el('<div class=\"login-page\"></div>');\n  var card = el('<div class=\"login-card\"></div>');\n  var left = el('<div class=\"login-left\"><div class=\"login-left-inner\">' +\n    '<div class=\"brand-logo\"><div class=\"mark\">N</div><div class=\"name\">NexusDesk</div></div>' +\n    '<div class=\"brand-headline\">待办同步<br/>原来这么简单</div>' +\n    '<div class=\"brand-sub\">桌面端刘海工作台，待办实时上云。多设备同步，团队共享一个待办池。</div>' +\n    '<div class=\"brand-features\">' +\n      '<div class=\"brand-feature\"><div class=\"icon\">⚡</div>实时同步</div>' +\n      '<div class=\"brand-feature\"><div class=\"icon\">🔒</div>工号登录</div>' +\n      '<div class=\"brand-feature\"><div class=\"icon\">📋</div>团队待办池</div>' +\n    '</div>' +\n  '</div></div>');\n  var right = el('<div class=\"login-right\">' +\n    '<h2>欢迎回来</h2>' +\n    '<div class=\"sub\">用工号登录继续</div>' +\n    '<div id=\"err\"></div>' +\n    '<div class=\"field\"><label>工号</label><input type=\"text\" id=\"empId\" autocomplete=\"username\" placeholder=\"请输入工号\"></div>' +\n    '<div class=\"field\"><label>密码</label><input type=\"password\" id=\"pwd\" autocomplete=\"current-password\" placeholder=\"请输入密码\"></div>' +\n    '<button class=\"btn-primary\" id=\"loginBtn\">登 录</button>' +\n    '<div class=\"login-footer\">默认密码为工号，首次登录后请修改</div>' +\n  '</div>');\n  card.appendChild(left); card.appendChild(right);\n  page.appendChild(card);\n  app.appendChild(page);\n  document.getElementById('loginBtn').onclick = doLogin;\n  document.getElementById('pwd').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };\n  document.getElementById('empId').focus();\n}\n\nasync function doLogin() {\n  var empId = document.getElementById('empId').value.trim();\n  var pwd = document.getElementById('pwd').value;\n  var btn = document.getElementById('loginBtn');\n  btn.disabled = true; btn.textContent = '登录中…';\n  try {\n    var res = await api('/api/login', { method: 'POST', body: JSON.stringify({ employeeId: empId, password: pwd }) });\n    if (res.error) {\n      document.getElementById('err').innerHTML = '<div class=\"error-msg\">' + esc(res.error) + '</div>';\n      btn.disabled = false; btn.textContent = '登 录';\n      return;\n    }\n    token = res.token; user = res.user; currentTab = 'todos';\n    localStorage.setItem('nexusdesk_token', token);\n    localStorage.setItem('nexusdesk_user', JSON.stringify(user));\n    render();\n  } catch (e) {\n    document.getElementById('err').innerHTML = '<div class=\"error-msg\">网络错误</div>';\n    btn.disabled = false; btn.textContent = '登 录';\n  }\n}\n\n/* ===== 改密 ===== */\nfunction renderChangePwd(app) {\n  app.innerHTML = '';\n  var page = el('<div class=\"login-page\"></div>');\n  var card = el('<div class=\"login-card\"></div>');\n  var left = el('<div class=\"login-left\"><div class=\"login-left-inner\">' +\n    '<div class=\"brand-logo\"><div class=\"mark\">N</div><div class=\"name\">NexusDesk</div></div>' +\n    '<div class=\"brand-headline\">首次登录</div>' +\n    '<div class=\"brand-sub\">为了安全，请修改初始密码。</div></div></div>');\n  var right = el('<div class=\"login-right\"><h2>修改密码</h2><div class=\"sub\">新密码至少 4 位</div><div id=\"err\"></div>' +\n    '<div class=\"field\"><label>原密码</label><input type=\"password\" id=\"oldPwd\"></div>' +\n    '<div class=\"field\"><label>新密码</label><input type=\"password\" id=\"newPwd\"></div>' +\n    '<button class=\"btn-primary\">确认修改</button></div>');\n  right.querySelector('button').onclick = doChangePwd;\n  card.appendChild(left); card.appendChild(right);\n  page.appendChild(card);\n  app.appendChild(page);\n}\n\nasync function doChangePwd() {\n  var oldPwd = document.getElementById('oldPwd').value;\n  var newPwd = document.getElementById('newPwd').value;\n  try {\n    var res = await api('/api/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }) });\n    if (res.error) { document.getElementById('err').innerHTML = '<div class=\"error-msg\">' + esc(res.error) + '</div>'; return; }\n    user.mustChangePassword = false;\n    localStorage.setItem('nexusdesk_user', JSON.stringify(user));\n    render();\n  } catch (e) { document.getElementById('err').innerHTML = '<div class=\"error-msg\">网络错误</div>'; }\n}\n\n/* ===== 待办行渲染（含进展预览）===== */\nfunction renderTodoRow(x, idx, showWho) {\n  var st = statusOf(x);\n  var stCls = statusCls(x);\n  var project = (x.project || '').trim() ? '<span class=\"todo-project\">📁 ' + esc(x.project) + '</span>' : '';\n  var progressHtml = '';\n  if (x.progressText) {\n    progressHtml += '<div class=\"todo-progress-preview\"><span class=\"todo-progress-label\">📝 本周进展</span>' + esc(x.progressText) + '</div>';\n  }\n  if (x.nextWeek) {\n    progressHtml += '<div class=\"todo-progress-preview next\"><span class=\"todo-progress-label\">🗓 下周计划</span>' + esc(x.nextWeek) + '</div>';\n  }\n  return '<div class=\"todo-row ' + (x.done ? 'done' : '') + '\" data-idx=\"' + idx + '\">' +\n    '<div class=\"todo-check\">' + (x.done ? '✓' : '') + '</div>' +\n    '<div class=\"todo-main\">' +\n      '<div class=\"todo-title-line\"><span class=\"todo-text\">' + esc(x.text) + '</span>' + project + '</div>' +\n      '<div class=\"todo-meta\">' +\n        '<span class=\"status-badge ' + stCls + '\">' + st + '</span>' +\n        (x.dueTime ? '<span class=\"todo-due\">⏰ ' + fmtDate(x.dueTime) + '</span>' : '') +\n        (showWho ? '<span class=\"todo-who\">👤 ' + esc(x.employeeId || '') + '</span>' : '') +\n      '</div>' +\n      progressHtml +\n    '</div>' +\n  '</div>';\n}\n\n/* ===== 主界面 ===== */\nasync function renderDashboard(app) {\n  app.innerHTML = '';\n  var isAdmin = user.role === 'admin';\n  var dash = el('<div class=\"dash\">' +\n    '<div class=\"sidebar\">' +\n      '<div class=\"sidebar-logo\"><div class=\"mark\">N</div><div class=\"name\">NexusDesk</div></div>' +\n      '<div class=\"nav-item' + (currentTab === 'todos' ? ' active' : '') + '\" data-tab=\"todos\">📋 待办总览</div>' +\n      (isAdmin ? '<div class=\"nav-item' + (currentTab === 'members' ? ' active' : '') + '\" data-tab=\"members\">👥 成员</div>' : '') +\n      '<div class=\"nav-item' + (currentTab === 'projects' ? ' active' : '') + '\" data-tab=\"projects\">📁 项目</div>' +\n      '<div class=\"nav-item' + (currentTab === 'settings' ? ' active' : '') + '\" data-tab=\"settings\">⚙️ 设置</div>' +\n    '</div>' +\n    '<div class=\"main\">' +\n      '<div class=\"topbar\"><div class=\"topbar-title\" id=\"topbarTitle\">待办总览</div>' +\n      '<div class=\"topbar-right\"><div class=\"user-info\"><div class=\"user-name\">' + esc(user.name || user.employeeId) + '</div><div class=\"user-role\">' + (isAdmin ? '管理员' : '成员') + '</div></div><div class=\"avatar\">' + avatarText() + '</div><button class=\"btn-ghost\">退出</button></div></div>' +\n      '<div class=\"dash-body\" id=\"body\"><div class=\"skeleton\" style=\"height:420px;border-radius:14px\"></div></div>' +\n    '</div></div>');\n  dash.querySelector('.btn-ghost').onclick = logout;\n  var navItems = dash.querySelectorAll('.nav-item');\n  for (var i = 0; i < navItems.length; i++) {\n    (function (item) {\n      item.onclick = function () {\n        var tab = item.getAttribute('data-tab');\n        if (tab === currentTab) return;\n        currentTab = tab;\n        renderDashboard(app);\n      };\n    })(navItems[i]);\n  }\n  app.appendChild(dash);\n\n  /* 设置 */\n  if (currentTab === 'settings') {\n    document.getElementById('topbarTitle').textContent = '设置';\n    document.getElementById('body').innerHTML =\n      '<div class=\"page-title fade-up\">设置</div><div class=\"page-sub fade-up fade-up-1\">账户与同步</div>' +\n      '<div class=\"panel fade-up fade-up-2\"><div class=\"panel-head\"><div class=\"panel-title\">账户信息</div></div>' +\n      '<div class=\"settings-row\"><div class=\"settings-label\">工号</div><div class=\"settings-value\">' + esc(user.employeeId) + '</div></div>' +\n      '<div class=\"settings-row\"><div class=\"settings-label\">姓名</div><div class=\"settings-value\">' + esc(user.name || '-') + '</div></div>' +\n      '<div class=\"settings-row\"><div class=\"settings-label\">角色</div><div class=\"settings-value\">' + (isAdmin ? '管理员' : '成员') + '</div></div>' +\n      '<div class=\"settings-row\"><div class=\"settings-label\">同步状态</div><div class=\"settings-value\">桌面端登录后自动同步</div></div>' +\n      '</div>';\n    return;\n  }\n\n  /* 项目 */\n  if (currentTab === 'projects') {\n    document.getElementById('topbarTitle').textContent = '项目';\n    var projRes = isAdmin ? await api('/api/admin/todos') : await api('/api/my/todos');\n    var projTodos = projRes.todos || [];\n    var projMap = {};\n    for (var pi = 0; pi < projTodos.length; pi++) {\n      var pn = (projTodos[pi].project || '').trim() || '未分组';\n      if (!projMap[pn]) projMap[pn] = [];\n      projMap[pn].push(pi);\n    }\n    var projNames = Object.keys(projMap).sort();\n    var projHtml = projNames.length === 0\n      ? '<div class=\"empty\"><div class=\"empty-icon\">📁</div>暂无项目数据<br/>给待办添加项目后自动归类</div>'\n      : projNames.map(function (pn) {\n          var idxs = projMap[pn];\n          var listDone = idxs.filter(function (ix) { return projTodos[ix].done; }).length;\n          var rowsHtml = idxs.map(function (ix) { return renderTodoRow(projTodos[ix], ix, isAdmin); }).join('');\n          return '<div class=\"quadrant\"><div class=\"quadrant-head quadrant-P3\"><div class=\"quadrant-title\">📁 ' + esc(pn) + '</div><div class=\"quadrant-count\">' + (idxs.length - listDone) + ' 进行中 · ' + listDone + ' 已完成</div></div>' + rowsHtml + '</div>';\n        }).join('');\n    document.getElementById('body').innerHTML =\n      '<div class=\"page-title fade-up\">项目</div><div class=\"page-sub fade-up fade-up-1\">按项目自动归类，共 ' + projNames.length + ' 个项目</div>' +\n      '<div class=\"panel fade-up fade-up-2\">' + projHtml + '</div>';\n    bindTodoRows(projTodos);\n    return;\n  }\n\n  /* 成员（管理员） */\n  if (currentTab === 'members' && isAdmin) {\n    document.getElementById('topbarTitle').textContent = '成员';\n    var u2 = await api('/api/admin/users');\n    var onlineCount = (u2.users || []).filter(function (x) { return x.online; }).length;\n    var usersHtml2 = (u2.users || []).map(function (x) {\n      return '<tr><td><span class=\"online-dot ' + (x.online ? 'on' : 'off') + '\"></span>' + esc(x.employeeId) + '</td><td>' + esc(x.name) + '</td><td><span class=\"badge ' + (x.role === 'admin' ? 'badge-admin' : 'badge-user') + '\">' + (x.role === 'admin' ? '管理员' : '成员') + '</span></td><td style=\"color:' + (x.online ? 'var(--accent)' : 'var(--text-3)') + ';font-weight:600\">' + (x.online ? '● 在线' : '○ 离线') + '</td></tr>';\n    }).join('');\n    document.getElementById('body').innerHTML =\n      '<div class=\"page-title fade-up\">成员</div><div class=\"page-sub fade-up fade-up-1\">共 ' + (u2.users || []).length + ' 人，' + onlineCount + ' 人在线</div>' +\n      '<div class=\"panel fade-up fade-up-2\">' +\n        '<div class=\"panel-head\"><div class=\"panel-title\">新建成员</div></div>' +\n        '<div class=\"create-user-form\">' +\n          '<div class=\"field\"><label>工号</label><input type=\"text\" id=\"newEmpId\" placeholder=\"如 005612\" autocomplete=\"off\"></div>' +\n          '<div class=\"field\"><label>姓名</label><input type=\"text\" id=\"newUserName\" placeholder=\"如 张三\" autocomplete=\"off\"></div>' +\n          '<button class=\"btn-primary\" id=\"createUserBtn\" type=\"button\">添加成员</button>' +\n        '</div>' +\n        '<div class=\"form-hint\">默认密码=工号，成员首次登录后自行修改</div>' +\n        '<div id=\"createUserMsg\"></div>' +\n      '</div>' +\n      '<div class=\"panel fade-up fade-up-2\"><table><thead><tr><th>工号</th><th>姓名</th><th>角色</th><th>状态</th></tr></thead><tbody>' + usersHtml2 + '</tbody></table></div>';\n    var cuBtn = document.getElementById('createUserBtn');\n    if (cuBtn) cuBtn.onclick = doCreateUser;\n    return;\n  }\n\n  /* 新建成员（管理员） */\n  async function doCreateUser() {\n    var empId = document.getElementById('newEmpId').value.trim();\n    var name = document.getElementById('newUserName').value.trim();\n    var msg = document.getElementById('createUserMsg');\n    var btn = document.getElementById('createUserBtn');\n    if (!empId) {\n      if (msg) msg.innerHTML = '<div class=\"error-msg\">工号不能为空</div>';\n      return;\n    }\n    btn.disabled = true; btn.textContent = '添加中…';\n    try {\n      var res = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ employeeId: empId, name: name }) });\n      if (res.error) {\n        if (msg) msg.innerHTML = '<div class=\"error-msg\">' + esc(res.error) + '</div>';\n        btn.disabled = false; btn.textContent = '添加成员';\n        return;\n      }\n      if (msg) msg.innerHTML = '<div class=\"ok-msg\">已创建 ' + esc(res.user.employeeId) + '，默认密码=工号，首次登录后自行修改</div>';\n      document.getElementById('newEmpId').value = '';\n      document.getElementById('newUserName').value = '';\n      btn.disabled = false; btn.textContent = '添加成员';\n      renderDashboard(document.getElementById('app'));\n    } catch (e) {\n      if (msg) msg.innerHTML = '<div class=\"error-msg\">网络错误</div>';\n      btn.disabled = false; btn.textContent = '添加成员';\n    }\n  }\n\n  /* 我的待办（普通用户） */\n  if (!isAdmin) {\n    document.getElementById('topbarTitle').textContent = '我的待办';\n    var myTodos = await api('/api/my/todos');\n    var myList = myTodos.todos || [];\n    var myDone = myList.filter(function (x) { return x.done; }).length;\n    var myActive = myList.length - myDone;\n    var myGroups = QUADRANTS.map(function (q) {\n      var idxs = myList.map(function (x, ix) { return ix; }).filter(function (ix) { return (myList[ix].priority || 'P3') === q.key; });\n      if (idxs.length === 0) return '';\n      var listDone = idxs.filter(function (ix) { return myList[ix].done; }).length;\n      var rowsHtml = idxs.map(function (ix) { return renderTodoRow(myList[ix], ix, false); }).join('');\n      return '<div class=\"quadrant\"><div class=\"quadrant-head quadrant-' + q.key + '\"><div class=\"quadrant-title\">' + q.icon + ' ' + q.label + '</div><div class=\"quadrant-count\">' + (idxs.length - listDone) + ' 进行中 · ' + listDone + ' 已完成</div></div>' + rowsHtml + '</div>';\n    }).join('');\n    document.getElementById('body').innerHTML =\n      '<div class=\"page-title fade-up\">我的待办</div><div class=\"page-sub fade-up fade-up-1\">桌面端连接后自动同步</div>' +\n      '<div class=\"stats-grid\">' +\n        '<div class=\"stat-card fade-up fade-up-1\"><div class=\"stat-icon gray\">📋</div><div><div class=\"stat-num\">' + myList.length + '</div><div class=\"stat-label\">全部待办</div></div></div>' +\n        '<div class=\"stat-card fade-up fade-up-2\"><div class=\"stat-icon orange\">⏳</div><div><div class=\"stat-num\">' + myActive + '</div><div class=\"stat-label\">进行中</div></div></div>' +\n        '<div class=\"stat-card fade-up fade-up-3\"><div class=\"stat-icon green\">✅</div><div><div class=\"stat-num\">' + myDone + '</div><div class=\"stat-label\">已完成</div></div></div>' +\n      '</div>' +\n      '<div class=\"panel fade-up fade-up-2\"><div class=\"panel-head\"><div class=\"panel-title\">待办列表</div><div class=\"panel-count\"><button class=\"btn-ghost export-btn\">导出CSV</button></div></div>' + (myGroups || '<div class=\"empty\"><div class=\"empty-icon\">📋</div>暂无待办</div>') + '</div>';\n    bindTodoRows(myList);\n    var mb = document.querySelector('.export-btn');\n    if (mb) mb.onclick = function () { exportCsv(myList); };\n    return;\n  }\n\n  /* 待办总览（管理员） */\n  document.getElementById('topbarTitle').textContent = '待办总览';\n  var u = await api('/api/admin/users');\n  var t = await api('/api/admin/todos');\n  var todos = t.todos || [];\n  var done = todos.filter(function (x) { return x.done; }).length;\n  var active = todos.length - done;\n  var onlineMap = {};\n  for (var oi = 0; oi < (u.users || []).length; oi++) { onlineMap[u.users[oi].employeeId] = u.users[oi].online; }\n\n  var byUser = {};\n  for (var bi = 0; bi < todos.length; bi++) {\n    var eid = todos[bi].employeeId || 'unknown';\n    if (!byUser[eid]) byUser[eid] = [];\n    byUser[eid].push(bi);\n  }\n  var userIds = Object.keys(byUser).sort();\n  var groupsHtml = userIds.map(function (eid) {\n    var idxs = byUser[eid];\n    var expanded = expandedUsers[eid] !== false;\n    var userDone = idxs.filter(function (ix) { return todos[ix].done; }).length;\n    var userQuads = QUADRANTS.map(function (q) {\n      var list = idxs.filter(function (ix) { return (todos[ix].priority || 'P3') === q.key; });\n      if (list.length === 0) return '';\n      var listDone = list.filter(function (ix) { return todos[ix].done; }).length;\n      var rowsHtml = list.map(function (ix) { return renderTodoRow(todos[ix], ix, false); }).join('');\n      return '<div class=\"quadrant\"><div class=\"quadrant-head quadrant-' + q.key + '\"><div class=\"quadrant-title\">' + q.icon + ' ' + q.label + '</div><div class=\"quadrant-count\">' + (list.length - listDone) + ' 进行中 · ' + listDone + ' 已完成</div></div>' + rowsHtml + '</div>';\n    }).join('');\n    return '<div class=\"user-group\">' +\n      '<div class=\"user-group-head\" data-user=\"' + esc(eid) + '\">' +\n        '<div class=\"user-group-title\">' + (expanded ? '▾' : '▸') + ' <span class=\"online-dot ' + (onlineMap[eid] ? 'on' : 'off') + '\"></span><span class=\"user-group-avatar\">' + esc(eid.charAt(0).toUpperCase()) + '</span> ' + esc(eid) + '</div>' +\n        '<div class=\"user-group-count\">' + (idxs.length - userDone) + ' 进行中 · ' + userDone + ' 已完成</div>' +\n      '</div>' +\n      (expanded ? '<div class=\"user-group-body\">' + userQuads + '</div>' : '<div class=\"user-group-collapsed\"></div>') +\n    '</div>';\n  }).join('');\n\n  document.getElementById('body').innerHTML =\n    '<div class=\"page-title fade-up\">团队总览</div><div class=\"page-sub fade-up fade-up-1\">实时同步所有成员的待办状态</div>' +\n    '<div class=\"stats-grid\">' +\n      '<div class=\"stat-card fade-up fade-up-1\" data-go=\"members\"><div class=\"stat-icon blue\">👥</div><div><div class=\"stat-num\">' + (u.users || []).length + '</div><div class=\"stat-label\">成员</div></div></div>' +\n      '<div class=\"stat-card fade-up fade-up-2\"><div class=\"stat-icon gray\">📋</div><div><div class=\"stat-num\">' + todos.length + '</div><div class=\"stat-label\">待办总数</div></div></div>' +\n      '<div class=\"stat-card fade-up fade-up-3\"><div class=\"stat-icon orange\">⏳</div><div><div class=\"stat-num\">' + active + '</div><div class=\"stat-label\">进行中</div></div></div>' +\n      '<div class=\"stat-card fade-up fade-up-4\"><div class=\"stat-icon green\">✅</div><div><div class=\"stat-num\">' + done + '</div><div class=\"stat-label\">已完成</div></div></div>' +\n    '</div>' +\n    '<div class=\"panel fade-up fade-up-2\"><div class=\"panel-head\"><div class=\"panel-title\">待办列表</div><div class=\"panel-count\"><button class=\"btn-ghost export-btn\">导出CSV</button></div></div>' + (groupsHtml || '<div class=\"empty\"><div class=\"empty-icon\">📋</div>暂无待办</div>') + '</div>';\n\n  var memberCard = document.querySelector('[data-go=\"members\"]');\n  if (memberCard) memberCard.onclick = function () { currentTab = 'members'; renderDashboard(app); };\n  var eb = document.querySelector('.export-btn');\n  if (eb) eb.onclick = function () { exportCsv(todos); };\n\n  var heads = document.querySelectorAll('.user-group-head');\n  for (var h = 0; h < heads.length; h++) {\n    (function (head) {\n      head.onclick = function () {\n        var eid = head.getAttribute('data-user');\n        expandedUsers[eid] = expandedUsers[eid] === false;\n        renderDashboard(app);\n      };\n    })(heads[h]);\n  }\n\n  bindTodoRows(todos);\n}\n\nfunction bindTodoRows(todos) {\n  var rows = document.querySelectorAll('.todo-row');\n  for (var i = 0; i < rows.length; i++) {\n    rows[i].style.cursor = 'pointer';\n    (function (row) {\n      var idx = Number(row.getAttribute('data-idx'));\n      if (!Number.isFinite(idx)) idx = i;\n      row.onclick = function () { showTodoDetail(todos[idx]); };\n    })(rows[i]);\n  }\n}\n\n/* ===== 详情弹窗（含进展）===== */\nfunction showTodoDetail(t) {\n  if (!t) return;\n  var st = statusOf(t);\n  var stCls = statusCls(t);\n  var modal = document.createElement('div');\n  modal.className = 'modal-mask';\n  var card = document.createElement('div');\n  card.className = 'modal-card';\n  var progSections = '';\n  if (t.progressText) progSections += '<div class=\"modal-section green\"><span class=\"sec-label\">📝 本周进展</span>' + esc(t.progressText) + '</div>';\n  if (t.nextWeek) progSections += '<div class=\"modal-section blue\"><span class=\"sec-label\">🗓 下周计划</span>' + esc(t.nextWeek) + '</div>';\n  card.innerHTML =\n    '<div class=\"modal-title\">' + (t.done ? '✅ ' : '📋 ') + esc(t.text) + '</div>' +\n    '<div class=\"modal-row\"><span class=\"k\">项目</span><span class=\"v\">' + esc(t.project || '-') + '</span></div>' +\n    '<div class=\"modal-row\"><span class=\"k\">优先级</span><span class=\"v\">' + esc(t.priority || '-') + '</span></div>' +\n    '<div class=\"modal-row\"><span class=\"k\">负责人</span><span class=\"v\">' + esc(t.employeeId || '-') + '</span></div>' +\n    '<div class=\"modal-row\"><span class=\"k\">截止时间</span><span class=\"v\">' + (t.dueTime ? fmtFull(t.dueTime) : '-') + '</span></div>' +\n    '<div class=\"modal-row\"><span class=\"k\">状态</span><span class=\"v\"><span class=\"status-badge ' + stCls + '\">' + st + '</span></span></div>' +\n    progSections +\n    '<div class=\"modal-row\" style=\"margin-bottom:20px\"><span class=\"k\">更新时间</span><span class=\"v\">' + (t.updatedAt ? fmtFull(t.updatedAt) : '-') + '</span></div>' +\n    '<button class=\"btn-close\">关 闭</button>';\n  modal.appendChild(card);\n  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };\n  card.querySelector('.btn-close').onclick = function () { modal.remove(); };\n  document.body.appendChild(modal);\n}\n\n/* ===== 导出 CSV ===== */\nfunction exportCsv(todos) {\n  var csv = '\\uFEFF工号,项目,待办内容,优先级,状态,截止时间,本周进展,下周计划,更新时间\\n';\n  for (var i = 0; i < todos.length; i++) {\n    var t = todos[i];\n    csv += [\n      t.employeeId || '',\n      t.project || '',\n      (t.text || '').replace(/,/g, '，'),\n      t.priority || '',\n      t.done ? '已完成' : (t.status || '进行中'),\n      t.dueTime ? new Date(t.dueTime).toLocaleDateString() : '',\n      (t.progressText || '').replace(/,/g, '，').replace(/\\n/g, ' '),\n      (t.nextWeek || '').replace(/,/g, '，').replace(/\\n/g, ' '),\n      t.updatedAt ? new Date(t.updatedAt).toLocaleString() : ''\n    ].join(',') + '\\n';\n  }\n  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });\n  var url = URL.createObjectURL(blob);\n  var a = document.createElement('a');\n  a.href = url;\n  a.download = 'nexusdesk-todos-' + new Date().toISOString().slice(0, 10) + '.csv';\n  a.click();\n  URL.revokeObjectURL(url);\n}\n\nrender();\n";;;;;;;;;;;;
