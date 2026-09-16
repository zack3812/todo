const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    await window.webContents.executeJavaScript(`localStorage.clear();`);
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const state = await window.webContents.executeJavaScript(`(async () => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('collapsed', 'opening', 'closing');
        appSurface.classList.add('expanded');
        document.getElementById('tab-button-todo').click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
          defaultTodo: document.getElementById('tab-todo')?.classList.contains('active'),
        };
      })()`);
    assert.deepEqual(errors, [], 'Retained profile must initialize without renderer errors');
    assert.deepEqual(state, {defaultTodo:true});
    console.log('Retained workspace renderer checks passed');
  } finally { window.destroy(); }
}
main().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
