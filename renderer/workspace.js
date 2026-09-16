(function initWorkspace() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const COMMANDS_KEY = 'notch-home-commands';
  const LINKS_KEY = 'notch-link-groups';
    const HIDDEN_WINDOWS_KEY = 'notch-hidden-windows';

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/></svg>';
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  // ============ 常用指令 ============
  const commandInput = document.getElementById('command-add');
  const commandList = document.getElementById('command-list');
  const commandBulkDelete = document.getElementById('command-bulk-delete');
  let commands = loadJson(COMMANDS_KEY, [])
    .map((item) => Domain.createCommand(item && item.text, item && item.id, item && item.createdAt))
    .filter(Boolean);
  let commandSelection = new Set();
  let commandSelectionAnchor = null;

  function persistCommands() {
    saveJson(COMMANDS_KEY, commands);
  }

  function renderCommands() {
    if (!commandList) return;
    commandList.replaceChildren();
    if (commandBulkDelete) {
      commandBulkDelete.hidden = commandSelection.size === 0;
      commandBulkDelete.textContent = '删除';
      commandBulkDelete.setAttribute('aria-label', commandSelection.size
        ? `删除 ${commandSelection.size} 项`
        : '删除所选');
    }
    if (!commands.length) {
      const empty = document.createElement('div');
      empty.className = 'command-empty';
      empty.textContent = '把常用命令、提示词或回复模板放在这里';
      commandList.appendChild(empty);
      return;
    }
    commands.forEach((command) => {
      const row = document.createElement('div');
      row.className = `command-item${commandSelection.has(command.id) ? ' multi-selected' : ''}`;
      row.dataset.id = command.id;

      const textButton = document.createElement('button');
      textButton.className = 'command-text';
      textButton.type = 'button';
      textButton.dataset.action = 'edit-command';
      textButton.title = '点击修改';
      textButton.textContent = command.text;

      const actions = document.createElement('div');
      actions.className = 'command-actions';
      const copy = document.createElement('button');
      copy.className = 'icon-button';
      copy.type = 'button';
      copy.dataset.action = 'copy-command';
      copy.setAttribute('aria-label', '复制指令');
      copy.innerHTML = COPY_ICON;
      const remove = document.createElement('button');
      remove.className = 'icon-button danger';
      remove.type = 'button';
      remove.dataset.action = 'delete-command';
      remove.setAttribute('aria-label', '删除指令');
      remove.innerHTML = DELETE_ICON;
      actions.append(copy, remove);
      row.append(textButton, actions);
      commandList.appendChild(row);
    });
  }

  function editCommand(row) {
    const command = commands.find((item) => item.id === row.dataset.id);
    if (!command || row.querySelector('input')) return;
    const button = row.querySelector('.command-text');
    const input = document.createElement('input');
    input.className = 'command-edit';
    input.value = command.text;
    button.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value) command.text = value;
      persistCommands();
      renderCommands();
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) finish(true);
      if (event.key === 'Escape') finish(false);
    });
  }

  if (commandInput) {
    commandInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const command = Domain.createCommand(commandInput.value, uid('command'), Date.now());
      if (!command) return;
      commands.unshift(command);
      commandInput.value = '';
      persistCommands();
      renderCommands();
    });
  }

  if (commandList) {
    commandList.addEventListener('click', async (event) => {
      const row = event.target.closest('.command-item');
      if (!row) return;
      const command = commands.find((item) => item.id === row.dataset.id);
      if (!command) return;
      if (event.shiftKey) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          commands.map((item) => item.id),
          [...commandSelection],
          command.id,
          commandSelectionAnchor,
          true
        );
        commandSelection = new Set(result.selected);
        commandSelectionAnchor = result.anchor;
        renderCommands();
        return;
      }
      commandSelectionAnchor = command.id;
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'edit-command') editCommand(row);
      if (action.dataset.action === 'delete-command') {
        commands = commands.filter((item) => item.id !== command.id);
        commandSelection.delete(command.id);
        persistCommands();
        renderCommands();
      }
      if (action.dataset.action === 'copy-command' && window.notchAPI) {
        const copied = await window.notchAPI.writeClipboard({ type: 'text', text: command.text });
        if (copied) {
          row.classList.add('copied');
          setTimeout(() => row.classList.remove('copied'), 700);
        }
      }
    });
  }
  commandBulkDelete?.addEventListener('click', () => {
    if (!commandSelection.size) return;
    commands = commands.filter((command) => !commandSelection.has(command.id));
    commandSelection.clear();
    commandSelectionAnchor = null;
    persistCommands();
    renderCommands();
  });

  // ============ 链接收藏夹 ============
  const linkInput = document.getElementById('link-add');
  const linkBulkDelete = document.getElementById('link-bulk-delete');
  const linkGroupsEl = document.getElementById('link-groups');
  const linksStatus = document.getElementById('links-status');
  let linkGroups = loadJson(LINKS_KEY, []);
  if (!Array.isArray(linkGroups)) linkGroups = [];
  let linkSelection = new Set();
  let linkSelectionAnchor = null;
  let addingLinkGroupId = '';

  function persistLinks() {
    saveJson(LINKS_KEY, linkGroups);
  }

  function setLinksStatus(message, tone = '') {
    if (linksStatus) {
      linksStatus.textContent = '';
      linksStatus.dataset.tone = tone;
    }
    if (message && typeof showStatusToast === 'function') showStatusToast(message);
  }

  function allLinks() {
    return linkGroups.flatMap((group) => Array.isArray(group.links) ? group.links : []);
  }

  function updateLinkBulkAction() {
    if (!linkBulkDelete) return;
    linkBulkDelete.hidden = linkSelection.size === 0;
    linkBulkDelete.textContent = '删除';
    linkBulkDelete.setAttribute('aria-label', linkSelection.size
      ? `删除 ${linkSelection.size} 项`
      : '删除所选');
  }

  function linkHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
    }
  }

  function createIconButton(action, label, icon, danger = false) {
    const button = document.createElement('button');
    button.className = `icon-button${danger ? ' danger' : ''}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  function renderLinkGroups() {
    if (!linkGroupsEl) return;
    linkGroupsEl.replaceChildren();
    updateLinkBulkAction();
    if (!linkGroups.length) {
      const empty = document.createElement('div');
      empty.className = 'links-empty';
      empty.innerHTML = '<strong>还没有链接</strong><span>粘贴一个网址，TO-DO Panel 会读取标题并放进合适的分组。</span>';
      linkGroupsEl.appendChild(empty);
      return;
    }

    linkGroups.forEach((group) => {
      const section = document.createElement('section');
      section.className = `link-group${group.collapsed ? ' collapsed' : ''}`;
      section.dataset.groupId = group.id;

      const header = document.createElement('header');
      header.className = 'link-group-head';
      const toggle = document.createElement('button');
      toggle.className = 'group-toggle';
      toggle.type = 'button';
      toggle.dataset.action = 'toggle-group';
      toggle.setAttribute('aria-label', group.collapsed ? '展开分组' : '折叠分组');
      toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>';
      const name = document.createElement('input');
      name.className = 'group-name-input';
      name.value = String(group.name || '未命名分组');
      name.dataset.action = 'rename-group';
      name.setAttribute('aria-label', '分组名称');
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = `${Array.isArray(group.links) ? group.links.length : 0}`;
      header.append(toggle, name, count);
      header.appendChild(createIconButton('add-link-to-group', `在“${group.name || '当前分组'}”中新增链接`, ADD_ICON));
      header.appendChild(createIconButton('delete-group', '删除分组及其中所有链接', DELETE_ICON, true));

      const body = document.createElement('div');
      body.className = 'link-group-body';
      if (addingLinkGroupId === group.id) {
        const addRow = document.createElement('div');
        addRow.className = 'group-link-add';
        addRow.innerHTML = `<input data-group-link-input type="text" placeholder="粘贴网址并回车，添加到此分组" aria-label="添加链接到${String(group.name || '当前分组').replace(/[<>"&]/g, '')}" autocomplete="off" spellcheck="false"><button type="button" data-action="cancel-group-link-add" aria-label="取消">×</button>`;
        body.appendChild(addRow);
      }
      const list = document.createElement('div');
      list.className = 'link-list';
      (group.links || []).forEach((link) => {
        const row = document.createElement('article');
        row.className = `link-item${linkSelection.has(link.id) ? ' multi-selected' : ''}`;
        row.dataset.linkId = link.id;
        row.dataset.groupId = group.id;
        const mark = document.createElement('span');
        mark.className = 'link-favicon';
        if (link.icon && String(link.icon).startsWith('data:image/')) {
          const image = document.createElement('img');
          image.src = link.icon;
          image.alt = '';
          mark.appendChild(image);
        } else {
          mark.textContent = (linkHostname(link.url).charAt(0) || '·').toUpperCase();
        }
        const open = document.createElement('button');
        open.className = 'link-open';
        open.type = 'button';
        open.dataset.action = 'open-link';
        const title = document.createElement('strong');
        title.textContent = link.title || linkHostname(link.url);
        const domain = document.createElement('span');
        domain.textContent = linkHostname(link.url);
        open.append(title, domain);
        const actions = document.createElement('div');
        actions.className = 'link-actions';
        actions.append(
          createIconButton('open-link', '打开链接', OPEN_ICON),
          createIconButton('edit-link', '修改名称', EDIT_ICON),
          createIconButton('delete-link', '删除链接', DELETE_ICON, true)
        );
        row.append(mark, open, actions);
        list.appendChild(row);
      });

      body.append(list);
      section.append(header, body);
      linkGroupsEl.appendChild(section);
    });
  }

  function addLink(rawValue, requestedGroupId = '') {
    const normalized = Domain.normalizeHttpUrl(rawValue);
    if (!normalized) {
      setLinksStatus('请输入有效的公开网址', 'error');
      return false;
    }
    if (allLinks().some((link) => link.url === normalized)) {
      setLinksStatus('这个链接已经收藏过了', 'error');
      return false;
    }
    const link = { id: uid('link'), url: normalized, title: '未命名', icon: '', createdAt: Date.now() };
    const preferredGroupId = requestedGroupId || Domain.preferredLinkGroupId(linkGroups, normalized);
    const preferredGroup = linkGroups.find((group) => group.id === preferredGroupId);
    if (preferredGroup) {
      linkGroups = linkGroups.map((group) => group.id === preferredGroup.id
        ? { ...group, collapsed: false, links: [...(group.links || []), link] }
        : group);
    } else {
      linkGroups = Domain.addLinkToGroups(linkGroups, link, Domain.classifyLink(normalized, ''));
    }
    persistLinks();
    renderLinkGroups();
    setLinksStatus('链接已保存');

    // 保存动作不等待网络或大模型。标题、图标和分组在后台静默补全。
    Promise.resolve(window.notchAPI?.inspectLink?.(normalized)).then((inspected) => {
      if (!inspected?.ok) return;
      let sourceGroup = null;
      let savedLink = null;
      linkGroups.some((group) => {
        const found = (group.links || []).find((item) => item.id === link.id);
        if (!found) return false;
        sourceGroup = group;
        savedLink = found;
        return true;
      });
      if (!savedLink || !sourceGroup) return;
      savedLink.url = inspected.url || savedLink.url;
      savedLink.title = inspected.title || savedLink.title || '未命名';
      savedLink.icon = inspected.icon || savedLink.icon || '';
      // 手动定向或同站点复用后锁定分组；自动分类只使用可预测的本地规则，
      // 避免模型自由命名生成多个近义分组。
      const lockedGroupId = preferredGroup?.id || Domain.preferredLinkGroupId(
        linkGroups.map((group) => ({
          ...group,
          links: (group.links || []).filter((item) => item.id !== savedLink.id),
        })),
        savedLink.url
      );
      const nextCategory = Domain.classifyLink(savedLink.url, savedLink.title);
      if (!lockedGroupId && nextCategory && nextCategory !== sourceGroup.name) {
        const target = linkGroups.find((group) => group.name === nextCategory);
        if (target) {
          linkGroups = Domain.moveLinkToGroup(linkGroups, savedLink.id, target.id);
        } else {
          sourceGroup.links = sourceGroup.links.filter((item) => item.id !== savedLink.id);
          linkGroups = Domain.addLinkToGroups(linkGroups, savedLink, nextCategory);
        }
      }
      persistLinks();
      renderLinkGroups();
    }).catch(() => {});
    return true;
  }

  if (linkInput) {
    linkInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
      event.preventDefault();
      const value = linkInput.value;
      if (addLink(value)) linkInput.value = '';
      linkInput.focus();
    });
  }

  function findLink(group, linkId) {
    return group && (group.links || []).find((link) => link.id === linkId);
  }

  if (linkGroupsEl) {
    linkGroupsEl.addEventListener('change', (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('.group-name-input')) {
        linkGroups = Domain.renameGroup(linkGroups, groupSection.dataset.groupId, event.target.value);
        persistLinks();
        renderLinkGroups();
      }
      if (event.target.matches('.link-title-edit')) {
        const row = event.target.closest('[data-link-id]');
        const group = linkGroups.find((item) => item.id === groupSection.dataset.groupId);
        const link = findLink(group, row && row.dataset.linkId);
        const value = event.target.value.trim();
        if (link && value) link.title = value;
        persistLinks();
        renderLinkGroups();
      }
    });

    linkGroupsEl.addEventListener('keydown', async (event) => {
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      if (event.target.matches('[data-group-link-input]')) {
        if (event.key === 'Escape') {
          addingLinkGroupId = '';
          renderLinkGroups();
        } else if (event.key === 'Enter' && !event.isComposing && !event.repeat) {
          event.preventDefault();
          if (addLink(event.target.value, groupSection.dataset.groupId)) {
            addingLinkGroupId = '';
            renderLinkGroups();
          }
        }
        return;
      }
      if (event.target.matches('.group-name-input') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
      if (event.target.matches('.link-title-edit') && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });

    linkGroupsEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      const groupSection = event.target.closest('[data-group-id]');
      if (!groupSection) return;
      const groupId = groupSection.dataset.groupId;
      const group = linkGroups.find((item) => item.id === groupId);
      const row = event.target.closest('[data-link-id]');
      const link = findLink(group, row && row.dataset.linkId);
      if (event.shiftKey && link) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          allLinks().map((item) => item.id),
          [...linkSelection],
          link.id,
          linkSelectionAnchor,
          true
        );
        linkSelection = new Set(result.selected);
        linkSelectionAnchor = result.anchor;
        renderLinkGroups();
        return;
      }
      if (link) linkSelectionAnchor = link.id;
      if (!action) return;
      if (action.dataset.action === 'add-link-to-group') {
        addingLinkGroupId = groupId;
        group.collapsed = false;
        persistLinks();
        renderLinkGroups();
        requestAnimationFrame(() => linkGroupsEl.querySelector(
          `[data-group-id="${CSS.escape(groupId)}"] [data-group-link-input]`
        )?.focus());
      }
      if (action.dataset.action === 'cancel-group-link-add') {
        addingLinkGroupId = '';
        renderLinkGroups();
      }
      if (action.dataset.action === 'toggle-group') {
        group.collapsed = !group.collapsed;
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'delete-group') {
        (group.links || []).forEach((item) => linkSelection.delete(item.id));
        linkGroups = linkGroups.filter((item) => item.id !== groupId);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'open-link' && link && window.notchAPI) {
        window.notchAPI.openExternal(link.url);
      }
      if (action.dataset.action === 'delete-link' && link) {
        group.links = group.links.filter((item) => item.id !== link.id);
        linkSelection.delete(link.id);
        persistLinks();
        renderLinkGroups();
      }
      if (action.dataset.action === 'edit-link' && link && row) {
        const openButton = row.querySelector('.link-open');
        const input = document.createElement('input');
        input.className = 'link-title-edit';
        input.value = link.title;
        openButton.replaceWith(input);
        input.focus();
        input.select();
      }
    });

    // ============ 链接长按拖拽：组内排序 + 跨组搬运 ============
    // 不用 HTML5 拖拽有两个原因：一是行中间那一大块是 <button class="link-open">，
    // Chromium 里从 button 上按下不会触发祖先的 dragstart，标题区域整块拖不动；
    // 二是原生拖拽一按就走，没法和「点击打开链接」区分。改成指针事件 + 长按门槛。
    const LINK_DRAG_HOLD_MS = 340;
    const LINK_DRAG_MOVE_CANCEL = 8;
    let linkDrag = null;
    let suppressLinkClick = false;

    function clearLinkDropMarks() {
      linkGroupsEl.querySelectorAll('.drop-before, .drop-after, .drop-target').forEach((item) => {
        item.classList.remove('drop-before', 'drop-after', 'drop-target');
      });
    }

    function cancelLinkDrag() {
      if (!linkDrag) return;
      clearTimeout(linkDrag.holdTimer);
      if (linkDrag.active) {
        linkDrag.row.classList.remove('dragging');
        linkGroupsEl.classList.remove('link-dragging');
        clearLinkDropMarks();
      }
      try { linkDrag.row.releasePointerCapture(linkDrag.pointerId); } catch (error) {}
      linkDrag = null;
    }

    // 落点有两种：压在某一行上就按该行中线决定插到它前面还是后面；
    // 压在分组的空白或标题上就追加到该组末尾（index 为 null）。
    function updateLinkDropTarget(clientX, clientY) {
      clearLinkDropMarks();
      linkDrag.target = null;
      const under = document.elementFromPoint(clientX, clientY);
      if (!under || !linkGroupsEl.contains(under)) return;
      const overRow = under.closest('.link-item[data-link-id]');
      // 压在被拖那一行自己身上 = 放回原处，目标留空，松手什么都不做。
      // 少了这一步，长按后原地松手会落到「自己所在的分组」上，被当成追加到组末尾。
      if (overRow === linkDrag.row) return;
      if (overRow) {
        const rect = overRow.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        overRow.classList.add(after ? 'drop-after' : 'drop-before');
        const rows = Array.from(overRow.parentElement.children)
          .filter((item) => item.dataset && item.dataset.linkId);
        linkDrag.target = {
          groupId: overRow.dataset.groupId,
          index: rows.indexOf(overRow) + (after ? 1 : 0),
        };
        return;
      }
      const overGroup = under.closest('.link-group[data-group-id]');
      if (!overGroup) return;
      overGroup.classList.add('drop-target');
      linkDrag.target = { groupId: overGroup.dataset.groupId, index: null };
    }

    function linkOrderFingerprint() {
      return linkGroups
        .map((group) => `${group.id}:${(group.links || []).map((link) => link.id).join(',')}`)
        .join('|');
    }

    linkGroupsEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const row = event.target.closest('.link-item[data-link-id]');
      // 编辑 / 删除按钮和标题输入框保持原有点击语义，不参与拖拽。
      if (!row || event.target.closest('input, .link-actions')) return;
      // 上一次拖拽后若没有等到那个补发的 click（比如在列表外松手），标志会留着，
      // 否则它会把下一次正常点击吞掉，链接就打不开了。
      suppressLinkClick = false;
      cancelLinkDrag();
      linkDrag = {
        row,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        holdTimer: setTimeout(() => {
          if (!linkDrag) return;
          linkDrag.active = true;
          row.classList.add('dragging');
          linkGroupsEl.classList.add('link-dragging');
          try { row.setPointerCapture(linkDrag.pointerId); } catch (error) {}
          updateLinkDropTarget(linkDrag.startX, linkDrag.startY);
          setLinksStatus('拖到目标位置后松手');
        }, LINK_DRAG_HOLD_MS),
      };
    });

    // 这三个挂在 document 上（与窗口拖拽同一套写法）：长按还没满就快速划出列表时，
    // 挂在 linkGroupsEl 上收不到 move / up，计时器随后仍会启动一次拖拽。
    document.addEventListener('pointermove', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      if (!linkDrag.active) {
        // 长按还没满就移动，说明用户在滚动或只是手抖，放弃这次拖拽。
        const moved = Math.abs(event.clientX - linkDrag.startX) > LINK_DRAG_MOVE_CANCEL
          || Math.abs(event.clientY - linkDrag.startY) > LINK_DRAG_MOVE_CANCEL;
        if (moved) cancelLinkDrag();
        return;
      }
      event.preventDefault();
      updateLinkDropTarget(event.clientX, event.clientY);
    });

    document.addEventListener('pointerup', (event) => {
      if (!linkDrag || event.pointerId !== linkDrag.pointerId) return;
      const wasActive = linkDrag.active;
      const target = linkDrag.target;
      const linkId = linkDrag.row.dataset.linkId;
      cancelLinkDrag();
      if (!wasActive) return;
      // 拖拽结束后浏览器仍会补一个 click，必须拦掉，否则松手即打开链接。
      suppressLinkClick = true;
      if (!target) {
        setLinksStatus('');
        return;
      }
      const before = linkOrderFingerprint();
      linkGroups = Domain.moveLinkToPosition(linkGroups, linkId, target.groupId, target.index);
      if (linkOrderFingerprint() === before) {
        setLinksStatus('');
        return;
      }
      persistLinks();
      renderLinkGroups();
      setLinksStatus('链接顺序已更新');
    });

    document.addEventListener('pointercancel', () => cancelLinkDrag());

    linkGroupsEl.addEventListener('click', (event) => {
      if (!suppressLinkClick) return;
      suppressLinkClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }

  linkBulkDelete?.addEventListener('click', () => {
    if (!linkSelection.size) return;
    linkGroups = linkGroups.map((group) => ({
      ...group,
      links: (group.links || []).filter((link) => !linkSelection.has(link.id)),
    }));
    linkSelection.clear();
    linkSelectionAnchor = null;
    persistLinks();
    renderLinkGroups();
    setLinksStatus('已删除所选链接');
  });

  const transcriptionSettingsBackdrop = document.getElementById('transcription-settings-backdrop');
  const transcriptionSettingsClose = document.getElementById('transcription-settings-close');
  const transcriptionSettingsCancel = document.getElementById('transcription-settings-cancel');
  const transcriptionSettingsTest = document.getElementById('transcription-settings-test');
  const transcriptionSettingsSave = document.getElementById('transcription-settings-save');
  const llmApiKey = document.getElementById('llm-api-key');
  const llmApiStatus = document.getElementById('llm-api-status');
  const llmApiHelp = document.getElementById('llm-api-help');
  const llmBaseUrl = document.getElementById('llm-base-url');
  const llmModel = document.getElementById('llm-model');
  const llmModelFetch = document.getElementById('llm-model-fetch');
  const transcriptionSettingsNote = document.getElementById('transcription-settings-note');
  const settingsApiConfigure = document.getElementById('settings-api-configure');
  const settingsLlmStatus = document.getElementById('settings-llm-status');
  const settingsHomeModuleList = document.getElementById('settings-home-module-list');
  const settingsShortcutValue = document.getElementById('settings-shortcut-value');
  const settingsShortcutChange = document.getElementById('settings-shortcut-change');
  const settingsDefaultTab = document.getElementById('settings-default-tab');
  const settingsDefaultTabTrigger = document.getElementById('settings-default-tab-trigger');
  const settingsDefaultTabMenu = document.getElementById('settings-default-tab-menu');
  if (typeof initCustomSelect === 'function') {
    initCustomSelect(settingsDefaultTabTrigger, settingsDefaultTabMenu, settingsDefaultTab);
  }
  const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
  const settingsWorkspacePath = document.getElementById('settings-workspace-path');
  const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
  const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
  const settingsAutoLaunch = document.getElementById('settings-auto-launch');
  const settingsInlineNote = document.getElementById('settings-inline-note');

  // ========== NexusDesk 云同步设置 ==========
  const nexusdeskSyncEnabled = document.getElementById('nexusdesk-sync-enabled');
  const nexusdeskSyncStatus = document.getElementById('nexusdesk-sync-status');
  const nexusdeskConfigFields = document.getElementById('nexusdesk-config-fields');
  const nexusdeskUserId = document.getElementById('nexusdesk-user-id');
  const nexusdeskPassword = document.getElementById('nexusdesk-password');
  const nexusdeskSyncConnect = document.getElementById('nexusdesk-sync-connect');
  const nexusdeskSyncSave = document.getElementById('nexusdesk-sync-save');

  function refreshNexusdeskStatus() {
    if (!window.NexusDeskSync) return;
    const status = window.NexusDeskSync.getConnectionStatus();
    const labelMap = { connected: '已连接', connecting: '连接中…', disconnected: '未登录', closing: '断开中…' };
    const isLoggedIn = window.NexusDeskSync.isLoggedIn();
    nexusdeskSyncStatus.innerHTML = '<span class="nexusdesk-dot"></span>' + (isLoggedIn ? (labelMap[status] || status) : '未登录');
    nexusdeskSyncStatus.dataset.state = isLoggedIn ? status : 'disconnected';
    nexusdeskSyncConnect.textContent = isLoggedIn && status === 'connected' ? '断开' : '登录并连接';
  }

  function loadNexusdeskConfig() {
    if (!window.NexusDeskSync) return;
    const cfg = window.NexusDeskSync.getSyncConfig();
    nexusdeskSyncEnabled.checked = cfg.enabled === true;
    nexusdeskConfigFields.hidden = !cfg.enabled;
    nexusdeskUserId.value = cfg.employeeId || '';
    nexusdeskPassword.value = '';
    refreshNexusdeskStatus();
  }

  if (nexusdeskSyncEnabled) {
    loadNexusdeskConfig();
    if (window.NexusDeskSync) {
      window.NexusDeskSync.onStatusChange(refreshNexusdeskStatus);
    }

    nexusdeskSyncEnabled.addEventListener('change', () => {
      const enabled = nexusdeskSyncEnabled.checked;
      nexusdeskConfigFields.hidden = !enabled;
      if (window.NexusDeskSync) {
        window.NexusDeskSync.saveSyncConfig({ enabled });
        if (!enabled) {
          window.NexusDeskSync.disconnect();
        }
      }
      refreshNexusdeskStatus();
    });

    nexusdeskSyncConnect?.addEventListener('click', async () => {
      if (!window.NexusDeskSync) return;
      const status = window.NexusDeskSync.getConnectionStatus();
      if (status === 'connected') {
        window.NexusDeskSync.disconnect();
        refreshNexusdeskStatus();
        return;
      }
      const empId = nexusdeskUserId.value.trim();
      const pwd = nexusdeskPassword.value;
      if (!empId || !pwd) return;
      nexusdeskSyncConnect.textContent = '登录中…';
      try {
        await window.NexusDeskSync.login(empId, pwd);
        window.NexusDeskSync.saveSyncConfig({ enabled: true });
        nexusdeskSyncEnabled.checked = true;
        nexusdeskConfigFields.hidden = false;
        await window.NexusDeskSync.connect();
        nexusdeskPassword.value = '';
      } catch (e) {
        var msg = e.message || String(e);
        nexusdeskSyncStatus.innerHTML = '<span class="nexusdesk-dot"></span>';
        nexusdeskSyncStatus.appendChild(document.createTextNode('登录失败: ' + msg));
        alert('登录错误: ' + msg + '\n请把这个错误信息告诉我');
      }
      refreshNexusdeskStatus();
    });

    nexusdeskSyncSave?.addEventListener('click', () => {
      if (!window.NexusDeskSync) return;
      window.NexusDeskSync.logout();
      nexusdeskPassword.value = '';
      refreshNexusdeskStatus();
    });
  }

  let transcriptionConfig = {
    configured: false,
    asrNeedsReentry: false,
    region: 'beijing',
    workspaceId: '',
    llmConfigured: false,
    llmNeedsReentry: false,
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-v4-flash',
  };
  let settingsAppSettings = null;
  let settingsWorkspace = null;
  function updateTranscriptionConfigUi() {
    const configured = Boolean(transcriptionConfig.configured || transcriptionConfig.llmConfigured);
    if (llmApiStatus) {
      llmApiStatus.textContent = configured ? '已配置' : '未配置';
      llmApiStatus.dataset.state = configured ? 'saved' : 'empty';
    }
    if (llmBaseUrl) llmBaseUrl.value = transcriptionConfig.llmBaseUrl || 'https://api.deepseek.com';
    if (llmModel) {
      const savedModel = transcriptionConfig.llmModel || '';
      if (savedModel && ![...llmModel.options].some((o) => o.value === savedModel)) {
        const opt = document.createElement('option');
        opt.value = savedModel;
        opt.textContent = savedModel;
        llmModel.appendChild(opt);
      }
      llmModel.value = savedModel;
    }
    const settingsLlmModel = document.getElementById('settings-llm-model');
    if (settingsLlmModel) settingsLlmModel.textContent = transcriptionConfig.llmModel || '未设置';
  }

  function setSettingsNote(message, error = false) {
    if (!settingsInlineNote) return;
    settingsInlineNote.textContent = message || '';
    settingsInlineNote.classList.toggle('error', error);
  }

  function renderSettingsPanel() {
    const aiStatus = {
      ...transcriptionConfig,
      llmConfigured: transcriptionConfig.configured,
      llmNeedsReentry: transcriptionConfig.needsReentry,
    };
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: aiStatus,
    });
    if (settingsLlmStatus) {
      settingsLlmStatus.textContent = summary.llm.label;
      settingsLlmStatus.dataset.state = summary.llm.state;
    }
    if (settingsShortcutValue) settingsShortcutValue.textContent = summary.shortcut;
    if (settingsDefaultTab) {
      const visibleTabs = new Set(Domain.visiblePanelTabs(
        settingsAppSettings?.features
      ));
      Array.from(settingsDefaultTab.options).forEach((option) => {
        const visible = visibleTabs.has(option.value);
        option.hidden = !visible;
        option.disabled = !visible;
      });
settingsDefaultTab.value = visibleTabs.has(summary.defaultTab) ? summary.defaultTab : 'todo';
      if (settingsDefaultTabTrigger) {
        const selected = settingsDefaultTab.options[settingsDefaultTab.selectedIndex];
settingsDefaultTabTrigger.textContent = selected?.textContent || '待办';
      }
    }
    if (settingsWorkspaceKind) settingsWorkspaceKind.textContent = summary.workspaceLabel;
    if (settingsWorkspacePath) {
      settingsWorkspacePath.textContent = summary.workspacePath || '默认数据目录';
      settingsWorkspacePath.title = summary.workspacePath || '';
    }
    if (settingsAutoLaunch) settingsAutoLaunch.checked = summary.autoLaunch;
    renderHomeModuleSettings();
  }

  function renderHomeModuleSettings() {
    const state = window.NotchHome?.getVisibility?.();
    const hidden = new Set(state?.hiddenIds || []);
    settingsHomeModuleList?.querySelectorAll('input[data-settings-home-module]').forEach((input) => {
      const moduleId = input.dataset.settingsHomeModule;
      const unavailable = state?.unavailableIds?.includes(moduleId) === true;
      input.closest('label').hidden = unavailable;
      input.checked = !hidden.has(moduleId);
      input.disabled = unavailable || state?.readOnly === true
    });
    const status = document.getElementById('settings-home-module-status');
    if (status) {
      status.textContent = state?.readOnly
        ? '安全模式 · 暂不可修改'
        : state?.persisted === false
          ? '仅当前会话 · 未能保存'
          : '隐藏后自动填充 · 至少保留一个';
      status.dataset.state = state?.readOnly || state?.persisted === false ? 'warning' : 'saved';
    }
  }

  async function refreshSettingsPanel() {
    if (!window.notchAPI) return;
    const [appSettings, workspace, config] = await Promise.all([
      window.notchAPI.getAppSettings?.().catch(() => null),
      window.notchAPI.getWorkspace?.().catch(() => null),
      window.notchAPI.getAiConfig?.().catch(() => null),
    ]);
    if (appSettings) settingsAppSettings = appSettings;
    if (workspace) settingsWorkspace = workspace;
    if (config) {
      transcriptionConfig = { ...config, llmConfigured: config.configured, llmBaseUrl: config.baseUrl, llmModel: config.model };
      updateTranscriptionConfigUi();
    }
    renderSettingsPanel();
  }

  async function loadTranscriptionConfig() {
    if (!window.notchAPI || typeof window.notchAPI.getAiConfig !== 'function') return;
    try {
      const config = await window.notchAPI.getAiConfig();
      if (config) transcriptionConfig = { ...config, llmConfigured: config.configured, llmBaseUrl: config.baseUrl, llmModel: config.model };
    } catch (error) {}
    updateTranscriptionConfigUi();
    renderSettingsPanel();
  }

  function openTranscriptionSettings() {
    if (!transcriptionSettingsBackdrop) return;
    transcriptionSettingsBackdrop.hidden = false;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = transcriptionConfig.needsReentry
      ? '检测到已保存的密钥无法解密，请重新输入 API Key。'
      : transcriptionConfig.configured
        ? 'API Key 可留空；新输入的密钥会覆盖旧值。'
        : '请输入 Base URL 和 API Key；模型可自动获取，也可手动填写。';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    setTimeout(() => llmApiKey?.focus(), 0);
  }

  function closeTranscriptionSettings() {
    if (transcriptionSettingsBackdrop) transcriptionSettingsBackdrop.hidden = true;
  }

  async function saveTranscriptionSettings() {
    if (!window.notchAPI || !transcriptionSettingsSave) return;
    if (!transcriptionConfig.configured && !llmApiKey.value.trim()) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '请输入 API Key，或先通过环境变量配置。';
      return;
    }
    transcriptionSettingsSave.disabled = true;
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.textContent = '正在安全保存…';
    let result;
    try {
      result = await window.notchAPI.setAiConfig({
        apiKey: llmApiKey.value,
        baseUrl: llmBaseUrl.value,
        model: llmModel.value,
      });
    } catch (error) {
      result = { ok: false, error: 'save_failed' };
    }
    transcriptionSettingsSave.disabled = false;
    if (!result || !result.ok) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = result && result.error === 'invalid_url'
        ? 'Base URL 必须是有效的 HTTP / HTTPS 地址。'
        : result && result.error === 'invalid_model'
          ? '请输入模型名称。'
        : result && result.error === 'secure_storage_unavailable'
          ? '当前系统安全存储不可用，请改用 NOTCH_LLM_API_KEY 环境变量。'
          : '配置保存失败，请重试。';
      return;
    }
    transcriptionConfig = { ...result, llmConfigured: result.configured, llmBaseUrl: result.baseUrl, llmModel: result.model };
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.classList.add('success');
    transcriptionSettingsNote.textContent = result.modelAutoFetchFailed
      ? '已保存。模型列表暂时无法获取，首次使用时会自动获取模型。'
      : `已安全保存${result.model ? `，自动获取模型 ${result.model}` : ''}。为保护密钥，输入框不会回显明文；上方状态可确认是否已配置。`;
    transcriptionSettingsSave.textContent = '已保存';
    setTimeout(() => {
      if (transcriptionSettingsSave) transcriptionSettingsSave.textContent = '保存';
    }, 1200);
    renderSettingsPanel();
  }

  if (settingsApiConfigure) settingsApiConfigure.addEventListener('click', openTranscriptionSettings);
  if (transcriptionSettingsClose) transcriptionSettingsClose.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsCancel) transcriptionSettingsCancel.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsSave) transcriptionSettingsSave.addEventListener('click', saveTranscriptionSettings);
  transcriptionSettingsTest?.addEventListener('click', async () => {
    if (!window.notchAPI?.testAiConnection) return;
    transcriptionSettingsTest.disabled = true;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = '正在测试上游模型…';
    let testModel = llmModel?.value || '';
    if (!testModel && window.notchAPI?.listAiModels) {
      const discovered = await window.notchAPI.listAiModels({
        apiKey: llmApiKey?.value || undefined,
        baseUrl: llmBaseUrl?.value || '',
      }).catch(() => ({ ok: false }));
      if (discovered?.ok && discovered.recommended) {
        testModel = discovered.recommended;
        if (llmModel) {
          if (![...llmModel.options].some((o) => o.value === testModel)) {
            const opt = document.createElement('option');
            opt.value = testModel;
            opt.textContent = testModel;
            llmModel.appendChild(opt);
          }
          llmModel.value = testModel;
        }
      }
    }
    const result = await window.notchAPI.testAiConnection({
      apiKey: llmApiKey?.value || '',
      baseUrl: llmBaseUrl?.value || '',
      model: testModel,
    }).catch(() => ({ ok: false }));
    transcriptionSettingsTest.disabled = false;
    transcriptionSettingsNote.classList.toggle('success', result?.ok === true);
    transcriptionSettingsNote.classList.toggle('error', result?.ok !== true);
    transcriptionSettingsNote.textContent = result?.ok
      ? `连接成功：${testModel || result.model || transcriptionConfig.model || '模型已响应'}`
      : '连接失败，请检查 Base URL、API Key 和模型名称。';
  });
  llmModelFetch?.addEventListener('click', async () => {
    if (!window.notchAPI?.listAiModels) return;
    llmModelFetch.disabled = true;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = '正在从 Base URL 获取可用模型…';
    const result = await window.notchAPI.listAiModels({
      apiKey: llmApiKey?.value || undefined,
      baseUrl: llmBaseUrl?.value || '',
    }).catch(() => ({ ok: false }));
    llmModelFetch.disabled = false;
    if (result?.ok && result.models?.length) {
      if (llmModel) {
        llmModel.innerHTML = [
          '<option value="">请选择模型</option>',
          ...result.models.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`),
        ].join('');
        llmModel.value = '';
      }
      transcriptionSettingsNote.classList.add('success');
      transcriptionSettingsNote.textContent = `已获取 ${result.models.length} 个可用模型，请从下拉列表中选择。`;
    } else {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = result?.error === 'not_configured'
        ? '请先填写 API Key 再自动获取。'
        : '获取模型列表失败，请检查 Base URL 和 API Key 后重试。';
    }
  });
  if (llmApiHelp) {
    llmApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://platform.deepseek.com/api_keys');
    });
  }
  if (transcriptionSettingsBackdrop) {
    transcriptionSettingsBackdrop.addEventListener('click', (event) => {
      if (event.target === transcriptionSettingsBackdrop) closeTranscriptionSettings();
    });
  }
  if (window.notchAPI && typeof window.notchAPI.onOpenApiSettings === 'function') {
    window.notchAPI.onOpenApiSettings(async () => {
      if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
      openTranscriptionSettings();
    });
  }
  settingsHomeModuleList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-home-module]');
    if (!input || !window.NotchHome?.setModuleVisible) return;
    input.disabled = true;
    const result = await window.NotchHome.setModuleVisible(
      input.dataset.settingsHomeModule,
      input.checked
    );
    renderHomeModuleSettings();
    if (!result?.ok) {
      const message = result?.error === 'at_least_one_required'
        ? '首页至少保留一个组件'
          : result?.error === 'layout_read_only'
            ? '首页布局已进入安全模式，本次会话不能修改组件'
            : result?.error === 'layout_invalid'
              ? '新布局校验失败，原布局已保留'
              : result?.error === 'dom_apply_failed'
                ? '布局应用失败，原布局已恢复'
                : '首页组件设置未更新';
      if (typeof showStatusToast === 'function') showStatusToast(message);
      return;
    }
    if (result.changed === false) return;
    const message = result.persisted === false
      ? '布局已更新，仅当前会话生效，设置未能保存'
      : input.checked ? '首页组件已恢复' : '首页组件已隐藏';
    if (typeof showStatusToast === 'function') showStatusToast(message);
  });
  settingsShortcutChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('notch:record-shortcut'));
  });
  settingsDefaultTab?.addEventListener('change', async () => {
    if (!window.notchAPI?.setDefaultTab) return;
const previous = settingsAppSettings?.defaultTab || 'todo';
    settingsDefaultTab.disabled = true;
    const result = await window.notchAPI.setDefaultTab(settingsDefaultTab.value).catch(() => ({ ok: false }));
    settingsDefaultTab.disabled = false;
    if (!result?.ok) {
      settingsDefaultTab.value = previous;
      setSettingsNote('默认展开页保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(`下次唤出将默认显示${settingsDefaultTab.selectedOptions[0]?.textContent || '所选页面'}。`);
  });
  settingsWorkspaceOpen?.addEventListener('click', () => {
    window.notchAPI?.openWorkspace?.().catch(() => setSettingsNote('无法打开数据文件夹。', true));
  });
  settingsWorkspaceChoose?.addEventListener('click', async () => {
    const changed = await window.notchAPI?.chooseWorkspace?.().catch(() => false);
    if (!changed) return;
    settingsWorkspace = await window.notchAPI?.getWorkspace?.().catch(() => settingsWorkspace);
    renderSettingsPanel();
    setSettingsNote('数据文件夹已更新。');
  });
  settingsAutoLaunch?.addEventListener('change', async () => {
    if (!window.notchAPI?.setAutoLaunch) return;
    settingsAutoLaunch.disabled = true;
    const result = await window.notchAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
    settingsAutoLaunch.disabled = false;
    if (!result?.ok) {
      settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
      setSettingsNote('开机启动设置失败。', true);
      return;
    }
    settingsAutoLaunch.checked = result.autoLaunch === true;
    if (settingsAppSettings) settingsAppSettings.autoLaunch = result.autoLaunch === true;
    setSettingsNote(result.autoLaunch ? '已开启开机自动启动。' : '已关闭开机自动启动。');
  });
  // —— 自动更新（GitHub Release 检测 + Windows 下载安装）——
  const settingsUpdateVersion = document.getElementById('settings-update-version');
  const settingsUpdateCheck = document.getElementById('settings-update-check');
  const settingsUpdateDownload = document.getElementById('settings-update-download');
  const settingsUpdateInstall = document.getElementById('settings-update-install');
  const settingsUpdateProgress = document.getElementById('settings-update-progress');
  const settingsUpdateProgressBar = document.getElementById('settings-update-progress-bar');
  const settingsUpdateProgressText = document.getElementById('settings-update-progress-text');
  const settingsUpdateStatus = document.getElementById('settings-update-status');
  function setUpdateStatus(message, error) {
    if (!settingsUpdateStatus) return;
    settingsUpdateStatus.textContent = message || '';
    settingsUpdateStatus.classList.toggle('error', Boolean(error));
  }
  function formatUpdateBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return value.toFixed(value >= 100 ? 0 : 1) + ' ' + units[unit];
  }
  function renderUpdateState(state) {
    if (!state) return;
    if (settingsUpdateVersion) settingsUpdateVersion.textContent = 'v' + (state.current || '');
    const winAuto = state.mode === 'win-auto';
    const status = state.status;
    if (status === 'downloading') {
      const progress = state.progress || {};
      if (settingsUpdateProgress) {
        settingsUpdateProgress.hidden = false;
        if (settingsUpdateProgressBar) {
          settingsUpdateProgressBar.style.width = Math.min(100, progress.percent || 0) + '%';
        }
        if (settingsUpdateProgressText) {
          settingsUpdateProgressText.textContent = (progress.percent || 0) + '%'
            + '（' + formatUpdateBytes(progress.transferred) + ' / ' + formatUpdateBytes(progress.total) + '）';
        }
      }
      if (settingsUpdateCheck) settingsUpdateCheck.hidden = true;
      if (settingsUpdateDownload) settingsUpdateDownload.hidden = true;
      if (settingsUpdateInstall) settingsUpdateInstall.hidden = true;
      setUpdateStatus('');
      return;
    }
    if (status === 'checking') {
      setUpdateStatus('正在检查更新…' + (state.source ? '（' + state.source + '）' : ''));
      return;
    }
    if (settingsUpdateProgress) settingsUpdateProgress.hidden = true;
    if (settingsUpdateCheck) {
      settingsUpdateCheck.hidden = status === 'downloaded';
      settingsUpdateCheck.disabled = false;
    }
    if (settingsUpdateDownload) {
      settingsUpdateDownload.hidden = !(winAuto && status === 'available');
      settingsUpdateDownload.disabled = false;
    }
    if (settingsUpdateInstall) settingsUpdateInstall.hidden = !(winAuto && status === 'downloaded');
    if (status === 'downloaded') {
      setUpdateStatus('更新已下载，点击「重启安装」完成升级。');
    } else if (state.hasUpdate) {
      setUpdateStatus(winAuto ? '发现新版本 v' + state.latest + '，点击右侧「下载更新」。' : '发现新版本 v' + state.latest + '，点击右侧按钮下载。');
    } else if (status === 'not-available' || state.ok) {
      setUpdateStatus('已是最新版本。');
    } else {
      setUpdateStatus('检查更新失败（' + (state.error || '网络错误') + '），可稍后重试。', true);
    }
  }
  settingsUpdateCheck?.addEventListener('click', async () => {
    if (!window.notchAPI?.checkForUpdate) return;
    settingsUpdateCheck.disabled = true;
    setUpdateStatus('正在检查更新…');
    const state = await window.notchAPI.checkForUpdate().catch(() => null);
    settingsUpdateCheck.disabled = false;
    renderUpdateState(state);
    if (state?.hasUpdate && state?.mode !== 'win-auto') {
      window.notchAPI?.openUpdatePage?.(state.url);
    }
  });
  settingsUpdateDownload?.addEventListener('click', async () => {
    if (!window.notchAPI?.downloadUpdate) return;
    settingsUpdateDownload.disabled = true;
    const result = await window.notchAPI.downloadUpdate().catch(() => ({ ok: false, error: '下载失败' }));
    settingsUpdateDownload.disabled = false;
    if (result && result.ok !== true) {
      setUpdateStatus('下载失败（' + (result.error || '未知错误') + '）。', true);
    }
  });
  settingsUpdateInstall?.addEventListener('click', () => {
    window.notchAPI?.installUpdate?.();
  });
  window.notchAPI?.onUpdateState?.((state) => {
    renderUpdateState(state);
    if (typeof showStatusToast === 'function') {
      if (state?.status === 'downloaded') {
        showStatusToast('更新已下载，点击「重启安装」完成升级。', {
          actionLabel: '重启安装',
          onAction: () => window.notchAPI?.installUpdate?.(),
          duration: 10000,
        });
      } else if (state?.hasUpdate && state?.mode !== 'win-auto') {
        showStatusToast('发现新版本 v' + state.latest + '，可在设置中下载。', {
          actionLabel: '下载',
          onAction: () => window.notchAPI?.openUpdatePage?.(state.url),
          duration: 6000,
        });
      }
    }
  });
  window.notchAPI?.onAppSettingsChanged?.((settings) => {
    settingsAppSettings = settings;
    renderSettingsPanel();
  });
  window.notchAPI?.onWorkspaceChanged?.(() => refreshSettingsPanel());

  let windows = [];
  let hiddenWindows = new Set(loadJson(HIDDEN_WINDOWS_KEY, []).filter((item) => typeof item === 'string'));
  let windowsLoading = false;
  const windowsRefresh = document.getElementById('windows-refresh');
  const windowsHidden = document.getElementById('windows-hidden');
  const windowList = document.getElementById('window-list');
  let workspaceTab = document.querySelector('.tab.active')?.dataset.tab || 'home';
  let workspaceExpanded = document.getElementById('app')?.classList.contains('expanded') || false;
  let homeWindowsVisible = window.NotchHome?.isVisible?.('windows') !== false;
  let windowDrag = null;
  let suppressWindowClickUntil = 0;

  function windowHideKey(windowInfo) {
    return `${String(windowInfo.appName || '').trim()}\u0000${String(windowInfo.title || '').trim()}`;
  }

  function persistHiddenWindows() {
    saveJson(HIDDEN_WINDOWS_KEY, [...hiddenWindows]);
  }

  function clearWindowDragVisuals() {
    const drag = windowDrag;
    windowDrag = null;
    if (drag) {
      clearTimeout(drag.timer);
      try {
        if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId);
      } catch (error) {}
      drag.item.classList.remove('dragging', 'remove-ready');
      drag.item.style.removeProperty('--window-drag-x');
      drag.item.style.removeProperty('--window-drag-y');
    }
    document.querySelectorAll('.home-windows.drag-active').forEach((card) => {
      card.classList.remove('drag-active');
    });
    return drag;
  }

  function renderWindows(error = '') {
    if (!windowList) return;
    // 轮询可能在长按过程中重建列表；先清理捕获与卡片移除态，避免红色区域残留。
    clearWindowDragVisuals();
    windowList.replaceChildren();
    if (error) {
      const empty = document.createElement('div');
      empty.className = 'window-empty permission';
      // 两种权限的现象完全一样（列表空），但要开的开关不同，必须分开说：
      // 「屏幕录制」决定能不能读到窗口标题，「辅助功能」决定能不能枚举和聚焦窗口。
      // 缺屏幕录制时系统既不报错也不弹提示，所以只能由这里告诉用户。
      const screenRecording = error === 'screen_recording_permission_required';
      const title = screenRecording ? '需要“屏幕录制”权限' : '需要“辅助功能”权限';
      const pane = screenRecording ? '屏幕录制与系统录音' : '辅助功能';
      const heading = document.createElement('strong');
      heading.textContent = title;
      const hint = document.createElement('span');
      hint.textContent = `系统设置 → 隐私与安全性 → ${pane}，允许 TO-DO Panel 后重试。`;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'window-permission-open';
      action.textContent = '打开系统设置';
      action.addEventListener('click', () => {
        if (window.notchAPI && typeof window.notchAPI.openPrivacySettings === 'function') {
          window.notchAPI.openPrivacySettings(screenRecording ? 'screen-recording' : 'accessibility');
        }
      });
      empty.append(heading, hint, action);
      windowList.appendChild(empty);
      return;
    }
    const visibleWindows = Domain.numberWindowLabels(
      windows.filter((item) => !hiddenWindows.has(windowHideKey(item)))
    );
    if (windowsHidden) {
      windowsHidden.hidden = hiddenWindows.size === 0;
      windowsHidden.textContent = '隐藏';
      windowsHidden.setAttribute('aria-label', `恢复已隐藏的 ${hiddenWindows.size} 个窗口`);
    }
    if (!visibleWindows.length) {
      const empty = document.createElement('div');
      empty.className = 'window-empty';
      empty.textContent = windowsLoading
        ? '正在读取当前窗口…'
        : hiddenWindows.size
          ? '窗口均已隐藏 · 点击上方恢复'
          : '没有读取到可切换窗口';
      windowList.appendChild(empty);
      return;
    }
    visibleWindows.slice(0, 15).forEach((windowInfo) => {
      const button = document.createElement('button');
      button.className = 'window-item';
      button.type = 'button';
      button.dataset.id = windowInfo.id;
      button.title = `${windowInfo.displayName}\n${windowInfo.title}\n长按后拖出卡片可隐藏`;
      const mark = document.createElement('span');
      mark.className = 'window-app-mark';
      if (windowInfo.icon) {
        const icon = document.createElement('img');
        icon.src = windowInfo.icon;
        icon.alt = '';
        icon.draggable = false;
        mark.appendChild(icon);
      } else {
        mark.textContent = (windowInfo.appName.charAt(0) || '·').toUpperCase();
      }
      const appName = document.createElement('strong');
      appName.textContent = windowInfo.displayName;
      button.append(mark, appName);
      windowList.appendChild(button);
    });
  }

  async function refreshWindows(force = false) {
    if (!window.NotchHome?.isVisible?.('windows')) return;
    if (windowsLoading || !window.notchAPI || (!force && (!workspaceExpanded || workspaceTab !== 'home'))) return;
    windowsLoading = true;
    renderWindows();
    let result;
    try {
      result = await window.notchAPI.listWindows();
    } catch (error) {
      result = { items: [], error: 'accessibility_permission_required' };
    }
    windowsLoading = false;
    windows = result && Array.isArray(result.items) ? result.items : [];
    renderWindows(result && result.error);
  }

  if (windowsRefresh) windowsRefresh.addEventListener('click', () => refreshWindows(true));
  if (windowsHidden) {
    windowsHidden.addEventListener('click', () => {
      hiddenWindows.clear();
      persistHiddenWindows();
      renderWindows();
    });
  }
  if (windowList) {
    windowList.addEventListener('click', (event) => {
      if (Date.now() < suppressWindowClickUntil) return;
      const item = event.target.closest('.window-item[data-id]');
      if (item && window.notchAPI) window.notchAPI.focusWindow(item.dataset.id);
    });
    windowList.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || windowDrag) return;
      const item = event.target.closest('.window-item[data-id]');
      if (!item) return;
      windowDrag = {
        item,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        removeReady: false,
        timer: setTimeout(() => {
          if (!windowDrag || windowDrag.item !== item) return;
          windowDrag.active = true;
          item.classList.add('dragging');
          try { item.setPointerCapture(event.pointerId); } catch (error) {}
          item.closest('.home-windows')?.classList.add('drag-active');
        }, 460),
      };
    });
    document.addEventListener('pointermove', (event) => {
      if (!windowDrag || windowDrag.pointerId !== event.pointerId) return;
      const dx = event.clientX - windowDrag.startX;
      const dy = event.clientY - windowDrag.startY;
      if (!windowDrag.active) {
        if (Math.hypot(dx, dy) > 8) {
          clearTimeout(windowDrag.timer);
          windowDrag = null;
        }
        return;
      }
      event.preventDefault();
      windowDrag.item.style.setProperty('--window-drag-x', `${dx}px`);
      windowDrag.item.style.setProperty('--window-drag-y', `${dy}px`);
      const bounds = windowList.closest('.home-windows').getBoundingClientRect();
      windowDrag.removeReady = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      windowDrag.item.classList.toggle('remove-ready', windowDrag.removeReady);
    });
    const finishWindowDrag = (event) => {
      if (!windowDrag || (event.pointerId != null && windowDrag.pointerId !== event.pointerId)) return;
      const drag = clearWindowDragVisuals();
      if (!drag) return;
      if (!drag.active) return;
      suppressWindowClickUntil = Date.now() + 450;
      if (drag.removeReady) {
        const windowInfo = windows.find((item) => item.id === drag.item.dataset.id);
        if (windowInfo) {
          hiddenWindows.add(windowHideKey(windowInfo));
          persistHiddenWindows();
          renderWindows();
        }
      }
    };
    document.addEventListener('pointerup', finishWindowDrag);
    document.addEventListener('pointercancel', finishWindowDrag);
    windowList.addEventListener('lostpointercapture', () => clearWindowDragVisuals(), true);
    window.addEventListener('blur', clearWindowDragVisuals);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearWindowDragVisuals();
    });
  }

  document.addEventListener('notch:tabchange', (event) => {
    clearWindowDragVisuals();
    workspaceTab = event.detail && event.detail.tab || 'home';
    if (workspaceTab === 'home') refreshWindows();
    if (workspaceTab === 'settings') refreshSettingsPanel();
  });
  document.addEventListener('notch:modechange', (event) => {
    clearWindowDragVisuals();
    workspaceExpanded = !!(event.detail && event.detail.expanded);
    if (workspaceExpanded && workspaceTab === 'home') refreshWindows();
  });
  document.addEventListener('notch:home-modules-changed', (event) => {
    const nextVisible = Array.isArray(event.detail?.visibleIds)
      ? event.detail.visibleIds.includes('windows')
      : window.NotchHome?.isVisible?.('windows') !== false;
    const restored = !homeWindowsVisible && nextVisible;
    homeWindowsVisible = nextVisible;
    renderHomeModuleSettings();
    if (restored && workspaceExpanded && workspaceTab === 'home') refreshWindows(true);
  });

  // ============ 本地汽水音乐 ============
  const homeMusic = document.getElementById('home-music');
  const musicArtwork = document.getElementById('music-artwork');
  const musicTitle = document.getElementById('music-title');
  const musicStatus = document.getElementById('music-status');
  const musicPlayToggle = document.getElementById('music-play-toggle');
  let musicPlaying = false;

  function renderMusicPlaybackState() {
    if (!homeMusic || !musicPlayToggle) return;
    homeMusic.classList.toggle('music-playing', musicPlaying);
    musicPlayToggle.dataset.musicAction = musicPlaying ? 'pause' : 'play';
    musicPlayToggle.setAttribute('aria-label', musicPlaying ? '暂停' : '播放');
    musicPlayToggle.innerHTML = musicPlaying
      ? '<svg viewBox="0 0 24 24"><path d="M8 7h3v10H8zM14 7h3v10h-3z" /></svg>'
      : '<svg viewBox="0 0 24 24"><path d="m9 7 8 5-8 5z" /></svg>';
  }

  async function refreshMusicStatus() {
    if (!homeMusic || !window.notchAPI || typeof window.notchAPI.getMusicStatus !== 'function') return;
    let status;
    try { status = await window.notchAPI.getMusicStatus(); } catch (error) { status = null; }
    homeMusic.classList.toggle('music-running', Boolean(status && status.running));
    if (status && typeof status.playing === 'boolean') {
      musicPlaying = status.playing;
      renderMusicPlaybackState();
    }
    if (status && status.icon && musicArtwork) {
      musicArtwork.replaceChildren();
      const image = document.createElement('img');
      image.src = status.icon;
      image.alt = '';
      musicArtwork.appendChild(image);
    }
    if (musicTitle) musicTitle.textContent = status && status.installed ? '汽水音乐' : '未安装汽水音乐';
    if (musicStatus) musicStatus.textContent = status && status.running ? (musicPlaying ? '正在播放' : '已连接') : status && status.installed ? '轻触即播' : '需要本地客户端';
  }

  homeMusic?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-widget-size-cycle]') || !window.notchAPI) return;
    const control = event.target.closest('[data-music-action]') || musicPlayToggle;
    if (!control) return;
    event.stopPropagation();
    control.disabled = true;
    const action = control.dataset.musicAction;
    let result;
    try { result = await window.notchAPI.controlMusic(action); } catch (error) { result = { ok: false }; }
    control.disabled = false;
    if (!result || !result.ok) {
      const needsSession = result && ['no_active_session', 'soda_session_inactive'].includes(result.error);
      const needsPermission = result && result.error === 'accessibility_permission_required';
      if (musicStatus) musicStatus.textContent = result && result.error === 'not_installed'
        ? '需要本地客户端'
        : needsPermission ? '需要辅助功能权限'
          : needsSession ? '请先点播放' : '控制暂不可用';
      if (typeof showStatusToast === 'function') {
        showStatusToast(result && result.error === 'not_installed'
          ? '未安装汽水音乐'
          : needsPermission ? '请在系统设置中允许 TO-DO Panel 使用辅助功能'
            : needsSession ? '请先点击播放，再使用切歌控制' : '汽水音乐控制暂不可用');
      }
    } else {
      if (typeof result.playing === 'boolean') musicPlaying = result.playing;
      else if (action === 'play') musicPlaying = true;
      else if (action === 'pause') musicPlaying = false;
      renderMusicPlaybackState();
      if (musicStatus) musicStatus.textContent = action === 'next' ? '下一首' : action === 'previous' ? '上一首' : musicPlaying ? '正在播放' : '已暂停';
    }
    setTimeout(refreshMusicStatus, 500);
  });

  renderMusicPlaybackState();

  // ============ 本机加密密钥库 ============
  const credentialService = document.getElementById('credential-service');
  const credentialAccount = document.getElementById('credential-account');
  const credentialPassword = document.getElementById('credential-password');
  const credentialSave = document.getElementById('credential-save');
  const credentialList = document.getElementById('credential-list');
  const credentialCount = document.getElementById('credential-count');
  const credentialSearch = document.getElementById('credential-search');
  const credentialBulkDelete = document.getElementById('credential-bulk-delete');
  const credentialsNote = document.getElementById('credentials-note');
  let credentials = [];
  let credentialSelection = new Set();
  let credentialAnchor = null;
  let editingCredentialId = '';
  let editingCredential = null;

  function updateCredentialBulkAction() {
    if (!credentialBulkDelete) return;
    credentialBulkDelete.hidden = credentialSelection.size === 0;
    credentialBulkDelete.textContent = '删除';
    credentialBulkDelete.setAttribute('aria-label', credentialSelection.size
      ? `删除 ${credentialSelection.size} 项`
      : '删除所选');
  }

  function animateCredentialExpansion(originRect) {
    const row = credentialList?.querySelector(`.credential-item.editing[data-id="${CSS.escape(editingCredentialId)}"]`);
    if (!row || !originRect || typeof row.animate !== 'function') return;
    requestAnimationFrame(() => {
      const targetRect = row.getBoundingClientRect();
      const scaleX = Math.max(0.2, originRect.width / Math.max(1, targetRect.width));
      const scaleY = Math.max(0.2, originRect.height / Math.max(1, targetRect.height));
      row.animate([
        {
          opacity: .72,
          transform: `translate(${originRect.left - targetRect.left}px, ${originRect.top - targetRect.top}px) scale(${scaleX}, ${scaleY})`,
          transformOrigin: 'top left',
        },
        { opacity: 1, transform: 'translate(0, 0) scale(1)', transformOrigin: 'top left' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'both' });
    });
  }

  function renderCredentials() {
    const visibleCredentials = Domain.filterCredentials(credentials, credentialSearch?.value || '');
    if (credentialCount) credentialCount.textContent = credentialSearch?.value.trim()
      ? `${visibleCredentials.length} / ${credentials.length} 项`
      : `${credentials.length} 项`;
    if (!credentialList) return;
    credentialList.replaceChildren();
    if (!visibleCredentials.length) {
      const empty = document.createElement('div');
      empty.className = 'credential-empty';
      empty.innerHTML = credentials.length
        ? '<strong>没有匹配的密钥</strong><span>可按名称或账号继续检索</span>'
        : '<strong>还没有保存密钥</strong><span>账号与密码会加密保存在本机</span>';
      credentialList.appendChild(empty);
      updateCredentialBulkAction();
      return;
    }
    visibleCredentials.forEach((credential) => {
      if (editingCredentialId === credential.id && editingCredential) {
        const form = document.createElement('form');
        form.className = 'credential-item editing';
        form.dataset.id = credential.id;
        form.innerHTML = `
          <div class="credential-edit-head"><strong>修改密钥</strong><span>回车保存</span></div>
          <label><span>服务</span><input name="service" maxlength="80" autocomplete="off" /></label>
          <label><span>账号</span><input name="account" maxlength="320" autocomplete="off" /></label>
          <label><span>密码</span><input name="password" type="text" maxlength="4096" autocomplete="off" spellcheck="false" /></label>
          <div class="credential-edit-actions"><button type="button" data-credential-cancel>取消</button><button type="submit">保存</button></div>
        `;
        form.elements.service.value = editingCredential.service || '';
        form.elements.account.value = editingCredential.account || '';
        form.elements.password.value = editingCredential.password || '';
        credentialList.appendChild(form);
        return;
      }
      const row = document.createElement('article');
      row.className = `credential-item${credentialSelection.has(credential.id) ? ' multi-selected' : ''}`;
      row.dataset.id = credential.id;
      row.tabIndex = 0;
      const copy = document.createElement('div');
      copy.className = 'credential-copy';
      const service = document.createElement('strong');
      service.textContent = credential.service;
      const account = document.createElement('span');
      account.textContent = credential.account;
      const password = document.createElement('code');
      password.textContent = credential.passwordMask || '**********';
      copy.append(service, account, password);
      const actions = document.createElement('div');
      actions.className = 'credential-actions';
      const accountCopy = document.createElement('button');
      accountCopy.type = 'button';
      accountCopy.dataset.credentialCopy = 'account';
      accountCopy.textContent = '账号';
      accountCopy.setAttribute('aria-label', '复制账号');
      const passwordCopy = document.createElement('button');
      passwordCopy.type = 'button';
      passwordCopy.dataset.credentialCopy = 'password';
      passwordCopy.textContent = '密码';
      passwordCopy.setAttribute('aria-label', '复制密码');
      const deleteAction = Domain.credentialRowAction({ requestedAction: 'delete' });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.credentialDelete = 'true';
      remove.textContent = deleteAction.label;
      remove.setAttribute('aria-label', deleteAction.ariaLabel);
      actions.append(accountCopy, passwordCopy, remove);
      row.append(copy, actions);
      credentialList.appendChild(row);
    });
    updateCredentialBulkAction();
  }

  async function loadCredentials() {
    if (!window.notchAPI || typeof window.notchAPI.listCredentials !== 'function') return;
    let result;
    try { result = await window.notchAPI.listCredentials(); } catch (error) { result = null; }
    credentials = result && Array.isArray(result.items) ? result.items : [];
    if (credentialsNote && result && !result.secureStorage) {
      credentialsNote.textContent = '当前系统安全存储不可用，暂时无法保存密码。';
      credentialsNote.classList.add('error');
    }
    renderCredentials();
  }

  async function saveCredential() {
    if (!credentialSave || !window.notchAPI) return;
    const payload = {
      service: credentialService?.value || '',
      account: credentialAccount?.value || '',
      password: credentialPassword?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim() || !payload.password) {
      if (credentialsNote) {
        credentialsNote.textContent = '请完整填写软件、账号和密码。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    credentialSave.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    credentialSave.disabled = false;
    if (!result || !result.ok) {
      if (credentialsNote) {
        credentialsNote.textContent = '加密保存失败，请确认系统钥匙串可用。';
        credentialsNote.classList.add('error');
      }
      return;
    }
    if (credentialService) credentialService.value = '';
    if (credentialAccount) credentialAccount.value = '';
    if (credentialPassword) {
      credentialPassword.value = '';
      credentialPassword.placeholder = '保存后才会加密';
    }
    if (credentialsNote) {
      credentialsNote.textContent = '已使用系统安全存储加密保存。';
      credentialsNote.classList.remove('error');
    }
    await loadCredentials();
    credentialService?.focus();
  }

  credentialSave?.addEventListener('click', saveCredential);
  credentialSearch?.addEventListener('input', renderCredentials);
  [credentialService, credentialAccount, credentialPassword].forEach((input) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        saveCredential();
      }
    });
  });
  credentialList?.addEventListener('click', async (event) => {
    const row = event.target.closest('.credential-item[data-id]');
    if (!row) return;
    if (event.target.closest('[data-credential-cancel]')) {
      editingCredentialId = '';
      editingCredential = null;
      renderCredentials();
      return;
    }
    if (row.classList.contains('editing')) return;
    const copyField = event.target.closest('[data-credential-copy]')?.dataset.credentialCopy;
    const action = Domain.credentialRowAction({
      requestedAction: event.target.closest('[data-credential-delete]') ? 'delete' : '',
      copyField,
      rowBody: Boolean(event.target.closest('.credential-copy')),
      shiftKey: event.shiftKey,
      selected: credentialSelection.has(row.dataset.id),
    });
    if (action.type === 'delete') {
      const deleteButton = event.target.closest('[data-credential-delete]');
      if (deleteButton) deleteButton.disabled = true;
      const result = await window.notchAPI.deleteCredentials([row.dataset.id]).catch(() => ({ ok: false }));
      if (!result?.ok) {
        if (deleteButton) deleteButton.disabled = false;
        if (credentialsNote) {
          credentialsNote.textContent = '删除失败，请稍后重试。';
          credentialsNote.classList.add('error');
        }
        return;
      }
      credentialSelection.delete(row.dataset.id);
      if (editingCredentialId === row.dataset.id) {
        editingCredentialId = '';
        editingCredential = null;
      }
      await loadCredentials();
      if (credentialsNote) {
        credentialsNote.textContent = '密钥已删除。';
        credentialsNote.classList.remove('error');
      }
      return;
    }
    if (action.type === 'copy') {
      const copied = await window.notchAPI.copyCredential(row.dataset.id, action.field).catch(() => false);
      if (credentialsNote) credentialsNote.textContent = copied ? `${copyField === 'password' ? '密码' : '账号'}已复制` : '复制失败';
      return;
    }
    if (action.type === 'edit') {
      const originRect = row.getBoundingClientRect();
      const result = await window.notchAPI.getCredential(row.dataset.id).catch(() => ({ ok: false }));
      if (!result || !result.ok || !result.item) return;
      editingCredentialId = result.item.id;
      editingCredential = result.item;
      renderCredentials();
      animateCredentialExpansion(originRect);
      if (credentialsNote) {
        credentialsNote.textContent = '已展开当前密钥，回车即可保存。';
        credentialsNote.classList.remove('error');
      }
      credentialList.querySelector('.credential-item.editing input[name="service"]')?.focus();
      return;
    }
    const result = window.NotchDomain.updateRangeSelection(
      Domain.filterCredentials(credentials, credentialSearch?.value || '').map((item) => item.id),
      [...credentialSelection],
      row.dataset.id,
      credentialAnchor,
      event.shiftKey,
      true
    );
    credentialSelection = new Set(result.selected);
    credentialAnchor = result.anchor;
    renderCredentials();
  });
  credentialList?.addEventListener('submit', async (event) => {
    const form = event.target.closest('.credential-item.editing[data-id]');
    if (!form) return;
    event.preventDefault();
    if (!editingCredentialId || !window.notchAPI) return;
    const payload = {
      id: editingCredentialId,
      service: form.elements.service?.value || '',
      account: form.elements.account?.value || '',
      password: form.elements.password?.value || '',
    };
    if (!payload.service.trim() || !payload.account.trim()) return;
    const saveButton = form.querySelector('button[type="submit"]');
    if (saveButton) saveButton.disabled = true;
    const result = await window.notchAPI.saveCredential(payload).catch(() => ({ ok: false }));
    if (saveButton) saveButton.disabled = false;
    if (!result?.ok) return;
    editingCredentialId = '';
    editingCredential = null;
    await loadCredentials();
  });
  credentialBulkDelete?.addEventListener('click', async () => {
    if (!credentialSelection.size || !window.notchAPI) return;
    const result = await window.notchAPI.deleteCredentials([...credentialSelection]).catch(() => ({ ok: false }));
    if (!result || !result.ok) return;
    credentialSelection.clear();
    credentialAnchor = null;
    await loadCredentials();
  });

  document.addEventListener('notch:clear-selection', () => {
    commandSelection.clear();
    commandSelectionAnchor = null;
    linkSelection.clear();
    linkSelectionAnchor = null;
    credentialSelection.clear();
    credentialAnchor = null;
    renderCommands();
    renderLinkGroups();
    renderCredentials();
  });

  setInterval(() => refreshWindows(), 6000);


  renderCommands();
  renderLinkGroups();
  renderWindows();
  loadTranscriptionConfig();
  refreshSettingsPanel();
  refreshMusicStatus();
  loadCredentials();

})();
