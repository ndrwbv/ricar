/* Описания врагов: папка на врага — public/enemies/<name>/enemy.json + его картинки
   (лист спрайтов, вещи в drops/, свои куски в gibs/). Старая плоская раскладка
   (<name>.json + <name>.png рядом с остальными) тоже читается.
   Лист спрайтов: кадры по горизонтали, варианты внешности по вертикали.
   Если JSON/PNG нет или не загрузились — берётся встроенное описание и
   процедурные спрайты из sprites.js (они уже лежат в SPR под теми же именами).
   Формат JSON описан в docs/ENEMIES.md. */
import * as THREE from 'three';
import { SPR, PROC } from './sprites.js';
import { makeCanvas, sharpFilter } from './textures.js';
import { partBoxes } from './enemies.js';
import { ENEMY_TYPES } from './prefabs.js';

export const DEFS = {};

// встроенные описания — то же, что лежит в public/enemies/*.json
const BUILTIN = {
  peasant: {
    name: 'peasant', sheet: 'sheet.png', frameW: 128, frameH: 176, variants: 3,
    size: [1.44, 1.95], radius: 0.5,
    frames: { walk0: 0, walk1: 1, attack: 2, pain: 3, headless: 4, crouch: 5, surrender: 6, knife: 7, hop0: 8, hop1: 9, crawl0: 10, crawl1: 11, dead: 12, deadHeadless: 13 },
    anims: { idle: { frames: ['walk0'] }, walk: { frames: ['walk0', 'walk1'], fps: 7 }, attack: { frames: ['attack'] }, pain: { frames: ['pain'] }, headless: { frames: ['headless'] }, crouch: { frames: ['crouch'] }, surrender: { frames: ['surrender'] }, knife: { frames: ['knife'] }, hop: { frames: ['hop0', 'hop1'], fps: 4 }, crawl: { frames: ['crawl0', 'crawl1'], fps: 2.5 } },
    stats: { hp: 70, speed: 3.9, alertR: 16, female: false, melee: { range: 2.0, dmg: 10, windup: .65, cooldown: 1.3 }, flank: [0, 0, 0.9, -0.9, 1.7, -1.7, 3.1], tactics: { cover: .25, surrender: .5, fake: .45, knifeDmg: 22 } },
    colors: { body: '#6a4a2a', legs: '#3a3020', skin: '#c8956a', hair: '#2a2018' },
    gibs: 'male', head: 'male', gibExtra: ['gib_hat'],
    // после крестьянина остаются его вилы и сбитая шляпа — больше ничего
    drop: { items: [{ sprite: 'gib_fork', w: .75 }, { sprite: 'gib_hat', w: .38, chance: .5 }] },
  },
  woman: {
    name: 'woman', sheet: 'sheet.png', frameW: 136, frameH: 192, variants: 3,
    size: [1.52, 2.15], radius: 0.5,
    frames: { walk0: 0, walk1: 1, attack: 2, pain: 3, headless: 4, crouch: 5, surrender: 6, knife: 7, hop0: 8, hop1: 9, crawl0: 10, crawl1: 11, dead: 12, deadHeadless: 13 },
    anims: { idle: { frames: ['walk0'] }, walk: { frames: ['walk0', 'walk1'], fps: 7 }, attack: { frames: ['attack'] }, pain: { frames: ['pain'] }, headless: { frames: ['headless'] }, crouch: { frames: ['crouch'] }, surrender: { frames: ['surrender'] }, knife: { frames: ['knife'] }, hop: { frames: ['hop0', 'hop1'], fps: 4 }, crawl: { frames: ['crawl0', 'crawl1'], fps: 2.5 } },
    stats: { hp: 110, speed: 4.8, alertR: 24, female: true, ranged: { range: 26, burst: 3, gap: .085, dmg: 7, aim: .45, cooldown: 1.3, spread: .05 }, prefer: [6, 13], flank: [0, 0.7, -0.7, 1.4, -1.4], tactics: { cover: .8, surrender: .3, fake: .6, knifeDmg: 26 } },
    colors: { body: '#1c1c22', legs: '#1c1c22', skin: '#e8b898', hair: '#1a1a1a' },
    gibs: 'female', head: 'female',
    // стрелок роняет свой ствол: он крутится в воздухе и его можно подобрать
    drop: { weapon: { kind: 'gun', model: 'pistol', n: 12 } },
  },
  claw: {
    name: 'claw', sheet: 'sheet.png', frameW: 136, frameH: 192, variants: 2,
    size: [1.52, 2.12], radius: 0.5,
    frames: { walk0: 0, walk1: 1, attack: 2, pain: 3, headless: 4, crouch: 5, surrender: 6, knife: 7, hop0: 8, hop1: 9, crawl0: 10, crawl1: 11, dead: 12, deadHeadless: 13 },
    anims: { idle: { frames: ['walk0'] }, walk: { frames: ['walk0', 'walk1'], fps: 9 }, attack: { frames: ['attack'] }, pain: { frames: ['pain'] }, headless: { frames: ['headless'] }, crouch: { frames: ['crouch'] }, surrender: { frames: ['surrender'] }, knife: { frames: ['knife'] }, hop: { frames: ['hop0', 'hop1'], fps: 4 }, crawl: { frames: ['crawl0', 'crawl1'], fps: 2.5 } },
    stats: { hp: 85, speed: 6.8, alertR: 24, female: true, melee: { range: 2.1, dmg: 15, windup: .32, cooldown: .7 }, lunge: true, flank: [1.6, -1.6, 2.4, -2.4, 3.1, 0], tactics: { cover: 0, surrender: 0, fake: 0, knifeDmg: 20 } },
    colors: { body: '#1a2a4a', legs: '#1a2a4a', skin: '#e8b898', hair: '#1a1a1a' },
    gibs: 'female', head: 'female',
  },
  guard: {
    name: 'guard', sheet: 'sheet.png', frameW: 132, frameH: 184, variants: 3,
    size: [1.48, 2.05], radius: 0.52,
    frames: { walk0: 0, walk1: 1, attack: 2, pain: 3, headless: 4, crouch: 5, surrender: 6, knife: 7, hop0: 8, hop1: 9, crawl0: 10, crawl1: 11, dead: 12, deadHeadless: 13 },
    anims: { idle: { frames: ['walk0'] }, walk: { frames: ['walk0', 'walk1'], fps: 6 }, attack: { frames: ['attack'] }, pain: { frames: ['pain'] }, headless: { frames: ['headless'] }, crouch: { frames: ['crouch'] }, surrender: { frames: ['surrender'] }, knife: { frames: ['knife'] }, hop: { frames: ['hop0', 'hop1'], fps: 4 }, crawl: { frames: ['crawl0', 'crawl1'], fps: 2.5 } },
    stats: {
      hp: 95, armor: .15, speed: 3.4, alertR: 20, female: false,
      melee: { range: 2.1, dmg: 14, windup: .55, cooldown: 1.1 },
      // щит держит фиксированный урон, потом разлетается; закрывает корпус и одну руку
      shield: { hits: 6, frames: 4, parry: .35, img: 'shield.png', arm: 'armR', w: .78, off: [.17, .46] },
      flank: [0, 0, 0.6, -0.6, 1.2],
      tactics: { cover: .35, surrender: .2, fake: .7, knifeDmg: 24 },
    },
    colors: { body: '#2a3448', legs: '#2a2a32', skin: '#c8956a', hair: '#2a2018' },
    gibs: 'male', head: 'male',
    drop: { items: [{ sprite: 'gib_knife', w: .5 }] },
  },
  /* ── лучник ── бьёт издалека и прячется; вблизи почти беспомощен.
     Отстрелить ему руку — значит лишить лука. */
  archer: {
    name: 'archer', sheet: 'sheet.png', frameW: 128, frameH: 176, variants: 3,
    size: [1.40, 1.88], radius: 0.46,
    frames: { walk0: 0, walk1: 1, attack: 2, pain: 3, headless: 4, crouch: 5, surrender: 6, knife: 7, hop0: 8, hop1: 9, crawl0: 10, crawl1: 11, dead: 12, deadHeadless: 13 },
    anims: { idle: { frames: ['walk0'] }, walk: { frames: ['walk0', 'walk1'], fps: 7 }, attack: { frames: ['attack'] }, pain: { frames: ['pain'] }, headless: { frames: ['headless'] }, crouch: { frames: ['crouch'] }, surrender: { frames: ['surrender'] }, knife: { frames: ['knife'] }, hop: { frames: ['hop0', 'hop1'], fps: 4 }, crawl: { frames: ['crawl0', 'crawl1'], fps: 2.5 } },
    stats: {
      hp: 80, speed: 4.2, alertR: 28, female: false,
      ranged: { range: 30, burst: 1, gap: .1, dmg: 22, aim: .85, cooldown: 2.3, spread: .025 },
      prefer: [11, 20],
      flank: [0, 0.9, -0.9, 1.6, -1.6],
      tactics: { cover: .8, surrender: .4, fake: .35, knifeDmg: 16 },
    },
    colors: { body: '#3a4a32', legs: '#2f2a22', skin: '#c8956a', hair: '#2a2018' },
    gibs: 'male', head: 'male',
  },
  /* ── громила ── медленный таран с кувалдой: держит удар, но не догонит бегущего.
     Конечности крепче обычных — руку отрубают за два тяжёлых замаха. */
  brute: {
    name: 'brute', sheet: 'sheet.png', frameW: 152, frameH: 184, variants: 2,
    size: [1.74, 2.10], radius: 0.62,
    frames: { walk0: 0, walk1: 1, attack: 2, pain: 3, headless: 4, crouch: 5, surrender: 6, knife: 7, hop0: 8, hop1: 9, crawl0: 10, crawl1: 11, dead: 12, deadHeadless: 13 },
    anims: { idle: { frames: ['walk0'] }, walk: { frames: ['walk0', 'walk1'], fps: 7 }, attack: { frames: ['attack'] }, pain: { frames: ['pain'] }, headless: { frames: ['headless'] }, crouch: { frames: ['crouch'] }, surrender: { frames: ['surrender'] }, knife: { frames: ['knife'] }, hop: { frames: ['hop0', 'hop1'], fps: 4 }, crawl: { frames: ['crawl0', 'crawl1'], fps: 2.5 } },
    stats: {
      hp: 200, armor: .35, speed: 2.9, alertR: 20, female: false,
      melee: { range: 2.7, dmg: 30, windup: .95, cooldown: 1.9 },
      partHp: 2.2,
      flank: [0, 0, 0.4, -0.4],
      tactics: { cover: .05, surrender: .05, fake: .85, knifeDmg: 30 },
    },
    parts: {
      // железные пластины: клинок по ним скользит, зато дробь в упор рвёт стыки
      armL: { factor: { cut: 2.0, melee: 1.0, bullet: 0.7, shotgun: 1.2 } },
      armR: { factor: { cut: 2.0, melee: 1.0, bullet: 0.7, shotgun: 1.2 } },
      legL: { factor: { cut: 2.6, melee: 1.2, bullet: 0.85, shotgun: 1.3 } },
      legR: { factor: { cut: 2.6, melee: 1.2, bullet: 0.85, shotgun: 1.3 } },
    },
    colors: { body: '#4a2a22', legs: '#2a241c', skin: '#b8865c', hair: '#1a1410' },
    gibs: 'male', head: 'male',
  },
  /* ── пёс ── быстрый низкий зверь: кидается в прыжке и кружит.
     Рук у него нет, зоны рук отключены; ноги отстреливаются — тогда он ползёт. */
  hound: {
    name: 'hound', sheet: 'sheet.png', frameW: 144, frameH: 104, variants: 3,
    size: [1.52, 1.10], radius: 0.44,
    frames: { walk0: 0, walk1: 1, attack: 2, pain: 3, headless: 4, hop0: 5, hop1: 6, crawl0: 7, crawl1: 8, dead: 9 },
    anims: {
      idle: { frames: ['walk0'] }, walk: { frames: ['walk0', 'walk1'], fps: 11 },
      attack: { frames: ['attack'] }, pain: { frames: ['pain'] }, headless: { frames: ['headless'] },
      hop: { frames: ['hop0', 'hop1'], fps: 6 }, crawl: { frames: ['crawl0', 'crawl1'], fps: 3 },
    },
    parts: {
      head: [0.04, 0.10, 0.34, 0.52],
      armL: null, armR: null,
      legL: [0.14, 0.56, 0.34, 1.00],
      legR: [0.44, 0.58, 0.66, 1.00],
    },
    stats: {
      hp: 55, speed: 8.4, alertR: 30, female: false,
      melee: { range: 1.9, dmg: 13, windup: .26, cooldown: .6 }, lunge: true,
      flank: [1.4, -1.4, 2.4, -2.4, 0],
      tactics: { cover: 0, surrender: 0, fake: 0, knifeDmg: 0 },
    },
    colors: { body: '#4a3a2e', legs: '#3a2e24', skin: '#8a6a4a', hair: '#2a2018' },
    gibs: 'male', head: null,        // морда зверя — не человеческая голова, летит череп
  },
};

function toTex(c) { return sharpFilter(new THREE.CanvasTexture(c)); }

// нарезать лист на кадры и положить в SPR под именами `${name}${variant}_${frame}`
function slice(def, img) {
  const cols = Object.values(def.frames).reduce((m, i) => Math.max(m, i + 1), 0);
  const variants = Math.max(1, Math.min(def.variants, Math.floor(img.height / def.frameH)));
  def.variants = variants;
  for (let v = 0; v < variants; v++) for (const [fname, idx] of Object.entries(def.frames)) {
    if (idx >= cols || (idx + 1) * def.frameW > img.width) continue;
    const c = makeCanvas(def.frameW, def.frameH);
    c.getContext('2d').drawImage(img, idx * def.frameW, v * def.frameH, def.frameW, def.frameH, 0, 0, def.frameW, def.frameH);
    SPR[`${def.name}${v}_${fname}`] = { tex: toTex(c), canvas: c, w: c.width, h: c.height };
  }
}

const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/* Список врагов берётся из public/enemies/index.json — чтобы добавить своего,
   достаточно положить рядом <name>.png + <name>.json и вписать имя в этот список.
   Встроенные описания остаются запасным вариантом, если PNG не загрузился. */
async function enemyNames(base) {
  /* index.json — единственный список врагов игры: кого там нет, того в игре нет.
     Так можно выключить любого, не удаляя его файлы. Встроенные описания
     (BUILTIN) остаются запасным вариантом на случай, если списка нет вовсе. */
  try {
    const r = await fetch(`${base}index.json`, { cache: 'no-cache' });
    if (r.ok) {
      const list = (await r.json()).map(it => it?.name).filter(Boolean);
      if (list.length) return list;
    }
  } catch (e) { /* списка нет — падаем на встроенных */ }
  return Object.keys(BUILTIN);
}

/* ═══ что остаётся после врага ═══
   `drop.items` — вещи, которые ложатся картинкой рядом с телом (шляпа, вилы,
   гильзы: у каждого своё), `drop.weapon` — оружие, которое можно подобрать.
   Ничего не задано — после врага не остаётся ничего: общего мусора, одинакового
   для всех, больше нет. */
function normalizeDrop(def) {
  const src = def.drop;
  const d = src && !Array.isArray(src) && typeof src === 'object' ? { ...src } : {};
  d.items = (Array.isArray(src) ? src : d.items || []).map(it => typeof it === 'string' ? { sprite: it } : { ...it });
  if (typeof d.weapon === 'string') d.weapon = { kind: d.weapon };
  // старое `stats.drop: "gib_fork"` — та же вещь, только записанная одной строкой
  const legacy = def.stats?.drop;
  if (legacy && !d.items.length && !d.weapon) d.items.push({ sprite: legacy });
  def.drop = d;
}

// положить PNG в SPR под своим именем (имя врага в ключе — чтобы не затирать общие куски)
async function loadInto(url, key) {
  try {
    const img = await loadImg(url);
    const c = makeCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    SPR[key] = { tex: toTex(c), canvas: c, w: c.width, h: c.height };
    return true;
  } catch (e) { console.warn(`картинка ${url} не загрузилась`); return false; }
}

/* Свои картинки врага: вещи из `drop` и, если нужно, свои куски тела
   (`gibFiles`). Расчленёнка по умолчанию общая для всех — мясо, кости,
   конечности; здесь её можно заменить поштучно, не трогая остальных. */
async function loadOwnArt(def, base) {
  const dir = def.dir || base;
  const things = [...def.drop.items, ...(def.drop.weapon ? [def.drop.weapon] : [])];
  for (const it of things) {
    it.spr = it.sprite || null;
    if (it.file) {
      const key = `${def.name}:${it.sprite || it.file.replace(/.*\//, '').replace(/\.png$/i, '')}`;
      if (await loadInto(`${dir}${it.file}`, key)) it.spr = key;
    }
    if (it.spr && !SPR[it.spr]) { console.warn(`враг ${def.name}: вещи ${it.spr} нет ни картинкой, ни спрайтом`); it.spr = null; }
  }
  def.drop.items = def.drop.items.filter(it => it.spr);
  if (def.gibFiles) {
    def.gibMap = {};
    for (const [n, file] of Object.entries(def.gibFiles)) {
      const key = `${def.name}:${n}`;
      if (await loadInto(`${dir}${file}`, key)) def.gibMap[n] = key;
    }
  }
}

/* Описание врага ищем сначала в его папке (public/enemies/<name>/enemy.json),
   потом в старой плоской раскладке (<name>.json рядом с остальными). Папка —
   основной вариант: в ней лежит всё, что есть у этого врага, и ничего чужого. */
async function findDef(base, name) {
  for (const [dir, file] of [[`${base}${name}/`, 'enemy.json'], [base, `${name}.json`]]) {
    try {
      const r = await fetch(`${dir}${file}`, { cache: 'no-cache' });
      if (r.ok) return { dir, json: await r.json() };
    } catch (e) { /* нет — пробуем следующую раскладку */ }
  }
  return null;
}

export async function loadEnemyDefs(base = './enemies/') {
  for (const name of await enemyNames(base)) {
    let def = BUILTIN[name] ? structuredClone(BUILTIN[name]) : { name, variants: 1, source: 'json' };
    def.source = BUILTIN[name] ? 'builtin' : 'json';
    def.dir = base;
    const found = await findDef(base, name);
    if (found) {
      const j = found.json;
      def = { ...def, ...j, parts: j.parts || def.parts, stats: { ...def.stats, ...(j.stats || {}) }, anims: { ...def.anims, ...(j.anims || {}) }, frames: j.frames || def.frames, colors: { ...def.colors, ...(j.colors || {}) } };
      def.dir = found.dir; def.source = 'json';
      // в своей папке лист зовётся sheet.png, в старой плоской раскладке — <name>.png
      const sheetFile = j.sheet || (found.dir === base ? `${name}.png` : 'sheet.png');
      try {
        slice(def, await loadImg(`${found.dir}${sheetFile}`));
        def.source = 'json+png';
      } catch (e) {
        console.warn(`враг ${name}: лист ${sheetFile} не загрузился, используется встроенный (${e.message || e})`);
      }
    }
    if (!BUILTIN[name] && def.source !== 'json+png') { console.warn(`враг ${name}: нет ${name}/enemy.json + листа — пропущен`); continue; }
    normalizeDrop(def);
    await loadOwnArt(def, base);
    DEFS[name] = def;
  }
  /* Щиты — отдельные PNG: сначала ищем в папке врага, потом среди общих
     (public/enemies/shield.png). Путь указан в stats.shield.img. Не загрузился —
     остаётся процедурный щит из sprites.js. */
  const imgs = new Map();
  for (const d of Object.values(DEFS)) if (d.stats?.shield?.img) imgs.set(d.stats.shield.img, d.dir || base);
  for (const [file, dir] of imgs) {
    const frames = Math.max(1, framesOf(file));
    try {
      const img = await loadImg(`${dir}${file}`).catch(() => loadImg(`${base}${file}`));
      const fw = Math.floor(img.width / frames);
      for (let i = 0; i < frames; i++) {
        const c = makeCanvas(fw, img.height);
        c.getContext('2d').drawImage(img, i * fw, 0, fw, img.height, 0, 0, fw, img.height);
        SPR[`shield:${file}#${i}`] = { tex: toTex(c), canvas: c, w: c.width, h: c.height };
      }
    } catch (e) { console.warn(`щит ${file} не загрузился, берётся процедурный`); }
  }
  function framesOf(file) { for (const d of Object.values(DEFS)) if (d.stats?.shield?.img === file) return d.stats.shield.frames || 1; return 1; }
  ENEMY_TYPES.length = 0;
  ENEMY_TYPES.push(...Object.keys(DEFS), 'любой');
  console.log('враги:', Object.values(DEFS).map(d => `${d.name}(${d.source}, ${d.variants} вар.)`).join(', '));
  return DEFS;
}

/* ═══ куски тел ═══
   Летящие руки, головы, мясо и предметы рисуются кодом (sprites.js), но любой
   из них можно заменить своей картинкой: положить public/gibs/<имя>.png и вписать
   имя в public/gibs/index.json — ["gib_arm", "gib_leg"]. Имена те же, под какими
   куски лежат в спрайтах; их список и образцы для рисования кладёт npm run sheets
   в public/gibs/_proc/. Файла нет или не загрузился — остаётся процедурный. */
export async function loadGibs(base = './gibs/') {
  let list = null;
  try {
    const r = await fetch(`${base}index.json`, { cache: 'no-cache' });
    if (r.ok) list = await r.json();
  } catch (e) { /* своих кусков нет — это нормальный случай */ }
  if (!Array.isArray(list) || !list.length) return;
  const done = [];
  for (const it of list) {
    const name = typeof it === 'string' ? it : it?.name;
    if (!name) continue;
    if (!PROC[name]) { console.warn(`кусок ${name}: такого спрайта нет — пропущен`); continue; }
    const file = (typeof it === 'string' ? null : it.file) || `${name}.png`;
    try {
      const img = await loadImg(`${base}${file}`);
      const c = makeCanvas(img.width, img.height);
      c.getContext('2d').drawImage(img, 0, 0);
      SPR[name] = { tex: toTex(c), canvas: c, w: c.width, h: c.height };
      done.push(name);
    } catch (e) { console.warn(`кусок ${name}: ${file} не загрузился, берётся процедурный`); }
  }
  if (done.length) console.log('свои куски:', done.join(', '));
}

// имена кусков и предметов, которые можно заменить картинкой (кадры врагов — не здесь)
export const swappableGibs = () => Object.keys(PROC)
  .filter(n => /^(gib_|head_|pickup_|icon_)/.test(n) || n === 'drop' || n === 'spark' || n === 'rose' || n === 'candle')
  .sort();
export const gibCanvas = name => PROC[name]?.canvas || null;

// щит для экспорта в public/enemies/shield.png
export function buildShield() { return PROC.shield_kite?.canvas || null; }

// собрать лист из текущих спрайтов SPR (для экспорта процедурной версии в PNG)
export function buildSheet(name) {
  const def = BUILTIN[name];
  const cols = Object.values(def.frames).reduce((m, i) => Math.max(m, i + 1), 0);
  const c = makeCanvas(cols * def.frameW, def.variants * def.frameH);
  const x = c.getContext('2d');
  for (let v = 0; v < def.variants; v++) for (const [fname, idx] of Object.entries(def.frames)) {
    const s = PROC[`${name}${v}_${fname}`];          // именно процедурный, не нарезка из PNG
    if (s) x.drawImage(s.canvas, idx * def.frameW, v * def.frameH);
  }
  return c;
}
// шаблон-разметка для художника: границы кадров, линия пола, зоны головы/торса/ног, центр, подписи кадров
export function buildTemplate(name) {
  const def = BUILTIN[name];
  const cols = Object.values(def.frames).reduce((m, i) => Math.max(m, i + 1), 0);
  const W = def.frameW, H = def.frameH;
  const TOP = 18;   // строка с подписью над листом (в игровом листе её нет — обрежьте при рисовании или используйте как памятку)
  const c = makeCanvas(cols * W, def.variants * H + TOP);
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(30,30,40,1)'; x.fillRect(0, 0, c.width, c.height);
  const names = Object.entries(def.frames).sort((a, b) => a[1] - b[1]);
  for (let v = 0; v < def.variants; v++) for (const [fname, idx] of names) {
    const ox = idx * W, oy = v * H + TOP;
    // полупрозрачный процедурный спрайт как подложка
    const s = PROC[`${name}${v}_${fname}`]; if (s) { x.globalAlpha = .35; x.drawImage(s.canvas, ox, oy); x.globalAlpha = 1; }
    x.strokeStyle = '#ff40ff'; x.lineWidth = 1; x.strokeRect(ox + .5, oy + .5, W - 1, H - 1);               // граница кадра
    x.strokeStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.moveTo(ox + W / 2 + .5, oy); x.lineTo(ox + W / 2 + .5, oy + H); x.stroke();   // центр
    x.strokeStyle = '#40ff40'; x.beginPath(); x.moveTo(ox, oy + H - 2.5); x.lineTo(ox + W, oy + H - 2.5); x.stroke();                     // пол
    // реальные зоны попадания: ровно те прямоугольники, по которым движок решает,
    // куда попали и что отстрелить. Рисуйте конечности внутри них.
    const parts = partBoxes(def);
    const ZCOL = { head: '#ffc850', armL: '#50a0ff', armR: '#50a0ff', legL: '#78ff78', legR: '#78ff78' };
    for (const [k, r] of Object.entries(parts)) {
      const X = ox + r[0] * W, Y = oy + r[1] * H, Wd = (r[2] - r[0]) * W, Hd = (r[3] - r[1]) * H;
      x.strokeStyle = ZCOL[k] || '#ffffff'; x.lineWidth = 1; x.setLineDash([3, 3]);
      x.strokeRect(X + .5, Y + .5, Wd - 1, Hd - 1);
      x.setLineDash([]);
      x.fillStyle = ZCOL[k] || '#fff'; x.font = '8px monospace'; x.fillText(k, X + 2, Y + 9);
    }
    x.fillStyle = '#fff'; x.font = 'bold 10px monospace'; x.fillText(`${fname} v${v}`, ox + 4, oy + H - 6);
  }
  x.fillStyle = '#ffd070'; x.font = '10px monospace';
  x.fillText(`${name}: кадр ${W}×${H}px = ${def.size[0]}×${def.size[1]} м · пунктир — зоны попадания (голова/руки/ноги), ноги на зелёной линии`, 4, 12);
  return c;
}
export const builtinDefs = () => structuredClone(BUILTIN);
