/* Враги. Описания (лист спрайтов, анимации, статы) приходят из enemydefs.js.
   Состояния: idle → chase → attack; pain; stagger (можно добить); dying; headless; dead.
   Ближники не идут в лоб: каждый выбирает угол захода (сбоку/со спины) и меняет его. */
import * as THREE from 'three';
import { SPR, gibsFor, headFor } from './sprites.js';
import { DEFS } from './enemydefs.js';
import { billboard } from './world.js';
import { makeCanvas, sharpFilter } from './textures.js';
import { SFX } from './audio.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const _v = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _prev = new THREE.Vector3();   // «где я был до шага» — без мусора на каждый кадр

/* ═══ зоны попадания ═══
   Кадр спрайта делится на области: доли ширины и высоты кадра, y — сверху вниз,
   как в самом листе (цветные зоны видны в <name>_template.png). Значения можно
   переопределить в <name>.json полем `parts` — под свою отрисовку персонажа. */
export const DEFAULT_PARTS = {
  head: [0.39, 0.11, 0.61, 0.29],     // компактная: попасть в голову должно быть непросто
  armL: [0.13, 0.19, 0.40, 0.66],
  armR: [0.60, 0.19, 0.87, 0.66],
  legL: [0.27, 0.62, 0.51, 1.00],
  legR: [0.49, 0.62, 0.73, 1.00],
};

/* ═══ прочность зон ═══
   У каждой зоны свой запас, который тратится отдельно от здоровья бойца: рука
   отваливается, когда её добили, а не по броску кубика.

   `hp` — запас зоны в единицах урона. Он намеренно НЕ равен доле здоровья: иначе
   оторвать руку значило бы всадить в неё почти всё здоровье врага, а он к тому
   моменту уже мёртв. Числа абсолютные и подогнаны под оружие игрока (пистолет 34,
   лёгкий замах 40, тяжёлый 75), с поправкой на живучесть врага — см. partScale().

   `pass` — какая доля урона доходит до самого бойца при попадании в эту зону.
   Прострелить руку менее смертельно, чем грудь, и именно это даёт калечить живого:
   зона копит полный урон, а здоровье — только часть.

   `factor` — во сколько раз тип урона эффективнее по этой зоне: рубящий снимает
   конечность в разы быстрее пули, пинок ломает ноги, дробь рвёт голову.

   Переопределяется у врага: "parts": { "armR": { "box": [...], "hp": 70,
   "factor": { "cut": 6 } } }. Старая запись parts как [x0,y0,x1,y1] тоже работает. */
export const PART_DEF = {
  head: { hp: 55, pass: 1.00, factor: { bullet: 1.5, shotgun: 2.2, melee: 1.3, cut: 2.2, kick: 1.2, explosion: 1.6 } },
  armL: { hp: 58, pass: 0.45, factor: { bullet: 1.0, shotgun: 1.4, melee: 1.2, cut: 2.6, kick: 1.0, explosion: 2.2 } },
  armR: { hp: 58, pass: 0.45, factor: { bullet: 1.0, shotgun: 1.4, melee: 1.2, cut: 2.6, kick: 1.0, explosion: 2.2 } },
  legL: { hp: 80, pass: 0.50, factor: { bullet: 1.0, shotgun: 1.4, melee: 1.2, cut: 2.6, kick: 1.75, explosion: 2.2 } },
  legR: { hp: 80, pass: 0.50, factor: { bullet: 1.0, shotgun: 1.4, melee: 1.2, cut: 2.6, kick: 1.75, explosion: 2.2 } },
};
/* Насколько крепче зоны у живучего врага. Корень, а не прямая пропорция: у рыцаря
   (260 hp) конечности вдвое крепче, чем у крестьянина (70), а не вчетверо —
   иначе тяжёлого врага пришлось бы пилить по руке весь бой. За единицу взят
   стражник с 95 hp. */
const partScale = maxHp => Math.sqrt(Math.max(30, maxHp) / 95);

/* Тип урона одной строкой — по нему зона берёт множитель. Оружие может задать
   его прямо (o.dt), иначе он выводится из того, что уже передаётся в hurt(). */
export function damageTypeOf(o = {}) {
  if (o.dt) return o.dt;
  if (o.kick) return 'kick';
  if (o.melee) return o.heavy ? 'cut' : 'melee';   // тяжёлый замах рубит, лёгкий бьёт
  if (o.gib || o.shotgun) return 'shotgun';
  if (o.bullet) return 'bullet';
  return 'generic';
}

/* Рамки зон без настроек прочности: нужны и движку, и шаблону для художника. */
export function partBoxes(def) {
  const out = { ...DEFAULT_PARTS };
  for (const [k, v] of Object.entries(def?.parts || {})) {
    // null/false у зоны — её просто нет: у четвероногой туши не отстрелить руку
    if (v === null || v === false) { delete out[k]; continue; }
    const box = Array.isArray(v) ? v : v?.box;
    if (box) out[k] = box;
  }
  return out;
}
// какой гиб улетает вместо отстреленной части
const PART_GIB = {
  armL: { m: 'gib_arm', f: 'gib_armW' },
  armR: { m: 'gib_arm', f: 'gib_armW' },
  legL: { m: 'gib_leg', f: 'gib_legW' },
  legR: { m: 'gib_leg', f: 'gib_legW' },
};
const LIMBS = ['armL', 'armR', 'legL', 'legR'];
const ARMS = ['armL', 'armR'];
/* Ноги не стираются из кадра: у них свои кадры — hop0/hop1 (скачет на одной)
   и crawl0/crawl1 (ползёт). Маской вырезаются только руки. */
const MASK_PARTS = ARMS;

let idc = 0;
export class Enemy {
  constructor(mgr, typeName, x, z, o = {}) {
    this.mgr = mgr; this.g = mgr.g;
    this.def = DEFS[typeName];
    this.type = { ...this.def.stats, r: this.def.radius, w: this.def.size[0], h: this.def.size[1], set: this.def.name };
    // модификаторы из настроек игры
    const M = this.g.mods || {};
    this.type.hp = Math.max(1, Math.round(this.type.hp * (M.enemyHp ?? 1)));
    /* Броня — доля урона, которую держит шкура или доспех крупной твари
       (stats.armor, 0…0.85). Не абсолютна: см. armorOf(). */
    this.type.armor = Math.max(0, Math.min(.85, this.type.armor ?? 0));
    this.type.speed *= M.enemySpeed ?? 1;
    this.type.alertR *= M.enemyAlert ?? 1;
    if (this.type.melee) this.type.melee = { ...this.type.melee, dmg: this.type.melee.dmg * (M.enemyDmg ?? 1) };
    if (this.type.ranged) this.type.ranged = { ...this.type.ranged, dmg: this.type.ranged.dmg * (M.enemyDmg ?? 1) };
    /* Предпочтительная дистанция боя. В описаниях она есть не у всех стрелков
       (doomовские зомби, сержант, коммандо её не задают), а боевое поведение её
       разбирает как пару [мин, макс]. Без значения по умолчанию стрелок ронял
       кадр исключением на каждом шаге прицеливания. Держимся в четверти—половине
       своей дальности: автоматчик подходит, но не лезет вплотную. */
    if (this.type.ranged && !this.type.prefer) { const R = this.type.ranged.range; this.type.prefer = [R * .25, R * .5]; }
    if (M.flanking === false) this.type.flank = [0];
    /* Порог «красного»: ниже этой доли здоровья боец валится добиваемым.
       С оторванной конечностью он держится хуже — порог выше. */
    this.finishAt = M.finishAt ?? .1;
    this.typeName = typeName;
    this.id = idc++;
    this.variant = o.variant ?? (Math.random() * this.def.variants | 0);
    this.tag = o.tag || null;
    // o.y — на каком уровне ставить (второй этаж, галерея); по умолчанию пол
    this.pos = new THREE.Vector3(x, this.g.world.groundAt(x, z, .3, (o.y ?? 0) + 2.5), z);
    /* Пост охраны: если задан радиус, боец не бежит за игроком по всему уровню,
       а держит точку появления и возвращается на неё. 0 — преследует везде.
       Задаётся у врага в редакторе (guardR) или по умолчанию в stats.guardR. */
    this.home = new THREE.Vector3(x, this.pos.y, z);
    this.guardR = o.guardR ?? this.def.stats.guardR ?? 0;
    /* Мини-босс — тот же боец, но крупнее и живучее: отдельного описания
       под него нет, а заводить копию врага ради множителей незачем.
       Масштаб трогает размеры (спрайт, радиус, зоны попадания считаются
       от type.w/h), а не только запас здоровья: раздутая туша обязана
       и мешать проходу, и получать по корпусу с той же лёгкостью. */
    if (o.scale && o.scale !== 1) {
      this.type.w *= o.scale; this.type.h *= o.scale;
      this.type.r *= Math.min(o.scale, 1.4);
    }
    if (o.hpMul) this.type.hp = Math.max(1, Math.round(this.type.hp * o.hpMul));
    if (o.dmgMul) {
      if (this.type.melee) this.type.melee = { ...this.type.melee, dmg: this.type.melee.dmg * o.dmgMul };
      if (this.type.ranged) this.type.ranged = { ...this.type.ranged, dmg: this.type.ranged.dmg * o.dmgMul };
    }
    this.hp = this.type.hp; this.maxHp = this.type.hp;
    this.state = 'idle'; this.stateT = 0;
    this.alerted = !!o.alerted;
    this.frame = null; this.animT = Math.random() * 2; this.anim = 'idle';
    this.kvx = 0; this.kvz = 0;
    this.path = null; this.pathT = 0; this.pathI = 0; this.pathFailT = 0;
    this.attackCd = rnd(0, .5); this.burst = 0; this.burstT = 0; this.aimT = 0;
    this.strafeDir = Math.random() < .5 ? -1 : 1; this.strafeT = rnd(.5, 1.5);
    this.painT = 0; this.staggerT = 0; this.staggered = false; this.usedStagger = false;
    this.mortal = false;                                 // «красный»: оглушён насмерть, добивается любым попаданием
    this.hits = 0; this.fightT = 0;                      // сколько раз попали и сколько длится бой
    this.tacticT = rnd(1, 2.5);                          // когда раненый снова оценит обстановку
    this.lungeT = 0; this.lungeCd = 0;
    this.dead = false; this.alive = true;
    this.headless = false; this.fountainT = 0;
    this.kvy = 0; this.airborne = false;                 // подброс от дробовика
    this.knockNoStagger = false;                         // падение от взрыва не оглушает
    this.lost = new Set();                               // отстреленные части
    this.maskCanvas = null; this.maskTex = null;
    this.parts = partBoxes(this.def);
    /* Запас прочности каждой зоны и её чувствительность к типам урона.
       hp в описании врага: доля от его здоровья (<= 3) или прямое число (> 3). */
    this.partHp = {}; this.partMax = {}; this.partFactor = {}; this.partPass = {};
    const scale = partScale(this.maxHp);
    for (const [k, D] of Object.entries(PART_DEF)) {
      if (!this.parts[k]) continue;
      const cfg = this.def.parts?.[k];
      const own = Array.isArray(cfg) ? null : cfg;
      const raw = own?.hp;
      // hp <= 3 в описании врага — доля от его здоровья, больше — прямое число урона
      const base = raw == null ? D.hp * scale : (raw <= 3 ? raw * this.maxHp : raw);
      this.partMax[k] = this.partHp[k] = Math.max(1, Math.round(base * (this.type.partHp ?? 1)));
      this.partFactor[k] = { ...D.factor, ...(own?.factor || {}) };
      this.partPass[k] = own?.pass ?? D.pass;
    }
    this.legState = 'both';                              // 'both' | 'hop' | 'crawl'
    this.shieldHp = this.type.shield ? this.type.shield.hp : 0;
    this.shieldMesh = null; this.shieldRect = null;
    this.token = null; this.tokenT = 0; this.slot = -1;   // координация боя (см. Director)
    this.jit = 'hold'; this.jitT = rnd(0, .5);           // дёрганое поведение вблизи
    this.postT = 0;
    this.crouched = false; this.coverPt = null; this.coverT = 0; this.peekT = 0; this.coverRunT = 0;
    this.fake = false;                                    // сдаётся понарошку
    this.tac = this.type.tactics || {};
    this.wanderA = Math.random() * 6.28; this.wanderT = 0;
    // угол захода относительно взгляда игрока: 0 — в лоб, ±π/2 — сбоку, π — со спины
    this.flank = pick(this.type.flank || [0]); this.flankT = rnd(2, 4);
    this.mesh = billboard(SPR[this.sprName(this.animFrame('idle', 0))], this.type.w, this.type.h);
    this.setAnim('idle');
    this.mesh.position.copy(this.pos);
    this.g.scene.add(this.mesh);
    this.lastSeen = null;
    this.buildShield();
  }
  /* Щит — отдельный биллборд поверх бойца, а не часть кадра: его легко заменить
     своей картинкой (public/enemies/shield.png), он ломается отдельно и, главное,
     падает вместе с рукой, которая его держит. */
  buildShield() {
    const S = this.type.shield; if (!S) return;
    this.shieldFrames = S.frames || 1;
    this.shieldMax = S.hits || 6;                 // сколько ударов держит
    this.shieldTaken = 0;
    const spr = this.shieldSprite(0);
    if (!spr) return;
    const w = S.w || .92, h = w * spr.h / spr.w;
    this.shieldW = w; this.shieldH = h;
    this.shieldMesh = billboard(spr, w, h, { mat: { alphaTest: .22 } });
    this.shieldMesh.renderOrder = 2;
    this.g.scene.add(this.shieldMesh);
    this.shieldArm = S.arm || 'armR';
    this.shieldHp = 1;
    this.shieldOff = S.off || [.3, .48];
    const T = this.type;
    const cx = .5 + this.shieldOff[0], cy = 1 - this.shieldOff[1];
    const hw = w / T.w / 2, hh = h / T.h / 2;
    this.shieldRect = [cx - hw, cy - hh, cx + hw, cy + hh];
  }
  // картинка щита для текущей стадии повреждения
  shieldSprite(stage) {
    const S = this.type.shield; if (!S) return null;
    if (S.img) {
      const i = Math.min(this.shieldFrames - 1, stage);
      return SPR[`shield:${S.img}#${i}`] || SPR[`shield:${S.img}#0`] || SPR.shield_kite;
    }
    return SPR.shield_kite;
  }
  /* Принятый щитом удар: щербина на картинке, искры, иногда мгновенный ответ.
     Набрал свой лимит — просто пропадает, руку с собой не забирает. */
  shieldHit(dir, o) {
    const g = this.g;
    this.shieldTaken++;
    const m = this.shieldMesh;
    g.fx.sparks(m.position.x, m.position.y, m.position.z, [-dir.x, .3, -dir.z], o.melee ? 10 : 6);
    SFX.ricochet();
    this.alerted = true;
    if (o.by) this.remember(o.by.pos);
    if (this.shieldTaken >= this.shieldMax) { this.dropShield(dir, true); this.attackCd = .3; return; }
    // следующая стадия: скол, трещина, выломанный край
    const stage = Math.floor(this.shieldTaken / this.shieldMax * this.shieldFrames);
    const spr = this.shieldSprite(stage);
    if (spr) m.material.map = spr.tex;
    g.gore.gib('gib_shieldPiece', m.position.x, m.position.y, m.position.z, -dir.x * 2 + rnd(-2, 2), rnd(1.5, 3.5), -dir.z * 2 + rnd(-2, 2), rnd(.1, .18), { trail: false, bounce: .5 });
    // отбил меч — может сразу контратаковать и оттолкнуть
    if (o.melee && o.by) {
      const T = this.type;
      if (T.melee && Math.random() < (T.shield?.parry ?? .3)) { this.state = 'attack'; this.stateT = T.melee.windup * .55; this.setAnim('attack', T.melee.windup * .45); }
      o.by.vel.x -= dir.x * 5; o.by.vel.z -= dir.z * 5;
      o.by.kickPitch -= .025;
    }
    if (o.knock) { this.kvx += dir.x * o.knock * .2; this.kvz += dir.z * o.knock * .2; }
  }

  // щит улетает: сломали или оторвало держащую руку
  dropShield(dir, broken) {
    if (!this.shieldMesh) return;
    const g = this.g, m = this.shieldMesh;
    const d = dir || { x: 0, z: 1 };
    if (broken) {
      // развалился окончательно: только обломки, целого щита уже нет
      for (let i = 0; i < 6; i++) g.gore.gib('gib_shieldPiece', m.position.x, m.position.y, m.position.z, rnd(-5, 5), rnd(2, 6), rnd(-5, 5), rnd(.16, .3), { trail: false, bounce: .55 });
      g.fx.sparks(m.position.x, m.position.y, m.position.z, [d.x, .3, d.z], 16);
    } else {
      // выпал из руки целым
      g.gore.gib('gib_shield', m.position.x, m.position.y, m.position.z, d.x * 2 + rnd(-1.5, 1.5), rnd(1.5, 3), d.z * 2 + rnd(-1.5, 1.5), .55, { trail: false, bounce: .5 });
    }
    g.scene.remove(m);
    m.geometry?.dispose?.();
    this.shieldMesh = null; this.shieldRect = null; this.shieldHp = 0;
    SFX.thud();
  }

  sprName(frame) { return `${this.def.name}${this.variant}_${frame}`; }
  animFrame(anim, i) {
    const a = this.def.anims[anim] || this.def.anims.attack || this.def.anims.idle;
    return a.frames[Math.min(a.frames.length - 1, i)];
  }
  // играть анимацию: зацикленную (walk) или растянутую на dur секунд (attack/pain)
  /* Подменяем анимацию под состояние ног: на одной ноге боец скачет, без ног — ползёт.
     Если в листе нет соответствующих кадров, остаётся обычная ходьба. */
  // запомнить, где в последний раз видели героя (вектор переиспользуется)
  remember(v) { (this.lastSeen || (this.lastSeen = new THREE.Vector3())).copy(v); }
  remapAnim(n) {
    const A = this.def.anims;
    const L = this.legState;
    if (L !== 'both') {
      if (L === 'crawl') return A.crawl ? 'crawl' : n;
      if (n === 'walk' || n === 'idle') return A.hop ? 'hop' : n;
      /* Замах и боль на одной ноге: если в листе есть свои кадры (attackHop,
         painHop), играем их. Иначе боец скачет на культе, но бьёт кадром
         целого — руки и ноги в анимации перестают сходиться. */
      return A[n + 'Hop'] ? n + 'Hop' : n;
    }
    /* Потерянные руки: если в листе есть готовый кадр «без руки» (как отдельные
       спрайты в думовских модах), играем его. Ищем вариант именно этой анимации
       (painNoArmR, attackNoArmL), а для ходьбы и стойки — общий walkNoArm*.
       Нет таких кадров — остаётся вырезание из кадра на лету, см. maskNeeded. */
    const suf = this.armState;
    if (suf) {
      if (A[n + suf]) return n + suf;
      if ((n === 'walk' || n === 'idle') && A['walk' + suf]) return 'walk' + suf;
    }
    return n;
  }
  /* Суффикс состояния рук: 'NoArmR' | 'NoArmL' | 'NoArms' (null — руки целы). */
  get armState() {
    const l = this.lost.has('armL'), r = this.lost.has('armR');
    if (l && r) return 'NoArms';
    if (r) return 'NoArmR';
    if (l) return 'NoArmL';
    return null;
  }
  // есть ли в листе готовые кадры под это состояние рук
  get hasArmFrames() { const s = this.armState; return !!(s && this.def.anims['walk' + s]); }
  setAnim(name, dur) {
    name = this.remapAnim(name);
    if (this.anim !== name) { this.anim = name; this.animT = 0; this.animDur = dur || 0; }
    else if (dur) this.animDur = dur;
    this.applyAnim(0);
  }
  applyAnim(dt) {
    const a = this.def.anims[this.anim] || this.def.anims.idle;
    this.animT += dt;
    let i;
    if (this.animDur > 0) i = Math.floor(Math.min(.999, this.animT / this.animDur) * a.frames.length);
    else i = Math.floor(this.animT * (a.fps || 6)) % a.frames.length;
    const frame = a.frames[i];
    if (frame !== this.frame) {
      const s = SPR[this.sprName(frame)];
      if (s) { this.frame = frame; if (this.maskNeeded) this.redrawMask(s); else this.mesh.material.map = s.tex; }
    }
  }

  /* Перерисовать кадр без отстреленных частей: копия спрайта, из которой вырезаны
     области рук (this.parts), а на срезах дорисованы культи. Ноги не стираются —
     у них свои кадры hop/crawl. Делается только при смене кадра
     (6–9 раз в секунду на врага), поэтому дёшево. */
  redrawMask(s) {
    if (!this.maskCanvas || this.maskCanvas.width !== s.w || this.maskCanvas.height !== s.h) {
      this.maskCanvas = makeCanvas(s.w, s.h);
      this.maskTex?.dispose?.();
      this.maskTex = sharpFilter(new THREE.CanvasTexture(this.maskCanvas));
    }
    const c = this.maskCanvas, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(s.canvas, 0, 0);
    for (const part of this.lost) {
      if (!MASK_PARTS.includes(part)) continue;          // ноги и щит живут отдельно
      const r = this.parts[part]; if (!r) continue;
      const X = r[0] * c.width, Y = r[1] * c.height, Wd = (r[2] - r[0]) * c.width, Hd = (r[3] - r[1]) * c.height;
      x.clearRect(X, Y, Wd, Hd);
      // культя на срезе: тёмное мясо и несколько брызг
      const stumpY = Y + 2;
      const sx = part === 'armL' ? X + Wd - 6 : X;
      x.fillStyle = '#7a0408'; x.fillRect(sx, stumpY, 7, part.startsWith('leg') ? 10 : 12);
      x.fillStyle = '#c01014'; x.fillRect(sx + 1, stumpY + 1, 5, 4);
      x.fillStyle = '#e8e0d0'; x.fillRect(sx + 2, stumpY + 5, 2, 3);
      for (let i = 0; i < 6; i++) { x.fillStyle = '#9a0a0c'; x.fillRect(sx + (Math.random() * 8 | 0) - 2, stumpY + 8 + (Math.random() * 16 | 0), 2, 2); }
    }
    this.maskTex.needsUpdate = true;
    this.mesh.material.map = this.maskTex;
  }

  /* Определить зону попадания по точке в мире. Спрайт всегда развёрнут к камере,
     поэтому «вправо по кадру» — это ось, перпендикулярная взгляду. */
  partAt(hx, hy, hz) {
    const ry = this.mesh.rotation.y;
    const rx = Math.cos(ry), rz = -Math.sin(ry);              // локальная ось +X биллборда в мире
    const fx = .5 + ((hx - this.pos.x) * rx + (hz - this.pos.z) * rz) / this.type.w;
    const fy = 1 - (hy - this.pos.y) / this.type.h;
    if (fy < 0 || fy > 1.02) return 'torso';
    const inside = r => fx >= r[0] && fx <= r[2] && fy >= r[1] && fy <= r[3];
    if (this.shieldMesh && this.shieldRect && inside(this.shieldRect)) return 'shield';
    if (inside(this.parts.head)) return 'head';
    // ползущему и скачущему по ногам уже не попасть — их кадры другие
    for (const k of LIMBS) {
      if (this.lost.has(k)) continue;
      if (k.startsWith('leg') && this.legState !== 'both') continue;
      if (inside(this.parts[k])) return k;
    }
    return 'torso';
  }
  // по чему реально можно попасть: тело нарисовано шире радиуса столкновений
  get hitR() { return this.type.r * 1.3; }
  get maskNeeded() {
    if (this.hasArmFrames) return false;            // в листе есть нарисованный кадр — режем не мы
    for (const k of MASK_PARTS) if (this.lost.has(k)) return true;
    return false;
  }
  // верх коллизии: присел, скачет на одной или ползёт — цель заметно ниже
  get hitTop() {
    const k = this.legState === 'crawl' ? .34 : this.legState === 'hop' ? .93 : this.crouched ? .62 : 1;
    return this.pos.y + this.type.h * k;
  }
  get armsLost() { return this.lost.has('armL') && this.lost.has('armR'); }
  get legsLost() { return this.legState === 'crawl'; }
  speedMul() { return this.legState === 'crawl' ? .16 : this.legState === 'hop' ? .5 : 1; }

  /* Оторвать конечность: кусок улетает, культя фонтанирует, боец слабеет. */
  severPart(part, dir) {
    if (this.lost.has(part) || !PART_GIB[part]) return;
    // ноге нужны свои кадры: нет hop/crawl в листе — ногу не отрываем,
    // иначе боец остался бы стоять на двух ногах с оторванной
    /* Ноге нужны свои кадры: hop — скакать на одной, crawl — ползти без обеих.
       Если их в листе нет (думовские наборы), ногу всё равно отрываем, но тогда
       боец не встаёт: кусок улетает, и он падает замертво. Это лучше, чем совсем
       не отрывать — рубить по ногам должно быть за что. */
    let fatal = false;
    if (part.startsWith('leg')) {
      if (this.legState === 'crawl') return;
      const A = this.def.anims;
      if (!A.hop) fatal = true;
      else if (this.legState === 'hop' && !A.crawl) fatal = true;
    }
    this.lost.add(part);
    const g = this.g, T = this.type;
    const r = this.parts[part];
    const ry = this.mesh.rotation.y, ax = Math.cos(ry), az = -Math.sin(ry);
    const off = ((r[0] + r[2]) / 2 - .5) * T.w;
    const gx = this.pos.x + ax * off, gz = this.pos.z + az * off;
    const gy = this.pos.y + T.h * (1 - (r[1] + r[3]) / 2);
    const name = this.gibSpr(PART_GIB[part][T.female ? 'f' : 'm']);
    g.gore.gib(name, gx, gy, gz, dir.x * rnd(3, 6) + rnd(-2, 2), rnd(2.5, 5.5), dir.z * rnd(3, 6) + rnd(-2, 2), rnd(.34, .46), { trail: true, bounce: .3 });
    g.gore.spray(gx, gy, gz, dir.x, .4, dir.z, 60, 5, 1.4);
    g.gore.fountain(gx, gy, gz, 14);
    g.gore.splashDir(gx, gy, gz, dir.x, 0, dir.z, 1.2);
    g.gore.floorSplat(gx, this.pos.y, gz, rnd(.7, 1.2), .3);
    // без руки роняет оружие и щит, без обеих — драться уже нечем
    if (part.startsWith('arm')) {
      this.dropWeapon(gx, this.pos.y, gz);
      if (this.shieldMesh && (part === this.shieldArm || this.armsLost)) this.dropShield(dir, false);
      if (this.armsLost) { this.type.melee = null; this.type.ranged = null; }
      else if (this.type.melee) this.type.melee = { ...this.type.melee, dmg: this.type.melee.dmg * .55 };
    }
    // ноги: одну отстрелили — скачет, обе — ползёт
    if (part.startsWith('leg') && !fatal) {
      const n = (this.lost.has('legL') ? 1 : 0) + (this.lost.has('legR') ? 1 : 0);
      this.legState = n >= 2 ? 'crawl' : 'hop';
      this.crouched = false;
      this.anim = null; this.setAnim('walk');
      if (this.legState === 'crawl') {
        // упасть на землю: подброс и рывок больше не нужны
        this.kvx *= .3; this.kvz *= .3; this.token = null;
        g.gore.floorSplat(this.pos.x, this.pos.y, this.pos.z, 1.4, .3);
      }
    }
    if (this.maskNeeded && this.frame) { const s = SPR[this.sprName(this.frame)]; if (s) this.redrawMask(s); }
    SFX.chop();
    this.type.female ? SFX.scream(1.25) : SFX.grunt(1.15);
    if (fatal && this.alive) this.die(dir, { melee: true });
  }

  get center() { return _v.set(this.pos.x, this.pos.y + this.type.h * .55, this.pos.z); }
  /* Куски тела: общий мясной набор плюс то, что дописано врагу в gibExtra
     (крестьянская шляпа, обломок брони — что угодно). */
  gibNames() {
    const g = this.def.gibs;
    const base = gibsFor(g === 'female' ? 'woman' : g === 'meat' ? 'meat' : 'peasant');
    const extra = this.def.gibExtra;
    return (extra?.length ? base.concat(extra) : base).map(n => this.gibSpr(n));
  }
  /* Расчленёнка общая для всех — мясо, кости, конечности из одного набора.
     Врагу можно подменить любой кусок своей картинкой (`gibFiles` в описании):
     тогда вместо общего имени берётся его собственное. */
  gibSpr(name) { return this.def.gibMap?.[name] || name; }

  /* ─── что остаётся после врага ───
     Только то, что записано ему в `drop`: вещи ложатся картинкой рядом с телом,
     оружие превращается в подбираемый предмет. Ничего не записано — не остаётся
     ничего: у зверя и у чужого монстра вил в руках нет. */
  dropItems(x, y, z, spread = 1) {
    const items = this.def.drop?.items;
    if (!items?.length) return;
    for (const it of items) {
      if (it.chance != null && Math.random() > it.chance) continue;
      for (let i = 0; i < (it.n || 1); i++) {
        const a = Math.random() * 6.28, r = rnd(.35, .9) * spread;
        this.g.gore.lay(it.spr, x + Math.cos(a) * r, y, z + Math.sin(a) * r, it.w || .5);
      }
    }
  }
  /* Оружие падает один раз: или из отрубленной руки, или из мёртвых рук —
     второй раз тот же ствол выпасть уже не может. */
  dropWeapon(x, y, z) {
    const w = this.def.drop?.weapon;
    if (!w || this.weaponDropped) return;
    this.weaponDropped = true;
    this.g.level?.addPickup?.({
      kind: w.kind || 'ammo', n: w.n, art: w.spr, model: w.model, w: w.w,
      x: x + rnd(-.3, .3), y, z: z + rnd(-.3, .3),
    });
  }
  /* Голова, которая отлетает при обезглавливании. `head` в описании врага:
     'male'/'female' — человеческая из набора, имя спрайта — своя картинка,
     ничего — значит лица у него нет (зверь, чужой монстр) и летит череп. */
  headName() {
    const h = this.def.head;
    // ни лица, ни черепа: у чужого монстра отлетает просто кусок туши
    if (!h) return this.gibSpr(pick(['gib_meat0', 'gib_meat2']));
    if (h !== 'male' && h !== 'female') return SPR[h] ? h : this.gibSpr('gib_meat0');
    return this.gibSpr(headFor(h === 'female' ? 'woman' : 'peasant'));
  }

  /* Сколько урона съедает броня (доля 0…0.85). Она никогда не абсолютна:
     в голову держит вдвое хуже, дробь в упор рвёт стыки (o.sever), тяжёлый
     замах рубит её пополам, а крит дробовика и удар о стену игнорируют вовсе.
     Так крупную тварь по-прежнему можно убить — но не расстрелом издалека. */
  armorOf(part, o, dt) {
    let a = this.type.armor || 0;
    if (!a || o.gib || o.wall) return 0;
    if (part === 'head') a *= .5;
    if (dt === 'cut') a *= .5;
    a *= 1 - Math.min(.8, (o.sever ?? 0) * 1.4);
    return Math.max(0, Math.min(.85, a));
  }
  /* Два разных оглушения. Пинок и удар о стену просто сбивают с ног — боец
     оглушён, но цел. Измотанный падает «красным» (mortal): это финал схватки —
     его добивает любое следующее попадание. Цветом они и различаются. */
  // снять «красную» подсветку: труп, казнь и падение не должны светиться
  clearTint() {
    const m = this.mesh; if (!m?.material) return;
    m.rotation.z = 0; m.material.color.setRGB(1, 1, 1); m.material.emissive?.setRGB(0, 0, 0);
  }
  enterStagger(dur, mortal = false) {
    this.state = 'stagger'; this.stateT = 0;
    this.staggered = true; this.staggerT = Math.max(this.staggerT, dur);
    if (mortal) { this.mortal = true; this.usedStagger = true; }
    this.setAnim('pain');
  }
  /* Падение после подброса или удара о стену. Обычно боец остаётся лежать
     оглушённым, но если его раскидал взрыв — только коротко морщится и встаёт:
     ракетница не должна оставлять за собой ряд качающихся мишеней. */
  knockdown(dur) {
    if (this.knockNoStagger) {
      // раскидало взрывом: встал и пошёл дальше, без паузы и без качания
      this.state = 'chase'; this.stateT = 0; this.setAnim('walk');
      return;
    }
    this.enterStagger(dur, this.hp < this.maxHp * this.finishAt * 1.8);
  }

  /* ─── урон ─── */
  hurt(dmg, dir, o = {}) {
    if (!this.alive || this.state === 'executed') return;
    const g = this.g;
    const hy = o.hitY ?? this.pos.y + this.type.h * (o.headshot ? .88 : rnd(.45, .75));
    // куда именно попали: голова / рука / нога / корпус / щит
    const part = o.part || (o.hitPoint ? this.partAt(o.hitPoint.x, o.hitPoint.y, o.hitPoint.z) : (o.headshot ? 'head' : 'torso'));

    // ── щит ловит только то, что реально им закрыто ──
    if (this.shieldMesh && part === 'shield') { this.shieldHit(dir, o); return; }

    g.gore.spray(this.pos.x, hy, this.pos.z, dir.x, dir.y + .2, dir.z, Math.min(70, 10 + dmg * .7), o.melee ? 5.5 : 4, o.melee ? 1.4 : .8);
    g.gore.splashDir(this.pos.x, hy, this.pos.z, dir.x, dir.y, dir.z, .6 + dmg / 80);
    g.gore.floorSplat(this.pos.x + dir.x * .5, this.pos.y, this.pos.z + dir.z * .5, .4 + dmg / 90);
    /* ── зона копит урон отдельно от здоровья ──
       Попадание тратит запас самой руки/ноги/головы, умноженный на её
       чувствительность к этому типу урона, а до здоровья доходит только доля
       (partPass): прострелить руку менее смертельно, чем грудь, — потому и можно
       отстрелить её живому. Кончился запас зоны — она отрывается.
       o.sever (дробь в упор) добивает зону быстрее. */
    const dt = damageTypeOf(o);
    const zone = this.partHp[part] > 0 && !this.lost.has(part) ? part : null;
    if (zone) {
      const F = this.partFactor[zone];
      this.partHp[zone] -= dmg * (F[dt] ?? F.generic ?? 1) * (1 + (o.sever ?? 0) * 2);
      dmg *= this.partPass[zone] ?? 1;
    }
    dmg *= 1 - this.armorOf(part, o, dt);
    /* «Красный» — это уже приговор, а не ещё одна полоска здоровья: любое
       попадание по оглушённому насмерть бойцу его добивает, из чего бы ни
       стреляли. Обычное оглушение (пинок, удар о стену) так не работает. */
    const finishing = this.mortal && this.state === 'stagger';
    this.hp -= dmg;
    if (finishing && this.hp > 0) { this.hp = 0; o = { ...o, finish: true }; }
    g.hud.damageNumber?.(this, dmg, part);
    const broke = !!zone && this.partHp[zone] <= 0;
    // расстрелянная голова считается хедшотом: тело упадёт с фонтаном, а не просто ляжет
    if (broke && zone === 'head' && this.hp <= 0) o = { ...o, headshot: true };
    // меч в голову — критическое попадание: голова с плеч
    if (part === 'head' && o.melee && this.alive && this.hp > 0 && Math.random() < (o.critHead ?? .45)) { this.decapitate(dir); return; }

    if (o.knock) { this.kvx += dir.x * o.knock; this.kvz += dir.z * o.knock; }
    if (o.launch) { this.kvy = Math.max(this.kvy, o.launch); this.airborne = true; }
    /* Кто толкнул — тот и решает, оглушает ли падение. Взрыв (o.noStagger)
       раскидывает тела, но бойцы вскакивают и идут дальше; пинок и дробовик
       роняют, как и раньше. Флаг живёт до ближайшего приземления. */
    if (o.knock || o.launch) this.knockNoStagger = !!o.noStagger;
    this.alerted = true;
    this.hits++;
    if (o.by) this.remember(o.by.pos);
    // притворялся сдавшимся — теперь не до этого
    if (this.state === 'surrender') { this.state = 'chase'; this.fake = false; }
    /* Конечность отрывается и от смертельного удара: кусок должен улететь, а не
       исчезнуть вместе с бойцом. Не вышло (в листе нет кадров hop/crawl) — запас
       зоны остаётся на нуле и она больше не проверяется. */
    if (broke && zone !== 'head') this.severPart(zone, dir);
    if (!this.alive) return;                       // отрыв ноги мог свалить насмерть
    if (this.hp <= 0) { this.die(dir, o); return; }
    if (broke && zone === 'head') { this.decapitate(dir); return; }
    /* Оглушение («красный», когда бойца можно добить) — уже финал схватки, а не
       реакция на первое серьёзное попадание. Пока он целый и здоровья больше
       пятой части, дробовик его отбрасывает и калечит, но в оглушение не роняет.

       Оружие может решить за себя: o.noStagger — «этот боец не качается, он
       дерётся до конца» (так бьёт взрыв), o.mortal — «уронить сразу красным»
       (редкий крит того же взрыва). */
    const worthStagger = !o.noStagger && this.hp < this.maxHp * this.finishAt * (this.lost.size ? 1.8 : 1);
    if (o.stagger || (!this.usedStagger && worthStagger)) {
      this.enterStagger(o.stagger || 3.6, o.mortal || worthStagger);
      this.type.female ? SFX.scream(1.1) : SFX.grunt(.9);
    } else if (!o.noFlinch && (o.heavy || Math.random() < .55)) {
      this.state = 'pain'; this.painT = o.heavy ? .45 : .25; this.setAnim('pain', this.painT);
      this.burst = 0;
      this.type.female ? SFX.scream(rnd(.9, 1.2)) : SFX.grunt(rnd(.8, 1.1));
    }
  }

  die(dir, o = {}) {
    if (!this.alive) return;              // уже умер (например, от отрыва ноги)
    const g = this.g;
    this.alive = false; this.staggered = false; this.mortal = false; this.clearTint();
    this.releaseSlot();
    if (this.shieldMesh) this.dropShield(dir, false);
    g.player.kills++;
    g.hud.kill(this);
    g.level?.onKill?.(this);
    /* Разлететься в клочья — исключение, а не обычная смерть: либо крит дробовика
       (o.gib), либо удар о стену, либо урон, который перебил здоровье с большим
       запасом. Иначе каждый второй труп превращался в фарш и эффект обесценивался. */
    const over = Math.max(0, -this.hp);                     // на сколько перебили здоровье
    /* Попадание в голову само по себе тело не разрывает — оно сносит голову,
       и перебор урона от множителя за хедшот тут не в счёт. В клочья рвёт только
       крит дробовика, удар о стену, тяжёлый замах с большим запасом или урон,
       перебивший здоровье в полтора раза. */
    const overkill = o.gib || o.wall
      || (o.melee && o.heavy && over > this.maxHp * .5)
      || (!o.headshot && over > this.maxHp * 1.5);
    const fdx = dir.x, fdz = dir.z;
    if (o.headshot && !overkill) {
      const hy = this.pos.y + this.type.h * .9;
      g.gore.spray(this.pos.x, hy, this.pos.z, fdx, .6, fdz, 110, 6, 1.6);
      for (const n of ['gib_skull', 'gib_brain', 'gib_eye', 'gib_meat0', 'gib_skull', 'gib_meat2'])
        g.gore.gib(n, this.pos.x, hy, this.pos.z, fdx * rnd(2, 5) + rnd(-3, 3), rnd(2, 6), fdz * rnd(2, 5) + rnd(-3, 3), rnd(.12, .22));
      g.gore.splashDir(this.pos.x, hy, this.pos.z, fdx, .2, fdz, 1.6);
      this.dropWeapon(this.pos.x, this.pos.y, this.pos.z);
      /* Кадр «стоит без головы» есть не у всякого листа (в думовских наборах его
         нет вовсе) — тогда тело падает сразу, фонтан остаётся. */
      this.headless = true; this.fountainT = 1.4;
      if (this.def.anims.headless) { this.state = 'headless'; this.stateT = 0; this.setAnim('headless'); }
      else { this.state = 'dying'; this.stateT = 0; this.setAnim(this.def.anims.die ? 'die' : 'pain', .42); }
      this.fallDir = { x: fdx, z: fdz };
      SFX.chop();
      g.hud.announce(pick(['ХЕДШОТ', 'ГОЛОВА ДОЛОЙ', 'В ЧЕРЕП']));
    } else if (overkill) {   // сюда же попадает крит в голову: рвёт целиком
      // в упор из дробовика — тело разрывает сильнее и куски летят выше: до потолка
      const power = o.gib ? 1.9 : 1.1;
      g.gore.burst(this.pos.x, this.pos.y, this.pos.z, fdx, fdz, this.gibNames(), o.gib ? 18 : 11, power, { ceiling: !!o.gib });
      g.gore.gib(this.headName(), this.pos.x, this.pos.y + this.type.h * .9, this.pos.z, fdx * 4 + rnd(-2, 2), rnd(4, 7), fdz * 4 + rnd(-2, 2), .3, { head: true });
      this.dropWeapon(this.pos.x, this.pos.y, this.pos.z);
      // тела не останется — вещи разлетаются шире и ложатся сами по себе
      this.dropItems(this.pos.x, this.pos.y, this.pos.z, 1.8);
      g.gore.poolAt(this.pos.x, this.pos.y, this.pos.z, 3);
      this.state = 'dead'; this.dead = true;
      this.dispose();
      SFX.gibs();
      g.hud.announce(pick(['В КЛОЧЬЯ', 'ФАРШ', 'РАЗОРВАН', 'МЯСО']));
    } else {
      this.state = 'dying'; this.stateT = 0;
      this.setAnim(this.def.anims.die ? 'die' : 'pain', .42);
      this.fallDir = { x: fdx, z: fdz };
      this.type.female ? SFX.scream(.8) : SFX.grunt(.7);
      this.dropWeapon(this.pos.x, this.pos.y, this.pos.z);
    }
  }

  decapitate(dir) {
    if (!this.alive) return;
    const g = this.g;
    this.alive = false; this.staggered = false; this.mortal = false; this.clearTint();
    this.releaseSlot();
    if (this.shieldMesh) this.dropShield(dir, false);
    g.player.kills++; g.hud.kill(this);
    g.level?.onKill?.(this);
    const hy = this.pos.y + this.type.h * .9;
    g.gore.gib(this.headName(), this.pos.x, hy, this.pos.z, dir.x * 3 + rnd(-1.5, 1.5), rnd(4.5, 6.5), dir.z * 3 + rnd(-1.5, 1.5), .3, { head: true, trail: true, bounce: .45 });
    g.gore.spray(this.pos.x, hy - .1, this.pos.z, dir.x, 1, dir.z, 90, 5, 1.2);
    g.gore.fountain(this.pos.x, hy - .15, this.pos.z, 36);
    g.gore.splashDir(this.pos.x, hy, this.pos.z, dir.x, .3, dir.z, 1.8);
    for (let i = 0; i < 3; i++) g.gore.gib('gib_meat' + i, this.pos.x, hy, this.pos.z, rnd(-3, 3), rnd(2, 4), rnd(-3, 3), .14);
    this.headless = true; this.fountainT = 1.6;
    if (this.def.anims.headless) { this.state = 'headless'; this.stateT = -.3; this.setAnim('headless'); }
    else { this.state = 'dying'; this.stateT = 0; this.setAnim(this.def.anims.die ? 'die' : 'pain', .42); }
    this.fallDir = { x: dir.x, z: dir.z };
    this.dropWeapon(this.pos.x, this.pos.y, this.pos.z);
    SFX.chop();
    g.hud.announce(pick(['ОБЕЗГЛАВЛЕН', 'КАЗНЬ', 'ГОЛОВА С ПЛЕЧ']));
  }
  beginExecution() { this.state = 'executed'; this.stateT = 0; this.setAnim('pain'); this.kvx = this.kvz = 0; this.clearTint(); }

  spawnCorpse() {
    const g = this.g;
    // труп берётся кадром `dead` из листа этого же врага — перерисовывается вместе с ним
    g.gore.heap(this.pos.x, this.pos.y, this.pos.z, this.fallDir, this.def.colors, {
      sprite: this.sprName(this.headless && this.def.frames?.deadHeadless !== undefined ? 'deadHeadless' : 'dead'),
      headless: this.headless, female: this.type.female, w: this.type.w * 1.15,
    });
    // рядом с телом остаётся его собственное: вилы крестьянина, нож стражника
    this.dropItems(this.pos.x, this.pos.y, this.pos.z);
    this.dispose();
    this.state = 'dead'; this.dead = true;
  }

  /* ─── обновление ─── */
  update(dt) {
    const g = this.g, p = g.player, w = g.world, T = this.type;
    const m = this.mesh;
    this.stateT += dt;
    if (this.state === 'dead') return;
    this.applyAnim(dt);
    if (this.state === 'headless') {
      this.fountainT -= dt;
      if (this.fountainT > 0 && Math.random() < .75) g.gore.fountain(this.pos.x, this.pos.y + T.h * .86, this.pos.z, 2);
      m.rotation.z = Math.sin(this.stateT * 14) * .06;
      this.pos.x += (this.fallDir.x * .4 + Math.sin(this.stateT * 9) * .3) * dt;
      this.pos.z += (this.fallDir.z * .4 + Math.cos(this.stateT * 7) * .3) * dt;
      m.position.copy(this.pos);
      if (this.stateT > .8) { this.state = 'dying'; this.stateT = 0; this.setAnim(this.def.anims.die ? 'die' : this.anim, .42); }
      return;
    }
    if (this.state === 'dying') {
      const f = Math.min(1, this.stateT / .42), e = f * f;
      if (!this.def.anims.die) m.scale.set(1 + e * .25, Math.max(.06, 1 - e * .94), 1);
      this.pos.x += this.fallDir.x * dt * 1.6; this.pos.z += this.fallDir.z * dt * 1.6;
      m.position.copy(this.pos);
      if (f >= 1) this.spawnCorpse();
      return;
    }
    if (this.state === 'executed') { this.face(); return; }
    if (g.mods?.enemiesFrozen) { this.face(); return; }

    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const los = dist < 60 && w.los(this.pos.x, this.pos.y + 1.5, this.pos.z, p.pos.x, p.eye, p.pos.z);
    if (los) this.remember(p.pos);

    if (!this.alerted) {
      if (los && dist < T.alertR && !p.dead) this.wake();
      else {
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = rnd(1, 3); this.wanderA += rnd(-1.5, 1.5); }
        const walking = this.wanderT > 1.5;
        if (walking) this.move(Math.cos(this.wanderA) * .6, Math.sin(this.wanderA) * .6, dt);
        this.setAnim(walking ? 'walk' : 'idle');
        this.face(); this.applyKnock(dt);
        return;
      }
    }
    if (this.state === 'stagger') {
      this.staggerT -= dt;
      m.rotation.z = Math.sin(this.stateT * 11) * .08;
      // красным горит только добиваемый: сбитый с ног пинком просто шатается
      if (this.mortal) {
        const pulse = .5 + .5 * Math.sin(this.stateT * 12);
        m.material.color.setRGB(1, 1 - pulse * .45, 1 - pulse * .45);
        m.material.emissive?.setRGB(pulse * .22, 0, 0);
      }
      this.applyKnock(dt); this.face();
      if (this.staggerT <= 0) {
        this.staggered = false; this.mortal = false;
        m.rotation.z = 0; m.material.color.setRGB(1, 1, 1); m.material.emissive?.setRGB(0, 0, 0);
        this.chooseTactic();
      }
      return;
    }
    if (this.state === 'pain') {
      this.painT -= dt;
      this.applyKnock(dt); this.face();
      if (this.painT <= 0) this.state = 'chase';
      return;
    }
    // пост охраны: игрок ушёл из зоны — возвращаемся и снова караулим
    if (this.guardR > 0 && this.state !== 'surrender' && this.state !== 'knife') {
      const dHome = Math.hypot(p.pos.x - this.home.x, p.pos.z - this.home.z);
      if (dHome > this.guardR) { this.onPost = true; this.updateGuardPost(dt, dist, los, dx, dz); return; }
      this.onPost = false;
    }
    if (this.state === 'surrender') { this.updateSurrender(dt, dist, los); return; }
    if (this.state === 'knife') { this.updateKnife(dt, dist, los); return; }
    if (this.state === 'cover') { this.updateCover(dt, dist, los, dx, dz); return; }

    this.fightT += dt;
    /* Раненый время от времени решает заново: драться, прятаться или сдаваться.
       Раньше это решение принималось единственный раз — на выходе из оглушения,
       то есть в самом начале боя, когда сдаваться ещё рано. */
    this.tacticT -= dt;
    if (this.tacticT <= 0) {
      this.tacticT = rnd(1.5, 3);
      if (!this.surrendered && this.hp < this.maxHp * .4) {
        this.chooseTactic();
        if (this.state !== 'chase') return;
      }
    }
    this.attackCd -= dt;
    this.flankT -= dt;
    if (this.flankT <= 0) { this.flankT = rnd(2.5, 5); this.flank = pick(T.flank || [0]); }
    if (p.dead) { this.setAnim('idle'); this.face(); return; }
    // подранок под огнём уходит в укрытие
    this.coverT -= dt;
    if (this.coverT <= 0 && this.hp < this.maxHp * .55 && (this.tac.cover || 0) > 0 && los && dist > 4) {
      this.coverT = rnd(3, 6);
      if (Math.random() < this.tac.cover * .5) { this.goToCover(); if (this.state === 'cover') { this.face(); return; } }
    }

    /* Безрукий боец теряет и melee, и ranged (см. severPart). Раньше его вело
       в updateRanged, где T.ranged уже null — и кадр падал с ошибкой. Теперь
       такой случай уходит в updateMelee: там для него есть ветка «оружия нет,
       просто иди на игрока». */
    if (T.melee || !T.ranged) this.updateMelee(dt, dist, los, dx, dz);
    else this.updateRanged(dt, dist, los, dx, dz);
    this.applyKnock(dt);
    this.separate(dt);
    this.pos.y = w.groundAt(this.pos.x, this.pos.z, .25, this.pos.y + .6);
    this.face();
  }

  /* Что делать раненому: сдаться (по-настоящему или притворно), уйти в укрытие или драться дальше.
     Руки поднимают не от первого попадания: боец должен сперва повоевать — иначе выстрел
     из дробовика, снимающий половину здоровья, сразу превращал любого в пленного. */
  chooseTactic() {
    const low = this.hp < this.maxHp * .4;
    const fought = this.hits >= 3 && this.fightT > 4;
    const t = this.tac;
    if (low && fought && !this.surrendered && Math.random() < (t.surrender || 0)) {
      this.surrendered = true;
      this.fake = Math.random() < (t.fake || 0);
      this.state = 'surrender'; this.stateT = 0; this.setAnim('surrender');
      this.kvx = this.kvz = 0;
      if (!this.fake) this.type.female ? SFX.scream(.7) : SFX.grunt(.6);
      return;
    }
    if (low && Math.random() < (t.cover || 0)) { this.goToCover(); if (this.state === 'cover') return; }
    this.state = 'chase';
  }

  /* Найти укрытие. Сначала честно смотрим по объектам уровня: берём ближайшие
     достаточно высокие коробки/стены и целимся за них с обратной от игрока стороны —
     так боец прячется осмысленно, а не наугад. Если рядом ничего нет, пробуем
     случайные точки, и только потом сдаёмся и продолжаем бой. */
  goToCover() {
    const w = this.g.world, p = this.g.player;
    const cy = this.pos.y + .75;                                      // глаза присевшего
    let best = null, bd = 1e9;
    const spots = [];
    const seen = new Set();
    for (const idx of w._grid().collect(this.pos.x - 18, this.pos.z - 18, this.pos.x + 18, this.pos.z + 18, [])) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      const s = w.solids[idx];
      if (!s.shoot) continue;
      if (s.y1 - s.y0 < 1.1 || s.y0 > 1.1) continue;                  // низкое или висит высоко — не спрячешься
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      if (Math.hypot(cx - this.pos.x, cz - this.pos.z) > 18) continue;
      let ax = cx - p.pos.x, az = cz - p.pos.z;
      const L = Math.hypot(ax, az) || 1; ax /= L; az /= L;
      const rad = Math.max(s.x1 - s.x0, s.z1 - s.z0) / 2 + .75;
      const tx = cx + ax * rad, tz = cz + az * rad;                    // точка за объектом
      spots.push([Math.hypot(tx - this.pos.x, tz - this.pos.z), tx, tz]);
    }
    spots.sort((a, b) => a[0] - b[0]);
    for (const [d, tx, tz] of spots) {
      if (w.los(tx, cy, tz, p.pos.x, p.eye, p.pos.z)) continue;
      bd = d; best = [tx, tz];
      break;
    }
    if (!best) {
      for (let i = 0; i < 20; i++) {
        const a = Math.random() * 6.28, r = rnd(2.5, 11);
        const cx = this.pos.x + Math.cos(a) * r, cz = this.pos.z + Math.sin(a) * r;
        if (w.los(cx, cy, cz, p.pos.x, p.eye, p.pos.z)) continue;
        const d = Math.hypot(cx - this.pos.x, cz - this.pos.z);
        if (d < bd) { bd = d; best = [cx, cz]; }
      }
    }
    if (!best) { this.state = 'chase'; this.coverT = rnd(4, 8); return; }   // прятаться негде — дерёмся
    this.coverPt = best; this.state = 'cover'; this.stateT = 0; this.coverRunT = 6; this.peekT = rnd(1.2, 2.6);
  }

  updateCover(dt, dist, los, dx, dz) {
    const T = this.type, p = this.g.player;
    const [cx, cz] = this.coverPt || [this.pos.x, this.pos.z];
    const d = Math.hypot(cx - this.pos.x, cz - this.pos.z);
    this.applyKnock(dt);
    this.coverRunT -= dt;
    if (d > .6 && this.coverRunT > 0) {         // ещё бежим в укрытие
      this.crouched = false;
      this.seekPoint(dt, cx, cz, this.spd() * 1.1, los);
      this.setAnim('walk');
    } else if (d > .6) {                        // не добежали за отведённое время — в бой
      this.crouched = false; this.state = 'chase'; this.coverT = rnd(4, 8);
    } else {
      // в листе нет кадра «присел» — боец просто стоит в укрытии, не складываясь
      this.crouched = !!this.def.anims.crouch;
      this.setAnim(this.def.anims.crouch ? 'crouch' : 'idle');
      this.peekT -= dt;
      if (this.peekT <= 0) {
        // высунуться: если цель видно — стреляем/бежим в атаку, иначе меняем укрытие
        this.crouched = false;
        this.peekT = rnd(1.4, 3);
        if (los && T.ranged) { this.state = 'chase'; this.attackCd = 0; this.aimT = T.ranged.aim * .6; }
        else if (los && T.melee) this.state = 'chase';
        else this.goToCover();
      }
    }
    // укрытие перестало быть укрытием — ищем новое
    if (this.crouched && los && Math.random() < dt * 1.5) this.goToCover();
    this.separate(dt);
    this.pos.y = this.g.world.groundAt(this.pos.x, this.pos.z, .25, this.pos.y + .6);
    this.face();
  }

  /* Стоим на посту: игрок вне охраняемой зоны. Возвращаемся к точке, но если видим
     цель в пределах выстрела — всё равно стреляем, просто не бежим следом. */
  updateGuardPost(dt, dist, los, dx, dz) {
    const T = this.type, w = this.g.world;
    const back = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    this.attackCd -= dt;
    if (T.ranged && los && dist < T.ranged.range && this.burst <= 0 && this.attackCd <= 0 && back < 1.5) {
      this.aimT += dt;
      if (this.aimT >= T.ranged.aim) { this.burst = T.ranged.burst; this.burstT = 0; this.aimT = 0; }
    }
    if (this.burst > 0) {
      this.burstT -= dt; this.setAnim('attack');
      if (this.burstT <= 0) { this.fireShot(); this.burst--; this.burstT = T.ranged.gap; if (this.burst === 0) this.attackCd = T.ranged.cooldown; }
    } else if (back > .6) {
      this.seekPoint(dt, this.home.x, this.home.z, this.spd() * .85, false);
      this.setAnim('walk');
    } else {
      this.setAnim('idle');
      this.path = null;
      if (this.stateT > 6) { this.alerted = false; this.state = 'idle'; this.stateT = 0; }
    }
    this.applyKnock(dt); this.separate(dt);
    this.pos.y = w.groundAt(this.pos.x, this.pos.z, .25, this.pos.y + .6);
    this.face();
  }

  updateSurrender(dt, dist, los) {
    this.crouched = false;
    this.setAnim('surrender');
    this.applyKnock(dt);
    this.face();
    // притворялся: подпустил поближе — и нож в бок
    if (this.fake && dist < 2.5 && los && !this.g.player.dead) {
      this.state = 'knife'; this.stateT = 0; this.setAnim('knife'); this.knifeHit = false;
      SFX.swing();
    }
  }

  updateKnife(dt, dist, los) {
    const p = this.g.player;
    this.setAnim('knife');
    this.face();
    if (!this.knifeHit && this.stateT >= .28) {
      this.knifeHit = true;
      if (dist < 2.8 && los) {
        const dmg = (this.tac.knifeDmg || 20) * (this.g.mods?.enemyDmg ?? 1);
        p.damage(dmg, this.pos);
        const nx = (p.pos.x - this.pos.x) / (dist || 1), nz = (p.pos.z - this.pos.z) / (dist || 1);
        this.g.gore.spray(p.pos.x, p.eye - .3, p.pos.z, -nx, 0, -nz, 18, 3, 1);
        this.g.hud.screenBlood(2);
      }
    }
    if (this.stateT >= .55) { this.state = 'chase'; this.fake = false; this.surrendered = true; this.attackCd = .4; }
  }

  releaseSlot() { this.mgr.director?.release(this); }

  /* Жетона нет — держим позицию в кольце вокруг игрока: подходим к своему слоту,
     смотрим на цель, слегка переступаем. Не атакуем и не лезем вплотную. */
  holdRing(dt, dist, los, radius) {
    const d = this.mgr.director;
    const i = d.claimSlot(this);
    const [tx, tz] = d.slotPoint(i, radius);
    const dd = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (dd > 1.3) {
      const app = dist > radius * 1.8 ? .95 : .7;
      this.seekPoint(dt, tx, tz, this.spd() * app, los);
      this.setAnim('walk');
    } else {
      // на месте не стоим: подшагиваем, обходим, отступаем
      const p = this.g.player;
      this.stepCombat(dt, dist, p.pos.x - this.pos.x, p.pos.z - this.pos.z, radius);
    }
    this.separate(dt);
    this.pos.y = this.g.world.groundAt(this.pos.x, this.pos.z, .25, this.pos.y + .6);
    this.applyKnock(dt);
    this.face();
  }

  spd() { return this.type.speed * this.speedMul(); }

  wake() {
    this.alerted = true; this.state = 'chase';
    this.type.female ? SFX.scream(rnd(.9, 1.1)) : SFX.grunt(rnd(.9, 1.2));
    this.mgr.onWake(this);
  }

  // точка захода: вокруг игрока под углом flank к его взгляду, на дистанции standoff
  flankTarget(standoff) {
    const p = this.g.player;
    const a = p.yaw + Math.PI + this.flank;            // направление от игрока: yaw+π — «за спину», flank добавляет разворот
    // forward игрока = (-sin yaw, -cos yaw); точка позади = pos - forward*d
    const fx = -Math.sin(a), fz = -Math.cos(a);
    return [p.pos.x - fx * standoff, p.pos.z - fz * standoff];
  }

  updateMelee(dt, dist, los, dx, dz) {
    const T = this.type, p = this.g.player;
    if (!T.melee && !T.ranged) { this.state = 'chase'; this.seek(dt, dist, los, dx, dz, this.spd(), true); this.setAnim('walk'); return; }
    // очередь на атаку: без жетона ждём в кольце
    if (this.state !== 'attack' && this.lungeT <= 0 && !this.token) {
      this.state = 'chase';
      this.holdRing(dt, dist, los, this.legState === 'crawl' ? 4 : 7.5);
      return;
    }
    if (this.state === 'attack') {
      if (this.stateT >= T.melee.windup) {
        const fdx = p.pos.x - this.pos.x, fdz = p.pos.z - this.pos.z, d = Math.hypot(fdx, fdz);
        if (d <= T.melee.range + .5 && los) {
          p.damage(T.melee.dmg, this.pos);
          this.g.gore.spray(p.pos.x, p.eye - .3, p.pos.z, -fdx / d, 0, -fdz / d, 12, 3, 1);
        } else SFX.swing();
        this.state = 'chase'; this.attackCd = T.melee.cooldown;
      }
      return;
    }
    if (T.lunge) {
      this.lungeCd -= dt;
      if (this.lungeT > 0) {
        this.lungeT -= dt;
        this.move(this.lungeDx * 11, this.lungeDz * 11, dt);
        this.setAnim('attack');
        if (dist < T.melee.range) { this.lungeT = 0; this.state = 'attack'; this.stateT = T.melee.windup * .6; this.setAnim('attack', T.melee.windup * .4); }
        return;
      }
      if (los && dist < 7 && dist > 2.5 && this.lungeCd <= 0) {
        this.lungeCd = 2.2; this.lungeT = .45;
        this.lungeDx = dx / dist; this.lungeDz = dz / dist;
        SFX.scream(1.3);
        return;
      }
    }
    if (!T.melee) { this.state = 'chase'; this.setAnim(this.seek(dt, dist, los, dx, dz, this.spd(), true) ? 'walk' : 'idle'); return; }
    if (dist <= T.melee.range && los && this.attackCd <= 0) {
      this.state = 'attack'; this.stateT = 0; this.setAnim('attack', T.melee.windup);
      return;
    }
    this.state = 'chase';
    // вблизи — дёрганый танец вокруг игрока, а не заход вплотную
    const ideal = (T.melee?.range ?? 2) * .92 + this.type.r * .4;
    if (dist < ideal + 2.2) { this.stepCombat(dt, dist, dx, dz, ideal); this.separate(dt); this.pos.y = this.g.world.groundAt(this.pos.x, this.pos.z, .25, this.pos.y + .6); return; }
    // далеко — идём к точке захода (сбоку/сзади), близко — к самому игроку
    let moved;
    if (dist > 3.2) {
      const [tx, tz] = this.flankTarget(Math.max(2.6, ideal));
      // чем ближе, тем спокойнее шаг: не влетают в упор на полном ходу
      const app = dist > 14 ? 1 : dist > 7 ? .78 : .58;
      moved = this.seekPoint(dt, tx, tz, this.spd() * app, los);
      // если в поле зрения игрока и он смотрит на нас — подкручиваем по касательной
      if (los && dist < 9 && this.flank !== 0) {
        const fwd = p.forward();
        const facing = (dx * fwd.x + dz * fwd.z) / dist;         // косинус угла между взглядом игрока и направлением на нас
        if (facing < -.5) { const side = Math.sign(this.flank) || 1; this.move(-dz / dist * side * this.spd() * .6, dx / dist * side * this.spd() * .6, dt); }
      }
    } else moved = this.seek(dt, dist, los, dx, dz, this.spd(), dist > T.melee.range * .8);
    this.setAnim(moved ? 'walk' : 'idle');
  }

  updateRanged(dt, dist, los, dx, dz) {
    const T = this.type, R = T.ranged, p = this.g.player;
    if (this.burst > 0) {
      this.burstT -= dt;
      this.setAnim('attack');
      if (this.burstT <= 0) { this.fireShot(); this.burst--; this.burstT = R.gap; if (this.burst === 0) { this.attackCd = R.cooldown * rnd(.8, 1.2); this.state = 'chase'; } }
      return;
    }
    if (!this.token) {
      // очередь на огонь: ждём в кольце на своей дистанции, не стреляя
      this.aimT = 0;
      this.state = 'chase';
      this.holdRing(dt, dist, los, Math.max(T.prefer[1], 11));
      return;
    }
    if (los && dist < R.range) {
      this.aimT += dt;
      if (this.aimT >= R.aim && this.attackCd <= 0) { this.burst = R.burst; this.burstT = 0; this.aimT = 0; this.state = 'attack'; return; }
    } else this.aimT = 0;
    let moved = false;
    if (los) {
      const [mn, mx] = T.prefer;
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rnd(.6, 1.6); this.strafeDir = -this.strafeDir; }
      // позиция: на предпочтительной дистанции под углом захода
      const [tx, tz] = this.flankTarget((mn + mx) / 2);
      let mvx = tx - this.pos.x, mvz = tz - this.pos.z;
      const L0 = Math.hypot(mvx, mvz);
      if (L0 < 1.5) { mvx = 0; mvz = 0; } else { mvx /= L0; mvz /= L0; }
      const nx = dx / dist, nz = dz / dist;
      if (dist < mn) { mvx -= nx; mvz -= nz; }
      mvx += -nz * this.strafeDir * .7; mvz += nx * this.strafeDir * .7;
      const L = Math.hypot(mvx, mvz) || 1;
      _prev.copy(this.pos);
      this.move(mvx / L * this.spd() * .8, mvz / L * this.spd() * .8, dt);
      if (this.pos.distanceToSquared(_prev) < 1e-6) this.strafeDir = -this.strafeDir;
      moved = true;
    } else moved = this.seek(dt, dist, los, dx, dz, this.spd(), true);
    this.state = 'chase';
    this.setAnim(moved ? 'walk' : 'idle');
  }

  fireShot() {
    const g = this.g, p = g.player, T = this.type, R = T.ranged;
    const ox = this.pos.x, oy = this.pos.y + T.h * .68, oz = this.pos.z;
    const ps = Math.hypot(p.vel.x, p.vel.z);
    const spread = R.spread + ps * .011 + (p.dashT > 0 ? .08 : 0);
    const tx = p.pos.x + rnd(-spread, spread) * 10, ty = p.eye - .3 + rnd(-spread, spread) * 6, tz = p.pos.z + rnd(-spread, spread) * 10;
    let dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    const wall = g.world.raycast(ox, oy, oz, dx, dy, dz, 80);
    const maxT = wall ? wall.t : 80;
    const t = rayCylinder(ox, oy, oz, dx, dy, dz, p.pos.x, p.pos.z, .42, p.pos.y, p.pos.y + p.h);
    let hx = ox + dx * maxT, hy = oy + dy * maxT, hz = oz + dz * maxT;
    if (t !== null && t < maxT) {
      p.damage(R.dmg, this.pos);
      hx = ox + dx * t; hy = oy + dy * t; hz = oz + dz * t;
      g.gore.spray(hx, hy, hz, dx, .3, dz, 10, 3, 1);
    } else if (wall) {
      if (wall.solid.decal) g.gore.bulletHole(hx, hy, hz, wall.n);
      g.fx.sparks(hx, hy, hz, wall.n, 3);
    }
    const eh = this.mgr.rayHit(ox, oy, oz, { x: dx, y: dy, z: dz }, Math.min(maxT, t ?? maxT), this);
    if (eh) eh.enemy.hurt(R.dmg * 1.5, new THREE.Vector3(dx, dy, dz), { bullet: true, hitY: eh.y, headshot: eh.y > eh.enemy.pos.y + eh.enemy.type.h * .78 });
    g.fx.tracer(ox + dx * .5, oy, oz + dz * .5, hx, hy, hz);
    g.fx.muzzle(ox + dx * .6, oy, oz + dz * .6, g.camera, .5);
    SFX.rifle();
    this.mgr.noise(this.pos, 22);
  }

  // движение к произвольной точке: напрямую, если путь свободен, иначе по A*
  seekPoint(dt, tx, tz, speed, losPlayer) {
    const ddx = tx - this.pos.x, ddz = tz - this.pos.z, d = Math.hypot(ddx, ddz);
    if (d < .3) return false;
    const w = this.g.world;
    const clear = w.los(this.pos.x, this.pos.y + 1, this.pos.z, tx, this.pos.y + 1, tz);
    if (clear) { this.move(ddx / d * speed, ddz / d * speed, dt); this.path = null; return true; }
    this.pathT -= dt; this.pathFailT -= dt;
    /* Провал поиска стоит дороже удачи: A* честно выбирает весь лимит узлов и
       только потом сдаётся. Раньше `!this.path` означало «искать снова тем же
       кадром», и десяток бойцов, которым до героя не дотянуться, съедали
       кадр целиком. Теперь после неудачи выдерживаем паузу. */
    if ((!this.path || this.pathT <= 0) && this.pathFailT <= 0) {
      this.pathT = rnd(.5, .9);
      this.path = w.findPath(this.pos.x, this.pos.z, tx, tz); this.pathI = 0;
      if (!this.path) this.pathFailT = rnd(.8, 1.6);
    }
    if (this.path && this.pathI < this.path.length) {
      const [wx, wz] = this.path[this.pathI];
      const px = wx - this.pos.x, pz = wz - this.pos.z, pd = Math.hypot(px, pz);
      if (pd < .35) { this.pathI++; return true; }
      this.move(px / pd * speed, pz / pd * speed, dt);
      return true;
    }
    // пути нет — идём на игрока
    if (losPlayer) { const p = this.g.player; const qx = p.pos.x - this.pos.x, qz = p.pos.z - this.pos.z, qd = Math.hypot(qx, qz) || 1; this.move(qx / qd * speed, qz / qd * speed, dt); return true; }
    return false;
  }
  seek(dt, dist, los, dx, dz, speed, want) {
    if (!want) return false;
    const target = los ? this.g.player.pos : this.lastSeen;
    if (!target) return false;
    if (los && dist > 1) { this.move(dx / dist * speed, dz / dist * speed, dt); this.path = null; return true; }
    return this.seekPoint(dt, target.x, target.z, speed, los);
  }
  move(vx, vz, dt) {
    const [nx, nz] = this.g.world.moveCircle(this.pos.x, this.pos.z, this.type.r, this.pos.y, this.type.h, vx * dt, vz * dt);
    this.pos.x = nx; this.pos.z = nz;
    this.keepOffPlayer();
  }
  /* У игрока есть своё место: внутрь него не залезают. Раньше враги проходили
     сквозь героя и толпились прямо в нём — теперь упираются и обтекают. */
  keepOffPlayer() {
    const p = this.g.player;
    if (p.dead) return;
    const min = this.type.r + p.r + .25;
    const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > min) return;
    if (d < 1e-3) { this.pos.x += min; return; }
    const k = (min - d) / d;
    const [nx, nz] = this.g.world.moveCircle(this.pos.x, this.pos.z, this.type.r, this.pos.y, this.type.h, dx * k, dz * k);
    this.pos.x = nx; this.pos.z = nz;
  }

  /* Ближний бой вблизи — дёрганый: подшагнуть, обойти боком, отскочить, замереть.
     `ideal` — дистанция, которую боец старается держать. Так он не стоит столбом
     вплотную к игроку и не пытается в него влезть. */
  stepCombat(dt, dist, dx, dz, ideal) {
    this.jitT -= dt;
    if (this.jitT <= 0) {
      const far = dist > ideal + .9, r = Math.random();
      this.jit = far ? 'close' : r < .30 ? 'strafe' : r < .52 ? 'back' : r < .72 ? 'close' : 'hold';
      this.jitT = this.jit === 'hold' ? rnd(.12, .4) : rnd(.22, .7);
      if (this.jit === 'strafe') this.strafeDir = Math.random() < .5 ? -1 : 1;
    }
    const d = dist || 1e-3, nx = dx / d, nz = dz / d;
    const sp = this.spd();
    let vx = 0, vz = 0;
    if (this.jit === 'close' && dist > ideal) { vx = nx * sp * .8; vz = nz * sp * .8; }
    else if (this.jit === 'back') { vx = -nx * sp * .65; vz = -nz * sp * .65; }
    else if (this.jit === 'strafe') { vx = -nz * this.strafeDir * sp * .75; vz = nx * this.strafeDir * sp * .75; }
    // слишком близко — всегда отжимаемся назад, каким бы ни было «настроение»
    if (dist < ideal * .85) { vx -= nx * sp * .7; vz -= nz * sp * .7; }
    this.move(vx, vz, dt);
    this.setAnim(Math.hypot(vx, vz) > .3 ? 'walk' : 'idle');
  }
  applyKnock(dt) {
    // полёт после мощного попадания: враг отскакивает по дуге и шлёпается
    if (this.airborne) {
      const w = this.g.world;
      this.kvy -= 24 * dt;
      this.pos.y += this.kvy * dt;
      this.move(this.kvx, this.kvz, dt);
      this.kvx *= Math.max(0, 1 - dt * .8); this.kvz *= Math.max(0, 1 - dt * .8);
      // тело, брошенное взрывом, летит ровно: качание читалось как оглушение
      this.mesh.rotation.z = this.knockNoStagger ? 0 : Math.sin(this.stateT * 9) * .25;
      const gy = w.groundAt(this.pos.x, this.pos.z, .25, this.pos.y + 1.2);
      if (this.pos.y <= gy && this.kvy <= 0) {
        this.pos.y = gy; this.airborne = false; this.kvy = 0;
        this.mesh.rotation.z = 0;
        const hard = -this.kvy;
        this.g.gore.floorSplat(this.pos.x, gy, this.pos.z, 1.1, .25);
        this.g.gore.spray(this.pos.x, gy + .3, this.pos.z, 0, 1, 0, 24, 3, 1.4);
        SFX.thud();
        if (this.alive) {
          this.hp -= 8;
          if (this.hp <= 0) { this.die(new THREE.Vector3(this.kvx, 0, this.kvz).normalize(), { wall: true }); return; }
          this.knockdown(2.2);
        }
      }
      return;
    }
    const k = Math.hypot(this.kvx, this.kvz);
    /* Флаг «взрыв не оглушает» живёт, пока тело едет: приземлился, проехал
       юзом и впечатался в стену — это всё ещё один и тот же полёт, и вставать
       после него боец должен так же бодро. Остановился — флаг снят. */
    if (k < .05) { this.kvx = this.kvz = 0; this.knockNoStagger = false; return; }
    _prev.copy(this.pos);
    this.move(this.kvx, this.kvz, dt);
    const actual = this.pos.distanceTo(_prev) / dt;
    if (k > 4 && actual < k * .3) {
      const g = this.g;
      const nx = this.kvx / k, nz = this.kvz / k;
      g.gore.splashDir(this.pos.x, this.pos.y + 1.2, this.pos.z, nx, 0, nz, 1.8);
      g.gore.spray(this.pos.x, this.pos.y + 1.2, this.pos.z, -nx, .5, -nz, 50, 4, 1.2);
      SFX.thud();
      this.kvx = this.kvz = 0;
      if (this.alive) {
        this.hp -= 45;
        if (this.hp <= 0) this.die(new THREE.Vector3(nx, 0, nz), { wall: true });
        else this.knockdown(2);
      }
      return;
    }
    this.kvx *= Math.max(0, 1 - dt * 4); this.kvz *= Math.max(0, 1 - dt * 4);
  }
  separate(dt) {
    for (const e of this.mgr.list) {
      if (e === this || !e.alive) continue;
      const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < .81 && d2 > 1e-4) { const d = Math.sqrt(d2); const push = (.9 - d) * 3; this.move(dx / d * push, dz / d * push, dt); }
    }
  }
  face() {
    const c = this.g.camera.position;
    this.mesh.position.copy(this.pos);
    const ry = Math.atan2(c.x - this.pos.x, c.z - this.pos.z);
    this.mesh.rotation.y = ry;
    if (this.shieldMesh) {
      // щит висит сбоку от бойца и чуть ближе к камере, чтобы не мерцал с телом
      const T = this.type, ax = Math.cos(ry), az = -Math.sin(ry);
      const off = this.shieldOff[0] * T.w;
      const nx = Math.sin(ry) * .06, nz = Math.cos(ry) * .06;
      // billboard() привязан НИЗОМ кадра, поэтому off[1] — центр щита, а не его низ:
      // без вычета половины высоты щит уезжал под потолок и казался гигантским
      this.shieldMesh.position.set(this.pos.x + ax * off + nx, this.pos.y + T.h * this.shieldOff[1] - this.shieldH / 2, this.pos.z + az * off + nz);
      this.shieldMesh.rotation.y = ry;
    }
  }
  dispose() { this.g.scene.remove(this.mesh); if (this.shieldMesh) this.g.scene.remove(this.shieldMesh); this.releaseSlot(); }
}

/* ═══ координатор боя ═══
   Толпой не наваливаются. Система собрана из трёх известных приёмов:
     · «жетоны атаки» (Halo, Killzone) — право атаковать ограничено: одновременно
       в ближний бой идут 2 бойца, стреляют 3, остальные ждут;
     · ротация нападающих (Batman: Arkham) — подержал жетон несколько секунд,
       уступи следующему, иначе бой превращается в свалку у одного места;
     · бронирование позиций (F.E.A.R.) — вокруг игрока кольцо слотов, двое в один
       не встают, поэтому никто не толкается и не лезет в спину сплошной стеной.
   Ждущие занимают свой слот на дистанции, держат игрока в поле зрения и переступают
   с ноги на ногу — видно, что они рядом и вот-вот вступят. */
const SLOTS = 12;
const HOLD = 6;                     // сколько секунд боец держит жетон до ротации

export class Director {
  constructor(mgr) {
    this.mgr = mgr;
    this.slots = new Array(SLOTS).fill(null);
    this.t = 0; this.time = 0; this.faceYaw = 0;
  }
  reset() { this.slots.fill(null); this.t = 0; }
  get maxMelee() { return Math.max(1, +(this.mgr.g.settings?.atkMelee ?? 2)); }
  get maxRanged() { return Math.max(1, +(this.mgr.g.settings?.atkRanged ?? 3)); }

  /* Слоты раскладываются ДУГОЙ ПЕРЕД игроком (±85°), а не полным кольцом: в спину
     никто не заходит и стеной не окружает. Дуга привязана к сглаженному направлению
     взгляда — резко крутнувшись, игрок не заставляет всех бежать вокруг него. */
  slotPoint(i, radius) {
    const p = this.mgr.g.player;
    const t = i / (SLOTS - 1) - .5;                                  // -0.5 … 0.5
    const phi = this.faceYaw + t * 2.95 + Math.sin(this.time * .6 + i * 1.3) * .1;
    return [p.pos.x - Math.sin(phi) * radius, p.pos.z - Math.cos(phi) * radius];
  }
  slotIndexFor(e) {
    const p = this.mgr.g.player;
    let ang = Math.atan2(-(e.pos.x - p.pos.x), -(e.pos.z - p.pos.z)) - this.faceYaw;
    while (ang > Math.PI) ang -= 6.283;
    while (ang < -Math.PI) ang += 6.283;
    const t = Math.max(-.5, Math.min(.5, ang / 2.95));
    return Math.round((t + .5) * (SLOTS - 1));
  }
  claimSlot(e) {
    if (e.slot >= 0 && this.slots[e.slot] === e) return e.slot;
    const want = this.slotIndexFor(e);
    for (let d = 0; d < SLOTS; d++) {
      for (const cand of (d ? [want + d, want - d] : [want])) {
        if (cand < 0 || cand >= SLOTS) continue;
        const occ = this.slots[cand];
        if (!occ || !occ.alive || occ === e) { this.slots[cand] = e; e.slot = cand; return cand; }
      }
    }
    return Math.max(0, Math.min(SLOTS - 1, want));
  }
  release(e) { if (e.slot >= 0 && this.slots[e.slot] === e) this.slots[e.slot] = null; e.slot = -1; }

  update(dt) {
    this.time += dt;
    // дуга поворачивается за игроком неторопливо — иначе строй дёргается от каждого движения мыши
    const py = this.mgr.g.player.yaw;
    let d0 = py - this.faceYaw;
    while (d0 > Math.PI) d0 -= 6.283;
    while (d0 < -Math.PI) d0 += 6.283;
    this.faceYaw += d0 * Math.min(1, dt * 1.1);
    this.t -= dt;
    if (this.t > 0) return;
    const step = .4; this.t = step;
    const p = this.mgr.g.player;
    const cand = { melee: [], ranged: [] };
    for (const e of this.mgr.list) {
      if (!e.alive) { this.release(e); e.token = null; continue; }
      // сдающиеся, ползущие в укрытие и часовые на посту в очереди не участвуют
      if (!e.alerted || e.state === 'surrender' || e.state === 'knife' || e.state === 'cover' || e.onPost) { e.token = null; e.tokenT = 0; continue; }
      const kind = e.type.ranged ? 'ranged' : e.type.melee ? 'melee' : null;
      if (!kind) { e.token = null; continue; }
      if (e.token) e.tokenT += step;
      cand[kind].push({ e, d: Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z), kind });
    }
    for (const kind of ['melee', 'ranged']) {
      const list = cand[kind];
      const max = kind === 'melee' ? this.maxMelee : this.maxRanged;
      const score = ({ e, d }) => d
        + (e.token === kind ? (e.tokenT > HOLD ? 16 : -3) : 0)        // гистерезис, потом ротация
        + (e.legState === 'crawl' ? 24 : e.legState === 'hop' ? 6 : 0)
        + (e.armsLost ? 60 : 0)
        + (e.hp < e.maxHp * .3 ? 4 : 0);
      list.sort((a, b) => score(a) - score(b));
      list.forEach((it, i) => {
        const want = i < max;
        if (want && it.e.token !== kind) { it.e.token = kind; it.e.tokenT = 0; }
        else if (!want && it.e.token) { it.e.token = null; it.e.tokenT = 0; }
      });
    }
  }
}

/* ─── менеджер ─── */
export class Enemies {
  constructor(game) { this.g = game; this.list = []; this.director = new Director(this); }
  spawn(type, x, z, o = {}) { const e = new Enemy(this, type, x, z, o); this.list.push(e); return e; }
  update(dt) {
    this.director.update(dt);
    for (const e of this.list) e.update(dt);
    if (this.list.length > 60) this.list = this.list.filter(e => !e.dead || this.list.indexOf(e) > this.list.length - 40);
  }
  alive(tag) { return this.list.filter(e => e.alive && (!tag || e.tag === tag)); }
  onWake(e) { this.g.level?.onWake?.(e); }
  noise(pos, r) {
    for (const e of this.list) if (e.alive && !e.alerted && e.pos.distanceTo(pos) < r) { e.alerted = true; e.state = 'chase'; e.remember(pos); }
  }
  alertTag(tag) { for (const e of this.list) if (e.alive && e.tag === tag && !e.alerted) e.wake(); }
  coneHit(p, range, halfAngle) {
    const out = [];
    const fwd = p.forward();
    for (const e of this.list) {
      if (!e.alive || e.state === 'executed') continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > range + e.hitR) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fwd.x + dz * fwd.z) / (d || 1e-6))));
      if (ang > halfAngle && d > .8) continue;
      if (!this.g.world.los(p.pos.x, p.eye, p.pos.z, e.pos.x, e.pos.y + 1, e.pos.z)) continue;
      out.push(e);
    }
    return out;
  }
  findFinisherTarget(p) {
    let best = null, bd = 2.6;
    const fwd = p.forward();
    for (const e of this.list) {
      if (!e.alive || !e.staggered || e.state !== 'stagger') continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if ((dx * fwd.x + dz * fwd.z) / (d || 1e-6) < .5) continue;
      best = e; bd = d;
    }
    return best;
  }
  rayHit(ox, oy, oz, d, maxT, exclude) {
    let best = null;
    for (const e of this.list) {
      if (!e.alive || e === exclude) continue;
      const t = rayCylinder(ox, oy, oz, d.x, d.y, d.z, e.pos.x, e.pos.z, e.hitR, e.pos.y, e.hitTop);
      if (t !== null && t < maxT && (!best || t < best.t)) best = { enemy: e, t, y: oy + d.y * t };
    }
    return best;
  }
  clear() { for (const e of this.list) e.dispose(); this.list.length = 0; this.director.reset(); }
}

export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
  const fx = ox - cx, fz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    if (fx * fx + fz * fz > r * r) return null;
    const t = dy > 0 ? (y0 - oy) / dy : (y1 - oy) / dy;
    return t >= 0 ? t : null;
  }
  const b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return null;
  const y = oy + dy * t;
  if (y < y0 || y > y1) {
    const tc = dy > 0 ? (y0 - oy) / dy : (y1 - oy) / dy;
    if (tc < 0) return null;
    const px = ox + dx * tc - cx, pz = oz + dz * tc - cz;
    return px * px + pz * pz <= r * r ? tc : null;
  }
  return t;
}
