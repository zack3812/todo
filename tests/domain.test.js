const test = require('node:test');
const assert = require('node:assert/strict');

const domain = require('../renderer/domain');
const {
  normalizeHttpUrl,
  classifyLink,
  addLinkToGroups,
  renameGroup,
  createTodo,
  ensureUniqueTodoIds,
  normalizeTodoData,
  normalizeTodoTrash,
  moveTodosToTrash,
  normalizeTodoDeleteOutbox,
  enqueueTodoDelete,
  acknowledgeTodoDelete,
  localWeekKey,
  resolveRemoteTodoIdentity,
  updateTodo,
  currentMonthDeadline,
  calendarDeadline,
  shiftCalendarMonth,
  defaultTodoDeadline,
  normalizeTodoCategoryNames,
  shouldTogglePanelForSpace,
  todoTimeBattery,
  updateRangeSelection,
  sortTodosForDisplay,
  preferredLinkGroupId,
  moveLinkToGroup,
  moveLinkToPosition,
  filterCredentials,
  credentialRowAction,
  visiblePanelTabs,
  resolveDefaultPanelTab,
  settingsSummary,
  normalizeNoteArchive,
  createNoteInArchive,
  filterNotes,
  updateNoteInArchive,
  updateNoteTitle,
  applyGeneratedNoteTitle,
  apiCredentialStatuses,
  nexusdeskConnectionPresentation,
  prependClipboardHistory,
  createExclusiveAsyncTask,
} = domain;


test('an exclusive async task coalesces repeated starts until the first attempt settles', async () => {
  let release;
  let attempts = 0;
  const pendingStates = [];
  const task = createExclusiveAsyncTask((pending) => pendingStates.push(pending));
  const work = () => {
    attempts += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = task.run(work);
  const second = task.run(work);

  assert.equal(task.isPending(), true);
  assert.strictEqual(second, first);
  assert.equal(attempts, 1);
  assert.deepEqual(pendingStates, [true]);

  release('started');
  assert.equal(await first, 'started');
  assert.equal(task.isPending(), false);
  assert.deepEqual(pendingStates, [true, false]);

  assert.equal(await task.run(async () => {
    attempts += 1;
    return 'started-again';
  }), 'started-again');
  assert.equal(attempts, 2);
});


test('clipboard history preserves repeated copies of identical text', () => {
  const previous = [{ id: 'first', type: 'text', text: '同一段内容', timestamp: 100 }];
  const next = { id: 'second', type: 'text', text: '同一段内容', timestamp: 200 };
  const result = prependClipboardHistory(previous, next, 100);

  assert.deepEqual(result.history.map((entry) => entry.id), ['second', 'first']);
  assert.deepEqual(result.evicted, []);
});

test('clipboard history evicts only entries beyond its capacity', () => {
  const previous = [
    { id: 'first', type: 'text', text: 'A', timestamp: 100 },
    { id: 'older-image', type: 'image', imagePath: '/tmp/old.png', timestamp: 50 },
  ];
  const result = prependClipboardHistory(
    previous,
    { id: 'new', type: 'text', text: 'A', timestamp: 200 },
    2
  );

  assert.deepEqual(result.history.map((entry) => entry.id), ['new', 'first']);
  assert.deepEqual(result.evicted.map((entry) => entry.id), ['older-image']);
});

test('normalizeHttpUrl adds https and removes URL credentials', () => {
  assert.equal(normalizeHttpUrl(' example.com/docs '), 'https://example.com/docs');
  assert.equal(normalizeHttpUrl('https://user:secret@example.com/a'), 'https://example.com/a');
});

test('normalizeHttpUrl rejects non-web and local URLs', () => {
  assert.equal(normalizeHttpUrl('javascript:alert(1)'), null);
  assert.equal(normalizeHttpUrl('file:///tmp/a'), null);
  assert.equal(normalizeHttpUrl('http://localhost:3000'), null);
  assert.equal(normalizeHttpUrl('http://127.0.0.1/private'), null);
});

test('classifyLink maps familiar services and falls back to 其他', () => {
  assert.equal(classifyLink('https://github.com/openai', 'OpenAI repository'), '开发');
  assert.equal(classifyLink('https://www.feishu.cn/', '飞书'), '工作');
  assert.equal(classifyLink('https://www.bilibili.com/video/1', '视频'), '影音');
  assert.equal(classifyLink('https://example.com/', 'Example Domain'), '其他');
});

test('addLinkToGroups reuses a matching group and creates a missing group', () => {
  const initial = [{ id: 'g1', name: '开发', collapsed: false, links: [] }];
  const first = addLinkToGroups(initial, {
    id: 'l1',
    url: 'https://github.com/',
    title: 'GitHub',
  }, '开发');
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].links.map((link) => link.id), ['l1']);

  const second = addLinkToGroups(first, {
    id: 'l2',
    url: 'https://example.com/',
    title: 'Example',
  }, '其他');
  assert.equal(second.length, 2);
  assert.equal(second[1].name, '其他');
  assert.equal(second[1].links[0].id, 'l2');
});

test('same-site links reuse an existing group before automatic classification', () => {
  const groups = [
    { id: 'product', name: 'Lollipop', links: [{ id: 'home', url: 'https://lollipop.plus/' }] },
    { id: 'work', name: '工作', links: [{ id: 'docs', url: 'https://docs.example.com/' }] },
  ];
  assert.equal(preferredLinkGroupId(groups, 'https://docs.lollipop.plus/guide'), 'product');
  assert.equal(preferredLinkGroupId(groups, 'https://news.example.com/'), 'work');
  assert.equal(preferredLinkGroupId(groups, 'https://openai.com/'), '');
});

test('same-site grouping respects common multi-part and hosted public suffixes', () => {
  const groups = [
    { id: 'uk', name: '英国站', links: [{ id: 'uk-docs', url: 'https://docs.example.co.uk/' }] },
    { id: 'alice', name: 'Alice', links: [{ id: 'alice-home', url: 'https://alice.github.io/' }] },
  ];
  assert.equal(preferredLinkGroupId(groups, 'https://news.example.co.uk/'), 'uk');
  assert.equal(preferredLinkGroupId(groups, 'https://bob.github.io/'), '');
});

test('moving a link changes only its group and keeps an emptied source group available', () => {
  const groups = [
    { id: 'source', name: '来源', collapsed: false, links: [{ id: 'move-me', url: 'https://example.com/' }] },
    { id: 'target', name: '目标', collapsed: true, links: [{ id: 'stay', url: 'https://openai.com/' }] },
  ];
  const moved = moveLinkToGroup(groups, 'move-me', 'target');
  assert.deepEqual(moved.map((group) => [group.id, group.links.map((link) => link.id)]), [
    ['source', []],
    ['target', ['stay', 'move-me']],
  ]);
  assert.equal(groups[0].links.length, 1);
});

test('moveLinkToPosition reorders links inside one group in both directions', () => {
  const groups = [{ id: 'g1', name: '开发', collapsed: false, links: [
    { id: 'a', url: 'https://a.example.com/' },
    { id: 'b', url: 'https://b.example.com/' },
    { id: 'c', url: 'https://c.example.com/' },
  ] }];
  const order = (result) => result[0].links.map((link) => link.id);

  // 落点下标按「移动前」的行序算：拖 a 到 c 之后 = 目标下标 3。
  // 同组要先摘后插，若不把下标减一就会多跳一格，这里正是那个边界。
  assert.deepEqual(order(moveLinkToPosition(groups, 'a', 'g1', 3)), ['b', 'c', 'a']);
  // 往上拖不需要修正下标。
  assert.deepEqual(order(moveLinkToPosition(groups, 'c', 'g1', 0)), ['c', 'a', 'b']);
  // 拖到 c 之前 = 下标 2，修正后落在 b 与 c 之间。
  assert.deepEqual(order(moveLinkToPosition(groups, 'a', 'g1', 2)), ['b', 'a', 'c']);
  // 拖回原位视为无变化。
  assert.deepEqual(order(moveLinkToPosition(groups, 'b', 'g1', 1)), ['a', 'b', 'c']);
  // 原数组不能被改动，渲染层靠这一点判断顺序有没有真的变。
  assert.deepEqual(order(groups), ['a', 'b', 'c']);
});

test('moveLinkToPosition inserts at an exact slot when crossing groups', () => {
  const groups = [
    { id: 'source', name: '来源', collapsed: false, links: [{ id: 'x', url: 'https://x.example.com/' }] },
    { id: 'target', name: '目标', collapsed: false, links: [
      { id: 'p', url: 'https://p.example.com/' },
      { id: 'q', url: 'https://q.example.com/' },
    ] },
  ];
  const layout = (result) => result.map((group) => [group.id, group.links.map((link) => link.id)]);

  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', 1)),
    [['source', []], ['target', ['p', 'x', 'q']]]);
  // 落在分组空白或折叠标题上时没有具体行，index 为 null 表示追加到末尾。
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', null)),
    [['source', []], ['target', ['p', 'q', 'x']]]);
  // 越界下标要被夹住，不能凭空造出空洞。
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', 99)),
    [['source', []], ['target', ['p', 'q', 'x']]]);
  // 未知链接或未知分组一律原样返回。
  assert.deepEqual(layout(moveLinkToPosition(groups, 'nope', 'target', 0)), layout(groups));
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'nope', 0)), layout(groups));
});

test('renameGroup trims names but never creates an empty name', () => {
  const groups = [{ id: 'g1', name: '开发', collapsed: false, links: [] }];
  assert.equal(renameGroup(groups, 'g1', '  资料  ')[0].name, '资料');
  assert.equal(renameGroup(groups, 'g1', '   ')[0].name, '开发');
});






test('createTodo requires a valid DDL and preserves reminder metadata', () => {
  assert.equal(createTodo('没有截止时间', '', 't0', 100), null);
  assert.equal(createTodo('日期无效', 'not-a-date', 't0', 100), null);
  assert.deepEqual(createTodo('  发布新版  ', '2026-08-22T10:30:00.000Z', 't1', 100), {
    id: 't1',
    text: '发布新版',
    done: false,
    createdAt: 100,
    deadline: '2026-08-22T10:30:00.000Z',
    remindedAt: 0,
    dingtalkTaskId: '',
    dingtalkSyncedAt: 0,
    executorIds: [],
  });
});

test('ensureUniqueTodoIds repairs duplicate ids across todo categories', () => {
  const groups = {
    P0: [{ id: 'same', text: '第一项' }, { id: 'same', text: '第二项' }],
    P1: [{ id: 'same', text: '第三项' }],
    P2: [{ id: 'unique', text: '第四项' }],
  };
  let nextId = 0;

  assert.equal(ensureUniqueTodoIds(groups, () => `fixed-${++nextId}`), true);
  assert.deepEqual(groups.P0.map((item) => item.id), ['same', 'fixed-1']);
  assert.deepEqual(groups.P1.map((item) => item.id), ['fixed-2']);
  assert.equal(groups.P2[0].id, 'unique');
  assert.equal(ensureUniqueTodoIds(groups, () => 'unused'), false);
});

test('normalizeTodoData migrates legacy rows and preserves sync identity', () => {
  let nextId = 0;
  const data = normalizeTodoData({
    P0: [' 旧格式待办 ', { id: 'same', text: '第一项', dingtalkTaskId: ' cloud-1 ' }],
    P1: [{ id: 'same', text: '第二项', deadline: '2026-09-18T10:00:00.000Z' }],
    P2: [{ id: 'blank', text: '   ' }],
  }, () => `generated-${++nextId}`, 100);

  assert.deepEqual(data.P0.map((item) => item.id), ['generated-1', 'same']);
  assert.equal(data.P0[0].createdAt, 100);
  assert.equal(data.P0[1].dingtalkTaskId, 'cloud-1');
  assert.equal(data.P1[0].id, 'generated-2');
  assert.equal(data.P1[0].deadline, '2026-09-18T10:00:00.000Z');
  assert.deepEqual(data.P2, []);
  assert.deepEqual(data.P3, []);
});

test('todo trash preserves identity and original priority for restore and cloud deletion', () => {
  const item = { id: 'todo-1', text: ' 保留身份 ', dingtalkTaskId: 'cloud-1', deadline: '2026-09-18T10:00:00.000Z' };
  const trash = moveTodosToTrash([{ ...item, text: '旧副本', priority: 'P0', deletedAt: 100 }], [item], 'P1', 123);

  assert.deepEqual(trash, [{ ...item, text: '保留身份', priority: 'P1', deletedAt: 123 }]);
  assert.deepEqual(normalizeTodoTrash(trash, 456), trash);
});

test('todo delete outbox deduplicates per account and clears only acknowledged deletes', () => {
  let outbox = enqueueTodoDelete([], 'todo-1', 'alice', 100);
  outbox = enqueueTodoDelete(outbox, 'todo-1', 'alice', 200);
  outbox = enqueueTodoDelete(outbox, 'todo-1', 'bob', 300);

  assert.deepEqual(outbox, [
    { todoId: 'todo-1', employeeId: 'bob', queuedAt: 300 },
    { todoId: 'todo-1', employeeId: 'alice', queuedAt: 200 },
  ]);
  assert.deepEqual(acknowledgeTodoDelete(outbox, 'todo-1', 'alice'), [outbox[0]]);
  assert.deepEqual(normalizeTodoDeleteOutbox([{ todoId: '', employeeId: 'alice' }]), []);
});

test('local week keys use the local calendar date instead of UTC conversion', () => {
  assert.equal(localWeekKey(new Date(2026, 8, 17, 0, 30)), '2026-09-14');
});

test('remote todo identity requires an exact unique local or cloud id', () => {
  const groups = {
    P0: [{ id: 'old', dingtalkTaskId: '' }],
    P1: [{ id: 'other', dingtalkTaskId: 'cloud-1' }],
  };

  assert.equal(resolveRemoteTodoIdentity(groups, 'new', undefined), null);
  assert.deepEqual(resolveRemoteTodoIdentity(groups, 'old', undefined), { priority: 'P0', index: 0, todo: groups.P0[0] });
  assert.deepEqual(resolveRemoteTodoIdentity(groups, 'new', 'cloud-1'), { priority: 'P1', index: 0, todo: groups.P1[0] });
  assert.equal(resolveRemoteTodoIdentity(groups, 'new', 'cloud-1', false), null);
  groups.P2 = [{ id: 'duplicate-cloud', dingtalkTaskId: 'cloud-1' }];
  assert.equal(resolveRemoteTodoIdentity(groups, 'new', 'cloud-1'), null);
  groups.P3 = [{ id: 'old', dingtalkTaskId: 'cloud-2' }];
  assert.equal(resolveRemoteTodoIdentity(groups, 'old', undefined), null);
});

test('todo editor updates text and deadline while keeping completion state', () => {
  const original = { ...createTodo('旧标题', '2026-08-22T10:30:00.000Z', 't1', 100), done: true, remindedAt: 88 };
  const updated = updateTodo(original, '新标题', '2026-08-23T09:00:00.000Z');
  assert.equal(updated.id, 't1');
  assert.equal(updated.text, '新标题');
  assert.equal(updated.done, true);
  assert.equal(updated.remindedAt, 0);
  const localDeadline = new Date(currentMonthDeadline(
    { day: 21, hour: 14, minute: 30 },
    new Date(2026, 7, 1, 0, 0, 0, 0),
  ));
  assert.deepEqual([
    localDeadline.getFullYear(),
    localDeadline.getMonth(),
    localDeadline.getDate(),
    localDeadline.getHours(),
    localDeadline.getMinutes(),
  ], [2026, 7, 21, 14, 30]);
  assert.equal(currentMonthDeadline(
    { day: 32, hour: 14, minute: 30 },
    new Date(2026, 7, 1, 0, 0, 0, 0),
  ), null);
});

test('todo calendar month navigation crosses year boundaries in both directions', () => {
  assert.equal(typeof shiftCalendarMonth, 'function', 'shiftCalendarMonth must exist');
  assert.deepEqual(shiftCalendarMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftCalendarMonth({ year: 2027, month: 0 }, -1), { year: 2026, month: 11 });
});

test('todo deadline uses the calendar month being viewed instead of the current month', () => {
  assert.equal(typeof calendarDeadline, 'function', 'calendarDeadline must exist');
  const deadline = new Date(calendarDeadline({
    year: 2027,
    month: 0,
    day: 2,
    hour: 23,
    minute: 30,
  }));
  assert.deepEqual([
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate(),
    deadline.getHours(),
    deadline.getMinutes(),
  ], [2027, 0, 2, 23, 30]);
  assert.equal(calendarDeadline({ year: 2027, month: 1, day: 29, hour: 23, minute: 30 }), null);
});

test('default todo deadline stays on the current local day, including after 23:30', () => {
  const daytime = new Date(2026, 7, 28, 9, 15, 0, 0);
  const sameDayDeadline = new Date(defaultTodoDeadline(daytime));
  assert.deepEqual([
    sameDayDeadline.getFullYear(),
    sameDayDeadline.getMonth(),
    sameDayDeadline.getDate(),
    sameDayDeadline.getHours(),
    sameDayDeadline.getMinutes(),
  ], [2026, 7, 28, 23, 30]);

  const afterCutoff = new Date(2026, 7, 31, 23, 31, 0, 0);
  const sameDayAfterCutoff = new Date(defaultTodoDeadline(afterCutoff));
  assert.deepEqual([
    sameDayAfterCutoff.getFullYear(),
    sameDayAfterCutoff.getMonth(),
    sameDayAfterCutoff.getDate(),
    sameDayAfterCutoff.getHours(),
    sameDayAfterCutoff.getMinutes(),
  ], [2026, 7, 31, 23, 30]);
});

test('todos sort unfinished by DDL and creation time with completed items last', () => {
  const rows = sortTodosForDisplay([
    { id: 'done', done: true, deadline: '2026-08-20T00:00:00.000Z', createdAt: 1 },
    { id: 'late', done: false, deadline: '2026-08-22T00:00:00.000Z', createdAt: 2 },
    { id: 'early-new', done: false, deadline: '2026-08-21T00:00:00.000Z', createdAt: 3 },
    { id: 'early-old', done: false, deadline: '2026-08-21T00:00:00.000Z', createdAt: 1 },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ['early-old', 'early-new', 'late', 'done']);
});

test('credential search matches service or account without exposing passwords', () => {
  const rows = [
    { id: 'github', service: 'GitHub', account: 'hello@example.com', passwordMask: '********' },
    { id: 'feishu', service: '飞书', account: '13800000000', passwordMask: '********' },
  ];
  assert.deepEqual(filterCredentials(rows, 'GITHUB').map((row) => row.id), ['github']);
  assert.deepEqual(filterCredentials(rows, 'example').map((row) => row.id), ['github']);
  assert.deepEqual(filterCredentials(rows, '').map((row) => row.id), ['github', 'feishu']);
});

test('credential row routes its trailing action to delete while its body still opens editing', () => {
  assert.equal(typeof credentialRowAction, 'function', 'credentialRowAction must exist');
  assert.deepEqual(credentialRowAction({ requestedAction: 'delete' }), {
    type: 'delete',
    label: '删除',
    ariaLabel: '删除密钥',
  });
  assert.deepEqual(credentialRowAction({ copyField: 'account' }), { type: 'copy', field: 'account' });
  assert.deepEqual(credentialRowAction({ rowBody: true }), { type: 'edit' });
  assert.deepEqual(credentialRowAction({ rowBody: true, shiftKey: true }), { type: 'select' });
  assert.deepEqual(credentialRowAction({ rowBody: true, selected: true }), { type: 'select' });
});

test('settings stays at the far right when optional tabs are hidden', () => {
  assert.equal(typeof visiblePanelTabs, 'function', 'visiblePanelTabs must exist');
const tabs = ['todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'];
  assert.deepEqual(visiblePanelTabs(tabs, { todo: false, clip: true }), [
'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.deepEqual(visiblePanelTabs(tabs, {
    todo: false,
    notes: false,
    links: false,
    recordings: false,
    credentials: false,
    clip: false,
    settings: false,
}), ['settings']);
});

test('default panel tab uses the preference only while that tab is visible', () => {
assert.equal(resolveDefaultPanelTab('todo', ['todo', 'settings']), 'todo');
assert.equal(resolveDefaultPanelTab('todo', ['settings']), 'settings');
assert.equal(resolveDefaultPanelTab('unknown', ['todo', 'settings']), 'todo');
});

test('settings summary combines safe API status with local device settings', () => {
  assert.equal(typeof settingsSummary, 'function', 'settingsSummary must exist');
  assert.deepEqual(settingsSummary({
    appSettings: { shortcut: 'Command+Shift+P', autoLaunch: true },
    workspace: { path: '/Users/test/Panel', portable: true },
  }), {
    shortcut: 'Command+Shift+P',
defaultTab: 'todo',
    autoLaunch: true,
    workspacePath: '/Users/test/Panel',
    workspaceLabel: '自定义文件夹',
    llm: { label: '未配置', state: 'empty' },
  });
  assert.doesNotMatch(JSON.stringify(settingsSummary({
    transcription: { configured: true, apiKey: 'api-secret' },
  })), /api-secret/);
});

test('saved notes preserve cleared content and keep recently updated notes first', () => {
  const notes = normalizeNoteArchive([
    { id: 'older', title: '产品复盘', titleSource: 'model', content: '  # 旧笔记\n正文  ', createdAt: 100, updatedAt: 200 },
    { id: 'newer', content: '新笔记', createdAt: 300, updatedAt: 400 },
    { id: 'empty', content: '', createdAt: 500, updatedAt: 500 },
    null,
  ]);
  assert.deepEqual(notes.map((note) => note.id), ['empty', 'newer', 'older']);
  assert.equal(notes[0].content, '');
  assert.equal(notes[2].content, '  # 旧笔记\n正文  ');
  assert.equal(notes[2].title, '产品复盘');
  assert.equal(notes[2].titleSource, 'model');
  assert.equal(notes[2].updatedAt, 200);
});

test('creating a note adds one editable empty record without duplicating ids', () => {
  const base = [{ id: 'existing', content: '正文', createdAt: 100, updatedAt: 100 }];
  const created = createNoteInArchive(base, 'new-note', 200);

  assert.deepEqual(created.map((note) => note.id), ['new-note', 'existing']);
  assert.equal(created[0].content, '');
  assert.equal(created[0].createdAt, 200);
  assert.deepEqual(createNoteInArchive(created, 'new-note', 300), created);
});

test('NexusDesk connection presentation keeps disconnect and logout responsibilities distinct', () => {
  assert.deepEqual(nexusdeskConnectionPresentation('disconnected', false), {
    statusLabel: '未登录', state: 'disconnected', connectLabel: '登录并连接', showLogout: false,
  });
  assert.deepEqual(nexusdeskConnectionPresentation('disconnected', true), {
    statusLabel: '已登录，未连接', state: 'disconnected', connectLabel: '重新连接', showLogout: true,
  });
  assert.deepEqual(nexusdeskConnectionPresentation('connected', true), {
    statusLabel: '已连接', state: 'connected', connectLabel: '断开连接', showLogout: true,
  });
});

test('editing a saved note updates content and timestamp without losing its identity', () => {
  const notes = normalizeNoteArchive([
    { id: 'selected', content: '旧内容', createdAt: 100, updatedAt: 200 },
    { id: 'other', content: '其他笔记', createdAt: 150, updatedAt: 300 },
  ]);
  const updated = updateNoteInArchive(notes, 'selected', '新内容\n第二行', 400);
  assert.deepEqual(updated.map((note) => note.id), ['selected', 'other']);
  assert.deepEqual(updated[0], {
    id: 'selected',
    title: '',
    titleSource: '',
    content: '新内容\n第二行',
    createdAt: 100,
    updatedAt: 400,
  });

  const cleared = updateNoteInArchive(updated, 'selected', '', 500);
  assert.equal(cleared[0].content, '');
  assert.equal(normalizeNoteArchive(JSON.parse(JSON.stringify(cleared)))[0].id, 'selected');
});

test('note search matches titles and full content without changing archive order', () => {
  const notes = normalizeNoteArchive([
    { id: 'one', title: 'TO-DO Panel 设计', titleSource: 'model', content: '正文没有产品英文名', createdAt: 100, updatedAt: 300 },
    { id: 'two', content: '会议备忘\n下周交付录制功能', createdAt: 200, updatedAt: 200 },
  ]);
  assert.deepEqual(filterNotes(notes, 'to-do').map((note) => note.id), ['one']);
  assert.deepEqual(filterNotes(notes, '录制').map((note) => note.id), ['two']);
  assert.deepEqual(filterNotes(notes, '').map((note) => note.id), ['one', 'two']);
});

test('users can rename a note without changing its content', () => {
  const notes = normalizeNoteArchive([
    { id: 'note-1', title: '模型标题', titleSource: 'model', content: '正文', createdAt: 100, updatedAt: 200 },
  ]);
  const renamed = updateNoteTitle(notes, 'note-1', '  用户自己的标题  ', 300);
  assert.deepEqual(renamed[0], {
    id: 'note-1',
    title: '用户自己的标题',
    titleSource: 'user',
    content: '正文',
    createdAt: 100,
    updatedAt: 300,
  });
});

test('generated note titles never overwrite user titles or stale content', () => {
  const base = normalizeNoteArchive([
    { id: 'note-1', content: '最初正文', createdAt: 100, updatedAt: 200 },
  ]);
  const generated = applyGeneratedNoteTitle(base, 'note-1', '模型概括标题', '最初正文');
  assert.equal(generated[0].title, '模型概括标题');
  assert.equal(generated[0].titleSource, 'model');

  const userRenamed = updateNoteTitle(generated, 'note-1', '我的标题', 300);
  assert.equal(applyGeneratedNoteTitle(userRenamed, 'note-1', '迟到的模型标题', '最初正文')[0].title, '我的标题');

  const edited = updateNoteInArchive(base, 'note-1', '已经变化的正文', 400);
  assert.equal(applyGeneratedNoteTitle(edited, 'note-1', '过期标题', '最初正文')[0].title, '');
});

test('API credential statuses distinguish saved, missing, and legacy keys that need re-entry', () => {
  assert.deepEqual(apiCredentialStatuses({
    configured: true,
    llmConfigured: false,
    llmNeedsReentry: true,
  }), {
    llm: { label: '需重新输入', state: 'warning' },
  });
  assert.deepEqual(apiCredentialStatuses({}), {
    llm: { label: '未配置', state: 'empty' },
  });
});


test('todo category names migrate to work streams and reject blank edits', () => {
  const defaults = {
    P0: '重要且紧急',
    P1: '自媒体&写作',
    P2: 'Vibe coding',
    P3: '日常',
  };
  assert.deepEqual(normalizeTodoCategoryNames(null, defaults), defaults);
  assert.deepEqual(normalizeTodoCategoryNames({ P0: '  教学产品  ', P1: '', P4: '无效' }, defaults), {
    P0: '教学产品',
    P1: '自媒体&写作',
    P2: 'Vibe coding',
    P3: '日常',
  });
});












test('shouldTogglePanelForSpace toggles plain Space but never steals typing input', () => {
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: false }), true);
  assert.equal(shouldTogglePanelForSpace({ key: 'Spacebar', repeat: false, editable: false }), true);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: true, editable: false }), false);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: true }), false);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: false, metaKey: true }), false);
});


test('todo time battery reports the remaining time with exact color boundaries', () => {
  const deadline = '2026-08-21T10:00:00.000Z';
  const todo = { deadline, done: false };
  // 距截止 25h ≥ 24h：满格 100%，显示剩余天数，不再受创建时间影响
  assert.deepEqual(todoTimeBattery(todo, Date.parse('2026-08-20T09:00:00.000Z')), {
    percent: 100,
    tone: 'green',
    overdue: false,
    label: '剩余 1天',
    text: '1天',
  });
  // 剩 8h → 33%
  assert.deepEqual(todoTimeBattery(todo, Date.parse('2026-08-21T02:00:00.000Z')), {
    percent: 33,
    tone: 'orange',
    overdue: false,
    label: '剩余 8小时',
    text: '8h',
  });
  // 剩 5h → 21%，进入红色
  assert.equal(todoTimeBattery(todo, Date.parse('2026-08-21T05:00:00.000Z')).tone, 'red');
  // 恰好压在截止点上就算逾期，不再是「剩余 0%」。
  assert.deepEqual(todoTimeBattery(todo, Date.parse('2026-08-21T10:00:00.000Z')), {
    percent: 0,
    tone: 'red',
    overdue: true,
    label: '已逾期 1分钟',
    text: '+1m',
  });
  // 逾期前的最后一刻仍是「剩余 1m」：取整落到 0 与真正欠账必须可区分。
  const almostDue = todoTimeBattery(todo, Date.parse('2026-08-21T09:59:00.000Z'));
  assert.equal(almostDue.overdue, false);
  assert.equal(almostDue.percent, 0);
  assert.equal(almostDue.label, '剩余 1分钟');
  assert.equal(almostDue.text, '1m');
  assert.equal(todoTimeBattery({ deadline, done: true }, Date.parse('2026-08-21T02:00:00.000Z')), null);
  assert.deepEqual(todoTimeBattery({}, Date.parse('2026-08-21T02:00:00.000Z')), {
    percent: 0,
    tone: 'muted',
    overdue: false,
    label: '待补充有效截止时间',
    text: '无期限',
  });
});

test('Shift range selection selects contiguous rows while plain selection resets the range', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(updateRangeSelection(ids, [], 'b', null, false), {
    selected: ['b'],
    anchor: 'b',
  });
  assert.deepEqual(updateRangeSelection(ids, ['b'], 'd', 'b', true), {
    selected: ['b', 'c', 'd'],
    anchor: 'b',
  });
  assert.deepEqual(updateRangeSelection(ids, ['b', 'c', 'd'], 'c', 'b', false), {
    selected: ['c'],
    anchor: 'c',
  });
  assert.deepEqual(updateRangeSelection(ids, ['a'], 'missing', 'a', true), {
    selected: ['a'],
    anchor: 'a',
  });
});

test('credential selection can toggle its only selected row off', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(updateRangeSelection(ids, ['b'], 'b', 'b', false, true), {
    selected: [],
    anchor: null,
  });
});

test('todo project grouping keeps first-seen order and isolates ungrouped items', () => {
  const groups = domain.groupTodosByProject([
    { id: 'a', text: 'A', project: 'Woorinet' },
    { id: 'b', text: 'B', project: '' },
    { id: 'c', text: 'C', project: 'Woorinet' },
    { id: 'd', text: 'D', project: '官网' },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.project, g.items.map((i) => i.id)]),
    [
      ['Woorinet', ['a', 'c']],
      ['', ['b']],
      ['官网', ['d']],
    ]
  );
});

test('todo project grouping merges spacing and case variants of the same project', () => {
  const groups = domain.groupTodosByProject([
    { id: 'a', text: 'A', project: ' Acme ' },
    { id: 'b', text: 'B', project: 'acme' },
    { id: 'c', text: 'C', project: 'ACME' },
  ]);
  assert.deepEqual(groups.map((group) => [group.project, group.items.map((item) => item.id)]), [
    ['Acme', ['a', 'b', 'c']],
  ]);
});

test('dominant project returns the most frequent named project or empty string', () => {
  assert.equal(domain.dominantProject([{ project: 'Woorinet' }, { project: 'Woorinet' }, { project: '官网' }, { project: '' }]), 'Woorinet');
  assert.equal(domain.dominantProject([{ project: '' }, { project: '' }]), '');
  assert.equal(domain.dominantProject([]), '');
  assert.equal(domain.dominantProject([{ project: '  ' }]), '');
});

test('todo project color is deterministic per project name', () => {
  const first = domain.todoProjectColor('Woorinet');
  assert.equal(domain.todoProjectColor('Woorinet'), first);
  assert.equal(typeof first, 'string');
  assert.ok(first.startsWith('#'));
});
