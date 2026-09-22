/* Хаб: список уровней с режимами запуска и форма настроек по схеме. */
import { SETTINGS_SCHEMA, loadSettings, saveSettings, resetSettings } from '../engine/settings.js';
import { listLevels, loadLevelData, saveLevelLocal, deleteLevelLocal, exportLevel, importLevel, saveLevelToProject, deleteLevelInProject, hasLocal } from '../engine/levelstore.js';
import { emptyLevel } from '../engine/levelloader.js';
import { pollGamepad, flushInput, gamepad } from '../engine/input.js';
import { makePadMenu } from '../ui/padmenu.js';

const el = id => document.getElementById(id);
let settings = loadSettings();

/* ─── уровни ─── */
async function renderLevels() {
  const list = await listLevels();
  const box = el('levels');
  box.innerHTML = '';
  for (const L of list) {
    const row = document.createElement('div');
    row.className = 'level';
    row.innerHTML = `
      <div class="name">${esc(L.name)} <span class="id">${esc(L.id)}</span> ${L.local ? '<span class="badge">изменён</span>' : ''} ${L.builtin ? '' : '<span class="badge new">свой</span>'}</div>
      <div class="acts">
        <a class="btn play" href="./game.html?level=${enc(L.id)}&mode=play">Играть</a>
        <a class="btn" href="./game.html?level=${enc(L.id)}&mode=sandbox">Песочница</a>
        <a class="btn" href="./editor.html?level=${enc(L.id)}">Редактор</a>
        <button data-act="dup">Копия</button>
        <button data-act="export">Экспорт</button>
        ${L.local && L.builtin ? '<button data-act="revert">Сброс</button>' : ''}
        ${!L.builtin || L.user ? '<button data-act="delete" class="danger">Удалить</button>' : ''}
      </div>`;
    row.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return;
      const data = await loadLevelData(L.id);
      if (b.dataset.act === 'export') exportLevel(data);
      if (b.dataset.act === 'dup') {
        const id = prompt('id копии (латиница, цифры, -):', L.id + '-copy'); if (!id) return;
        const d = { ...data, id: id.replace(/[^\w.-]/g, '_'), name: data.name + ' (копия)' };
        saveLevelLocal(d); await saveLevelToProject(d); renderLevels();
      }
      if (b.dataset.act === 'revert') { if (confirm(`Вернуть встроенную версию «${L.name}»?`)) { deleteLevelLocal(L.id); renderLevels(); } }
      if (b.dataset.act === 'delete') { if (confirm(`Удалить уровень «${L.name}»?`)) { deleteLevelLocal(L.id); await deleteLevelInProject(L.id); renderLevels(); } }
    });
    box.appendChild(row);
  }
  if (!list.length) box.innerHTML = '<p class="dim">Уровней нет. Создайте новый.</p>';
}
el('newLevel').onclick = async () => {
  const id = prompt('id уровня (латиница, цифры, -):', 'my-level'); if (!id) return;
  const name = prompt('Название:', 'Мой уровень') || id;
  const d = emptyLevel(id.replace(/[^\w.-]/g, '_'), name);
  saveLevelLocal(d); await saveLevelToProject(d);
  location.href = `./editor.html?level=${enc(d.id)}`;
};
el('importLevel').onclick = async () => {
  try { const d = await importLevel(); if (!d.id) d.id = 'imported'; saveLevelLocal(d); await saveLevelToProject(d); renderLevels(); }
  catch (e) { alert('не удалось импортировать: ' + e.message); }
};

/* ─── настройки ─── */
function renderSettings() {
  const f = el('settings');
  f.innerHTML = '';
  for (const [gid, grp] of Object.entries(SETTINGS_SCHEMA)) {
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${grp.title}</legend>`;
    for (const [k, fd] of Object.entries(grp.fields)) {
      const v = settings[k];
      const row = document.createElement('label');
      row.className = 'row';
      let input;
      if (fd.type === 'bool') input = `<input type="checkbox" name="${k}" ${v ? 'checked' : ''}>`;
      else if (fd.type === 'select') input = `<select name="${k}">${fd.options.map(([val, lab]) => `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${lab}</option>`).join('')}</select>`;
      else input = `<input type="range" name="${k}" min="${fd.min}" max="${fd.max}" step="${fd.step}" value="${v}"><output>${v}</output>`;
      row.innerHTML = `<span>${fd.label}</span>${input}`;
      fs.appendChild(row);
    }
    f.appendChild(fs);
  }
  f.oninput = e => {
    const t = e.target, k = t.name; if (!k) return;
    const fd = Object.values(SETTINGS_SCHEMA).flatMap(g => Object.entries(g.fields)).find(([n]) => n === k)[1];
    settings[k] = fd.type === 'bool' ? t.checked : fd.type === 'select' ? (isNaN(+t.value) ? t.value : +t.value) : +t.value;
    if (t.nextElementSibling?.tagName === 'OUTPUT') t.nextElementSibling.textContent = t.value;
    saveSettings(settings);
  };
}
el('resetSettings').onclick = () => { if (confirm('Сбросить все настройки?')) { settings = resetSettings(); renderSettings(); } };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const enc = encodeURIComponent;
renderLevels();
renderSettings();

/* ─── версия и обновление ───
   В Electron-сборке, поставленной install-deck.sh, показываем версию и даём проверить
   обновление вручную; сама игра ещё и молча спрашивает GitHub при запуске. */
async function renderVersion() {
  if (!window.knightUpdate) return;
  const box = el('version');
  const info = await window.knightUpdate.info();
  box.hidden = false;
  const draw = (text, btn) => {
    box.innerHTML = `версия ${esc(info.tag || '—')} · <span id="updState">${esc(text)}</span>` +
      (btn ? ` <button id="updBtn" class="small">${esc(btn)}</button>` : '');
    const b = el('updBtn');
    if (b) b.onclick = async () => {
      if (b.textContent === 'обновить') { await window.knightUpdate.apply(); draw('ставится…', ''); return; }
      draw('проверяю…', '');
      const r = await window.knightUpdate.check(true);
      if (r.state === 'fresh') draw('это последняя версия', 'проверить обновления');
      else if (r.state === 'error') draw('GitHub не ответил', 'проверить обновления');
      else if (r.state === 'updating') draw('ставится…', '');
      else if (r.latest) draw(`есть ${r.latest}`, info.updatable ? 'обновить' : '');
      else draw('обновление недоступно', '');
    };
  };
  draw(info.updatable ? '' : 'обновление ставится только из установленной сборки', info.updatable ? 'проверить обновления' : '');
}
renderVersion();

/* Геймпад в хабе: на Steam Deck мышь живёт только на тачпаде, поэтому крестовина и стик
   двигают выбор, A нажимает, влево-вправо крутят ползунки и списки настроек. */
const padMenu = makePadMenu();
(function padLoop() {
  requestAnimationFrame(padLoop);
  pollGamepad();
  padMenu(gamepad, document.body);
  flushInput();
})();
