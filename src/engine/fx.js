/* Мелкие эффекты: искры, трассеры, вспышки выстрелов. Всё пулится. */
import * as THREE from 'three';
import { TEX } from './textures.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.items = [];
    // искры — инстансы
    this.CAP = 300;
    this.sparksMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(.05, .05), new THREE.MeshBasicMaterial({ color: 0xffd070 }), this.CAP);
    this.sparksMesh.count = 0; this.sparksMesh.frustumCulled = false;
    scene.add(this.sparksMesh);
    this.sp = new Float32Array(this.CAP * 3); this.sv = new Float32Array(this.CAP * 3); this.sl = new Float32Array(this.CAP);
    this.sn = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    // пул источников света для вспышек
    this.flashLights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffc060, 0, 10, 1.8); scene.add(l); this.flashLights.push({ l, t: 0 }); }
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: .9 });
    this.flashMat = new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  }
  sparks(x, y, z, n, count) {
    for (let k = 0; k < count; k++) {
      if (this.sn >= this.CAP) this.sn = 0;
      const i = this.sn++;
      this.sp[i * 3] = x; this.sp[i * 3 + 1] = y; this.sp[i * 3 + 2] = z;
      this.sv[i * 3] = n[0] * 3 + rnd(-3, 3); this.sv[i * 3 + 1] = n[1] * 3 + rnd(-1, 4); this.sv[i * 3 + 2] = n[2] * 3 + rnd(-3, 3);
      this.sl[i] = rnd(.15, .45);
    }
    this.sparksMesh.count = Math.min(this.CAP, Math.max(this.sparksMesh.count, this.sn));
  }
  tracer(ax, ay, az, bx, by, bz, life = .07) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
    const line = new THREE.Line(g, this.tracerMat);
    this.scene.add(line);
    this.items.push({ obj: line, t: life, kind: 'tracer' });
  }
  muzzle(x, y, z, camera, size = .45) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.flashMat);
    m.position.set(x, y, z);
    m.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
    this.scene.add(m);
    this.items.push({ obj: m, t: .06, kind: 'flash' });
    this.light(x, y, z, 0xffc060, 4, .07);
  }
  light(x, y, z, color, intensity, life) {
    let best = this.flashLights[0];
    for (const f of this.flashLights) if (f.t < best.t) best = f;
    best.l.position.set(x, y, z); best.l.color.setHex(color); best.l.intensity = intensity * 14; best.t = life; best.base = intensity * 14; best.life = life;
  }
  update(dt, camera) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t -= dt;
      if (it.t <= 0) { this.scene.remove(it.obj); it.obj.geometry?.dispose?.(); this.items.splice(i, 1); }
    }
    for (const f of this.flashLights) {
      if (f.t > 0) { f.t -= dt; f.l.intensity = f.t <= 0 ? 0 : f.base * (f.t / f.life); }
    }
    const n = Math.min(this.CAP, this.sparksMesh.count);
    const cam = camera.position;
    for (let i = 0; i < n; i++) {
      if (this.sl[i] <= 0) { this._s.set(0, 0, 0); this._m.compose(this._p.set(0, -100, 0), this._q.identity(), this._s); this.sparksMesh.setMatrixAt(i, this._m); continue; }
      this.sl[i] -= dt;
      this.sv[i * 3 + 1] -= 12 * dt;
      const x = (this.sp[i * 3] += this.sv[i * 3] * dt), y = (this.sp[i * 3 + 1] += this.sv[i * 3 + 1] * dt), z = (this.sp[i * 3 + 2] += this.sv[i * 3 + 2] * dt);
      this._p.set(x, y, z); this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(cam.x - x, cam.z - z)); this._s.set(1, 1, 1);
      this._m.compose(this._p, this._q, this._s);
      this.sparksMesh.setMatrixAt(i, this._m);
    }
    this.sparksMesh.instanceMatrix.needsUpdate = true;
  }
}
