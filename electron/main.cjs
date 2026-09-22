/* Оболочка Electron для Steam. dist/ отдаётся через схему app:// (чтобы работал fetch JSON-уровней и листов врагов).
   Уровни пользователя пишутся в userData/levels. Флаги: --windowed, --log, --page game.html?level=sandbox&mode=sandbox */
const { app, BrowserWindow, globalShortcut, Menu, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

/* Steam Deck / SteamOS: распакованный билд лежит в домашней папке без setuid-бита на chrome-sandbox,
   поэтому песочницу Chromium выключаем — иначе Electron не стартует вовсе. */
if (process.platform === 'linux') { app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu-sandbox'); }
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const DIST = path.join(__dirname, '..', 'dist');
const levelsDir = () => { const d = path.join(app.getPath('userData'), 'levels'); fs.mkdirSync(d, { recursive: true }); return d; };
const safe = id => String(id).replace(/[^\w.-]/g, '_');

ipcMain.handle('levels:list', () => fs.readdirSync(levelsDir()).filter(f => f.endsWith('.json')).map(f => {
  try { const d = JSON.parse(fs.readFileSync(path.join(levelsDir(), f), 'utf8')); return { id: d.id || f.replace('.json', ''), name: d.name || d.id }; } catch (e) { return null; }
}).filter(Boolean));
ipcMain.handle('levels:load', (e, id) => { const f = path.join(levelsDir(), safe(id) + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; });
ipcMain.handle('levels:save', (e, id, json) => { fs.writeFileSync(path.join(levelsDir(), safe(id) + '.json'), json); return true; });
ipcMain.handle('levels:delete', (e, id) => { const f = path.join(levelsDir(), safe(id) + '.json'); if (fs.existsSync(f)) fs.unlinkSync(f); return true; });

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    fullscreen: !process.argv.includes('--windowed'),
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: 'Рыцарь',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  Menu.setApplicationMenu(null);
  if (process.argv.includes('--log')) {
    win.webContents.on('console-message', (e, level, msg) => console.log('[renderer]', msg));
    win.webContents.on('did-finish-load', () => console.log('[electron] loaded', win.webContents.getURL()));
    win.webContents.on('render-process-gone', (e, d) => console.log('[electron] renderer gone', d.reason));
  }
  const pageArg = process.argv.find(a => a.startsWith('--page='));
  const page = pageArg ? pageArg.slice(7) : 'index.html';
  win.loadURL(`app://knight/${page}`);
  globalShortcut.register('F11', () => win.setFullScreen(!win.isFullScreen()));
  globalShortcut.register('Alt+Enter', () => win.setFullScreen(!win.isFullScreen()));
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
