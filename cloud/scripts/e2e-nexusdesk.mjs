/**
 * NexusDesk 全链路端到端测试（真实线上环境）
 *
 * 覆盖：管理员建号 → 新用户默认密码登录 → 首次强制改密 → 新密码登录 →
 *       待办 create/update/complete/delete 同步 → 我的待办/管理总览 →
 *       权限隔离（401/403）→ 重复工号 409 → WebSocket 鉴权与实时推送 → presence 兼容
 *
 * 用法：cd cloud && node scripts/e2e-nexusdesk.mjs
 * 说明：会向线上 D1 插入临时测试账号（e2eadmin / e2euser01），跑完自动清理。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOUD_DIR = path.resolve(__dirname, '..');
const WRANGLER = path.join(CLOUD_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const BASE = 'https://nexusdesk.dpdns.org';
const WS_BASE = 'wss://nexusdesk.dpdns.org/ws';

const ADMIN_ID = 'e2eadmin';
const ADMIN_PW = 'e2e-admin-pw-9';
const MEMBER_ID = 'e2euser01';
const MEMBER_NAME = 'E2E成员01';
const MEMBER_PW2 = 'e2e-user-new-1';
const TODO_ID = 'e2e-todo-001';

const results = [];
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  return (async () => {
    const started = Date.now();
    try {
      await fn();
      passCount += 1;
      results.push({ name, ok: true, ms: Date.now() - started });
    } catch (e) {
      failCount += 1;
      results.push({ name, ok: false, ms: Date.now() - started, error: e.message || String(e) });
    }
  })();
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function d1(sql) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'nexusdesk-db', '--remote', '--command', sql], {
        cwd: CLOUD_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      lastErr = e;
      // wrangler CLI 对 Cloudflare API 偶发瞬时 "fetch failed"，退避后重试
      const waitMs = attempt * 1500;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
  throw lastErr;
}

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(BASE + pathname, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch { /* 非 JSON 响应 */ }
      return { status: res.status, data };
    } catch (e) {
      lastErr = e;
      // 线上网络偶发瞬时抖动（fetch failed），退避后重试
      await new Promise((r) => setTimeout(r, attempt * 1200));
    }
  }
  throw lastErr;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function openWs(token, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = WS_BASE + '?token=' + encodeURIComponent(token);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve({ ok: false, reason: '构造失败: ' + e.message });
      return;
    }
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ ok: false, reason: '超时未建立连接' });
    }, timeoutMs);
    ws.onopen = () => { clearTimeout(timer); resolve({ ok: true, ws }); };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (!resolve.called) {
        resolve.called = true;
        resolve({ ok: false, reason: '连接被关闭 code=' + (ev.code ?? '?') + (ev.reason ? ' ' + ev.reason : '') });
      }
    };
  });
}

function wsWaitMessage(ws, predicate, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    function onMsg(ev) {
      (async () => {
        let text = ev.data;
        if (typeof text !== 'string') {
          try { text = await ev.data.text(); } catch { text = ''; }
        }
        let parsed = null;
        try { parsed = JSON.parse(text); } catch {}
        if (!predicate || predicate(parsed, text)) {
          cleanup();
          resolve(parsed || text);
        }
      })();
    }
    function onClose() { cleanup(); resolve(null); }
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      ws.removeEventListener('close', onClose);
    }
    ws.addEventListener('message', onMsg);
    ws.addEventListener('close', onClose);
  });
}

// ---------- 前置：健康检查预检（带重试） ----------
async function preflight() {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(BASE + '/health', { method: 'GET' });
      if (res.status === 200) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('健康检查预检失败: ' + (lastErr ? lastErr.message : '非 200'));
}

// ---------- 前置：清理可能残留的旧测试数据，并插入临时管理员 ----------
async function setup() {
  const cleanSql = `DELETE FROM todos WHERE employee_id IN ('${ADMIN_ID}','${MEMBER_ID}');
    DELETE FROM sessions WHERE employee_id IN ('${ADMIN_ID}','${MEMBER_ID}');
    DELETE FROM users WHERE employee_id IN ('${ADMIN_ID}','${MEMBER_ID}');`;
  d1(cleanSql);
  const adminHash = await sha256Hex(`${ADMIN_ID}:${ADMIN_PW}`);
  d1(`INSERT INTO users (employee_id, name, role, password_hash, must_change_password, created_at)
      VALUES ('${ADMIN_ID}', 'E2E管理员', 'admin', '${adminHash}', 0, ${Date.now()});`);
}

// ---------- 清理：删除测试数据 ----------
function teardown() {
  const sql = `DELETE FROM todos WHERE employee_id IN ('${ADMIN_ID}','${MEMBER_ID}');
    DELETE FROM sessions WHERE employee_id IN ('${ADMIN_ID}','${MEMBER_ID}');
    DELETE FROM users WHERE employee_id IN ('${ADMIN_ID}','${MEMBER_ID}');`;
  d1(sql);
}

// ================= 测试流程 =================
await preflight();
await setup();

let adminToken = '';
let memberToken = '';

await test('管理员登录（新密码）', async () => {
  const r = await api('/api/login', { method: 'POST', body: { employeeId: ADMIN_ID, password: ADMIN_PW } });
  assert(r.status === 200, '状态码应为 200，实际 ' + r.status);
  assert(r.data && r.data.token, '应返回 token');
  assert(r.data.user.role === 'admin', '角色应为 admin');
  assert(r.data.user.mustChangePassword === false, '管理员不应要求改密');
  adminToken = r.data.token;
});

await test('管理员建号：正常创建成员', async () => {
  const r = await api('/api/admin/users', { method: 'POST', token: adminToken, body: { employeeId: MEMBER_ID, name: MEMBER_NAME } });
  assert(r.status === 200, '状态码应为 200，实际 ' + r.status);
  assert(r.data.ok === true, '应返回 ok');
  assert(r.data.user.employeeId === MEMBER_ID, '应返回新成员工号');
});

await test('管理员建号：重复工号返回 409', async () => {
  const r = await api('/api/admin/users', { method: 'POST', token: adminToken, body: { employeeId: MEMBER_ID, name: '重复' } });
  assert(r.status === 409, '状态码应为 409，实际 ' + r.status);
});

await test('新成员默认密码登录（密码=工号）且必须改密', async () => {
  const r = await api('/api/login', { method: 'POST', body: { employeeId: MEMBER_ID, password: MEMBER_ID } });
  assert(r.status === 200, '默认密码应可登录，实际 ' + r.status);
  assert(r.data.user.mustChangePassword === true, '首次登录应要求改密');
});

await test('错误密码登录被拒绝', async () => {
  const r = await api('/api/login', { method: 'POST', body: { employeeId: MEMBER_ID, password: 'wrong-password' } });
  assert(r.status === 401, '状态码应为 401，实际 ' + r.status);
});

await test('首次强制改密', async () => {
  const login = await api('/api/login', { method: 'POST', body: { employeeId: MEMBER_ID, password: MEMBER_ID } });
  const token = login.data.token;
  const r = await api('/api/change-password', { method: 'POST', token, body: { oldPassword: MEMBER_ID, newPassword: MEMBER_PW2 } });
  assert(r.status === 200, '改密应成功，实际 ' + r.status + ' ' + JSON.stringify(r.data));
});

await test('新密码登录且不再要求改密', async () => {
  const r = await api('/api/login', { method: 'POST', body: { employeeId: MEMBER_ID, password: MEMBER_PW2 } });
  assert(r.status === 200, '新密码应可登录，实际 ' + r.status);
  assert(r.data.user.mustChangePassword === false, '改密后不应再要求改密');
  memberToken = r.data.token;
});

await test('改密后旧密码（工号）不可再登录', async () => {
  const r = await api('/api/login', { method: 'POST', body: { employeeId: MEMBER_ID, password: MEMBER_ID } });
  assert(r.status === 401, '状态码应为 401，实际 ' + r.status);
});

await test('/api/me 返回当前用户', async () => {
  const r = await api('/api/me', { token: memberToken });
  assert(r.status === 200 && r.data.employeeId === MEMBER_ID, '应返回当前用户信息');
});

await test('待办 create 同步', async () => {
  const r = await api('/api/todo/sync', {
    method: 'POST', token: memberToken,
    body: { todoId: TODO_ID, action: 'create', clientUpdatedAt: Date.now(), text: 'E2E 测试待办', project: 'E2E项目', priority: 'P1', done: false, dueTime: '2026-09-30T12:00:00.000Z', status: '进行中', progressText: '本周完成初版', nextWeek: '下周联调' },
  });
  assert(r.status === 200 && r.data.ok === true, 'create 应成功，实际 ' + r.status + ' ' + JSON.stringify(r.data));
});

await test('我的待办查询包含新建待办', async () => {
  const r = await api('/api/my/todos', { token: memberToken });
  assert(r.status === 200, '查询应成功');
  const t = (r.data.todos || []).find((x) => x.todoId === TODO_ID);
  assert(!!t, '应能找到 e2e-todo-001');
  assert(t.text === 'E2E 测试待办', '文本应一致');
  assert(t.priority === 'P1', '优先级应一致');
  assert(t.project === 'E2E项目', '项目应一致');
  assert(t.status === '进行中', '状态应一致');
});

await test('待办 update 同步', async () => {
  const r = await api('/api/todo/sync', {
    method: 'POST', token: memberToken,
    body: { todoId: TODO_ID, action: 'update', clientUpdatedAt: Date.now(), text: 'E2E 测试待办（已更新）', project: 'E2E项目', priority: 'P2', done: false, status: '延期' },
  });
  assert(r.status === 200 && r.data.ok === true, 'update 应成功');
  const q = await api('/api/my/todos', { token: memberToken });
  const t = (q.data.todos || []).find((x) => x.todoId === TODO_ID);
  assert(t && t.text === 'E2E 测试待办（已更新）' && t.priority === 'P2' && t.status === '延期', '更新应生效');
});

await test('待办 complete 同步', async () => {
  const r = await api('/api/todo/sync', { method: 'POST', token: memberToken, body: { todoId: TODO_ID, action: 'complete', clientUpdatedAt: Date.now(), done: true, status: '已完成' } });
  assert(r.status === 200 && r.data.ok === true, 'complete 应成功');
  const q = await api('/api/my/todos', { token: memberToken });
  const t = (q.data.todos || []).find((x) => x.todoId === TODO_ID);
  assert(t && t.done === true && t.status === '已完成', '完成状态应生效');
});

await test('管理总览可见成员待办', async () => {
  const r = await api('/api/admin/todos', { token: adminToken });
  assert(r.status === 200, '管理员查询应成功');
  const t = (r.data.todos || []).find((x) => x.todoId === TODO_ID && x.employeeId === MEMBER_ID);
  assert(!!t, '管理总览应包含成员待办');
});

await test('管理总览成员列表包含新成员', async () => {
  const r = await api('/api/admin/users', { token: adminToken });
  assert(r.status === 200, '成员列表应成功');
  const u = (r.data.users || []).find((x) => x.employeeId === MEMBER_ID);
  assert(!!u && u.role === 'user', '应包含新成员');
});

await test('权限隔离：普通成员不能访问管理接口', async () => {
  const r = await api('/api/admin/users', { token: memberToken });
  assert(r.status === 403, '状态码应为 403，实际 ' + r.status);
});

await test('未登录访问受保护接口返回 401', async () => {
  const r = await api('/api/my/todos');
  assert(r.status === 401, '状态码应为 401，实际 ' + r.status);
});

await test('待办 delete 同步', async () => {
  const r = await api('/api/todo/sync', { method: 'POST', token: memberToken, body: { todoId: TODO_ID, action: 'delete', clientUpdatedAt: Date.now() } });
  assert(r.status === 200 && r.data.ok === true, 'delete 应成功');
  const q = await api('/api/my/todos', { token: memberToken });
  assert(!(q.data.todos || []).some((x) => x.todoId === TODO_ID), '删除后应查不到');
});

await test('WebSocket：有效 token 可连接并收到实时推送', async () => {
  const conn = await openWs(memberToken);
  assert(conn.ok, '连接应建立: ' + conn.reason);
  const ws = conn.ws;
  const waitMsg = wsWaitMessage(ws, (m) => m && m.event === 'todo.create');
  const r = await api('/api/todo/sync', {
    method: 'POST', token: memberToken,
    body: { todoId: 'e2e-todo-ws', action: 'create', clientUpdatedAt: Date.now(), text: 'WS 实时推送待办', priority: 'P3', done: false },
  });
  assert(r.status === 200, 'HTTP create 应成功');
  const msg = await waitMsg;
  assert(!!msg, '应收到 todo.create 推送');
  assert(msg.todoId === 'e2e-todo-ws', '推送应包含正确 todoId');
  ws.close();
});

await test('WebSocket：无效 token 被拒绝', async () => {
  const conn = await openWs('invalid-token-xyz');
  assert(!conn.ok, '无效 token 不应建立连接');
});

await test('presence 兼容接口仍可用（仅内存，零 DB 写入）', async () => {
  const r = await api('/api/presence', { method: 'POST', token: memberToken });
  assert(r.status === 200, 'presence 应返回 200，实际 ' + r.status);
});

// ---------- 清理 ----------
teardown();

// ================= 报告 =================
console.log('\n========== NexusDesk 全链路 e2e 结果 ==========');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms}ms)${r.error ? '  → ' + r.error : ''}`);
}
console.log(`\n通过 ${passCount} / ${failCount + passCount}`);
process.exitCode = failCount > 0 ? 1 : 0;
