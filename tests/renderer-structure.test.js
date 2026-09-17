const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const domainJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'domain.js'), 'utf8');
const syncJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'dingtalk-sync.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
  assert.match(html, /id="notes-new"/);
  assert.match(appJs, /notesNewButton\?\.addEventListener\('click'/);
});

test('cloud sync exposes separate connection and logout actions', () => {
  assert.match(html, /id="nexusdesk-sync-connect"/);
  assert.match(html, /id="nexusdesk-sync-logout"[^>]*>退出登录</);
  assert.doesNotMatch(html, /id="nexusdesk-sync-save"/);
  assert.match(domainJs, /断开连接/);
  assert.match(domainJs, /重新连接/);
  assert.match(workspaceJs, /nexusdeskConnectionPresentation/);
});

test('homepage tab and its widgets are fully removed', () => {
  assert.doesNotMatch(html, /data-tab="home"/);
  assert.doesNotMatch(html, /id="tab-home"/);
  assert.doesNotMatch(html, /home-bento/);
  assert.doesNotMatch(html, /data-home-module/);
  assert.doesNotMatch(html, /settings-home-module/);
  assert.doesNotMatch(html, /settings-mirror-choose/);
  assert.doesNotMatch(appJs, /window\.NotchHome\s*=/);
  assert.doesNotMatch(appJs, /notch:home-modules-changed/);
  assert.doesNotMatch(appJs, /homeLayoutReadOnly/);
  assert.doesNotMatch(appJs, /stopMirror/);
});

test('todo opens by default after the homepage is gone', () => {
  assert.match(appJs, /let activeTab = 'todo'/);
  assert.match(appJs, /let defaultOpenTab = 'todo'/);
  assert.match(appJs, /TABS\[0\] \|\| 'settings'/);
  assert.match(domainJs, /defaultTab: String\(appSettings\.defaultTab \|\| 'todo'\)/);
});

test('todo deletion uses a recoverable trash before permanent cloud deletion', () => {
  assert.match(html, /data-todo-view="trash"/);
  assert.match(html, /id="todo-trash-list"/);
  assert.match(html, /id="todo-trash-clear"/);
  assert.match(appJs, /notch-todo-trash-v1/);
  assert.match(appJs, /function restoreTodoFromTrash/);
  assert.match(appJs, /function permanentlyDeleteTodoFromTrash/);
  assert.equal((appJs.match(/reportTodoDeleted/g) || []).length, 2, 'only permanent deletion and clearing trash may delete cloud copies');
});

test('portable workspace excludes device credentials and sync retries permanent deletes', () => {
  assert.match(appJs, /const PORTABLE_STORAGE_KEYS = new Set/);
  assert.doesNotMatch(appJs.match(/const PORTABLE_STORAGE_KEYS[\s\S]*?\]\);/)?.[0] || '', /nexusdesk-sync-config/);
  assert.match(syncJs, /nexusdesk-todo-delete-outbox-v1/);
  assert.match(syncJs, /flushTodoDeleteOutbox/);
  assert.match(syncJs, /response\.ok/);
});

test('cloud sync credentials use Electron secure storage instead of LocalStorage', () => {
  assert.match(mainJs, /safeStorage\.encryptString/);
  assert.match(mainJs, /ipcMain\.handle\('sync-auth:get'/);
  assert.match(mainJs, /ipcMain\.handle\('sync-auth:set'/);
  assert.match(preloadJs, /getSyncAuth: \(\) => ipcRenderer\.invoke\('sync-auth:get'\)/);
  assert.match(preloadJs, /setSyncAuth: \(auth\) => ipcRenderer\.invoke\('sync-auth:set', auth\)/);
  assert.match(syncJs, /secureAuthReady = loadSecureAuth\(\)/);
  assert.match(syncJs, /delete next\.token/);
  assert.doesNotMatch(syncJs, /saveSyncConfig\(\{[^}]*token:/);
});

test('renderer modules use shared week keys and explicit UI dependencies', () => {
  assert.match(appJs, /NotchDomain\.localWeekKey/);
  assert.match(syncJs, /NotchDomain\.localWeekKey/);
  assert.doesNotMatch(syncJs, /function syncWeekKey/);
  assert.match(appJs, /window\.NotchUI = Object\.freeze/);
  assert.match(workspaceJs, /const UI = window\.NotchUI/);
  assert.doesNotMatch(workspaceJs, /typeof showStatusToast/);
});

test('recording UI is removed and AI configuration remains available', () => {
  assert.doesNotMatch(html, /data-tab="recordings"/);
  assert.doesNotMatch(html, /id="recording-new"/);
  assert.match(html, /id="llm-base-url"/);
  assert.match(html, /id="llm-api-key"/);
  assert.match(html, /id="llm-model"/);
  assert.match(html, /id="transcription-settings-test"/);
  assert.match(workspaceJs, /setAiConfig/);
  assert.match(workspaceJs, /testAiConnection/);
});

test('todo progress and weekly summary have local persistence and AI entry points', () => {
  assert.match(html, /id="todo-progress-backdrop"/);
  assert.match(html, /id="todo-progress-status"/);
  assert.match(html, /id="todo-progress-text"/);
  assert.match(html, /id="todo-progress-next"/);
  assert.match(html, /id="todo-weekly-generate"/);
  assert.match(html, /id="todo-weekly-close"/);
  assert.match(html, /id="todo-weekly-result"/);
  assert.match(html, /id="todo-weekly-progress"/);
  assert.match(html, /data-tab="weekly"/);
  assert.match(html, /id="tab-weekly"/);
  assert.match(html, /id="weekly-generate"/);
  assert.match(html, /id="weekly-history"/);
  assert.match(html, /id="weekly-progress"/);
  assert.match(html, /id="weekly-status"/);
  assert.match(html, /id="weekly-next"/);
  assert.match(appJs, /notch-todo-progress-v1/);
  assert.match(appJs, /notch-todo-weekly-summaries-v1/);
  assert.match(appJs, /previousWeekKey/);
  assert.match(appJs, /summarizeWeek/);
  assert.match(appJs, /renderWeeklyHistory/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'todo', 'notes', 'links', 'credentials', 'clip', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});
