/**
 * NexusDesk 云同步服务（桌面端）
 */

const SYNC_CONFIG_KEY = 'nexusdesk-sync-config';
const DEFAULT_API_URL = 'https://nexusdesk.dpdns.org';
const DEFAULT_WS_URL = 'wss://nexusdesk.dpdns.org/ws';

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const statusListeners = new Set();
let onRemoteTodoChange = null;

function getSyncConfig() {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) return { enabled: false, apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, employeeId: '', token: '', mustChangePassword: false };
    const p = JSON.parse(raw);
    if (Object.prototype.hasOwnProperty.call(p, 'password')) {
      delete p.password;
      localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(p));
    }
    return {
      enabled: p.enabled === true,
      apiUrl: p.apiUrl || DEFAULT_API_URL,
      wsUrl: p.wsUrl || DEFAULT_WS_URL,
      employeeId: String(p.employeeId || ''),
      token: String(p.token || ''),
      mustChangePassword: p.mustChangePassword === true,
    };
  } catch {
    return { enabled: false, apiUrl: DEFAULT_API_URL, wsUrl: DEFAULT_WS_URL, employeeId: '', token: '', mustChangePassword: false };
  }
}

function saveSyncConfig(config) {
  const next = { ...getSyncConfig(), ...config };
  delete next.password;
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(next));
  return next;
}

async function login(employeeId, password) {
  const cfg = getSyncConfig();
  const res = await fetch(cfg.apiUrl + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, password }),
  });
  const data = await res.json();
  if (!res.ok || data.error || !data.token || !data.user) throw new Error(data.error || '登录失败');
  saveSyncConfig({ employeeId, token: data.token, mustChangePassword: data.user.mustChangePassword });
  return data.user;
}

async function changePassword(oldPassword, newPassword) {
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
  ws.onopen = () => { reconnectDelay = 1000; notifyStatus(); };
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

function logout() {
  disconnect();
  saveSyncConfig({ token: '', mustChangePassword: false });
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
  const cfg = getSyncConfig();
  if (!cfg.token) return;
  try {
    await fetch(cfg.apiUrl + '/api/todo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.token },
      body: JSON.stringify({ todoId, action, clientUpdatedAt: Date.now(), ...data }),
    });
  } catch (e) {}
}

function syncWeekKey(value = Date.now()) {
  const date = new Date(value);
  const day = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.toISOString().slice(0, 10);
}

function getTodoStatus(t, priority) {
  try {
    const raw = localStorage.getItem('notch-todo-progress-v1');
    if (!raw) return '';
    const tp = JSON.parse(raw);
    const key = syncWeekKey();
    return tp?.[key]?.[t.id]?.status || '';
  } catch (e) { return ''; }
}

function getTodoProgressDetail(t, priority) {
  try {
    const raw = localStorage.getItem('notch-todo-progress-v1');
    if (!raw) return {};
    const tp = JSON.parse(raw);
    const key = syncWeekKey();
    const rec = tp?.[key]?.[t.id];
    return rec ? { status: rec.status || '', progressText: rec.progress || '', nextWeek: rec.nextWeek || '' } : {};
  } catch (e) { return {}; }
}

function reportTodoCreated(t, priority) {
  const detail = getTodoProgressDetail(t, priority);
  return reportTodo('create', t.id, { text: t.text, project: t.project, priority: priority || t.priority || 'P3', done: t.done, dueTime: t.deadline, status: getTodoStatus(t, priority), progressText: detail.progressText || '', nextWeek: detail.nextWeek || '' });
}
function reportTodoUpdated(t, priority) {
  const detail = getTodoProgressDetail(t, priority);
  return reportTodo('update', t.id, { text: t.text, project: t.project, priority: priority || t.priority || 'P3', done: t.done, dueTime: t.deadline, status: getTodoStatus(t, priority), progressText: detail.progressText || '', nextWeek: detail.nextWeek || '' });
}
function reportTodoCompleted(t, priority) { return reportTodo('complete', t.id, { text: t.text, project: t.project, priority: priority || t.priority || 'P3', done: true, dueTime: t.deadline, status: '已完成' }); }
function reportTodoDeleted(id) { return reportTodo('delete', id, {}); }

function initSync() {
  const cfg = getSyncConfig();
  if (cfg.enabled && cfg.token) connect();
}

if (typeof window !== 'undefined') {
  window.NexusDeskSync = {
    getSyncConfig, saveSyncConfig, getConnectionStatus, onStatusChange,
    connect, disconnect, logout, login, changePassword, isLoggedIn, getCurrentUser,
    setRemoteTodoHandler, reportTodoCreated, reportTodoUpdated, reportTodoCompleted,
    reportTodoDeleted, initSync, syncAllTodos, DEFAULT_API_URL, DEFAULT_WS_URL,
  };
}

function syncAllTodos() {
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
    for (var k = 0; k < total; k++) {
      var item = allTodos[k];
      var detail = getTodoProgressDetail(item.t, item.priority);
      reportTodo('create', item.t.id, {
        text: item.t.text || '',
        project: item.t.project || '',
        priority: item.priority,
        done: item.t.done || false,
        dueTime: item.t.deadline || null,
        status: item.t.done ? '已完成' : (detail.status || ''),
        progressText: detail.progressText || '',
        nextWeek: detail.nextWeek || '',
      });
      done++;
      if (cloudEl) {
        cloudEl.textContent = '同步中 ' + done + '/' + total;
        cloudEl.style.color = '#ff9500';
      }
    }
    if (cloudEl) {
      cloudEl.textContent = '同步完成 (' + total + '条)';
      cloudEl.style.color = '#34c759';
    }
  } catch (e) {}
}
