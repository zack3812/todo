const assert = require('node:assert/strict');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const errors = [];
setTimeout(() => { console.error('Production startup timed out', errors); app.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.once('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    setTimeout(async () => {
      try {
        const state = await contents.executeJavaScript(`(async () => {
          const appSurface = document.getElementById('app');
          appSurface.classList.remove('collapsed', 'opening', 'closing');
          appSurface.classList.add('expanded');
          document.getElementById('tab-button-todo').click();
          await new Promise((resolve) => setTimeout(resolve, 300));
          return {
            defaultTodo: document.getElementById('tab-todo')?.classList.contains('active'),
          };
        })()`);
        assert.deepEqual(errors, []);
        assert.deepEqual(state, {defaultTodo:true});
        console.log('Production workspace recovery checks passed');
        app.quit();
      } catch (error) { console.error(error); app.exit(1); }
    }, 2000);
  });
});
require('../main.js');
