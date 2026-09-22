/* Загрузчик уровня из JSON (public/levels/<id>.json). Формат — docs/EDITOR.md.
   Строит геометрию, расставляет врагов/предметы/NPC, исполняет триггеры и правила. */
import * as THREE from 'three';
import { SPR } from './sprites.js';
import { billboard, faceCamera } from './world.js';
import { TEX } from './textures.js';
import { PREFABS, prefabDefaults } from './prefabs.js';
import { SFX, setMuffle } from './audio.js';
import { DEFS } from './enemydefs.js';
import { worldWeapon, worldPickup } from './viewmodel3d.js';

const rnd = (a, b) => a + Math.random() * (b - a);
// «любой» в спавнере — все загруженные враги, включая добавленных через public/enemies/index.json

/* Окружения в духе Bonehold: у каждой зоны свой один доминирующий цвет,
   всё остальное проваливается в черноту. Плотный туман съедает даль,
   grade — параметры постобработки (src/engine/post.js) для этой зоны. */
export const DEFAULT_ENVS = {
  // закат над крепостью: багрянец и копоть
  dusk: {
    sky: 'skyDusk', fog: '#1a0a08', fogD: .026, amb: '#8a4e36', ambI: 1.9, hemiSky: '#c05a36', hemiGround: '#241008', hemiI: 1.7,
    grade: { sat: .95, contrast: 1.2, pivot: .26, lift: .03, shadow: '#2a0e0a', light: '#ffd8a8', tint: .5, vig: .62 },
  },
  // ночь над чужим городом: холодный фиолет
  city: {
    sky: 'skyCity', fog: '#05060e', fogD: .034, amb: '#464a7a', ambI: 1.6, hemiSky: '#6060a8', hemiGround: '#0e0e1c', hemiI: 1.5,
    grade: { sat: .86, contrast: 1.22, pivot: .25, lift: .025, shadow: '#101426', light: '#d8d8ff', tint: .55, vig: .66 },
  },
  // склеп: бирюзовый мертвенный свет на почти чёрном
  crypt: {
    sky: 'skyCrypt', fog: '#061014', fogD: .030, amb: '#41707a', ambI: 1.8, hemiSky: '#54a8b4', hemiGround: '#08161c', hemiI: 1.6,
    grade: { sat: .84, contrast: 1.24, pivot: .24, lift: .03, shadow: '#0a2a34', light: '#c8f0e8', tint: .6, vig: .68 },
  },
  // кузня / лавовые залы: оранжевое пекло, силуэты чёрные
  forge: {
    sky: 'skyForge', fog: '#180604', fogD: .030, amb: '#8e3a1c', ambI: 2.0, hemiSky: '#e05a20', hemiGround: '#1a0604', hemiI: 1.8,
    grade: { sat: 1, contrast: 1.24, pivot: .26, lift: .03, shadow: '#2e060a', light: '#ffc888', tint: .58, vig: .66 },
  },
  // залы крепости: свечи и золото
  hall: {
    sky: 'skyCrypt', fog: '#0c0906', fogD: .028, amb: '#8a6c32', ambI: 1.8, hemiSky: '#c89a4e', hemiGround: '#120c08', hemiI: 1.5,
    grade: { sat: .92, contrast: 1.2, pivot: .26, lift: .03, shadow: '#221a0a', light: '#ffe4b0', tint: .5, vig: .64 },
  },
  // день: почти без стилизации — для редактора и осмотра геометрии
  day: {
    sky: 'skyDusk', fog: '#6a5a50', fogD: .010, amb: '#a09080', ambI: 2.4, hemiSky: '#c0a090', hemiGround: '#403020', hemiI: 2.0,
    grade: { sat: 1, contrast: 1.05, pivot: .45, lift: 0, shadow: '#2a2622', light: '#fff4e0', tint: .2, vig: .3 },
  },
};

export function emptyLevel(id = 'new', name = 'Новый уровень') {
  return {
    id, name, version: 1,
    env: 'dusk', envs: structuredClone(DEFAULT_ENVS),
    start: { x: 0, y: 0, z: 6, yaw: 0 },
    bounds: { x0: -40, z0: -40, x1: 40, z1: 40 },
    objective: '',
    objects: [{ t: 'floor', tex: 'grass', x: -40, y: 0, z: -40, w: 80, d: 80 }],
    enemies: [], pickups: [], npcs: [], triggers: [], rules: [],
    next: null,
  };
}

/* ─── построение геометрии (общее для игры и редактора) ─── */
export function buildObject(g, o, L) {
  const w = g.world;
  const opt = o.o || {};
  switch (o.t) {
    case 'box': return w.box(o.x, o.y || 0, o.z, o.w, o.h, o.d, o.tex, opt);
    case 'cyl': return w.cyl(o.x + o.r, o.y || 0, o.z + o.r, o.r, o.h, o.tex, { seg: o.seg || 8, ...opt });
    case 'floor': return w.floor(o.x, o.y || 0, o.z, o.w, o.d, o.tex, opt);
    case 'quad': return w.quad(o.x, o.y, o.z, o.w, o.h, o.tex, o.face || 0, opt);
    case 'blocker': return w.blocker(o.x, o.y || 0, o.z, o.w, o.h, o.d, o.tag);
    case 'wall': return w.wall(o.x0, o.z0, o.x1, o.z1, o.y || 0, o.h ?? 3, o.thick ?? .4, o.tex || 'stone', opt);
    case 'sprite': {
      // плоская картинка: биллборд (всегда к камере) или фиксированная плоскость
      const t = TEX[o.img] || SPR[o.img]?.tex;
      if (!t) { console.warn('нет картинки', o.img); return; }
      const img = t.image; const asp = img && img.width ? img.height / img.width : 1;
      const wM = o.w ?? 1, hM = o.h ?? wM * asp;
      if (o.billboard === false) { w.quad(o.x, (o.y || 0) + hM / 2, o.z, wM, hM, o.img, o.face || 0, { emissive: !!o.emissive }); }
      else {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: .25, side: THREE.DoubleSide, emissive: new THREE.Color(o.emissive ? 0x606060 : 0x000000) }));
        m.geometry.translate(0, hM / 2, 0);
        m.position.set(o.x, o.y || 0, o.z); m.userData.levelObj = true;
        g.scene.add(m); L?.bills?.push(m);
      }
      if (o.solid) w.blocker(o.x - wM / 2, o.y || 0, o.z - .15, wM, hM, .3);
      return;
    }
    case 'light': return w.light(o.x, o.y, o.z, parseColor(o.color ?? '#ffc080'), o.i ?? 2, o.dist ?? 10, { pulse: o.pulse });
    case 'fire': return w.fire(o.x, o.y || 0, o.z, o.size ?? 1, { color: o.color ? parseColor(o.color) : undefined, intensity: o.i, dist: o.dist });
    case 'prefab': {
      const P = PREFABS[o.kind];
      if (!P) { console.warn('неизвестный префаб', o.kind); return; }
      return P.build(g, o.x, o.z, { ...prefabDefaults(o.kind), ...(o.p || {}) }, L);
    }
    default: console.warn('неизвестный объект', o.t);
  }
}
export const parseColor = c => typeof c === 'number' ? c : parseInt(String(c).replace('#', ''), 16);

/* ─── игровой уровень ─── */
export function buildLevel(g, data) {
  const w = g.world;
  const L = { data, triggers: [], pickups: [], npcs: [], bills: [], glows: [], spawners: [], flags: {}, done: false, scene: null, timers: [] };
  w.bounds = data.bounds || { x0: -40, z0: -40, x1: 40, z1: 40 };
  L.start = data.start || { x: 0, y: 0, z: 0, yaw: 0 };
  L.envs = { ...DEFAULT_ENVS, ...(data.envs || {}) };
  for (const o of data.objects || []) buildObject(g, o, L);
  for (const e of data.enemies || []) g.enemies.spawn(e.type, e.x, e.z, { tag: e.tag || null, alerted: !!e.alerted, variant: e.variant, guardR: e.guardR, y: e.y, scale: e.scale, hpMul: e.hpMul, dmgMul: e.dmgMul });
  for (const p of data.pickups || []) L.pickups.push(makePickup(g, L, p));
  /* Предмет, появившийся по ходу боя: так враг роняет своё оружие (см. drop
     в описании врага) и так же работает действие dropGun. */
  L.addPickup = d => { const pk = makePickup(g, L, d); L.pickups.push(pk); return pk; };
  for (const n of data.npcs || []) L.npcs.push(makeNpc(g, L, n));
  for (const t of data.triggers || []) L.triggers.push({ ...t, done: false });
  L.rules = (data.rules || []).map(r => ({ ...r, done: false }));

  g.setEnvironment(L.envs[data.env] || DEFAULT_ENVS.dusk);

  /* Настройки героя прямо в уровне (`player` в JSON) — так сделана песочница:
     { "god": true, "infiniteAmmo": true, "weapons": ["pistol","shotgun"], "slots": 9, "heal": true }
     Ключи god/infiniteAmmo/noclip ложатся в g.mods, weapons выдаются сразу с полным боезапасом. */
  const P = data.player;
  g.player.stepUp = P?.stepUp ?? .5;      // ступенька в 24 юнита нужна картам Doom
  if (P) {
    const p = g.player;
    if (P.slots) p.gunSlots = P.slots;
    for (const k of ['god', 'infiniteAmmo', 'noclip', 'enemiesFrozen']) if (P[k] !== undefined) g.mods[k] = !!P[k];
    if (P.maxHp) { p.maxHp = P.maxHp; p.hp = P.maxHp; }
    for (const k of P.weapons || []) { p.giveWeapon(k); const gn = p.gun(k); if (gn) { gn.mag = p.magSize(k); gn.reserve = p.WEAPONS[k].reserveMax; } }
    if (P.weapons?.length) p.weapon = 'sword';
    if (P.heal !== false) p.hp = p.maxHp;
  }

  L.update = (dt) => {
    const p = g.player;
    for (const t of L.triggers) {
      if (t.done) continue;
      const inside = t.r ? Math.hypot(p.pos.x - t.x, p.pos.z - t.z) < t.r
        : p.pos.x >= t.x0 && p.pos.x <= t.x1 && p.pos.z >= t.z0 && p.pos.z <= t.z1;
      if (t.near && !inside && !t.hinted && Math.hypot(p.pos.x - (t.x ?? (t.x0 + t.x1) / 2), p.pos.z - (t.z ?? (t.z0 + t.z1) / 2)) < t.near) { t.hinted = true; g.hud.hint(t.nearHint || '', 3); }
      if (!inside) continue;
      if (t.if && !L.flags[t.if]) continue;
      if (t.unless && L.flags[t.unless]) continue;
      if (t.once !== false) t.done = true;
      runActions(g, L, t.actions || [], {});
    }
    // ── спавнеры: бесконечная волна, пока игрок в радиусе ──
    for (const sp of L.spawners) {
      sp.alive = sp.alive.filter(e => e.alive);
      if (sp.glow) sp.glow.material.opacity = .35 + Math.sin(g.time * 3 + sp.x) * .2;
      const far = Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z) > sp.near;
      if (far || p.dead) continue;
      sp.t -= dt;
      if (sp.t > 0) continue;
      if (sp.alive.length >= sp.max) { sp.t = .5; continue; }
      if (sp.total && sp.made >= sp.total) continue;
      // потолок на весь уровень: врагов подкидывают понемногу, а не выпускают ораву
      if (g.enemies.alive().length >= (data.maxEnemies ?? 5)) { sp.t = 1.2; continue; }
      sp.t = sp.period;
      const all = Object.keys(DEFS);
      const kind = sp.type === 'любой' ? all[(Math.random() * all.length) | 0] : (DEFS[sp.type] ? sp.type : all[0]);
      // точка в кольце вокруг спавнера, не в стене и не под ногами игрока
      let sx = sp.x, sz = sp.z;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * 6.28, rr = rnd(1.2, sp.r);
        const tx = sp.x + Math.cos(a) * rr, tz = sp.z + Math.sin(a) * rr;
        if (Math.hypot(tx - p.pos.x, tz - p.pos.z) < 2.5) continue;
        if (!g.world.los(sp.x, 1, sp.z, tx, 1, tz)) continue;
        sx = tx; sz = tz; break;
      }
      // держит точку — значит сидит у себя и ждёт, пока игрок подойдёт
      const e = g.enemies.spawn(kind, sx, sz, { alerted: !sp.hold, tag: sp.tag, guardR: sp.hold });
      sp.alive.push(e); sp.made++;
      g.gore.spray(sx, .4, sz, 0, 1, 0, 6, 2, 1);
      g.fx.light(sx, 1, sz, 0xff4020, 3, .25);
    }
    for (const pk of L.pickups) pk.update(dt);
    for (const n of L.npcs) n.update(dt);
    for (const b of L.bills) faceCamera(b, g.camera);
    for (const b of L.glows) faceCamera(b, g.camera);
    if (L.scene) updateBedroom(g, L, dt);
    // правила «зачищено»
    for (const r of L.rules) {
      if (r.done || r.on !== 'clear') continue;
      if (r.if && !L.flags[r.if]) continue;
      if (r.unless && L.flags[r.unless]) continue;
      const tags = r.tags || [r.tag];
      if (tags.every(tag => g.enemies.alive(tag).length === 0) && tags.some(tag => g.enemies.list.some(e => e.tag === tag))) {
        r.done = true; runActions(g, L, r.actions || [], {});
      }
    }
    for (let i = L.timers.length - 1; i >= 0; i--) { L.timers[i].t -= dt; if (L.timers[i].t <= 0) { const f = L.timers[i].fn; L.timers.splice(i, 1); f(); } }
  };
  L.onKill = (e) => {
    for (const r of L.rules) {
      if (r.done || r.on !== 'kill') continue;
      if (r.tag && e.tag !== r.tag) continue;
      if (r.if && !L.flags[r.if]) continue;
      if (r.unless && L.flags[r.unless]) continue;
      if (r.once !== false) r.done = true;
      runActions(g, L, r.actions || [], { enemy: e });
    }
  };
  L.onWake = () => {};
  L.onPickup = (pk) => {
    if (pk.id) L.flags['took:' + pk.id] = true;
    for (const r of L.rules) {
      if (r.done || r.on !== 'pickup' || (r.id && r.id !== pk.id)) continue;
      if (r.once !== false) r.done = true;
      runActions(g, L, r.actions || [], { pickup: pk });
    }
  };
  return L;
}

/* ─── действия ─── */
export const ACTIONS = {
  msg: 'Сообщение {text, dur, red}', hint: 'Подсказка {html, dur}', objective: 'Цель {text}',
  alertTag: 'Разбудить врагов с тегом {tag}', wakeAll: 'Разбудить всех', spawn: 'Создать врага {type, x, z, tag, alerted}',
  killTag: 'Убить врагов {tag}', setEnv: 'Сменить окружение {env}', setFlag: 'Поставить флаг {flag}', clearFlag: 'Снять флаг {flag}',
  bedroomScene: 'Сцена в спальне {dur}', portal: 'Портал {to:{level|x,z,yaw,env}}', dropGun: 'Выложить пистолет {x,z} (или где убит)',
  showPickup: 'Показать предмет {id}', hidePickup: 'Скрыть предмет {id}', npcTalk: 'Реплика NPC {id}', heal: 'Лечение {n}', giveGun: 'Дать пистолет',
  finish: 'Уровень пройден {delay}', slowmo: 'Замедление {scale, dur}', sfx: 'Звук {name}', fade: 'Затемнение {to, dur}', tint: 'Красный оттенок {a}',
};

export function runActions(g, L, actions, ctx) {
  for (const a of actions) {
    if (a.delay) { L.timers.push({ t: a.delay, fn: () => runAction(g, L, { ...a, delay: 0 }, ctx) }); continue; }
    runAction(g, L, a, ctx);
  }
}
function runAction(g, L, a, ctx) {
  const p = g.player;
  switch (a.a) {
    case 'msg': g.hud.msg(a.text || '', a.dur ?? 3, !!a.red); break;
    case 'hint': g.hud.hint(a.html || a.text || '', a.dur ?? 5); break;
    case 'objective': g.hud.objective(a.text || ''); break;
    case 'alertTag': g.enemies.alertTag(a.tag); break;
    case 'wakeAll': for (const e of g.enemies.list) if (e.alive && !e.alerted) e.wake(); break;
    case 'spawn': g.enemies.spawn(a.type || 'peasant', a.x ?? p.pos.x, a.z ?? p.pos.z, { tag: a.tag || null, alerted: a.alerted !== false }); break;
    case 'killTag': for (const e of g.enemies.alive(a.tag)) e.hurt(9999, new THREE.Vector3(0, 0, 1), { heavy: true }); break;
    case 'setEnv': g.setEnvironment(L.envs[a.env] || DEFAULT_ENVS[a.env] || DEFAULT_ENVS.dusk); break;
    case 'setFlag': L.flags[a.flag] = true; break;
    case 'clearFlag': delete L.flags[a.flag]; break;
    case 'bedroomScene': startBedroom(g, L, a.dur ?? 6); break;
    case 'portal': portal(g, L, a.to || {}); break;
    case 'dropGun': {
      const x = a.x ?? ctx.enemy?.pos.x ?? p.pos.x, z = a.z ?? ctx.enemy?.pos.z ?? p.pos.z;
      L.flags.gunDropped = true;
      L.pickups.push(makePickup(g, L, { kind: 'gun', x, z, id: a.id || 'gun', actions: a.actions || [] }));
      g.hud.hint(a.hint ?? 'она обронила пистолет — <b>подойди и возьми</b>', 5);
      break;
    }
    case 'showPickup': L.pickups.filter(pk => pk.id === a.id).forEach(pk => pk.show()); break;
    case 'hidePickup': L.pickups.filter(pk => pk.id === a.id).forEach(pk => pk.hide()); break;
    case 'npcTalk': L.npcs.filter(n => !a.id || n.id === a.id).forEach(n => n.talk()); break;
    case 'heal': p.heal(a.n ?? 25); break;
    case 'giveGun': p.giveWeapon(a.weapon || 'pistol'); break;
    case 'finish': L.timers.push({ t: a.delay ?? 0, fn: () => { if (!L.done) { L.done = true; g.onWin(); } } }); break;
    case 'slowmo': g.slowmo(a.scale ?? .3, a.dur ?? .6); break;
    case 'sfx': SFX[a.name]?.(); break;
    case 'fade': g.fade(a.to ?? 1, a.dur ?? 1); break;
    case 'tint': g.setTint(a.a ?? .3); break;
    default: console.warn('неизвестное действие', a);
  }
}

/* ─── предметы ─── */
const PICKUP_ART = { health: 'pickup_health', ammo: 'pickup_ammo', gun: 'pickup_pistol', shotgun: 'pickup_shotgun', shells: 'pickup_shells', rocket: 'pickup_rocket', rockets: 'pickup_rockets', cloth: 'pickup_cloth' };
const GUN_PICKUPS = ['gun', 'shotgun', 'rocket'];
/* Оружие в мире — объёмная модель, а не картинка: висит в воздухе, крутится
   вокруг своей оси и светится, как в Quake. Так его видно издалека и ни с чем
   не спутать. Патроны, аптечки и улики остаются плоскими спрайтами. */
const PICKUP_MODEL = { gun: 'pistol', shotgun: 'shotgun', rocket: 'rocket' };
/* Аптечки и патроны — тоже объёмные. Плоская картинка рядом с крутящейся
   моделью ствола читалась наклейкой, а в тёмной пещере её не было видно
   вовсе: подбираемое обязано висеть в воздухе, крутиться и светиться. */
const PICKUP_BOX = { health: 'health', ammo: 'ammo', shells: 'shells', rockets: 'rockets' };
export const PICKUP_KINDS = Object.keys(PICKUP_ART);
function makePickup(g, L, def) {
  const kind = def.kind || 'health';
  // враг может уронить свою картинку и свою модель — см. drop в описании врага
  const s = SPR[def.art] || SPR[PICKUP_ART[kind]];
  const size = def.w || (GUN_PICKUPS.includes(kind) ? .7 : kind === 'cloth' ? .55 : .5);
  const modelKind = def.model !== undefined ? def.model : PICKUP_MODEL[kind];
  const spin = modelKind ? worldWeapon(modelKind, size * 1.3)
    : (PICKUP_BOX[kind] ? worldPickup(PICKUP_BOX[kind], size * 1.25) : null);
  const m = spin || billboard(s, size, size * s.h / s.w, { mat: { emissive: new THREE.Color(kind === 'cloth' ? 0x604040 : 0x303030) } });
  const x = def.x, z = def.z;
  const y = def.y ?? g.world.groundAt(x, z, .1, 3);
  // висит на уровне пояса: на полу вещь теряется среди камней и крови
  const HOVER = spin ? .95 : .55;
  m.position.set(x, y + HOVER, z);
  if (spin) m.rotation.z = .22;                    // ствол чуть наклонён — читается объём
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: GUN_PICKUPS.includes(kind) ? 0xffb060 : kind === 'cloth' ? 0xffffff : kind === 'health' ? 0xff4040 : 0xd0c040, opacity: .6 }));
  glow.position.set(x, y + HOVER, z);
  const pk = { id: def.id || null, kind, x, z, y, m, glow, t: rnd(0, 6), taken: false, hidden: !!def.hidden };
  if (!pk.hidden) g.scene.add(m, glow);
  pk.show = () => { if (pk.taken) return; pk.hidden = false; g.scene.add(m, glow); };
  pk.hide = () => { pk.hidden = true; g.scene.remove(m, glow); };
  pk.update = (dt) => {
    if (pk.taken || pk.hidden) return;
    pk.t += dt;
    m.position.y = y + HOVER + Math.sin(pk.t * 3) * .09;
    if (spin) m.rotation.y = pk.t * 1.9; else faceCamera(m, g.camera);
    faceCamera(glow, g.camera);
    glow.material.opacity = .45 + Math.sin(pk.t * 6) * .2;
    const p = g.player;
    if (Math.hypot(p.pos.x - x, p.pos.z - z) < 1.3 && Math.abs(p.pos.y - y) < 1.8) {
      if (kind === 'health' && p.hp >= p.maxHp) return;
      if (kind === 'ammo' && (!p.hasWeapon('pistol') || p.ammoFull('pistol'))) return;
      if (kind === 'shells' && (!p.hasWeapon('shotgun') || p.ammoFull('shotgun'))) return;
      if (kind === 'rockets' && (!p.hasWeapon('rocket') || p.ammoFull('rocket'))) return;
      pk.taken = true; g.scene.remove(m, glow); SFX.pickup();
      if (kind === 'health') { p.heal(def.n ?? 35); g.hud.pop('health'); }
      if (kind === 'ammo') { p.giveAmmo('pistol', def.n ?? 24); g.hud.pop('ammo'); }
      if (kind === 'shells') { p.giveAmmo('shotgun', def.n ?? 8); g.hud.pop('shells'); }
      if (kind === 'gun') { p.giveWeapon('pistol'); L.flags.gun = true; g.hud.pop('gun'); }
      if (kind === 'shotgun') { p.giveWeapon('shotgun'); L.flags.gun = true; L.flags.shotgun = true; g.hud.pop('shotgun'); }
      if (kind === 'rockets') { p.giveAmmo('rocket', def.n ?? 5); g.hud.pop('rockets'); }
      if (kind === 'rocket') { p.giveWeapon('rocket'); L.flags.gun = true; L.flags.rocket = true; g.hud.pop('rocket'); }
      if (kind === 'cloth') { L.flags.clue = true; }
      runActions(g, L, def.actions || [], { pickup: pk });
      L.onPickup(pk);
    }
  };
  return pk;
}

/* ─── NPC ─── */
function makeNpc(g, L, def) {
  const s = SPR[def.sprite || 'knight_idle'];
  const m = billboard(s, .9, 1.8);
  m.position.set(def.x, g.world.groundAt(def.x, def.z, .3, 2), def.z);
  g.scene.add(m);
  g.world.solids.push({ x0: def.x - .3, y0: 0, z0: def.z - .3, x1: def.x + .3, y1: 1.8, z1: def.z + .3, shoot: false, decal: false, tag: 'nonav' });
  const n = { id: def.id || null, m, talked: false, t: 0 };
  n.talk = () => { if (!n.talked) { n.talked = true; g.hud.msg(def.line || '…', def.dur ?? 5); } };
  n.update = (dt) => { n.t += dt; faceCamera(m, g.camera); m.scale.y = 1 + Math.sin(n.t * 2) * .01; };
  return n;
}

/* ─── сцена в спальне ─── */
function startBedroom(g, L, dur) {
  L.scene = { t: 0, dur, heartT: 0 };
  g.player.speedMul = .38;
  setMuffle(true);
  g.setTint(.35);
}
function updateBedroom(g, L, dt) {
  const s = L.scene;
  s.t += dt; s.heartT -= dt;
  if (s.heartT <= 0) { s.heartT = .95 - Math.min(.3, s.t * .04); SFX.heart(); }
  const f = s.t / s.dur;
  g.setTint(f < .8 ? .35 + Math.sin(s.t * 6.6) * .06 : .35 * (1 - (f - .8) / .2));
  if (s.t >= s.dur) { L.scene = null; g.player.speedMul = 1; setMuffle(false); g.setTint(0); }
}

/* ─── портал: внутри уровня или на другой уровень ─── */
function portal(g, L, to) {
  if (L.portalling) return;
  L.portalling = true;
  const p = g.player;
  p.frozen = 2.2; p.vel.set(0, 0, 0);
  SFX.portal();
  g.fade(1, 1.4);
  g.slowmo(.5, 1.2);
  const t0 = performance.now();
  const sink = () => {
    const t = (performance.now() - t0) / 1000;
    p.landDip = Math.min(1.3, t * 1.2); p.roll += .04;
    if (t < 1.4) requestAnimationFrame(sink);
  };
  sink();
  setTimeout(async () => {
    if (to.level) {
      await g.loadLevel(to.level, { keepPlayer: true });
    } else {
      g.teleport(to.x ?? p.pos.x, 0, to.z ?? p.pos.z, to.yaw ?? 0);
      if (to.env) g.setEnvironment(L.envs[to.env] || DEFAULT_ENVS[to.env]);
      g.gore.clearNear(p.pos.x, p.pos.z, 40);
    }
    p.landDip = 0; p.roll = 0; p.pitch = .15; p.frozen = .3;
    setTimeout(() => { g.fade(0, .8); if (to.msg) g.hud.msg(to.msg, 3); if (to.hint) g.hud.hint(to.hint, 4); }, 400);
  }, 1500);
}
