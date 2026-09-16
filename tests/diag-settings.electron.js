// 临时诊断：设置页“关于”卡片遮挡检测
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {} }));
setTimeout(() => { console.error('diag timed out'); app.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    setTimeout(async () => {
      try {
        const result = await contents.executeJavaScript(`(async function () {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const tab = document.getElementById('tab-button-settings');
          if (tab) tab.click();
          await sleep(600);
          const page = document.getElementById('settings-page');
          if (!page) return { error: 'no settings-page' };
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          };
          const about = document.querySelector('.settings-update-card');
          if (!about) return { error: 'no update card' };
          const aboutR = rect(about);
          // 收集设置页内所有可见元素（排除文本节点与 body 级）
          const all = [...page.querySelectorAll('*')].filter((el) => {
            const s = getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
          });
          // 找覆盖“关于”卡片的元素：与 about 相交、z 序更高（DOM 后 or z-index 大）
          const hits = [];
          for (const el of all) {
            if (el === about || about.contains(el) || el.contains(about)) continue;
            const r = el.getBoundingClientRect();
            const ox = Math.max(0, Math.min(r.right, aboutR.x + aboutR.w) - Math.max(r.left, aboutR.x));
            const oy = Math.max(0, Math.min(r.bottom, aboutR.y + aboutR.h) - Math.max(r.top, aboutR.y));
            if (ox > 4 && oy > 4) {
              const s = getComputedStyle(el);
              hits.push({
                cls: (el.className && String(el.className).slice(0, 60)) || el.tagName.toLowerCase(),
                id: el.id || '',
                z: s.zIndex,
                pos: s.position,
                r: rect(el),
                overlap: Math.round(ox * oy),
              });
            }
          }
          hits.sort((a, b) => b.overlap - a.overlap);
          // 页面滚动信息
          const panel = page.closest('.tab-panel') || page;
          return {
            about: aboutR,
            pageScroll: { h: page.scrollHeight, ch: page.clientHeight },
            panelScroll: { h: panel.scrollHeight, ch: panel.clientHeight },
            overlapping: hits.slice(0, 15),
          };
        })()`);
        console.log('DIAG ' + JSON.stringify(result, null, 2));
        app.exit(0);
      } catch (error) { console.error(error); app.exit(1); }
    }, 2000);
  });
});
require('../main.js');
