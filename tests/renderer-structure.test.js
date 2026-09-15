const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const domainJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'domain.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');

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
