/* Хранилище уровней.
   Источники: встроенные public/levels/*.json (список в index.json), правки в localStorage (knight.level.<id>),
   в dev-режиме — запись прямо в проект через /__api/levels, в Electron — через window.knightFS. */
const LS = 'knight.level.';
const base = './levels/';

export async function listLevels() {
  const out = new Map();
  try {
    const r = await fetch(`${base}index.json`, { cache: 'no-cache' });
    if (r.ok) for (const it of await r.json()) out.set(it.id, { id: it.id, name: it.name, builtin: true, local: false });
  } catch (e) { /* нет index.json */ }
  if (window.knightFS) {
    try { for (const it of await window.knightFS.listLevels()) out.set(it.id, { ...(out.get(it.id) || {}), id: it.id, name: it.name, user: true }); } catch (e) {}
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k.startsWith(LS)) continue;
    try { const d = JSON.parse(localStorage.getItem(k)); const id = k.slice(LS.length); out.set(id, { ...(out.get(id) || { builtin: false }), id, name: d.name || id, local: true }); } catch (e) {}
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadLevelData(id, { preferBuiltin = false } = {}) {
  if (!preferBuiltin) {
    const loc = localStorage.getItem(LS + id);
    if (loc) { try { return JSON.parse(loc); } catch (e) {} }
    if (window.knightFS) { try { const d = await window.knightFS.loadLevel(id); if (d) return d; } catch (e) {} }
  }
  const r = await fetch(`${base}${id}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`уровень ${id} не найден`);
  return r.json();
}

export function saveLevelLocal(data) { localStorage.setItem(LS + data.id, JSON.stringify(data)); }
export function deleteLevelLocal(id) { localStorage.removeItem(LS + id); }
export const hasLocal = id => !!localStorage.getItem(LS + id);

// запись в проект (dev-сервер Vite) или в папку пользователя (Electron)
export async function saveLevelToProject(data) {
  if (window.knightFS) { await window.knightFS.saveLevel(data.id, JSON.stringify(data, null, 1)); return 'electron'; }
  try {
    const r = await fetch(`/__api/levels/${encodeURIComponent(data.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data, null, 1) });
    if (r.ok) return 'project';
  } catch (e) {}
  return null;
}
export async function deleteLevelInProject(id) {
  if (window.knightFS) { await window.knightFS.deleteLevel(id); return true; }
  try { const r = await fetch(`/__api/levels/${encodeURIComponent(id)}`, { method: 'DELETE' }); return r.ok; } catch (e) { return false; }
}

export function exportLevel(data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${data.id}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function importLevel() {
  return new Promise((res, rej) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return rej(new Error('файл не выбран')); f.text().then(t => res(JSON.parse(t))).catch(rej); };
    inp.click();
  });
}
