/* Редактор карт: та же геометрия, что и в игре. Навигация как в Unity: ПКМ — смотреть, СКМ — двигать,
   Alt+ЛКМ — орбита вокруг точки, колесо — приблизить к курсору, WASD/QE — полёт, F — к выбранному, T — вид сверху.
   Инструменты: примитивы, стены черчением, префабы, спрайты-PNG, враги, предметы, NPC, триггеры, старт; свои текстуры. */
import * as THREE from 'three';
import { buildTextures, TEX, loadCustomTextures, registerTexture, saveTextureLocal, CUSTOM_TEX } from '../engine/textures.js';
import { buildSprites, SPR } from '../engine/sprites.js';
import { World, billboard } from '../engine/world.js';
import { loadEnemyDefs, loadGibs, DEFS } from '../engine/enemydefs.js';
import { PREFABS, prefabDefaults } from '../engine/prefabs.js';
import { buildObject, emptyLevel, DEFAULT_ENVS, ACTIONS, PICKUP_KINDS } from '../engine/levelloader.js';
import { loadLevelData, saveLevelLocal, saveLevelToProject, exportLevel, importLevel } from '../engine/levelstore.js';

const el = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LEVEL_ID = params.get('level') || 'sandbox';
const R = v => Math.round(v * 1000) / 1000;

buildTextures(); buildSprites();
await loadCustomTextures('./textures/');
await loadEnemyDefs('./enemies/');
await loadGibs('./gibs/');
const texList = () => Object.keys(TEX).filter(n => !/^(blood|pool|hole|fire|flash|glow|drop)/.test(n));
const spriteList = () => [...CUSTOM_TEX.filter(t => t.sprite).map(t => t.name), ...Object.keys(SPR).filter(n => /^(rose|candle|pickup_|gib_|head_)/.test(n))];

/* ─── состояние ─── */
let level;
try { level = await loadLevelData(LEVEL_ID); } catch (e) { level = emptyLevel(LEVEL_ID, LEVEL_ID); }
for (const k of ['objects', 'enemies', 'pickups', 'npcs', 'triggers', 'rules']) level[k] = level[k] || [];
level.envs = { ...DEFAULT_ENVS, ...(level.envs || {}) };
level.start = level.start || { x: 0, y: 0, z: 0, yaw: 0 };
level.bounds = level.bounds || { x0: -40, z0: -40, x1: 40, z1: 40 };
level.floorH = level.floorH || 3.2;              // высота этажа: на неё умножается номер этажа
const floorH = () => +level.floorH || 3.2;
const curFloor = () => +(el('floorSel')?.value || 0);
const placeY = () => R(curFloor() * floorH());   // высота, на которую ставятся новые объекты
let sel = null, tool = 'select';
const undo = [], redo = [];
let dirty = false, saveTimer = null;
const toolOpts = { wallTex: 'stone', wallH: 3, wallThick: .4, spriteImg: spriteList()[0] || 'rose', spriteW: 1, spriteBillboard: true };
let wallPts = [];      // точки черчения стены
let lastWallClick = { t: 0, p: [0, 0] };   // для распознавания двойного клика

/* ─── сцена ─── */
const canvas = el('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141018);
scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const sun = new THREE.DirectionalLight(0xfff0e0, 1.6); sun.position.set(30, 60, 20); scene.add(sun);
const root = new THREE.Group(); scene.add(root);
const markers = new THREE.Group(); scene.add(markers);
const overlay = new THREE.Group(); scene.add(overlay);
const grid = new THREE.GridHelper(400, 400, 0x3a2a3a, 0x241a24); grid.position.y = .005; scene.add(grid);
const grid10 = new THREE.GridHelper(400, 40, 0x6a4a5a, 0x6a4a5a); grid10.position.y = .006; scene.add(grid10);

const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 500); ortho.up.set(0, 0, -1);
const persp = new THREE.PerspectiveCamera(70, 1, .05, 800);
let camMode = 'fly';
const cam = { cx: level.start.x, cz: level.start.z, zoom: 14, px: level.start.x + 10, py: 9, pz: level.start.z + 14, yaw: Math.atan2(-(level.start.x - (level.start.x + 10)), -(level.start.z - (level.start.z + 14))), pitch: -.5 };
const activeCam = () => camMode === 'top' ? ortho : persp;
const camDir = () => new THREE.Vector3(-Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), -Math.cos(cam.yaw) * Math.cos(cam.pitch));

function resize() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  renderer.setSize(W, H, false);
  const a = W / H;
  ortho.left = -cam.zoom * a; ortho.right = cam.zoom * a; ortho.top = cam.zoom; ortho.bottom = -cam.zoom; ortho.updateProjectionMatrix();
  persp.aspect = a; persp.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
function updateCamera() {
  if (camMode === 'top') { ortho.position.set(cam.cx, 200, cam.cz); ortho.lookAt(cam.cx, 0, cam.cz); resize(); }
  else { persp.position.set(cam.px, cam.py, cam.pz); persp.rotation.order = 'YXZ'; persp.rotation.y = cam.yaw; persp.rotation.x = cam.pitch; }
}

/* ─── построение ─── */
const itemGroups = new Map();
const keyOf = (kind, i) => `${kind}:${i}`;
function buildAll() {
  for (const c of [...root.children]) { root.remove(c); c.traverse(o => o.geometry?.dispose?.()); }
  for (const c of [...markers.children]) markers.remove(c);
  itemGroups.clear();
  for (const kind of ['objects', 'enemies', 'pickups', 'npcs', 'triggers']) level[kind].forEach((_, i) => buildItem(kind, i));
  buildStart(); buildBounds();
  refreshList(); highlight();
}
function ring(color, r0 = .35, r1 = .5) { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 16), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.y = .02; return m; }
function buildItem(kind, i) {
  const old = itemGroups.get(keyOf(kind, i));
  if (old) { old.parent.remove(old); old.traverse(o => o.geometry?.dispose?.()); }
  const grp = new THREE.Group();
  grp.userData.ref = { kind, i };
  const it = level[kind][i];
  if (kind === 'objects') {
    const w = new World(grp, { editor: true });
    try { buildObject({ world: w, scene: grp, gore: null }, it, { bills: [], glows: [] }); } catch (e) { console.warn('объект', i, e); }
    w.flush();
    if (it.t === 'sprite') { /* биллборд уже в группе; добавим кольцо */ grp.add(Object.assign(ring(0xff80ff, .2, .3), { position: new THREE.Vector3(it.x, (it.y || 0) + .02, it.z) })); }
    root.add(grp);
  } else if (kind === 'enemies') {
    const def = DEFS[it.type] || DEFS.peasant;
    const s = SPR[`${def.name}${it.variant ?? 0}_walk0`] || SPR[`${def.name}0_walk0`];
    const m = billboard(s, def.size[0], def.size[1]); m.name = 'bb'; grp.add(m);
    grp.add(ring(it.alerted ? 0xff4040 : 0xffa040));
    grp.position.set(it.x, it.y || 0, it.z); markers.add(grp);
  } else if (kind === 'pickups') {
    const s = SPR[{ health: 'pickup_health', ammo: 'pickup_ammo', gun: 'pickup_pistol', shotgun: 'pickup_shotgun', shells: 'pickup_shells', rocket: 'pickup_rocket', rockets: 'pickup_rockets', cloth: 'pickup_cloth' }[it.kind] || 'pickup_health'];
    const m = billboard(s, .6, .6 * s.h / s.w); m.name = 'bb'; grp.add(m);
    grp.add(ring(it.hidden ? 0x8080ff : 0x40ff80, .3, .4));
    grp.position.set(it.x, it.y ?? 0, it.z); markers.add(grp);
  } else if (kind === 'npcs') {
    const m = billboard(SPR[it.sprite] || SPR.knight_idle, .9, 1.8); m.name = 'bb'; grp.add(m);
    grp.add(ring(0x40c0ff));
    grp.position.set(it.x, 0, it.z); markers.add(grp);
  } else if (kind === 'triggers') {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe040, transparent: true, opacity: .18, depthWrite: false });
    let m;
    if (it.r) { m = new THREE.Mesh(new THREE.CylinderGeometry(it.r, it.r, 2, 20), mat); m.position.set(it.x, 1, it.z); }
    else { m = new THREE.Mesh(new THREE.BoxGeometry(it.x1 - it.x0, 2, it.z1 - it.z0), mat); m.position.set((it.x0 + it.x1) / 2, 1, (it.z0 + it.z1) / 2); }
    grp.add(m);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xffe040 })); edge.position.copy(m.position); grp.add(edge);
    markers.add(grp);
  }
  itemGroups.set(keyOf(kind, i), grp);
}
let startMarker, boundsMarker, selBox;
function buildStart() {
  if (startMarker) markers.remove(startMarker);
  const s = level.start;
  startMarker = new THREE.Group(); startMarker.userData.ref = { kind: 'start', i: 0 };
  const cone = new THREE.Mesh(new THREE.ConeGeometry(.4, 1.2, 8), new THREE.MeshBasicMaterial({ color: 0x40ff60 })); cone.rotation.x = Math.PI / 2; cone.position.set(0, .6, -.6); startMarker.add(cone);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 1.7, 10), new THREE.MeshBasicMaterial({ color: 0x20a040, transparent: true, opacity: .6 })); cyl.position.y = .85; startMarker.add(cyl);
  startMarker.position.set(s.x, s.y || 0, s.z); startMarker.rotation.y = s.yaw || 0;
  markers.add(startMarker);
}
function buildBounds() {
  if (boundsMarker) markers.remove(boundsMarker);
  const b = level.bounds;
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(b.x0, .05, b.z0), new THREE.Vector3(b.x1, .05, b.z0), new THREE.Vector3(b.x1, .05, b.z1), new THREE.Vector3(b.x0, .05, b.z1), new THREE.Vector3(b.x0, .05, b.z0)]);
  boundsMarker = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff5050 })); markers.add(boundsMarker);
}
function highlight() {
  if (selBox) { scene.remove(selBox); selBox = null; }
  const grp = selGroup(); if (!grp) return;
  const box = new THREE.Box3().setFromObject(grp); if (box.isEmpty()) return;
  selBox = new THREE.Box3Helper(box, 0x00ffff); scene.add(selBox);
}
const selGroup = () => !sel ? null : sel.kind === 'start' ? startMarker : itemGroups.get(keyOf(sel.kind, sel.i));
// превью стены при черчении
let wallPreview = null;
// курсор рядом с первой точкой? тогда клик замкнёт контур
const CLOSE_R = 0.9;
function nearFirst(pt) { return wallPts.length >= 3 && pt && Math.hypot(pt[0] - wallPts[0][0], pt[1] - wallPts[0][1]) < CLOSE_R; }
function drawWallPreview(cursor) {
  if (wallPreview) { overlay.remove(wallPreview); wallPreview = null; }
  if (!wallPts.length) return;
  const snapClose = nearFirst(cursor);
  if (snapClose) cursor = wallPts[0];
  const pts = [...wallPts, ...(cursor ? [cursor] : [])].map(p => new THREE.Vector3(p[0], .1, p[1]));
  const g = new THREE.Group();
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: snapClose ? 0x40ff70 : 0x40ffff })));
  for (const p of pts) { const s = new THREE.Mesh(new THREE.SphereGeometry(.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0x40ffff })); s.position.copy(p); g.add(s); }
  // первая точка крупнее: в неё нужно кликнуть, чтобы замкнуть фигуру
  if (wallPts.length >= 3) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(CLOSE_R * .5, 10, 8), new THREE.MeshBasicMaterial({ color: snapClose ? 0x40ff70 : 0xffd070, transparent: true, opacity: .55 }));
    f.position.set(wallPts[0][0], .1, wallPts[0][1]); g.add(f);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = a.distanceTo(b); if (len < .05) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(toolOpts.wallThick, toolOpts.wallH, len), new THREE.MeshBasicMaterial({ color: 0x40ffff, transparent: true, opacity: .25 }));
    m.position.set((a.x + b.x) / 2, toolOpts.wallH / 2, (a.z + b.z) / 2); m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); g.add(m);
  }
  overlay.add(g); wallPreview = g;
}
/* Закончить черчение. close=true — добавить ещё и отрезок от последней точки к первой,
   то есть замкнуть комнату. Раньше замкнуть было нечем, поэтому контур не закрывался. */
function finishWall(close = false) {
  const pts = wallPts.slice();
  if (close && pts.length >= 3) pts.push(pts[0]);
  let made = 0;
  if (pts.length >= 2) {
    snapshot();
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      if (Math.hypot(x1 - x0, z1 - z0) < .05) continue;
      level.objects.push({ t: 'wall', tex: toolOpts.wallTex, x0, z0, x1, z1, y: placeY(), h: toolOpts.wallH, thick: toolOpts.wallThick });
      buildItem('objects', level.objects.length - 1);
      made++;
    }
    if (made) { markDirty(); refreshList(); select({ kind: 'objects', i: level.objects.length - 1 }); save(true); }
    else undo.pop();
  }
  wallPts = []; drawWallPreview(null); renderToolOpts();
  if (made) el('status').textContent = close ? `контур замкнут: ${made} стен, сохранено` : `${made} стен добавлено, сохранено`;
}
function undoWallPoint() { wallPts.pop(); drawWallPreview(null); renderToolOpts(); }
function cancelWall() { wallPts = []; drawWallPreview(null); renderToolOpts(); }

/* ─── правки ─── */
function snapshot() { undo.push(JSON.stringify(level)); if (undo.length > 80) undo.shift(); redo.length = 0; }
function markDirty() { dirty = true; el('status').textContent = 'изменено…'; clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (dirty) save(false); }, 1200); }
const itemOf = s => s.kind === 'start' ? level.start : level[s.kind][s.i];
function setPath(obj, path, v) { const ps = path.split('.'); let o = obj; for (let i = 0; i < ps.length - 1; i++) { o[ps[i]] = o[ps[i]] || {}; o = o[ps[i]]; } if (v === undefined) delete o[ps[ps.length - 1]]; else o[ps[ps.length - 1]] = v; }
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function rebuildSel() { if (!sel) return; if (sel.kind === 'start') buildStart(); else buildItem(sel.kind, sel.i); highlight(); }
function addItem(kind, item) { snapshot(); level[kind].push(item); const i = level[kind].length - 1; buildItem(kind, i); select({ kind, i }); markDirty(); refreshList(); }
function deleteSel() { if (!sel || sel.kind === 'start') return; snapshot(); level[sel.kind].splice(sel.i, 1); sel = null; buildAll(); markDirty(); showProps(); }
function duplicateSel() {
  if (!sel || sel.kind === 'start') return;
  const c = JSON.parse(JSON.stringify(itemOf(sel)));
  if (c.x0 !== undefined) { c.x0 += 1; c.x1 += 1; } else if (c.x !== undefined) c.x += 1;
  addItem(sel.kind, c);
}
function moveSel(dx, dz, dy = 0, silent = false) {
  if (!sel) return;
  const it = itemOf(sel);
  if (it.x0 !== undefined) { it.x0 = R(it.x0 + dx); it.x1 = R(it.x1 + dx); it.z0 = R(it.z0 + dz); it.z1 = R(it.z1 + dz); }
  else { it.x = R(it.x + dx); it.z = R(it.z + dz); }
  if (dy) it.y = R((it.y || 0) + dy);
  rebuildSel(); if (!silent) { showProps(); markDirty(); }
}
function select(s) { sel = s; highlight(); showProps(); refreshListSel(); }

/* ─── палитра ─── */
const PALETTE = [
  ['select', 'Выбор', 'sel'], ['wall', 'Черчение стен', 'sel'],
  ['box', 'Коробка', 'prim'], ['floor', 'Пол / потолок', 'prim'], ['cyl', 'Цилиндр', 'prim'], ['quad', 'Плоскость / вывеска', 'prim'], ['blocker', 'Невидимая стена', 'prim'],
  ['sprite', 'Спрайт (PNG)', 'prim'], ['light', 'Свет', 'light'], ['fire', 'Огонь', 'light'],
  ...Object.entries(PREFABS).map(([k, P]) => [`prefab:${k}`, P.name, 'prefab']),
  ...Object.keys(DEFS).map(k => [`enemy:${k}`, `Враг: ${k}`, 'enemy']),
  ...PICKUP_KINDS.map(k => [`pickup:${k}`, `Предмет: ${k}`, 'pickup']),
  ['npc', 'NPC', 'npc'], ['trigger', 'Триггер (зона)', 'trig'], ['triggerCircle', 'Триггер (круг)', 'trig'], ['start', 'Старт игрока', 'start'],
];
function renderPalette() {
  const box = el('palette'); box.innerHTML = '';
  let lastCls = '';
  for (const [id, name, cls] of PALETTE) {
    if (cls !== lastCls) { const h = document.createElement('div'); h.className = 'pal-h'; h.textContent = { prim: 'Примитивы', light: 'Свет', prefab: 'Префабы', enemy: 'Враги', pickup: 'Предметы', npc: 'Прочее' }[cls] || ''; if (h.textContent) box.appendChild(h); lastCls = cls; }
    const b = document.createElement('button'); b.textContent = name; b.className = 'pal ' + cls + (tool === id ? ' on' : '');
    b.onclick = () => setTool(id);
    box.appendChild(b);
  }
  renderToolOpts();
}
function setTool(id) { if (tool === 'wall' && id !== 'wall') finishWall(false); tool = id; renderPalette(); canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair'; }
function renderToolOpts() {
  const box = el('toolOpts'); box.innerHTML = '';
  if (tool === 'wall') {
    box.appendChild(renderForm([selF('wallTex', 'текстура', texList()), num('wallH', 'высота'), num('wallThick', 'толщина', .05)], toolOpts, (k, v) => { toolOpts[k] = v; drawWallPreview(null); }));
    const row = document.createElement('div'); row.className = 'wall-btns';
    const mk = (label, title, fn, on) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.disabled = !on; b.onclick = fn; row.appendChild(b); };
    mk('Замкнуть', 'Добавить отрезок от последней точки к первой и сохранить (клавиша C или клик по первой точке)', () => finishWall(true), wallPts.length >= 3);
    mk('Готово', 'Закончить незамкнутую ломаную и сохранить (Enter или двойной клик)', () => finishWall(false), wallPts.length >= 2);
    mk('Шаг назад', 'Убрать последнюю точку (Backspace)', undoWallPoint, wallPts.length > 0);
    mk('Отменить', 'Сбросить черчение (Esc)', cancelWall, wallPts.length > 0);
    box.appendChild(row);
    // высота стены в этажах: удобнее, чем вбивать метры руками
    const fr2 = document.createElement('div'); fr2.className = 'wall-btns';
    for (const n of [1, 2, 3]) {
      const b = document.createElement('button');
      b.textContent = `${n} эт`; b.title = `Высота ${(floorH() * n).toFixed(1)} м — стена до ${n === 1 ? 'первого' : n === 2 ? 'второго' : 'третьего'} перекрытия`;
      b.onclick = () => { toolOpts.wallH = R(floorH() * n); renderToolOpts(); drawWallPreview(null); };
      fr2.appendChild(b);
    }
    box.appendChild(fr2);
    const p = document.createElement('p'); p.className = 'dim';
    p.innerHTML = wallPts.length
      ? `точек: <b>${wallPts.length}</b>. Кликните по <b>жёлтой первой точке</b> или нажмите <b>C</b>, чтобы замкнуть комнату; <b>Enter</b> / двойной клик — закончить как есть. Стены сохраняются сразу.`
      : 'Кликайте точки стены. Клик по первой точке или <b>C</b> — замкнуть контур, <b>Enter</b> / двойной клик — закончить, <b>Backspace</b> — шаг назад, <b>Esc</b> — отменить. Shift — без привязки к сетке.';
    box.appendChild(p);
  } else if (tool === 'sprite') {
    box.appendChild(renderForm([selF('spriteImg', 'картинка', spriteList()), num('spriteW', 'ширина, м'), bool('spriteBillboard', 'всегда лицом к игроку')], toolOpts, (k, v) => { toolOpts[k] = v; }));
    const b = document.createElement('button'); b.textContent = 'Загрузить PNG…'; b.onclick = () => uploadTexture(true); box.appendChild(b);
  } else if (['box', 'floor', 'cyl', 'quad'].includes(tool)) {
    box.appendChild(renderForm([selF('wallTex', 'текстура', texList())], toolOpts, (k, v) => { toolOpts[k] = v; }));
  }
}
function newItemFor(t, x, z) {
  const tex = toolOpts.wallTex;
  const Y = placeY();
  if (t === 'box') return ['objects', { t: 'box', tex, x: R(x - 1), y: Y, z: R(z - .25), w: 2, h: 3, d: .5 }];
  if (t === 'floor') return ['objects', { t: 'floor', tex: tex === 'stone' ? 'cobble' : tex, x: R(x - 4), y: R(Y + .01), z: R(z - 4), w: 8, d: 8, o: Y > 0 ? { solid: true } : {} }];
  if (t === 'cyl') return ['objects', { t: 'cyl', tex, x: R(x - .5), y: Y, z: R(z - .5), r: .5, h: 3, seg: 8 }];
  if (t === 'quad') return ['objects', { t: 'quad', tex: tex === 'stone' ? 'neon1' : tex, x: R(x), y: R(Y + 2), z: R(z), w: 3.2, h: 1.6, face: 0, o: { emissive: true } }];
  if (t === 'blocker') return ['objects', { t: 'blocker', x: R(x - 1), y: Y, z: R(z - .25), w: 2, h: 3, d: .5 }];
  if (t === 'sprite') return ['objects', { t: 'sprite', img: toolOpts.spriteImg, x: R(x), y: Y, z: R(z), w: toolOpts.spriteW, billboard: toolOpts.spriteBillboard }];
  if (t === 'light') return ['objects', { t: 'light', x: R(x), y: R(Y + 2.5), z: R(z), color: '#ffc080', i: 2, dist: 10 }];
  if (t === 'fire') return ['objects', { t: 'fire', x: R(x), y: Y, z: R(z), size: 1 }];
  if (t.startsWith('prefab:')) { const kind = t.slice(7); const [w, d] = PREFABS[kind].size(prefabDefaults(kind)); return ['objects', { t: 'prefab', kind, x: R(x - w / 2), z: R(z - d / 2), p: prefabDefaults(kind) }]; }
  if (t.startsWith('enemy:')) return ['enemies', { type: t.slice(6), x: R(x), y: placeY(), z: R(z), tag: '', alerted: false, guardR: 0 }];
  if (t.startsWith('pickup:')) return ['pickups', { kind: t.slice(7), x: R(x), z: R(z) }];
  if (t === 'npc') return ['npcs', { id: 'npc' + (level.npcs.length + 1), sprite: 'knight_idle', x: R(x), z: R(z), line: '…', dur: 5 }];
  if (t === 'trigger') return ['triggers', { x0: R(x - 2), z0: R(z - 2), x1: R(x + 2), z1: R(z + 2), once: true, actions: [{ a: 'msg', text: 'ТРИГГЕР', dur: 2 }] }];
  if (t === 'triggerCircle') return ['triggers', { x: R(x), z: R(z), r: 1.5, once: true, actions: [{ a: 'msg', text: 'ТРИГГЕР', dur: 2 }] }];
  return null;
}

/* ─── свои текстуры ─── */
async function uploadTexture(asSprite) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/webp,image/jpeg';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let name = prompt('Имя текстуры (латиница, цифры, -):', f.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]/g, '_')); if (!name) return;
    name = name.replace(/[^\w.-]/g, '_');
    const sprite = asSprite ?? confirm('Это спрайт (картинка с прозрачностью, не тайлится)? ОК — спрайт, Отмена — тайловая текстура стен/пола');
    const url = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(f); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    registerTexture(name, img, { sprite });
    saveTextureLocal(name, url, sprite);
    let where = 'в браузер';
    try { const r = await fetch(`/__api/textures/${encodeURIComponent(name)}${sprite ? '?sprite=1' : ''}`, { method: 'PUT', body: f }); if (r.ok) where = 'в проект (public/textures)'; } catch (e) {}
    el('status').textContent = `текстура «${name}» сохранена ${where}`;
    if (sprite) toolOpts.spriteImg = name; else toolOpts.wallTex = name;
    renderToolOpts(); showProps(); buildAll();
  };
  inp.click();
}
el('texBtn').onclick = () => uploadTexture(undefined);

/* ─── свойства ─── */
const num = (key, label, step = .1) => ({ key, label, type: 'number', step });
const bool = (key, label) => ({ key, label, type: 'bool' });
const selF = (key, label, options) => ({ key, label, type: 'select', options });
const text = (key, label) => ({ key, label, type: 'text' });
const json = (key, label) => ({ key, label, type: 'json' });
const color = (key, label) => ({ key, label, type: 'color' });
const COMMON_O = [bool('o.solid', 'твёрдый (коллизии)'), bool('o.emissive', 'самосветящийся'), text('o.tag', 'тег коллизии')];
function schemaFor(s) {
  const it = itemOf(s), T = texList();
  if (s.kind === 'start') return [num('x', 'x'), num('y', 'y'), num('z', 'z'), num('yaw', 'поворот (рад)', .1)];
  if (s.kind === 'enemies') return [selF('type', 'тип', Object.keys(DEFS)), num('x', 'x'), num('z', 'z'), num('y', 'y (этаж)', .1), text('tag', 'тег (для триггеров/правил)'), bool('alerted', 'сразу агрессивен'), num('variant', 'вариант внешности', 1), num('guardR', 'охраняет пост, радиус (0 — гонится везде)', .5)];
  if (s.kind === 'pickups') return [selF('kind', 'вид', PICKUP_KINDS), text('id', 'id'), num('x', 'x'), num('y', 'y (пусто = пол)'), num('z', 'z'), bool('hidden', 'скрыт до showPickup'), num('n', 'сколько (здоровье/патроны)', 1), json('actions', 'действия при подборе')];
  if (s.kind === 'npcs') return [text('id', 'id'), selF('sprite', 'спрайт', ['knight_idle', 'knight_walk0', ...spriteList()]), num('x', 'x'), num('z', 'z'), text('line', 'реплика (npcTalk)'), num('dur', 'длительность, с', .5)];
  if (s.kind === 'triggers') return it.r !== undefined
    ? [num('x', 'x'), num('z', 'z'), num('r', 'радиус'), bool('once', 'один раз'), text('if', 'только при флаге'), text('unless', 'кроме флага'), num('near', 'подсказка с расстояния'), text('nearHint', 'текст подсказки'), json('actions', 'действия')]
    : [num('x0', 'x0'), num('z0', 'z0'), num('x1', 'x1'), num('z1', 'z1'), bool('once', 'один раз'), text('if', 'только при флаге'), text('unless', 'кроме флага'), json('actions', 'действия')];
  switch (it.t) {
    case 'box': return [selF('tex', 'текстура', T), num('x', 'x'), num('y', 'y'), num('z', 'z'), num('w', 'ширина (x)'), num('h', 'высота'), num('d', 'глубина (z)'), num('o.uvScale', 'масштаб текстуры', .1), ...COMMON_O];
    case 'wall': return [selF('tex', 'текстура', T), num('x0', 'x0'), num('z0', 'z0'), num('x1', 'x1'), num('z1', 'z1'), num('y', 'y (низ)'), num('h', 'высота'), num('thick', 'толщина', .05), num('o.uvScale', 'масштаб текстуры', .1), ...COMMON_O];
    case 'cyl': return [selF('tex', 'текстура', T), num('x', 'x'), num('y', 'y'), num('z', 'z'), num('r', 'радиус'), num('h', 'высота'), num('seg', 'сегменты', 1), num('o.r2', 'радиус сверху (конус)'), bool('o.solid', 'перекрытие: по нему можно ходить'), bool('o.emissive', 'самосветящийся')];
    case 'floor': return [selF('tex', 'текстура', T), num('x', 'x'), num('y', 'y'), num('z', 'z'), num('w', 'ширина (x)'), num('d', 'глубина (z)'), bool('o.ceiling', 'потолок (смотрит вниз)'), bool('o.solid', 'перекрытие: по нему можно ходить'), bool('o.emissive', 'самосветящийся')];
    case 'quad': return [selF('tex', 'текстура', T), num('x', 'x (центр)'), num('y', 'y (центр)'), num('z', 'z (центр)'), num('w', 'ширина'), num('h', 'высота'), selF('face', 'куда смотрит', [0, 1, 2, 3]), bool('o.emissive', 'самосветящийся')];
    case 'sprite': return [selF('img', 'картинка', spriteList()), num('x', 'x'), num('y', 'y (низ)'), num('z', 'z'), num('w', 'ширина, м'), num('h', 'высота, м (пусто = по пропорции)'), bool('billboard', 'всегда лицом к игроку'), selF('face', 'куда смотрит (если не биллборд)', [0, 1, 2, 3]), bool('emissive', 'светится'), bool('solid', 'непроходимый')];
    case 'blocker': return [num('x', 'x'), num('y', 'y'), num('z', 'z'), num('w', 'ширина'), num('h', 'высота'), num('d', 'глубина'), text('tag', 'тег')];
    case 'light': return [num('x', 'x'), num('y', 'y'), num('z', 'z'), color('color', 'цвет'), num('i', 'яркость'), num('dist', 'дальность'), num('pulse', 'пульсация (0 — нет)', .5)];
    case 'fire': return [num('x', 'x'), num('y', 'y'), num('z', 'z'), num('size', 'размер'), color('color', 'цвет света'), num('i', 'яркость (пусто = авто)'), num('dist', 'дальность (пусто = авто)')];
    case 'prefab': return [selF('kind', 'префаб', Object.keys(PREFABS)), num('x', 'x'), num('z', 'z'), ...Object.entries(PREFABS[it.kind]?.params || {}).map(([k, v]) => v.type === 'bool' ? bool(`p.${k}`, k) : v.type === 'select' ? selF(`p.${k}`, k, v.options.map((o, i) => (typeof o === 'string' && /^\d \(/.test(o)) ? i : o)) : num(`p.${k}`, k, v.step))];
  }
  return [num('x', 'x'), num('z', 'z')];
}
function showProps() {
  const box = el('props');
  if (!sel) { box.innerHTML = '<p class="dim">Ничего не выбрано.</p>'; return; }
  const it = itemOf(sel);
  const title = sel.kind === 'start' ? 'Старт игрока' : sel.kind === 'objects' ? (it.t === 'prefab' ? `Префаб: ${PREFABS[it.kind]?.name || it.kind}` : `Объект: ${it.t}`) : `${sel.kind}: ${it.type || it.kind || it.id || ''}`;
  box.innerHTML = `<h3>${title}</h3>`;
  box.appendChild(renderForm(schemaFor(sel), it, (key, v) => {
    snapshot(); setPath(it, key, v);
    if (key === 'kind' && it.t === 'prefab') it.p = prefabDefaults(v);
    rebuildSel(); markDirty();
    if (key === 'kind' || key === 'type') showProps();
    refreshList();
  }));
  const acts = document.createElement('div'); acts.className = 'acts';
  acts.innerHTML = `<button data-y="0.5" title="PageUp">▲ выше</button><button data-y="-0.5" title="PageDown">▼ ниже</button>` + (sel.kind !== 'start' ? '<button id="pDup">Дублировать</button><button id="pDel" class="danger">Удалить</button>' : '');
  box.appendChild(acts);
  for (const b of acts.querySelectorAll('[data-y]')) b.onclick = () => { snapshot(); moveSel(0, 0, +b.dataset.y); };
  if (sel.kind !== 'start') { el('pDup').onclick = duplicateSel; el('pDel').onclick = deleteSel; }
}
function renderForm(schema, obj, onChange) {
  const f = document.createElement('div'); f.className = 'form';
  for (const fd of schema) {
    const v = getPath(obj, fd.key);
    const row = document.createElement('label'); row.className = 'row' + (fd.type === 'json' ? ' wide' : '');
    let inp;
    if (fd.type === 'bool') { inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!v; inp.onchange = () => onChange(fd.key, inp.checked); }
    else if (fd.type === 'select') { inp = document.createElement('select'); for (const o of fd.options) { const op = document.createElement('option'); op.value = o; op.textContent = o; op.selected = String(o) === String(v); inp.appendChild(op); } inp.onchange = () => onChange(fd.key, isNaN(+inp.value) || inp.value === '' ? inp.value : +inp.value); }
    else if (fd.type === 'json') { inp = document.createElement('textarea'); inp.value = v === undefined ? '' : JSON.stringify(v, null, 1); inp.rows = Math.min(14, Math.max(3, inp.value.split('\n').length)); inp.onchange = () => { try { onChange(fd.key, inp.value.trim() ? JSON.parse(inp.value) : undefined); inp.classList.remove('err'); } catch (e) { inp.classList.add('err'); } }; }
    else if (fd.type === 'color') { inp = document.createElement('input'); inp.type = 'color'; inp.value = typeof v === 'number' ? '#' + v.toString(16).padStart(6, '0') : (v || '#ffffff'); inp.onchange = () => onChange(fd.key, inp.value); }
    else if (fd.type === 'number') { inp = document.createElement('input'); inp.type = 'number'; inp.step = fd.step || .1; inp.value = v ?? ''; inp.onchange = () => onChange(fd.key, inp.value === '' ? undefined : +inp.value); }
    else { inp = document.createElement('input'); inp.type = 'text'; inp.value = v ?? ''; inp.onchange = () => onChange(fd.key, inp.value === '' ? undefined : inp.value); }
    const span = document.createElement('span'); span.textContent = fd.label;
    row.appendChild(span); row.appendChild(inp); f.appendChild(row);
  }
  return f;
}
function showLevelProps() {
  const box = el('levelProps');
  box.innerHTML = '<h3>Уровень</h3>';
  const schema = [text('name', 'название'), selF('env', 'окружение', Object.keys(level.envs)), text('objective', 'цель при старте'), text('intro.msg', 'сообщение при старте'), text('intro.hint', 'подсказка при старте'), text('next', 'следующий уровень (id)'), text('winText', 'текст на экране победы'),
    num('bounds.x0', 'границы x0', 1), num('bounds.z0', 'границы z0', 1), num('bounds.x1', 'границы x1', 1), num('bounds.z1', 'границы z1', 1), num('floorH', 'высота этажа, м', .1),
    json('envs', 'окружения (небо, туман, свет)'), json('rules', 'правила (kill / clear / pickup)')];
  box.appendChild(renderForm(schema, level, (key, v) => { snapshot(); setPath(level, key, v); if (key.startsWith('bounds')) buildBounds(); if (key === 'envs') showLevelProps(); markDirty(); el('levelTitle').textContent = `${level.name} (${level.id})`; }));
  const p = document.createElement('p'); p.className = 'dim'; p.innerHTML = `id: <code>${level.id}</code> · объектов ${level.objects.length}, врагов ${level.enemies.length}, предметов ${level.pickups.length}, триггеров ${level.triggers.length} · своих текстур: ${CUSTOM_TEX.length}`;
  box.appendChild(p);
}

/* ─── список ─── */
function refreshList() {
  const box = el('list'); const q = el('filter').value.toLowerCase();
  box.innerHTML = '';
  const add = (kind, i, label) => {
    if (q && !label.toLowerCase().includes(q)) return;
    const d = document.createElement('div'); d.className = 'li ' + kind; d.textContent = label; d.dataset.k = keyOf(kind, i);
    d.onclick = () => { select({ kind, i }); focusSel(false); };
    box.appendChild(d);
  };
  add('start', 0, 'старт игрока');
  level.objects.forEach((o, i) => add('objects', i, o.t === 'prefab' ? `${PREFABS[o.kind]?.name || o.kind} @${o.x},${o.z}` : o.t === 'wall' ? `стена ${o.tex} ${o.x0},${o.z0}→${o.x1},${o.z1}` : `${o.t} ${o.tex || o.img || ''} @${o.x},${o.z}`));
  level.enemies.forEach((e, i) => add('enemies', i, `враг ${e.type}${e.tag ? ' #' + e.tag : ''} @${e.x},${e.z}`));
  level.pickups.forEach((p, i) => add('pickups', i, `предмет ${p.kind}${p.id ? ' #' + p.id : ''} @${p.x},${p.z}`));
  level.npcs.forEach((n, i) => add('npcs', i, `NPC ${n.id || ''} @${n.x},${n.z}`));
  level.triggers.forEach((t, i) => add('triggers', i, `триггер ${i}: ${(t.actions || []).map(a => a.a).join(', ')}`));
  refreshListSel();
}
function refreshListSel() { for (const d of el('list').children) d.classList.toggle('on', !!sel && d.dataset.k === keyOf(sel.kind, sel.i)); el('list').querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
el('filter').oninput = refreshList;
function focusSel(all = true) {
  const grp = selGroup(); if (!grp) return;
  const b = new THREE.Box3().setFromObject(grp); if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
  const dist = Math.max(4, Math.max(s.x, s.y, s.z) * 1.6);
  cam.cx = c.x; cam.cz = c.z; if (all) cam.zoom = Math.max(4, Math.max(s.x, s.z));
  const d = camDir(); cam.px = c.x - d.x * dist; cam.py = c.y - d.y * dist; cam.pz = c.z - d.z * dist;
  updateCamera();
}

/* ─── ввод ─── */
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const keysDown = new Set();
let drag = null, lastCursor = null;
const pointerToNDC = e => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
function groundPoint(e, y = placeY()) { ray.setFromCamera(pointerToNDC(e), activeCam()); const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y); const p = new THREE.Vector3(); return ray.ray.intersectPlane(pl, p) ? p : null; }
function snapV(v) { if (!el('snap').checked || keysDown.has('ShiftLeft')) return R(v); const s = +el('snapSize').value; return R(Math.round(v / s) * s); }
function pickAt(e) {
  ray.setFromCamera(pointerToNDC(e), activeCam());
  const hits = ray.intersectObjects([...root.children, ...markers.children], true);
  for (const h of hits) { let o = h.object; while (o && !o.userData.ref) o = o.parent; if (o?.userData.ref) return { ref: o.userData.ref, point: h.point }; }
  return null;
}
// точка, вокруг которой крутимся: выбранное или точка под курсором
function orbitPivot(e) {
  const grp = selGroup();
  if (grp) { const b = new THREE.Box3().setFromObject(grp); if (!b.isEmpty()) return b.getCenter(new THREE.Vector3()); }
  const h = pickAt(e); if (h) return h.point;
  return groundPoint(e) || new THREE.Vector3(cam.px, 0, cam.pz);
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); canvas.focus();
  if (e.button === 1) { drag = { mode: 'pan', x: e.clientX, y: e.clientY, gp: groundPoint(e, camMode === 'top' ? 0 : 0) }; return; }
  if (e.button === 2) { drag = { mode: camMode === 'top' ? 'pan' : 'look', x: e.clientX, y: e.clientY }; return; }
  if (e.button !== 0) return;
  if (e.altKey && camMode !== 'top') { const pv = orbitPivot(e); drag = { mode: 'orbit', x: e.clientX, y: e.clientY, pivot: pv, dist: pv.distanceTo(persp.position) }; return; }
  const gp = groundPoint(e);
  if (tool === 'wall') {
    if (!gp) return;
    const pt = [snapV(gp.x), snapV(gp.z)];
    // клик по первой точке замыкает фигуру
    if (nearFirst(pt)) { finishWall(true); return; }
    // двойной клик заканчивает: у pointerdown e.detail всегда 0, считаем сами
    const now = performance.now();
    if (wallPts.length && now - lastWallClick.t < 350 && Math.hypot(pt[0] - lastWallClick.p[0], pt[1] - lastWallClick.p[1]) < .01) { finishWall(false); return; }
    lastWallClick = { t: now, p: pt };
    wallPts.push(pt); drawWallPreview(pt); renderToolOpts(); return;
  }
  if (tool !== 'select') {
    if (!gp) return;
    if (tool === 'start') { snapshot(); level.start.x = snapV(gp.x); level.start.z = snapV(gp.z); buildStart(); select({ kind: 'start', i: 0 }); markDirty(); return; }
    const made = newItemFor(tool, snapV(gp.x), snapV(gp.z));
    if (made) addItem(made[0], made[1]);
    return;
  }
  const h = pickAt(e);
  if (h) {
    select(h.ref);
    const it = itemOf(h.ref);
    drag = { mode: 'move', startY: e.clientY, start: groundPoint(e, h.point.y) || h.point.clone(), planeY: h.point.y, orig: JSON.parse(JSON.stringify(it)), moved: false, vertical: e.altKey };
  } else select(null);
});
canvas.addEventListener('pointermove', e => {
  if (tool === 'wall' && wallPts.length && !drag) { const gp = groundPoint(e); if (gp) drawWallPreview([snapV(gp.x), snapV(gp.z)]); }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (drag.mode === 'look') { drag.x = e.clientX; drag.y = e.clientY; cam.yaw -= dx * .0045; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - dy * .0045)); updateCamera(); return; }
  if (drag.mode === 'pan') {
    drag.x = e.clientX; drag.y = e.clientY;
    if (camMode === 'top') { const k = (2 * cam.zoom) / canvas.clientHeight; cam.cx -= dx * k; cam.cz -= dy * k; }
    else { const k = Math.max(.5, drag.gp ? drag.gp.distanceTo(persp.position) : 10) * .0018; const r = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)), u = new THREE.Vector3(0, 1, 0).applyEuler(persp.rotation); cam.px -= r.x * dx * k; cam.pz -= r.z * dx * k; cam.px += u.x * dy * k; cam.py += u.y * dy * k; cam.pz += u.z * dy * k; }
    updateCamera(); return;
  }
  if (drag.mode === 'orbit') {
    drag.x = e.clientX; drag.y = e.clientY;
    cam.yaw -= dx * .006; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - dy * .006));
    const d = camDir(); cam.px = drag.pivot.x - d.x * drag.dist; cam.py = drag.pivot.y - d.y * drag.dist; cam.pz = drag.pivot.z - d.z * drag.dist;
    updateCamera(); return;
  }
  if (drag.mode === 'move' && sel) {
    const it = itemOf(sel), o = drag.orig;
    if (drag.vertical) {
      const ndy = snapV(-(e.clientY - drag.startY) * .02);
      if (!drag.moved) { snapshot(); drag.moved = true; }
      it.y = R(Math.max(-5, (o.y || 0) + ndy)); rebuildSel(); markDirty(); return;
    }
    const gp = groundPoint(e, drag.planeY); if (!gp) return;
    const mx = snapV(gp.x - drag.start.x), mz = snapV(gp.z - drag.start.z);
    if (Math.abs(mx) < 1e-6 && Math.abs(mz) < 1e-6) return;
    if (!drag.moved) { snapshot(); drag.moved = true; }
    if (o.x0 !== undefined) { it.x0 = R(o.x0 + mx); it.x1 = R(o.x1 + mx); it.z0 = R(o.z0 + mz); it.z1 = R(o.z1 + mz); }
    else { it.x = R(o.x + mx); it.z = R(o.z + mz); }
    rebuildSel(); markDirty();
  }
});
canvas.addEventListener('pointerup', () => { if (drag?.mode === 'move' && drag.moved) { showProps(); refreshList(); } drag = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (camMode === 'top') {
    // масштаб к курсору
    const before = groundPoint(e);
    cam.zoom = Math.max(2, Math.min(200, cam.zoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    updateCamera();
    const after = groundPoint(e);
    if (before && after) { cam.cx += before.x - after.x; cam.cz += before.z - after.z; updateCamera(); }
  } else {
    ray.setFromCamera(pointerToNDC(e), persp);
    const h = pickAt(e); const target = h ? h.point : (groundPoint(e) || null);
    const dist = target ? target.distanceTo(persp.position) : 10;
    const k = (e.deltaY > 0 ? -1 : 1) * Math.max(.4, dist * .18);
    const d = ray.ray.direction;
    cam.px += d.x * k; cam.py += d.y * k; cam.pz += d.z * k;
    updateCamera();
  }
}, { passive: false });
window.addEventListener('keydown', e => {
  keysDown.add(e.code);
  const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); save(true); return; }
  if (inField) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) { e.preventDefault(); doRedo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') { e.preventDefault(); duplicateSel(); return; }
  if (tool === 'wall' && wallPts.length) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); finishWall(false); return; }
    if (e.code === 'KeyC') { e.preventDefault(); finishWall(true); return; }
    if (e.code === 'Backspace') { e.preventDefault(); undoWallPoint(); return; }
  }
  if (e.code === 'Delete' || e.code === 'Backspace') { deleteSel(); return; }
  if (e.code === 'Escape') { if (tool === 'wall' && wallPts.length) { cancelWall(); return; } setTool('select'); select(null); return; }
  if (e.code === 'KeyT') { toggleCam(); return; }
  if (e.code === 'KeyF') { focusSel(true); return; }
  if (e.code === 'Space') e.preventDefault();
  const s = +el('snapSize').value;
  if (e.code === 'ArrowLeft') { e.preventDefault(); snapshot(); moveSel(-s, 0); } if (e.code === 'ArrowRight') { e.preventDefault(); snapshot(); moveSel(s, 0); }
  if (e.code === 'ArrowUp') { e.preventDefault(); snapshot(); moveSel(0, -s); } if (e.code === 'ArrowDown') { e.preventDefault(); snapshot(); moveSel(0, s); }
  if (e.code === 'PageUp') { e.preventDefault(); snapshot(); moveSel(0, 0, s); } if (e.code === 'PageDown') { e.preventDefault(); snapshot(); moveSel(0, 0, -s); }
});
window.addEventListener('keyup', e => keysDown.delete(e.code));
function toggleCam() {
  if (camMode === 'fly') { camMode = 'top'; cam.cx = cam.px - Math.sin(cam.yaw) * 6; cam.cz = cam.pz - Math.cos(cam.yaw) * 6; }
  else { camMode = 'fly'; cam.px = cam.cx + 6; cam.py = Math.max(6, cam.zoom * .8); cam.pz = cam.cz + 10; cam.yaw = Math.atan2(-(cam.cx - cam.px), -(cam.cz - cam.pz)); cam.pitch = -.6; }
  el('camMode').textContent = camMode === 'top' ? 'Камера: сверху (T)' : 'Камера: полёт (T)';
  updateCamera();
}
el('camMode').onclick = toggleCam;

/* ─── отмена, сохранение ─── */
function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(level)); level = JSON.parse(undo.pop()); sel = null; buildAll(); showProps(); showLevelProps(); markDirty(); }
function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(level)); level = JSON.parse(redo.pop()); sel = null; buildAll(); showProps(); showLevelProps(); markDirty(); }
el('undo').onclick = doUndo; el('redo').onclick = doRedo;
async function save() {
  // окружения, совпадающие с общими (levelloader.DEFAULT_ENVS), в файл не пишем:
  // иначе уровень «замораживает» стиль и перестаёт подхватывать общие правки
  const same = JSON.stringify;
  for (const [k, v] of Object.entries(level.envs || {})) if (DEFAULT_ENVS[k] && same(v) === same(DEFAULT_ENVS[k])) delete level.envs[k];
  saveLevelLocal(level);
  const where = await saveLevelToProject(level);
  dirty = false;
  el('status').textContent = where === 'project' ? `сохранено в проект (public/levels/${level.id}.json)` : where === 'electron' ? 'сохранено в папку пользователя' : 'сохранено в браузере (dev-сервер недоступен — используйте Экспорт)';
}
// сетка поднимается на выбранный этаж — видно, куда встанут объекты
el('floorSel').onchange = () => { const y = placeY(); grid.position.y = y + .005; grid10.position.y = y + .006; renderToolOpts(); };
el('save').onclick = () => save(true);
el('exportBtn').onclick = () => exportLevel(level);
el('importBtn').onclick = async () => { try { const d = await importLevel(); snapshot(); level = { ...d, id: level.id }; buildAll(); showLevelProps(); markDirty(); } catch (e) { alert(e.message); } };
el('playBtn').href = `./game.html?level=${encodeURIComponent(LEVEL_ID)}&mode=play&autostart=1`;
el('sandboxBtn').href = `./game.html?level=${encodeURIComponent(LEVEL_ID)}&mode=sandbox&autostart=1`;
for (const a of [el('playBtn'), el('sandboxBtn')]) a.addEventListener('click', () => save(true));
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => { for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b); for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.id === (b.dataset.tab === 'level' ? 'levelProps' : b.dataset.tab)); };
el('actionsHelp').textContent = Object.entries(ACTIONS).map(([k, v]) => `${k}: ${v}`).join('\n');
window.addEventListener('beforeunload', () => { if (dirty) save(false); });

/* ─── цикл ─── */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (camMode === 'fly' && !inField) {
    const sp = (keysDown.has('ShiftLeft') ? 34 : 11) * dt;
    const f = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)), r = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    let mv = false;
    if (keysDown.has('KeyW')) { cam.px += f.x * sp; cam.pz += f.z * sp; mv = true; } if (keysDown.has('KeyS')) { cam.px -= f.x * sp; cam.pz -= f.z * sp; mv = true; }
    if (keysDown.has('KeyA')) { cam.px -= r.x * sp; cam.pz -= r.z * sp; mv = true; } if (keysDown.has('KeyD')) { cam.px += r.x * sp; cam.pz += r.z * sp; mv = true; }
    if (keysDown.has('KeyE')) { cam.py += sp; mv = true; } if (keysDown.has('KeyQ')) { cam.py -= sp; mv = true; }
    if (mv) updateCamera();
  }
  const camPos = activeCam().position;
  for (const grp of markers.children) for (const m of grp.children) if (m.name === 'bb') {
    if (camMode === 'fly') { m.rotation.set(0, Math.atan2(camPos.x - grp.position.x, camPos.z - grp.position.z), 0); m.position.z = 0; }
    else { m.rotation.set(-Math.PI / 2 + .001, 0, 0); m.position.z = m.geometry.parameters.height / 2; }
  }
  renderer.render(scene, activeCam());
}
el('levelTitle').textContent = `${level.name} (${level.id})`;
el('camMode').textContent = 'Камера: полёт (T)';
renderPalette(); buildAll(); showLevelProps(); resize(); updateCamera();
requestAnimationFrame(frame);
window.editor = { get level() { return level; }, buildAll, select, get sel() { return sel; }, cam, updateCamera, toggleCam, get camMode() { return camMode; }, setTool, finishWall, get wallPts() { return wallPts; }, toolOpts };
