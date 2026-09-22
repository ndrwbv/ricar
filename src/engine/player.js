/* Игрок: быстрый контроллер, камера с yaw/pitch/roll, меч, пинок, добивание, огнестрел (пистолет, дробовик). */
import * as THREE from 'three';
import { keys, mouse, once, gamepad } from './input.js';
import { SFX } from './audio.js';
import { rayCylinder } from './enemies.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// переиспользуемые векторы: кадр не должен плодить мусор для сборщика
const _fwd = new THREE.Vector3(), _rt = new THREE.Vector3(), _wish = new THREE.Vector3(), _fly = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

export const SPEED = 8.6;
export const EYE = 1.62;

// огнестрел
export const WEAPONS = {
  pistol: { name: 'ПИСТОЛЕТ', mag: 12, reserveMax: 120, dmg: 34, headMul: 3.5, pellets: 1, spread: .008, fireCd: .17, reload: 1.05, sfx: 'pistol', knock: 1.5, ammoKind: 'ammo', pickupAmmo: 24, settingDmg: 'gunDmg' },
  shotgun: { name: 'ДРОБОВИК', mag: 6, reserveMax: 48, dmg: 11, headMul: 1.5, pellets: 9, spread: .085, fireCd: .85, reload: 1.7, sfx: 'shotgun', knock: 1.2, ammoKind: 'shells', pickupAmmo: 8, settingDmg: 'shotgunDmg', overkill: true },
  /* Ракетница стреляет снарядом (см. rockets.js), а не лучом: dmg — прямое
     попадание, splash — взрыв в эпицентре, radius — до куда он достаёт,
     selfDmg — сколько прилетает самому герою в упор. В упор стрелять больно. */
  rocket: { name: 'РАКЕТНИЦА', mag: 3, reserveMax: 30, dmg: 120, splash: 95, radius: 5.2, selfDmg: 55, headMul: 1, pellets: 0, spread: .004, fireCd: .85, reload: 2.1, sfx: 'rocket', knock: 12, ammoKind: 'rockets', pickupAmmo: 5, settingDmg: 'rocketDmg', projectile: true, overkill: true },
};
export const GUN_ORDER = ['pistol', 'shotgun', 'rocket'];

/* ── Стамина меча ──
   Клинок тяжёлый: спамить ударом нельзя. Любой замах забирает ВЕСЬ накопленный
   запас, а сила удара равна тому, сколько успело накопиться. Ткнул на остатках —
   царапина; дождался полной полосы — сносит бойца целиком. Ниже SWORD_MIN замах
   не начинается вовсе: в эту паузу у героя есть пинок, он стамину не тратит. */
export const SWORD_MIN = .34;      // меньше этого запаса замах не начинается
export const SWORD_HEAVY_AT = .78; // с какого запаса замах идёт как тяжёлый
export const SWORD_DMG_MIN = 20;   // урон самого слабого тычка
export const SWORD_DMG_MAX = 150;  // урон полностью накопленного удара

export class Player {
  constructor(game) {
    this.g = game;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.r = .35; this.h = 1.75; this.stepUp = .5;   // на какую ступеньку герой заходит без прыжка
    this.dead = false;
    this.onGround = true;
    this.bobT = 0; this.bobAmt = 0;
    this.dashT = 0; this.dashCd = 0;
    this.kickRoll = 0; this.kickPitch = 0; this.fovKick = 0;
    /* Тряска камеры от взрывов. Копится «травмой» 0..1.2 и гаснет сама; в кадре
       превращается в дрожь по всем трём осям и подскок камеры. Квадрат травмы —
       чтобы сильный взрыв встряхивал заметно, а дальний только подрагивал. */
    this.shake = 0;
    this.landDip = 0;
    this.frozen = 0;
    this.lookAt = null;
    const S = this.S = game.settings || {};
    this.sens = .0022 * (S.sens ?? 1);
    this.baseSpeed = S.speed ?? SPEED;
    this.maxHp = S.maxHp ?? 100; this.hp = this.maxHp;
    /* Оружие: меч всегда в ЛЕВОЙ руке, огнестрел — в правой.
       mode: 'sword' — только меч, 'gun' — только ствол, 'both' — обе руки сразу
       (ЛКМ стреляет, ПКМ рубит). Переключается Tab. */
    this.WEAPONS = WEAPONS;
    this.mode = 'sword';
    this.gunKind = null;
    this.guns = {};                 // kind -> {mag, reserve}
    this.gunSlots = +(S.gunSlots ?? 1);
    this.reloadT = 0; this.fireCd = 0;
    // замахи по рукам: l — меч, r — огнестрел, k — пинок
    this.swings = { l: null, r: null, k: null };
    this.combo = 0; this.comboT = 0;
    // стамина меча: копится сама, тратится вся разом на замах (см. swordAttack)
    this.staminaMax = 1;
    this.stamina = this.staminaMax;
    this.staminaRegen = +(S.swordRegen ?? .62);            // ед/с: полная полоса за ~1.6 с
    this.staminaMin = clamp(+(S.swordMinStamina ?? SWORD_MIN), .05, .9);
    this.staminaLock = 0;      // пауза сразу после замаха, пока запас не копится
    this.staminaBlink = 0;     // HUD: полоса мигает, когда бить нечем
    this.tiredCd = 0;          // чтобы щелчок «пусто» не трещал каждый кадр
    this.swingPower = 0;       // сила последнего замаха 0..1 — для HUD и вида от первого лица
    this.bloodOnBlade = 0;
    this.kills = 0; this.executions = 0;
    this.speedMul = 1;
    this.finisherTarget = null;
    this.stats = { dmgTaken: 0 };
  }

  /* `weapon` оставлен как свойство ради HUD, песочницы и уровней: читается как
     'sword' | 'pistol' | 'shotgun', запись переключает режим. */
  get weapon() { return this.mode === 'sword' ? 'sword' : (this.gunKind || 'sword'); }
  set weapon(v) {
    if (v === 'sword') { this.mode = 'sword'; return; }
    if (WEAPONS[v] && this.guns[v]) { this.gunKind = v; if (this.mode === 'sword') this.mode = 'gun'; }
  }
  // что сейчас в руках
  get hasSwordOut() { return this.mode === 'sword' || this.mode === 'both'; }
  get hasGunOut() { return (this.mode === 'gun' || this.mode === 'both') && !!this.gunKind && !!this.guns[this.gunKind]; }
  get swing() { return this.swings.r || this.swings.l || this.swings.k; }

  get eye() { return this.pos.y + EYE + this.bobY() - this.landDip; }
  bobY() { return Math.sin(this.bobT * 2) * .045 * this.bobAmt; }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  aimDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
  // ── оружие: справочные ──
  get hasGun() { return Object.keys(this.guns).length > 0; }
  hasWeapon(k) { return !!this.guns[k]; }
  gun(k = this.gunKind) { return this.guns[k] || null; }
  magSize(k = this.gunKind) { return k === 'pistol' && this.S.magSize ? this.S.magSize : WEAPONS[k]?.mag ?? 0; }
  ammoFull(k) { const g = this.guns[k]; return !g || g.reserve >= WEAPONS[k].reserveMax; }
  gunList() { return GUN_ORDER.filter(k => this.guns[k]); }

  update(dt, rawDt) {
    const g = this.g, w = g.world;
    if (this.dead) { this.pitch = clamp(this.pitch - dt * .6, -1.3, 1.3); this.roll += (0.6 - this.roll) * dt * 3; this.landDip += (1.2 - this.landDip) * dt * 3; return; }

    // ── обзор ──
    if (this.frozen <= 0) {
      const inv = this.S.invertY ? -1 : 1;
      this.yaw -= mouse.dx * this.sens; this.pitch -= mouse.dy * this.sens * inv;
      const gp = gamepad;
      this.yaw -= gp.lx2 * 2.6 * rawDt; this.pitch -= gp.ly2 * 1.8 * rawDt;
      const t = (keys.turnR ? 1 : 0) - (keys.turnL ? 1 : 0);
      const lu = (keys.lookUp ? 1 : 0) - (keys.lookDown ? 1 : 0);
      this.yaw -= t * 2.4 * rawDt; this.pitch += lu * 1.5 * rawDt;
    } else this.frozen -= dt;
    if (this.lookAt) {
      const dx = this.lookAt.x - this.pos.x, dy = this.lookAt.y - this.eye, dz = this.lookAt.z - this.pos.z;
      const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      let dy2 = wantYaw - this.yaw; while (dy2 > Math.PI) dy2 -= 6.283; while (dy2 < -Math.PI) dy2 += 6.283;
      this.yaw += dy2 * Math.min(1, dt * 10); this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 10);
    }
    this.pitch = clamp(this.pitch, -1.45, 1.45);

    // ── движение ──
    const fwd = this.forward(_fwd), rt = this.right(_rt);
    let mf = 0, ms = 0;
    if (this.frozen <= 0) {
      mf = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0) - gamepad.ly;
      ms = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + gamepad.lx;
    }
    const wish = _wish.set(0, 0, 0).addScaledVector(fwd, mf).addScaledVector(rt, ms);
    if (wish.lengthSq() > 1) wish.normalize();
    const moving = wish.lengthSq() > .01;
    const speed = this.baseSpeed * this.speedMul;

    if (this.g.mods?.noclip) {
      const d = this.aimDir();
      const fl = _fly.set(0, 0, 0).addScaledVector(d, mf).addScaledVector(rt, ms);
      if (keys.jump) fl.y += 1;
      if (keys.dash) fl.y -= 1;
      this.pos.addScaledVector(fl, speed * 1.6 * dt);
      this.vel.set(0, 0, 0); this.onGround = true; this.bobAmt = 0;
      this.updateWeapons(dt, true);
      return;
    }

    this.dashCd -= dt;
    if ((once('dash') || gamepad.dash) && this.dashCd <= 0 && this.frozen <= 0) {
      gamepad.dash = false;
      const dir = moving ? wish.clone() : fwd.clone();
      this.vel.x = dir.x * 21; this.vel.z = dir.z * 21;
      this.dashT = .16; this.dashCd = this.S.dashCd ?? .55; this.fovKick = 1;
      SFX.dash();
    }
    this.dashT -= dt;
    if (this.dashT <= 0) {
      const accel = this.onGround ? 70 : 22;
      const tx = wish.x * speed, tz = wish.z * speed;
      this.vel.x += clamp(tx - this.vel.x, -accel * dt, accel * dt);
      this.vel.z += clamp(tz - this.vel.z, -accel * dt, accel * dt);
      if (!moving && this.onGround) { this.vel.x *= Math.max(0, 1 - dt * 12); this.vel.z *= Math.max(0, 1 - dt * 12); }
    }
    if ((once('jump') || gamepad.jump) && this.onGround && this.frozen <= 0 && this.S.jump !== false) { gamepad.jump = false; this.vel.y = 6.8; this.onGround = false; }
    this.vel.y -= 19 * dt;

    let dx = this.vel.x * dt, dz = this.vel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .3));
    for (let i = 0; i < steps; i++) {
      const [nx, nz] = w.moveCircle(this.pos.x, this.pos.z, this.r, this.pos.y, this.h, dx / steps, dz / steps, null, this.stepUp);
      this.pos.x = nx; this.pos.z = nz;
    }
    this.pos.y += this.vel.y * dt;
    const ground = w.groundAt(this.pos.x, this.pos.z, this.r * .7, this.pos.y + this.stepUp);
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -4) { this.landDip = Math.min(.25, -this.vel.y * .02); SFX.land(); }
      this.pos.y = ground; this.vel.y = 0; this.onGround = true;
    } else this.onGround = ground >= this.pos.y - .01;
    const head = w.raycast(this.pos.x, this.pos.y + this.h - .1, this.pos.z, 0, 1, 0, .2);
    if (head && this.vel.y > 0) this.vel.y = 0;

    // ── ощущение камеры ──
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.bobAmt += ((this.onGround && hs > 1 && this.S.headBob !== false ? Math.min(1, hs / speed) : 0) - this.bobAmt) * Math.min(1, dt * 8);
    this.bobT += dt * (7.5 + hs * .35) * (this.onGround ? 1 : 0);
    const strafe = this.vel.dot(rt) / speed;
    const wantRoll = (this.S.cameraTilt === false ? 0 : -strafe * .045) + this.kickRoll;
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 10);
    this.kickRoll *= Math.max(0, 1 - dt * 9);
    this.kickPitch *= Math.max(0, 1 - dt * 9);
    this.fovKick *= Math.max(0, 1 - dt * 6);
    this.landDip *= Math.max(0, 1 - dt * 7);

    this.updateWeapons(dt, false);
  }

  addShake(n) { this.shake = Math.min(1.2, this.shake + n); }

  updateWeapons(dt, noclip) {
    const g = this.g;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.fireCd -= dt; this.comboT -= dt;
    if (this.comboT <= 0) this.combo = 0;
    /* Стамина копится, только когда клинок не в замахе: после удара есть ещё
       короткий «выдох» (staminaLock), иначе полоса начинала расти прямо посреди
       проводки и частые тычки выходили выгоднее выдержанного удара. */
    this.staminaLock = Math.max(0, this.staminaLock - dt);
    this.tiredCd = Math.max(0, this.tiredCd - dt);
    this.staminaBlink = Math.max(0, this.staminaBlink - dt * 2.4);
    if (!this.swings.l && this.staminaLock <= 0)
      this.stamina = Math.min(this.staminaMax, this.stamina + this.staminaRegen * dt);
    this.bloodOnBlade = Math.max(0, this.bloodOnBlade - dt * .06);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const gn = this.gun(); if (gn) { const take = Math.min(this.magSize() - gn.mag, gn.reserve); gn.mag += take; gn.reserve -= take; } }
    }
    if (this.frozen <= 0) {
      if (once('tab') || gamepad.mode) { gamepad.mode = false; this.cycleMode(); }
      if (once('swap') || gamepad.swap || mouse.wheel !== 0) { gamepad.swap = false; this.cycleGun(mouse.wheel < 0 ? -1 : 1); }
      if (once('w1') || gamepad.slot === 1) this.setMode('sword');
      if (once('w2') || gamepad.slot === 2) this.switchWeapon('pistol');
      if (once('w3') || gamepad.slot === 3) this.switchWeapon('shotgun');
      if (once('w4') || gamepad.slot === 4) this.switchWeapon('rocket');
      if ((once('reload') || gamepad.reload) && this.gun()) { gamepad.reload = false; this.reload(); }
      this.finisherTarget = noclip ? null : g.enemies.findFinisherTarget(this);
      const swordBusy = !!this.swings.l, gunBusy = !!this.swings.r, kicking = !!this.swings.k;
      if ((once('finish') || gamepad.finish) && this.finisherTarget && !swordBusy && this.hasSwordOut) { gamepad.finish = false; this.startFinisher(this.finisherTarget); }
      else {
        /* ЛКМ и RT — правая рука: в режиме меча рубит, иначе стреляет.
           LT — левая рука геймпада: в режиме ствола тоже стреляет (курки взаимозаменяемы),
           в режиме меча и «обе руки» бьёт клинком. ПКМ мыши: в режиме «обе руки» — меч, иначе пинок. */
        const lmb = mouse.leftDown > 0 || (mouse.left && this.mode !== 'sword') || gamepad.fire || (gamepad.alt && this.mode === 'gun');
        const ltBlade = gamepad.alt && this.mode !== 'gun';
        const rmb = mouse.rightDown > 0;
        if (lmb) { if (this.mode === 'sword') { if (!swordBusy) this.swordAttack(); } else if (!gunBusy) this.gunAttack(); }
        if (ltBlade && !swordBusy && !noclip) this.swordAttack();
        if (rmb && !noclip) {
          if (this.mode === 'both') { if (!swordBusy) this.swordAttack(); }
          else if (!kicking) this.startSwing('kick', .38);
        }
        if ((mouse.middleDown > 0 || gamepad.kick || gamepad.kick2) && !kicking && !noclip) { gamepad.kick = gamepad.kick2 = false; this.startSwing('kick', .38); }
      }
    }
    this.updateSwing(dt);
  }

  // Tab: меч → ствол → обе руки → меч
  cycleMode() {
    const canGun = !!this.gunList().length;
    if (!canGun) { this.setMode('sword'); return; }
    if (!this.gunKind) this.gunKind = this.gunList()[0];
    this.setMode(this.mode === 'sword' ? 'gun' : this.mode === 'gun' ? 'both' : 'sword');
  }
  setMode(m) {
    if (m !== 'sword' && !this.gunList().length) m = 'sword';
    if (m === this.mode) return;
    this.mode = m;
    this.reloadT = 0;
    if (m !== 'sword') this.startSwing('raise', .25, 'r');
    if (m !== 'gun') this.startSwing('raise', .25, 'l');
  }
  // Q / колесо: перебирает только огнестрел, режим не трогает
  cycleGun(dir) {
    const list = this.gunList();
    if (!list.length) return;
    if (this.mode === 'sword') { this.gunKind = this.gunKind && list.includes(this.gunKind) ? this.gunKind : list[0]; this.setMode('gun'); return; }
    if (list.length < 2) return;
    const i = Math.max(0, list.indexOf(this.gunKind));
    this.gunKind = list[(i + dir + list.length) % list.length];
    this.reloadT = 0;
    this.startSwing('raise', .25, 'r');
  }
  switchWeapon(wp) {
    if (wp === 'sword') { this.setMode('sword'); return; }
    if (!this.guns[wp]) return;
    this.gunKind = wp; this.reloadT = 0;
    if (this.mode === 'sword') this.setMode('gun'); else this.startSwing('raise', .25, 'r');
  }
  reload() {
    const gn = this.gun(); if (!gn) return;
    if (this.reloadT > 0 || gn.mag >= this.magSize() || gn.reserve <= 0) return;
    this.reloadT = WEAPONS[this.weapon].reload; SFX.reload();
  }

  /* Замах мечом. Возвращает false, если бить нечем: запас ниже порога — клинок
     даже не поднимается, зато пинок (ПКМ/СКМ) как раз для этой паузы. */
  swordAttack() {
    const min = this.staminaMin;
    if (this.stamina < min) {
      this.staminaBlink = 1;
      if (this.tiredCd <= 0) { SFX.dry(); this.tiredCd = .4; }
      return false;
    }
    const charge = this.stamina / this.staminaMax;                    // сколько накопилось, 0..1
    const power = clamp((this.stamina - min) / Math.max(.01, this.staminaMax - min), 0, 1);
    this.stamina = 0; this.staminaLock = .22;                         // замах забирает всё
    this.swingPower = power;
    const heavy = charge >= SWORD_HEAVY_AT;
    this.combo = heavy ? 0 : this.combo + 1; this.comboT = .9;
    // меч большой и тяжёлый: занос долгий, удар приходится на середине движения
    const sw = this.startSwing(heavy ? 'heavy' : 'slash', heavy ? .72 : .48, 'l');
    sw.power = power;
    if (heavy) { SFX.swingHeavy(); this.fovKick = Math.max(this.fovKick, .45); }
    else SFX.swing();
    return true;
  }
  gunAttack() {
    const gn = this.gun(); if (!gn) return;
    if (this.fireCd > 0 || this.reloadT > 0) return;
    if (gn.mag <= 0) { if (mouse.leftDown > 0 || gamepad.fire || gamepad.alt) { if (gn.reserve > 0) this.reload(); else SFX.dry(); } this.fireCd = .2; gamepad.fire = gamepad.alt = false; return; }
    this.shoot();
  }
  primary() { this.mode === 'sword' ? this.swordAttack() : this.gunAttack(); }

  startSwing(type, dur, slot) {
    slot = slot || (type === 'kick' ? 'k' : type === 'shoot' ? 'r' : 'l');
    const prev = this.swings[slot];
    this.swings[slot] = { type, t: 0, dur, side: (prev?.side === 1 ? -1 : 1), hit: false, slot };
    return this.swings[slot];
  }
  updateSwing(dt) {
    for (const k of ['l', 'r', 'k']) if (this.swings[k]) this.stepSwing(dt, this.swings[k]);
  }
  stepSwing(dt, s) {
    s.t += dt;
    const g = this.g;
    if (!s.hit) {
      // момент попадания — доля от длительности замаха, чтобы он совпадал с картинкой
      if ((s.type === 'slash' && s.t >= s.dur * .36) || (s.type === 'heavy' && s.t >= s.dur * .44)) {
        s.hit = true;
        const heavy = s.type === 'heavy';
        /* Всё в ударе считается от накопленной стамины: урон, размах, отброс,
           шанс отрубить конечность и снести голову. Кривая с запасом в степени —
           последняя четверть полосы даёт больше, чем первая половина, ради этого
           её и стоит ждать. */
        const pw = clamp(s.power ?? 1, 0, 1);
        const dmg = (SWORD_DMG_MIN + (SWORD_DMG_MAX - SWORD_DMG_MIN) * Math.pow(pw, 1.6)) * (this.S.swordDmg ?? 1);
        const hits = g.enemies.coneHit(this, 2.45 + pw * .55, .85 + pw * .4);
        if (hits.length) {
          const fwd = this.aimDir(), rt = this.right();
          let killed = 0;
          for (const e of hits) {
            const dir = new THREE.Vector3(fwd.x + rt.x * s.side * .6, -.2 + (heavy ? -.4 : 0), fwd.z + rt.z * s.side * .6).normalize();
            // куда пришёлся клинок: бьём в голову — шанс снести её начисто, по рукам/ногам — отрубить
            const hp = this.meleeHitPoint(e);
            e.hurt(dmg, dir, {
              knock: 1.6 + pw * 6, heavy, melee: true, by: this, hitPoint: hp, hitY: hp.y,
              sever: .18 + pw * .5, critHead: .25 + pw * .6,
              launch: pw > .85 ? 1.5 + pw * 2 : 0,
            });
            if (!e.alive) killed++;
          }
          /* Снял бойца — клинку возвращается часть запаса. Меньше порога, так что
             сразу ударить снова всё равно нельзя, но в толпе удачный замах
             заметно сокращает ожидание следующего. */
          if (killed) this.stamina = Math.min(this.staminaMax, this.stamina + .13 * killed);
          this.bloodOnBlade = Math.min(1, this.bloodOnBlade + .3 + pw * .4);
          this.kickRoll += s.side * (.02 + pw * .05); this.kickPitch += .01 + pw * .03;
          this.fovKick = Math.max(this.fovKick, pw * .5);
          g.hud.screenBlood(1 + Math.round(pw * 4));
          // сокрушительный удар «залипает» на кадр: чувствуется вес клинка
          if (pw > .85 && this.S.finisherSlowmo !== false) g.slowmo(.35, .12);
        } else {
          const d = this.aimDir();
          // по трупу тоже можно рубить: мясо в стороны
          const cp = g.gore.rayCorpse(this.pos.x, this.eye, this.pos.z, d.x, d.y, d.z, 2.6);
          if (cp) {
            g.gore.hitCorpse(cp, this.pos.x + d.x * cp.t, this.eye + d.y * cp.t, this.pos.z + d.z * cp.t, d.x, d.y, d.z, .8 + pw * .9);
            this.bloodOnBlade = Math.min(1, this.bloodOnBlade + .4);
            SFX.chop();
          } else {
            const h = g.world.raycast(this.pos.x, this.eye, this.pos.z, d.x, d.y, d.z, 2.2);
            if (h) { g.fx.sparks(this.pos.x + d.x * h.t, this.eye + d.y * h.t, this.pos.z + d.z * h.t, h.n, 6); SFX.ricochet(); }
          }
        }
      }
      if (s.type === 'kick' && s.t >= s.dur * .32) {
        s.hit = true;
        const hits = g.enemies.coneHit(this, 2.3, .9);
        const fwd = this.forward();
        if (hits.length) { SFX.kick(); for (const e of hits) e.hurt(8, new THREE.Vector3(fwd.x, .15, fwd.z), { knock: 15, stagger: 1.1, kick: true, by: this }); this.kickPitch -= .02; }
        else SFX.swing();
      }
      if (s.type === 'finisher' && s.t >= s.dur * .42) {
        s.hit = true;
        const e = s.target;
        if (e && !e.dead) {
          e.decapitate(this.aimDir());
          this.executions++;
          this.heal(this.S.finisherHeal ?? 30);
          this.stamina = this.staminaMax;      // казнь возвращает клинку весь запас
          this.staminaLock = 0;
          this.g.hud.screenBlood(5);
          if (this.S.finisherSlowmo !== false) this.g.slowmo(.28, .55);
          this.bloodOnBlade = 1;
          this.kickRoll -= .05;
        }
      }
    }
    if (s.type === 'finisher' && s.t >= .75) { this.lookAt = null; this.frozen = 0; }
    if (s.t >= s.dur) this.swings[s.slot] = null;
  }

  /* Куда пришёлся удар мечом: луч взгляда по цилиндру врага. Если промахнулись мимо
     цилиндра (враг сбоку от прицела), берём высоту по наклону взгляда — смотришь вверх,
     бьёшь в голову; вниз — по ногам. */
  meleeHitPoint(e) {
    const d = this.aimDir();
    const t = rayCylinder(this.pos.x, this.eye, this.pos.z, d.x, d.y, d.z, e.pos.x, e.pos.z, e.type.r + .1, e.pos.y, e.hitTop);
    if (t !== null && t < 3.4) return new THREE.Vector3(this.pos.x + d.x * t, this.eye + d.y * t, this.pos.z + d.z * t);
    const f = clamp(.55 + this.pitch * 1.1, .05, .97);
    return new THREE.Vector3(e.pos.x, e.pos.y + e.type.h * f, e.pos.z);
  }

  startFinisher(e) {
    this.startSwing('finisher', 1.0, 'l').target = e;
    this.frozen = .9;
    this.lookAt = new THREE.Vector3(e.pos.x, e.pos.y + e.type.h * .85, e.pos.z);
    e.beginExecution(this);
    SFX.finisher();
    this.vel.x = this.vel.z = 0;
  }

  shoot() {
    const g = this.g, W = WEAPONS[this.weapon], gn = this.gun();
    if (!this.g.mods?.infiniteAmmo) gn.mag--;
    this.fireCd = W.fireCd;
    this.startSwing('shoot', Math.min(W.fireCd, .9));
    SFX[W.sfx]?.();
    const heavy = W.pellets > 1 || W.projectile;
    this.kickPitch += W.projectile ? .085 : heavy ? .06 : .022; this.kickRoll += rnd(-.012, .012) * (heavy ? 2 : 1); this.fovKick = Math.max(this.fovKick, W.projectile ? 1 : heavy ? .8 : .35);
    /* Ракетница дальше не считает ни дробин, ни лучей: снаряд живёт сам,
       и весь урон случится там, где он взорвётся. */
    if (W.projectile) { g.rockets.fire(this, W); g.enemies.noise(this.pos, 42); return; }
    const base = this.aimDir();
    const ox = this.pos.x, oy = this.eye, oz = this.pos.z;
    const dmgMul = this.S[W.settingDmg] ?? 1;

    /* Сначала собираем все дробины по целям, и только потом бьём — иначе враг умирает
       от третьей дробины и остальные пять уходят в пустоту, а нам нужно знать,
       сколько всего попало и с какой дистанции. */
    const perEnemy = new Map();
    for (let i = 0; i < W.pellets; i++) {
      const d = base.clone();
      d.x += rnd(-W.spread, W.spread); d.y += rnd(-W.spread, W.spread); d.z += rnd(-W.spread, W.spread); d.normalize();
      const wall = g.world.raycast(ox, oy, oz, d.x, d.y, d.z, 120);
      const maxT = wall ? wall.t : 120;
      const hit = g.enemies.rayHit(ox, oy, oz, d, maxT, null);
      const corpse = g.gore.rayCorpse(ox, oy, oz, d.x, d.y, d.z, hit ? hit.t : maxT);
      if (corpse) {
        // попали в лежащий труп — из него летят куски мяса
        g.gore.hitCorpse(corpse, ox + d.x * corpse.t, oy + d.y * corpse.t, oz + d.z * corpse.t, d.x, d.y, d.z, heavy ? 1.4 : 1);
        continue;
      }
      if (hit) {
        const e = hit.enemy;
        let rec = perEnemy.get(e);
        if (!rec) { rec = { n: 0, t: hit.t, dir: d.clone(), zones: new Map() }; perEnemy.set(e, rec); }
        rec.n++;
        /* Каждая дробина считается отдельно и попадает в свою зону: заряд в упор
           накрывает и руку, и корпус сразу, поэтому конечности отлетают одна за
           другой. Раньше весь заряд приписывался точке первой дробины — рвалась
           максимум одна зона, а остальное уходило в общий урон. */
        const pt = new THREE.Vector3(ox + d.x * hit.t, hit.y, oz + d.z * hit.t);
        const part = e.partAt(pt.x, pt.y, pt.z);
        let z = rec.zones.get(part);
        if (!z) { z = { n: 0, point: pt, y: hit.y, t: hit.t }; rec.zones.set(part, z); }
        z.n++;
        if (hit.t < 3) g.hud.screenBlood(1);
      } else if (wall) {
        const px = ox + d.x * wall.t, py = oy + d.y * wall.t, pz = oz + d.z * wall.t;
        if (wall.solid.decal) g.gore.bulletHole(px, py, pz, wall.n);
        g.fx.sparks(px, py, pz, wall.n, heavy ? 2 : 5);
        if (!heavy && Math.random() < .5) SFX.ricochet();
      }
    }

    for (const [e, rec] of perEnemy) {
      /* Порядок зон: сначала конечности, потом голова и корпус. Так отлетевшая
         рука успевает стать событием до того, как остальной заряд добьёт бойца. */
      const order = ['armL', 'armR', 'legL', 'legR', 'head', 'shield', 'torso'];
      const zones = [...rec.zones.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
      let first = true;
      for (const [part, z] of zones) {
      if (!e.alive) break;
      const headshot = part === 'head';
      const dmg = W.dmg * dmgMul * z.n * (headshot ? W.headMul : 1);
      const o = { headshot, part, by: this, hitY: z.y, hitPoint: z.point, bullet: true, shotgun: W.overkill };
      if (heavy) {
        /* Дробовик по дистанции:
           в упор — сносит с ног и рвёт конечности, а иногда разрывает целиком;
           средняя — противник отлетает по дуге;
           дальше — обычное попадание с лёгким толчком.

           Разрыв — это крит, а не правило: шанс тем выше, чем кучнее легла дробь,
           и падает с дистанцией. Раньше в упор рвало всегда, отчего эффект
           перестал читаться как удача. */
        const d = rec.t;
        const critChance = d < 3.4 ? .05 + rec.n * .028 : d < 9 ? .02 + rec.n * .012 : 0;
        // крит считаем по всему заряду и разыгрываем один раз на выстрел
        if (rec.crit === undefined) rec.crit = rec.n >= 3 && Math.random() < critChance;
        if (rec.crit) { o.gib = true; o.knock = 10 + rec.n * 1.4; o.launch = 5 + rec.n * .5; o.heavy = true; }
        else if (d < 3.4) { o.sever = .35; }
        else if (d < 14) { o.sever = .25; }
        else { o.sever = .1; }
        // отбрасывает один раз за выстрел, а не от каждой зоны
        if (first && !rec.crit) {
          if (d < 3.4) { o.knock = 7 + rec.n * 1.5; o.launch = 4 + rec.n * .4; }
          else if (d < 14) { o.knock = 5 + rec.n * 1.7; o.launch = 3 + rec.n * .45; }
          else o.knock = W.knock * rec.n * .6;
        }
      } else if (first) o.knock = W.knock;
      first = false;
      e.hurt(dmg, rec.dir, o);
      }
    }
    g.enemies.noise(this.pos, heavy ? 36 : 28);
  }

  damage(n, fromPos) {
    if (this.dead) return;
    if (!this.g.mods?.god) this.hp -= n;
    this.stats.dmgTaken += n;
    this.kickRoll += rnd(-.06, .06); this.kickPitch += rnd(-.03, .03);
    this.g.hud.pain(Math.min(1, n / 25));
    this.g.hud.damageTaken?.(n);
    SFX.hurt();
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.g.onPlayerDeath(); }
  }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); this.g.hud.flashHeal(); }

  // выдать огнестрел; при одном слоте новое заменяет старое (старое остаётся у игрока только патронами в никуда)
  giveWeapon(kind) {
    const W = WEAPONS[kind]; if (!W) return;
    if (this.guns[kind]) { this.giveAmmo(kind, W.pickupAmmo); this.switchWeapon(kind); return; }
    const others = this.gunList();
    if (others.length >= this.gunSlots) delete this.guns[others[0]];
    this.guns[kind] = { mag: this.magSize(kind), reserve: Math.min(W.reserveMax, W.pickupAmmo * 2) };
    // берём в руки сразу, даже если идёт анимация смены
    this.weapon = kind; this.reloadT = 0; this.startSwing('raise', .25, 'r');
  }
  giveGun() { this.giveWeapon('pistol'); }
  giveAmmo(kind, n) { const gn = this.guns[kind]; if (gn) gn.reserve = Math.min(WEAPONS[kind].reserveMax, gn.reserve + n); }

  applyCamera(camera) {
    camera.position.set(this.pos.x, this.eye, this.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch + this.kickPitch;
    camera.rotation.z = this.roll;
    if (this.shake > 0) {
      const s = this.shake * this.shake;
      camera.rotation.x += rnd(-1, 1) * .09 * s;
      camera.rotation.y += rnd(-1, 1) * .09 * s;
      camera.rotation.z += rnd(-1, 1) * .075 * s;
      camera.position.y += rnd(-1, 1) * .12 * s;
    }
    const fov = (this.S.fov ?? 88) + this.fovKick * 10;
    if (Math.abs(camera.fov - fov) > .05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
}
