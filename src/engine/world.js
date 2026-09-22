/* Мир: геометрия уровня, коллизии, лучи, навигационная сетка.
   Вся статичная геометрия склеивается по текстуре в один меш — на уровне
   получается пара десятков draw call'ов, что важно для Steam Deck.
   В режиме редактора (editor: true) источники света и огонь рисуются маркерами. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX } from './textures.js';

export const WALL_H = 3;          // высота стен, м
export const TEX_M = 2;           // одна текстура на 2 м
/* Сколько точечных источников одновременно светит по-настоящему.
   Это самая дорогая настройка во всей картинке: three компилирует шейдер
   под фактическое число источников в сцене, и КАЖДЫЙ пиксель каждой
   поверхности прогоняет цикл по всем из них. Замер на песочнице
   (1280×800, таймер GPU): 34 источника — 1.96 мс на кадр, без них — 0.68 мс.
   То есть факелы стоили больше, чем вся остальная сцена вместе взятая,
   а на Steam Deck это сразу разница между 60 и 30 кадрами. */
export const DEFAULT_LIGHT_BUDGET = 8;

export class World {
  constructor(scene, o = {}) {
    this.scene = scene;
    this.editor = !!o.editor;
    this.solids = [];              // AABB: {x0,y0,z0,x1,y1,z1, shoot, decal}
    this.pending = new Map();      // texName -> [geometry]
    this.pendingEmissive = new Map();
    /* Источники света уровня — это просто записи, а не объекты three.
       Настоящих PointLight ровно budget штук (this.pool), и каждый кадр они
       перецепляются на самые важные записи. Число источников в сцене при этом
       не меняется — значит, шейдеры не перекомпилируются на ходу. */
    this.lights = [];              // записи: {x,y,z,color,intensity,dist,decay}
    this.pool = [];                // слоты: {l: PointLight, src, k}
    this.budget = Math.max(1, o.lightBudget ?? DEFAULT_LIGHT_BUDGET);
    this._order = [];              // переиспользуемый список для выбора лучших
    this._firstBind = true;
    this.fires = [];               // анимированные огни: {mesh, light, t}
    this.markers = [];
    this.staticGroup = new THREE.Group();
    this.dynamicGroup = new THREE.Group();
    scene.add(this.staticGroup, this.dynamicGroup);
    this.bounds = { x0: -50, z0: -50, x1: 50, z1: 50 };
    this.nav = null;
    this.bp = null;          // сетка ускорения, строится лениво
    this._cand = [];         // переиспользуемый список кандидатов
  }

  /* Яркость сектора (как light level в Doom) — запекается в цвета вершин:
     карте на 85 секторов не нужны десятки точечных источников, а картинка та же. */
  _tint(g, lit) {
    if (lit === undefined || lit === null) return;
    /* lit может быть функцией (x,y,z) -> яркость. Так по большой поверхности
       размазывают крупные пятна: глаз цепляется за них, а не за плитку
       текстуры, и повтор породы перестаёт читаться. */
    const fn = typeof lit === 'function';
    const c = fn ? null : (typeof lit === 'number' ? [lit, lit, lit] : lit);
    const pos = g.attributes.position, n = pos.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = fn ? lit(pos.getX(i), pos.getY(i), pos.getZ(i)) : 0;
      arr[i * 3] = fn ? v : c[0]; arr[i * 3 + 1] = fn ? v : c[1]; arr[i * 3 + 2] = fn ? v : c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  /* ─── примитивы ─── */
  box(x, y, z, w, h, d, texName, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, o.uvScale || 1);
    if (o.uvOff) offsetUV(g, o.uvOff[0], o.uvOff[1]);
    g.translate(x + w / 2, y + h / 2, z + d / 2);
    this._tint(g, o.lit);
    this._queue(texName, g, o.emissive);
    if (o.solid !== false) this.solids.push({ x0: x, y0: y, z0: z, x1: x + w, y1: y + h, z1: z + d, shoot: o.shoot !== false, decal: o.decal !== false, tag: o.tag });
    return g;
  }
  cyl(x, y, z, r, h, texName, o = {}) {
    const g = new THREE.CylinderGeometry(r, o.r2 ?? r, h, o.seg || 8, 1, o.open || false);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (2 * Math.PI * r) / TEX_M, uv.getY(i) * h / TEX_M);
    g.translate(x, y + h / 2, z);
    this._tint(g, o.lit);
    this._queue(texName, g, o.emissive);
    if (o.solid !== false) this.solids.push({ x0: x - r, y0: y, z0: z - r, x1: x + r, y1: y + h, z1: z + r, shoot: true, decal: true });
    return g;
  }
  /* cell — размер клетки в метрах: плоскость дробится на сетку.
     Самому полу это не нужно, но без лишних вершин по нему нечем размазать
     пятна яркости (lit-функция считается в вершинах). */
  floor(x, y, z, w, d, texName, o = {}) {
    const sx = o.cell ? Math.max(1, Math.round(w / o.cell)) : 1, sz = o.cell ? Math.max(1, Math.round(d / o.cell)) : 1;
    const g = new THREE.PlaneGeometry(w, d, sx, sz);
    g.rotateX(o.ceiling ? Math.PI / 2 : -Math.PI / 2);
    const uv = g.attributes.uv, k = o.uvScale || 1;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / TEX_M * k, uv.getY(i) * d / TEX_M * k);
    if (o.uvOff) offsetUV(g, o.uvOff[0], o.uvOff[1]);
    g.translate(x + w / 2, y, z + d / 2);
    this._tint(g, o.lit);
    this._queue(texName, g, o.emissive);
    if (o.solid) this.solids.push({ x0: x, y0: y - 0.5, z0: z, x1: x + w, y1: y, z1: z + d, shoot: true, decal: true });
    return g;
  }
  /* Свод — купол над прямоугольником (x..x+w, z..z+d), смотрим на него изнутри.
     По всему периметру обод лежит на высоте y и садится на стены, к середине
     поднимается на rise: получается полусфера, а не плоская крышка. Профиль
     взят сферический (sqrt(1-r²)) — у обода он почти отвесный, поэтому свод
     читается как купол, а не как надутый пузырь; нормированный радиус считается
     по норме четвёртой степени, иначе купол вписался бы в эллипс и углы
     прямоугольника остались бы непокрытыми.

     Поверхность гранёная: треугольники не делят вершин, у каждого своя нормаль.
     Текстура на грань кладётся проекцией по той оси, куда грань смотрит, — так
     нигде нет растяжения, даже на отвесных кусках у обода, — и каждая клетка
     сетки берёт свой случайный сдвиг плитки. Из-за этого на поверхности
     в добрую сотню квадратных метров повтор породы не виден вовсе.

     Коллизии у свода нет: дотянуться до него всё равно нельзя, а AABB
     для купола означал бы коробку во всю пещеру.
     Возвращает функцию высоты (x,z) -> y — по ней вешают сталактиты. */
  dome(x, y, z, w, d, rise, texName, o = {}) {
    const R = o.rnd || Math.random, uvM = o.uvM || TEX_M;
    const cx = x + w / 2, cz = z + d / 2;
    const cell = o.cell || 1.3, rough = o.rough ?? .5;
    const nx = Math.max(4, Math.round(w / cell)), nz = Math.max(4, Math.round(d / cell));
    const ph = [R() * 6.283, R() * 6.283, R() * 6.283, R() * 6.283];
    const hAt = (px, pz) => {
      const u = Math.abs((px - cx) / (w / 2)), v = Math.abs((pz - cz) / (d / 2));
      const r = Math.min(1, Math.pow(u * u * u * u + v * v * v * v, .25));
      const k = Math.sqrt(Math.max(0, 1 - r * r));
      // неровности гаснут к ободу вместе с подъёмом — стык со стеной обязан быть ровным
      const n = Math.sin(px * .9 + ph[0]) * Math.sin(pz * .8 + ph[1]) * .6
              + Math.sin(px * 1.7 + ph[2]) * Math.sin(pz * 2.1 + ph[3]) * .3;
      return y + (rise + n * rough) * k;
    };
    const pos = [], nor = [], uvs = [];
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nv = new THREE.Vector3();
    const tri = (a, b, c, du, dv) => {
      e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      nv.crossVectors(e1, e2).normalize();
      if (nv.y > 0) { nv.negate(); const t = b; b = c; c = t; }   // свод смотрит вниз, иначе грань отсечётся
      const ax = Math.abs(nv.x), ay = Math.abs(nv.y), az = Math.abs(nv.z);
      const axis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;   // 1 — сверху, 0 — сбоку по x, 2 — сбоку по z
      for (const q of [a, b, c]) {
        pos.push(q[0], q[1], q[2]); nor.push(nv.x, nv.y, nv.z);
        uvs.push((axis === 0 ? q[2] : q[0]) / uvM + du, (axis === 1 ? q[2] : q[1]) / uvM + dv);
      }
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x0 = x + w * i / nx, x1 = x + w * (i + 1) / nx;
      const z0 = z + d * j / nz, z1 = z + d * (j + 1) / nz;
      const p00 = [x0, hAt(x0, z0), z0], p10 = [x1, hAt(x1, z0), z0];
      const p11 = [x1, hAt(x1, z1), z1], p01 = [x0, hAt(x0, z1), z1];
      const du = R(), dv = R();
      tri(p00, p10, p11, du, dv); tri(p00, p11, p01, du, dv);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    /* Склейка уровня требует, чтобы индекс был либо у всех кусков, либо ни
       у кого. Вершины у свода не общие, так что индекс тут просто по порядку. */
    const idx = new Array(pos.length / 3);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    g.setIndex(idx);
    this._tint(g, o.lit);
    this._queue(texName, g, o.emissive);
    return hAt;
  }
  quad(x, y, z, w, h, texName, face = 0, o = {}) {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY([0, Math.PI / 2, Math.PI, -Math.PI / 2][face]);
    g.translate(x, y, z);
    this._queue(texName, g, o.emissive);
    return g;
  }
  // стена под любым углом: от (x0,z0) до (x1,z1); коллизия — цепочка AABB вдоль отрезка
  wall(x0, z0, x1, z1, y, h, thick, texName, o = {}) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < .05) return null;
    const ang = Math.atan2(dx, dz);          // поворот вокруг Y
    const g = new THREE.BoxGeometry(thick, h, len);
    scaleBoxUV(g, thick, h, len, o.uvScale || 1);
    if (o.uvOff) offsetUV(g, o.uvOff[0], o.uvOff[1]);
    g.rotateY(ang);
    g.translate((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2);
    this._tint(g, o.lit);
    this._queue(texName, g, o.emissive);
    if (o.solid !== false) {
      const step = Math.max(.15, thick * .6), n = Math.max(1, Math.ceil(len / step));
      const half = Math.max(thick / 2, Math.min(thick, step) / 2 + .01);
      for (let i = 0; i <= n; i++) {
        const t = i / n, cx = x0 + dx * t, cz = z0 + dz * t;
        // угловая стена: маленькие квадраты; осевая — один длинный AABB
        if (Math.abs(dx) < 1e-6 || Math.abs(dz) < 1e-6) {
          this.solids.push({ x0: Math.min(x0, x1) - thick / 2, y0: y, z0: Math.min(z0, z1) - thick / 2, x1: Math.max(x0, x1) + thick / 2, y1: y + h, z1: Math.max(z0, z1) + thick / 2, shoot: o.shoot !== false, decal: o.decal !== false, tag: o.tag });
          break;
        }
        this.solids.push({ x0: cx - half, y0: y, z0: cz - half, x1: cx + half, y1: y + h, z1: cz + half, shoot: o.shoot !== false, decal: o.decal !== false, tag: o.tag });
      }
    }
    return g;
  }
  blocker(x, y, z, w, h, d, tag) {
    this.solids.push({ x0: x, y0: y, z0: z, x1: x + w, y1: y + h, z1: z + d, shoot: false, decal: false, tag });
    if (this.editor) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0x40a0ff, transparent: true, opacity: .15, wireframe: false }));
      m.position.set(x + w / 2, y + h / 2, z + d / 2);
      this.dynamicGroup.add(m); this.markers.push(m);
    }
  }

  _queue(texName, g, emissive) {
    if (!TEX[texName]) { console.warn('нет текстуры', texName); texName = 'dark'; }
    const m = emissive ? this.pendingEmissive : this.pending;
    if (!m.has(texName)) m.set(texName, []);
    m.get(texName).push(g);
  }

  flush() {
    const build = (map, emissive) => {
      for (const [name, list] of map) {
        const tinted = list.some(gg => gg.attributes.color);
        if (tinted) for (const gg of list) if (!gg.attributes.color) this._tint(gg, 1);
        const g = mergeGeometries(list, false);
        const mat = emissive
          ? new THREE.MeshBasicMaterial({ map: TEX[name], vertexColors: tinted })
          : new THREE.MeshLambertMaterial({ map: TEX[name], vertexColors: tinted });
        const mesh = new THREE.Mesh(g, mat);
        mesh.matrixAutoUpdate = false;
        this.staticGroup.add(mesh);
      }
      map.clear();
    };
    build(this.pending, false);
    build(this.pendingEmissive, true);
  }

  /* Возвращает не PointLight, а запись источника. Всё, что ею пользуется
     (мерцание факела, пульс свечи), меняет intensity в записи — а уже
     bindLights решает, какие записи в этом кадре достанутся настоящим
     фонарям. Для вызывающего кода разницы нет: поле intensity на месте. */
  light(x, y, z, color, intensity, dist, o = {}) {
    if (this.editor) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(.18, 8, 6), new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z);
      this.dynamicGroup.add(m); this.markers.push(m);
      return null;
    }
    // three ≥ r155: интенсивность физическая (кд), поэтому множим
    const src = { x, y, z, color, intensity: intensity * 14, dist, decay: o.decay ?? 1.7, slot: null, score: 0, want: false };
    this.lights.push(src);
    if (o.pulse) this.fires.push({ light: src, t: Math.random() * 10, base: src.intensity, pulse: o.pulse, on: true, candle: true });
    return src;
  }
  /* Пул создаётся один раз, когда все источники уровня уже собраны: размер
     берём по факту, чтобы на скромной карте не держать лишних фонарей. */
  _ensurePool() {
    if (this.pool.length || this.editor || !this.lights.length) return;
    const n = Math.min(this.budget, this.lights.length);
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 1.7);
      l.matrixAutoUpdate = true;
      this.scene.add(l);
      this.pool.push({ l, src: null, k: 0 });
    }
  }
  /* Раздача фонарей. Важность источника — насколько он способен осветить то,
     что видно от камеры: стоишь внутри его радиуса — максимум, дальше цена
     падает. Смена слота не мгновенная: новый разгорается, старый гаснет за
     пятую долю секунды, иначе факел на границе отбора мигал бы на каждом шаге.
     Зовётся из цикла кадра всегда, даже на паузе и на стартовом экране:
     иначе сцена за меню оставалась бы вовсе без света. */
  bindLights(dt, camera) {
    this._ensurePool();
    const pool = this.pool, S = this.lights;
    if (!pool.length) return;
    const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const d = Math.hypot(s.x - px, s.y - py, s.z - pz);
      s.score = s.intensity <= 0 ? -1 : s.intensity * s.dist / (1 + Math.max(0, d - s.dist));
      // тому, кто уже держит фонарь, даём фору: иначе два источника с почти
      // равной оценкой отбирали бы его друг у друга и мигали на каждом шаге
      if (s.slot) s.score *= 1.35;
      s.want = false;
    }
    const order = this._order;
    order.length = 0;
    for (let i = 0; i < S.length; i++) order.push(S[i]);
    order.sort(byScore);
    const n = Math.min(pool.length, order.length);
    for (let i = 0; i < n; i++) order[i].want = true;
    // выпавшие гасим и только потом освобождаем слот
    for (let i = 0; i < pool.length; i++) {
      const sl = pool[i];
      if (!sl.src) continue;
      if (sl.src.want && sl.src.score > 0) sl.k = Math.min(1, sl.k + dt * 5);
      else { sl.k -= dt * 5; if (sl.k <= 0) { sl.k = 0; sl.src.slot = null; sl.src = null; } }
    }
    // свободные слоты отдаём тем из лучших, кто ещё без фонаря
    for (let i = 0; i < n; i++) {
      const s = order[i];
      if (s.slot || s.score <= 0) continue;
      let free = null;
      for (let k = 0; k < pool.length; k++) if (!pool[k].src) { free = pool[k]; break; }
      if (!free) break;
      // на первом же кадре уровня свет обязан гореть сразу, без разгорания
      free.src = s; free.k = this._firstBind ? 1 : 0; s.slot = free;
    }
    this._firstBind = false;
    for (let i = 0; i < pool.length; i++) {
      const sl = pool[i], l = sl.l;
      if (!sl.src) { l.intensity = 0; continue; }
      l.position.set(sl.src.x, sl.src.y, sl.src.z);
      l.color.setHex(sl.src.color);
      l.distance = sl.src.dist; l.decay = sl.src.decay;
      l.intensity = sl.src.intensity * sl.k;
    }
  }
  fire(x, y, z, size = 1, o = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: TEX.fire0, transparent: true, alphaTest: .2, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size * .8, size * 1.2), mat);
    mesh.position.set(x, y + size * .6, z);
    this.dynamicGroup.add(mesh);
    if (this.editor) { this.markers.push(mesh); return { mesh, light: null, on: false }; }
    const light = this.light(x, y + size * .8, z, o.color || 0xff7020, o.intensity || 3 * size, o.dist || 9 * size);
    const f = { mesh, light, t: Math.random() * 10, base: light.intensity, size, on: true };
    this.fires.push(f);
    return f;
  }

  update(dt, camera) {
    /* Вода течёт сдвигом самой текстуры. Текстура в TEX одна на весь проект,
       поэтому и водопад на стене, и лужа под ним идут от одного сдвига —
       и совпадают по течению, чего иначе пришлось бы добиваться руками. */
    if (TEX.water) { const t = TEX.water.offset; t.y = (t.y - dt * .14) % 1; t.x = (t.x - dt * .05) % 1; }
    if (TEX.waterfall) { const t = TEX.waterfall.offset; t.y = (t.y - dt * 1.15) % 1; }
    for (const f of this.fires) {
      if (!f.on) continue;
      f.t += dt;
      if (f.candle) {
        const k = f.pulse ? (0.7 + Math.sin(f.t * f.pulse) * .3) : (0.75 + Math.sin(f.t * 13) * .15 + Math.sin(f.t * 4.1) * .1);
        f.light.intensity = f.base * k; continue;
      }
      const fr = Math.floor(f.t * 9) % 3;
      f.mesh.material.map = TEX['fire' + fr];
      f.mesh.rotation.y = Math.atan2(camera.position.x - f.mesh.position.x, camera.position.z - f.mesh.position.z);
      f.light.intensity = f.base * (0.8 + Math.sin(f.t * 17) * .1 + Math.sin(f.t * 5.3) * .1);
    }
  }

  // убрать всё из сцены (смена уровня)
  dispose() {
    for (const m of this.staticGroup.children) { m.geometry.dispose(); }
    this.scene.remove(this.staticGroup, this.dynamicGroup);
    for (const sl of this.pool) this.scene.remove(sl.l);
    this.solids.length = 0; this.lights.length = 0; this.pool.length = 0; this.fires.length = 0; this.markers.length = 0;
    this.bp = null;
  }

  /* ─── коллизии ─── */
  /* Все запросы идут через сетку ускорения: перебирать весь список solids
     на каждый шаг движения и каждый луч нельзя. На импортированной E1M1 их
     около шести тысяч, а запросов за кадр — тысячи: капли крови щупают пол,
     гибсы бьются о стены, каждый враг проверяет, видит ли героя. Сетка
     сводит перебор к десяткам кандидатов и перестраивается сама, как только
     в мире появились новые объекты. */
  _grid() {
    if (!this.bp || this.bp.n !== this.solids.length) this.bp = new SolidGrid(this.solids);
    return this.bp;
  }

  groundAt(x, z, r, yMax) {
    const S = this.solids, G = this._grid(), W = G.W;
    let g = 0;
    const i0 = G.cx(x - r), i1 = G.cx(x + r), j0 = G.cz(z - r), j1 = G.cz(z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * W + i;
      for (let k = G.start[c], e = G.start[c + 1]; k < e; k++) {
        const s = S[G.items[k]];
        if (!s.shoot) continue;
        if (x + r > s.x0 && x - r < s.x1 && z + r > s.z0 && z - r < s.z1 && s.y1 <= yMax && s.y1 > g) g = s.y1;
      }
    }
    for (let k = 0; k < G.big.length; k++) {
      const s = S[G.big[k]];
      if (!s.shoot) continue;
      if (x + r > s.x0 && x - r < s.x1 && z + r > s.z0 && z - r < s.z1 && s.y1 <= yMax && s.y1 > g) g = s.y1;
    }
    return g;
  }
  moveCircle(x, z, r, y, h, dx, dz, ignoreTag, step = .5) {
    let nx = x + dx, nz = z + dz;
    const S = this.solids, G = this._grid();
    const cand = this._cand;
    for (let iter = 0; iter < 3; iter++) {
      // кандидатов собираем заново на каждом проходе: выталкивание могло увести
      // точку в соседние клетки, и там её ждут свои стены
      cand.length = 0;
      G.collect(nx - r, nz - r, nx + r, nz + r, cand);
      let hit = false;
      for (let ci = 0; ci < cand.length; ci++) {
        const s = S[cand[ci]];
        if (ignoreTag && s.tag === ignoreTag) continue;
        if (s.y1 <= y + step || s.y0 >= y + h) continue;
        const cx = Math.max(s.x0, Math.min(nx, s.x1));
        const cz = Math.max(s.z0, Math.min(nz, s.z1));
        const ex = nx - cx, ez = nz - cz;
        const d2 = ex * ex + ez * ez;
        if (d2 < r * r) {
          hit = true;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            nx = cx + ex / d * r; nz = cz + ez / d * r;
          } else {
            const px = Math.min(nx - s.x0, s.x1 - nx), pz = Math.min(nz - s.z0, s.z1 - nz);
            if (px < pz) nx = (nx - s.x0 < s.x1 - nx) ? s.x0 - r : s.x1 + r;
            else nz = (nz - s.z0 < s.z1 - nz) ? s.z0 - r : s.z1 + r;
          }
        }
      }
      if (!hit) break;
    }
    return [nx, nz];
  }
  /* Луч по миру. Клетки сетки обходятся в порядке возрастания t (2D-DDA),
     поэтому как только найдено попадание ближе выхода из текущей клетки —
     дальше идти незачем: всё, что впереди, заведомо дальше. */
  raycast(ox, oy, oz, dx, dy, dz, maxT = 200, shootOnly = true) {
    const S = this.solids, G = this._grid(), cell = G.cell, W = G.W, H = G.H;
    let best = null;
    for (let k = 0; k < G.big.length; k++) {
      const s = S[G.big[k]];
      if (shootOnly && !s.shoot) continue;
      if (slabHit(s, ox, oy, oz, dx, dy, dz, maxT) && (!best || _slab.t < best.t)) best = makeHit(s);
    }
    // отрезок луча обрезаем прямоугольником сетки
    const gx1 = G.x0 + W * cell, gz1 = G.z0 + H * cell;
    let tIn = 0, tOut = maxT;
    if (dx > 1e-9 || dx < -1e-9) {
      let ta = (G.x0 - ox) / dx, tb = (gx1 - ox) / dx;
      if (ta > tb) { const c = ta; ta = tb; tb = c; }
      if (ta > tIn) tIn = ta;
      if (tb < tOut) tOut = tb;
    } else if (ox < G.x0 || ox > gx1) return best;
    if (dz > 1e-9 || dz < -1e-9) {
      let ta = (G.z0 - oz) / dz, tb = (gz1 - oz) / dz;
      if (ta > tb) { const c = ta; ta = tb; tb = c; }
      if (ta > tIn) tIn = ta;
      if (tb < tOut) tOut = tb;
    } else if (oz < G.z0 || oz > gz1) return best;
    if (tIn > tOut) return best;

    let i = G.cx(ox + dx * tIn), j = G.cz(oz + dz * tIn);
    const stepI = dx > 1e-9 ? 1 : dx < -1e-9 ? -1 : 0;
    const stepJ = dz > 1e-9 ? 1 : dz < -1e-9 ? -1 : 0;
    const dtX = stepI ? cell / Math.abs(dx) : Infinity;
    const dtZ = stepJ ? cell / Math.abs(dz) : Infinity;
    let tX = stepI ? (G.x0 + (i + (stepI > 0 ? 1 : 0)) * cell - ox) / dx : Infinity;
    let tZ = stepJ ? (G.z0 + (j + (stepJ > 0 ? 1 : 0)) * cell - oz) / dz : Infinity;
    for (;;) {
      const c = j * W + i;
      for (let k = G.start[c], e = G.start[c + 1]; k < e; k++) {
        const s = S[G.items[k]];
        if (shootOnly && !s.shoot) continue;
        if (slabHit(s, ox, oy, oz, dx, dy, dz, maxT) && (!best || _slab.t < best.t)) best = makeHit(s);
      }
      const tNext = tX < tZ ? tX : tZ;
      if (best && best.t <= tNext) break;
      if (tNext > tOut) break;
      if (tX < tZ) { i += stepI; tX += dtX; if (i < 0 || i >= W) break; }
      else { j += stepJ; tZ += dtZ; if (j < 0 || j >= H) break; }
    }
    return best;
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return true;
    const h = this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L);
    return !h;
  }

  /* ─── навигация: сетка 0.5 м, A* ─── */
  buildNav(cell = 0.5) {
    const b = this.bounds;
    const W = Math.ceil((b.x1 - b.x0) / cell), H = Math.ceil((b.z1 - b.z0) / cell);
    const grid = new Uint8Array(W * H);
    const R = 0.4;
    for (const s of this.solids) {
      if (s.tag === 'nonav') continue;
      if (s.y1 <= 0.5 || s.y0 >= 1.5) continue;
      const i0 = Math.max(0, Math.floor((s.x0 - R - b.x0) / cell)), i1 = Math.min(W - 1, Math.floor((s.x1 + R - b.x0) / cell));
      const j0 = Math.max(0, Math.floor((s.z0 - R - b.z0) / cell)), j1 = Math.min(H - 1, Math.floor((s.z1 + R - b.z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = b.x0 + (i + .5) * cell, z = b.z0 + (j + .5) * cell;
        if (x + R > s.x0 && x - R < s.x1 && z + R > s.z0 && z - R < s.z1) grid[j * W + i] = 1;
      }
    }
    this.nav = { W, H, cell, grid, x0: b.x0, z0: b.z0 };
    /* Рабочие буферы A*. Раньше на каждый поиск создавались две Map —
       на карте в 54 тысячи клеток это и была основная цена пути.
       Теперь массивы живут вместе с сеткой, а «свежесть» записи отмечает
       номер поколения: чистить между поисками ничего не нужно. */
    this._as = { g: new Float64Array(W * H), came: new Int32Array(W * H), stamp: new Int32Array(W * H), gen: 0 };
    this._heap = new MinHeap();
  }
  navCell(x, z) {
    const n = this.nav;
    return [Math.floor((x - n.x0) / n.cell), Math.floor((z - n.z0) / n.cell)];
  }
  navFree(i, j) {
    const n = this.nav;
    return i >= 0 && j >= 0 && i < n.W && j < n.H && n.grid[j * n.W + i] === 0;
  }
  navNearest(i, j) {
    if (this.navFree(i, j)) return [i, j];
    for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (this.navFree(i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  }
  findPath(sx, sz, tx, tz, maxNodes = 1500) {
    const n = this.nav;
    if (!n) return null;
    const s = this.navNearest(...this.navCell(sx, sz));
    const t = this.navNearest(...this.navCell(tx, tz));
    if (!s || !t) return null;
    const W = n.W;
    const sk = s[1] * W + s[0], tk = t[1] * W + t[0];
    if (sk === tk) return [[tx, tz]];
    const A = this._as, gen = ++A.gen;
    const open = this._heap; open.clear();
    const ti = t[0], tj = t[1];
    A.g[sk] = 0; A.came[sk] = -1; A.stamp[sk] = gen;
    open.push(octile(s[0] - ti, s[1] - tj), sk);
    let expanded = 0;
    while (open.size && expanded < maxNodes) {
      const cur = open.pop();
      if (cur === tk) return this._tracePath(cur, tx, tz);
      expanded++;
      const ci = cur % W, cj = (cur / W) | 0;
      const g0 = A.g[cur];
      for (let d = 0; d < 24; d += 3) {
        const di = DIRS[d], dj = DIRS[d + 1];
        const ni = ci + di, nj = cj + dj;
        if (!this.navFree(ni, nj)) continue;
        if (di && dj && (!this.navFree(ci + di, cj) || !this.navFree(ci, cj + dj))) continue;
        const nk = nj * W + ni;
        const g = g0 + DIRS[d + 2];
        if (A.stamp[nk] === gen && g >= A.g[nk]) continue;
        A.stamp[nk] = gen; A.g[nk] = g; A.came[nk] = cur;
        open.push(g + octile(ni - ti, nj - tj), nk);
      }
    }
    return null;
  }
  _tracePath(k, tx, tz) {
    const n = this.nav, A = this._as;
    const path = [];
    for (let c = k; c >= 0 && A.came[c] >= 0; c = A.came[c]) {
      path.push([n.x0 + (c % n.W + .5) * n.cell, n.z0 + (((c / n.W) | 0) + .5) * n.cell]);
    }
    path.reverse();
    path.push([tx, tz]);
    return path;
  }
}

/* Равномерная сетка по XZ над списком solids: в клетке лежат индексы объектов,
   которые её задевают (CSR: start[] + items[], без единого массива на клетку).
   Объекты размером в пол-карты в сетку не кладём — они в `big` и проверяются всегда. */
const GRID_CELL = 2, GRID_BIG = 96;
class SolidGrid {
  constructor(solids, cell = GRID_CELL) {
    const N = this.n = solids.length;
    this.cell = cell;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < N; k++) {
      const s = solids[k];
      if (s.x0 < x0) x0 = s.x0; if (s.z0 < z0) z0 = s.z0;
      if (s.x1 > x1) x1 = s.x1; if (s.z1 > z1) z1 = s.z1;
    }
    if (!N) { x0 = z0 = x1 = z1 = 0; }
    this.x0 = x0 - cell; this.z0 = z0 - cell;
    const W = this.W = Math.max(1, Math.ceil((x1 - x0) / cell) + 2);
    const H = this.H = Math.max(1, Math.ceil((z1 - z0) / cell) + 2);
    const counts = new Int32Array(W * H + 1);
    const box = new Int32Array(N * 4);
    const big = [];
    for (let k = 0; k < N; k++) {
      const s = solids[k];
      const i0 = this.cx(s.x0), i1 = this.cx(s.x1), j0 = this.cz(s.z0), j1 = this.cz(s.z1);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > GRID_BIG) { big.push(k); box[k * 4] = -1; continue; }
      box[k * 4] = i0; box[k * 4 + 1] = i1; box[k * 4 + 2] = j0; box[k * 4 + 3] = j1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * W + i + 1]++;
    }
    for (let c = 0; c < W * H; c++) counts[c + 1] += counts[c];
    this.start = counts;
    this.items = new Int32Array(counts[W * H]);
    const cur = counts.slice(0, W * H);
    for (let k = 0; k < N; k++) {
      if (box[k * 4] < 0) continue;
      const i0 = box[k * 4], i1 = box[k * 4 + 1], j0 = box[k * 4 + 2], j1 = box[k * 4 + 3];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.items[cur[j * W + i]++] = k;
    }
    this.big = Int32Array.from(big);
  }
  cx(v) { const i = Math.floor((v - this.x0) / this.cell); return i < 0 ? 0 : i >= this.W ? this.W - 1 : i; }
  cz(v) { const j = Math.floor((v - this.z0) / this.cell); return j < 0 ? 0 : j >= this.H ? this.H - 1 : j; }
  // индексы всех объектов, чьи клетки задеты прямоугольником (могут повторяться — это дёшево и безвредно)
  collect(x0, z0, x1, z1, out) {
    const i0 = this.cx(x0), i1 = this.cx(x1), j0 = this.cz(z0), j1 = this.cz(z1), W = this.W;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * W + i;
      for (let k = this.start[c], e = this.start[c + 1]; k < e; k++) out.push(this.items[k]);
    }
    for (let k = 0; k < this.big.length; k++) out.push(this.big[k]);
    return out;
  }
}

/* Пересечение луча с AABB методом плит. Результат кладётся в общий объект:
   на горячем пути (сотни тысяч вызовов за кадр) нельзя создавать мусор. */
const _slab = { t: 0, axis: -1, sign: 0 };
function slabHit(s, ox, oy, oz, dx, dy, dz, maxT) {
  let t0 = 0, t1 = maxT, nAxis = -1, nSign = 0;
  if (dx > -1e-9 && dx < 1e-9) { if (ox < s.x0 || ox > s.x1) return false; }
  else {
    let ta = (s.x0 - ox) / dx, tb = (s.x1 - ox) / dx, sgn = -1;
    if (ta > tb) { const c = ta; ta = tb; tb = c; sgn = 1; }
    if (ta > t0) { t0 = ta; nAxis = 0; nSign = sgn; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (dy > -1e-9 && dy < 1e-9) { if (oy < s.y0 || oy > s.y1) return false; }
  else {
    let ta = (s.y0 - oy) / dy, tb = (s.y1 - oy) / dy, sgn = -1;
    if (ta > tb) { const c = ta; ta = tb; tb = c; sgn = 1; }
    if (ta > t0) { t0 = ta; nAxis = 1; nSign = sgn; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (dz > -1e-9 && dz < 1e-9) { if (oz < s.z0 || oz > s.z1) return false; }
  else {
    let ta = (s.z0 - oz) / dz, tb = (s.z1 - oz) / dz, sgn = -1;
    if (ta > tb) { const c = ta; ta = tb; tb = c; sgn = 1; }
    if (ta > t0) { t0 = ta; nAxis = 2; nSign = sgn; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  if (nAxis < 0) return false;
  _slab.t = t0; _slab.axis = nAxis; _slab.sign = nSign;
  return true;
}
function makeHit(solid) {
  const n = [0, 0, 0];
  n[_slab.axis] = _slab.sign;
  return { t: _slab.t, n, solid };
}

/* Оценка «сколько ещё идти» по правилам самой сетки: сначала по диагонали,
   остаток — прямо. Прямая евклидова дистанция занижала оценку, и A* без толку
   разгребал клетки вширь; при этом обе оценки не завышают, так что путь
   остаётся кратчайшим — просто находится заметно дешевле. */
function octile(dx, dy) {
  const a = dx < 0 ? -dx : dx, b = dy < 0 ? -dy : dy;
  return a > b ? a + .414 * b : b + .414 * a;
}

// соседи клетки: di, dj, цена шага — плоским списком, без вложенных массивов
const DIRS = [1, 0, 1, -1, 0, 1, 0, 1, 1, 0, -1, 1, 1, 1, 1.414, 1, -1, 1.414, -1, 1, 1.414, -1, -1, 1.414];

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  clear() { this.k.length = 0; this.v.length = 0; }
  push(key, val) {
    this.k.push(key); this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]]; [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop() {
    const top = this.v[0];
    const lk = this.k.pop(), lv = this.v.pop();
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]]; [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}

const byScore = (a, b) => b.score - a.score;

function scaleBoxUV(g, w, h, d, k) {
  const uv = g.attributes.uv;
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = sizes[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su / TEX_M * k, uv.getY(idx) * sv / TEX_M * k);
    }
  }
}

/* Сдвиг UV на долю плитки: соседние куски одной стены берут текстуру из
   разных мест, и ряд одинаковых плиток вдоль стены перестаёт бросаться в глаза. */
function offsetUV(g, du, dv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
}

export function billboard(sprite, wM, hM, o = {}) {
  // порог прозрачности занижен: с мипмапами альфа по краю усредняется, и при
  // старом .4 дальние силуэты худели, а тонкие гибсы (нож, клинок) исчезали совсем
  const mat = new THREE.MeshLambertMaterial({ map: sprite.tex, transparent: true, alphaTest: .25, side: THREE.DoubleSide, ...(o.mat || {}) });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), mat);
  mesh.geometry.translate(0, hM / 2, 0);
  return mesh;
}
export function faceCamera(mesh, camera) {
  mesh.rotation.y = Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z);
}
