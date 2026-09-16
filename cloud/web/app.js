var token = localStorage.getItem('nexusdesk_token') || '';
var user = JSON.parse(localStorage.getItem('nexusdesk_user') || 'null');
var currentTab = 'todos';
var expandedUsers = {};

var QUADRANTS = [
  { key: 'P0', label: '重要且紧急', icon: '🔴' },
  { key: 'P1', label: '重要不紧急', icon: '🟠' },
  { key: 'P2', label: '紧急不重要', icon: '🔵' },
  { key: 'P3', label: '日常事务', icon: '🟢' }
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(v) {
  if (!v) return '';
  var d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtFull(v) {
  if (!v) return '';
  var d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN');
}
function statusOf(x) {
  return x.done ? '已完成' : (x.status || '进行中');
}
function statusCls(x) {
  return x.done ? 'st-done' : (x.status === '延期' ? 'st-late' : (x.status === '未开始' ? 'st-new' : 'st-active'));
}

async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  var res = await fetch(path, opts);
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  return res.json();
}

function logout() {
  token = ''; user = null;
  localStorage.removeItem('nexusdesk_token');
  localStorage.removeItem('nexusdesk_user');
  render();
}

function render() {
  var app = document.getElementById('app');
  if (!token || !user) return renderLogin(app);
  if (user.mustChangePassword) return renderChangePwd(app);
  renderDashboard(app);
}

function el(html) {
  var d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild;
}

function avatarText() {
  var n = (user.name || user.employeeId || 'U').toString();
  return n.charAt(0).toUpperCase();
}

/* ===== 登录 ===== */
function renderLogin(app) {
  app.innerHTML = '';
  var page = el('<div class="login-page"></div>');
  var card = el('<div class="login-card"></div>');
  var left = el('<div class="login-left"><div class="login-left-inner">' +
    '<div class="brand-logo"><div class="mark">N</div><div class="name">NexusDesk</div></div>' +
    '<div class="brand-headline">待办同步<br/>原来这么简单</div>' +
    '<div class="brand-sub">桌面端刘海工作台，待办实时上云。多设备同步，团队共享一个待办池。</div>' +
    '<div class="brand-features">' +
      '<div class="brand-feature"><div class="icon">⚡</div>实时同步</div>' +
      '<div class="brand-feature"><div class="icon">🔒</div>工号登录</div>' +
      '<div class="brand-feature"><div class="icon">📋</div>团队待办池</div>' +
    '</div>' +
  '</div></div>');
  var right = el('<div class="login-right">' +
    '<h2>欢迎回来</h2>' +
    '<div class="sub">用工号登录继续</div>' +
    '<div id="err"></div>' +
    '<div class="field"><label>工号</label><input type="text" id="empId" autocomplete="username" placeholder="请输入工号"></div>' +
    '<div class="field"><label>密码</label><input type="password" id="pwd" autocomplete="current-password" placeholder="请输入密码"></div>' +
    '<button class="btn-primary" id="loginBtn">登 录</button>' +
    '<div class="login-footer">默认密码为工号，首次登录后请修改</div>' +
  '</div>');
  card.appendChild(left); card.appendChild(right);
  page.appendChild(card);
  app.appendChild(page);
  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('pwd').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
  document.getElementById('empId').focus();
}

async function doLogin() {
  var empId = document.getElementById('empId').value.trim();
  var pwd = document.getElementById('pwd').value;
  var btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    var res = await api('/api/login', { method: 'POST', body: JSON.stringify({ employeeId: empId, password: pwd }) });
    if (res.error) {
      document.getElementById('err').innerHTML = '<div class="error-msg">' + esc(res.error) + '</div>';
      btn.disabled = false; btn.textContent = '登 录';
      return;
    }
    token = res.token; user = res.user; currentTab = 'todos';
    localStorage.setItem('nexusdesk_token', token);
    localStorage.setItem('nexusdesk_user', JSON.stringify(user));
    render();
  } catch (e) {
    document.getElementById('err').innerHTML = '<div class="error-msg">网络错误</div>';
    btn.disabled = false; btn.textContent = '登 录';
  }
}

/* ===== 改密 ===== */
function renderChangePwd(app) {
  app.innerHTML = '';
  var page = el('<div class="login-page"></div>');
  var card = el('<div class="login-card"></div>');
  var left = el('<div class="login-left"><div class="login-left-inner">' +
    '<div class="brand-logo"><div class="mark">N</div><div class="name">NexusDesk</div></div>' +
    '<div class="brand-headline">首次登录</div>' +
    '<div class="brand-sub">为了安全，请修改初始密码。</div></div></div>');
  var right = el('<div class="login-right"><h2>修改密码</h2><div class="sub">新密码至少 4 位</div><div id="err"></div>' +
    '<div class="field"><label>原密码</label><input type="password" id="oldPwd"></div>' +
    '<div class="field"><label>新密码</label><input type="password" id="newPwd"></div>' +
    '<button class="btn-primary">确认修改</button></div>');
  right.querySelector('button').onclick = doChangePwd;
  card.appendChild(left); card.appendChild(right);
  page.appendChild(card);
  app.appendChild(page);
}

async function doChangePwd() {
  var oldPwd = document.getElementById('oldPwd').value;
  var newPwd = document.getElementById('newPwd').value;
  try {
    var res = await api('/api/change-password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }) });
    if (res.error) { document.getElementById('err').innerHTML = '<div class="error-msg">' + esc(res.error) + '</div>'; return; }
    user.mustChangePassword = false;
    localStorage.setItem('nexusdesk_user', JSON.stringify(user));
    render();
  } catch (e) { document.getElementById('err').innerHTML = '<div class="error-msg">网络错误</div>'; }
}

/* ===== 待办行渲染（含进展预览）===== */
function renderTodoRow(x, idx, showWho) {
  var st = statusOf(x);
  var stCls = statusCls(x);
  var project = (x.project || '').trim() ? '<span class="todo-project">📁 ' + esc(x.project) + '</span>' : '';
  var progressHtml = '';
  if (x.progressText) {
    progressHtml += '<div class="todo-progress-preview"><span class="todo-progress-label">📝 本周进展</span>' + esc(x.progressText) + '</div>';
  }
  if (x.nextWeek) {
    progressHtml += '<div class="todo-progress-preview next"><span class="todo-progress-label">🗓 下周计划</span>' + esc(x.nextWeek) + '</div>';
  }
  return '<div class="todo-row ' + (x.done ? 'done' : '') + '" data-idx="' + idx + '">' +
    '<div class="todo-check">' + (x.done ? '✓' : '') + '</div>' +
    '<div class="todo-main">' +
      '<div class="todo-title-line"><span class="todo-text">' + esc(x.text) + '</span>' + project + '</div>' +
      '<div class="todo-meta">' +
        '<span class="status-badge ' + stCls + '">' + st + '</span>' +
        (x.dueTime ? '<span class="todo-due">⏰ ' + fmtDate(x.dueTime) + '</span>' : '') +
        (showWho ? '<span class="todo-who">👤 ' + esc(x.employeeId || '') + '</span>' : '') +
      '</div>' +
      progressHtml +
    '</div>' +
  '</div>';
}

/* ===== 主界面 ===== */
async function renderDashboard(app) {
  app.innerHTML = '';
  var isAdmin = user.role === 'admin';
  var dash = el('<div class="dash">' +
    '<div class="sidebar">' +
      '<div class="sidebar-logo"><div class="mark">N</div><div class="name">NexusDesk</div></div>' +
      '<div class="nav-item' + (currentTab === 'todos' ? ' active' : '') + '" data-tab="todos">📋 待办总览</div>' +
      (isAdmin ? '<div class="nav-item' + (currentTab === 'members' ? ' active' : '') + '" data-tab="members">👥 成员</div>' : '') +
      '<div class="nav-item' + (currentTab === 'projects' ? ' active' : '') + '" data-tab="projects">📁 项目</div>' +
      '<div class="nav-item' + (currentTab === 'settings' ? ' active' : '') + '" data-tab="settings">⚙️ 设置</div>' +
    '</div>' +
    '<div class="main">' +
      '<div class="topbar"><div class="topbar-title" id="topbarTitle">待办总览</div>' +
      '<div class="topbar-right"><div class="user-info"><div class="user-name">' + esc(user.name || user.employeeId) + '</div><div class="user-role">' + (isAdmin ? '管理员' : '成员') + '</div></div><div class="avatar">' + avatarText() + '</div><button class="btn-ghost">退出</button></div></div>' +
      '<div class="dash-body" id="body"><div class="skeleton" style="height:420px;border-radius:14px"></div></div>' +
    '</div></div>');
  dash.querySelector('.btn-ghost').onclick = logout;
  var navItems = dash.querySelectorAll('.nav-item');
  for (var i = 0; i < navItems.length; i++) {
    (function (item) {
      item.onclick = function () {
        var tab = item.getAttribute('data-tab');
        if (tab === currentTab) return;
        currentTab = tab;
        renderDashboard(app);
      };
    })(navItems[i]);
  }
  app.appendChild(dash);

  /* 设置 */
  if (currentTab === 'settings') {
    document.getElementById('topbarTitle').textContent = '设置';
    document.getElementById('body').innerHTML =
      '<div class="page-title fade-up">设置</div><div class="page-sub fade-up fade-up-1">账户与同步</div>' +
      '<div class="panel fade-up fade-up-2"><div class="panel-head"><div class="panel-title">账户信息</div></div>' +
      '<div class="settings-row"><div class="settings-label">工号</div><div class="settings-value">' + esc(user.employeeId) + '</div></div>' +
      '<div class="settings-row"><div class="settings-label">姓名</div><div class="settings-value">' + esc(user.name || '-') + '</div></div>' +
      '<div class="settings-row"><div class="settings-label">角色</div><div class="settings-value">' + (isAdmin ? '管理员' : '成员') + '</div></div>' +
      '<div class="settings-row"><div class="settings-label">同步状态</div><div class="settings-value">桌面端登录后自动同步</div></div>' +
      '</div>';
    return;
  }

  /* 项目 */
  if (currentTab === 'projects') {
    document.getElementById('topbarTitle').textContent = '项目';
    var projRes = isAdmin ? await api('/api/admin/todos') : await api('/api/my/todos');
    var projTodos = projRes.todos || [];
    var projMap = {};
    for (var pi = 0; pi < projTodos.length; pi++) {
      var pn = (projTodos[pi].project || '').trim() || '未分组';
      if (!projMap[pn]) projMap[pn] = [];
      projMap[pn].push(pi);
    }
    var projNames = Object.keys(projMap).sort();
    var projHtml = projNames.length === 0
      ? '<div class="empty"><div class="empty-icon">📁</div>暂无项目数据<br/>给待办添加项目后自动归类</div>'
      : projNames.map(function (pn) {
          var idxs = projMap[pn];
          var listDone = idxs.filter(function (ix) { return projTodos[ix].done; }).length;
          var rowsHtml = idxs.map(function (ix) { return renderTodoRow(projTodos[ix], ix, isAdmin); }).join('');
          return '<div class="quadrant"><div class="quadrant-head quadrant-P3"><div class="quadrant-title">📁 ' + esc(pn) + '</div><div class="quadrant-count">' + (idxs.length - listDone) + ' 进行中 · ' + listDone + ' 已完成</div></div>' + rowsHtml + '</div>';
        }).join('');
    document.getElementById('body').innerHTML =
      '<div class="page-title fade-up">项目</div><div class="page-sub fade-up fade-up-1">按项目自动归类，共 ' + projNames.length + ' 个项目</div>' +
      '<div class="panel fade-up fade-up-2">' + projHtml + '</div>';
    bindTodoRows(projTodos);
    return;
  }

  /* 成员（管理员） */
  if (currentTab === 'members' && isAdmin) {
    document.getElementById('topbarTitle').textContent = '成员';
    var u2 = await api('/api/admin/users');
    var onlineCount = (u2.users || []).filter(function (x) { return x.online; }).length;
    var usersHtml2 = (u2.users || []).map(function (x) {
      return '<tr><td><span class="online-dot ' + (x.online ? 'on' : 'off') + '"></span>' + esc(x.employeeId) + '</td><td>' + esc(x.name) + '</td><td><span class="badge ' + (x.role === 'admin' ? 'badge-admin' : 'badge-user') + '">' + (x.role === 'admin' ? '管理员' : '成员') + '</span></td><td style="color:' + (x.online ? 'var(--accent)' : 'var(--text-3)') + ';font-weight:600">' + (x.online ? '● 在线' : '○ 离线') + '</td></tr>';
    }).join('');
    document.getElementById('body').innerHTML =
      '<div class="page-title fade-up">成员</div><div class="page-sub fade-up fade-up-1">共 ' + (u2.users || []).length + ' 人，' + onlineCount + ' 人在线</div>' +
      '<div class="panel fade-up fade-up-2">' +
        '<div class="panel-head"><div class="panel-title">新建成员</div></div>' +
        '<div class="create-user-form">' +
          '<div class="field"><label>工号</label><input type="text" id="newEmpId" placeholder="如 005612" autocomplete="off"></div>' +
          '<div class="field"><label>姓名</label><input type="text" id="newUserName" placeholder="如 张三" autocomplete="off"></div>' +
          '<button class="btn-primary" id="createUserBtn" type="button">添加成员</button>' +
        '</div>' +
        '<div class="form-hint">默认密码=工号，成员首次登录后自行修改</div>' +
        '<div id="createUserMsg"></div>' +
      '</div>' +
      '<div class="panel fade-up fade-up-2"><table><thead><tr><th>工号</th><th>姓名</th><th>角色</th><th>状态</th></tr></thead><tbody>' + usersHtml2 + '</tbody></table></div>';
    var cuBtn = document.getElementById('createUserBtn');
    if (cuBtn) cuBtn.onclick = doCreateUser;
    return;
  }

  /* 新建成员（管理员） */
  async function doCreateUser() {
    var empId = document.getElementById('newEmpId').value.trim();
    var name = document.getElementById('newUserName').value.trim();
    var msg = document.getElementById('createUserMsg');
    var btn = document.getElementById('createUserBtn');
    if (!empId) {
      if (msg) msg.innerHTML = '<div class="error-msg">工号不能为空</div>';
      return;
    }
    btn.disabled = true; btn.textContent = '添加中…';
    try {
      var res = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ employeeId: empId, name: name }) });
      if (res.error) {
        if (msg) msg.innerHTML = '<div class="error-msg">' + esc(res.error) + '</div>';
        btn.disabled = false; btn.textContent = '添加成员';
        return;
      }
      if (msg) msg.innerHTML = '<div class="ok-msg">已创建 ' + esc(res.user.employeeId) + '，默认密码=工号，首次登录后自行修改</div>';
      document.getElementById('newEmpId').value = '';
      document.getElementById('newUserName').value = '';
      btn.disabled = false; btn.textContent = '添加成员';
      renderDashboard(document.getElementById('app'));
    } catch (e) {
      if (msg) msg.innerHTML = '<div class="error-msg">网络错误</div>';
      btn.disabled = false; btn.textContent = '添加成员';
    }
  }

  /* 我的待办（普通用户） */
  if (!isAdmin) {
    document.getElementById('topbarTitle').textContent = '我的待办';
    var myTodos = await api('/api/my/todos');
    var myList = myTodos.todos || [];
    var myDone = myList.filter(function (x) { return x.done; }).length;
    var myActive = myList.length - myDone;
    var myGroups = QUADRANTS.map(function (q) {
      var idxs = myList.map(function (x, ix) { return ix; }).filter(function (ix) { return (myList[ix].priority || 'P3') === q.key; });
      if (idxs.length === 0) return '';
      var listDone = idxs.filter(function (ix) { return myList[ix].done; }).length;
      var rowsHtml = idxs.map(function (ix) { return renderTodoRow(myList[ix], ix, false); }).join('');
      return '<div class="quadrant"><div class="quadrant-head quadrant-' + q.key + '"><div class="quadrant-title">' + q.icon + ' ' + q.label + '</div><div class="quadrant-count">' + (idxs.length - listDone) + ' 进行中 · ' + listDone + ' 已完成</div></div>' + rowsHtml + '</div>';
    }).join('');
    document.getElementById('body').innerHTML =
      '<div class="page-title fade-up">我的待办</div><div class="page-sub fade-up fade-up-1">桌面端连接后自动同步</div>' +
      '<div class="stats-grid">' +
        '<div class="stat-card fade-up fade-up-1"><div class="stat-icon gray">📋</div><div><div class="stat-num">' + myList.length + '</div><div class="stat-label">全部待办</div></div></div>' +
        '<div class="stat-card fade-up fade-up-2"><div class="stat-icon orange">⏳</div><div><div class="stat-num">' + myActive + '</div><div class="stat-label">进行中</div></div></div>' +
        '<div class="stat-card fade-up fade-up-3"><div class="stat-icon green">✅</div><div><div class="stat-num">' + myDone + '</div><div class="stat-label">已完成</div></div></div>' +
      '</div>' +
      '<div class="panel fade-up fade-up-2"><div class="panel-head"><div class="panel-title">待办列表</div><div class="panel-count"><button class="btn-ghost export-btn">导出CSV</button></div></div>' + (myGroups || '<div class="empty"><div class="empty-icon">📋</div>暂无待办</div>') + '</div>';
    bindTodoRows(myList);
    var mb = document.querySelector('.export-btn');
    if (mb) mb.onclick = function () { exportCsv(myList); };
    return;
  }

  /* 待办总览（管理员） */
  document.getElementById('topbarTitle').textContent = '待办总览';
  var u = await api('/api/admin/users');
  var t = await api('/api/admin/todos');
  var todos = t.todos || [];
  var done = todos.filter(function (x) { return x.done; }).length;
  var active = todos.length - done;
  var onlineMap = {};
  for (var oi = 0; oi < (u.users || []).length; oi++) { onlineMap[u.users[oi].employeeId] = u.users[oi].online; }

  var byUser = {};
  for (var bi = 0; bi < todos.length; bi++) {
    var eid = todos[bi].employeeId || 'unknown';
    if (!byUser[eid]) byUser[eid] = [];
    byUser[eid].push(bi);
  }
  var userIds = Object.keys(byUser).sort();
  var groupsHtml = userIds.map(function (eid) {
    var idxs = byUser[eid];
    var expanded = expandedUsers[eid] !== false;
    var userDone = idxs.filter(function (ix) { return todos[ix].done; }).length;
    var userQuads = QUADRANTS.map(function (q) {
      var list = idxs.filter(function (ix) { return (todos[ix].priority || 'P3') === q.key; });
      if (list.length === 0) return '';
      var listDone = list.filter(function (ix) { return todos[ix].done; }).length;
      var rowsHtml = list.map(function (ix) { return renderTodoRow(todos[ix], ix, false); }).join('');
      return '<div class="quadrant"><div class="quadrant-head quadrant-' + q.key + '"><div class="quadrant-title">' + q.icon + ' ' + q.label + '</div><div class="quadrant-count">' + (list.length - listDone) + ' 进行中 · ' + listDone + ' 已完成</div></div>' + rowsHtml + '</div>';
    }).join('');
    return '<div class="user-group">' +
      '<div class="user-group-head" data-user="' + esc(eid) + '">' +
        '<div class="user-group-title">' + (expanded ? '▾' : '▸') + ' <span class="online-dot ' + (onlineMap[eid] ? 'on' : 'off') + '"></span><span class="user-group-avatar">' + esc(eid.charAt(0).toUpperCase()) + '</span> ' + esc(eid) + '</div>' +
        '<div class="user-group-count">' + (idxs.length - userDone) + ' 进行中 · ' + userDone + ' 已完成</div>' +
      '</div>' +
      (expanded ? '<div class="user-group-body">' + userQuads + '</div>' : '<div class="user-group-collapsed"></div>') +
    '</div>';
  }).join('');

  document.getElementById('body').innerHTML =
    '<div class="page-title fade-up">团队总览</div><div class="page-sub fade-up fade-up-1">实时同步所有成员的待办状态</div>' +
    '<div class="stats-grid">' +
      '<div class="stat-card fade-up fade-up-1" data-go="members"><div class="stat-icon blue">👥</div><div><div class="stat-num">' + (u.users || []).length + '</div><div class="stat-label">成员</div></div></div>' +
      '<div class="stat-card fade-up fade-up-2"><div class="stat-icon gray">📋</div><div><div class="stat-num">' + todos.length + '</div><div class="stat-label">待办总数</div></div></div>' +
      '<div class="stat-card fade-up fade-up-3"><div class="stat-icon orange">⏳</div><div><div class="stat-num">' + active + '</div><div class="stat-label">进行中</div></div></div>' +
      '<div class="stat-card fade-up fade-up-4"><div class="stat-icon green">✅</div><div><div class="stat-num">' + done + '</div><div class="stat-label">已完成</div></div></div>' +
    '</div>' +
    '<div class="panel fade-up fade-up-2"><div class="panel-head"><div class="panel-title">待办列表</div><div class="panel-count"><button class="btn-ghost export-btn">导出CSV</button></div></div>' + (groupsHtml || '<div class="empty"><div class="empty-icon">📋</div>暂无待办</div>') + '</div>';

  var memberCard = document.querySelector('[data-go="members"]');
  if (memberCard) memberCard.onclick = function () { currentTab = 'members'; renderDashboard(app); };
  var eb = document.querySelector('.export-btn');
  if (eb) eb.onclick = function () { exportCsv(todos); };

  var heads = document.querySelectorAll('.user-group-head');
  for (var h = 0; h < heads.length; h++) {
    (function (head) {
      head.onclick = function () {
        var eid = head.getAttribute('data-user');
        expandedUsers[eid] = expandedUsers[eid] === false;
        renderDashboard(app);
      };
    })(heads[h]);
  }

  bindTodoRows(todos);
}

function bindTodoRows(todos) {
  var rows = document.querySelectorAll('.todo-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].style.cursor = 'pointer';
    (function (row) {
      var idx = Number(row.getAttribute('data-idx'));
      if (!Number.isFinite(idx)) idx = i;
      row.onclick = function () { showTodoDetail(todos[idx]); };
    })(rows[i]);
  }
}

/* ===== 详情弹窗（含进展）===== */
function showTodoDetail(t) {
  if (!t) return;
  var st = statusOf(t);
  var stCls = statusCls(t);
  var modal = document.createElement('div');
  modal.className = 'modal-mask';
  var card = document.createElement('div');
  card.className = 'modal-card';
  var progSections = '';
  if (t.progressText) progSections += '<div class="modal-section green"><span class="sec-label">📝 本周进展</span>' + esc(t.progressText) + '</div>';
  if (t.nextWeek) progSections += '<div class="modal-section blue"><span class="sec-label">🗓 下周计划</span>' + esc(t.nextWeek) + '</div>';
  card.innerHTML =
    '<div class="modal-title">' + (t.done ? '✅ ' : '📋 ') + esc(t.text) + '</div>' +
    '<div class="modal-row"><span class="k">项目</span><span class="v">' + esc(t.project || '-') + '</span></div>' +
    '<div class="modal-row"><span class="k">优先级</span><span class="v">' + esc(t.priority || '-') + '</span></div>' +
    '<div class="modal-row"><span class="k">负责人</span><span class="v">' + esc(t.employeeId || '-') + '</span></div>' +
    '<div class="modal-row"><span class="k">截止时间</span><span class="v">' + (t.dueTime ? fmtFull(t.dueTime) : '-') + '</span></div>' +
    '<div class="modal-row"><span class="k">状态</span><span class="v"><span class="status-badge ' + stCls + '">' + st + '</span></span></div>' +
    progSections +
    '<div class="modal-row" style="margin-bottom:20px"><span class="k">更新时间</span><span class="v">' + (t.updatedAt ? fmtFull(t.updatedAt) : '-') + '</span></div>' +
    '<button class="btn-close">关 闭</button>';
  modal.appendChild(card);
  modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
  card.querySelector('.btn-close').onclick = function () { modal.remove(); };
  document.body.appendChild(modal);
}

/* ===== 导出 CSV ===== */
function exportCsv(todos) {
  var csv = '\uFEFF工号,项目,待办内容,优先级,状态,截止时间,本周进展,下周计划,更新时间\n';
  for (var i = 0; i < todos.length; i++) {
    var t = todos[i];
    csv += [
      t.employeeId || '',
      t.project || '',
      (t.text || '').replace(/,/g, '，'),
      t.priority || '',
      t.done ? '已完成' : (t.status || '进行中'),
      t.dueTime ? new Date(t.dueTime).toLocaleDateString() : '',
      (t.progressText || '').replace(/,/g, '，').replace(/\n/g, ' '),
      (t.nextWeek || '').replace(/,/g, '，').replace(/\n/g, ' '),
      t.updatedAt ? new Date(t.updatedAt).toLocaleString() : ''
    ].join(',') + '\n';
  }
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'nexusdesk-todos-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

render();
