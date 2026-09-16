const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const isolatedUserData = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'to-do-panel-electron-test-'));
app.setPath('userData', isolatedUserData);
function diagnostic(message) {
  console.log(message);
  if (process.env.TODO_TEST_LOG) fs.appendFileSync(process.env.TODO_TEST_LOG, `${message}\n`);
}
process.on('uncaughtException', (error) => { diagnostic(error.stack); app.exit(1); });
// Windows keeps Chromium's files locked until process exit. The parent test runner
// cleans up the isolated profile after the child has exited, never in will-quit.

async function main() {
  diagnostic('Renderer test: waiting for Electron');
  await app.whenReady();
  diagnostic('Renderer test: Electron ready');
  const window = new BrowserWindow({
    width: 200,
    height: 19,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // 与生产主窗口一致，避免 macOS 将重复运行的测试窗口判为遮挡后暂停 rAF。
      backgroundThrottling: false,
    },
  });

  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    diagnostic('Renderer test: page loaded');
    const freshProfileClipboardState = await window.webContents.executeJavaScript(`
      (() => ({
        history: localStorage.getItem('notch-clip-history'),
        favorites: localStorage.getItem('notch-clip-favorites'),
        imageRows: document.querySelectorAll('#clip-list [data-type="image"]').length,
      }))()
    `);
    assert.deepEqual(freshProfileClipboardState, {
      history: null,
      favorites: null,
      imageRows: 0,
    }, '全新用户目录不得预置任何剪贴板文本、收藏或图片记录');

    await window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    window.show();
    window.focus();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    const focusStyle = await window.webContents.executeJavaScript(`
      (async () => {
        const notch = document.getElementById('notch');
        const deadline = performance.now() + 5000;
        let result;
        do {
          const notchStyle = getComputedStyle(notch);
          const dotStyle = getComputedStyle(notch.querySelector('.notch-dot'));
          result = {
            active: document.activeElement === notch,
            focusVisible: notch.matches(':focus-visible'),
            outlineStyle: notchStyle.outlineStyle,
            outlineWidth: notchStyle.outlineWidth,
            dotBoxShadow: dotStyle.boxShadow,
          };
          if (result.active && result.focusVisible) return result;
          await new Promise((resolve) => setTimeout(resolve, 20));
        } while (performance.now() < deadline);
        return result;
      })()
    `);

    assert.equal(focusStyle.active, true, '折叠条应能通过键盘获得焦点');
    assert.equal(focusStyle.focusVisible, true, '键盘焦点应保持可见提示');
    assert.equal(
      focusStyle.outlineStyle,
      'none',
      `折叠外壳不能画焦点描边，当前为 ${focusStyle.outlineWidth} ${focusStyle.outlineStyle}`
    );
    assert.notEqual(focusStyle.dotBoxShadow, 'none', '焦点提示应转移到中间抓握条');

    const collapsedPanelLayers = await window.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('.panel');
        return {
          contentClipPath: getComputedStyle(panel).clipPath,
          shellClipPath: getComputedStyle(panel, '::before').clipPath,
        };
      })()
    `);
    assert.equal(
      collapsedPanelLayers.contentClipPath,
      'none',
      '折叠动效不得裁剪承载全部组件的内容层'
    );
    assert.notEqual(
      collapsedPanelLayers.shellClipPath,
      'none',
      '折叠轮廓应由独立背景外壳承担'
    );

    window.setSize(1240, 616);
    const topbarBlankToggle = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        // 生产默认开启超过四个 Tab，会进入左右分栏并让容器横跨整条顶栏。
        document.getElementById('tabs').classList.add('is-split');
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        const centerX = topbar.left + topbar.width / 2;
        const centerY = topbar.top + topbar.height / 2;
        const centerHit = document.elementFromPoint(centerX, centerY);
        const interceptedByTabs = Boolean(centerHit?.closest('.tabs'));
        // AI 周报胶囊驻留顶栏正中，属于交互区；真正的空白处必须仍可收起。
        const isInteractive = (el) =>
          Boolean(el?.closest('.tabs, .todo-weekly-card, button, input, .topbar-mid, .topbar-actions'));
        let blankHit = null;
        for (let dx = 48; dx < topbar.width - 48 && !blankHit; dx += 10) {
          const el = document.elementFromPoint(topbar.left + dx, centerY);
          if (el && !isInteractive(el)) blankHit = { el, x: topbar.left + dx, y: centerY };
        }
        blankHit?.el.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: blankHit.x,
          clientY: blankHit.y,
        }));
        const collapsed = await waitForClass('collapsed');
        return {
          opened,
          collapsed,
          interceptedByTabs,
          centerHit: centerHit?.id || centerHit?.className || centerHit?.tagName || '',
          blankFound: Boolean(blankHit),
          blankHit: blankHit?.el?.className || blankHit?.el?.tagName || '',
          appClass: document.getElementById('app').className,
          panelAriaHidden: document.querySelector('.panel').getAttribute('aria-hidden'),
        };
      })()
    `);
    assert.equal(topbarBlankToggle.opened, true, '折叠岛点击后必须展开');
    assert.equal(
      topbarBlankToggle.interceptedByTabs,
      false,
      `顶部中央不得被 Tab 容器截获，当前命中 ${topbarBlankToggle.centerHit}`
    );
    assert.equal(topbarBlankToggle.blankFound, true, '顶栏必须存在可点击的空白收起区');
    assert.equal(
      topbarBlankToggle.collapsed,
      true,
      `展开后点击顶栏空白必须收起；最终状态 ${topbarBlankToggle.appClass} / aria-hidden=${topbarBlankToggle.panelAriaHidden}`
    );

    const topbarTabAndSpaceToggle = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        const todoButton = document.getElementById('tab-button-todo');
        const rect = todoButton.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        hitTarget?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(30);
        const todoActivated = document.getElementById('tab-todo').classList.contains('active');
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        }));
        const collapsedBySpace = await waitForClass('collapsed');
        return {
          opened,
          todoActivated,
          tabHit: Boolean(hitTarget?.closest('#tab-button-todo')),
          collapsedBySpace,
        };
      })()
    `);
    assert.equal(topbarTabAndSpaceToggle.opened, true);
    assert.equal(topbarTabAndSpaceToggle.tabHit, true, '空白穿透不得破坏真实 Tab 的点击命中');
    assert.equal(topbarTabAndSpaceToggle.todoActivated, true, '真实 Tab 点击必须继续切换页面');
    assert.equal(topbarTabAndSpaceToggle.collapsedBySpace, true, '展开后 Space 必须继续收起');

    window.setSize(1240, 616);
    const settingsSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('collapsed', 'closing', 'opening');
        appSurface.classList.add('expanded');
        document.getElementById('tab-button-settings').click();
        setTimeout(() => {
          const page = document.getElementById('settings-page');
          const panel = document.querySelector('.panel');
          const expandedOutlineRule = (() => {
            const walk = (list) => {
              for (const rule of list) {
                if (rule.selectorText === '#app.expanded .panel::before') {
                  return rule.style.clipPath;
                }
                if (rule.cssRules) {
                  const found = walk(rule.cssRules);
                  if (found !== undefined) return found;
                }
              }
              return undefined;
            };
            for (const sheet of document.styleSheets) {
              let rules;
              try { rules = sheet.cssRules; } catch (e) { continue; }
              const found = walk(rules);
              if (found !== undefined) return found;
            }
            return '';
          })();
          resolve({
            contentClipPath: getComputedStyle(panel).clipPath,
            shellOwnsExpandedOutline: Boolean(expandedOutlineRule) && !expandedOutlineRule.includes('calc'),
            rightmostTab: document.querySelector('.tab[data-tab]:last-of-type')?.dataset.tab,
            activePanel: document.getElementById('tab-settings')?.classList.contains('active'),
            display: getComputedStyle(page).display,
            columns: getComputedStyle(page).gridTemplateColumns.split(' ').filter(Boolean).length,
            api: Boolean(document.getElementById('settings-api-configure')),
            mirror: false,
            features: document.querySelectorAll('[data-settings-feature]').length,
            homeModules: 0,
            shortcut: Boolean(document.getElementById('settings-shortcut-change')),
            defaultTab: {
              exists: Boolean(document.getElementById('settings-default-tab')),
              value: document.getElementById('settings-default-tab')?.value,
              options: document.getElementById('settings-default-tab')?.options.length,
            },
            workspace: Boolean(document.getElementById('settings-workspace-choose')),
            autoLaunch: Boolean(document.getElementById('settings-auto-launch')),
            update: Boolean(document.getElementById('settings-update-check')),
            updateVersion: Boolean(document.getElementById('settings-update-version')),
          });
        }, 80);
      })
    `);

    assert.deepEqual(settingsSurface, {
      contentClipPath: 'none',
      shellOwnsExpandedOutline: true,
      rightmostTab: 'settings',
      activePanel: true,
      display: 'grid',
      columns: 2,
      api: true,
      mirror: false,
      features: 0,
      homeModules: 0,
      shortcut: true,
      defaultTab: { exists: true, value: 'todo', options: 6 },
      workspace: true,
      autoLaunch: true,
      update: true,
      updateVersion: true,
    });

    const defaultTabOpening = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        const features = {
          todo: true,
          notes: true,
          links: true,
          credentials: true,
          clip: false,
        };
        appSurface.classList.remove('expanded', 'opening', 'closing');
        appSurface.classList.add('collapsed');
        applyFeatureSettings({ features, defaultTab: 'todo' });
        await setMode(true);
        const preferredOpened = document.getElementById('tab-todo').classList.contains('active');
        await setMode(false);

        applyFeatureSettings({ features: { ...features, todo: false }, defaultTab: 'todo' });
        await setMode(true);
        const result = {
          preferredOpened,
          fallbackToFirstVisible: document.querySelector('.tab[data-tab]:not([hidden])')?.dataset.tab === 'weekly',
        };
        await setMode(false);
        applyFeatureSettings({ features, defaultTab: 'todo' });
        return result;
      })()
    `);
    assert.deepEqual(defaultTabOpening, {
      preferredOpened: true,
      fallbackToFirstVisible: true,
    }, '每次展开应进入设置的默认页，默认页不可见时回退到第一个可见页');

    const credentialSelectionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const originalApi = window.notchAPI;
        const item = {
          id: 'credential-selection-test',
          service: 'Example',
          account: 'me@example.com',
          password: 'secret',
          passwordMask: '**********',
        };
        window.notchAPI = {
          saveCredential: async () => ({ ok: true }),
          listCredentials: async () => ({ items: [item], secureStorage: true }),
          getCredential: async () => ({ ok: true, item }),
          deleteCredentials: async () => ({ ok: true }),
          copyCredential: async () => true,
        };
        document.getElementById('tab-button-credentials').click();
        document.getElementById('credential-service').value = item.service;
        document.getElementById('credential-account').value = item.account;
        document.getElementById('credential-password').value = item.password;
        document.getElementById('credential-save').click();
        const deadline = performance.now() + 2000;
        while (!document.querySelector('.credential-item[data-id="credential-selection-test"]')
          && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        let row = document.querySelector('.credential-item[data-id="credential-selection-test"]');
        row.querySelector('.credential-copy').dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const bulkDelete = document.getElementById('credential-bulk-delete');
        const selected = document.querySelector('.credential-item[data-id="credential-selection-test"]');
        const searchRect = document.getElementById('credential-search').getBoundingClientRect();
        const deleteRect = bulkDelete.getBoundingClientRect();
        const selectedState = {
          card: selected.classList.contains('multi-selected'),
          deleteVisible: !bulkDelete.hidden && getComputedStyle(bulkDelete).display !== 'none',
          actionsShareOneRow: Math.abs(
            (searchRect.top + searchRect.bottom) / 2 - (deleteRect.top + deleteRect.bottom) / 2
          ) < 2 && deleteRect.left >= searchRect.right,
        };
        selected.querySelector('.credential-copy').click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        row = document.querySelector('.credential-item[data-id="credential-selection-test"]');
        const clearedState = {
          card: row.classList.contains('multi-selected'),
          deleteHidden: bulkDelete.hidden && getComputedStyle(bulkDelete).display === 'none',
          editing: row.classList.contains('editing'),
        };
        window.notchAPI = originalApi;
        return { selectedState, clearedState };
      })()
    `);
    assert.deepEqual(credentialSelectionAudit, {
      selectedState: { card: true, deleteVisible: true, actionsShareOneRow: true },
      clearedState: { card: false, deleteHidden: true, editing: false },
    }, '密钥批量删除应与搜索框同行，并在取消选中后隐藏');

    const todoCalendarNavigation = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        document.getElementById('tab-button-todo').click();
        document.getElementById('todo-add-open').click();
        const trigger = document.getElementById('todo-add-time');
        trigger.click();
        const previous = document.getElementById('todo-calendar-previous');
        const next = document.getElementById('todo-calendar-next');
        if (!previous || !next) {
          resolve({ controls: false });
          return;
        }
        const base = new Date();
        const popover = document.getElementById('todo-date-popover');
        const previousRect = previous.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        const clicksToJanuary = 12 - base.getMonth();
        for (let index = 0; index < clicksToJanuary; index += 1) next.click();
        const expectedYear = base.getFullYear() + 1;
        const januaryLabel = document.getElementById('todo-editor-month').textContent.trim();
        const day = [...document.querySelectorAll('#todo-calendar-grid [data-day]')]
          .find((button) => button.dataset.day === '2');
        day.click();
        document.getElementById('todo-editor-confirm').click();
        const selected = trigger.dataset.deadline ? new Date(trigger.dataset.deadline) : null;
        trigger.click();
        previous.click();
        document.getElementById('todo-add-backdrop').hidden = true;
        resolve({
          controls: true,
          popoverVisible: !popover.hidden && getComputedStyle(popover).display !== 'none',
          controlsUsable: [previousRect.width, previousRect.height, nextRect.width, nextRect.height]
            .every((size) => size >= 18),
          januaryLabel,
          decemberLabel: document.getElementById('todo-editor-month').textContent.trim(),
          selected: selected ? [selected.getFullYear(), selected.getMonth(), selected.getDate()] : [],
          expectedYear,
        });
      })
    `);

    assert.deepEqual(todoCalendarNavigation, {
      controls: true,
      popoverVisible: true,
      controlsUsable: true,
      januaryLabel: `${new Date().getFullYear() + 1}年 1月`,
      decemberLabel: `${new Date().getFullYear()}年 ${new Date().getMonth()}月`,
      selected: [new Date().getFullYear() + 1, 0, 2],
      expectedYear: new Date().getFullYear() + 1,
    });

    const todoDeadlineReset = await window.webContents.executeJavaScript(`
      (async () => {
        const openAdd = () => document.getElementById('todo-add-open').click();
        const create = (text) => {
          const input = document.getElementById('todo-add-input');
          input.value = text;
          document.getElementById('todo-add-create').click();
          return JSON.parse(localStorage.getItem('notch-todo-data')).P0.find((item) => item.text === text)?.deadline;
        };
        openAdd();
        const trigger = document.getElementById('todo-add-time');
        trigger.click();
        const base = new Date();
        const clicksToJanuary = 12 - base.getMonth();
        for (let index = 0; index < clicksToJanuary; index += 1) document.getElementById('todo-calendar-next').click();
        [...document.querySelectorAll('#todo-calendar-grid [data-day]')]
          .find((button) => button.dataset.day === '2').click();
        document.getElementById('todo-editor-confirm').click();
        const manuallySelected = trigger.dataset.deadline;
        create('deadline-reset-first');
        openAdd();
        create('deadline-reset-second');
        const now = new Date();
        const stored = JSON.parse(localStorage.getItem('notch-todo-data')).P0;
        document.getElementById('todo-add-backdrop').hidden = true;
        return {
          firstKeptManualDeadline: stored.find((item) => item.text === 'deadline-reset-first')?.deadline === manuallySelected,
          secondUsedResetDeadline: stored.find((item) => item.text === 'deadline-reset-second')?.deadline
            === new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30).toISOString(),
          popoverHidden: document.getElementById('todo-date-popover').hidden,
        };
      })()
    `);
    assert.equal(todoDeadlineReset.firstKeptManualDeadline, true, '当前待办应使用本次手动选择的截止时间');
    assert.equal(todoDeadlineReset.secondUsedResetDeadline, true, '新添加面板应重置为当天 23:30');
    assert.equal(todoDeadlineReset.popoverHidden, true, '提交后应关闭旧日期选择器');

    const todoRollover = await window.webContents.executeJavaScript(`
      (async () => {
        const RealDate = window.Date;
        let now = new RealDate(2026, 8, 11, 22).getTime();
        window.Date = class extends RealDate {
          constructor(...args) { super(...(args.length ? args : [now])); }
          static now() { return now; }
        };
        const today = () => new RealDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 23, 30).toISOString();
        const openAdd = () => document.getElementById('todo-add-open').click();
        const create = (text) => {
          const input = document.getElementById('todo-add-input');
          input.value = text;
          document.getElementById('todo-add-create').click();
          return JSON.parse(localStorage.getItem('notch-todo-data')).P0.find((item) => item.text === text)?.deadline;
        };
        try {
          openAdd();
          const trigger = document.getElementById('todo-add-time');
          const automatic = trigger.dataset.deadline === today();
          trigger.click();
          const calendar = document.querySelector('#todo-calendar-grid .selected')?.dataset.day === '11'
            && trigger.dataset.deadline === today();
          document.getElementById('todo-calendar-next').click();
          document.getElementById('todo-calendar-next').click();
          [...document.querySelectorAll('#todo-calendar-grid [data-day]')]
            .find((button) => button.dataset.day === '3').click();
          document.getElementById('todo-editor-confirm').click();
          const manualDeadline = trigger.dataset.deadline;
          const manual = create('rollover-manual') === manualDeadline;
          openAdd();
          const resetAfterManual = trigger.dataset.deadline === today();
          return { automatic, calendar, manual, resetAfterManual };
        } finally {
          window.Date = RealDate;
          closeTodoEditor();
          document.getElementById('todo-add-backdrop').hidden = true;
        }
      })()
    `);
    assert.deepEqual(todoRollover, {
      automatic: true, calendar: true, manual: true, resetAfterManual: true,
    }, '打开添加面板应默认当天 23:30；本次手选日期应保留；下次打开回到默认');

    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    });
    const panelMotionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('expanded', 'opening', 'closing');
        appSurface.classList.add('collapsed');
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (appSurface.classList.contains(name)) return true;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return false;
        };
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const contentLayerHasScale = [
          document.querySelector('.panel > .topbar'),
          document.querySelector('.panel > .panels'),
        ].filter(Boolean).some((layer) => layer.getAnimations().some((animation) => (
          animation.effect?.getKeyframes?.().some((frame) => {
            if (!frame.transform || frame.transform === 'none') return false;
            const matrix = new DOMMatrixReadOnly(frame.transform);
            const scaleX = Math.hypot(matrix.a, matrix.b);
            const scaleY = Math.hypot(matrix.c, matrix.d);
            return Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
          })
        )));
        document.getElementById('notch').click();
        const collapsed = await waitForClass('collapsed');
        return { opened, collapsed, contentLayerHasScale };
      })()
    `);
    assert.equal(panelMotionAudit.opened, true);
    assert.equal(panelMotionAudit.collapsed, true);
    assert.equal(panelMotionAudit.contentLayerHasScale, false, '展开/收起不应缩放整个大面积内容层');

  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
  }
}

main().then(
  () => { diagnostic('Renderer interaction checks passed'); app.quit(); },
  (error) => {
    diagnostic(error.stack);
    app.exit(1);
  }
);
