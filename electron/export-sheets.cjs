/* Экспорт процедурных листов спрайтов врагов в public/enemies/<имя>/sheet.png.
   Запуск: npm run sheets  (перерисовать всё заново: npm run sheets -- --force)

   У каждого врага своя папка: лист sheet.png, описание enemy.json, разметка
   template.png и его вещи в drops/. Нарисованные вручную листы не
   перезаписываются: если sheet.png уже лежит, он пропускается. Шаблоны и образцы кусков
   в public/gibs/_proc/ обновляются всегда — это разметка для рисования, а не
   сама работа художника. */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const FORCE = process.argv.includes('--force');
const ENEMIES = ['peasant', 'woman', 'claw', 'guard', 'archer', 'brute', 'hound'];

// записать PNG из data-URL; без --force не трогать уже существующий файл
function write(file, dataURL, guard) {
  if (guard && !FORCE && fs.existsSync(file)) {
    console.log('пропущен (уже есть):', path.basename(file));
    return false;
  }
  fs.writeFileSync(file, Buffer.from(dataURL.split(',')[1], 'base64'));
  console.log('записан', path.basename(file));
  return true;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'game.html'), { query: { level: 'sandbox' } });
  await new Promise(r => setTimeout(r, 1500));
  const js = code => win.webContents.executeJavaScript(code);

  const out = path.join(__dirname, '..', 'public', 'enemies');
  fs.mkdirSync(out, { recursive: true });
  for (const name of ENEMIES) {
    const dir = path.join(out, name);
    fs.mkdirSync(path.join(dir, 'drops'), { recursive: true });
    write(path.join(dir, 'sheet.png'), await js(`window.game.sheetDataURL(${JSON.stringify(name)})`), true);
    write(path.join(dir, 'template.png'), await js(`window.game.templateDataURL(${JSON.stringify(name)})`));
    /* Описание врага выкладываем рядом с листом, если его ещё нет: дальше правится
       руками, и встроенная копия из enemydefs.js больше не используется. */
    const jf = path.join(dir, 'enemy.json');
    if (!fs.existsSync(jf)) {
      const def = await js(`window.game.defJSON(${JSON.stringify(name)})`);
      if (def) { fs.writeFileSync(jf, def + '\n'); console.log('записан', `${name}/enemy.json`); }
    }
  }
  // список врагов: новые дописываем, порядок и чужие записи не трогаем
  const idxFile = path.join(out, 'index.json');
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (e) { /* списка ещё нет */ }
  let added = 0;
  for (const name of ENEMIES) if (!idx.some(it => it?.name === name)) { idx.push({ name }); added++; }
  if (added) { fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2) + '\n'); console.log(`в index.json добавлено: ${added}`); }
  // щит лежит отдельной картинкой — его тоже перерисовывают отдельно
  const sh = await js('window.game.shieldDataURL()');
  if (sh) write(path.join(out, 'shield.png'), sh, true);

  /* Куски тел: образцы кладутся в public/gibs/_proc/ и игрой не читаются.
     Чтобы заменить кусок, копируем нужный в public/gibs/ и вписываем имя
     в public/gibs/index.json. */
  const gdir = path.join(__dirname, '..', 'public', 'gibs', '_proc');
  fs.mkdirSync(gdir, { recursive: true });
  const gibs = await js('window.game.gibList()');
  for (const name of gibs) {
    const url = await js(`window.game.gibDataURL(${JSON.stringify(name)})`);
    if (url) fs.writeFileSync(path.join(gdir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`образцы кусков (${gibs.length} шт.) — public/gibs/_proc/`);
  if (!FORCE) console.log('листы врагов не перезаписывались; чтобы перерисовать: npm run sheets -- --force');
  app.quit();
});
