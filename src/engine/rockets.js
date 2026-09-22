/* Ракеты: единственное оружие, которое стреляет снарядом, а не лучом.
   Ракета летит по прямой с дымным следом и взрывается о врага, стену, пол или
   на излёте. Взрыв бьёт по площади: чем ближе к центру, тем больше урона и
   сильнее отбрасывает. Игрока задевает тоже — и толкает, так что на своём
   взрыве можно запрыгнуть на уступ.

   Тип урона — 'explosion' (см. damageTypeOf и PART_DEF в enemies.js): взрыв
   рвёт конечности лучше пули, но голову сносит хуже дроби.

   ── Почему всё здесь на пулах ──
   Ракета и её дым живут доли секунды, но появляются пачками. Первая версия на
   каждый выстрел заводила свой PointLight, а на каждый клуб дыма — меш с
   клонированным материалом. Три.js пересобирает шейдеры всех материалов сцены,
   когда меняется число источников света, а десятки прозрачных мешей дают
   столько же вызовов отрисовки. Поэтому корпуса ракет и клубы дыма созданы
   один раз при старте и переиспользуются, а светит ракета не своей лампой, а
   пулом вспышек из FX: своих источников света модуль в сцену не добавляет
   вовсе — даже погашенные, они стоили бы в каждом шейдере.

   ── Почему от взрыва не качает ──
   Оглушение в этой игре — финал схватки: боец встаёт «красным» и добивается
   любым попаданием. Первая версия ракетницы роняла в него всех, кто оказался
   ближе половины радиуса, и бой у эпицентра превращался в ряд качающихся
   мишеней. Теперь взрыв не оглушает вовсе (o.noStagger): бойца отбрасывает,
   ему отрывает руки-ноги, и он поднимается драться дальше. «Красным» он падает
   только по редкому криту — STAGGER_CRIT, примерно раз на тридцать попаданий.

   ── Почему в клочья рвёт редко ──
   Разрыв тела (o.gib) — крит, как выстрел в упор из дробовика: он поднимает
   мощность разлёта кусков до 1.9 и брызгает на потолок (см. Enemy.die). Когда
   его выдавала каждая ракета, пул кусков забивался с двух выстрелов, кадр
   проседал, а «в клочья» переставало читаться как удача. Теперь рвёт только
   заведомо слабого или уже подбитого бойца, и то не всегда. */
import * as THREE from 'three';
import { TEX } from './textures.js';
import { SFX } from './audio.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const SPEED = 42;          // м/с — быстрее дробины на глаз, но увернуться можно
const LIFE = 6;            // дольше не живёт: взорвётся сама
const HIT_R = .2;          // радиус тела ракеты для попадания в стену
const TRAIL_STEP = .045;   // как часто отваливается клуб дыма
const MAX_ROCKETS = 6;     // столько корпусов держим наготове
const MAX_PUFFS = 26;      // потолок прозрачных квадов на весь дым и огонь
const STAGGER_CRIT = 1 / 30;   // как часто взрыв роняет бойца «красным»
/* Куда приходится волна: конечности вчетверо вероятнее корпуса, голова — редко.
   Взрыв должен отрывать руки-ноги, а не ровно снимать здоровье с груди. */
const ZONE_WEIGHTS = [
  { part: 'armL', w: 4 }, { part: 'armR', w: 4 },
  { part: 'legL', w: 4 }, { part: 'legR', w: 4 },
  { part: 'torso', w: 4 }, { part: 'head', w: 1 },
];

export class Rockets {
  constructor(game) {
    this.g = game;
    this.list = [];

    const bodyGeo = new THREE.CylinderGeometry(.055, .055, .32, 6);
    const noseGeo = new THREE.ConeGeometry(.055, .16, 6);
    const finGeo = new THREE.BoxGeometry(.015, .1, .1);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x6a6f78 });
    const noseMat = new THREE.MeshLambertMaterial({ color: 0x8a1418 });
    const finMat = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
    const flameMat = new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffc070 });
    this.quad = new THREE.PlaneGeometry(1, 1);

    /* Корпуса ракет собраны заранее: в полёте их только показывают и двигают.
       Сцена о них уже знает, добавлять и убирать ничего не нужно. */
    this.bodies = [];
    for (let i = 0; i < MAX_ROCKETS; i++) {
      const m = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat); body.rotation.x = Math.PI / 2; m.add(body);
      const nose = new THREE.Mesh(noseGeo, noseMat); nose.rotation.x = -Math.PI / 2; nose.position.z = -.22; m.add(nose);
      for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(finGeo, finMat); f.position.z = .14; f.rotation.z = k * 2.09; f.position.x = Math.cos(k * 2.09) * .06; f.position.y = Math.sin(k * 2.09) * .06; m.add(f); }
      const flame = new THREE.Mesh(this.quad, flameMat); flame.position.z = .3; flame.scale.setScalar(.5); m.add(flame);
      m.visible = false;
      game.scene.add(m);
      this.bodies.push({ m, flame, busy: false });
    }

    /* Дым и огненный шар — общий пул квадов. У каждого свой материал (нужна
       своя прозрачность), но все они созданы при старте и живут до конца. */
    this.puffs = [];
    for (let i = 0; i < MAX_PUFFS; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, depthWrite: false, opacity: 0 });
      const m = new THREE.Mesh(this.quad, mat);
      m.visible = false;
      game.scene.add(m);
      this.puffs.push({ m, mat, t: 0, life: 1, s0: 1, s1: 1, rise: 0, fire: false, live: false });
    }
    this.puffNext = 0;
    this.fireColor = new THREE.Color(0xffb050);
    this.smokeColor = new THREE.Color(0x5a5650);
  }

  /* Выстрел: ракета выходит чуть ниже линии взгляда и правее — от дула модели,
     иначе на близкой стене взрыв происходит «в лице» ещё до вылета. */
  fire(p, W) {
    const g = this.g;
    const slot = this.bodies.find(b => !b.busy);
    if (!slot) return null;                  // больше шести в воздухе не бывает
    const d = p.aimDir(new THREE.Vector3());
    const rt = p.right(new THREE.Vector3());
    /* Если герой упёрся носом в стену, вынос вперёд укорачиваем: иначе ракета
       родится за стеной и взорвётся с той стороны. */
    const near = g.world.raycast(p.pos.x, p.eye - .12, p.pos.z, d.x, d.y, d.z, .75);
    const out = near ? Math.max(.05, near.t - .15) : .6;
    const ox = p.pos.x + d.x * out + rt.x * .18;
    const oy = p.eye - .12 + d.y * out;
    const oz = p.pos.z + d.z * out + rt.z * .18;

    slot.busy = true;
    slot.m.visible = true;
    slot.m.position.set(ox, oy, oz);
    slot.m.lookAt(ox + d.x, oy + d.y, oz + d.z);

    const r = { slot, pos: new THREE.Vector3(ox, oy, oz), dir: d.clone().normalize(), t: 0, trailT: 0, W, dmgMul: p.S[W.settingDmg] ?? 1, by: p };
    this.list.push(r);
    return r;
  }

  update(dt, camera) {
    const g = this.g;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      r.t += dt;
      let done = false, boom = false;
      const remain = SPEED * dt;
      /* Шагами по полметра: одним прыжком за кадр ракета проскакивала бы сквозь
         тонкую стену и мимо врага, стоящего вплотную к траектории. */
      const steps = Math.max(1, Math.ceil(remain / .5));
      const seg = remain / steps;
      for (let s = 0; s < steps && !done; s++) {
        const { x, y, z } = r.pos, d = r.dir;
        const hit = g.enemies.rayHit(x, y, z, d, seg + .35, null);
        const wall = g.world.raycast(x, y, z, d.x, d.y, d.z, seg + HIT_R);
        if (hit && (!wall || hit.t <= wall.t)) {
          const t = Math.max(0, hit.t - .25);
          this.explode(x + d.x * t, y + d.y * t, z + d.z * t, r, hit.enemy);
          done = boom = true;
        } else if (wall) {
          const t = Math.max(0, wall.t - .12);
          this.explode(x + d.x * t, y + d.y * t, z + d.z * t, r, null, wall.n);
          done = boom = true;
        } else {
          const nx = x + d.x * seg, ny = y + d.y * seg, nz = z + d.z * seg;
          /* Пол лучом не ловится (он не «стрелябельный» solid, высота берётся
             из groundAt) — иначе выстрел себе под ноги уходил бы сквозь землю. */
          const gy = g.world.groundAt(nx, nz, .15, y + .3);
          if (d.y < 0 && ny <= gy + .1) { this.explode(nx, gy + .12, nz, r, null, [0, 1, 0]); done = boom = true; }
          else r.pos.set(nx, ny, nz);
        }
      }
      if (!boom && r.t >= LIFE) { this.explode(r.pos.x, r.pos.y, r.pos.z, r, null); done = true; }
      if (done) { this.release(r); this.list.splice(i, 1); continue; }
      r.slot.m.position.copy(r.pos);
      r.slot.flame.scale.setScalar(.45 + Math.random() * .3);
      // двигатель подсвечивает стены вспышкой из пула FX, своей лампы у ракеты нет
      g.fx.light(r.pos.x, r.pos.y, r.pos.z, 0xffa040, .9, .1);
      r.trailT -= dt;
      if (r.trailT <= 0) { r.trailT = TRAIL_STEP; this.puff(r.pos.x - r.dir.x * .2, r.pos.y - r.dir.y * .2, r.pos.z - r.dir.z * .2, .35, .6, false); }
    }
    this.updatePuffs(dt, camera);
  }

  /* Взрыв. `direct` — враг, в которого ракета попала телом: ему достаётся
     прямой урон, а следом и общая волна, то есть в упор бьёт дважды. */
  explode(x, y, z, r, direct, normal) {
    const g = this.g, W = r.W, p = g.player, R = W.radius, k = r.dmgMul;
    const dv = new THREE.Vector3();

    if (direct && direct.alive) {
      dv.copy(r.dir);
      direct.hurt(W.dmg * k, dv, {
        dt: 'explosion', by: r.by, hitY: y, knock: W.knock, launch: 2,
        sever: .8, noStagger: true, noFlinch: true,
        // сразу в клочья — только если боец заметно слабее самой ракеты
        gib: W.dmg * k > direct.hp * 2.2,
      });
    }

    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const ey = e.pos.y + e.type.h * .5;
      const d = Math.hypot(e.pos.x - x, ey - y, e.pos.z - z) - e.type.r;
      if (d > R) continue;
      // стена между центром взрыва и бойцом гасит волну — но не до нуля
      const open = g.world.los(x, y, z, e.pos.x, ey, e.pos.z);
      const f = clamp(1 - Math.max(0, d) / R, 0, 1) * (open ? 1 : .35);
      if (f <= .02) continue;
      const dmg = W.splash * f * k;
      dv.set(e.pos.x - x, .35, e.pos.z - z);
      if (dv.lengthSq() < 1e-4) dv.set(rnd(-1, 1), .5, rnd(-1, 1));
      dv.normalize();
      /* Крит: только в самом эпицентре, только если волна заведомо добивает, и
         всё равно не каждый раз. Толпу у ног рвёт редко — зато заметно. */
      const gib = f > .8 && dmg > e.hp * 1.4 && Math.random() < .35;
      /* Оглушение от взрыва — редкий крит (STAGGER_CRIT), а не правило: обычно
         бойца отбрасывает и калечит, но он поднимается и дерётся дальше. Выпал
         крит — встаёт «красным» и добивается любым попаданием. */
      const crit = !gib && Math.random() < STAGGER_CRIT;
      /* Куда пришлась волна. Взрыв не бьёт аккуратно в грудь: осколки рвут то,
         что торчит, поэтому зона выбирается со смещением в конечности, а рядом
         с эпицентром достаётся сразу двум. Вместе с высоким sever это и даёт
         отлетающие руки-ноги вместо ровного урона по корпусу. */
      const zones = [], shares = [];
      if (e === direct) {
        /* Тому, в кого ракета попала телом, волна идёт в корпус целиком — она и
           должна его добивать; конечность вдобавок отрывает с близи. Иначе
           прямое попадание выходило слабее, чем взрыв под ногами: урон по руке
           доходит до здоровья лишь наполовину (partPass). */
        zones.push('torso'); shares.push(1);
        const l = f > .5 ? this.limbZone(e) : null;
        if (l) { zones.push(l); shares.push(.5); }
      } else {
        for (const z of this.blastZones(e, f)) { zones.push(z); shares.push(1); }
        if (zones.length > 1) { shares[0] = shares[1] = .6; }
      }
      for (let zi = 0; zi < zones.length && e.alive; zi++) {
        e.hurt(dmg * shares[zi], dv, {
          dt: 'explosion', by: r.by, hitY: ey, part: zones[zi],
          // отбрасывает и подкидывает один раз за взрыв, а не от каждой зоны
          knock: zi === 0 ? 4 + 10 * f : 0, launch: zi === 0 ? 1.5 + 4 * f : 0,
          sever: .15 + .85 * f,
          gib: gib && zi === 0,
          noStagger: !crit, noFlinch: !crit,
          stagger: crit ? 4.5 : 0, mortal: crit,
        });
      }
    }

    // своя же ракета: урон вполовину от вражеского и хороший толчок — на нём прыгают
    const pd = Math.hypot(p.pos.x - x, p.eye - y, p.pos.z - z);
    if (pd < R && !p.dead) {
      const f = clamp(1 - pd / R, 0, 1);
      dv.set(p.pos.x - x, p.pos.y + .9 - y, p.pos.z - z);
      if (dv.lengthSq() < 1e-4) dv.set(0, 1, 0);
      dv.normalize();
      p.damage(W.selfDmg * f, { x, y, z });
      /* Толчок ощутимый, но не катапульта: вверх — примерно полтора обычных
         прыжка (6.8 м/с), чтобы на своём взрыве запрыгивать на уступы, а не
         улетать под потолок. */
      const push = (9 + 15 * f) * (g.mods?.god ? .6 : 1);
      p.vel.x += dv.x * push; p.vel.z += dv.z * push;
      p.vel.y = Math.max(p.vel.y, Math.min(11, dv.y * push * .55 + 1.5 * f));
      p.onGround = false;
      p.fovKick = Math.max(p.fovKick, f);
      p.kickPitch += .05 * f; p.kickRoll += rnd(-.05, .05) * f;
      g.hud.screenBlood(f * 3);
    } else {
      // даже издали взрыв бьёт по камере
      const f = clamp(1 - pd / (R * 4), 0, 1);
      p.kickPitch += .03 * f; p.kickRoll += rnd(-.03, .03) * f; p.fovKick = Math.max(p.fovKick, f * .5);
    }
    /* Тряска слышна дальше, чем бьёт волна: рвануло в другом конце зала — камера
       всё равно вздрогнет. Вблизи трясёт до упора. */
    const near = clamp(1 - pd / R, 0, 1), far = clamp(1 - pd / (R * 5), 0, 1);
    p.addShake?.(near > 0 ? .4 + .8 * near : .6 * far);

    // ── картинка и звук ──
    const n = normal || [0, 1, 0];
    g.fx.sparks(x, y, z, n, 18);
    g.fx.light(x, y, z, 0xffa040, 10, .4);       // вспышка — из пула FX
    this.puff(x, y, z, R * .5, .34, true);        // огненный шар
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * 6.283, rr = rnd(.2, R * .5);
      this.puff(x + Math.cos(a) * rr, y + rnd(-.3, .9), z + Math.sin(a) * rr, rnd(1.4, 2.4), rnd(1, 1.6), false);
    }
    /* Из точки попадания вылетает крошево: куски стены летят вдоль нормали
       поверхности, а всё, что уже валялось рядом (мясо, конечности, обломки),
       разбрасывает волной — так взрыв читается даже при попадании в пустую стену. */
    const nx = n[0], ny = n[1], nz = n[2];
    for (let i = 0; i < 6; i++) {
      g.gore.gib(`debris${i % 3}`, x + nx * .15, y + ny * .15 + .1, z + nz * .15,
        nx * rnd(3, 8) + rnd(-3.5, 3.5), ny * rnd(1, 5) + rnd(1.5, 5.5), nz * rnd(3, 8) + rnd(-3.5, 3.5),
        rnd(.16, .32), { trail: false, bounce: .45 });
    }
    g.gore.blast(x, y, z, R * .9, 1);
    // копоть и брызги на полу под взрывом
    const gy = g.world.groundAt(x, z, .2, y + .5);
    if (Math.abs(gy - y) < R) g.gore.floorSplat(x, gy, z, rnd(1.2, 2.0), .3);
    SFX.explosion();
    g.enemies.noise(new THREE.Vector3(x, y, z), 55);
  }

  /* Какие зоны накрыло волной. Кости выпадают в пользу конечностей: именно они
     должны отлетать от взрыва. Оторванное и то, чего у бойца нет (у зверя нет
     рук), из списка выпадает само; корпус остаётся всегда. */
  // случайная уцелевшая конечность (или ничего — у зверя рук нет)
  limbZone(e) {
    const limbs = ['armL', 'armR', 'legL', 'legR'].filter(z => z in e.partHp && !e.lost.has(z));
    return limbs.length ? limbs[Math.random() * limbs.length | 0] : null;
  }

  blastZones(e, f) {
    const pool = [];
    for (const z of ZONE_WEIGHTS) {
      if (z.part !== 'torso' && (!(z.part in e.partHp) || e.lost.has(z.part))) continue;
      for (let i = 0; i < z.w; i++) pool.push(z.part);
    }
    if (!pool.length) return ['torso'];
    const first = pool[Math.random() * pool.length | 0];
    // у самого эпицентра рвёт сразу в двух местах
    if (f <= .65 || Math.random() < .5) return [first];
    const rest = pool.filter(z => z !== first);
    return rest.length ? [first, rest[Math.random() * rest.length | 0]] : [first];
  }

  /* Клуб дыма или огненный шар из общего пула. Пул кончился — забираем самый
     давний: лучше оборвать дальний клуб, чем завести ещё один меш. */
  puff(x, y, z, size, life, fire) {
    const q = this.puffs[this.puffNext];
    this.puffNext = (this.puffNext + 1) % this.puffs.length;
    q.live = true; q.t = 0; q.life = life; q.fire = fire;
    q.s0 = fire ? size : size * .6;
    q.s1 = fire ? size * 4.2 : size * 1.9;
    q.rise = fire ? .4 : rnd(.5, 1.4);
    q.mat.color.copy(fire ? this.fireColor : this.smokeColor);
    q.mat.blending = fire ? THREE.AdditiveBlending : THREE.NormalBlending;
    q.mat.opacity = fire ? 1 : .5;
    q.m.position.set(x, y, z);
    q.m.scale.setScalar(q.s0);
    q.m.visible = true;
  }
  updatePuffs(dt, camera) {
    const cam = camera?.position;
    for (const q of this.puffs) {
      if (!q.live) continue;
      q.t += dt;
      const f = q.t / q.life;
      if (f >= 1) { q.live = false; q.m.visible = false; q.mat.opacity = 0; continue; }
      q.m.scale.setScalar(q.s0 + (q.s1 - q.s0) * f);
      q.m.position.y += q.rise * dt;
      q.mat.opacity = q.fire ? 1 - f : .5 * (1 - f);
      if (cam) q.m.rotation.y = Math.atan2(cam.x - q.m.position.x, cam.z - q.m.position.z);
    }
  }

  // вернуть корпус в пул
  release(r) { r.slot.busy = false; r.slot.m.visible = false; }
  clear() {
    for (const r of this.list) this.release(r);
    this.list.length = 0;
    for (const q of this.puffs) { q.live = false; q.m.visible = false; q.mat.opacity = 0; }
  }
}
