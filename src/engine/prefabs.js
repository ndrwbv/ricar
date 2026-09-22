/* Префабы — составные объекты уровня (хижина, телега, ванна, машина…).
   Каждый: параметры со схемой (для редактора) и build(g, x, z, p). Все координаты — минимальный угол по x/z. */
import * as THREE from 'three';
import { TEX } from './textures.js';
import { SPR } from './sprites.js';
import { billboard } from './world.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
/* Генератор с зерном: нужен там, где форма обязана быть одинаковой при каждой
   загрузке уровня — иначе навигационная сетка, коллизии и картинка в редакторе
   расходятся с тем, что игрок видит в игре. */
const seeded = s => { let t = ((s | 0) * 2654435761 + 1013904223) >>> 0; return () => { t = (t * 1664525 + 1013904223) >>> 0; return t / 4294967296; }; };
const N = (def, min, max, step = .1) => ({ type: 'number', def, min, max, step });
const B = def => ({ type: 'bool', def });
const S = (def, options) => ({ type: 'select', def, options });
/* Типы врагов для спавнера. Массив один и тот же на всё время работы: описания
   врагов грузятся асинхронно и дописывают его на месте, поэтому редактор,
   держащий ссылку, сразу видит актуальный список. */
export const ENEMY_TYPES = ['любой'];
export const FACES = ['0 (+z, юг)', '1 (+x, восток)', '2 (−z, север)', '3 (−x, запад)'];
/* Из редактора сторона приходит подписью целиком, а не числом, и приведение к числу
   давало NaN — сторона выбиралась как придётся. Берём ведущую цифру. */
export const faceOf = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? ((n % 4) + 4) % 4 : 0; };

export const PEASANT_COLORS = { body: '#6a4a2a', legs: '#3a3020', skin: '#c8956a', hair: '#2a2018' };
export const KNIGHT_COLORS = { body: '#8a1418', legs: '#5a5a62', skin: '#c8956a', hair: '#7a7a86' };

function deco(g, L, name, x, y, z, size) {
  const s = SPR[name];
  const m = billboard(s, size, size * s.h / s.w);
  m.position.set(x, y, z); m.userData.levelObj = true;
  g.scene.add(m);
  (L?.bills || (g.level_bills = g.level_bills || [])).push(m);
  return m;
}

export const PREFABS = {
  hut: {
    name: 'Хижина', params: { wd: N(6, 3, 12), dp: N(5, 3, 12), burning: B(false) }, size: p => [p.wd, p.dp],
    build(g, x, z, p) {
      const w = g.world;
      w.box(x, 0, z, p.wd, 2.8, .4, 'plank'); w.box(x, 0, z + p.dp - .4, p.wd, 2.8, .4, 'plank');
      w.box(x, 0, z, .4, 2.8, p.dp * .4, 'plank'); w.box(x, 0, z + p.dp * .6, .4, 2.8, p.dp * .4, 'plank');
      w.box(x + p.wd - .4, 0, z, .4, 2.8, p.dp, 'plank');
      w.floor(x, .02, z, p.wd, p.dp, 'dirt');
      if (!p.burning) {
        w.box(x - .4, 2.8, z - .4, p.wd + .8, .9, p.dp + .8, 'hay', { solid: false });
        w.box(x + p.wd * .2, 3.7, z + p.dp * .2, p.wd * .6, .8, p.dp * .6, 'hay', { solid: false });
      } else {
        w.box(x - .4, 2.8, z - .4, p.wd * .55, .7, p.dp + .8, 'hay', { solid: false });
        w.box(x + p.wd * .5, 2.4, z, p.wd * .5, .3, p.dp * .4, 'dark', { solid: false });
        w.fire(x + p.wd * .55, 2.6, z + p.dp * .5, 2.6);
        w.fire(x + p.wd * .2, 0, z + p.dp * .6, 1.4);
      }
    },
  },
  cart: {
    name: 'Телега с сеном', params: { rot: B(false) }, size: p => p.rot ? [1.6, 3] : [3, 1.6],
    build(g, x, z, p) {
      const w = g.world;
      const [wd, dp] = p.rot ? [1.6, 3] : [3, 1.6];
      w.box(x, .55, z, wd, .5, dp, 'plank');
      w.box(x + .1, 1.05, z + .1, wd - .2, .9, dp - .2, 'hay');
      w.blocker(x, 0, z, wd, .55, dp);
      const R = .5;
      if (p.rot) { w.cyl(x - .05, R, z + .7, R, .2, 'plank', { seg: 8, solid: false }); w.cyl(x + wd + .05, R, z + .7, R, .2, 'plank', { seg: 8, solid: false }); }
      else { w.cyl(x + .7, R, z - .05, R, .2, 'plank', { seg: 8, solid: false }); w.cyl(x + .7, R, z + dp + .05, R, .2, 'plank', { seg: 8, solid: false }); }
    },
  },
  fence: {
    name: 'Забор', params: { len: N(6, 1, 30, .5), vert: B(false) }, size: p => p.vert ? [.3, p.len] : [p.len, .3],
    build(g, x, z, p) {
      const w = g.world;
      if (p.vert) { w.box(x, .5, z, .12, .5, p.len, 'plank'); for (let i = 0; i <= p.len; i += 2) w.box(x - .04, 0, z + i, .2, 1.2, .2, 'plank'); }
      else { w.box(x, .5, z, p.len, .5, .12, 'plank'); for (let i = 0; i <= p.len; i += 2) w.box(x + i, 0, z - .04, .2, 1.2, .2, 'plank'); }
    },
  },
  torchPost: {
    name: 'Столб с факелом', params: {}, size: () => [.3, .3],
    build(g, x, z) { g.world.cyl(x, 0, z, .12, 2.4, 'plank', { seg: 6 }); g.world.fire(x, 2.3, z, .7, { intensity: 2.5, dist: 9 }); },
  },
  torch: {
    name: 'Факел на стене', params: { face: S(0, FACES) }, size: () => [.3, .3],
    build(g, x, z, p) {
      const face = faceOf(p.face);
      const ox = [0, .35, 0, -.35][face], oz = [.35, 0, -.35, 0][face];
      g.world.box(x - .06 + ox * .3, 1.6, z - .06 + oz * .3, .12, .5, .12, 'plank', { solid: false });
      g.world.fire(x + ox, 2.05, z + oz, .55, { intensity: 2.2, dist: 8 });
    },
  },
  lamp: {
    name: 'Уличный фонарь', params: {}, size: () => [.3, .3],
    build(g, x, z, p, L) {
      g.world.cyl(x, 0, z, .12, 5, 'metal', { seg: 6 });
      g.world.box(x - .5, 5, z - .2, 1, .2, .4, 'metal', { solid: false });
      g.world.light(x, 4.9, z, 0xffe0b0, 3.2, 14);
      if (g.world.editor) return;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(.9, .9), new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.set(x, 4.8, z); glow.userData.levelObj = true;
      g.scene.add(glow);
      (L?.glows || (g.level_glows = g.level_glows || [])).push(glow);
    },
  },
  car: {
    name: 'Машина', params: { tex: S('metal', ['metal', 'metalRed', 'dark']) }, size: () => [2, 4.4],
    build(g, x, z, p) {
      const w = g.world;
      w.box(x, .3, z, 2, .8, 4.4, p.tex); w.box(x + .15, 1.1, z + 1, 1.7, .7, 2.2, 'dark');
      w.blocker(x, 0, z, 2, .3, 4.4);
      for (const [dx, dz] of [[-.1, .6], [1.9, .6], [-.1, 3.4], [1.9, 3.4]]) w.box(x + dx - .1, 0, z + dz - .35, .2, .7, .7, 'dark', { solid: false });
    },
  },
  bathtub: {
    name: 'Ванна', params: {}, size: () => [2.4, 1.1],
    build(g, x, z) {
      const w = g.world, BW = 2.4, BD = 1.1, BH = .7;
      w.box(x, 0, z, BW, BH, .18, 'tileWhite'); w.box(x, 0, z + BD - .18, BW, BH, .18, 'tileWhite');
      w.box(x, 0, z, .18, BH, BD, 'tileWhite'); w.box(x + BW - .18, 0, z, .18, BH, BD, 'tileWhite');
      w.box(x + .18, 0, z + .18, BW - .36, .12, BD - .36, 'tileWhite');
      w.floor(x + .18, .5, z + .18, BW - .36, BD - .36, 'water');
      w.cyl(x + .5, BH, z + .1, .05, .3, 'metal', { seg: 6, solid: false }); w.cyl(x + .5, BH + .3, z + .12, .04, .12, 'metal', { seg: 6, solid: false });
    },
  },
  toilet: {
    name: 'Унитаз', params: { glow: B(true) }, size: () => [.8, 1],
    build(g, x, z, p) {
      const w = g.world, cx = x + .4, cz = z + .6;
      w.cyl(cx, 0, cz, .36, .42, 'tileWhite', { seg: 10 });
      w.box(cx - .3, 0, cz - .55, .6, .95, .28, 'tileWhite');
      w.cyl(cx, .42, cz, .4, .06, 'tileWhite', { seg: 10, solid: false });
      w.cyl(cx, .43, cz, .28, .05, 'water', { seg: 10, solid: false, emissive: true });
      if (p.glow) w.light(cx, 1.2, cz, 0x3af0c0, 1.5, 6, { pulse: 5 });
    },
  },
  sink: {
    name: 'Раковина с зеркалом', params: { face: S(3, FACES) }, size: () => [1.4, .8],
    build(g, x, z, p) {
      const w = g.world;
      w.box(x, .8, z, 1.2, .15, .6, 'tileWhite'); w.box(x + .4, 0, z, .5, .8, .5, 'tileWhite');
      w.quad(x + 1.35, 1.9, z + .3, 1, 1.2, 'glass', faceOf(p.face));
    },
  },
  bed: {
    name: 'Кровать с простынёй', params: { roses: B(true) }, size: () => [2.4, 2.6],
    build(g, x, z, p, L) {
      const w = g.world;
      w.box(x, 0, z, 2.4, .5, 2.6, 'plank');
      w.box(x + .1, .5, z + .1, 2.2, .3, 2.4, 'linen');
      w.box(x + .2, .8, z + .2, 2.0, .08, 2.2, 'linen', { solid: false });
      w.box(x + .3, .88, z + .3, .8, .18, .5, 'linen', { solid: false }); w.box(x + 1.3, .88, z + .3, .8, .18, .5, 'linen', { solid: false });
      w.box(x, .5, z - .1, 2.4, .9, .15, 'plank', { solid: false });
      if (p.roses && !w.editor) for (let i = 0; i < 12; i++) deco(g, L, 'rose', x + rnd(.3, 2.1), .9, z + rnd(.4, 2.3), .16);
    },
  },
  table: {
    name: 'Стол', params: { wd: N(4, .6, 8), dp: N(1.4, .6, 8), wine: B(false) }, size: p => [p.wd, p.dp],
    build(g, x, z, p) {
      const w = g.world;
      w.box(x, .8, z, p.wd, .12, p.dp, 'plank');
      for (const [dx, dz] of [[.2, .1], [p.wd - .32, .1], [.2, p.dp - .22], [p.wd - .32, p.dp - .22]]) w.box(x + dx, 0, z + dz, .12, .8, .12, 'plank', { solid: false });
      w.blocker(x, 0, z, p.wd, .8, p.dp);
      if (p.wine) {
        w.cyl(x + p.wd * .3, .92, z + p.dp * .4, .09, .38, 'dark', { seg: 6, solid: false });
        w.cyl(x + p.wd * .6, .92, z + p.dp * .5, .07, .22, 'glass', { seg: 6, solid: false }); w.cyl(x + p.wd * .75, .92, z + p.dp * .3, .07, .22, 'glass', { seg: 6, solid: false });
        PREFABS.wineStain.build(g, x + p.wd * .55, z + p.dp * .45, { y: .93, size: .8 });
      }
    },
  },
  dresser: {
    name: 'Комод', params: { wd: N(2.4, .6, 6), dp: N(.7, .3, 3) }, size: p => [p.wd, p.dp],
    build(g, x, z, p) { g.world.box(x, 0, z, p.wd, .9, p.dp, 'plank'); },
  },
  stool: { name: 'Табурет', params: {}, size: () => [.6, .6], build(g, x, z) { g.world.box(x, 0, z, .6, .5, .6, 'plank'); } },
  crate: { name: 'Ящик', params: { s: N(1, .3, 3) }, size: p => [p.s, p.s], build(g, x, z, p) { g.world.box(x, 0, z, p.s, p.s, p.s, 'plank'); } },
  barrel: { name: 'Бочка', params: {}, size: () => [.9, .9], build(g, x, z) { g.world.cyl(x + .45, 0, z + .45, .45, .9, 'plank', { seg: 8 }); } },
  candle: {
    name: 'Свеча', params: { y: N(0, 0, 3, .05) }, size: () => [.2, .2],
    build(g, x, z, p, L) {
      if (!g.world.editor) deco(g, L, 'candle', x, p.y, z, .12);
      const f = g.world.light(x, p.y + .3, z, 0xffa040, .9, 3.5);
      if (f && !g.world.editor) g.world.fires.push({ light: f, t: Math.random() * 10, base: f.intensity, size: 0, on: true, candle: true });
    },
  },
  roses: {
    name: 'Розы на полу', params: { n: N(5, 1, 30, 1), r: N(1.2, .2, 5), y: N(0, 0, 3, .05) }, size: p => [p.r * 2, p.r * 2],
    build(g, x, z, p, L) { if (g.world.editor) return; for (let i = 0; i < p.n; i++) deco(g, L, 'rose', x + rnd(0, p.r * 2), p.y, z + rnd(0, p.r * 2), .16); },
  },
  wineStain: {
    name: 'Пролитое вино', params: { y: N(.04, 0, 3, .01), size: N(1.2, .2, 4) }, size: p => [p.size, p.size],
    build(g, x, z, p) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.size, p.size), new THREE.MeshBasicMaterial({ map: TEX.wine, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.rotation.x = -Math.PI / 2; m.position.set(x + p.size / 2, p.y + .012, z + p.size / 2); m.rotation.z = rnd(0, 6.28);
      m.userData.levelObj = true;
      g.scene.add(m);
    },
  },
  well: {
    name: 'Колодец', params: {}, size: () => [2.6, 2.6],
    build(g, x, z) {
      const w = g.world, cx = x + 1.3, cz = z + 1.3;
      w.cyl(cx, 0, cz, 1.3, 1.1, 'stone', { seg: 10 });
      w.cyl(cx, 1.1, cz, 1.0, .3, 'dark', { seg: 10, solid: false });
      w.box(cx - .3, 1.1, cz - .3, .3, 2.2, .3, 'plank'); w.box(cx, 1.1, cz + .3, .3, 2.2, .3, 'plank'); w.box(cx - .8, 3.2, cz - .7, 1.6, .3, 1.4, 'roof', { solid: false });
    },
  },
  fireplace: {
    name: 'Камин', params: { face: S(1, FACES) }, size: () => [2, 3],
    build(g, x, z, p) {
      const w = g.world;
      w.box(x, 0, z, 2, 3.3, 3, 'stoneDark'); w.box(x + (faceOf(p.face) === 1 ? .8 : 0), .1, z + .4, 1.2, 1.6, 2.2, 'dark', { solid: false });
      w.fire(x + (faceOf(p.face) === 1 ? 1.2 : .8), .1, z + 1.5, 1.2, { color: 0xff8030, intensity: 4, dist: 12 });
    },
  },
  banner: {
    name: 'Знамя', params: { face: S(2, FACES), y: N(3.6, .5, 8) }, size: () => [1.2, .2],
    build(g, x, z, p) { g.world.quad(x + .6, p.y, z + .1, 1.2, 2.4, 'cloth', faceOf(p.face)); },
  },
  window: {
    name: 'Окно (светится)', params: { face: S(0, FACES), y: N(2, .5, 8), tex: S('skyDusk', ['skyDusk', 'skyCity', 'windows', 'glass']) }, size: () => [1.6, .1],
    build(g, x, z, p) { g.world.quad(x + .8, p.y, z + .02, 1.6, 1.4, p.tex, faceOf(p.face), { emissive: true }); },
  },
  building: {
    name: 'Городское здание', params: { wd: N(10, 4, 60), dp: N(12, 4, 60), h: N(16, 5, 60), sign: S('', ['', 'neon1', 'neon2', 'neon3', 'neon4']), face: S(1, FACES) }, size: p => [p.wd, p.dp],
    build(g, x, z, p) {
      const w = g.world;
      w.box(x, 0, z, p.wd, 4, p.dp, 'brickCity');
      w.box(x, 4, z, p.wd, p.h - 4, p.dp, 'windows', { emissive: true, solid: false });
      w.blocker(x, 4, z, p.wd, p.h - 4, p.dp);
      w.box(x - .2, p.h, z - .2, p.wd + .4, .6, p.dp + .4, 'concrete', { solid: false });
      const face = faceOf(p.face);
      if (p.sign) w.quad(face === 1 ? x + p.wd + .05 : face === 3 ? x - .05 : x + p.wd / 2, 3, face === 0 ? z + p.dp + .05 : face === 2 ? z - .05 : z + p.dp / 2, 3.2, 1.6, p.sign, face, { emissive: true });
    },
  },
  dumpster: { name: 'Мусорный бак', params: {}, size: () => [1.6, 1.1], build(g, x, z) { g.world.box(x, 0, z, 1.6, 1.3, 1.1, 'metal'); } },
  concreteBlock: { name: 'Бетонный блок', params: {}, size: () => [2.2, 1], build(g, x, z) { g.world.box(x, 0, z, 2.2, 1.1, 1, 'concrete'); } },
  heap: {
    name: 'Груда тела', params: { who: S('peasant', ['peasant', 'knight']), headless: B(false) }, size: () => [1.6, 1.6],
    build(g, x, z, p) {
      if (g.world.editor) { g.world.cyl(x + .8, 0, z + .8, .7, .3, 'metalRed', { seg: 8, solid: false }); return; }
      const a = rnd(0, 6.28);
      g.gore.heap(x + .8, 0, z + .8, { x: Math.cos(a), z: Math.sin(a) }, p.who === 'knight' ? KNIGHT_COLORS : PEASANT_COLORS, { headless: p.headless, sprite: `${p.who === 'knight' ? 'guard' : 'peasant'}0_${p.headless ? 'deadHeadless' : 'dead'}` });
    },
  },
  gibs: {
    name: 'Разбросанные куски', params: {}, size: () => [2, 2],
    build(g, x, z) { if (g.world.editor) return; g.gore.gib(pick(['gib_fork', 'head_peasant', 'gib_arm', 'gib_leg']), x + rnd(0, 2), .3, z + rnd(0, 2), 0, 0, 0, .3, { trail: false }); },
  },
  /* Спавнер: бесконечно поднимает врагов, пока игрок рядом. Ставится куда угодно,
     настраивается в редакторе. Логика тикает в levelloader (L.spawners). */
  /* Лестница на второй этаж: ступени — обычные коробки, герой и враги поднимаются
     по ним сами (groundAt ставит их на верх ближайшей коробки).
     face задаёт, в какую сторону идёт подъём. */
  stairs: {
    name: 'Лестница',
    params: {
      w: N(2.4, .8, 8, .1), h: N(3.4, .5, 14, .1), len: N(4.5, 1, 20, .1),
      face: S(0, FACES), tex: S('plank', ['plank', 'stone', 'stoneDark', 'brick', 'marble', 'metal', 'concrete']),
      rail: B(true), under: B(true),
    },
    size: p => (faceOf(p.face) % 2 === 0 ? [p.w, p.len] : [p.len, p.w]),
    build(g, x, z, p) {
      const w = g.world, face = faceOf(p.face);
      const n = Math.max(2, Math.round(p.h / .24));
      const stepH = p.h / n, stepD = p.len / n;
      const along = face % 2 === 0 ? 'z' : 'x';                 // ось подъёма
      const sign = (face === 0 || face === 1) ? 1 : -1;          // куда растёт высота
      const W = along === 'z' ? p.w : p.len, D = along === 'z' ? p.len : p.w;
      for (let i = 0; i < n; i++) {
        const k = sign > 0 ? i : n - 1 - i;                      // номер ступени от низкого края
        const h = stepH * (k + 1);
        if (along === 'z') w.box(x, 0, z + i * stepD, p.w, h, stepD + .02, p.tex, { decal: true });
        else w.box(x + i * stepD, 0, z, stepD + .02, h, p.w, p.tex, { decal: true });
      }
      if (p.rail) {
        // перила: наклонная «змейка» из коротких столбиков по обеим сторонам
        for (let i = 0; i < n; i += Math.max(1, Math.round(n / 8))) {
          const k = sign > 0 ? i : n - 1 - i;
          const h = stepH * (k + 1);
          if (along === 'z') {
            w.box(x - .06, h, z + i * stepD, .12, .9, .12, 'metal', { solid: false });
            w.box(x + p.w - .06, h, z + i * stepD, .12, .9, .12, 'metal', { solid: false });
          } else {
            w.box(x + i * stepD, h, z - .06, .12, .9, .12, 'metal', { solid: false });
            w.box(x + i * stepD, h, z + p.w - .06, .12, .9, .12, 'metal', { solid: false });
          }
        }
      }
      // глухая стенка под маршем, чтобы снизу не было видно «ступенек в воздухе»
      if (p.under && !w.editor) w.box(x, 0, z, W, .12, D, p.tex, { solid: false });
    },
  },
  spawner: {
    name: 'Спавнер врагов',
    params: {
      // список врагов берётся из загруженных описаний: добавили врага — он сразу здесь
      type: S('любой', ENEMY_TYPES),
      period: N(4, .5, 60, .5), max: N(4, 1, 24, 1), r: N(6, 1, 20, .5),
      total: N(0, 0, 999, 1), near: N(45, 5, 200, 5), tag: S('spawn', ['spawn', 'a', 'b', 'c', 'd']),
      /* hold — радиус, за который выпущенный боец не уходит: он держит точку
         спавна и возвращается к ней, пока игрок дальше. 0 — бегает свободно,
         как раньше. Нужно для комнат-клеток, где враг должен оставаться у себя. */
      hold: N(0, 0, 40, 1),
    },
    size: () => [2, 2],
    build(g, x, z, p, L) {
      const w = g.world, cx = x + 1, cz = z + 1;
      w.cyl(cx, 0, cz, 1, .25, 'stoneDark', { seg: 10, solid: false });
      w.cyl(cx, .25, cz, .75, .12, 'marble', { seg: 10, solid: false });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + .4;
        w.box(cx + Math.cos(a) * .8 - .1, .25, cz + Math.sin(a) * .8 - .1, .2, 1.1, .2, 'stone', { solid: false });
      }
      if (w.editor) { w.cyl(cx, 1.4, cz, .4, .5, 'metalRed', { seg: 8, solid: false }); return; }
      w.light(cx, 1.3, cz, 0xff4020, 1.6, 7);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff3018, opacity: .55 }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(cx, .42, cz); glow.userData.levelObj = true;
      g.scene.add(glow);
      const sp = {
        x: cx, z: cz, r: p.r, period: p.period, max: p.max, total: p.total || 0, near: p.near,
        hold: p.hold || 0,
        type: p.type, tag: p.tag || 'spawn', t: rnd(.3, 1.2), made: 0, alive: [], glow,
      };
      (L?.spawners || (g.level_spawners = g.level_spawners || [])).push(sp);
    },
  },
  /* Пещера: коробка снаружи, рваный камень внутри, полусферический свод сверху.
     Прямых стен нет ни одной — по периметру идёт ломаная из два десятка
     коротких отрезков, каждый утоплен внутрь на случайную глубину и поднят
     на случайную высоту, так что и в плане, и по силуэту стена гуляет.
     Потолок не плоский: над пещерой стоит купол (см. world.dome), обод которого
     садится на стены на высоте h, а середина уходит вверх ещё на dome·полуширины.
     Снаружи всё закрывает глухой короб: сквозь стыки и низкие участки
     видно только ту же породу, а не пустоту за уровнем.
     Форма считается от seed — при перезагрузке пещера та же самая,
     иначе навигация и правки в редакторе расходились бы с картинкой. */
  cave: {
    name: 'Пещера',
    params: {
      w: N(10, 4, 40, .5), d: N(12, 4, 40, .5), h: N(5, 3, 14, .5),
      // подъём свода над стенами, в долях от полуширины пещеры:
      // 1 — ровно полусфера, 0 — плоский потолок, как было раньше
      dome: N(.9, 0, 1.6, .05),
      // y — уровень пола: пещеру ставят и на чужой пол, тогда её нужно приподнять
      // на пару сантиметров, иначе два совпадающих пола мерцают друг сквозь друга
      y: N(0, -4, 12, .01),
      face: S(2, FACES), door: N(3.4, 1.2, 10, .2),
      tex: S('caveRock', ['caveRock', 'dirt', 'stoneDark', 'stone', 'techBrown']),
      floorTex: S('caveFloor', ['caveFloor', 'dirt', 'caveRock', 'cobble', 'stoneDark']),
      rough: N(1, 0, 2, .1), fires: N(2, 0, 8, 1), seed: N(7, 0, 999, 1),
    },
    size: p => [p.w, p.d],
    build(g, x, z, p) {
      const w = g.world, W = p.w, D = p.d, H = p.h, Y = p.y || 0;
      const R = seeded(p.seed), rr = (a, b) => a + R() * (b - a);
      const T = .8;                                   // толщина каменной корки
      const face = faceOf(p.face), half = p.door / 2;
      const cx = x + W / 2, cz = z + D / 2;
      /* Пятна яркости по вершинам. Порода кладётся плиткой в 4 м, и на стене
         в десяток метров глаз без этого сразу находит период. Низкочастотный
         шум (длина волны 6–14 м) ложится поверх плитки, не совпадая с ней ничем,
         и повтор перестаёт читаться. Всё в пещере красится одной функцией —
         пол, свод, стены и камни, — поэтому пятна проходят по ним насквозь. */
      const ph = [R() * 6.283, R() * 6.283, R() * 6.283, R() * 6.283];
      const mot = (ax, ay, az) => .92
        + .17 * Math.sin(ax * .45 + ph[0]) * Math.sin(az * .39 + ph[1])
        + .08 * Math.sin(ax * .97 + ph[2]) * Math.sin(az * 1.13 + ph[3])
        + .04 * Math.sin(ay * .8 + ph[0]);
      const rise = Math.max(0, p.dome ?? .9) * Math.min(W, D) / 2;
      /* Свод вдобавок гасится к макушке: огонь стоит на полу и до верха
         не достаёт. Один этот перепад яркости и читается как купол —
         без него потолок в потёмках выглядит плоским пятном. */
      const domeLit = (ax, ay, az) => mot(ax, ay, az) * (1.1 - .32 * Math.min(1, Math.max(0, (ay - Y - H) / Math.max(.01, rise))));

      w.floor(x, Y, z, W, D, p.floorTex, { cell: 1.6, uvScale: .5, lit: mot });
      /* Свод. Возвращает высоту в точке — по ней потом равняют и верх стен,
         и сталактиты, иначе они повисли бы в воздухе под куполом. */
      const ceilAt = rise > .2
        ? w.dome(x, Y + H, z, W, D, rise, p.tex, { rnd: R, rough: .55 * p.rough, uvM: 4, cell: 1.25, lit: domeLit })
        : (w.floor(x, Y + H, z, W, D, p.tex, { cell: 1.6, uvScale: .5, lit: mot, ceiling: true }), () => Y + H);

      // ── глухой короб с проёмом на стороне face; поднят выше макушки свода ──
      const HS = Math.max(H + 1.2, H + rise + 1.4);
      const side = (x0, z0, x1, z1, isDoor) => {
        const uv = { uvScale: .5, uvOff: [R(), R()], lit: mot };
        if (!isDoor) { w.wall(x0, z0, x1, z1, Y, HS, T, p.tex, uv); return; }
        const L = Math.hypot(x1 - x0, z1 - z0), nx = (x1 - x0) / L, nz = (z1 - z0) / L;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const top = Math.min(H - .4, 3.4);            // высота проёма
        w.wall(x0, z0, mx - nx * half, mz - nz * half, Y, HS, T, p.tex, uv);
        w.wall(mx + nx * half, mz + nz * half, x1, z1, Y, HS, T, p.tex, { ...uv, uvOff: [R(), R()] });
        w.wall(mx - nx * half, mz - nz * half, mx + nx * half, mz + nz * half, Y + top, HS - top, T, p.tex, { ...uv, uvOff: [R(), R()] });
      };
      side(x, z + D, x + W, z + D, face === 0);
      side(x + W, z, x + W, z + D, face === 1);
      side(x, z, x + W, z, face === 2);
      side(x, z, x, z + D, face === 3);

      /* ── рваный контур ── точки идут по периметру прямоугольника и
         вдавливаются внутрь на случайную глубину; у проёма вдавливание сходит
         на нет, а сами отрезки поперёк входа выбрасываются — иначе камень
         зарастал бы прямо в дверях и в пещеру было бы не войти. */
      const step = 2.1, per = 2 * (W + D), n = Math.max(8, Math.round(per / step));
      const alongAxis = face % 2 === 0;               // проём режет координату x или z
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * per;
        let px, pz, inx, inz, sideId;
        if (t < W) { px = x + t; pz = z; inx = 0; inz = 1; sideId = 2; }
        else if (t < W + D) { px = x + W; pz = z + (t - W); inx = -1; inz = 0; sideId = 1; }
        else if (t < 2 * W + D) { px = x + W - (t - W - D); pz = z + D; inx = 0; inz = -1; sideId = 0; }
        else { px = x; pz = z + D - (t - 2 * W - D); inx = 1; inz = 0; sideId = 3; }
        // насколько точка близка к проёму своей стороны
        const a = alongAxis ? px - cx : pz - cz;
        const alongDoor = sideId === face ? Math.abs(a) : 1e9;
        const clear = Math.max(0, 1 - alongDoor / (half + 1.6));
        const bite = rr(.25, 1.35) * p.rough * (1 - clear);
        const qx = px + inx * bite, qz = pz + inz * bite;
        /* Верх ломаной по-прежнему гуляет, но выше свода не лезет: иначе
           из купола торчали бы плиты, а сквозь просветы над низкими участками
           видно глухой короб — так и задумано. */
        const hi = Math.min(rr(H * .55, H + .8), ceilAt(qx, qz) - Y + .15);
        pts.push({ x: qx, z: qz, h: hi, door: alongDoor < half, a });
      }
      // точку, попавшую в проём, выталкиваем на его край — получается косяк
      const jamb = q => {
        if (!q.door) return [q.x, q.z];
        const e = (q.a < 0 ? -1 : 1) * half;
        return alongAxis ? [cx + e, q.z] : [q.x, cz + e];
      };
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if (a.door && b.door) continue;
        const [ax, az] = jamb(a), [bx, bz] = jamb(b);
        if (Math.hypot(bx - ax, bz - az) < .05) continue;
        w.wall(ax, az, bx, bz, Y, a.h, T * .75, p.tex, { uvScale: .5, uvOff: [R(), R()], lit: mot });
      }

      if (w.editor) return;     // дальше — мелочь, в плане редактора она только мешает

      /* ── сталагмиты, сталактиты, валуны ──
         Всё, что стоит на полу, жмётся к стенам: середина пещеры должна
         остаться свободной, иначе драться в ней негде, а бойцу не проложить
         путь — навигационная сетка раздувает каждый камень ещё на 0.4 м. */
      const spot = (t0, t1) => {
        const a = R() * 6.283, t = rr(t0, t1);
        return [cx + Math.cos(a) * (W / 2 - 1.2) * t, cz + Math.sin(a) * (D / 2 - 1.2) * t];
      };
      /* Конус у cyl задаётся радиусами верха и низа, а коллизия берётся по
         верхнему. Поэтому сталагмит (острый верх) держит не сам цилиндр,
         а blocker по ширине основания, иначе сквозь него проходили бы насквозь. */
      for (let i = 0; i < Math.round(W * D / 26); i++) {
        const [sx, sz] = spot(.5, 1), base = rr(.15, .4), hh = rr(.7, 2.1);
        w.cyl(sx, Y, sz, .03, hh, p.tex, { r2: base, seg: 5, solid: false, lit: mot });
        w.blocker(sx - base, Y, sz - base, base * 2, hh, base * 2);
      }
      // сталактиты висят на самом своде: под куполом потолок выше, чем у стен
      for (let i = 0; i < Math.round(W * D / 13); i++) {
        const [sx, sz] = spot(0, 1), top = ceilAt(sx, sz);
        const hh = Math.min(rr(.6, H * .45), (top - Y) * .5);
        w.cyl(sx, top - hh, sz, rr(.16, .5), hh, p.tex, { r2: .03, seg: 5, solid: false, lit: mot });
      }
      // валун, наоборот, шире сверху — тогда коллизия совпадает с самой широкой частью
      for (let i = 0; i < Math.round(W * D / 45); i++) {
        const [sx, sz] = spot(.55, 1), r = rr(.35, .7);
        w.cyl(sx, Y, sz, r, rr(.5, 1.1), p.tex, { r2: r * rr(.55, .85), seg: 6, lit: mot });
      }

      // ── огонь: без него внутри не видно ни породы, ни врага ──
      for (let i = 0; i < p.fires; i++) {
        const a = (i + .5) / p.fires * 6.283 + p.seed;
        const fx = cx + Math.cos(a) * (W / 2 - 2.2), fz = cz + Math.sin(a) * (D / 2 - 2.2);
        w.cyl(fx, Y, fz, rr(.3, .5), .25, p.tex, { seg: 6, solid: false, lit: mot });
        // свет добивает до свода: под куполом до потолка теперь вдвое дальше
        w.fire(fx, Y + .2, fz, 1.1, { color: 0xff6a24, intensity: 2.6, dist: Math.max(10, H + rise + 4) });
      }
    },
  },
  tower: {
    name: 'Башня', params: { r: N(2.6, 1, 6), h: N(9, 3, 30) }, size: p => [p.r * 2, p.r * 2],
    build(g, x, z, p) {
      const w = g.world, cx = x + p.r, cz = z + p.r;
      w.cyl(cx, 0, cz, p.r, p.h, 'stone', { seg: 10 });
      w.cyl(cx, p.h, cz, p.r + .4, 1.6, 'roof', { seg: 10, r2: .4, solid: false });
    },
  },
};

export const prefabDefaults = kind => Object.fromEntries(Object.entries(PREFABS[kind].params).map(([k, v]) => [k, v.def]));
