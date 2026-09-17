/**
 * NexusDesk 云同步服务（桌面端）
 */

const SYNC_CONFIG_KEY = 'nexusdesk-sync-config';
const DELETE_OUTBOX_KEY = 'nexusdesk-todo-delete-outbox-v1';
const DEFAULT_API_URL = 'https://nexusdesk.dpdns.org';
const DEFAULT_WS_URL = 'wss://nexusdesk.dpdns.org/ws';

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const statusListeners = new Set();
let onRemoteTodoChange = null;
let secureAuth = { employeeId: '', token: '' };
let secureAuthReady = Promise.resolve();

function readStoredSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function loadSecureAuth() {
  const stored = readStoredSyncConfig();
  try {
    const auth = await window.notchAPI?.getSyncAuth?.();
    secureAuth = {
      employeeId: String(auth?.employeeId || ''),
      token: String(auth?.token || ''),
    };
    // Migrate credentials written by older versions, then remove the plaintext copy.
    if (!secureAuth.token && stored.token) {
      const migrated = await window.notchAPI?.setSyncAuth?.({
        employeeId: String(stored.employeeId || ''),
        token: String(stored.token || ''),
      });
      if (migrated?.ok) {
        secureAuth = { employeeId: String(stored.employeeId || ''), token: String(stored.token || '') };
      }
    }
  } catch (error) {
    secureAuth = { employeeId: '', token: '' };
  }
  if (Object.prototype.hasOwnProperty.call(stored, 'token')) {
    delete stored.token;
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(stored));
  }
  return secureAuth;
}

function ensureSecureAuthLoaded() {
  return secureAuthReady;
}

function getSyncConfig() {
  try {
    const p = readStoredSyncConfig();
    if (Object.prototype.hasOwnProperty.call(p, 'password') || Object.prototype.hasOwnProperty.call(p, 'token')) {
      delete p.password;
      delete p.token;
      localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(p));
    }
    return {
      enabled: p.enabled === true,
      apiUrl: p.apiUrl || DEFAULT_API_URL,
      wsUrl: p.wsUrl || DEFAULT_WS_URL,
      employeeId: String(p.employeeId || secureAuth.employeeId || ''),
      token: secureAuth.token,
      mustChangePassword: p.mustChangePassword === true,
    };
  } catch {
    return { enabled: false, apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, employeeId: '', token: '', mustChangePassword: false };
  }
}

function saveSyncConfig(config) {
  const next = { ...getSyncConfig(), ...config };
  delete next.password;
  delete next.token;
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(next));
  return next;
}

async function login(employeeId, password) {
  await ensureSecureAuthLoaded();
  const cfg = getSyncConfig();
  const res = await fetch(cfg.apiUrl + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, password }),
  });
  const data = await res.json();
  if (!res.ok || data.error || !data.token || !data.user) throw new Error(data.error || '登录失败');
  const stored = await window.notchAPI?.setSyncAuth?.({ employeeId, token: data.token });
  if (!stored?.ok) throw new Error('安全存储不可用，无法保存登录状态');
  secureAuth = { employeeId: String(employeeId), token: String(data.token) };
  saveSyncConfig({ employeeId, mustChangePassword: data.user.mustChangePassword });
  return data.user;
}

async function changePassword(oldPassword, newPassword) {
  await ensureSecureAuthLoaded();
  const cfg = getSyncConfig();
  if (!cfg.token) throw new Error('Not logged in');
  const res = await fetch(cfg.apiUrl + '/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.token },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '修改密码失败');
  saveSyncConfig({ mustChangePassword: false });
  return true;
}

function isLoggedIn() {
  const cfg = getSyncConfig();
  return !!(cfg.token && cfg.employeeId);
}

function getCurrentUser() {
  return getSyncConfig().employeeId || '';
}

function getConnectionStatus() {
  if (!ws) return 'disconnected';
  switch (ws.readyState) {
    case WebSocket.OPEN: return 'connected';
    case WebSocket.CONNECTING: return 'connecting';
    case WebSocket.CLOSING: return 'closing';
    default: return 'disconnected';
  }
}

function onStatusChange(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function notifyStatus() {
  const s = getConnectionStatus();
  for (const fn of statusListeners) { try { fn(s); } catch (e) {} }
}

async function connect() {
  await ensureSecureAuthLoaded();
  const cfg = getSyncConfig();
  if (!cfg.enabled || !cfg.token) return { ok: false, error: 'not_logged_in' };
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return { ok: true, status: getConnectionStatus() };
  }
  clearTimeout(reconnectTimer);
  const url = cfg.wsUrl + '?token=' + encodeURIComponent(cfg.token);
  try {
    ws = new WebSocket(url);
  } catch (e) {
    scheduleReconnect();
    return { ok: false, error: String(e) };
  }
  ws.onopen = () => {
    reconnectDelay = 1000;
    notifyStatus();
    void flushTodoDeleteOutbox();
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (onRemoteTodoChange && msg.event && msg.todoId) onRemoteTodoChange(msg);
    } catch (e) {}
  };
  ws.onclose = () => { ws = null; notifyStatus(); scheduleReconnect(); };
  ws.onerror = () => {};
  notifyStatus();
  return { ok: true, status: 'connecting' };
}

function disconnect() {
  clearTimeout(reconnectTimer);
  if (ws) { ws.onclose = null; ws.close(); ws = null; notifyStatus(); }
}

async function logout() {
  disconnect();
  secureAuth = { employeeId: '', token: '' };
  await window.notchAPI?.setSyncAuth?.({ employeeId: '', token: '' });
  saveSyncConfig({ employeeId: '', mustChangePassword: false });
}

function scheduleReconnect() {
  const cfg = getSyncConfig();
  if (!cfg.enabled) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connect();
  }, reconnectDelay);
}

function setRemoteTodoHandler(handler) { onRemoteTodoChange = handler; }

async function reportTodo(action, todoId, data) {
  await ensureSecureAuthLoaded();
  const cfg = getSyncConfig();
  if (!cfg.token) return false;
  try {
    const response = await fetch(cfg.apiUrl + '/api/todo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.token },
      body: JSON.stringify({ todoId, action, clientUpdatedAt: Date.now(), ...data }),
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}

function loadTodoDeleteOutbox() {
  try {
    return window.NotchDomain.normalizeTodoDeleteOutbox(
      JSON.parse(localStorage.getItem(DELETE_OUTBOX_KEY) || 'null')
    );
  } catch (error) {
    return [];
  }
}

function saveTodoDeleteOutbox(outbox) {
  try {
    localStorage.setItem(DELETE_OUTBOX_KEY, JSON.stringify(outbox));
  } catch (error) {}
}

async function reportTodoDeleted(id) {
  await ensureSecureAuthLoaded();
  const cfg = getSyncConfig();
  const todoId = String(id || '').trim();
  if (!todoId || !cfg.employeeId) return false;
  let outbox = window.NotchDomain.enqueueTodoDelete(
    loadTodoDeleteOutbox(), todoId, cfg.employeeId
  );
  saveTodoDeleteOutbox(outbox);
  const sent = await reportTodo('delete', todoId, {});
  if (!sent) return false;
  outbox = window.NotchDomain.acknowledgeTodoDelete(outbox, todoId, cfg.employeeId);
  saveTodoDeleteOutbox(outbox);
  return true;
}

async function flushTodoDeleteOutbox() {
  await ensureSecureAuthLoaded();
  const cfg = getSyncConfig();
  if (!cfg.token || !cfg.employeeId) return;
  let outbox = loadTodoDeleteOutbox();
  for (const entry of outbox.filter((item) => item.employeeId === cfg.employeeId)) {
    if (!await reportTodo('delete', entry.todoId, {})) continue;
    outbox = window.NotchDomain.acknowledgeTodoDelete(outbox, entry.todoId, entry.employeeId);
    saveTodoDeleteOutbox(outbox);
  }
}

function getTodoStatus(t, priority) {
  try {
    const raw = localStorage.getItem('notch-todo-progress-v1');
    if (!raw) return '';
    const tp = JSON.parse(raw);
    const key = window.NotchDomain.localWeekKey();
    return tp?.[key]?.[t.id]?.status || '';
  } catch (e) { return ''; }
}

function getTodoProgressDetail(t, priority) {
  try {
    const raw = localStorage.getItem('notch-todo-progress-v1');
    if (!raw) return {};
    const tp = JSON.parse(raw);
    const key = window.NotchDomain.localWeekKey();
    const rec = tp?.[key]?.[t.id];
    return rec ? { status: rec.status || '', progressText: rec.progress || '', nextWeek: rec.nextWeek || '' } : {};
  } catch (e) { return {}; }
}

function buildTodoSyncPayload(todo, priority, overrides = {}) {
  const detail = getTodoProgressDetail(todo, priority);
  return {
    text: todo.text || '',
    project: todo.project || '',
    priority: priority || todo.priority || 'P3',
    done: todo.done === true,
    dueTime: todo.deadline || null,
    status: getTodoStatus(todo, priority),
    progressText: detail.progressText || '',
    nextWeek: detail.nextWeek || '',
    ...overrides,
  };
}

function reportTodoCreated(t, priority) {
  return reportTodo('create', t.id, buildTodoSyncPayload(t, priority));
}
function reportTodoUpdated(t, priority) {
  return reportTodo('update', t.id, buildTodoSyncPayload(t, priority));
}
function reportTodoCompleted(t, priority) {
  return reportTodo('complete', t.id, buildTodoSyncPayload(t, priority, { done: true, status: '已完成' }));
}
async function initSync() {
  await ensureSecureAuthLoaded();
  notifyStatus();
  const cfg = getSyncConfig();
  if (cfg.enabled && cfg.token) {
    await flushTodoDeleteOutbox();
    await connect();
  }
}

secureAuthReady = loadSecureAuth();

if (typeof window !== 'undefined') {
  window.NexusDeskSync = {
    getSyncConfig, saveSyncConfig, getConnectionStatus, onStatusChange,
    connect, disconnect, logout, login, changePassword, isLoggedIn, getCurrentUser,
    setRemoteTodoHandler, reportTodoCreated, reportTodoUpdated, reportTodoCompleted,
    reportTodoDeleted, initSync, syncAllTodos, DEFAULT_API_URL, DEFAULT_WS_URL,
  };
}

async function syncAllTodos() {
  try {
    var raw = localStorage.getItem('notch-todo-data');
    if (!raw) return;
    var data = JSON.parse(raw);
    var priorities = ['P0', 'P1', 'P2', 'P3'];
    var allTodos = [];
    for (var i = 0; i < priorities.length; i++) {
      var p = priorities[i];
      var list = data[p] || [];
      for (var j = 0; j < list.length; j++) {
        allTodos.push({ t: list[j], priority: p });
      }
    }
    var total = allTodos.length;
    if (total === 0) return;

    var cloudEl = document.getElementById('nexusdesk-cloud-status');
    var done = 0;
    var failed = 0;
    for (var k = 0; k < total; k++) {
      var item = allTodos[k];
      var sent = await reportTodo(
        'create',
        item.t.id,
        buildTodoSyncPayload(item.t, item.priority, item.t.done ? { status: '已完成' } : {})
      );
      if (!sent) failed++;
      done++;
      if (cloudEl) {
        cloudEl.textContent = '同步中 ' + done + '/' + total;
        cloudEl.style.color = '#ff9500';
      }
    }
    if (cloudEl) {
      cloudEl.textContent = failed
        ? '同步完成，失败 ' + failed + ' 条'
        : '同步完成 (' + total + '条)';
      cloudEl.style.color = failed ? '#ff3b30' : '#34c759';
    }
    return { total: total, failed: failed };
  } catch (e) {
    return { total: 0, failed: 0, error: String(e) };
  }
}
