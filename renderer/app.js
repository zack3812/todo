const STORAGE_KEY = 'notch-todo-data';
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TODO_CATEGORY_KEY = 'notch-todo-category-names-v1';
const TODO_PROGRESS_KEY = 'notch-todo-progress-v1';
const TODO_WEEKLY_SUMMARY_KEY = 'notch-todo-weekly-summaries-v1';
// 用户手动拖放后每列的显示顺序（id 数组）。独立于 notch-todo-data 存储，
// 只记录「用户拖过」的列；未拖过的列仍按 deadline 排序。
const TODO_ORDER_KEY = 'notch-todo-order-v1';
const TODO_HISTORY_KEY = 'notch-todo-history-v1';
const TODO_CATEGORY_DEFAULTS = {
  P0: '重要且紧急',
  P1: '重要不紧急',
  P2: '紧急不重要',
  P3: '不重要不紧急',
};

const app = document.getElementById('app');
const notch = document.getElementById('notch');
const panel = document.getElementById('panel');
const statusToast = document.getElementById('status-toast');
const statusToastMessage = document.getElementById('status-toast-message');
const statusToastAction = document.getElementById('status-toast-action');

function collectLocalStorageSnapshot() {
  const result = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) result[key] = localStorage.getItem(key);
  }
  return result;
}

let workspaceReloadPending = false;
async function hydratePortableWorkspace() {
  if (!window.notchAPI?.loadWorkspaceData) return;
  try {
    const snapshot = await window.notchAPI.loadWorkspaceData();
    let imported = false;
    if (sessionStorage.getItem('notch-workspace-hydrated') !== '1' && snapshot && typeof snapshot === 'object') {
      Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string' && localStorage.getItem(key) === null) {
          localStorage.setItem(key, value);
          imported = true;
        }
      });
      sessionStorage.setItem('notch-workspace-hydrated', '1');
    }
    if (imported) {
      // The current editors were initialized before the asynchronous import.
      // Their unload/visibility handlers must not overwrite recovered values.
      workspaceReloadPending = true;
      location.reload();
      return;
    }
let lastWorkspaceSnapshotJson = '';
    setInterval(() => {
      const snap = collectLocalStorageSnapshot();
      let json;
      try { json = JSON.stringify(snap); } catch (error) { return; }
      if (json === lastWorkspaceSnapshotJson) return;
      lastWorkspaceSnapshotJson = json;
      window.notchAPI.saveWorkspaceData(snap).catch(() => {});
    }, 3000);
  } catch (error) {}
}

function initNexusDeskSync() {
  if (!window.NexusDeskSync) return;
  window.NexusDeskSync.setRemoteTodoHandler(handleRemoteTodoChange);
  window.NexusDeskSync.initSync();
}

// Do not interrupt parser-loaded workspace scripts with a recovery navigation.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    hydratePortableWorkspace();
    initNexusDeskSync();
  }, { once: true });
} else {
  hydratePortableWorkspace();
  initNexusDeskSync();
}
window.notchAPI?.onWorkspaceChanged?.(() => {
  sessionStorage.removeItem('notch-workspace-hydrated');
  window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).finally(() => location.reload());
});

let statusToastTimer = null;
let statusToastHideTimer = null;
let statusToastActionHandler = null;
let statusToastExpireHandler = null;

function dismissStatusToast(commitPending = true) {
  if (statusToastTimer) clearTimeout(statusToastTimer);
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastTimer = null;
  statusToastHideTimer = null;
  const onExpire = statusToastExpireHandler;
  statusToastExpireHandler = null;
  statusToastActionHandler = null;
  const actionHadFocus = statusToastAction === document.activeElement;
  if (actionHadFocus) {
    const activeTabButton = document.querySelector('.tab.active');
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  if (statusToast) {
    statusToast.classList.remove('visible');
    statusToast.setAttribute('aria-hidden', 'true');
  }
  if (statusToastAction) statusToastAction.hidden = true;
  statusToastHideTimer = setTimeout(() => {
    statusToastHideTimer = null;
    if (statusToast) statusToast.hidden = true;
    if (statusToastMessage) statusToastMessage.textContent = '';
  }, 180);
  if (commitPending && onExpire) onExpire();
}

function showStatusToast(message, options = {}) {
  dismissStatusToast(true);
  if (!statusToast || !statusToastMessage) return;
  const { actionLabel, onAction, onExpire, duration = 1800 } = options;
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastHideTimer = null;
  statusToast.hidden = false;
  statusToast.setAttribute('aria-hidden', 'false');
  statusToastMessage.textContent = message;
  statusToastActionHandler = typeof onAction === 'function' ? onAction : null;
  statusToastExpireHandler = typeof onExpire === 'function' ? onExpire : null;
  if (statusToastAction && statusToastActionHandler) {
    statusToastAction.textContent = actionLabel || '撤销';
    statusToastAction.hidden = false;
  }
  statusToast.classList.add('visible');
  statusToastTimer = setTimeout(() => dismissStatusToast(true), duration);
}

if (statusToastAction) {
  statusToastAction.addEventListener('click', () => {
    const handler = statusToastActionHandler;
    dismissStatusToast(false);
    if (handler) handler();
  });
}

window.addEventListener('beforeunload', () => dismissStatusToast(true));

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { P0: [], P1: [], P2: [], P3: [] };
    const parsed = JSON.parse(raw);
    return {
      P0: normalizeTodoItems(parsed && parsed.P0),
      P1: normalizeTodoItems(parsed && parsed.P1),
      P2: normalizeTodoItems(parsed && parsed.P2),
      P3: normalizeTodoItems(parsed && parsed.P3),
    };
  } catch (e) {
    return { P0: [], P1: [], P2: [], P3: [] };
  }
}

function normalizeTodoItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text
          ? { id: generateId(), text, done: false, createdAt: Date.now() }
          : null;
      }
      if (!item || typeof item !== 'object' || typeof item.text !== 'string') return null;
      const text = item.text.trim();
      if (!text) return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : generateId(),
        text,
        done: item.done === true,
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        deadline: Number.isFinite(Date.parse(String(item.deadline || '')))
          ? new Date(Date.parse(String(item.deadline))).toISOString()
          : '',
        remindedAt: Math.max(0, Number(item.remindedAt) || 0),
        completedAt: typeof item.completedAt === 'string' && item.completedAt ? item.completedAt : '',
        project: typeof item.project === 'string' ? item.project.trim().slice(0, 24) : '',
      };
    })
    .filter(Boolean);
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // ignore quota errors
  }
  if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
    const reminders = PRIORITIES.flatMap((priority) => data[priority] || []);
    window.notchAPI.scheduleTodoReminders(reminders).catch(() => {});
  }
}

function loadTodoOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TODO_ORDER_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return {};
    const result = {};
    for (const priority of PRIORITIES) {
      const ids = Array.isArray(parsed[priority]) ? parsed[priority] : [];
      const valid = new Set((data[priority] || []).map((item) => item.id));
      result[priority] = ids.filter((id) => typeof id === 'string' && valid.has(id));
    }
    return result;
  } catch (error) {
    return {};
  }
}

function saveTodoOrder() {
  try {
    localStorage.setItem(TODO_ORDER_KEY, JSON.stringify(todoOrder));
  } catch (error) {
    // ignore quota errors
  }
}

// 显示顺序：用户手动拖过（todoOrder 非空）按手动顺序，新加的项按默认排序补在末尾；
// 从未拖过的列保持 deadline 排序。
function todoDisplayOrder(priority) {
  const sorted = window.NotchDomain.sortTodosForDisplay(data[priority] || []);
  const manual = todoOrder[priority];
  if (!manual || !manual.length) return sorted;
  const byId = new Map(sorted.map((item) => [item.id, item]));
  const ordered = [];
  const seen = new Set();
  for (const id of manual) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of sorted) {
    if (!seen.has(item.id)) {
      ordered.push(item);
      seen.add(item.id);
    }
  }
  return ordered;
}

let data = loadData();

// ============ 待办完成历史存档（notch-todo-history-v1） ============
function loadTodoHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TODO_HISTORY_KEY) || 'null');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h) => h && typeof h.text === 'string').map((h) => ({
      id: typeof h.id === 'string' && h.id ? h.id : generateId(),
      text: h.text,
      priority: PRIORITIES.includes(h.priority) ? h.priority : 'P3',
      createdAt: Number.isFinite(h.createdAt) ? h.createdAt : Date.now(),
      completedAt: Number.isFinite(h.completedAt) ? h.completedAt : Date.now(),
      deadline: typeof h.deadline === 'string' ? h.deadline : '',
      project: typeof h.project === 'string' ? h.project : '',
    }));
  } catch (error) {
    return [];
  }
}

function saveTodoHistory() {
  try {
    localStorage.setItem(TODO_HISTORY_KEY, JSON.stringify(todoHistory));
  } catch (error) {
    // ignore quota errors
  }
}

function loadTodoProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TODO_PROGRESS_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveTodoProgress() {
  try {
    localStorage.setItem(TODO_PROGRESS_KEY, JSON.stringify(todoProgress));
  } catch (error) {}
}

function loadWeeklySummaries() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TODO_WEEKLY_SUMMARY_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveWeeklySummaries() {
  try {
    localStorage.setItem(TODO_WEEKLY_SUMMARY_KEY, JSON.stringify(weeklySummaries));
  } catch (error) {}
}

function weekStart(value = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date();
  const day = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date;
}

function weekKey(value = Date.now()) {
  // toISOString() 会按 UTC 截取日期：东八区凌晨会被归到前一天（如周一 00:30 变成周日 key）。
  // 用本地年月日拼接，保证周 key 与界面显示的周范围一致。
  const d = weekStart(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function previousWeekKey(value = Date.now()) {
  return weekKey(weekStart(value).getTime() - 7 * 86400000);
}

function weekLabel(value = Date.now()) {
  const start = weekStart(value);
  const end = new Date(start.getTime() + 6 * 86400000);
  const format = (date) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
  return `${format(start)} - ${format(end)}`;
}

// 旧版本里已完成项留在列表（done: true），首次升级时统一迁入历史存档。
function migrateDoneTodos() {
  let migrated = false;
  PRIORITIES.forEach((priority) => {
    const list = data[priority] || [];
    list.filter((item) => item.done).forEach((item) => {
      todoHistory.unshift({
        id: item.id,
        text: item.text,
        priority,
        createdAt: item.createdAt || Date.now(),
        completedAt: item.completedAt || Date.now(),
        deadline: item.deadline || '',
        project: typeof item.project === 'string' ? item.project : '',
      });
    });
    if (list.some((item) => item.done)) {
      data[priority] = list.filter((item) => !item.done);
      migrated = true;
    }
  });
  if (migrated) {
    saveData(data);
    saveTodoHistory();
  }
}

let todoHistory = loadTodoHistory();
let todoProgress = loadTodoProgress();
let weeklySummaries = loadWeeklySummaries();
let todoView = 'active';
migrateDoneTodos();
let todoOrder = loadTodoOrder();
let todoCategoryNames = loadTodoCategoryNames();
const todoSelections = Object.fromEntries(PRIORITIES.map((priority) => [priority, new Set()]));
const todoSelectionAnchors = Object.fromEntries(PRIORITIES.map((priority) => [priority, null]));
let editingTodo = null;
let editingProject = null; // { priority, id } 正在编辑项目名的待办
let todoGroupView = loadTodoGroupView(); // 待办面板按项目分组树，默认开启
let todoGroupCollapsed = new Set(); // `${priority}\u0000${project}` 折叠集合

function loadTodoGroupView() {
  try {
    const stored = localStorage.getItem('notch-todo-group-view-v1');
    // 未保存过选择时默认开启分组树；用户手动切换后记住上次选择。
    return stored === null ? true : stored === '1' || stored === 'true';
  } catch (error) {
    return true;
  }
}

function loadTodoCategoryNames() {
  try {
    return window.NotchDomain.normalizeTodoCategoryNames(
      JSON.parse(localStorage.getItem(TODO_CATEGORY_KEY) || 'null'),
      TODO_CATEGORY_DEFAULTS
    );
  } catch (error) {
    return { ...TODO_CATEGORY_DEFAULTS };
  }
}

function persistTodoCategoryNames() {
  try {
    localStorage.setItem(TODO_CATEGORY_KEY, JSON.stringify(todoCategoryNames));
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话中的分类名。
  }
}

function applyTodoCategoryNames() {
  PRIORITIES.forEach((categoryId) => {
    const name = todoCategoryNames[categoryId];
    const input = document.querySelector(`.todo-category-name[data-category="${categoryId}"]`);
    const addInput = document.querySelector(`.add-row input[data-priority="${categoryId}"]`);
    if (input) input.value = name;
    if (addInput) addInput.setAttribute('aria-label', `添加${name}待办`);
  });
}
if (window.notchAPI && typeof window.notchAPI.scheduleTodoReminders === 'function') {
  window.notchAPI
    .scheduleTodoReminders(PRIORITIES.flatMap((priority) => data[priority] || []))
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onTodoReminder === 'function') {
  window.notchAPI.onTodoReminder((payload) => {
    if (!payload || !payload.id) return;
    let changed = false;
    PRIORITIES.forEach((priority) => {
      const item = (data[priority] || []).find((todo) => (
        todo.id === payload.id && String(todo.deadline || '') === String(payload.deadline || '')
      ));
      if (!item) return;
      item.remindedAt = Math.max(0, Number(payload.remindedAt) || Date.now());
      changed = true;
    });
    if (changed) saveData(data);
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function checkSvg() {
  return '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todoItemHtml(priority, item) {
  const doneClass = item.done ? ' done' : '';
  const selectedClass = todoSelections[priority]?.has(item.id) ? ' multi-selected' : '';
  const safeId = escapeHtml(item.id);
  const safeText = escapeHtml(item.text);
  const todoStatus = item.done ? '已完成' : (todoProgress?.[weekKey()]?.[item.id]?.status || '进度');
  const todoStatusClass = 'todo-progress-' + (item.done ? 'done' : (todoProgress?.[weekKey()]?.[item.id]?.status || 'none'));
  const deadline = Number.isFinite(Date.parse(String(item.deadline || '')))
    ? new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(item.deadline))
    : '';
  const projectName = typeof item.project === 'string' && item.project.trim() ? item.project.trim() : '';
  const isEditingProject = editingProject && editingProject.priority === priority && editingProject.id === item.id;
  const projectChipHtml = isEditingProject
    ? `<input class="todo-project-input" value="${escapeHtml(projectName)}" maxlength="24" aria-label="输入项目名，留空清除" placeholder="项目名，留空清除" />`
    : projectName
      ? `<span class="todo-project-chip" data-action="edit-project" data-project="${escapeHtml(projectName)}" style="--project-color:${window.NotchDomain.todoProjectColor(projectName)}" title="项目：${escapeHtml(projectName)}（点击修改）">${escapeHtml(projectName)}</span>`
      : `<button class="todo-project-chip todo-project-add" type="button" data-action="edit-project" title="添加项目">+</button>`;
  const toggleLabel = item.done ? `恢复未完成：${safeText}` : `标记完成：${safeText}`;
  const battery = window.NotchDomain.todoTimeBattery(item, Date.now());
  // 逾期项整条填满红色并显示「+时长」：剩余 0% 是「快到了」，
  // 逾期是「已经欠账」，两者不能长得一样。
  const batteryHtml = battery
    ? `<span class="todo-battery" data-tone="${battery.tone}"${battery.overdue ? ' data-overdue="true"' : ''} title="${battery.label}" aria-label="${battery.label}"><i style="--battery:${battery.overdue ? 100 : battery.percent}%"></i><b>${battery.text}</b></span>`
    : '';
  const isEditing = editingTodo?.priority === priority && editingTodo?.id === item.id;
  const contentHtml = isEditing
    ? `<div class="todo-inline-editor"><input class="todo-inline-name" value="${safeText}" maxlength="80" aria-label="修改待办名称" />${batteryHtml}<button class="todo-inline-deadline" type="button" data-action="edit-deadline">${deadline || '日期'}</button><button class="todo-inline-save" type="button" data-action="save-edit" aria-label="保存修改">✓</button></div>`
    : `<button class="todo-copy" type="button" data-action="edit" title="${safeText}" aria-label="修改：${safeText}"><span class="todo-text">${safeText}</span>${batteryHtml}${deadline ? `<time class="todo-ddl" datetime="${escapeHtml(item.deadline)}">${escapeHtml(deadline)}</time>` : ''}</button>`;
  return `
    <li class="todo-item${doneClass}${selectedClass}" data-id="${safeId}" data-priority="${priority}">
      <button class="checkbox" type="button" data-action="toggle" aria-label="${toggleLabel}" aria-pressed="${item.done}">${checkSvg()}</button>
      ${projectChipHtml}
      ${contentHtml}
      <button class="todo-progress-action ${todoStatusClass}" type="button" data-action="progress" aria-label="更新进度：${safeText}" title="更新本周进度">${todoStatus}</button>
      <button class="delete" type="button" data-action="delete" aria-label="删除：${safeText}">×</button>
    </li>
  `;
}

function captureTodoPositions(priority) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return new Map();
  return new Map(Array.from(list.querySelectorAll('.todo-item[data-id]')).map((item) => (
    [item.dataset.id, item.getBoundingClientRect()]
  )));
}

function animateTodoOrder(priority, previousPositions) {
  if (!previousPositions?.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  requestAnimationFrame(() => {
    list.querySelectorAll('.todo-item[data-id]').forEach((item) => {
      const previous = previousPositions.get(item.dataset.id);
      if (!previous || typeof item.animate !== 'function') return;
      const current = item.getBoundingClientRect();
      const offset = previous.top - current.top;
      if (Math.abs(offset) < 1) return;
      item.animate([
        { transform: `translateY(${offset}px)` },
        { transform: 'translateY(0)' },
      ], {
        duration: 360,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
      });
    });
  });
}

function renderList(priority, options = {}) {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  const items = todoDisplayOrder(priority);
  if (todoGroupView) {
    const groups = window.NotchDomain.groupTodosByProject(items);
    list.innerHTML = groups.map((group) => {
      const collapsed = todoGroupCollapsed.has(`${priority}\u0000${group.project}`);
      const priColor = { P0: '#FF5F57', P1: '#FF9352', P2: '#30D978', P3: '#438CFF' }[priority] || '#8a8a8a';
      const head = `<li class="todo-group-head" data-priority="${priority}" data-project="${escapeHtml(group.project)}" style="--project-color:${priColor}">
        <button class="todo-group-fold" type="button" aria-label="折叠或展开 ${escapeHtml(group.project || '未分组')}" aria-expanded="${String(!collapsed)}">${collapsed ? '▸' : '▾'}</button>
        <span class="todo-group-name" style="color:${priColor}">${escapeHtml(group.project || '未分组')}</span>
        <span class="todo-group-count">${group.items.length}</span>
      </li>`;
      return head + (collapsed ? '' : group.items.map((item) => todoItemHtml(priority, item)).join(''));
    }).join('');
  } else {
    list.innerHTML = items.map((item) => todoItemHtml(priority, item)).join('');
  }
  updateTodoBulkButton(priority);
  animateTodoOrder(priority, options.previousPositions);
  if (options.focusId) {
    requestAnimationFrame(() => list.querySelector(
      `.todo-item[data-id="${CSS.escape(options.focusId)}"] [data-action="${options.focusAction || 'toggle'}"]`
    )?.focus({ preventScroll: true }));
  }
}

function updateTodoBulkButton(priority) {
  const button = document.querySelector(`[data-bulk-priority="${priority}"]`);
  const count = todoSelections[priority]?.size || 0;
  if (!button) return;
  button.hidden = count === 0;
  button.textContent = '删除';
  button.setAttribute('aria-label', count ? `删除 ${count} 项` : '删除所选');
}

function updateCount(priority) {
  const countEl = document.querySelector(`.count[data-priority="${priority}"]`);
  if (!countEl) return;
  const items = data[priority] || [];
  const pending = items.filter((t) => !t.done).length;
  countEl.textContent = String(pending);
}

function renderAll() {
  PRIORITIES.forEach((p) => {
    renderList(p);
    updateCount(p);
  });
}

// 每 60 秒轻量刷新倒计时电量条，避免全量重建列表造成的卡顿
function refreshBatteryBars() {
  if (document.hidden) return;
  const now = Date.now();
  document.querySelectorAll('.todo-item[data-priority][data-id]').forEach((item) => {
    const priority = item.dataset.priority;
    const id = item.dataset.id;
    const todo = (data[priority] || []).find((t) => t.id === id);
    const bar = item.querySelector('.todo-battery');
    if (!todo) { if (bar) bar.remove(); return; }
    const battery = window.NotchDomain.todoTimeBattery(todo, now);
    if (!battery) { if (bar) bar.remove(); return; }
    if (!bar) return;
    bar.dataset.tone = battery.tone;
    if (battery.overdue) bar.dataset.overdue = 'true';
    else delete bar.dataset.overdue;
    bar.title = battery.label;
    bar.setAttribute('aria-label', battery.label);
    const fill = bar.querySelector('i');
    if (fill) fill.style.setProperty('--battery', (battery.overdue ? 100 : battery.percent) + '%');
    const label = bar.querySelector('b');
    if (label) label.textContent = battery.text;
  });
}

setInterval(refreshBatteryBars, 60_000);

// 渲染重建 innerHTML 后，给指定条目挂一次性动画类；动画结束即卸载，不污染后续渲染
function flashItemClass(priority, id, cls) {
  const el = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"]`
  );
  if (!el) return;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function flashCheckboxPop(priority, id) {
  const box = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${id}"] .checkbox`
  );
  if (!box) return;
  box.classList.add('pop');
  box.addEventListener('animationend', () => box.classList.remove('pop'), { once: true });
}

function addTodo(priority, text, deadline) {
  const item = window.NotchDomain.createTodo(text, deadline, generateId(), Date.now());
  if (!item) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority].push(item);
  saveData(data);
  if (window.NexusDeskSync) window.NexusDeskSync.reportTodoCreated(item, priority);
  renderList(priority, { previousPositions });
  updateCount(priority);
  flashItemClass(priority, item.id, 'enter');
  const added = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${item.id}"]`
  );
  if (added) {
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      added.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }
  return true;
}

function editTodo(priority, id, text, deadline) {
  const index = (data[priority] || []).findIndex((item) => item.id === id);
  if (index < 0) return false;
  const updated = window.NotchDomain.updateTodo(data[priority][index], text, deadline);
  if (!updated) return false;
  const previousPositions = captureTodoPositions(priority);
  data[priority][index] = updated;
  saveData(data);
  if (window.NexusDeskSync) window.NexusDeskSync.reportTodoUpdated(updated, priority, ['text', 'deadline']);
  renderList(priority, { previousPositions, focusId: id, focusAction: 'edit' });
  return true;
}

function toggleTodo(priority, id) {
  const list = data[priority];
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const previousPositions = captureTodoPositions(priority);
  const [item] = list.splice(idx, 1);
  const completedAt = Date.now();
  todoHistory.unshift({
    id: item.id,
    text: item.text,
    priority,
    createdAt: item.createdAt || completedAt,
    completedAt,
    deadline: item.deadline || '',
    project: typeof item.project === 'string' ? item.project : '',
  });
  saveData(data);
  saveTodoHistory();
  if (window.NexusDeskSync) window.NexusDeskSync.reportTodoCompleted(item, priority);
  renderList(priority, { previousPositions });
  updateCount(priority);
  updateTodoHistoryUI();
  requestAnimationFrame(() => flashCheckboxPop(priority, id)); // 勾选弹一下
  showStatusToast('已完成，已存入历史', {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      const hi = todoHistory.findIndex((h) => h.id === item.id);
      if (hi !== -1) todoHistory.splice(hi, 1);
      list.push({ ...item, done: false });
      saveData(data);
      saveTodoHistory();
      renderList(priority);
      updateCount(priority);
      updateTodoHistoryUI();
      showStatusToast('已撤销完成');
    },
  });
}

function deleteTodo(priority, id) {
  const list = data[priority];
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [removed] = list.splice(index, 1);
  const itemEl = document.querySelector(
    `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"]`
  );
  const shouldRestoreFocus = !!(itemEl && itemEl.contains(document.activeElement));
  const nearbyItem = itemEl && (itemEl.nextElementSibling || itemEl.previousElementSibling);
  if (itemEl) itemEl.remove();
  saveData(data);
  if (window.NexusDeskSync) window.NexusDeskSync.reportTodoDeleted(id, removed.dingtalkTaskId);
  updateCount(priority);
  if (shouldRestoreFocus) {
    const nextFocus =
      (nearbyItem && nearbyItem.querySelector('[data-action="toggle"]')) ||
      document.querySelector(`.add-row input[data-priority="${priority}"]`);
    if (nextFocus) nextFocus.focus({ preventScroll: true });
  }
  const summary = removed.text.length > 18 ? `${removed.text.slice(0, 18)}…` : removed.text;
  showStatusToast(`已删除“${summary}”`, {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (list.some((item) => item.id === removed.id)) return;
      list.splice(Math.min(index, list.length), 0, removed);
      saveData(data);
      renderList(priority);
      updateCount(priority);
      const restored = document.querySelector(
        `.todo-item[data-priority="${priority}"][data-id="${CSS.escape(id)}"] [data-action="toggle"]`
      );
      if (restored) restored.focus({ preventScroll: true });
      showStatusToast('已撤销删除');
    },
  });
}

/**
 * 处理来自 NexusDesk Cloud 的远端待办变更
 * 由 dingtalk-sync.js 在收到 WebSocket 消息时调用
 */
function handleRemoteTodoChange(event) {
  if (!event || !event.todoId) return;
  // 忽略自己发出的事件（避免循环）
  if (event.source === 'desktop') return;

  const { todoId, dingtalkTaskId, payload } = event;
  // 在所有象限里找这条待办
  let foundPriority = null;
  let foundIndex = -1;
  for (const prio of Object.keys(data)) {
    const idx = (data[prio] || []).findIndex((t) => t.id === todoId || t.dingtalkTaskId === dingtalkTaskId);
    if (idx >= 0) { foundPriority = prio; foundIndex = idx; break; }
  }

  switch (event.event) {
    case 'todo.create': {
      if (foundPriority) return; // 已存在，不重复创建
      const priority = (payload && payload.priority) || (payload && payload.category) || 'P3';
      if (!data[priority]) data[priority] = [];
      const deadline = (payload && payload.dueTime) || new Date(Date.now() + 12 * 3600 * 1000).toISOString();
      const item = window.NotchDomain.createTodo((payload && payload.text) || '同步待办', deadline, todoId, Date.now());
      if (item) {
        if (dingtalkTaskId) item.dingtalkTaskId = dingtalkTaskId;
        if (payload && payload.project) item.project = payload.project;
        data[priority].push(item);
        saveData(data);
        renderList(priority);
        updateCount(priority);
      }
      break;
    }
    case 'todo.update': {
      if (!foundPriority) return;
      const previousPriority = foundPriority;
      const requestedPriority = payload && payload.priority;
      const nextPriority = PRIORITIES.includes(requestedPriority) ? requestedPriority : foundPriority;
      const item = data[foundPriority][foundIndex];
      if (nextPriority !== foundPriority) {
        data[foundPriority].splice(foundIndex, 1);
        if (!data[nextPriority]) data[nextPriority] = [];
        data[nextPriority].push(item);
        foundPriority = nextPriority;
      }
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'text')) item.text = payload.text;
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'dueTime')) item.deadline = payload.dueTime;
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'project')) item.project = payload.project;
      if (dingtalkTaskId) item.dingtalkTaskId = dingtalkTaskId;
      item.dingtalkSyncedAt = Date.now();
      saveData(data);
      if (previousPriority !== foundPriority) {
        renderList(previousPriority);
        updateCount(previousPriority);
      }
      renderList(foundPriority);
      updateCount(foundPriority);
      break;
    }
    case 'todo.complete': {
      if (!foundPriority) return;
      const item = data[foundPriority][foundIndex];
      if (item.done) return;
      // 复用 toggleTodo 的完成逻辑
      toggleTodo(foundPriority, item.id);
      break;
    }
    case 'todo.delete': {
      if (!foundPriority) return;
      data[foundPriority].splice(foundIndex, 1);
      saveData(data);
      renderList(foundPriority);
      updateCount(foundPriority);
      break;
    }
  }
}

let isExpanded = false;
let modeBusy = false;
let pendingMode = null;
let restoreNotchFocusAfterCollapse = false;
// 从折叠态展开的瞬间置 true，岛体落定后自动清除；
// setActiveTab 读取此标志决定是否延后重活，已展开态切 Tab 不受影响。
let _justExpanded = false;

const PANEL_MOTION_FALLBACK_MS = 440;
const OPENING_SETTLE_MS = 360;
const HEAVY_LOAD_AFTER_OPEN_MS = 360;

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitForPanelMotion() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      panel.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (event.target === panel && event.pseudoElement === '::before') {
        finish();
      }
    };
    const timer = setTimeout(finish, 320);
    panel.addEventListener('transitionend', onEnd);
  });
}

async function ipcSetMode(mode) {
  if (!window.notchAPI || typeof window.notchAPI.setMode !== 'function') return;
  try {
    await window.notchAPI.setMode(mode);
  } catch (e) {
    // ignore
  }
}

async function ipcBeginCollapse() {
  if (!window.notchAPI || typeof window.notchAPI.beginCollapse !== 'function') return;
  try {
    await window.notchAPI.beginCollapse();
  } catch (e) {
    // ignore
  }
}

function syncPanelAccessibility(expanded) {
  const focusWasInPanel = !!(panel && panel.contains(document.activeElement));
  if (!expanded) {
    restoreNotchFocusAfterCollapse = document.hasFocus();
    if (focusWasInPanel) document.activeElement.blur();
  } else {
    restoreNotchFocusAfterCollapse = false;
  }
  if (panel) {
    panel.inert = !expanded;
    panel.setAttribute('aria-hidden', String(!expanded));
  }
  if (!notch) return;
  notch.setAttribute('aria-expanded', String(expanded));
  notch.setAttribute('aria-label', expanded ? '收起 TO-DO Panel' : '展开 TO-DO Panel');
  if (expanded && document.activeElement === notch) {
    const activeTabButton = document.querySelector(`.tab[data-tab="${activeTab}"]`);
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  notch.setAttribute('aria-hidden', String(expanded));
  notch.tabIndex = expanded ? -1 : 0;
}

// 原生窗口只提供动画需要的透明画布；用户看到的黑色岛体由 CSS 连续形变。
// 收起必须等岛体退场完成后再缩原生窗口，避免最后一帧被裁掉。
async function setMode(expanded) {
  if (modeBusy) {
    pendingMode = expanded;
    return;
  }
  if (expanded === isExpanded) return;
  modeBusy = true;
  isExpanded = expanded;
  try {
    if (expanded) {
      // 每次召回使用设置中的默认页，不沿用上次收起时的停留页。
      _justExpanded = true;
      setTimeout(() => {
        _justExpanded = false;
      }, OPENING_SETTLE_MS);
      await defaultTabReady;
      const openingTab = window.NotchDomain.resolveDefaultPanelTab(defaultOpenTab, TABS);
      if (activeTab !== openingTab) await setActiveTab(openingTab);
      else applyTabDom(openingTab);
      syncPanelAccessibility(true);
      app.classList.remove('collapsed', 'closing');
      app.classList.add('opening');
      void panel.offsetWidth;
      // offsetWidth 只强制布局，不强制绘制；而 rAF 回调发生在绘制之前。
      // 必须等两帧、确认 .opening 的透明折叠条真的进了合成器，再让主进程放大窗口，
      // 否则放大时被钉在新原点上的仍是那条黑色折叠条（菜单栏黑块闪烁的成因）。
      await new Promise(r => setTimeout(r, 150));
      await ipcSetMode('expanded');
      app.classList.remove('opening');
      app.classList.add('expanded');
      // 展开后面板从隐藏变为可见，tab 尺寸此时才可量，校准激活胶囊位置
      requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
      setTimeout(() => {
        if (!isExpanded) return;
        if (activeTab === 'clip') renderClipList();
      }, HEAVY_LOAD_AFTER_OPEN_MS);
    } else {
      const motion = waitForPanelMotion();
      syncPanelAccessibility(false);
      // 隐私优先：不要把摄像头释放放在 rAF 之后，隐藏窗口可能暂停动画帧。
      await ipcBeginCollapse();
      app.classList.add('closing');
      await nextAnimationFrame();
      await motion;
      await nextAnimationFrame();
      await nextAnimationFrame();
      await ipcSetMode('collapsed');
      app.classList.remove('expanded', 'closing', 'opening');
      app.classList.add('collapsed');
      if (restoreNotchFocusAfterCollapse && document.hasFocus() && notch) {
        notch.focus({ preventScroll: true });
      }
      restoreNotchFocusAfterCollapse = false;
    }
    document.dispatchEvent(new CustomEvent('notch:modechange', {
      detail: { expanded: isExpanded },
    }));
  } finally {
    modeBusy = false;
    if (pendingMode !== null) {
      const nextMode = pendingMode;
      pendingMode = null;
      if (nextMode !== isExpanded) setMode(nextMode);
    }
  }
}

notch.addEventListener('click', (e) => {
  e.stopPropagation();
  setMode(!isExpanded);
});

notch.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  setMode(!isExpanded);
});

document.addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const editable = Boolean(target && target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), audio, video'
  ));
  if (!window.NotchDomain.shouldTogglePanelForSpace({
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    isComposing: event.isComposing,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    editable,
  })) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setMode(!isExpanded);
}, true);

syncPanelAccessibility(false);

panel.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Esc 收起面板（菜单栏会拦截顶部刘海条的点击，给收起多一条可靠路径）；
// 焦点在输入框/速记里时，第一次 Esc 只退出输入。
// Escape 不会原生到达页面（被浏览器层吞掉），由主进程 before-input-event 转发
if (window.notchAPI && typeof window.notchAPI.onEscape === 'function') {
  window.notchAPI.onEscape(() => {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.blur();
      return;
    }
    if (document.querySelector('.multi-selected')) {
      PRIORITIES.forEach((priority) => {
        todoSelections[priority].clear();
        todoSelectionAnchors[priority] = null;
        renderList(priority);
      });
      document.dispatchEvent(new CustomEvent('notch:clear-selection'));
      return;
    }
    if (isExpanded) setMode(false);
  });
}

if (window.notchAPI && typeof window.notchAPI.onToggleShortcut === 'function') {
  window.notchAPI.onToggleShortcut(() => setMode(!isExpanded));
}

// 失焦与点击收起共用同一个状态机，保证退场节奏一致。
if (window.notchAPI && typeof window.notchAPI.onCollapseRequest === 'function') {
  window.notchAPI.onCollapseRequest(() => {
    if (isExpanded) setMode(false);
  });
}

// 全局快捷键召唤也走同一套 Tab 与展开状态机，避免出现另一种突兀的入场路径。
if (window.notchAPI && typeof window.notchAPI.onOpenClip === 'function') {
  window.notchAPI.onOpenClip(async () => {
    await setActiveTab('clip');
    if (!isExpanded) await setMode(true);
  });
}

// 布局度量（主进程按屏计算下发）：折叠条高 / 菜单栏占位高 / 各 Tab 目标尺寸
let layoutMetrics = null;

function applyLayoutMetrics(metrics) {
  if (!metrics) return;
  layoutMetrics = metrics;
  if (metrics.stripHeight) {
    document.documentElement.style.setProperty('--notch-h', `${metrics.stripHeight}px`);
  }
  if (metrics.menuBarHeight) {
    document.documentElement.style.setProperty('--mb-h', `${metrics.menuBarHeight}px`);
  }
}

if (window.notchAPI && typeof window.notchAPI.getMetrics === 'function') {
  window.notchAPI
    .getMetrics()
    .then(applyLayoutMetrics)
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onMetricsChanged === 'function') {
  window.notchAPI.onMetricsChanged(applyLayoutMetrics);
}

// ============ Tab 切换 ============
const TAB_KEY = 'notch-active-tab';
const ALL_TABS = ['weekly', 'todo', 'notes', 'links', 'credentials', 'clip', 'settings'];
let TABS = ALL_TABS.filter((name) => name !== 'clip');
let tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const tabIndicator = document.getElementById('tab-indicator');
const collapseBtn = document.getElementById('collapse-btn');

let activeTab = 'todo';
let defaultOpenTab = 'todo';
let defaultTabReady = Promise.resolve();

function applyFeatureSettings(settings) {
  const features = { ...(settings && settings.features || {}), settings: true };
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    const enabled = button.dataset.tab === 'settings'
      || features[button.dataset.tab] !== false;
    button.hidden = !enabled;
    button.setAttribute('aria-hidden', String(!enabled));
  });
  TABS = window.NotchDomain.visiblePanelTabs(ALL_TABS, features);
  defaultOpenTab = window.NotchDomain.resolveDefaultPanelTab(settings?.defaultTab, TABS);
  tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
  tabButtons.forEach((button) => button.classList.remove('tab-split-start'));
  document.getElementById('tabs')?.classList.toggle('is-split', tabButtons.length > 4);
  if (tabButtons.length > 4) {
    tabButtons[Math.ceil(tabButtons.length / 2)]?.classList.add('tab-split-start');
  }
  if (!TABS.includes(activeTab)) setActiveTab(TABS[0] || 'settings');
  requestAnimationFrame(positionIndicator);
}

if (window.notchAPI?.getAppSettings) {
  defaultTabReady = window.notchAPI.getAppSettings().then(applyFeatureSettings).catch(() => {});
  window.notchAPI.onAppSettingsChanged?.(applyFeatureSettings);
}

function positionIndicator() {
  const btn = tabButtons.find((b) => b.dataset.tab === activeTab);
  if (!btn || !tabIndicator) return;
  tabIndicator.style.width = `${btn.offsetWidth}px`;
  tabIndicator.style.transform = `translateX(${btn.offsetLeft}px)`;
}

function applyTabDom(name) {
  tabButtons.forEach((b) => {
    const selected = b.dataset.tab === name;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  tabPanels.forEach((p) => {
    const selected = p.id === `tab-${name}`;
    p.classList.toggle('active', selected);
    p.inert = !selected;
    p.setAttribute('aria-hidden', String(!selected));
  });
  positionIndicator();
  requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
  if (name === 'weekly' && typeof weeklySelectedKey !== 'undefined' && weeklySelectedKey !== null) {
    weeklySelectedKey = null;
    renderWeeklySummary();
  }
  document.dispatchEvent(new CustomEvent('notch:tabchange', { detail: { tab: name } }));
}

async function ipcSetTab(name) {
  if (!window.notchAPI || typeof window.notchAPI.setTab !== 'function') return;
  try {
    await window.notchAPI.setTab(name);
  } catch (e) {
    // ignore
  }
}

// 固定展开尺寸下，Tab 只切换内容与指示器，不再改变原生窗口边界。
async function morphToTab(name) {
  await ipcSetTab(name);
  applyTabDom(name);
  positionIndicator();
}

let tabBusy = false;
let pendingTab = null;

async function setActiveTab(name) {
  if (!TABS.includes(name)) name = TABS[0] || 'settings';
  if (tabBusy) {
    pendingTab = name; // 补间中连点：记住最后目标，结束后追赶
    return;
  }
  if (name === activeTab) {
    applyTabDom(name);
    return;
  }
  tabBusy = true;
  activeTab = name;
  try {
    // 图片预加载等重活的调度策略：
    //   - 已展开态切 Tab：_justExpanded=false → 立即执行，保持即时响应
    //   - 从折叠态展开（_justExpanded=true）：延后到展开动画基本落定后再跑，
    //     避免与面板 scale 手势争首帧 CPU/GPU，消除展开卡顿
    // renderClipList 延后只是缩略图晚一点出现，可接受。
    const _tabNameForDeferred = name; // 闭包捕获当前目标 Tab
    const runHeavyLoads = () => {
      if (_tabNameForDeferred === 'clip') renderClipList();
      if (_tabNameForDeferred === 'notes') renderNotesLibrary();
    };
    if (_justExpanded) {
      // 双帧后再延迟重活，让岛体形变先完成，避免抢首帧 CPU/GPU。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(runHeavyLoads, HEAVY_LOAD_AFTER_OPEN_MS))
      );
    } else {
      // 已展开态切 Tab：立即执行，无感知延迟
      runHeavyLoads();
    }
    if (isExpanded) {
      await morphToTab(name);
    } else {
      // 折叠态只记录目标尺寸（主进程不变形），展开时一步到位
      await ipcSetTab(name);
      applyTabDom(name);
    }
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch (e) {
      // ignore quota errors
    }
  } finally {
    tabBusy = false;
    if (pendingTab && pendingTab !== activeTab) {
      const next = pendingTab;
      pendingTab = null;
      setActiveTab(next);
    } else {
      pendingTab = null;
    }
  }
}

// 胶囊滑动结束后兜底再校准一次（窗口变形期间布局可能回流）
if (tabIndicator) {
  tabIndicator.addEventListener('transitionend', positionIndicator);
}

Array.from(document.querySelectorAll('.tab[data-tab]')).forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveTab(btn.dataset.tab);
  });
  btn.addEventListener('keydown', (e) => {
    const currentIndex = tabButtons.indexOf(btn);
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    }
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextButton = tabButtons[nextIndex];
    nextButton.focus({ preventScroll: true });
    setActiveTab(nextButton.dataset.tab);
  });
});

// 托盘里的“设置快捷键…”会把设置入口以内联浮层放到面板中。
// 这里绑定所有 Tab（包括启动时隐藏的剪贴板），避免功能启用后按钮仍没有事件。
const shortcutRecorder = document.getElementById('shortcut-recorder');
const shortcutRecorderValue = document.getElementById('shortcut-recorder-value');
const shortcutRecorderCancel = document.getElementById('shortcut-recorder-cancel');
let shortcutRecorderActive = false;

function closeShortcutRecorder() {
  shortcutRecorderActive = false;
  if (shortcutRecorder) shortcutRecorder.hidden = true;
}

function keyEventToAccelerator(event) {
  const keyAliases = {
    ' ': 'Space', Spacebar: 'Space', Escape: 'Escape', Esc: 'Escape',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  };
  let key = keyAliases[event.key] || event.key;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key)) return '';
  const parts = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

shortcutRecorder?.addEventListener('keydown', async (event) => {
  if (!shortcutRecorderActive) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    closeShortcutRecorder();
    return;
  }
  const accelerator = keyEventToAccelerator(event);
  if (!accelerator) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = '请按下完整按键组合';
    return;
  }
  if (accelerator !== 'Space' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = '单键仅支持空格';
    return;
  }
  if (shortcutRecorderValue) shortcutRecorderValue.textContent = accelerator;
  const result = await window.notchAPI?.setPanelShortcut?.(accelerator).catch(() => ({ ok: false }));
  if (!result?.ok) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = result?.error === 'occupied' ? '该快捷键已被占用' : '无法使用该快捷键';
    return;
  }
  showStatusToast(`快捷键已设为 ${accelerator}`);
  setTimeout(closeShortcutRecorder, 420);
});

shortcutRecorderCancel?.addEventListener('click', closeShortcutRecorder);
function openShortcutRecorder() {
  if (!isExpanded) setMode(true);
  shortcutRecorderActive = true;
  shortcutRecorder.hidden = false;
  shortcutRecorderValue.textContent = '等待输入…';
  requestAnimationFrame(() => shortcutRecorder.focus({ preventScroll: true }));
}
document.addEventListener('notch:record-shortcut', openShortcutRecorder);

if (collapseBtn) {
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(false);
  });
}

// 顶栏空白处点按收起——黑条在展开态已退场，由顶栏接替这一角色。
// 排除交互区（Tab / 按钮 / 输入 / 搜索框），品牌区与空白处都可收起（明确的收起热区）。
// 注意：home/todo 下搜索框隐藏会让 .topbar-mid 高度塌成 0，点击其实落在 .topbar 上，
// 所以必须挂在 .topbar 上并用 closest 排除，不能只认 .topbar-mid 本体。
const topbarEl = document.querySelector('.topbar');
if (topbarEl) {
  topbarEl.addEventListener('click', (e) => {
    if (e.target.closest('.tabs, .todo-weekly-card, button, input')) return;
    e.stopPropagation();
    setMode(false);
  });
}

// 窗口失焦/聚焦：折叠态刘海在失焦时透明，避免遮挡其他窗口
window.addEventListener('blur', () => document.getElementById('app')?.classList.add('inactive'));
window.addEventListener('focus', () => document.getElementById('app')?.classList.remove('inactive'));

function initTab() {
  setActiveTab('home');
}

document.querySelectorAll('.todo-category-name[data-category]').forEach((input) => {
  const finishCategoryEdit = () => {
    const categoryId = input.dataset.category;
    todoCategoryNames = window.NotchDomain.normalizeTodoCategoryNames({
      ...todoCategoryNames,
      [categoryId]: input.value,
    }, TODO_CATEGORY_DEFAULTS);
    persistTodoCategoryNames();
    applyTodoCategoryNames();
  };
  input.addEventListener('change', finishCategoryEdit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      input.blur();
    }
    if (event.key === 'Escape') {
      input.value = todoCategoryNames[input.dataset.category];
      input.blur();
    }
  });
});

applyTodoCategoryNames();

// —— 自绘下拉（深色，替代原生 select 白底弹层）——
function initCustomSelect(trigger, menu, select) {
  if (!trigger || !menu || !select) return;
  function renderMenu() {
    menu.replaceChildren();
    [...select.options].forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'custom-select-option';
      item.dataset.value = option.value;
      item.textContent = option.textContent;
      if (option.value === String(select.value)) item.classList.add('selected');
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        select.value = option.value;
        trigger.textContent = option.textContent;
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.append(item);
    });
  }
  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    renderMenu();
    const willOpen = menu.hidden;
    document.querySelectorAll('.custom-select-menu:not([hidden])').forEach((other) => {
      if (other !== menu) {
        other.hidden = true;
        const sibling = other.previousElementSibling;
        if (sibling && typeof sibling.setAttribute === 'function') sibling.setAttribute('aria-expanded', 'false');
      }
    });
    menu.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  const initial = select.options[select.selectedIndex];
  if (initial) trigger.textContent = initial.textContent;
}

const todoEditorBackdrop = document.getElementById('todo-date-popover');
const todoEditorMonth = document.getElementById('todo-editor-month');
const todoCalendarPrevious = document.getElementById('todo-calendar-previous');
const todoCalendarNext = document.getElementById('todo-calendar-next');
const todoCalendarGrid = document.getElementById('todo-calendar-grid');
const todoEditorHour = document.getElementById('todo-editor-hour');
const todoEditorMinute = document.getElementById('todo-editor-minute');
const todoEditorHourTrigger = document.getElementById('todo-editor-hour-trigger');
const todoEditorMinuteTrigger = document.getElementById('todo-editor-minute-trigger');
function syncTodoTimeTriggers() {
  if (todoEditorHourTrigger && todoEditorHour) {
    todoEditorHourTrigger.textContent = String(todoEditorHour.value).padStart(2, '0');
  }
  if (todoEditorMinuteTrigger && todoEditorMinute) {
    todoEditorMinuteTrigger.textContent = String(todoEditorMinute.value).padStart(2, '0');
  }
}
fillTodoTimeOptions();
initCustomSelect(todoEditorHourTrigger, document.getElementById('todo-editor-hour-menu'), todoEditorHour);
initCustomSelect(todoEditorMinuteTrigger, document.getElementById('todo-editor-minute-menu'), todoEditorMinute);
syncTodoTimeTriggers();
const todoEditorError = document.getElementById('todo-editor-error');
let todoEditorContext = null;
let todoEditorYear = new Date().getFullYear();
let todoEditorMonthIndex = new Date().getMonth();
let todoEditorDay = new Date().getDate();

function fillTodoTimeOptions() {
  if (todoEditorHour && !todoEditorHour.options.length) {
    for (let hour = 0; hour < 24; hour += 1) todoEditorHour.add(new Option(String(hour).padStart(2, '0'), String(hour)));
  }
  if (todoEditorMinute && !todoEditorMinute.options.length) {
    for (let minute = 0; minute < 60; minute += 5) todoEditorMinute.add(new Option(String(minute).padStart(2, '0'), String(minute)));
  }
}

function renderTodoCalendar() {
  if (!todoCalendarGrid) return;
  const now = new Date();
  const days = new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate();
  const firstWeekday = (new Date(todoEditorYear, todoEditorMonthIndex, 1).getDay() + 6) % 7;
  if (todoEditorMonth) todoEditorMonth.textContent = `${todoEditorYear}年 ${todoEditorMonthIndex + 1}月`;
  todoCalendarGrid.replaceChildren();
  for (let index = 0; index < firstWeekday; index += 1) todoCalendarGrid.append(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    button.dataset.day = String(day);
    button.className = day === todoEditorDay ? 'selected' : '';
    if (todoEditorYear === now.getFullYear() && todoEditorMonthIndex === now.getMonth() && day === now.getDate()) {
      button.classList.add('today');
    }
    todoCalendarGrid.append(button);
  }
}

function closeTodoEditor() {
  if (todoEditorBackdrop) todoEditorBackdrop.hidden = true;
  if (todoEditorContext?.mode === 'edit') {
    const { priority } = todoEditorContext;
    renderList(priority);
  }
  todoEditorContext = null;
}

function selectedTodoDeadline() {
  return window.NotchDomain.calendarDeadline({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
    day: todoEditorDay,
    hour: todoEditorHour?.value,
    minute: todoEditorMinute?.value,
  });
}

function applyTodoEditorSelection(markManual = true) {
  if (!todoEditorContext) return false;
  const deadline = selectedTodoDeadline();
  if (!deadline || Date.parse(deadline) <= Date.now()) {
    if (todoEditorError) todoEditorError.textContent = '请选择晚于当前时间的截止点';
    return false;
  }
  if (todoEditorError) todoEditorError.textContent = '';
  const { priority, id, mode } = todoEditorContext;
  if (mode === 'edit') {
    const todo = (data[priority] || []).find((item) => item.id === id);
    if (!todo) return false;
    todo.deadline = deadline;
    saveData(data);
  } else {
    const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
    if (!trigger) {
      // 象限内添加行已移除：把选择结果交还给调用方（统一添加面板）。
      if (todoEditorContext.onPick) todoEditorContext.onPick(deadline);
      else return false;
    } else {
      trigger.dataset.deadline = deadline;
      trigger.dataset.deadlineSource = markManual ? 'manual' : (trigger.dataset.deadlineSource || 'default');
      trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
        day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(deadline));
      trigger.classList.add('selected');
      trigger.classList.remove('invalid');
    }
  }
  return true;
}

function openTodoEditor(priority, item = null, anchor = null) {
  const now = new Date();
  const addInput = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const trigger = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  if (!item) applyDefaultTodoDeadline(trigger, now);
  const candidate = item && item.deadline ? new Date(item.deadline) : trigger?.dataset.deadline ? new Date(trigger.dataset.deadline) : null;
  const selectedDate = candidate && Number.isFinite(candidate.getTime())
    ? candidate
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
  todoEditorContext = { priority, id: item && item.id || '', mode: item ? 'edit' : 'add', onPick: null };
  todoEditorYear = selectedDate.getFullYear();
  todoEditorMonthIndex = selectedDate.getMonth();
  todoEditorDay = selectedDate.getDate();
  fillTodoTimeOptions();
  if (todoEditorHour) todoEditorHour.value = String(selectedDate.getHours());
  if (todoEditorMinute) todoEditorMinute.value = String(Math.floor(selectedDate.getMinutes() / 5) * 5);
  syncTodoTimeTriggers();
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
  if (todoEditorBackdrop) {
    const target = anchor || (item
      ? document.querySelector(`.todo-item[data-id="${CSS.escape(item.id)}"] .todo-inline-deadline`)
      : trigger);
    document.body.appendChild(todoEditorBackdrop);
    todoEditorBackdrop.hidden = false;
    const rect = target?.getBoundingClientRect();
    if (rect && rect.width) {
      const popoverWidth = 264;
      const popoverHeight = 332;
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - popoverWidth - 8));
      let top = rect.top - popoverHeight - 8;
      if (top < 8) top = Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - popoverHeight - 8));
      todoEditorBackdrop.style.left = `${Math.round(left)}px`;
      todoEditorBackdrop.style.top = `${Math.round(top)}px`;
    } else {
      todoEditorBackdrop.style.removeProperty('left');
      todoEditorBackdrop.style.removeProperty('top');
    }
  }
  applyTodoEditorSelection(false);
}

todoCalendarGrid?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (!button) return;
  todoEditorDay = Number(button.dataset.day);
  renderTodoCalendar();
  if (todoEditorError) todoEditorError.textContent = '';
});
function moveTodoCalendar(offset) {
  const shifted = window.NotchDomain.shiftCalendarMonth({
    year: todoEditorYear,
    month: todoEditorMonthIndex,
  }, offset);
  if (!shifted) return;
  todoEditorYear = shifted.year;
  todoEditorMonthIndex = shifted.month;
  todoEditorDay = Math.min(todoEditorDay, new Date(todoEditorYear, todoEditorMonthIndex + 1, 0).getDate());
  if (todoEditorError) todoEditorError.textContent = '';
  renderTodoCalendar();
}

todoCalendarPrevious?.addEventListener('click', () => moveTodoCalendar(-1));
todoCalendarNext?.addEventListener('click', () => moveTodoCalendar(1));
todoEditorHour?.addEventListener('change', () => { syncTodoTimeTriggers(); if (todoEditorError) todoEditorError.textContent = ''; });
todoEditorMinute?.addEventListener('change', () => { syncTodoTimeTriggers(); if (todoEditorError) todoEditorError.textContent = ''; });

document.addEventListener('pointerdown', (event) => {
  if (todoEditorBackdrop?.hidden) return;
  if (event.target === todoEditorBackdrop) { closeTodoEditor(); return; }
  if (todoEditorBackdrop.contains(event.target) || event.target.closest('.todo-deadline-trigger, .todo-inline-deadline')) return;
  closeTodoEditor();
}, true);

document.getElementById('todo-editor-confirm')?.addEventListener('click', () => {
  if (applyTodoEditorSelection(true)) closeTodoEditor();
});
document.getElementById('todo-editor-cancel')?.addEventListener('click', () => closeTodoEditor());

/* ============ 统一添加待办 ============ */
const todoAddBackdrop = document.getElementById('todo-add-backdrop');
const todoAddInput = document.getElementById('todo-add-input');
const todoAddCategories = document.getElementById('todo-add-categories');
const todoAddTime = document.getElementById('todo-add-time');
const todoAddCreate = document.getElementById('todo-add-create');
const todoAddState = { priority: 'P0', deadline: null, source: 'default' };

function formatTodoAddTime(value) {
  const date = new Date(value);
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${sameDay ? '今天' : `${date.getMonth() + 1}月${date.getDate()}日`} ${time}`;
}

function renderTodoAddCategories() {
  if (!todoAddCategories) return;
  if (!todoAddCategories.children.length) {
    PRIORITIES.forEach((priority) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'todo-add-cat';
      button.dataset.priority = priority;
      button.setAttribute('role', 'radio');
      const dot = document.createElement('span');
      dot.className = `dot dot-${priority.toLowerCase()}`;
      button.append(dot, document.createTextNode(''));
      button.addEventListener('click', () => {
        todoAddState.priority = priority;
        renderTodoAddCategories();
      });
      todoAddCategories.append(button);
    });
  }
  todoAddCategories.querySelectorAll('[data-priority]').forEach((button) => {
    const active = todoAddState.priority === button.dataset.priority;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
    button.lastChild.nodeValue = todoCategoryNames[button.dataset.priority] || button.dataset.priority;
  });
}

function renderTodoAddTime() {
  if (!todoAddTime) return;
  if (!todoAddState.deadline) {
    todoAddTime.textContent = '选择截止时间';
    todoAddTime.classList.remove('selected');
    return;
  }
  todoAddTime.textContent = formatTodoAddTime(todoAddState.deadline);
  todoAddTime.dataset.deadline = todoAddState.deadline;
  todoAddTime.classList.add('selected');
}

function openTodoAddPopover() {
  todoAddState.priority = 'P0';
  const now = new Date();
  const defaultDeadline = window.NotchDomain.defaultTodoDeadline(now);
  todoAddState.deadline = defaultDeadline || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30).toISOString();
  todoAddState.source = 'default';
  if (todoAddInput) todoAddInput.value = '';
  renderTodoAddCategories();
  renderTodoAddTime();
  if (todoAddBackdrop) {
    todoAddBackdrop.hidden = false;
    setTimeout(() => todoAddInput?.focus({ preventScroll: true }), 0);
  }
}

function closeTodoAddPopover() {
  if (todoAddBackdrop) todoAddBackdrop.hidden = true;
}

function submitTodoAdd() {
  if (!todoAddInput) return;
  const text = todoAddInput.value.trim();
  if (!text) {
    todoAddInput.focus({ preventScroll: true });
    return;
  }
  // 未手选时间时，创建前刷新为“今天 23:30”，避免跨天或入睡后过期。
  let deadline = todoAddState.deadline;
  if (todoAddState.source !== 'manual') {
    const refreshed = window.NotchDomain.defaultTodoDeadline(new Date());
    if (refreshed) deadline = refreshed;
  }
  if (!addTodo(todoAddState.priority, text, deadline)) {
    showStatusToast('截止时间格式不正确');
    return;
  }
  closeTodoAddPopover();
  showStatusToast(`已添加到「${todoCategoryNames[todoAddState.priority] || todoAddState.priority}」`);
}

document.getElementById('todo-add-open')?.addEventListener('click', openTodoAddPopover);
document.getElementById('todo-add-close')?.addEventListener('click', closeTodoAddPopover);
document.getElementById('todo-add-cancel')?.addEventListener('click', closeTodoAddPopover);
todoAddBackdrop?.addEventListener('click', (event) => {
  if (event.target === todoAddBackdrop) closeTodoAddPopover();
});
todoAddCreate?.addEventListener('click', submitTodoAdd);
todoAddInput?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  if (e.repeat) return;
  submitTodoAdd();
});
todoAddTime?.addEventListener('click', () => {
  openTodoEditor(todoAddState.priority, null, todoAddTime);
  if (todoEditorContext) {
    todoEditorContext.onPick = (deadline) => {
      todoAddState.deadline = deadline;
      todoAddState.source = 'manual';
      renderTodoAddTime();
    };
  }
});

const todoProgressBackdrop = document.getElementById('todo-progress-backdrop');
const todoProgressTitle = document.getElementById('todo-progress-title');
const todoProgressStatus = document.getElementById('todo-progress-status');
const todoProgressText = document.getElementById('todo-progress-text');
const todoProgressNext = document.getElementById('todo-progress-next');
const todoProgressSave = document.getElementById('todo-progress-save');
let todoProgressContext = null;

function progressRecord(priority, id, key = weekKey()) {
  return todoProgress[key]?.[id] || { priority, status: '未开始', progress: '', nextWeek: '' };
}

function openTodoProgress(priority, id) {
  const todo = (data[priority] || []).find((item) => item.id === id);
  if (!todo || !todoProgressBackdrop) return;
  todoProgressContext = { priority, id };
  const record = progressRecord(priority, id);
  if (todoProgressTitle) todoProgressTitle.textContent = todo.text;
  if (todoProgressStatus) todoProgressStatus.value = record.status || '未开始';
  if (todoProgressText) todoProgressText.value = record.progress || '';
  if (todoProgressNext) todoProgressNext.value = record.nextWeek || '';
  todoProgressBackdrop.hidden = false;
  todoProgressText?.focus();
}

function closeTodoProgress() {
  if (todoProgressBackdrop) todoProgressBackdrop.hidden = true;
  todoProgressContext = null;
}

function saveTodoProgressRecord() {
  if (!todoProgressContext) return;
  const { priority, id } = todoProgressContext;
  const key = weekKey();
  if (!todoProgress[key]) todoProgress[key] = {};
  todoProgress[key][id] = {
    priority,
    status: todoProgressStatus?.value || '未开始',
    progress: String(todoProgressText?.value || '').trim().slice(0, 1200),
    nextWeek: String(todoProgressNext?.value || '').trim().slice(0, 1200),
    updatedAt: Date.now(),
  };
  saveTodoProgress();
  closeTodoProgress();
  renderList(priority);
  showStatusToast('本周进度已保存');
  // 上报云端
  const todo = (data[priority] || []).find((item) => item.id === id);
  if (todo && window.NexusDeskSync) {
    window.NexusDeskSync.reportTodoUpdated({ ...todo, status: todoProgress[key][id].status, progressText: todoProgress[key][id].progress, nextWeek: todoProgress[key][id].nextWeek }, priority);
  }
}

todoProgressSave?.addEventListener('click', saveTodoProgressRecord);
document.getElementById('todo-progress-cancel')?.addEventListener('click', closeTodoProgress);
document.getElementById('todo-progress-cancel-bottom')?.addEventListener('click', closeTodoProgress);
todoProgressBackdrop?.addEventListener('click', (event) => {
  if (event.target === todoProgressBackdrop) closeTodoProgress();
});

function weeklyTodoContext() {
  const key = weekKey();
  const current = PRIORITIES.flatMap((priority) => (data[priority] || []).map((item) => ({
    id: item.id,
    text: item.text,
    priority,
    project: item.project || '',
    deadline: item.deadline || '',
    status: todoProgress[key]?.[item.id]?.status || '未开始',
    progress: todoProgress[key]?.[item.id]?.progress || '',
    nextWeek: todoProgress[key]?.[item.id]?.nextWeek || '',
  })));
  const completed = todoHistory
    .filter((item) => weekKey(item.completedAt) === key)
    .map((item) => ({
      id: item.id,
      text: item.text,
      priority: item.priority,
      project: item.project || '',
      status: '已完成',
      progress: todoProgress[key]?.[item.id]?.progress || '',
    }));
  return { current, completed };
}

let weeklySelectedKey = null;
const DEFAULT_WEEKLY_PROMPT = '你是个人工作复盘助手。结合上周总结和本周待办，生成简洁、具体的中文周报。只返回 JSON：{"progress":"本周进展","status":"整体进度","nextWeek":"下周待办"}。每个字段使用 Markdown，避免空泛表扬。';

function renderWeeklySummary() {
  const key = weeklySelectedKey && weeklySummaries[weeklySelectedKey] ? weeklySelectedKey : weekKey();
  weeklySelectedKey = key;
  const summary = weeklySummaries[key];
  const fallbackLabel = weekLabel(new Date(`${key}T00:00:00`));
  const title = document.getElementById('weekly-title');
  const meta = document.getElementById('weekly-meta');
  const homeTitle = document.getElementById('todo-weekly-title');
  const homeMeta = document.getElementById('todo-weekly-meta');
  if (title) title.textContent = `本周复盘 · ${summary && summary.week ? summary.week : fallbackLabel}`;
  if (meta) meta.textContent = summary
    ? `已保存 · ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(summary.updatedAt || Date.now()))}`
    : '会结合上周总结和本周进度，生成本周进展、整体进度和下周待办。';
  const fields = [
    ['weekly-progress', summary && summary.progress],
    ['weekly-status', summary && summary.status],
    ['weekly-next', summary && summary.nextWeek],
  ];
  fields.forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.replaceChildren();
    if (!value) {
      element.textContent = '暂无记录';
      return;
    }
    element.append(buildMarkdownPreview(value));
  });
  if (homeTitle) homeTitle.textContent = summary ? `本周复盘 · ${summary.week || fallbackLabel}` : '本周复盘';
  if (homeMeta) homeMeta.textContent = summary
    ? `已保存 · ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(summary.updatedAt || Date.now()))}`
    : '会结合上周总结，生成本周进展、整体进度和下周待办。';
  const homeResult = document.getElementById('todo-weekly-result');
  if (homeResult) homeResult.hidden = !summary;
  const homeFields = [
    ['todo-weekly-progress', summary && summary.progress],
    ['todo-weekly-status', summary && summary.status],
    ['todo-weekly-next', summary && summary.nextWeek],
  ];
  homeFields.forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '暂无记录';
  });
  const brief = document.getElementById('home-weekly-brief');
  if (brief) {
    brief.replaceChildren();
    const current = weeklySummaries[weekKey()];
    if (current) {
      [['本周进展', current.progress], ['整体进度', current.status], ['下周待办', current.nextWeek]].forEach(([label, value]) => {
        const row = document.createElement('div');
        row.className = 'weekly-brief-row';
        const lb = document.createElement('span');
        lb.textContent = label;
        const tx = document.createElement('span');
        tx.textContent = String(value || '暂无记录').slice(0, 80);
        row.append(lb, tx);
        brief.append(row);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'weekly-brief-empty';
      empty.textContent = '本周还没有周报，点击「查看完整周报」去生成。';
      brief.append(empty);
    }
  }
  renderWeeklyHistory(key);
}

function renderWeeklyHistory(selectedKey) {
  const nav = document.getElementById('weekly-history');
  if (!nav) return;
  const keys = Object.keys(weeklySummaries).sort().reverse();
  if (!keys.length) {
    nav.hidden = true;
    nav.replaceChildren();
    return;
  }
  nav.hidden = false;
  nav.replaceChildren();
  const current = weekKey();
  const ordered = keys.includes(current) ? keys : [current, ...keys];
  ordered.forEach((key) => {
    const summary = weeklySummaries[key];
    const label = summary && summary.week ? summary.week : weekLabel(new Date(`${key}T00:00:00`));
    const item = document.createElement('div');
    item.className = 'weekly-history-item';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'weekly-history-chip';
    chip.textContent = label;
    chip.setAttribute('aria-pressed', String(key === selectedKey));
    chip.classList.toggle('active', key === selectedKey);
    chip.addEventListener('click', () => {
      weeklySelectedKey = key;
      renderWeeklySummary();
    });
    item.append(chip);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'weekly-history-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `删除 ${label} 周报`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      delete weeklySummaries[key];
      saveWeeklySummaries();
      if (weeklySelectedKey === key) {
        const remaining = Object.keys(weeklySummaries).sort().reverse();
        weeklySelectedKey = remaining[0] || null;
      }
      renderWeeklySummary();
    });
    item.append(remove);
    nav.append(item);
  });
}

async function generateWeeklySummary() {
  const button = document.getElementById('weekly-generate');
  if (!window.notchAPI?.summarizeWeek || !button) return;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = '整理中…';
  const meta = document.getElementById('weekly-meta');
  if (meta) meta.textContent = '正在整理本周进展…';
  const previous = weeklySummaries[previousWeekKey()];
  const result = await window.notchAPI.summarizeWeek({
    week: weekLabel(),
    current: weeklyTodoContext(),
    previousSummary: previous ? JSON.stringify(previous) : '',
    userPrompt: (localStorage.getItem('notch-todo-weekly-prompt-v1') || DEFAULT_WEEKLY_PROMPT).trim(),
  }).catch(() => ({ ok: false }));
  button.disabled = false;
  button.textContent = originalLabel;
  if (!result?.ok) {
    if (meta) meta.textContent = result?.error === 'not_configured'
      ? '请先在设置中配置 AI 的 Base URL 和 API Key，模型会自动获取。'
      : result?.error === 'model_not_found'
        ? '无法自动获取模型，请检查 Base URL，或在设置中手动填写模型。'
        : '生成失败，请检查 AI 配置和网络连接。';
    return;
  }
  const key = weekKey();
  weeklySummaries[key] = {
    week: weekLabel(),
    progress: result.progress,
    status: result.status,
    nextWeek: result.nextWeek,
    updatedAt: Date.now(),
  };
  saveWeeklySummaries();
  const homeResult = document.getElementById('todo-weekly-result');
  if (homeResult) homeResult.hidden = false;
  weeklySelectedKey = key;
  renderWeeklySummary();
}

document.getElementById('weekly-generate')?.addEventListener('click', generateWeeklySummary);
document.getElementById('todo-weekly-generate')?.addEventListener('click', generateWeeklySummary);
// ===== 待办全局模糊搜索（顶栏胶囊） =====
function fuzzyMatchScore(query, text) {
  const q = String(query || '').trim().toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!q || !t) return 0;
  if (t === q) return 10000;
  const idx = t.indexOf(q);
  if (idx === 0) return 9000 - t.length;
  if (idx > 0) return 8000 - idx * 4 - t.length;
  let qi = 0, score = 3000, lastPos = -1;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      const gap = lastPos < 0 ? i : i - lastPos - 1;
      score += 500 - Math.min(gap * 20, 300) - (i > 8 ? 40 : 0);
      lastPos = i;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

function searchAllTodos(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const data = loadData();
  const results = [];
  PRIORITIES.forEach((priority) => {
    (data[priority] || []).forEach((item) => {
      const titleScore = fuzzyMatchScore(q, item.text);
      const projectScore = fuzzyMatchScore(q, item.project);
      const score = Math.max(titleScore, projectScore);
      if (score > 0) results.push({ score, priority, item });
    });
  });
  results.sort((a, b) => b.score - a.score || String(a.item.deadline || '').localeCompare(String(b.item.deadline || '')));
  return results.slice(0, 24);
}

const TODO_SEARCH_COLORS = { P0: '#FF5F57', P1: '#FF9352', P2: '#30D978', P3: '#438CFF' };

function renderTodoSearchResults(query) {
  const box = document.getElementById('todo-search-results');
  if (!box) return;
  const results = searchAllTodos(query);
  if (!results.length) {
    box.innerHTML = '<div class="todo-search-empty">没有匹配的待办</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = results.map(({ priority, item }) => {
    const deadline = Number.isFinite(Date.parse(String(item.deadline || '')))
      ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(item.deadline))
      : '';
    const project = typeof item.project === 'string' && item.project.trim()
      ? `<span class="t-project">${escapeHtml(item.project.trim())}</span>` : '';
    return `<div class="todo-search-result" role="button" tabindex="0" data-priority="${priority}" data-id="${escapeHtml(item.id)}">
      <span class="t-dot" style="background:${TODO_SEARCH_COLORS[priority] || '#888'}"></span>
      <span class="t-text">${escapeHtml(item.text)}</span>
      ${project}
      <span class="t-meta">${item.done ? '<span class="t-done">已完成</span>' : ''}<span>${escapeHtml(deadline)}</span></span>
    </div>`;
  }).join('');
  box.hidden = false;
}

function highlightTodo(priority, id) {
  const el = document.querySelector(`.todo-item[data-priority="${CSS.escape(priority)}"][data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  el.classList.remove('todo-search-flash');
  void el.offsetWidth;
  el.classList.add('todo-search-flash');
  setTimeout(() => el.classList.remove('todo-search-flash'), 1600);
}

(function initTodoSearch() {
  const input = document.getElementById('todo-search-input');
  const box = document.getElementById('todo-search-results');
  if (!input || !box) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { box.hidden = true; return; }
    timer = setTimeout(() => renderTodoSearchResults(q), 120);
  });
  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q) renderTodoSearchResults(q);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { box.hidden = true; input.blur(); }
    if (e.key === 'Enter') { clearTimeout(timer); renderTodoSearchResults(input.value.trim()); }
  });
  box.addEventListener('click', (e) => {
    const row = e.target.closest('.todo-search-result');
    if (!row) return;
    box.hidden = true;
    input.value = '';
    setActiveTab('todo');
    highlightTodo(row.dataset.priority, row.dataset.id);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#todo-search')) box.hidden = true;
  });
})();

document.getElementById('todo-weekly-close')?.addEventListener('click', () => {
  const result = document.getElementById('todo-weekly-result');
  if (result) result.hidden = true;
});
document.getElementById('todo-weekly-open')?.addEventListener('click', () => setActiveTab('weekly'));
const weeklyPromptInput = document.getElementById('weekly-prompt-input');
if (weeklyPromptInput) weeklyPromptInput.value = localStorage.getItem('notch-todo-weekly-prompt-v1') || DEFAULT_WEEKLY_PROMPT;
document.getElementById('weekly-prompt-toggle')?.addEventListener('click', () => {
  const box = document.getElementById('weekly-prompt-box');
  if (!box) return;
  box.hidden = !box.hidden;
  if (!box.hidden) document.getElementById('weekly-prompt-input')?.focus();
});
document.getElementById('weekly-prompt-save')?.addEventListener('click', () => {
  const input = document.getElementById('weekly-prompt-input');
  const box = document.getElementById('weekly-prompt-box');
  if (!input || !box) return;
  const value = input.value.trim();
  if (value) localStorage.setItem('notch-todo-weekly-prompt-v1', value);
  else localStorage.removeItem('notch-todo-weekly-prompt-v1');
  box.hidden = true;
});
document.getElementById('weekly-prompt-reset')?.addEventListener('click', () => {
  const input = document.getElementById('weekly-prompt-input');
  const box = document.getElementById('weekly-prompt-box');
  if (input) input.value = DEFAULT_WEEKLY_PROMPT;
  localStorage.removeItem('notch-todo-weekly-prompt-v1');
  if (box) box.hidden = true;
});
// 初始渲染延后到同步流结束：buildMarkdownPreview 依赖的常量（NOTE_FENCE_RE 等）在文件后部定义，
// 立即调用会触发 TDZ ReferenceError，导致整个渲染脚本中断。
setTimeout(() => renderWeeklySummary(), 0);

function applyDefaultTodoDeadline(trigger, now = new Date()) {
  if (!trigger || (trigger.dataset.deadline && trigger.dataset.deadlineSource !== 'default')) return;
  const deadline = window.NotchDomain.defaultTodoDeadline(now);
  if (!deadline) return;
  if (trigger.dataset.deadline === deadline && trigger.dataset.deadlineSource === 'default') return;
  trigger.dataset.deadline = deadline;
  trigger.dataset.deadlineSource = 'default';
  trigger.querySelector('span').textContent = new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(deadline));
  trigger.classList.add('selected');
}

function resetTodoDraftDeadline(trigger, now = new Date()) {
  if (!trigger) return;
  delete trigger.dataset.deadline;
  delete trigger.dataset.deadlineSource;
  applyDefaultTodoDeadline(trigger, now);
}

function refreshDefaultTodoDeadlines(now = new Date()) {
  document.querySelectorAll('.todo-deadline-trigger[data-deadline-priority]').forEach((trigger) => {
    if (trigger.dataset.deadlineSource === 'manual') return;
    applyDefaultTodoDeadline(trigger, now);
  });
}

PRIORITIES.forEach((priority) => {
  const input = document.querySelector(`.add-row input[data-priority="${priority}"]`);
  const deadlineInput = document.querySelector(`.todo-deadline-trigger[data-deadline-priority="${priority}"]`);
  if (!input) return;
  applyDefaultTodoDeadline(deadlineInput);

  const submitTodo = () => {
    const value = input.value;
    if (!value.trim()) return;
    // Sleep or midnight may have passed since the form was rendered.
    applyDefaultTodoDeadline(deadlineInput);
    if (!deadlineInput || !deadlineInput.dataset.deadline) {
      deadlineInput?.classList.add('invalid');
      openTodoEditor(priority);
      return;
    }
    if (!addTodo(priority, value, deadlineInput.dataset.deadline)) {
      deadlineInput.classList.add('invalid');
      showStatusToast('截止时间格式不正确');
      return;
    }
    input.value = '';
    if (todoEditorContext?.mode === 'add' && todoEditorContext.priority === priority) closeTodoEditor();
    resetTodoDraftDeadline(deadlineInput);
    deadlineInput.classList.remove('invalid');
    input.focus({ preventScroll: true });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (e.repeat) return;
    submitTodo();
  });
  input.addEventListener('focus', () => applyDefaultTodoDeadline(deadlineInput));
  deadlineInput?.addEventListener('click', () => openTodoEditor(priority));
});

PRIORITIES.forEach((priority) => {
  const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
  if (!list) return;
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    if (e.shiftKey) {
      e.preventDefault();
      const result = window.NotchDomain.updateRangeSelection(
        todoDisplayOrder(priority).map((todo) => todo.id),
        [...todoSelections[priority]],
        id,
        todoSelectionAnchors[priority],
        true
      );
      todoSelections[priority] = new Set(result.selected);
      todoSelectionAnchors[priority] = result.anchor;
      renderList(priority);
      return;
    }
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle') {
      toggleTodo(priority, id);
    } else if (action === 'edit') {
      const todo = (data[priority] || []).find((item) => item.id === id);
      if (todo) {
        editingTodo = { priority, id };
        renderList(priority);
        requestAnimationFrame(() => document.querySelector(`.todo-item[data-id="${CSS.escape(id)}"] .todo-inline-name`)?.focus({ preventScroll: true }));
      }
    } else if (action === 'edit-deadline') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      if (todo) openTodoEditor(priority, todo, target);
    } else if (action === 'save-edit') {
      const todo = (data[priority] || []).find((candidate) => candidate.id === id);
      const name = item.querySelector('.todo-inline-name')?.value.trim() || '';
      if (!todo || !name || !todo.deadline) return;
      editingTodo = null;
      editTodo(priority, id, name, todo.deadline);
    } else if (action === 'delete') {
      deleteTodo(priority, id);
    } else if (action === 'progress') {
      openTodoProgress(priority, id);
    } else if (action === 'edit-project') {
      editingProject = { priority, id };
      renderList(priority);
      requestAnimationFrame(() => {
        const input = document.querySelector(`.todo-item[data-id="${id}"] .todo-project-input`);
        input?.focus();
        input?.select();
      });
    }
  });
  list.addEventListener('keydown', (event) => {
    const item = event.target.closest('.todo-item');
    if (event.target.matches('.todo-project-input')) {
      if (event.key === 'Escape') { editingProject = null; renderList(priority); }
      else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.target.blur(); }
      return;
    }
    if (!item || !event.target.matches('.todo-inline-name')) return;
    if (event.key === 'Escape') {
      editingTodo = null;
      renderList(priority);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      item.querySelector('[data-action="save-edit"]')?.click();
    }
  });

  list.addEventListener('focusout', (event) => {
    if (!event.target.matches('.todo-project-input')) return;
    const input = event.target;
    const value = input.value.trim().slice(0, 24);
    const itemEl = input.closest('.todo-item');
    if (itemEl && editingProject) {
      const list2 = data[editingProject.priority] || [];
      const idx = list2.findIndex((todo) => todo.id === editingProject.id);
      if (idx !== -1) {
        if (value) list2[idx].project = value;
        else delete list2[idx].project;
        saveData(data);
        window.NexusDeskSync?.reportTodoUpdated(list2[idx], editingProject.priority);
        // 原位替换 chip，不重建整行：避免打断进行中的长按拖拽
        const slot = itemEl.querySelector('.todo-project-chip, .todo-project-add, .todo-project-input');
        if (slot) {
          const priColor = { P0: '#FF5F57', P1: '#FF9352', P2: '#30D978', P3: '#438CFF' }[editingProject.priority] || '#8a8a8a';
          const fresh = value
            ? `<span class="todo-project-chip" data-action="edit-project" data-project="${escapeHtml(value)}" style="--project-color:${priColor}" title="项目：${escapeHtml(value)}（点击修改）">${escapeHtml(value)}</span>`
            : `<button class="todo-project-chip todo-project-add" type="button" data-action="edit-project" title="添加项目">+</button>`;
          slot.outerHTML = fresh;
        }
      }
      editingProject = null;
    } else {
      editingProject = null;
    }
  });
});

// ============ 待办长按拖拽：列内排序 + 跨列搬运 ============
// 与链接拖拽同一套指针事件 + 长按门槛：短按保留「点击行主体 = 编辑」的语义，
// 按住行主体 340ms 进入拖拽，拖拽结束补发的 click 会被拦掉，不会误开编辑。
const TODO_DRAG_HOLD_MS = 340;
const TODO_DRAG_MOVE_CANCEL = 8;
let todoDrag = null;
let suppressTodoClick = false;

function clearTodoDropMarks() {
  document.querySelectorAll('.todo-item.drop-before, .todo-item.drop-after, .todo-group-head.drop-project').forEach((el) => {
    el.classList.remove('drop-before', 'drop-after', 'drop-project');
  });
}

function cancelTodoDrag() {
  if (!todoDrag) return;
  clearTimeout(todoDrag.holdTimer);
  if (todoDrag.active) {
    todoDrag.row.classList.remove('dragging');
    todoDrag.row.closest('.todo-list')?.classList.remove('todo-dragging');
    clearTodoDropMarks();
  }
  try { todoDrag.row.releasePointerCapture(todoDrag.pointerId); } catch (error) {}
  todoDrag.row.classList.remove('grab-pending');
  todoDrag = null;
}

function updateTodoDropTarget(clientX, clientY) {
  clearTodoDropMarks();
  todoDrag.target = null;
  const under = document.elementFromPoint(clientX, clientY);
  if (!under) return;
  // 拖到项目分组头：自动归纳到该项目（移入该列并归组）
  const overHead = under.closest('.todo-group-head[data-project]');
  if (overHead) {
    overHead.classList.add('drop-project');
    todoDrag.target = {
      priority: overHead.dataset.priority,
      index: -1,
      project: overHead.dataset.project,
    };
    return;
  }
  const overItem = under.closest('.todo-item[data-id]');
  // 压在被拖那一行自己身上 = 放回原处，目标留空，松手什么都不做。
  if (overItem === todoDrag.row) return;
  if (overItem) {
    const rect = overItem.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    overItem.classList.add(after ? 'drop-after' : 'drop-before');
    // 分组视图下 DOM 顺序与平铺数据顺序不同，索引一律按平铺显示顺序计算
    const overItems = todoDisplayOrder(overItem.dataset.priority);
    const overIdx = overItems.findIndex((todo) => todo.id === overItem.dataset.id);
    todoDrag.target = {
      priority: overItem.dataset.priority,
      index: overIdx + (after ? 1 : 0),
    };
    return;
  }
  const overList = under.closest('.todo-list[data-priority]');
  if (!overList) return;
  todoDrag.target = {
    priority: overList.dataset.priority,
    index: todoDisplayOrder(overList.dataset.priority).length,
  };
}

// 把拖拽目标换算成目标列的显示 id 序列，落盘到数据与手动顺序。
function applyTodoMove(fromPriority, id, target) {
  const toPriority = target.priority;
  const fromList = data[fromPriority] || [];
  const idx = fromList.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  const item = fromList[idx];
  const ids = todoDisplayOrder(toPriority).map((todo) => todo.id);
  const prevIndex = ids.indexOf(id);
  if (prevIndex !== -1) ids.splice(prevIndex, 1);
  let targetIndex = target.index;
  if (target.project) {
    // 拖到项目分组头：自动归纳到该项目，追加到该组现有项之后
    item.project = target.project;
    let groupEnd = 0;
    for (const other of data[toPriority] || []) {
      if (other.id === id || String(other.project || '') !== target.project) continue;
      const otherIdx = ids.indexOf(other.id);
      if (otherIdx !== -1) groupEnd = Math.max(groupEnd, otherIdx + 1);
    }
    targetIndex = groupEnd;
  } else {
    if (prevIndex !== -1 && prevIndex < targetIndex) targetIndex -= 1;
  }
  targetIndex = Math.max(0, Math.min(targetIndex, ids.length));
  if (prevIndex !== -1 && targetIndex === prevIndex && !target.project) return false;
  ids.splice(targetIndex, 0, id);
  fromList.splice(idx, 1);
  if (fromPriority !== toPriority) {
    (data[toPriority] || (data[toPriority] = [])).push(item);
  } else {
    // 同列排序：数据数组里放回原项，显示顺序由 todoOrder 控制，避免待办丢失
    data[fromPriority] = data[fromPriority] || [];
    data[fromPriority].push(item);
  }
  todoOrder[toPriority] = ids;
  if (fromPriority !== toPriority && todoOrder[fromPriority]) {
    todoOrder[fromPriority] = todoOrder[fromPriority].filter((other) => other !== id);
  }
  saveData(data);
  saveTodoOrder();
  window.NexusDeskSync?.reportTodoUpdated(item, toPriority);
  return true;
}

function captureTodoPositionsAcross(priorities) {
  const positions = new Map();
  for (const priority of new Set(priorities)) {
    const list = document.querySelector(`.todo-list[data-priority="${priority}"]`);
    if (!list) continue;
    list.querySelectorAll('.todo-item[data-id]').forEach((el) => {
      positions.set(el.dataset.id, el.getBoundingClientRect());
    });
  }
  return positions;
}

document.querySelectorAll('.todo-list').forEach((list) => {
  list.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.shiftKey) return;
    const row = event.target.closest('.todo-item[data-id]');
    // 勾选、删除、编辑态与多选行不参与拖拽；行主体（含文字/时间）可长按拖。
    if (!row || event.target.closest('.checkbox, .delete, .todo-inline-editor')) return;
    suppressTodoClick = false;
    cancelTodoDrag();
    todoDrag = {
      row,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
      holdTimer: setTimeout(() => {
        if (!todoDrag) return;
        todoDrag.active = true;
        row.classList.add('dragging');
        row.classList.remove('grab-pending');
        row.closest('.todo-list')?.classList.add('todo-dragging');
        try { row.setPointerCapture(todoDrag.pointerId); } catch (error) {}
        updateTodoDropTarget(todoDrag.startX, todoDrag.startY);
      }, TODO_DRAG_HOLD_MS),
    };
    row.classList.add('grab-pending');
  });

  // 拖拽结束后浏览器仍会补一个 click，必须在捕获阶段拦掉，否则松手即打开编辑。
  list.addEventListener('click', (event) => {
    if (!suppressTodoClick) return;
    suppressTodoClick = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);
});

document.addEventListener('pointermove', (event) => {
  if (!todoDrag || event.pointerId !== todoDrag.pointerId) return;
  if (!todoDrag.active) {
    // 长按还没满就移动，说明用户在滚动或只是手抖，放弃这次拖拽。
    const moved = Math.abs(event.clientX - todoDrag.startX) > TODO_DRAG_MOVE_CANCEL
      || Math.abs(event.clientY - todoDrag.startY) > TODO_DRAG_MOVE_CANCEL;
    if (moved) cancelTodoDrag();
    return;
  }
  event.preventDefault();
  updateTodoDropTarget(event.clientX, event.clientY);
});

document.addEventListener('pointerup', (event) => {
  if (!todoDrag || event.pointerId !== todoDrag.pointerId) return;
  const wasActive = todoDrag.active;
  const target = todoDrag.target;
  const id = todoDrag.row.dataset.id;
  const fromPriority = todoDrag.row.dataset.priority;
  const affected = [...new Set([fromPriority, target?.priority].filter(Boolean))];
  const previousPositions = wasActive ? captureTodoPositionsAcross(affected) : new Map();
  cancelTodoDrag();
  if (!wasActive) return;
  suppressTodoClick = true;
  if (!target) return;
  if (!applyTodoMove(fromPriority, id, target)) return;
  affected.forEach((priority) => {
    renderList(priority, { previousPositions });
    updateCount(priority);
  });
  showStatusToast(fromPriority === target.priority ? '待办顺序已更新' : '待办已移动');
});

// ============ 折叠态点击穿透：黑条可点，黑条旁穿透到下方应用 ============
// 主进程在折叠态默认整体穿透（forward 转发 mousemove），这里按鼠标是否落在黑条上
// 动态恢复/保持穿透：鼠标在黑条内 -> 可点击（点开工作台），在黑条旁 -> 点击落到下方应用。
let notchPenetrable = true; // 与主进程当前 setIgnoreMouseEvents 状态一致

function updateNotchPenetration(clientX, clientY) {
  if (isExpanded) {
    if (!notchPenetrable) {
      notchPenetrable = true;
      window.notchAPI?.setIgnoreMouse?.(false);
    }
    return;
  }
  const notch = document.getElementById('notch');
  if (!notch) return;
  const r = notch.getBoundingClientRect();
  const over = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  const penetrate = !over;
  if (penetrate === notchPenetrable) return;
  notchPenetrable = penetrate;
  window.notchAPI?.setIgnoreMouse?.(penetrate);
}

document.addEventListener('pointermove', (event) => {
  updateNotchPenetration(event.clientX, event.clientY);
});

document.addEventListener('pointercancel', () => cancelTodoDrag());

document.querySelectorAll('.todo-bulk-delete[data-bulk-priority]').forEach((button) => {
  button.addEventListener('click', () => {
    const priority = button.dataset.bulkPriority;
    const selected = todoSelections[priority];
    if (!selected || !selected.size) return;
    data[priority] = (data[priority] || []).filter((item) => !selected.has(item.id));
    selected.clear();
    todoSelectionAnchors[priority] = null;
    saveData(data);
    renderList(priority);
    updateCount(priority);
    showStatusToast('已删除所选待办');
  });
});

// ============ 待办 · 常驻跨天刷新 ============
// Draft dates must not depend on a home clock widget being present or visible.
let todoDefaultRefreshKey = '';

function tickTodoDefaultDeadlines() {
  const now = new Date();
  const refreshKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getTimezoneOffset()}`;
  if (refreshKey !== todoDefaultRefreshKey) {
    todoDefaultRefreshKey = refreshKey;
    refreshDefaultTodoDeadlines(now);
  }
}

tickTodoDefaultDeadlines();
setInterval(tickTodoDefaultDeadlines, 1000);
window.addEventListener('focus', () => refreshDefaultTodoDeadlines());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDefaultTodoDeadlines();
});
document.addEventListener('notch:modechange', (event) => {
  if (event.detail?.expanded) refreshDefaultTodoDeadlines();
});
document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab === 'todo') refreshDefaultTodoDeadlines();
});


// ============ 首页 · Markdown 速记 ============
// textarea 中的原始 Markdown 始终是唯一数据源；预览只用 DOM API + textContent 构建，
// 不执行用户输入的 HTML，也不自动加载远程图片。
const NOTE_KEY = 'notch-home-note';
const NOTE_ARCHIVE_KEY = 'notch-note-archive-v1';
const NOTE_ACTIVE_ARCHIVE_KEY = 'notch-note-active-archive-v1';
const noteInput = document.getElementById('home-note');
const notePreview = document.getElementById('home-note-preview');
const noteSaveButton = document.getElementById('note-save-btn');
const notesList = document.getElementById('notes-list');
const notesSearch = document.getElementById('notes-search');
const notesDetail = document.getElementById('notes-detail');
const notesCount = document.getElementById('notes-count');
const noteFormatActions = document.getElementById('note-format-actions');
const noteModeButtons = Array.from(document.querySelectorAll('[data-note-mode]'));
const noteEditButton = document.getElementById('note-edit-btn');
const homeNote = document.querySelector('.home-note');

const NOTE_INLINE_PATTERNS = [
  { type: 'code', regex: /`([^`\n]+)`/g },
  { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
  { type: 'strong', regex: /\*\*([^*\n]+)\*\*/g },
  { type: 'strong', regex: /__([^_\n]+)__/g },
  { type: 'delete', regex: /~~([^~\n]+)~~/g },
  { type: 'emphasis', regex: /\*([^*\n]+)\*/g },
  { type: 'emphasis', regex: /_([^_\n]+)_/g },
];

const NOTE_TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const NOTE_BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NOTE_ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const NOTE_QUOTE_RE = /^\s*>\s?(.*)$/;
const NOTE_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+)$/;
const NOTE_FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/;
const NOTE_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function findNextInlineToken(text, fromIndex) {
  let next = null;
  NOTE_INLINE_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = fromIndex;
    const match = pattern.regex.exec(text);
    if (
      match &&
      (!next || match.index < next.match.index ||
        (match.index === next.match.index && priority < next.priority))
    ) {
      next = { type: pattern.type, match, priority };
    }
  });
  return next;
}

function safeMarkdownUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (e) {
    return null;
  }
}

function appendInlineMarkdown(parent, source, depth = 0) {
  const text = String(source || '');
  if (!text || depth > 6) {
    if (text) parent.append(document.createTextNode(text));
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor);
    if (!token) {
      parent.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    const { type, match } = token;
    if (match.index > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (type === 'code') {
      const code = document.createElement('code');
      code.textContent = match[1];
      parent.append(code);
    } else if (type === 'link') {
      const href = safeMarkdownUrl(match[2]);
      if (!href) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const link = document.createElement('a');
        link.dataset.noteHref = href;
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        link.rel = 'noreferrer';
        appendInlineMarkdown(link, match[1], depth + 1);
        parent.append(link);
      }
    } else {
      const tagName = type === 'strong' ? 'strong' : type === 'delete' ? 'del' : 'em';
      const formatted = document.createElement(tagName);
      appendInlineMarkdown(formatted, match[1], depth + 1);
      parent.append(formatted);
    }

    cursor = match.index + match[0].length;
  }
}

function appendMarkdownLines(parent, lines) {
  lines.forEach((line, index) => {
    if (index > 0) parent.append(document.createElement('br'));
    appendInlineMarkdown(parent, line);
  });
}

function isMarkdownBlockStart(line) {
  if (!line.trim()) return true;
  return (
    NOTE_FENCE_RE.test(line) ||
    NOTE_HEADING_RE.test(line) ||
    NOTE_QUOTE_RE.test(line) ||
    NOTE_TASK_RE.test(line) ||
    NOTE_ORDERED_RE.test(line) ||
    NOTE_BULLET_RE.test(line) ||
    NOTE_RULE_RE.test(line)
  );
}

function buildMarkdownPreview(source) {
  const fragment = document.createDocumentFragment();
  const normalized = String(source || '').replace(/\r\n?/g, '\n');

  if (!normalized.trim()) {
    const empty = document.createElement('p');
    empty.className = 'note-preview-empty';
    empty.textContent = '写点内容后，在这里查看排版';
    fragment.append(empty);
    return fragment;
  }

  const lines = normalized.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(NOTE_FENCE_RE);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLength = fenceMatch[1].length;
      const closeFence = new RegExp('^\\s*' + fenceChar + '{' + fenceLength + ',}\\s*$');
      const codeLines = [];
      index += 1;
      while (index < lines.length && !closeFence.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fenceMatch[2]) code.dataset.language = fenceMatch[2];
      code.textContent = codeLines.join('\n');
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const headingMatch = line.match(NOTE_HEADING_RE);
    if (headingMatch) {
      const heading = document.createElement('h' + headingMatch[1].length);
      appendInlineMarkdown(heading, headingMatch[2]);
      fragment.append(heading);
      index += 1;
      continue;
    }

    if (NOTE_RULE_RE.test(line)) {
      fragment.append(document.createElement('hr'));
      index += 1;
      continue;
    }

    const quoteMatch = line.match(NOTE_QUOTE_RE);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(NOTE_QUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      const quote = document.createElement('blockquote');
      appendMarkdownLines(quote, quoteLines);
      fragment.append(quote);
      continue;
    }

    const taskMatch = line.match(NOTE_TASK_RE);
    if (taskMatch) {
      const list = document.createElement('ul');
      list.className = 'note-task-list';
      while (index < lines.length) {
        const match = lines[index].match(NOTE_TASK_RE);
        if (!match) break;
        const done = match[1].toLowerCase() === 'x';
        const item = document.createElement('li');
        item.className = 'note-task-item' + (done ? ' done' : '');
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', String(done));
        const box = document.createElement('span');
        box.className = 'note-task-box';
        box.setAttribute('aria-hidden', 'true');
        box.textContent = done ? '✓' : '';
        const content = document.createElement('span');
        appendInlineMarkdown(content, match[2]);
        item.append(box, content);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const orderedMatch = line.match(NOTE_ORDERED_RE);
    if (orderedMatch) {
      const list = document.createElement('ol');
      const start = Number.parseInt(orderedMatch[1], 10);
      if (Number.isFinite(start) && start !== 1) list.start = start;
      while (index < lines.length) {
        const match = lines[index].match(NOTE_ORDERED_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[2]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const bulletMatch = line.match(NOTE_BULLET_RE);
    if (bulletMatch) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        if (NOTE_TASK_RE.test(lines[index])) break;
        const match = lines[index].match(NOTE_BULLET_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[1]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendMarkdownLines(paragraph, paragraphLines);
    fragment.append(paragraph);
  }

  return fragment;
}

function renderNotePreview() {
  if (!noteInput || !notePreview) return;
  notePreview.replaceChildren(buildMarkdownPreview(noteInput.value));
}

function replaceNoteText(
  start,
  end,
  replacement,
  selectionStart,
  selectionEnd,
  selectionDirection = 'none'
) {
  if (!noteInput) return;
  noteInput.setRangeText(replacement, start, end, 'end');
  noteInput.focus({ preventScroll: true });
  noteInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapNoteSelection(open, close, placeholder) {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);

  const hasOuterMarkers =
    selected &&
    start >= open.length &&
    noteInput.value.slice(start - open.length, start) === open &&
    noteInput.value.slice(end, end + close.length) === close;
  if (hasOuterMarkers) {
    replaceNoteText(
      start - open.length,
      end + close.length,
      selected,
      start - open.length,
      end - open.length,
      direction
    );
    return;
  }

  if (selected && selected.startsWith(open) && selected.endsWith(close)) {
    const unwrapped = selected.slice(open.length, selected.length - close.length);
    replaceNoteText(start, end, unwrapped, start, start + unwrapped.length, direction);
    return;
  }

  const content = selected || placeholder;
  const replacement = open + content + close;
  replaceNoteText(
    start,
    end,
    replacement,
    start + open.length,
    start + open.length + content.length,
    direction
  );
}

function stripNoteBlockPrefix(line) {
  return line.replace(
    /^(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/,
    ''
  );
}

function applyNoteLineFormat(type) {
  if (!noteInput) return;
  const value = noteInput.value;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd;
  if (end > start && value[end - 1] === '\n') {
    lineEnd = end - 1;
  } else {
    const nextBreak = value.indexOf('\n', end);
    lineEnd = nextBreak === -1 ? value.length : nextBreak;
  }

  const original = value.slice(lineStart, lineEnd);
  const lines = original.split('\n');
  const matchers = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
    ordered: /^\d+[.)]\s+/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    quote: /^>\s+/,
  };
  const matcher = matchers[type];
  if (!matcher) return;
  const nonEmptyLines = lines.filter((line) => line.trim());
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => matcher.test(line.trimStart()));
  let orderedIndex = 1;

  const transformed = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    if (shouldRemove) return indentation + body.replace(matcher, '');
    const content = stripNoteBlockPrefix(body) || (
      type === 'heading' ? '标题' :
      type === 'task' ? '待办' :
      type === 'quote' ? '引用' : '项目'
    );
    if (type === 'ordered') return indentation + String(orderedIndex++) + '. ' + content;
    if (type === 'heading') return indentation + '# ' + content;
    if (type === 'task') return indentation + '- [ ] ' + content;
    if (type === 'quote') return indentation + '> ' + content;
    return indentation + '- ' + content;
  }).join('\n');

  const emptySingleLine = lines.length === 1 && !original.trim() && !shouldRemove;
  let nextStart = lineStart;
  let nextEnd = lineStart + transformed.length;
  if (emptySingleLine) {
    const indentationLength = original.match(/^\s*/)[0].length;
    const prefixLength =
      type === 'heading' ? 2 :
      type === 'task' ? 6 :
      type === 'ordered' ? 3 : 2;
    nextStart += indentationLength + prefixLength;
  }
  replaceNoteText(lineStart, lineEnd, transformed, nextStart, nextEnd, direction);
}

function applyNoteLink() {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);
  const label = selected || '链接文字';
  const url = 'https://';
  const replacement = '[' + label + '](' + url + ')';
  if (selected) {
    const urlStart = start + label.length + 3;
    replaceNoteText(start, end, replacement, urlStart, urlStart + url.length, direction);
  } else {
    replaceNoteText(start, end, replacement, start + 1, start + 1 + label.length, direction);
  }
}

let noteComposing = false;

function applyNoteFormat(type) {
  if (!noteInput || noteComposing) return;
  if (type === 'bold') return wrapNoteSelection('**', '**', '加粗文字');
  if (type === 'italic') return wrapNoteSelection('*', '*', '斜体文字');
  if (type === 'code') return wrapNoteSelection('`', '`', '代码');
  if (type === 'link') return applyNoteLink();
  applyNoteLineFormat(type);
}

let noteMode = 'edit';
let noteSelection = { start: 0, end: 0, direction: 'none', scrollTop: 0 };

function setNoteMode(mode, focusTarget = true) {
  if (!noteInput || !notePreview) return;
  const previousMode = noteMode;
  noteMode = mode === 'preview' ? 'preview' : 'edit';
  const isPreview = noteMode === 'preview';

  if (isPreview) {
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
    renderNotePreview();
  } else if (previousMode === 'edit') {
    // 重复点击已选中的“编辑”时保留用户当下光标，而不是恢复旧选区。
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
  }

  noteInput.hidden = isPreview;
  notePreview.hidden = !isPreview;
  if (noteFormatActions) noteFormatActions.hidden = isPreview;
  if (homeNote) homeNote.classList.toggle('is-preview', isPreview);
  noteModeButtons.forEach((button) => {
    const active = button.dataset.noteMode === noteMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (noteEditButton) {
    noteEditButton.classList.toggle('active', !isPreview);
    noteEditButton.textContent = isPreview ? '编辑' : '完成';
    noteEditButton.setAttribute('aria-pressed', String(!isPreview));
  }

  if (!focusTarget) return;
  requestAnimationFrame(() => {
    if (isPreview) {
      notePreview.focus({ preventScroll: true });
    } else {
      noteInput.focus({ preventScroll: true });
      noteInput.setSelectionRange(
        noteSelection.start,
        noteSelection.end,
        noteSelection.direction
      );
      noteInput.scrollTop = noteSelection.scrollTop;
    }
  });
}

function continueNoteList(event) {
  if (
    !noteInput ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing ||
    noteInput.selectionStart !== noteInput.selectionEnd
  ) {
    return false;
  }

  const value = noteInput.value;
  const cursor = noteInput.selectionStart;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = value.indexOf('\n', cursor);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const patterns = [
    {
      regex: /^(\s*)[-*+]\s+\[[ xX]\]\s*(.*)$/,
      prefix: () => '- [ ] ',
    },
    {
      regex: /^(\s*)(\d+)[.)]\s+(.*)$/,
      prefix: (match) => String(Number.parseInt(match[2], 10) + 1) + '. ',
    },
    {
      regex: /^(\s*)[-*+]\s+(.*)$/,
      prefix: () => '- ',
    },
    {
      regex: /^(\s*)>\s?(.*)$/,
      prefix: () => '> ',
    },
  ];

  const definition = patterns.find((candidate) => candidate.regex.test(line));
  if (!definition) return false;
  const match = line.match(definition.regex);
  const content = match[match.length - 1];
  const indentation = match[1];
  event.preventDefault();

  if (!content.trim()) {
    replaceNoteText(
      lineStart,
      lineEnd,
      indentation,
      lineStart + indentation.length,
      lineStart + indentation.length
    );
    return true;
  }

  const prefix = indentation + definition.prefix(match);
  const insertion = '\n' + prefix;
  replaceNoteText(cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

if (noteInput) {
  try {
    noteInput.value = localStorage.getItem(NOTE_KEY) || '';
  } catch (e) {
    // ignore
  }

  let noteTimer = null;
  const saveNote = () => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    if (workspaceReloadPending) return;
    try {
      localStorage.setItem(NOTE_KEY, noteInput.value);
    } catch (e) {
      // ignore quota errors
    }
  };

  noteInput.addEventListener('input', () => {
    if (!noteInput.value.trim()) localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    renderNotePreview();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 300);
  });
  noteInput.addEventListener('blur', saveNote);
  noteInput.addEventListener('compositionstart', () => {
    noteComposing = true;
  });
  noteInput.addEventListener('compositionend', () => {
    noteComposing = false;
  });
  noteInput.addEventListener('keydown', (event) => {
    if (continueNoteList(event)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    event.preventDefault();
    applyNoteFormat(key === 'b' ? 'bold' : 'italic');
  });

  window.addEventListener('beforeunload', saveNote);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNote();
  });

  noteInput.hidden = false;
}

function loadNoteArchive() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTE_ARCHIVE_KEY) || '[]');
    return window.NotchDomain.normalizeNoteArchive(parsed);
  } catch (error) {
    return [];
  }
}

let selectedNoteId = '';

function noteArchiveTitle(note) {
  return String(note && note.title || '').trim() || '未命名笔记';
}

function noteArchiveExcerpt(note) {
  const lines = String(note && note.content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.join(' ').replace(/[#*_~`>\[\]]/g, '').slice(0, 86);
}

function noteArchiveTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function renderNotesDetail(notes = loadNoteArchive()) {
  if (!notesDetail) return;
  notesDetail.replaceChildren();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) {
    const empty = document.createElement('div');
    empty.className = 'notes-detail-empty';
    const hasArchive = loadNoteArchive().length > 0;
    empty.innerHTML = hasArchive
      ? '<span class="notes-empty-mark" aria-hidden="true">⌕</span><strong>没有匹配的笔记</strong><p>试试搜索其他关键词。</p>'
      : '<span class="notes-empty-mark" aria-hidden="true">✎</span><strong>还没有保存的笔记</strong><p>在首页的「随笔记」中写下内容，点击保存后会出现在这里。</p>';
    notesDetail.append(empty);
    return;
  }

  const header = document.createElement('header');
  header.className = 'notes-detail-head';
  const heading = document.createElement('div');
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'notes-detail-title';
  title.dataset.noteId = note.id;
  title.value = String(note.title || '');
  title.placeholder = '未命名笔记';
  title.maxLength = 80;
  title.autocomplete = 'off';
  title.spellcheck = false;
  title.setAttribute('aria-label', '笔记标题，可直接修改');
  const time = document.createElement('time');
  time.className = 'notes-detail-time';
  time.textContent = `更新于 ${noteArchiveTime(note.updatedAt)}`;
  heading.append(title, time);
  const actions = document.createElement('div');
  actions.className = 'notes-detail-actions';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'notes-delete';
  remove.dataset.action = 'delete-note';
  remove.setAttribute('aria-label', '删除笔记');
  remove.title = '删除笔记';
  remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h10l1-12"/></svg>';
  actions.append(remove);
  header.append(heading, actions);

  const editor = document.createElement('textarea');
  editor.id = 'notes-editor';
  editor.className = 'notes-editor';
  editor.dataset.noteId = note.id;
  editor.value = note.content;
  editor.placeholder = '直接输入笔记内容…';
  editor.setAttribute('aria-label', `编辑笔记：${noteArchiveTitle(note)}`);
  editor.spellcheck = false;
  notesDetail.append(header, editor);
  requestNoteTitle(note);
}

let notesSaveTimer = null;
let pendingNotesEditor = null;
const noteTitleAttempts = new Set();

async function requestNoteTitle(note) {
  if (
    !note
    || note.title
    || note.titleSource === 'user'
    || !String(note.content || '').trim()
    || noteTitleAttempts.has(note.id)
    || !window.notchAPI?.organizeMaterial
  ) return;
  noteTitleAttempts.add(note.id);
  const expectedContent = note.content;
  const result = await window.notchAPI.organizeMaterial({ kind: 'note', text: expectedContent }).catch(() => null);
  if (!result?.ok || !result.title) {
    noteTitleAttempts.delete(note.id);
    return;
  }
  const next = window.NotchDomain.applyGeneratedNoteTitle(
    loadNoteArchive(),
    note.id,
    result.title,
    expectedContent
  );
  const updated = next.find((item) => item.id === note.id);
  if (!updated?.title || updated.titleSource !== 'model') {
    noteTitleAttempts.delete(note.id);
    return;
  }
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next.slice(0, 200)));
  renderNotesLibrary();
}

function updateSavedNotePresentation(note) {
  if (!note) return;
  const title = noteArchiveTitle(note);
  const detailTitle = notesDetail?.querySelector('.notes-detail-title');
  const detailTime = notesDetail?.querySelector('.notes-detail-time');
  if (detailTitle && document.activeElement !== detailTitle) detailTitle.value = note.title || '';
  if (detailTime) detailTime.textContent = `已保存 · ${noteArchiveTime(note.updatedAt)}`;
  const row = notesList?.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
  if (!row) return;
  const rowTitle = row.querySelector('strong');
  const rowExcerpt = row.querySelector('span');
  const rowTime = row.querySelector('time');
  if (rowTitle) rowTitle.textContent = title;
  if (rowExcerpt) rowExcerpt.textContent = noteArchiveExcerpt(note);
  if (rowTime) rowTime.textContent = noteArchiveTime(note.updatedAt);
}

function persistNotesEditor(editor) {
  if (!editor || !editor.dataset.noteId) return;
  const notes = window.NotchDomain.updateNoteInArchive(
    loadNoteArchive(),
    editor.dataset.noteId,
    editor.value,
    Date.now()
  );
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  const updated = notes.find((note) => note.id === editor.dataset.noteId);
  if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === editor.dataset.noteId && noteInput) {
    noteInput.value = editor.value;
    localStorage.setItem(NOTE_KEY, editor.value);
    renderNotePreview();
  }
  updateSavedNotePresentation(updated);
  if (pendingNotesEditor === editor) pendingNotesEditor = null;
}

function flushNotesEditorSave() {
  if (workspaceReloadPending) return;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  const editor = pendingNotesEditor;
  pendingNotesEditor = null;
  if (editor) persistNotesEditor(editor);
}

function scheduleNotesEditorSave(editor) {
  pendingNotesEditor = editor;
  if (notesSaveTimer) clearTimeout(notesSaveTimer);
  const time = notesDetail?.querySelector('.notes-detail-time');
  if (time) time.textContent = '正在保存…';
  notesSaveTimer = setTimeout(() => {
    notesSaveTimer = null;
    const pending = pendingNotesEditor;
    pendingNotesEditor = null;
    if (pending) persistNotesEditor(pending);
  }, 220);
}

function renderNotesLibrary() {
  if (!notesList) return;
  const archive = loadNoteArchive();
  const notes = window.NotchDomain.filterNotes(archive, notesSearch?.value || '');
  if (notesCount) notesCount.textContent = `${archive.length} 篇`;
  if (!notes.some((note) => note.id === selectedNoteId)) selectedNoteId = notes[0]?.id || '';
  notesList.replaceChildren();
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-list-empty';
    empty.textContent = archive.length ? '没有找到相关笔记' : '保存的笔记会出现在这里';
    notesList.append(empty);
    renderNotesDetail(notes);
    return;
  }
  notes.forEach((note) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `notes-list-item${note.id === selectedNoteId ? ' active' : ''}`;
    button.dataset.noteId = note.id;
    button.dataset.lineSidebarItem = '';
    button.setAttribute('aria-pressed', String(note.id === selectedNoteId));
    const title = document.createElement('strong');
    title.textContent = noteArchiveTitle(note);
    const excerpt = document.createElement('span');
    excerpt.textContent = noteArchiveExcerpt(note);
    const time = document.createElement('time');
    time.textContent = noteArchiveTime(note.updatedAt);
    button.append(title, excerpt, time);
    notesList.append(button);
  });
  renderNotesDetail(notes);
}

noteSaveButton?.addEventListener('click', () => {
  const content = noteInput?.value.trim() || '';
  if (!content) {
    showStatusToast('先写点内容再存档');
    return;
  }
  const notes = loadNoteArchive();
  let activeId = localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) || '';
  const existing = notes.find((item) => item.id === activeId);
  if (existing) {
    existing.content = content;
    existing.updatedAt = Date.now();
  } else {
    activeId = generateId();
    notes.unshift({ id: activeId, content, createdAt: Date.now(), updatedAt: Date.now() });
  }
  localStorage.setItem(NOTE_ACTIVE_ARCHIVE_KEY, activeId);
  localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
  localStorage.setItem(NOTE_KEY, noteInput.value);
  selectedNoteId = activeId;
  renderNotesLibrary();
  showStatusToast('笔记已保存');
});

notesList?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-note-id]');
  if (!row) return;
  flushNotesEditorSave();
  selectedNoteId = row.dataset.noteId;
  renderNotesLibrary();
});

notesSearch?.addEventListener('input', () => {
  flushNotesEditorSave();
  renderNotesLibrary();
});

notesDetail?.addEventListener('input', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const notes = window.NotchDomain.updateNoteTitle(
      loadNoteArchive(),
      title.dataset.noteId,
      title.value,
      Date.now()
    );
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(notes.slice(0, 200)));
    updateSavedNotePresentation(notes.find((note) => note.id === title.dataset.noteId));
    return;
  }
  const editor = event.target.closest('#notes-editor');
  if (editor) scheduleNotesEditorSave(editor);
});

notesDetail?.addEventListener('focusout', (event) => {
  const title = event.target.closest('.notes-detail-title');
  if (title?.dataset.noteId) {
    const note = loadNoteArchive().find((item) => item.id === title.dataset.noteId);
    if (note) title.value = note.title;
  }
  if (event.target.closest('#notes-editor')) flushNotesEditorSave();
});

notesDetail?.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  flushNotesEditorSave();
  const notes = loadNoteArchive();
  const note = notes.find((item) => item.id === selectedNoteId);
  if (!note) return;
  if (action === 'delete-note') {
    const next = notes.filter((item) => item.id !== note.id);
    localStorage.setItem(NOTE_ARCHIVE_KEY, JSON.stringify(next));
    if (localStorage.getItem(NOTE_ACTIVE_ARCHIVE_KEY) === note.id) {
      localStorage.removeItem(NOTE_ACTIVE_ARCHIVE_KEY);
    }
    selectedNoteId = next[0]?.id || '';
    renderNotesLibrary();
    showStatusToast('笔记已删除');
    return;
  }
});

document.addEventListener('notch:tabchange', (event) => {
  if (event.detail?.tab !== 'notes') flushNotesEditorSave();
});
window.addEventListener('beforeunload', flushNotesEditorSave);

if (noteFormatActions) {
  noteFormatActions.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-note-format]')) event.preventDefault();
  });
  noteFormatActions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-format]');
    if (!button) return;
    applyNoteFormat(button.dataset.noteFormat);
  });
}

noteModeButtons.forEach((button) => {
  button.addEventListener('click', () => setNoteMode(button.dataset.noteMode));
});
noteEditButton?.addEventListener('click', () => setNoteMode(noteMode === 'preview' ? 'edit' : 'preview'));

if (notePreview) {
  notePreview.addEventListener('click', (event) => {
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
  notePreview.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
}

// ============ 距离感应 Dock 悬浮 ============

// ============ 剪贴板历史 ============
const CLIP_HISTORY_KEY = 'notch-clip-history';
const CLIP_FAV_KEY = 'notch-clip-favorites';
const CLIP_MAX = 100;
const CLIP_URL_RE = /^https?:\/\//i;
const starOutlineSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
const starFilledSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';

function loadClipHistory() {
  try {
    const raw = localStorage.getItem(CLIP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeClipEntry).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function normalizeClipEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const type = ['text', 'url', 'image'].includes(entry.type) ? entry.type : 'text';
  const text = typeof entry.text === 'string' ? entry.text : null;
  const imagePath = typeof entry.imagePath === 'string' ? entry.imagePath : null;
  if (type === 'image' ? !imagePath : text === null) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
    type,
    text,
    imagePath,
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
  };
}

function saveClipHistory(list) {
  try {
    localStorage.setItem(CLIP_HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

function loadClipFavorites() {
  try {
    const raw = localStorage.getItem(CLIP_FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p === 'string');
  } catch (e) {
    return [];
  }
}

function saveClipFavorites(list) {
  try {
    localStorage.setItem(CLIP_FAV_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

let clipHistory = loadClipHistory();
let clipFavorites = loadClipFavorites();
let clipFilter = 'all'; // all | text | image | faved
const clipImageCache = new Map(); // imagePath -> dataUrl，仅内存

// 宁可多自增（多一次重建）也不能漏（界面不更新）。
// 注意：preloadClipImage 在图片入缓存后也要自增，确保二次渲染不被脏标记挡掉。
let clipDataVersion = 0;
let lastRenderedClipVersion = -1; // renderClipList 上次渲染时的版本号

const clipListEl = document.getElementById('clip-list');
const clipToolbarEl = document.getElementById('clip-toolbar');
const clipClearBtn = document.getElementById('clip-clear-btn');
let clipClearArmed = false;

// 防重入标志：renderClipList 内按需图片预加载完成后的二次渲染
let clipRenderPending = false;

async function preloadClipImage(imagePath) {
  if (!imagePath) return;
  if (clipImageCache.has(imagePath)) return;
  if (!window.notchAPI || typeof window.notchAPI.readClipImage !== 'function') return;
  try {
    const dataUrl = await window.notchAPI.readClipImage(imagePath);
    if (dataUrl) {
      clipImageCache.set(imagePath, dataUrl);
      clipDataVersion++; // 图片入缓存 → 版本自增，确保二次渲染不被脏标记挡掉（缩略图必须显示）
    }
  } catch (e) {
    // ignore read errors
  }
}

async function addClipEntry(raw) {
  const id = generateId();
  const entry = {
    id,
    type: raw.type || 'text',
    text: raw.text || null,
    imagePath: raw.imagePath || null,
    timestamp: Date.now(),
  };

  // 每一次系统复制都是独立历史事件；相同内容也必须保留为两条记录。
  const updated = window.NotchDomain.prependClipboardHistory(clipHistory, entry, CLIP_MAX);
  clipHistory = updated.history;
  const evicted = updated.evicted;
  if (evicted.length > 0) {
    const evictedPaths = evicted
      .filter((e) => e.type === 'image' && e.imagePath)
      .map((e) => e.imagePath);
    if (evictedPaths.length > 0) {
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages(evictedPaths).catch(() => {});
      }
      evictedPaths.forEach((p) => clipImageCache.delete(p));
    }
  }

  saveClipHistory(clipHistory);

  // 图片条目预加载缩略图
  if (entry.type === 'image' && entry.imagePath) {
    await preloadClipImage(entry.imagePath);
  }

  clipDataVersion++; // clipHistory 已变（含 FIFO 淘汰）
  renderClipList();
}

function formatClipTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function clipEntryHtml(entry, faved) {
  const favClass = faved ? ' faved' : '';
  const star = faved ? starFilledSvg : starOutlineSvg;
  const favLabel = faved ? '取消收藏' : '收藏';
  const timeStr = escapeHtml(formatClipTime(entry.timestamp));
  const safeId = escapeHtml(entry.id);

  if (entry.type === 'image') {
    const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
    const thumbHtml = dataUrl
      ? `<img class="clip-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
      : `<span class="clip-thumb-placeholder">图片加载中…</span>`;
    return `<div class="clip-item clip-item-image clip-type-image" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制图片">
    <span class="clip-thumb-wrap">${thumbHtml}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span></span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
  }

  // text | url 条目
  const safeText = escapeHtml(entry.text || '');
  const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
  const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
  const accessiblePreview = escapeHtml(
    (entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '空白内容'
  );
  return `<div class="clip-item clip-item-text ${typeClass}" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制：${accessiblePreview}">
    <span class="clip-text">${safeText}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span></span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
}

function getFilteredClipItems() {
  if (clipFilter === 'all') return clipHistory;
  if (clipFilter === 'text') return clipHistory.filter((e) => e.type === 'text' || e.type === 'url');
  if (clipFilter === 'image') return clipHistory.filter((e) => e.type === 'image');
  if (clipFilter === 'faved') {
    const favSet = new Set(clipFavorites);
    return clipHistory.filter((e) => favSet.has(e.id));
  }
  return clipHistory;
}

function renderClipList() {
  if (!clipListEl) return;
  // 脏标记：数据/过滤器/图片缓存均未变则跳过全量重建
  if (clipDataVersion === lastRenderedClipVersion) return;

  const items = getFilteredClipItems();
  const favSet = new Set(clipFavorites);

  if (items.length === 0) {
    clipListEl.innerHTML =
      '<div class="clip-empty">' +
      (clipHistory.length ? '没有符合条件的记录' : '复制点什么，历史会出现在这里') +
      '</div>';
    lastRenderedClipVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  clipListEl.innerHTML = items.map((e) => clipEntryHtml(e, favSet.has(e.id))).join('');
  lastRenderedClipVersion = clipDataVersion; // 标记本次渲染版本（在预加载之前）

  // 按需预加载图片：收集当前 items 里 cache 未命中的 image 条目
  // preloadClipImage 成功后自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  if (clipRenderPending) return; // 防重入：已有预加载任务在途
  const missingPaths = items
    .filter((e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath))
    .map((e) => e.imagePath);

  if (missingPaths.length === 0) return;

  clipRenderPending = true;
  Promise.all(missingPaths.map((p) => preloadClipImage(p)))
    .then(() => {
      clipRenderPending = false;
      // 只有至少有一条路径成功填入 cache 才重渲，避免无意义刷新
      const anyLoaded = missingPaths.some((p) => clipImageCache.has(p));
      if (anyLoaded) renderClipList();
    })
    .catch(() => {
      clipRenderPending = false;
    });
}

// ---- 工具栏事件委托 ----
if (clipToolbarEl) {
  clipToolbarEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const filterBtn = e.target.closest('.clip-filter');
    if (filterBtn) {
      clipFilter = filterBtn.dataset.filter || 'all';
      clipToolbarEl.querySelectorAll('.clip-filter').forEach((b) => {
        const selected = b === filterBtn;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      clipDataVersion++; // clipFilter 已变 → 输出变化
      renderClipList();
      return;
    }
    if (e.target.closest('#clip-clear-btn')) {
      requestClearClipHistory();
    }
  });
  clipToolbarEl.querySelectorAll('.clip-filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
}

// ---- 列表事件委托 ----
if (clipListEl) {
  clipListEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.clip-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    // 优先判断子按钮
    const favoriteButton = e.target.closest('.clip-fav-btn');
    if (favoriteButton) {
      toggleClipFavorite(id, {
        restoreFocus: document.activeElement === favoriteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    const deleteButton = e.target.closest('.clip-del-btn');
    if (deleteButton) {
      deleteClipEntry(id, {
        restoreFocus: document.activeElement === deleteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    if (e.target.closest('[data-action="copy"]')) copyClipEntry(id);
  });
}

function focusClipControl(ids, action = 'copy') {
  if (!clipListEl) return;
  for (const id of ids.filter(Boolean)) {
    const target = clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`
    );
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  const activeFilter = clipToolbarEl && clipToolbarEl.querySelector('.clip-filter.active');
  if (activeFilter) activeFilter.focus({ preventScroll: true });
}

function toggleClipFavorite(id, focusContext = null) {
  const idx = clipFavorites.indexOf(id);
  if (idx === -1) {
    clipFavorites.push(id);
  } else {
    clipFavorites.splice(idx, 1);
  }
  clipDataVersion++; // clipFavorites 已变
  saveClipFavorites(clipFavorites);
  renderClipList();
  if (focusContext && focusContext.restoreFocus) {
    const sameItemButton = clipListEl && clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="fav"]`
    );
    if (sameItemButton) {
      sameItemButton.focus({ preventScroll: true });
    } else {
      focusClipControl([focusContext.nextId, focusContext.previousId]);
    }
  }
}

function deleteClipEntry(id, focusContext = null) {
  const idx = clipHistory.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const entry = clipHistory[idx];
  const favoriteIndex = clipFavorites.indexOf(id);
  clipHistory.splice(idx, 1);
  clipFavorites = clipFavorites.filter((fid) => fid !== id);
  clipDataVersion++; // clipHistory + clipFavorites 已变
  saveClipHistory(clipHistory);
  saveClipFavorites(clipFavorites);
  renderClipList();
  if (focusContext && focusContext.restoreFocus) {
    focusClipControl([focusContext.nextId, focusContext.previousId]);
  }
  showStatusToast('已删除剪贴记录', {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (clipHistory.some((item) => item.id === id)) return;
      clipHistory.splice(Math.min(idx, clipHistory.length), 0, entry);
      if (favoriteIndex !== -1) {
        clipFavorites.splice(Math.min(favoriteIndex, clipFavorites.length), 0, id);
      }
      clipDataVersion++;
      saveClipHistory(clipHistory);
      saveClipFavorites(clipFavorites);
      renderClipList();
      focusClipControl([id]);
      showStatusToast('已撤销删除');
    },
    onExpire: () => {
      if (entry.type !== 'image' || !entry.imagePath) return;
      clipImageCache.delete(entry.imagePath);
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages([entry.imagePath]).catch(() => {});
      }
    },
  });
}

function resetClipClearConfirmation() {
  clipClearArmed = false;
  if (clipClearBtn) {
    clipClearBtn.classList.remove('confirming');
    clipClearBtn.setAttribute('aria-label', '清空历史');
  }
}

function requestClearClipHistory() {
  if (clipHistory.length === 0) {
    showStatusToast('剪贴板历史已是空的');
    return;
  }
  if (!clipClearArmed) {
    clipClearArmed = true;
    if (clipClearBtn) {
      clipClearBtn.classList.add('confirming');
      clipClearBtn.setAttribute('aria-label', `再次点击确认清空 ${clipHistory.length} 条历史`);
    }
    showStatusToast(`再点一次垃圾桶，清空 ${clipHistory.length} 条记录`, {
      duration: 3000,
      onExpire: resetClipClearConfirmation,
    });
    return;
  }
  resetClipClearConfirmation();
  clearClipHistory();
}

if (clipClearBtn) {
  clipClearBtn.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  });
}

function clearClipHistory() {
  const removedCount = clipHistory.length;
  const imagePaths = clipHistory
    .filter((e) => e.type === 'image' && e.imagePath)
    .map((e) => e.imagePath);
  clipHistory = [];
  clipFavorites = [];
  clipImageCache.clear();
  clipDataVersion++; // 全部数据已清空
  saveClipHistory([]);
  saveClipFavorites([]);
  if (imagePaths.length > 0 && window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
    window.notchAPI.deleteClipImages(imagePaths).catch(() => {});
  }
  renderClipList();
  showStatusToast(`已清空 ${removedCount} 条剪贴记录`);
}

async function copyClipEntry(id) {
  const entry = clipHistory.find((e) => e.id === id);
  if (!entry) return false;
  if (!window.notchAPI) return false;
  try {
    const result = typeof window.notchAPI.pasteClipboard === 'function'
      ? await window.notchAPI.pasteClipboard(entry)
      : { ok: await window.notchAPI.writeClipboard(entry), pasted: false };
    if (!result?.ok) {
      showStatusToast('复制失败，请重试');
      return false;
    }
    showStatusToast(result.pasted
      ? '已填入刚才的输入框'
      : result.permissionRequired
        ? '请开启辅助功能权限；内容已复制'
        : entry.type === 'image' ? '图片已复制，可直接粘贴' : '已复制，可直接粘贴');
  } catch (e) {
    showStatusToast('复制失败，请重试');
    return false;
  }
  // 视觉反馈：800ms 后移除 copied 类
  const itemEl = clipListEl && clipListEl.querySelector(`.clip-item[data-id="${CSS.escape(id)}"]`);
  if (itemEl) {
    itemEl.classList.add('copied');
    setTimeout(() => itemEl.classList.remove('copied'), 800);
  }
  return true;
}

// ---- IPC 推送监听 ----
if (window.notchAPI && typeof window.notchAPI.onNewClipEntry === 'function') {
  window.notchAPI.onNewClipEntry((raw) => {
    addClipEntry(raw);
  });
}

renderAll();
renderClipList(); // 首屏确保 clip-list DOM 就绪时渲染一次（幂等）
initTab();

// ============ 待办历史：存档查看与完成跨度甘特图 ============
function formatHistoryDate(ts) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(ts));
}
function formatHistorySpan(start, end) {
  const ms = Math.max(0, end - start);
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return '<1 小时';
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} 天 ${rest} 小时` : `${days} 天`;
}

function historyRowHtml(item) {
  const name = todoCategoryNames[item.priority] || item.priority;
  const projectChip = typeof item.project === 'string' && item.project.trim()
    ? `<span class="history-project" title="项目：${escapeHtml(item.project.trim())}">${escapeHtml(item.project.trim())}</span>` : '';
  return `<li class="history-item" data-id="${escapeHtml(item.id)}">
    <span class="dot dot-${item.priority}" title="${escapeHtml(name)}"></span>
    <span class="history-text" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</span>
    ${projectChip}
    <span class="history-meta">${formatHistoryDate(item.createdAt)} → ${formatHistoryDate(item.completedAt)}<em>${formatHistorySpan(item.createdAt, item.completedAt)}</em></span>
    <button type="button" class="history-restore" data-action="restore" title="恢复为未完成" aria-label="恢复：${escapeHtml(item.text)}">↩</button>
    <button type="button" class="history-delete" data-action="delete" title="永久删除" aria-label="删除：${escapeHtml(item.text)}">×</button>
  </li>`;
}

function renderTodoGantt() {
  const wrap = document.getElementById('todo-gantt-wrap');
  const gantt = document.getElementById('todo-gantt');
  if (!wrap || !gantt) return;
  const items = todoHistory.filter(
    (h) => Number.isFinite(h.createdAt) && Number.isFinite(h.completedAt) && h.completedAt >= h.createdAt
  );
  if (!items.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const now = Date.now();
  let min = Math.min(...items.map((h) => h.createdAt));
  const max = Math.max(now, ...items.map((h) => h.completedAt));
  const MIN_SPAN = 7 * 24 * 3600 * 1000;
  if (max - min < MIN_SPAN) min = max - MIN_SPAN;
  const span = Math.max(1, max - min);
  const ordered = [...items].sort((a, b) => b.completedAt - a.completedAt);
  const days = span / 86400000;
  const stepDays = days > 120 ? 30 : days > 30 ? 7 : 1;
  const ticks = [];
  const d0 = new Date(min);
  const tickStart = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
  for (let ts = tickStart.getTime(); ts <= max; ts += stepDays * 86400000) ticks.push(ts);
  const axis = ticks.map((ts) => `<i style="left:${((ts - min) / span) * 100}%">${formatHistoryDate(ts)}</i>`).join('');
  const rows = ordered.map((h) => {
    const left = Math.max(0, Math.min(100, ((h.createdAt - min) / span) * 100));
    const width = Math.max(0.5, Math.min(100 - left, ((h.completedAt - h.createdAt) / span) * 100));
    return `<div class="gantt-row" data-priority="${h.priority}">
      <span class="gantt-label" title="${escapeHtml(h.text)}${typeof h.project === 'string' && h.project.trim() ? ' · ' + escapeHtml(h.project.trim()) : ''}">${escapeHtml(h.text)}</span>
      <span class="gantt-track"><i class="gantt-bar" style="left:${left}%;width:${width}%"></i></span>
      <span class="gantt-span">${formatHistorySpan(h.createdAt, h.completedAt)}</span>
    </div>`;
  }).join('');
  gantt.innerHTML = `<div class="gantt-axis"><span></span><span class="axis-track">${axis}</span><span></span></div>${rows}`;
}

function updateTodoHistoryUI() {
  const countEl = document.getElementById('todo-history-count');
  if (countEl) countEl.textContent = String(todoHistory.length);
  const clearBtn = document.getElementById('todo-history-clear');
  if (clearBtn) clearBtn.hidden = todoHistory.length === 0;
}

function renderTodoHistory() {
  const list = document.getElementById('todo-history-list');
  const empty = document.getElementById('todo-history-empty');
  if (!list || !empty) return;
  updateTodoHistoryUI();
  renderTodoGantt();
  if (!todoHistory.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = todoHistory.map(historyRowHtml).join('');
}

function setTodoView(view) {
  if (view !== 'active' && view !== 'history') return;
  todoView = view;
  const activeView = document.getElementById('todo-active-view');
  const historyView = document.getElementById('todo-history-view');
  document.querySelectorAll('.todo-view-tab').forEach((btn) => {
    const active = btn.dataset.todoView === view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  if (view === 'history') {
    if (activeView) activeView.hidden = true;
    if (historyView) {
      historyView.hidden = false;
      renderTodoHistory();
    }
  } else {
    if (historyView) historyView.hidden = true;
    if (activeView) activeView.hidden = false;
  }
}

function restoreTodoFromHistory(id) {
  const index = todoHistory.findIndex((h) => h.id === id);
  if (index === -1) return;
  const [h] = todoHistory.splice(index, 1);
  (data[h.priority] || (data[h.priority] = [])).push({
    id: h.id,
    text: h.text,
    done: false,
    createdAt: h.createdAt,
    deadline: h.deadline || '',
    project: typeof h.project === 'string' ? h.project : '',
    remindedAt: 0,
  });
  saveData(data);
  saveTodoHistory();
  renderList(h.priority);
  updateCount(h.priority);
  renderTodoHistory();
  showStatusToast('已恢复为未完成');
}

function deleteTodoFromHistory(id) {
  const index = todoHistory.findIndex((h) => h.id === id);
  if (index === -1) return;
  const [h] = todoHistory.splice(index, 1);
  saveTodoHistory();
  renderTodoHistory();
  const summary = h.text.length > 18 ? `${h.text.slice(0, 18)}…` : h.text;
  showStatusToast(`已删除“${summary}”`);
}

function clearTodoHistory() {
  if (!todoHistory.length) return;
  todoHistory = [];
  saveTodoHistory();
  renderTodoHistory();
  showStatusToast('已清空完成存档');
}

document.querySelectorAll('.todo-view-tab').forEach((btn) => {
  btn.addEventListener('click', () => setTodoView(btn.dataset.todoView));
});
const historyList = document.getElementById('todo-history-list');
historyList?.addEventListener('click', (event) => {
  const item = event.target.closest('.history-item');
  if (!item) return;
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'restore') restoreTodoFromHistory(item.dataset.id);
  else if (action === 'delete') deleteTodoFromHistory(item.dataset.id);
});
document.getElementById('todo-history-clear')?.addEventListener('click', clearTodoHistory);
updateTodoHistoryUI();

// ============ 待办 · 项目分组视图（树形，可按项目归纳） ============
const todoGroupToggle = document.getElementById('todo-group-toggle');
if (todoGroupToggle) todoGroupToggle.classList.toggle('active', todoGroupView);
todoGroupToggle?.addEventListener('click', () => {
  todoGroupView = !todoGroupView;
  todoGroupToggle.classList.toggle('active', todoGroupView);
  try {
    localStorage.setItem('notch-todo-group-view-v1', todoGroupView ? '1' : '0');
  } catch (error) {
    // ignore quota errors
  }
  PRIORITIES.forEach((priority) => renderList(priority));
});
document.querySelectorAll('.todo-list').forEach((list) => {
  list.addEventListener('click', (event) => {
    const head = event.target.closest('.todo-group-head');
    if (!head || !event.target.closest('.todo-group-fold')) return;
    const key = `${head.dataset.priority}\u0000${head.dataset.project}`;
    if (todoGroupCollapsed.has(key)) todoGroupCollapsed.delete(key);
    else todoGroupCollapsed.add(key);
    try {
      localStorage.setItem('notch-todo-group-collapsed-v1', JSON.stringify([...todoGroupCollapsed]));
    } catch (error) {
      // ignore quota errors
    }
    renderList(head.dataset.priority);
  });
});
