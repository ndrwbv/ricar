/* Деньги, выпадающие из убитых, — как пачки в GTA: объёмный блок купюр,
   который крутится на месте и светится сам по себе, а когда подходишь —
   присасывается к игроку и летит в руки.

   Светится он буквально: материал блока не принимает свет (MeshBasicMaterial),
   поэтому в чёрном коридоре пачка остаётся такой же яркой, как у костра, —
   иначе добычу на полу пещеры просто не видно. Поверх блока идёт аддитивный
   ореол, он же и выдаёт деньги издалека.

   Оба слоя — по одному InstancedMesh: сколько бы пачек ни валялось, это два
   вызова отрисовки. Разворот ореола к камере считается на месте: у инстансов
   своей ориентации нет. */
import * as THREE from 'three';
import { TEX } from '../engine/textures.js';
import { SFX } from '../engine/audio.js';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const rnd = (a, b) => a + Math.random() * (b - a);

const MAGNET = 3.2;                  // с какого расстояния пачка тянется к игроку
const TAKE = .8;                     // и с какого считается подобранной

class Layer {
  constructor(scene, geo, mat, cap) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  set(i, x, y, z, q, s) {
    _p.set(x, y, z); _s.set(s, s, s);
    _m.compose(_p, q, _s);
    this.mesh.setMatrixAt(i, _m);
  }
  flush(n) { this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

export class Money {
  constructor(game, cap = 260) {
    this.g = game;
    this.cap = cap;
    this.coins = [];
    const cash = new THREE.MeshBasicMaterial({ map: TEX.cash });
    const glowMat = new THREE.MeshBasicMaterial({
      map: TEX.glow, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0x70ff90, opacity: .5,
    });
    this.block = new Layer(game.scene, new THREE.BoxGeometry(.34, .14, .22), cash, cap);
    this.glow = new Layer(game.scene, new THREE.PlaneGeometry(1.1, 1.1), glowMat, cap);
    this.glow.mesh.renderOrder = 3;
    this.onPick = null;              // (сумма) -> void
    this.sfxT = 0;                   // пауза между звяканьями
  }

  /* Сумма бьётся на пачки: мелочь по 3-6, крупная добыча — толстыми пачками
     по 25. Три сотни отдельных бумажек на полу не нужны никому. */
  drop(x, y, z, value, o = {}) {
    let left = Math.max(1, Math.round(value));
    const power = o.power ?? 1;
    let guard = 40;
    while (left > 0 && guard-- > 0) {
      const big = left >= 40 || (o.big && left >= 20);
      const val = big ? Math.min(left, 25) : Math.min(left, 3 + ((Math.random() * 4) | 0));
      left -= val;
      if (this.coins.length >= this.cap) this.coins.shift();
      const a = Math.random() * 6.283, sp = rnd(1.4, 3.6) * power;
      this.coins.push({
        x, y: y + .3, z, vx: Math.cos(a) * sp, vy: rnd(3, 5.5) * power, vz: Math.sin(a) * sp,
        val, big, t: rnd(0, 6), spin: rnd(1.6, 2.6) * (Math.random() < .5 ? -1 : 1), rest: 0, life: 0,
      });
    }
  }

  update(dt, camera) {
    const g = this.g, p = g.player, w = g.world;
    const cq = camera.quaternion;
    this.sfxT -= dt;
    let n = 0;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt; c.life += dt;
      const dx = p.pos.x - c.x, dz = p.pos.z - c.z, dy = p.pos.y + .9 - c.y;
      const d = Math.hypot(dx, dz);
      /* Притяжение сильнее у самого игрока: издалека пачка только трогается
         с места, вблизи выстреливает в руки. Так видно, что её именно
         засасывает, а не что она телепортировалась. */
      if (c.life > .3 && d < MAGNET) {
        const k = 1 - d / MAGNET;
        const sp = (4 + k * 16) * dt;
        const inv = 1 / Math.max(.001, Math.hypot(dx, dy, dz));
        c.x += dx * inv * sp; c.y += dy * inv * sp; c.z += dz * inv * sp;
        c.rest = 1;
        if (d < TAKE && Math.abs(dy) < 2.2) {
          this.onPick?.(c.val);
          /* Звенит не каждая пачка: подобрать десяток за секунду — обычное
             дело, и десяток наложенных щелчков превращается в треск. */
          if (this.sfxT <= 0) { SFX.pickup?.(); this.sfxT = .11; }
          this.coins.splice(i, 1);
          continue;
        }
      } else if (c.rest <= 0) {
        c.vy -= 19 * dt;
        c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        /* Пачка не ложится на пол, а зависает над ним: на полу пещеры она
           теряется среди камней и крови, а на уровне колена её видно
           из другого конца зала. */
        const gr = w.groundAt(c.x, c.z, .12, c.y + 1.2) + .8;
        if (c.y <= gr) {
          c.y = gr;
          if (c.vy < -1.4) { c.vy = -c.vy * .34; c.vx *= .55; c.vz *= .55; }
          else { c.vy = 0; c.vx = 0; c.vz = 0; c.rest = 1; }
        }
      }
      // лежалая пачка через полторы минуты гаснет: карту не засоряем
      if (c.life > 95) { this.coins.splice(i, 1); continue; }

      const s = c.big ? 1.7 : 1;
      const y = c.y + (c.rest ? Math.sin(c.t * 2.6) * .09 : 0);
      _e.set(.32, c.t * c.spin, .12);
      _q.setFromEuler(_e);
      this.block.set(n, c.x, y, c.z, _q, s);
      this.glow.set(n, c.x, y, c.z, cq, s * (.5 + Math.sin(c.t * 4) * .06));
      n++;
    }
    this.block.flush(n); this.glow.flush(n);
  }

  pickupAll() {                        // всё оставшееся — в карман (выход из пещеры)
    let sum = 0;
    for (const c of this.coins) sum += c.val;
    this.clear();
    return sum;
  }
  clear() { this.coins.length = 0; this.block.flush(0); this.glow.flush(0); }
  dispose() { this.block.dispose(); this.glow.dispose(); }
}
