/* Оболочка Electron для Steam. dist/ отдаётся через схему app:// (чтобы работал fetch JSON-уровней и листов врагов).
   Уровни пользователя пишутся в userData/levels. Флаги: --windowed, --log, --page game.html?level=sandbox&mode=sandbox */
const { app, BrowserWindow, globalShortcut, Menu, ipcMain, protocol, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

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

/* ─── обновление игры с GitHub ───
   Сборка ставится скриптом tools/install-deck.sh и живёт папкой в домашнем каталоге, без всяких
   пакетных менеджеров. Поэтому обновление устроено так же: спрашиваем у GitHub последний релиз,
   сравниваем с тегом, зашитым в сборку (electron/build-tag.json пишет релизный воркфлоу), и, если
   игрок согласен, запускаем тот же install-deck.sh поверх — он сам заменит папку и поднимет игру.
   Работает только для распакованной linux-сборки: в Steam обновления раздаёт сам Steam. */
const REPO = 'ndrwbv/ricar';
const INSTALLER = `https://raw.githubusercontent.com/${REPO}/main/tools/install-deck.sh`;

function buildTag() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-tag.json'), 'utf8')).tag || ''; }
  catch (e) { return ''; }
}
const installDir = () => path.dirname(process.execPath);
function updatable() {
  if (!app.isPackaged || process.platform !== 'linux') return false;
  if (process.argv.includes('--no-update') || process.env.KNIGHT_NO_UPDATE) return false;
  try { fs.accessSync(installDir(), fs.constants.W_OK); } catch (e) { return false; }
  return !!buildTag();
}

async function latestRelease() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'knight-updater' },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.tag_name ? { tag: j.tag_name, notes: (j.body || '').slice(0, 400) } : null;
  } catch (e) { return null; }
  finally { clearTimeout(timer); }
}

/* Проверка. manual=true — игрок нажал «проверить обновления» сам, тогда отвечаем и когда всё свежее. */
async function checkUpdate(win, manual) {
  if (!updatable() && !manual) return { state: 'off' };
  const cur = buildTag();
  const rel = await latestRelease();
  if (!rel) return { state: 'error' };
  if (!cur || rel.tag === cur) return { state: 'fresh', current: cur, latest: rel.tag };
  if (!updatable()) return { state: 'available', current: cur, latest: rel.tag };
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Обновление',
    message: `Вышла версия ${rel.tag}`,
    detail: `${rel.notes ? rel.notes + '\n\n' : ''}Установлена ${cur}. Обновить сейчас? Игра закроется и запустится заново.`,
    buttons: ['Обновить', 'Потом'],
    defaultId: 0, cancelId: 1, noLink: true,
  });
  if (response !== 0) return { state: 'declined', current: cur, latest: rel.tag };
  applyUpdate();
  return { state: 'updating', current: cur, latest: rel.tag };
}

function applyUpdate() {
  // ждём, пока процесс отпустит папку, и ставим поверх тем же скриптом, что и в первый раз
  const sh = spawn('bash', ['-c', 'sleep 2; curl -fsSL "$KNIGHT_INSTALLER" | bash -s -- --dir "$KNIGHT_DIR" --no-desktop --run'], {
    env: { ...process.env, KNIGHT_INSTALLER: INSTALLER, KNIGHT_DIR: installDir() },
    detached: true, stdio: 'ignore',
  });
  sh.unref();
  setTimeout(() => app.quit(), 300);
}

ipcMain.handle('update:check', (e, manual) => checkUpdate(BrowserWindow.fromWebContents(e.sender), !!manual));
ipcMain.handle('update:apply', () => { if (!updatable()) return false; applyUpdate(); return true; });
ipcMain.handle('update:info', () => ({ tag: buildTag(), updatable: updatable() }));

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
  // тихая проверка обновления через пару секунд после старта, чтобы не мешать загрузке
  if (updatable()) setTimeout(() => checkUpdate(win, false).catch(() => {}), 2500);
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
