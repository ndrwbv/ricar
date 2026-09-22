/* Кровь. Три слоя:
   · капли — один InstancedMesh на 2500 штук, летят по параболе, при падении оставляют декаль;
   · гибсы — пул биллбордов с отскоком и вращением, остаются лежать;
   · декали — инстансы по типам (6 брызг на пол, лужа, 4 брызги на стену, пулевые дыры). */
import * as THREE from 'three';
import { TEX, BLOOD, BLOODWALL } from './textures.js';
import { SPR } from './sprites.js';
import { billboard } from './world.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _fwd = new THREE.Vector3(0, 0, 1), _n = new THREE.Vector3();
const _col = new THREE.Color();

class DecalLayer {
  constructor(scene, tex, cap, floor) {
    const g = new THREE.PlaneGeometry(1, 1);
    // floor === 'ceiling' — плоскость смотрит вниз, иначе вверх; false — вертикальная стена
    if (floor === 'ceiling') g.rotateX(Math.PI / 2);
    else if (floor) g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.cap = cap; this.n = 0; this.next = 0;
    this.grow = [];   // растущие лужи: {i, t, x,y,z, sz, rot}
    scene.add(this.mesh);
  }
  add(x, y, z, size, rot, quat, grow = 0) {
    const i = this.next; this.next = (this.next + 1) % this.cap;
    this.n = Math.min(this.cap, this.n + 1);
    this.mesh.count = this.n;
    this._set(i, x, y, z, grow ? size * .2 : size, rot, quat);
    if (grow) this.grow.push({ i, t: 0, x, y, z, sz: size, rot, quat, dur: grow });
    return i;
  }
  _set(i, x, y, z, size, rot, quat) {
    _p.set(x, y, z);
    if (quat) _q.copy(quat); else _q.setFromAxisAngle(_up, rot);
    _s.set(size, size, size);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  update(dt) {
    for (let k = this.grow.length - 1; k >= 0; k--) {
      const g = this.grow[k];
      g.t += dt;
      const f = Math.min(1, g.t / g.dur);
      this._set(g.i, g.x, g.y, g.z, g.sz * (.2 + .8 * (1 - (1 - f) ** 2)), g.rot, g.quat);
      if (f >= 1) this.grow.splice(k, 1);
    }
  }
  clear() { this.n = 0; this.next = 0; this.mesh.count = 0; this.grow.length = 0; }
}

export class Gore {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    // капли
    this.CAP = 2500;
    const dg = new THREE.PlaneGeometry(.05, .05);
    const dm = new THREE.MeshBasicMaterial({ color: 0x8c0a0c });
    this.drops = new THREE.InstancedMesh(dg, dm, this.CAP);
    this.drops.count = 0; this.drops.frustumCulled = false;
    scene.add(this.drops);
    this.dp = new Float32Array(this.CAP * 3);
    this.dv = new Float32Array(this.CAP * 3);
    this.dl = new Float32Array(this.CAP);   // жизнь
    this.dsz = new Float32Array(this.CAP);
    this.dcleared = new Uint8Array(this.CAP);   // матрица погасшей капли уже обнулена
    this.dn = 0;
    // декали
    this.floorLayers = BLOOD.map(t => new DecalLayer(scene, t, 160, true));
    this.ceilLayers = BLOOD.map(t => new DecalLayer(scene, t, 96, 'ceiling'));
    this.pool = new DecalLayer(scene, TEX.pool, 96, true);
    this.wallLayers = BLOODWALL.map(t => new DecalLayer(scene, t, 96, false));
    this.holes = new DecalLayer(scene, TEX.hole, 128, false);
    // гибсы
    this.gibs = [];
    this.MAXGIBS = 90;
    this.items = [];            // вещи из drop врагов: лежат до конца уровня
    this.MAXITEMS = 64;
    // трупы
    this.corpses = [];
    this.MAXCORPSES = 40;
    // всплески света от крови нет; вспышки выстрелов отдельные
    this.camPos = new THREE.Vector3();
    this.k = 1;   // множитель количества крови (настройки)
  }

  /* ─── капли ─── */
  spray(x, y, z, dx, dy, dz, n, speed = 4, spread = 1) {
    n = Math.round(n * this.k);
    for (let k = 0; k < n; k++) {
      if (this.dn >= this.CAP) this.dn = 0;   // перезапись самых старых
      const i = this.dn++;
      const sp = speed * rnd(.3, 1.2);
      this.dp[i * 3] = x; this.dp[i * 3 + 1] = y; this.dp[i * 3 + 2] = z;
      this.dv[i * 3] = dx * sp + rnd(-spread, spread) * sp * .6;
      this.dv[i * 3 + 1] = dy * sp + rnd(-spread * .4, spread) * sp * .6 + 1.5;
      this.dv[i * 3 + 2] = dz * sp + rnd(-spread, spread) * sp * .6;
      this.dl[i] = rnd(.6, 1.6);
      this.dsz[i] = rnd(.6, 1.8);
      this.dcleared[i] = 0;
    }
    this.drops.count = Math.max(this.drops.count, Math.min(this.CAP, this.dn));
  }
  // фонтан из шеи: вверх с пульсацией
  fountain(x, y, z, n) {
    n = Math.round(n * this.k);
    for (let k = 0; k < n; k++) {
      if (this.dn >= this.CAP) this.dn = 0;
      const i = this.dn++;
      this.dp[i * 3] = x + rnd(-.05, .05); this.dp[i * 3 + 1] = y; this.dp[i * 3 + 2] = z + rnd(-.05, .05);
      this.dv[i * 3] = rnd(-1.2, 1.2); this.dv[i * 3 + 1] = rnd(3.5, 6.5); this.dv[i * 3 + 2] = rnd(-1.2, 1.2);
      this.dl[i] = rnd(1, 2); this.dsz[i] = rnd(1, 2.2);
      this.dcleared[i] = 0;
    }
    this.drops.count = Math.max(this.drops.count, Math.min(this.CAP, this.dn));
  }

  /* ─── декали ─── */
  floorSplat(x, y, z, size = 1, grow = 0) {
    pick(this.floorLayers).add(x, y + .012 + Math.random() * .004, z, size, Math.random() * 6.28, null, grow);
  }
  poolAt(x, y, z, size = 1.6) { this.pool.add(x, y + .01, z, size, Math.random() * 6.28, null, 1.6); }
  wallSplat(x, y, z, n, size = 1, solid = null) {
    // ориентируем квад по нормали стены
    _q.setFromUnitVectors(_fwd, _n.set(n[0], n[1], n[2]));
    if (n[1] < -.5) { pick(this.ceilLayers).add(x, y - .012, z, size, Math.random() * 6.28); return; }   // потолок: кровь висит сверху
    if (n[1] > .5) { pick(this.floorLayers).add(x, y + .012, z, size, Math.random() * 6.28); return; }
    if (solid) {
      // не больше самой поверхности: на низком ящике брызги не должны висеть в воздухе
      const hgt = solid.y1 - solid.y0, wid = Math.abs(n[0]) > .5 ? solid.z1 - solid.z0 : solid.x1 - solid.x0;
      size = Math.min(size, hgt * 1.1, wid * 1.1);
      y = Math.max(solid.y0 + size / 2 - .05, Math.min(solid.y1 - size / 2 + .05, y));
    }
    pick(this.wallLayers).add(x + n[0] * .02, y, z + n[2] * .02, size, 0, _q);
  }
  bulletHole(x, y, z, n) {
    if (Math.abs(n[1]) > .5) return;
    _q.setFromUnitVectors(_fwd, _n.set(n[0], n[1], n[2]));
    this.holes.add(x + n[0] * .015, y, z + n[2] * .015, .12, 0, _q);
  }
  // брызги на ближайшую стену по направлению
  splashDir(x, y, z, dx, dy, dz, size = 1, maxD = 4) {
    const L = Math.hypot(dx, dy, dz) || 1;
    const h = this.world.raycast(x, y, z, dx / L, dy / L, dz / L, maxD);
    if (h && h.solid.decal) this.wallSplat(x + dx / L * h.t, y + dy / L * h.t, z + dz / L * h.t, h.n, size, h.solid);
  }

  /* ─── гибсы ─── */
  gib(name, x, y, z, vx, vy, vz, sizeM, o = {}) {
    if (this.gibs.length >= this.MAXGIBS) {
      const old = this.gibs.shift();
      this.scene.remove(old.mesh);
    }
    const s = SPR[name];
    const w = sizeM, h = sizeM * s.h / s.w;
    const mesh = billboard(s, w, h, { mat: { alphaTest: .2 } });
    mesh.geometry.translate(0, -h / 2, 0);   // центр
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const g = { mesh, vx, vy, vz, spin: rnd(-9, 9), rot: rnd(0, 6.28), rest: false, t: 0, trail: o.trail ?? (Math.random() < .6), bounce: o.bounce ?? .35, head: !!o.head, w, h };
    this.gibs.push(g);
    return g;
  }
  // взрыв тела: набор кусков во все стороны
  burst(x, y, z, dx, dz, names, count, power = 1, o = {}) {
    count = Math.round(count * Math.min(2, this.k));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, sp = rnd(2, 6) * power;
      this.gib(pick(names), x + rnd(-.2, .2), y + rnd(.2, 1.4), z + rnd(-.2, .2),
        Math.cos(a) * sp + dx * 2, rnd(2, 6) * power, Math.sin(a) * sp + dz * 2, rnd(.22, .4));
    }
    this.spray(x, y + .9, z, dx, .3, dz, 120 * power, 5 * power, 1.5);
    this.floorSplat(x, this.world.groundAt(x, z, .1, y + .1), z, rnd(1.6, 2.4) * power, .4);
    // брызги во все стороны по горизонтали
    const rays = o.ceiling ? 8 : 4;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * 6.28 + rnd(-.3, .3);
      this.splashDir(x, y + 1, z, Math.cos(a), rnd(-.2, .4), Math.sin(a), rnd(.9, 1.6) * power, o.ceiling ? 7 : 4);
    }
    // в упор — забрызгивается и потолок
    if (o.ceiling) {
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * 6.28, tilt = rnd(0, .55);
        this.splashDir(x, y + 1.4, z, Math.cos(a) * tilt, 1, Math.sin(a) * tilt, rnd(1, 1.9), 9);
      }
      this.fountain(x, y + 1.2, z, 40);
    }
  }

  /* ─── трупы: плоская груда спрайтом, как в Doom ───
     Биллборд с кадром `dead` из листа врага: перерисовать труп — значит перерисовать
     этот кадр, никакой процедурной геометрии. Вокруг тела движок сам добавляет
     только кровь — лужу и брызги; вещи рядом кладёт сам враг (см. lay). */
  heap(x, y, z, dir, colors, o = {}) {
    if (this.corpses.length >= this.MAXCORPSES) {
      const old = this.corpses.shift();
      this.scene.remove(old); old.geometry?.dispose?.();
    }
    const name = o.sprite || (o.headless ? 'peasant0_deadHeadless' : 'peasant0_dead');
    const spr = SPR[name] || SPR['peasant0_dead'];
    const w = (o.w || 1.5), h = w * spr.h / spr.w;
    const mesh = billboard(spr, w, h, { mat: { alphaTest: .22 } });
    // billboard() ставит низ кадра в точку — труп должен лежать на полу, а не парить
    mesh.position.set(x, y, z);
    mesh.renderOrder = 1;
    // объём для попаданий по нарисованному телу: оно в нижней четверти кадра
    mesh.userData.hit = { x, y, z, r: w * .42, top: y + h * .28, female: !!o.female, meat: 16 };
    mesh.userData.billboard = true;
    this.scene.add(mesh);
    this.corpses.push(mesh);

    /* Вокруг тела — только кровь: лужа и брызги. Куски мяса сами по себе больше
       не раскидываются: что остаётся после врага, решает он сам (`drop` в его
       описании), и кладёт это Enemy.dropItems. */
    this.poolAt(x, y, z, rnd(1.9, 2.7));
    for (let i = 0; i < 3; i++) this.floorSplat(x + rnd(-1, 1), y, z + rnd(-1, 1), rnd(.5, 1.1), .3);
    this.spray(x, y + .3, z, dir?.x || 0, 1, dir?.z || 0, 22, 2, 1.2);
    return mesh;
  }

  /* ─── вещи, оставшиеся после врага ───
     Не мясо и не мусор: это то, что записано врагу в `drop` — вилы, шляпа,
     нож. Лежат картинкой, как остальные спрайты, и живут в своём пуле, чтобы
     их не вытеснял фарш из следующей драки. */
  lay(name, x, y, z, wM = .5) {
    const s = SPR[name];
    if (!s) return null;
    if (this.items.length >= this.MAXITEMS) {
      const old = this.items.shift();
      this.scene.remove(old); old.geometry?.dispose?.();
    }
    const h = wM * s.h / s.w;
    const mesh = billboard(s, wM, h, { mat: { alphaTest: .2 } });
    mesh.position.set(x, this.world.groundAt(x, z, .1, y + .8), z);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.items.push(mesh);
    return mesh;
  }

  /* Луч по грудам тел: возвращает ближайшую. Нужен, чтобы трупы можно было расстреливать. */
  rayCorpse(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    for (const c of this.corpses) {
      const h = c.userData.hit; if (!h || h.meat <= 0) continue;
      const t = rayFlatCyl(ox, oy, oz, dx, dy, dz, h.x, h.z, h.r, h.y - .1, h.top);
      if (t !== null && t < maxT && (!best || t < best.t)) best = { corpse: c, hit: h, t };
    }
    return best;
  }
  /* Взрывная волна по тому, что уже лежит на полу: куски мяса, обломки и
     оторванные конечности подбрасывает и расшвыривает от эпицентра. Это и
     читается как «из точки попадания всё вылетает» — новых объектов при этом
     не создаётся, работают те, что уже в сцене. */
  blast(x, y, z, r, power = 1) {
    const r2 = r * r;
    for (const g of this.gibs) {
      const m = g.mesh;
      const dx = m.position.x - x, dy = m.position.y - y, dz = m.position.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || .001;
      const f = (1 - d / r) * power;
      const k = (5 + 9 * f) / d;
      g.vx += dx * k; g.vy = Math.max(g.vy, 2 + 6 * f); g.vz += dz * k;
      g.spin = rnd(-12, 12);
      g.rest = false;
    }
  }

  // попадание по трупу: куски мяса, брызги, лужа растёт
  hitCorpse(hit, x, y, z, dx, dy, dz, power = 1) {
    const h = hit.hit;
    h.meat -= 1;
    const names = h.female ? ['gib_meat0', 'gib_meat1', 'gib_meat2', 'gib_gut', 'gib_ribs'] : ['gib_meat0', 'gib_meat1', 'gib_meat2', 'gib_gut', 'gib_ribs', 'gib_hand'];
    const n = Math.max(1, Math.round(rnd(.4, 1.8) * power));   // из одного залпа дробовика иначе вылетает пол-пула
    for (let i = 0; i < n; i++) {
      this.gib(pick(names), x, y + .1, z,
        -dx * rnd(1, 3) + rnd(-3, 3), rnd(2.5, 6) * power, -dz * rnd(1, 3) + rnd(-3, 3), rnd(.18, .32));
    }
    this.spray(x, y + .1, z, -dx, .6, -dz, 30 * power, 4, 1.4);
    this.splashDir(x, y + .2, z, -dx, .2, -dz, .9 * power);
    this.floorSplat(h.x, h.y, h.z, rnd(.8, 1.5), .25);
    if (h.meat <= 0) this.poolAt(h.x, h.y, h.z, rnd(2.2, 3));
  }

  update(dt, camera) {
    // капли
    const n = Math.min(this.CAP, this.drops.count);
    let live = 0, touched = false;
    const cam = camera.position;
    for (let i = 0; i < n; i++) {
      if (this.dl[i] <= 0) {
        // гасим слот один раз: переписывать две с половиной тысячи матриц
        // каждый кадр (и гонять их на видеокарту) незачем
        if (!this.dcleared[i]) {
          this.dcleared[i] = 1; touched = true;
          _s.set(0, 0, 0); _m.compose(_p.set(0, -100, 0), _q.identity(), _s); this.drops.setMatrixAt(i, _m);
        }
        continue;
      }
      touched = true;
      this.dl[i] -= dt;
      this.dv[i * 3 + 1] -= 14 * dt;
      const x = (this.dp[i * 3] += this.dv[i * 3] * dt);
      let y = (this.dp[i * 3 + 1] += this.dv[i * 3 + 1] * dt);
      const z = (this.dp[i * 3 + 2] += this.dv[i * 3 + 2] * dt);
      const gy = this.world.groundAt(x, z, .02, y + .3);
      if (y <= gy + .02) {
        // упала: декаль, если недалеко от камеры (дальние не видны)
        if (this.dsz[i] > 1.1 && Math.random() < .5) this.floorSplat(x, gy, z, this.dsz[i] * rnd(.12, .3));
        this.dl[i] = 0; this.dcleared[i] = 1;
        _s.set(0, 0, 0); _m.compose(_p.set(0, -100, 0), _q.identity(), _s); this.drops.setMatrixAt(i, _m);
        continue;
      }
      live++;
      // биллборд к камере
      _p.set(x, y, z);
      _q.setFromAxisAngle(_up, Math.atan2(cam.x - x, cam.z - z));
      const sz = this.dsz[i];
      _s.set(sz, sz * (1 + Math.min(1.4, Math.abs(this.dv[i * 3 + 1]) * .18)), sz);
      _m.compose(_p, _q, _s);
      this.drops.setMatrixAt(i, _m);
    }
    if (touched) this.drops.instanceMatrix.needsUpdate = true;
    if (live === 0 && n > 0 && this.dn >= this.CAP) { this.dn = 0; this.drops.count = 0; }

    // гибсы
    for (const g of this.gibs) {
      g.t += dt;
      const m = g.mesh;
      m.rotation.y = Math.atan2(cam.x - m.position.x, cam.z - m.position.z);
      if (g.rest) continue;
      g.vy -= 16 * dt;
      m.position.x += g.vx * dt; m.position.y += g.vy * dt; m.position.z += g.vz * dt;
      g.rot += g.spin * dt; m.rotation.z = g.rot;
      // стены
      const [nx, nz] = this.world.moveCircle(m.position.x - g.vx * dt, m.position.z - g.vz * dt, .1, m.position.y - g.h / 2, g.h, g.vx * dt, g.vz * dt);
      if (Math.abs(nx - m.position.x) > 1e-4 || Math.abs(nz - m.position.z) > 1e-4) {
        // ударился о стену: брызги
        this.splashDir(nx, m.position.y, nz, g.vx, 0, g.vz, .7);
        m.position.x = nx; m.position.z = nz; g.vx *= -.4; g.vz *= -.4;
      }
      if (g.trail && Math.random() < .5) this.spray(m.position.x, m.position.y, m.position.z, 0, 0, 0, 1, .5, .5);
      const gy = this.world.groundAt(m.position.x, m.position.z, .1, m.position.y + .5) + g.h / 2;
      if (m.position.y <= gy) {
        m.position.y = gy;
        if (Math.abs(g.vy) > 2) {
          g.vy = -g.vy * g.bounce; g.vx *= .6; g.vz *= .6; g.spin *= .5;
          this.floorSplat(m.position.x, gy - g.h / 2, m.position.z, rnd(.3, .7));
          this.spray(m.position.x, gy, m.position.z, 0, 1, 0, 6, 1.5, 1);
        } else {
          g.rest = true; g.vx = g.vz = g.vy = 0;
          m.rotation.z = g.head ? 0 : (Math.random() < .5 ? Math.PI / 2 : -Math.PI / 2) * (Math.random() < .5 ? 1 : .8);
          m.position.y = gy - g.h / 2 + (g.head ? g.h / 2 : g.w / 2) * .9;
          this.floorSplat(m.position.x, gy - g.h / 2, m.position.z, rnd(.4, .9), .3);
        }
      }
    }
    // трупы и оставшиеся вещи — тоже биллборды, держим их лицом к камере
    for (const c of this.corpses) if (c.userData.billboard) c.rotation.y = Math.atan2(cam.x - c.position.x, cam.z - c.position.z);
    for (const m of this.items) m.rotation.y = Math.atan2(cam.x - m.position.x, cam.z - m.position.z);
    for (const l of this.floorLayers) l.update(dt);
    for (const l of this.wallLayers) l.update(dt);
    for (const l of this.ceilLayers) l.update(dt);
    this.pool.update(dt);
  }

  // убрать летящие капли и гибсы рядом с точкой (при телепорте)
  clearNear(x, z, r) {
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const g = this.gibs[i];
      if (!g.rest && Math.hypot(g.mesh.position.x - x, g.mesh.position.z - z) < r) { this.scene.remove(g.mesh); this.gibs.splice(i, 1); }
    }
    for (let i = 0; i < this.CAP; i++) if (this.dl[i] > 0 && Math.hypot(this.dp[i * 3] - x, this.dp[i * 3 + 2] - z) < r) this.dl[i] = 0;
  }

  clear() {
    for (const g of this.gibs) this.scene.remove(g.mesh);
    this.gibs.length = 0;
    for (const m of this.items) { this.scene.remove(m); m.geometry?.dispose?.(); }
    this.items.length = 0;
    for (const c of this.corpses) this.scene.remove(c);
    this.corpses.length = 0;
    for (const l of this.floorLayers) l.clear();
    for (const l of this.wallLayers) l.clear();
    for (const l of this.ceilLayers) l.clear();
    this.pool.clear(); this.holes.clear();
    this.dl.fill(0); this.dcleared.fill(1); this.dn = 0; this.drops.count = 0;
  }
}

// луч по вертикальному цилиндру (для груд тел) — та же математика, что у врагов
function rayFlatCyl(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1) {
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
