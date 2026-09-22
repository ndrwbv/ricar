/* Оружие от первого лица в 3D: меч с латной рукой, пистолет, дробовик, сапог для пинка.
   Модели строятся из примитивов (низкополигональные, под пиксельный рендер). Если в public/models лежит
   sword.glb / pistol.glb / shotgun.glb — он подменит процедурную модель (см. tryLoadGLB).
   В комплекте идёт shotgun.glb — дробовик Quaternius из Ultimate Guns Pack, CC0 (public domain),
   746 треугольников, см. public/models/CREDITS.md.

   Чужую модель не нужно готовить руками: fitModel сам находит самую длинную ось, определяет,
   где дуло (тонкий конец), разворачивает ствол вдоль −Z, нормирует длину и ставит вспышку на срез.
   Рисуется отдельной сценой поверх основной с очищенным depth-буфером, поэтому не залезает в стены. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TEX } from './textures.js';

const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const easeOut = t => 1 - (1 - t) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.position.set(x, y, z); return g; };
const cyl = (r1, r2, h, m, x = 0, y = 0, z = 0, seg = 8) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); g.position.set(x, y, z); return g; };

const STEEL = 0x9aa2ac, STEEL_D = 0x5c6470, IRON = 0x3a4048, LEATHER = 0x4a2e1a, GOLD = 0xc8a040, RED = 0x8a1418, GUNMETAL = 0x22252a, WOOD = 0x5a3a1a, SKIN = 0xc8956a;

/* ─── латная рука: предплечье с пластинами, перчатка, красный рукав. Ось руки — вдоль -Z, кисть в (0,0,0) ─── */
function buildArm() {
  const g = new THREE.Group();
  const steel = mat(0x5a6470), dark = mat(0x3a4048), red = mat(RED);
  g.add(cyl(.055, .07, .34, steel, 0, 0, .19));             // предплечье
  for (let i = 0; i < 3; i++) g.add(box(.15, .04, .06, dark, 0, .045, .08 + i * .1));   // пластины сверху
  g.add(cyl(.075, .08, .08, red, 0, 0, .38));               // рукав
  g.add(box(.11, .09, .13, steel, 0, 0, -.02));              // кисть
  for (let i = 0; i < 4; i++) g.add(box(.022, .03, .07, dark, -.04 + i * .027, -.01, -.1)); // пальцы
  g.add(box(.03, .03, .06, dark, .06, .0, -.05));            // большой палец
  // предплечье и рукав — цилиндры вдоль Z
  g.children[0].rotation.x = Math.PI / 2; g.children[4].rotation.x = Math.PI / 2;
  return g;
}
// направить руку (её ось +Z) от кисти к плечу игрока: вниз-вправо-к камере
function aimArm(arm, dir = [.45, -.85, .6]) { const t = new THREE.Vector3(...dir).normalize().add(arm.position); arm.lookAt(t); }

/* ─── меч: клинок вдоль +Y от рукояти. Начало координат — в кулаке ─── */
function buildSword() {
  const g = new THREE.Group();
  const bladeMat = mat(STEEL); g.userData.bladeMat = bladeMat;
  const blade = box(.11, .82, .018, bladeMat, 0, .1 + .41, 0); g.add(blade);
  const ridge = box(.03, .8, .026, mat(0xd8dee6), 0, .1 + .4, 0); g.add(ridge);          // грань
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.06, .16, 4), bladeMat); tip.rotation.y = Math.PI / 4; tip.scale.set(1, 1, .3); tip.position.y = .1 + .82 + .07; g.add(tip);
  g.add(box(.34, .05, .06, mat(IRON), 0, .08, 0));                                          // гарда
  g.add(box(.06, .05, .06, mat(GOLD), 0, .08, 0));
  g.add(cyl(.022, .022, .2, mat(LEATHER), 0, -.04, 0));                                    // рукоять
  g.add(new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), mat(IRON))).position.y = -.16;  // навершие
  const arm = buildArm(); arm.position.set(0, -.06, .02); arm.name = 'arm'; aimArm(arm, [-.5, -.8, .55]); g.add(arm);   // меч в левой руке
  g.scale.setScalar(.72);
  return g;
}

/* ─── пистолет: ствол вдоль -Z ─── */
function buildPistol() {
  const g = new THREE.Group();
  const gm = mat(GUNMETAL), gl = mat(0x3a3f46);
  g.add(box(.05, .06, .28, gm, 0, .03, -.1));                    // затвор
  g.add(box(.052, .02, .26, gl, 0, .062, -.1));                  // верх затвора
  g.add(cyl(.012, .012, .05, gm, 0, .03, -.26)).rotation.x = Math.PI / 2;   // срез ствола
  g.add(box(.045, .05, .2, gm, 0, -.02, -.06));                  // рамка
  const grip = box(.045, .13, .06, mat(WOOD), 0, -.1, .02); grip.rotation.x = .25; g.add(grip);
  g.add(box(.006, .012, .01, mat(0xff4040), 0, .075, -.22));     // мушка/индикатор
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(.18, .18), new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.position.set(0, .03, -.32); flash.name = 'flash'; flash.visible = false; g.add(flash);
  const arm = buildArm(); arm.position.set(0, -.12, .06); arm.name = 'arm'; aimArm(arm, [.3, -.9, .7]); g.add(arm);
  g.scale.setScalar(.85);
  return g;
}

/* ─── дробовик: помповый, ствол вдоль -Z ─── */
function buildShotgun() {
  const g = new THREE.Group();
  const gm = mat(GUNMETAL), wood = mat(WOOD), gl = mat(0x3a3f46);
  g.add(cyl(.016, .016, .7, gm, 0, .04, -.35)).rotation.x = Math.PI / 2;      // ствол
  g.add(cyl(.014, .014, .55, gl, 0, .0, -.3)).rotation.x = Math.PI / 2;       // трубчатый магазин
  g.add(box(.06, .09, .22, gm, 0, .01, -.02));                                // коробка
  g.add(box(.02, .03, .04, mat(0xc8a040), 0, .07, -.02));                     // окно выброса
  const pump = box(.06, .06, .16, wood, 0, -.005, -.38); pump.name = 'pump'; g.add(pump);
  const stock = box(.055, .09, .3, wood, 0, -.06, .22); stock.rotation.x = -.18; g.add(stock);
  g.add(box(.04, .1, .05, wood, 0, -.08, .07));                               // рукоять
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(.3, .3), new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.position.set(0, .04, -.76); flash.name = 'flash'; flash.visible = false; g.add(flash);
  const arm = buildArm(); arm.position.set(0, -.13, .1); arm.name = 'arm'; aimArm(arm, [.3, -.9, .7]); g.add(arm);
  const arm2 = buildArm(); arm2.position.set(-.01, -.06, -.36); arm2.name = 'arm2'; aimArm(arm2, [-.35, -.9, .9]); g.add(arm2);
  g.scale.setScalar(.8);
  return g;
}

/* ─── ракетница: труба на плече, дуло вдоль -Z ─── */
function buildRocketLauncher() {
  const g = new THREE.Group();
  const gm = mat(GUNMETAL), gl = mat(0x3a3f46), red = mat(RED);
  // цилиндры лежат вдоль Y — каждому поворачиваем его собственную ось, а не группу
  const lie = m => { m.rotation.x = Math.PI / 2; return m; };
  g.add(lie(cyl(.085, .085, .95, gm, 0, .04, -.3)));          // труба
  g.add(lie(cyl(.11, .075, .13, gl, 0, .04, .16)));           // раструб сзади
  g.add(lie(cyl(.1, .1, .06, gl, 0, .04, -.74)));             // срез дула
  g.add(box(.05, .045, .5, gl, 0, .12, -.3));                  // короб прицела
  g.add(box(.02, .045, .03, red, 0, .155, -.52));              // мушка
  g.add(box(.085, .05, .16, gm, 0, -.05, -.04));               // скоба
  const grip = box(.05, .14, .07, mat(0x2a2c30), 0, -.13, .02); grip.rotation.x = .2; g.add(grip);
  g.add(box(.05, .1, .06, mat(0x2a2c30), 0, -.07, -.34));      // передняя рукоять
  for (let i = 0; i < 3; i++) g.add(box(.19, .012, .03, gl, 0, .04, -.58 + i * .24));   // хомуты
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(.4, .4), new THREE.MeshBasicMaterial({ map: TEX.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.position.set(0, .04, -.82); flash.name = 'flash'; flash.visible = false; g.add(flash);
  const arm = buildArm(); arm.position.set(.02, -.16, .04); arm.name = 'arm'; aimArm(arm, [.3, -.9, .7]); g.add(arm);
  const arm2 = buildArm(); arm2.position.set(-.02, -.11, -.34); arm2.name = 'arm2'; aimArm(arm2, [-.35, -.9, .9]); g.add(arm2);
  g.scale.setScalar(.7);
  return g;
}

/* ─── сапог с поножем ─── */
function buildBoot() {
  const g = new THREE.Group();
  g.add(box(.14, .5, .16, mat(0x5a6470), 0, .25, 0));                         // поножь
  g.add(box(.15, .1, .34, mat(0x2a1e14), 0, -.02, -.09));                     // сапог
  for (let i = 0; i < 4; i++) g.add(box(.02, .02, .03, mat(0x8a8a90), -.045 + i * .03, -.05, -.24));  // шипы подошвы
  return g;
}

/* ─── подгонка чужой модели ───
   len — во сколько метров вписать длину, axis — куда смотрит «рабочий конец»:
   'z' — ствол вперёд (−Z), 'y' — клинок вверх (+Y). */
const FIT = {
  sword: { axis: 'y', len: 1.05, back: .22 },
  pistol: { axis: 'z', len: .42, back: .3 },
  shotgun: { axis: 'z', len: .95, back: .28 },
  rocket: { axis: 'z', len: 1.15, back: .3 },
};

/* glTF приходит с PBR-материалами: у металлических частей metalness = 1, а без карты
   окружения такой материал рисуется чёрным — дробовик выглядел как один приклад.
   Переводим всё в Lambert: и видно, и совпадает с остальной низкополигональной графикой. */
function flattenMaterials(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const out = src.map(m => {
      if (!m) return mat(0x888888);
      const lam = new THREE.MeshLambertMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0x888888),
        map: m.map || null, vertexColors: !!m.vertexColors,
        transparent: !!m.transparent, opacity: m.opacity ?? 1, side: m.side,
        emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
        emissiveMap: m.emissiveMap || null,
      });
      // блестящий металл делаем чуть светлее, чтобы читался ствол
      if (m.metalness > .5) lam.color.multiplyScalar(1.6);
      m.dispose?.();
      return lam;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    o.castShadow = o.receiveShadow = false;
  });
}

function disposeTree(o) { o.traverse?.(c => { c.geometry?.dispose?.(); if (Array.isArray(c.material)) c.material.forEach(m => m.dispose?.()); else c.material?.dispose?.(); }); }

// все вершины модели в её собственных координатах
function collectPoints(root) {
  root.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  root.traverse(o => {
    const pa = o.geometry?.attributes?.position; if (!pa) return;
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); }
  });
  return pts;
}

function fitModel(model, fit) {
  const P = collectPoints(model);
  const n = P.length / 3;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = P[i * 3 + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  let L = 0; for (let a = 1; a < 3; a++) if (size[a] > size[L]) L = a;                 // самая длинная ось
  const len = size[L] || 1;
  // где дуло: на тонком конце разброс по двум другим осям меньше
  const A = (L + 1) % 3, B = (L + 2) % 3;
  const cA = (min[A] + max[A]) / 2, cB = (min[B] + max[B]) / 2;
  const spread = (lo, hi) => {
    let s = 0;
    for (let i = 0; i < n; i++) { const v = P[i * 3 + L]; if (v < lo || v > hi) continue; s = Math.max(s, Math.hypot(P[i * 3 + A] - cA, P[i * 3 + B] - cB)); }
    return s;
  };
  const cut = len * .18;
  const thinHigh = spread(max[L] - cut, max[L]) < spread(min[L], min[L] + cut);
  const tipSign = thinHigh ? 1 : -1;                                                    // по какой стороне оси дуло/остриё

  // разворот: рабочий конец модели → −Z (ствол) или +Y (клинок)
  const wrap = new THREE.Group();
  const inner = new THREE.Group();
  const want = fit.axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);
  const have = new THREE.Vector3(L === 0 ? tipSign : 0, L === 1 ? tipSign : 0, L === 2 ? tipSign : 0);
  inner.quaternion.setFromUnitVectors(have, want);
  // модель в центр координат, потом масштаб
  model.position.set(-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -(min[2] + max[2]) / 2);
  inner.add(model);
  wrap.add(inner);
  wrap.scale.setScalar(fit.len / len);

  // сдвиг: приклад/рукоять у начала координат, ствол/клинок уходит вперёд
  if (fit.axis === 'y') wrap.position.set(0, fit.len * (.5 - fit.back), 0);
  else wrap.position.set(0, .03, -fit.len * (.5 - fit.back));
  wrap.userData.muzzleZ = -fit.len * (1 - fit.back);
  wrap.userData.boreY = .03;
  return wrap;
}

/* ─── оружие, лежащее в мире ───
   Та же модель, что и в руках, только без рук и дульной вспышки: подобрать
   ствол можно, пока он крутится вокруг своей оси и светится — как в Quake.
   Свой public/models/<kind>.glb подменяет процедурную модель и здесь тоже. */
export function worldWeapon(kind, lenM = .9) {
  const build = { pistol: buildPistol, shotgun: buildShotgun, rocket: buildRocketLauncher, sword: buildSword }[kind];
  if (!build) return null;
  const g = new THREE.Group();
  g.add(fitWorld(stripHands(build()), lenM));
  glowMaterials(g);
  if (FIT[kind]) new GLTFLoader().load(`./models/${kind}.glb`, gltf => {
    flattenMaterials(gltf.scene);
    for (const c of [...g.children]) { g.remove(c); disposeTree(c); }
    g.add(fitWorld(gltf.scene, lenM));
    glowMaterials(g);
  }, undefined, () => { /* файла нет — остаётся процедурная модель */ });
  return g;
}
/* ─── припас, лежащий в мире ───
   Аптечка, обойма, коробка патронов и ящик ракет — такие же объёмные вещи,
   как и стволы: плоская картинка рядом с крутящейся моделью выглядела
   наклейкой, и в темноте её не было видно вовсе. Материалы светятся сами
   (emissive), поэтому припас читается в любом коридоре. */
export function worldPickup(kind, sizeM = .5) {
  const g = new THREE.Group();
  const white = mat(0xe8e4dc), red = mat(0xc81020), steel = mat(0x8a929c), dark = mat(0x2a2c30);
  const olive = mat(0x5a5a2a), brass = mat(0xc8a030), wood = mat(0x5a3a1a);
  if (kind === 'health') {
    g.add(box(1, .62, .7, white));
    g.add(box(1.02, .16, .72, red, 0, .04, 0));            // красная полоса по коробу
    g.add(box(.3, .1, .74, red, 0, .22, 0));               // крест на крышке
    g.add(box(.1, .3, .74, red, 0, .22, 0));
    g.add(box(.36, .12, .12, steel, 0, .36, 0));           // ручка
  } else if (kind === 'ammo') {
    g.add(box(.9, .42, .52, olive));
    g.add(box(.94, .1, .56, dark, 0, .18, 0));
    for (let i = 0; i < 4; i++) g.add(cyl(.06, .06, .5, brass, -.3 + i * .2, .3, 0, 6));
  } else if (kind === 'shells') {
    g.add(box(.9, .4, .5, wood));
    g.add(box(.94, .08, .54, dark, 0, .16, 0));
    for (let i = 0; i < 4; i++) {
      g.add(cyl(.08, .08, .34, red, -.27 + i * .18, .3, 0, 6));
      g.add(cyl(.085, .085, .1, brass, -.27 + i * .18, .18, 0, 6));
    }
  } else if (kind === 'rockets') {
    g.add(box(1, .44, .56, olive));
    g.add(box(1.04, .1, .6, dark, 0, .2, 0));
    for (let i = 0; i < 2; i++) {
      g.add(cyl(.11, .11, .5, steel, -.22 + i * .44, .34, 0, 8));
      g.add(cyl(.02, .11, .18, red, -.22 + i * .44, .66, 0, 8));
    }
  } else return null;
  const wrap = new THREE.Group();
  wrap.add(fitWorld(g, sizeM));
  glowMaterials(wrap);
  return wrap;
}

// руки и вспышка нужны только от первого лица: в мире лежит один ствол
function stripHands(model) {
  for (const c of [...model.children]) if (['arm', 'arm2', 'flash'].includes(c.name)) { model.remove(c); disposeTree(c); }
  return model;
}
// вписать модель в длину lenM и поставить центром в начало координат, чтобы она крутилась вокруг себя
function fitWorld(model, lenM) {
  const wrap = new THREE.Group();
  wrap.add(model);
  const b = new THREE.Box3().setFromObject(model);
  const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  model.position.sub(c);
  wrap.scale.setScalar(lenM / (Math.max(size.x, size.y, size.z) || 1));
  return wrap;
}
// подсветка: лежащий в темноте ствол иначе не видно, а подбираемое должно звать к себе
function glowMaterials(root) {
  root.traverse(o => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) m.emissive?.setHex(0x2a2f36);
  });
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, .02, 12);
    this.scene.add(new THREE.HemisphereLight(0xfff0e0, 0x402020, 1.6));
    const sun = new THREE.DirectionalLight(0xffe0c0, 1.8); sun.position.set(-1, 2, 1); this.scene.add(sun);
    this.rim = new THREE.PointLight(0xff8040, 0, 4); this.rim.position.set(.3, -.2, -.6); this.scene.add(this.rim);
    this.models = { sword: buildSword(), pistol: buildPistol(), shotgun: buildShotgun(), rocket: buildRocketLauncher(), boot: buildBoot() };
    for (const m of Object.values(this.models)) { this.scene.add(m); m.visible = false; }
    this.blood = new THREE.Color(0x6a0408); this.steel = new THREE.Color(STEEL);
    this.charged = new THREE.Color(0xd8e4ff);   // накопленный замах: клинок будто калёный
    this.tryLoadGLB('sword'); this.tryLoadGLB('pistol'); this.tryLoadGLB('shotgun'); this.tryLoadGLB('rocket');
  }
  // подмена процедурной модели своей: public/models/<name>.glb — ориентация и масштаб подгоняются сами
  tryLoadGLB(name) {
    const fit = FIT[name]; if (!fit) return;
    new GLTFLoader().load(`./models/${name}.glb`, gltf => {
      const grp = this.models[name];
      flattenMaterials(gltf.scene);
      const wrap = fitModel(gltf.scene, fit);
      // процедурные детали убираем, руки и вспышку оставляем
      for (const c of [...grp.children]) if (!['arm', 'arm2', 'flash'].includes(c.name)) { grp.remove(c); disposeTree(c); }
      grp.add(wrap);
      const flash = grp.getObjectByName('flash');
      if (flash && fit.axis === 'z') flash.position.set(0, wrap.userData.boreY, wrap.userData.muzzleZ - .04);
      /* Руки остаются процедурными — двигаем их к рукояти и цевью новой модели.
         Поворот не трогаем: aimArm считает lookAt в мировых координатах и на уже
         добавленной в сцену группе развернул бы кисть рукавом в камеру. */
      if (fit.axis === 'z') {
        const mz = wrap.userData.muzzleZ, by = wrap.userData.boreY;
        const a1 = grp.getObjectByName('arm'); if (a1) a1.position.set(-.01, by - .16, mz * .1);
        const a2 = grp.getObjectByName('arm2'); if (a2) a2.position.set(-.01, by - .09, mz * .5);
      }
      grp.userData.glb = true;
      console.log(`модель ${name}.glb: длина ${fit.len} м, дуло по −Z`);
    }, undefined, () => { /* файла нет — остаётся процедурная модель */ });
  }
  setFov(fov, aspect) { this.camera.fov = Math.min(75, fov * .72); this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  /* Рисуем то, что сейчас в руках. Меч — всегда левая рука (модель считается как правая
     и зеркалится множителем HAND), огнестрел — правая. В режиме «обе руки» видно и то и другое,
     каждая рука живёт своим замахом: p.swings.l — меч, .r — ствол, .k — пинок. */
  update(p, time, lightLevel = 1) {
    for (const m of Object.values(this.models)) m.visible = false;
    if (p.dead) return;
    const bobX = Math.sin(p.bobT) * .012 * p.bobAmt, bobY = Math.abs(Math.cos(p.bobT)) * .014 * p.bobAmt;
    const swayX = -p.kickRoll * .8, swayY = p.kickPitch * .6;
    this.rim.intensity = 0;
    const both = p.mode === 'both';

    if (p.swings.k) this.drawBoot(p.swings.k, swayX);
    if (p.hasGunOut) this.drawGun(p, time, bobX, bobY, swayX, swayY, both);
    if (p.hasSwordOut) this.drawSword(p, time, bobX, bobY, swayX, swayY, both);
  }

  drawBoot(s, swayX) {
    const m = this.models.boot; m.visible = true;
    const f = s.t / s.dur, up = f < .35 ? easeOut(f / .35) : 1 - ease((f - .35) / .65);
    m.position.set(0 + swayX, lerp(-.9, -.34, up), lerp(-.45, -.8, up));
    m.rotation.set(lerp(.6, -.2, up), 0, 0);
  }

  drawGun(p, time, bobX, bobY, swayX, swayY, both) {
    const kind = p.gunKind;
    const m = this.models[kind]; if (!m) return;
    m.visible = true;
    const def = p.WEAPONS[kind];
    const s = p.swings.r;
    let px = (kind === 'rocket' ? .13 : kind === 'shotgun' ? .16 : .2) + (both ? .07 : 0),
      py = kind === 'rocket' ? -.26 : kind === 'shotgun' ? -.24 : -.2,
      pz = kind === 'rocket' ? -.62 : kind === 'shotgun' ? -.4 : -.42;
    // трубу разворачиваем чуть сильнее: иначе в кадре одна серая доска без деталей
    let rx = kind === 'rocket' ? .05 : 0, ry = kind === 'rocket' ? -.16 : -.06, rz = 0;
    const flash = m.getObjectByName('flash'); if (flash) flash.visible = false;
    if (s && s.type === 'shoot') {
      const f = s.t / s.dur, r = Math.sin(Math.min(1, f * 2) * Math.PI);
      // ракетница подбрасывает ствол сильнее всех: труба уходит в плечо
      pz += r * (kind === 'rocket' ? .2 : kind === 'shotgun' ? .12 : .07);
      rx += r * (kind === 'rocket' ? .5 : kind === 'shotgun' ? .35 : .22);
      py += r * (kind === 'rocket' ? .05 : .02);
      if (s.t < (kind === 'rocket' ? .09 : .06) && flash) { flash.visible = true; flash.rotation.z = time * 40; flash.scale.setScalar(.8 + Math.random() * .6); this.rim.intensity = 6; }
      const pump = m.getObjectByName('pump');
      if (pump && kind === 'shotgun') { const pf = Math.max(0, Math.min(1, (s.t - .25) / .5)); pump.position.z = -.38 + Math.sin(pf * Math.PI) * .12; }
    }
    if (s && s.type === 'raise') { const f = 1 - s.t / s.dur; py -= f * .6; rx -= f * .8; }
    if (p.reloadT > 0) { const f = p.reloadT / def.reload, dip = Math.sin(f * Math.PI); py -= dip * .35; rx -= dip * .9; rz += dip * .6; }
    m.position.set(px + bobX + swayX, py + bobY + swayY, pz);
    m.rotation.set(rx, ry, rz);
  }

  drawSword(p, time, bobX, bobY, swayX, swayY, both) {
    const m = this.models.sword; m.visible = true;
    /* Сколько стамины накоплено — видно по самому клинку: к полной полосе он
       светлеет и начинает мелко дрожать в руке. Полоса в углу это дублирует,
       но в бою смотрят в центр экрана, а не в угол. */
    const chg = p.staminaMax ? clamp((p.stamina / p.staminaMax - .7) / .3, 0, 1) : 0;
    m.userData.bladeMat.color.copy(this.steel).lerp(this.blood, Math.min(1, p.bloodOnBlade * .9)).lerp(this.charged, chg * .5);
    const s = p.swings.l;
    // считаем как для правой руки, в конце зеркалим по X
    // держим клинок ближе к центру и чуть дальше от камеры, иначе на 4:3 он уезжает за край
    let px = .13 + (both ? .05 : 0), py = -.30, pz = -.58, rx = .32, ry = .5, rz = -.5;
    if (s) {
      const f = Math.min(1, s.t / s.dur), side = s.side || 1;
      if (s.type === 'slash') {
        // занос занимает больше половины движения: видно, как тяжёлый клинок разгоняется
        if (f < .42) { const a = easeOut(f / .42); px += side * a * .34; py += a * .16; rz -= side * a * 1.45; ry += side * a * .6; pz += a * .06; }
        else if (f < .68) { const a = ease((f - .42) / .26); px += side * (.34 - .86 * a); py += .16 - Math.sin(a * Math.PI) * .16; rz -= side * (1.45 - 3.0 * a); ry += side * (.6 - 1.4 * a); rx += Math.sin(a * Math.PI) * .7; pz += .06 - Math.sin(a * Math.PI) * .2; }
        else { const a = ease((f - .68) / .32); px -= side * .52 * (1 - a); rz += side * 1.55 * (1 - a); ry -= side * .8 * (1 - a); }
      } else if (s.type === 'heavy') {
        if (f < .5) { const a = easeOut(f / .5); px -= a * .26; py += a * .55; rx -= a * 2.2; rz += a * .35; pz += a * .08; }
        else if (f < .68) { const a = ease((f - .5) / .18); px -= .26 - a * .36; py += .55 - a * 1.05; rx += -2.2 + a * 3.35; pz += .08 - a * .25; }
        else { const a = ease((f - .68) / .32); px += .1 * (1 - a); py -= .5 * (1 - a); rx += 1.15 * (1 - a); pz -= .17 * (1 - a); }
      } else if (s.type === 'finisher') {
        if (f < .35) { const a = easeOut(f / .35); px = lerp(.34, .02, a); py += a * .55; rx -= a * 2.0; rz = lerp(-.28, 0, a); ry = lerp(.35, 0, a); pz = -.5; }
        else if (f < .42) { px = .02 + Math.sin(time * 40) * .004; py += .55; rx -= 2.0; rz = 0; ry = 0; pz = -.5; }
        else if (f < .52) { const a = easeOut((f - .42) / .1); px = .02; py += .55 - a * 1.0; rx += -2.0 + a * 2.9; rz = 0; ry = 0; pz = -.5 - a * .2; }
        else if (f < .8) { px = .02; py -= .45; rx += .9; rz = 0; ry = 0; pz = -.7; }
        else { const a = ease((f - .8) / .2); px = lerp(.02, .34, a); py -= .45 * (1 - a); rx += .9 * (1 - a); rz = lerp(0, -.28, a); ry = lerp(0, .35, a); pz = lerp(-.7, -.62, a); }
      } else if (s.type === 'raise') { py -= (1 - f) * .7; rx -= (1 - f) * .6; }
    }
    // дрожь накопленного замаха: чем ближе полная полоса, тем заметнее
    if (chg > 0 && !s) {
      px += Math.sin(time * 37) * .004 * chg;
      py += Math.cos(time * 43) * .0035 * chg + chg * .012;
      rz += Math.sin(time * 31) * .02 * chg;
    }
    const HAND = -1;                       // зеркало: клинок уходит в левую руку
    m.position.set(px * HAND + bobX + swayX, py + bobY + swayY, pz);
    m.rotation.set(rx, ry * HAND, rz * HAND);
  }

  render(renderer) {
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}
