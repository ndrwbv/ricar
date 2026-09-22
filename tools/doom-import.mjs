/* Импорт карты из WAD (Doom / Doom II) в формат уровня движка — геометрия 1:1.
   Запуск: node tools/doom-import.mjs <путь/DOOM1.WAD> E1M1 doom-e1m1 "3. Ангар (E1M1)"

   Что берётся из WAD: вершины, линии, высоты и плоскости секторов, расстановка вещей.
   Что подменяется нашим: текстуры (TEXMAP/FLATMAP), типы врагов и предметов (THINGMAP).

   Как это ложится на движок, у которого нет секторов:
   * стены — линии WAD: односторонняя линия = стена от пола до потолка, двусторонняя даёт
     «ступень» снизу (разница полов) и «перемычку» сверху (разница потолков);
   * полы и потолки — растеризация секторов по BSP (шаг CELL юнитов) и жадная склейка
     клеток в прямоугольники `floor`; заодно из них получается коллизия и ступеньки;
   * двери (сектор с потолком на уровне пола) открываются навсегда: потолок поднимается
     до минимального соседнего минус 4 юнита, как это делает Doom при открытии.

   Координаты: Doom (x на восток, y на север) → движок (x на восток, −z на север, y — высота). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [wadPath, MAP = 'E1M1', OUT_ID = 'doom-e1m1', OUT_NAME = 'Doom E1M1'] = process.argv.slice(2);
if (!wadPath) { console.error('нужен путь к WAD'); process.exit(1); }

const S = 1 / 32;        // метров в юните Doom: герой 56 юнитов = 1.75 м, дверь 64 = 2 м
const CELL = 8;          // шаг растеризации полов, юниты (0.25 м)
const THICK = 0.3;       // толщина стен, м (в Doom они нулевые)
const DILATE = 2;        // на сколько клеток полы заходят в пустоту за стенами

/* ═══════════ чтение WAD ═══════════ */
const buf = fs.readFileSync(wadPath);
if (buf.toString('ascii', 0, 4) !== 'IWAD' && buf.toString('ascii', 0, 4) !== 'PWAD') throw new Error('не WAD');
const numLumps = buf.readInt32LE(4), dirOfs = buf.readInt32LE(8);
const lumps = [];
for (let i = 0; i < numLumps; i++) {
  const o = dirOfs + i * 16;
  lumps.push({ pos: buf.readInt32LE(o), size: buf.readInt32LE(o + 4), name: buf.toString('ascii', o + 8, o + 16).replace(/\0.*$/, '') });
}
const mapIdx = lumps.findIndex(l => l.name === MAP);
if (mapIdx < 0) throw new Error('нет карты ' + MAP);
function lumpData(name) {
  for (let i = mapIdx + 1; i < Math.min(mapIdx + 12, lumps.length); i++) {
    if (lumps[i].name === name) return buf.subarray(lumps[i].pos, lumps[i].pos + lumps[i].size);
  }
  throw new Error('нет лампа ' + name + ' у ' + MAP);
}
const str8 = (b, o) => b.toString('ascii', o, o + 8).replace(/\0.*$/, '').toUpperCase();

const vd = lumpData('VERTEXES'), verts = [];
for (let o = 0; o + 4 <= vd.length; o += 4) verts.push([vd.readInt16LE(o), vd.readInt16LE(o + 2)]);

const sd = lumpData('SECTORS'), sectors = [];
for (let o = 0; o + 26 <= sd.length; o += 26) sectors.push({
  floor: sd.readInt16LE(o), ceil: sd.readInt16LE(o + 2),
  floorTex: str8(sd, o + 4), ceilTex: str8(sd, o + 12),
  light: sd.readInt16LE(o + 20), special: sd.readInt16LE(o + 22), tag: sd.readInt16LE(o + 24),
});

const sided = lumpData('SIDEDEFS'), sides = [];
for (let o = 0; o + 30 <= sided.length; o += 30) sides.push({
  xoff: sided.readInt16LE(o), yoff: sided.readInt16LE(o + 2),
  upper: str8(sided, o + 4), lower: str8(sided, o + 12), mid: str8(sided, o + 20),
  sector: sided.readUInt16LE(o + 28),
});

const ld = lumpData('LINEDEFS'), lines = [];
for (let o = 0; o + 14 <= ld.length; o += 14) {
  const right = ld.readUInt16LE(o + 10), left = ld.readUInt16LE(o + 12);
  lines.push({
    v1: ld.readUInt16LE(o), v2: ld.readUInt16LE(o + 2), flags: ld.readUInt16LE(o + 4),
    special: ld.readUInt16LE(o + 6), tag: ld.readUInt16LE(o + 8),
    right: right === 0xffff ? -1 : right, left: left === 0xffff ? -1 : left,
  });
}

const sgd = lumpData('SEGS'), segs = [];
for (let o = 0; o + 12 <= sgd.length; o += 12) segs.push({
  v1: sgd.readUInt16LE(o), v2: sgd.readUInt16LE(o + 2),
  line: sgd.readUInt16LE(o + 6), side: sgd.readUInt16LE(o + 8),
});

const ssd = lumpData('SSECTORS'), ssectors = [];
for (let o = 0; o + 4 <= ssd.length; o += 4) ssectors.push({ count: ssd.readUInt16LE(o), first: ssd.readUInt16LE(o + 2) });

const nd = lumpData('NODES'), nodes = [];
for (let o = 0; o + 28 <= nd.length; o += 28) nodes.push({
  x: nd.readInt16LE(o), y: nd.readInt16LE(o + 2), dx: nd.readInt16LE(o + 4), dy: nd.readInt16LE(o + 6),
  right: nd.readUInt16LE(o + 24), left: nd.readUInt16LE(o + 26),
});

const td = lumpData('THINGS'), things = [];
for (let o = 0; o + 10 <= td.length; o += 10) things.push({
  x: td.readInt16LE(o), y: td.readInt16LE(o + 2), angle: td.readInt16LE(o + 4),
  type: td.readUInt16LE(o + 6), flags: td.readUInt16LE(o + 8),
});

console.log(`${MAP}: вершин ${verts.length}, линий ${lines.length}, секторов ${sectors.length}, вещей ${things.length}`);

/* ═══════════ секторы: двери открыть навсегда ═══════════ */
const neighbours = sectors.map(() => new Set());
for (const l of lines) {
  if (l.right < 0 || l.left < 0) continue;
  const a = sides[l.right].sector, b = sides[l.left].sector;
  neighbours[a].add(b); neighbours[b].add(a);
}
const isDoor = sectors.map(s => s.ceil <= s.floor);
sectors.forEach((s, i) => {
  if (!isDoor[i]) return;
  let lo = Infinity;
  for (const n of neighbours[i]) if (!isDoor[n]) lo = Math.min(lo, sectors[n].ceil);
  s.ceil = Number.isFinite(lo) ? lo - 4 : s.floor + 112;
});

/* ═══════════ BSP: выпуклый многоугольник каждого подсектора ═══════════ */
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
for (const [x, y] of verts) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
const PAD = 64;

// отсечь выпуклый многоугольник полуплоскостью f(p) >= 0
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= -1e-7) out.push(a);
    if ((fa > 1e-7 && fb < -1e-7) || (fa < -1e-7 && fb > 1e-7)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const ssPoly = new Array(ssectors.length);
const ssSector = new Array(ssectors.length);
(function descend(idx, poly) {
  if (poly.length < 3) return;
  if (idx & 0x8000) {
    const si = idx & 0x7fff, ss = ssectors[si];
    let p = poly;
    for (let k = 0; k < ss.count; k++) {
      const sg = segs[ss.first + k];
      const a = verts[sg.v1], b = verts[sg.v2];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      // сектор подсектора лежит справа от направления сега
      p = clip(p, q => -((dx) * (q[1] - a[1]) - (dy) * (q[0] - a[0])));
      if (p.length < 3) break;
    }
    ssPoly[si] = p;
    const sg0 = segs[ss.first];
    const line = lines[sg0.line];
    const sdi = sg0.side === 0 ? line.right : line.left;
    ssSector[si] = sdi >= 0 ? sides[sdi].sector : -1;
    return;
  }
  const n = nodes[idx];
  const f = q => n.dy * (q[0] - n.x) - n.dx * (q[1] - n.y);   // >0 — правая (передняя) сторона
  descend(n.right, clip(poly, f));
  descend(n.left, clip(poly, q => -f(q)));
})(nodes.length - 1, [[bx0 - PAD, by0 - PAD], [bx1 + PAD, by0 - PAD], [bx1 + PAD, by1 + PAD], [bx0 - PAD, by1 + PAD]]);

/* ═══════════ растеризация полов ═══════════ */
const gx0 = Math.floor((bx0 - PAD) / CELL) * CELL, gy0 = Math.floor((by0 - PAD) / CELL) * CELL;
const GW = Math.ceil((bx1 + PAD - gx0) / CELL), GH = Math.ceil((by1 + PAD - gy0) / CELL);
let grid = new Int16Array(GW * GH).fill(-1);

for (let si = 0; si < ssPoly.length; si++) {
  const p = ssPoly[si], sec = ssSector[si];
  if (!p || p.length < 3 || sec < 0) continue;
  let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
  for (const [x, y] of p) { px0 = Math.min(px0, x); py0 = Math.min(py0, y); px1 = Math.max(px1, x); py1 = Math.max(py1, y); }
  const i0 = Math.max(0, Math.floor((px0 - gx0) / CELL)), i1 = Math.min(GW - 1, Math.ceil((px1 - gx0) / CELL));
  const j0 = Math.max(0, Math.floor((py0 - gy0) / CELL)), j1 = Math.min(GH - 1, Math.ceil((py1 - gy0) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = gx0 + (i + .5) * CELL, y = gy0 + (j + .5) * CELL;
    let inside = true;
    for (let k = 0; k < p.length && inside; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-6) inside = false;
    }
    if (inside) grid[j * GW + i] = sec;
  }
}

// полы заходят на DILATE клеток в пустоту — иначе под косыми стенами видны щели
for (let pass = 0; pass < DILATE; pass++) {
  const next = Int16Array.from(grid);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (grid[j * GW + i] >= 0) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const s = grid[nj * GW + ni];
      if (s >= 0) { next[j * GW + i] = s; break; }
    }
  }
  grid = next;
}

// жадная склейка клеток в прямоугольники
const rects = [];
const used = new Uint8Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
  const k = j * GW + i, sec = grid[k];
  if (sec < 0 || used[k]) continue;
  let w = 1;
  while (i + w < GW && grid[k + w] === sec && !used[k + w]) w++;
  let h = 1;
  outer: while (j + h < GH) {
    for (let q = 0; q < w; q++) {
      const kk = (j + h) * GW + i + q;
      if (grid[kk] !== sec || used[kk]) break outer;
    }
    h++;
  }
  for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) used[(j + b) * GW + i + a] = 1;
  rects.push({ i, j, w, h, sec });
}
console.log(`полов-прямоугольников: ${rects.length}`);

/* ═══════════ текстуры Doom → наши ═══════════ */
const TEXMAP = [
  [/^BIGDOOR|^DOOR|^SPCDOOR|^EXITDOOR/, 'doorTex'],
  [/^EXIT/, 'exitSign'],
  [/^SW1|^SW2/, 'switchTex'],
  [/^COMP|^SPACEW|^SILVER/, 'computer'],
  [/^LITE|^DOORBLU|^DOORRED|^DOORYEL/, 'techLight'],
  [/^STARTAN|^TEKWALL|^TEKGREN|^SLADWALL/, 'techBase'],
  [/^BROWN|^BROVINE|^BRNSMAL|^BRNPOIS|^BRNBIGC|^BRNBIGL|^BRNBIGR/, 'techBrown'],
  [/^GRAY|^SHAWN|^SUPPORT|^STEP|^PLAT|^SLADPOIS|^PIPE/, 'techGray'],
  [/^MARBLE|^GSTONE|^SKIN|^SKSPINE|^SP_/, 'marble'],
  [/^METAL|^SLADRIP|^CRATE/, 'metal'],
  [/^NUKE|^SLIME|^BLOOD/, 'nukage'],
  [/^STONE|^ROCK|^ASHWALL|^MIDGRATE/, 'stone'],
];
const FLATMAP = [
  [/^F_SKY1$/, null],
  [/^NUKAGE|^SLIME|^BLOOD|^LAVA/, 'nukage'],
  [/^TLITE|^FLAT22|^CEIL1_2/, 'techLight'],
  [/^CEIL|^FLAT18|^FLAT19|^FLAT20/, 'doomCeil'],
  [/^FLOOR|^FLAT|^MFLR|^STEP|^DEM1|^RROCK|^SLIME/, 'doomFloor'],
];
const pick = (table, name, def) => { for (const [re, v] of table) if (re.test(name)) return v; return def; };
const wallTex = n => (!n || n === '-') ? null : pick(TEXMAP, n, 'techGray');
const flatTex = (n, def) => pick(FLATMAP, n, def);

/* ═══════════ перевод координат ═══════════ */
const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;               // карту в центр сцены
const EX = x => R((x - cx) * S);
const EZ = y => R((cy - y) * S);
const EY = z => R(z * S);
const R = v => Math.round(v * 1000) / 1000;

/* ═══════════ объекты уровня ═══════════ */
const objects = [];
// уровень освещённости сектора Doom (0..255) → множитель цвета вершин
const LIT = l => R(0.2 + 0.8 * Math.min(1, Math.max(0, l / 255)));

// полы и потолки
let skyCells = 0;
for (const r of rects) {
  const s = sectors[r.sec];
  const x = EX(gx0 + r.i * CELL), z = EZ(gy0 + (r.j + r.h) * CELL);
  const w = R(r.w * CELL * S), d = R(r.h * CELL * S);
  const lit = LIT(s.light);
  objects.push({ t: 'floor', tex: flatTex(s.floorTex, 'doomFloor'), x, y: EY(s.floor), z, w, d, o: { solid: true, lit } });
  const ct = flatTex(s.ceilTex, 'doomCeil');
  if (ct) objects.push({ t: 'floor', tex: ct, x, y: EY(s.ceil), z, w, d, o: { ceiling: true, lit } });
  else skyCells += r.w * r.h;
}

// стены
let wallCount = 0;
const wall = (l, y0, y1, tex, light) => {
  if (!tex || y1 - y0 < 1) return;
  const a = verts[l.v1], b = verts[l.v2];
  objects.push({
    t: 'wall', tex, x0: EX(a[0]), z0: EZ(a[1]), x1: EX(b[0]), z1: EZ(b[1]),
    y: EY(y0), h: R((y1 - y0) * S), thick: THICK, o: { lit: LIT(light) },
  });
  wallCount++;
};
for (const l of lines) {
  const fs_ = l.right >= 0 ? sides[l.right] : null;
  const bs_ = l.left >= 0 ? sides[l.left] : null;
  if (!fs_) continue;
  const F = sectors[fs_.sector];
  if (!bs_) { wall(l, F.floor, F.ceil, wallTex(fs_.mid) || 'techGray', F.light); continue; }
  const B = sectors[bs_.sector];
  // ступень снизу
  if (F.floor !== B.floor) {
    const lower = F.floor < B.floor ? fs_.lower : bs_.lower;
    const other = F.floor < B.floor ? bs_.lower : fs_.lower;
    wall(l, Math.min(F.floor, B.floor), Math.max(F.floor, B.floor), wallTex(lower) || wallTex(other) || 'techGray',
      Math.max(F.light, B.light));
  }
  // перемычка сверху
  const skyF = F.ceilTex === 'F_SKY1', skyB = B.ceilTex === 'F_SKY1';
  if (F.ceil !== B.ceil && !(skyF && skyB)) {
    const upper = F.ceil > B.ceil ? fs_.upper : bs_.upper;
    const other = F.ceil > B.ceil ? bs_.upper : fs_.upper;
    wall(l, Math.min(F.ceil, B.ceil), Math.max(F.ceil, B.ceil), wallTex(upper) || wallTex(other) || 'techGray',
      Math.max(F.light, B.light));
  }
  // непроходимая двусторонняя линия (перила, решётки) — невидимая преграда
  if ((l.flags & 1) && F.floor === B.floor) {
    const a = verts[l.v1], b = verts[l.v2];
    const x0 = Math.min(EX(a[0]), EX(b[0])), x1 = Math.max(EX(a[0]), EX(b[0]));
    const z0 = Math.min(EZ(a[1]), EZ(b[1])), z1 = Math.max(EZ(a[1]), EZ(b[1]));
    objects.push({ t: 'blocker', x: R(x0 - .1), y: EY(F.floor), z: R(z0 - .1), w: R(x1 - x0 + .2), h: 2.4, d: R(z1 - z0 + .2) });
  }
}

/* ═══════════ вещи ═══════════ */
const THINGMAP = {
  3004: { enemy: 'zombieman' },   // бывший человек
  9: { enemy: 'sergeant' },       // сержант с дробовиком
  3001: { enemy: 'imp' },         // имп
  3002: { enemy: 'demon' },       // демон
  58: { enemy: 'demon' },         // спектр — тот же демон
  65: { enemy: 'commando' },      // пулемётчик
  3005: { enemy: 'cacodemon' },   // какодемон
  3003: { enemy: 'baron' },       // барон ада
  69: { enemy: 'knight' },        // рыцарь ада
  2001: { pickup: 'shotgun' },
  2007: { pickup: 'ammo' }, 2048: { pickup: 'ammo' }, 8: { pickup: 'ammo' },
  2008: { pickup: 'shells' }, 2049: { pickup: 'shells' },
  2011: { pickup: 'health' }, 2012: { pickup: 'health' }, 2013: { pickup: 'health' },
  2014: { pickup: 'health' }, 2018: { pickup: 'health' }, 2019: { pickup: 'health' },
  2035: { barrel: true },
  2028: { lamp: true },                                  // напольная лампа
  34: { lamp: true, small: true },                       // свеча
};

// высота пола под точкой — по той же растровой сетке
function sectorAt(dx, dy) {
  const i = Math.floor((dx - gx0) / CELL), j = Math.floor((dy - gy0) / CELL);
  if (i < 0 || j < 0 || i >= GW || j >= GH) return -1;
  return grid[j * GW + i];
}
const floorAt = (dx, dy) => { const s = sectorAt(dx, dy); return s >= 0 ? sectors[s].floor : 0; };

const enemies = [], pickups = [];
let start = null;
let ei = 0;
for (const t of things) {
  if (t.type === 1) { start = t; continue; }
  if (!(t.flags & 4)) continue;          // только сложность «ультранасилие»
  if (t.flags & 16) continue;            // только для сетевой игры
  const m = THINGMAP[t.type];
  if (!m) continue;
  const x = EX(t.x), z = EZ(t.y), y = EY(floorAt(t.x, t.y));
  if (m.enemy) enemies.push({ type: m.enemy, x, y, z, tag: 'd' + (++ei) });
  else if (m.pickup) pickups.push({ kind: m.pickup, x, y, z });
  else if (m.barrel) objects.push({ t: 'cyl', tex: 'metal', x: R(x - .45), y, z: R(z - .45), r: .45, h: .9, seg: 8 });
  else if (m.lamp) {
    // светящийся столб: точечные источники дороги, а свет сектора уже запечён
    const h = m.small ? .5 : 1.5;
    objects.push({ t: 'cyl', tex: 'metal', x: R(x - .14), y, z: R(z - .14), r: .14, h: R(h - .25), seg: 6 });
    objects.push({ t: 'cyl', tex: 'techLight', x: R(x - .2), y: R(y + h - .25), z: R(z - .2), r: .2, h: .25, seg: 6, o: { emissive: true } });
  }
}

/* ═══════════ выход: переключатель в конце уровня ═══════════ */
const triggers = [];
for (const l of lines) {
  if (l.special !== 11 && l.special !== 51 && l.special !== 52 && l.special !== 124) continue;
  const a = verts[l.v1], b = verts[l.v2];
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  // отойти от стены внутрь сектора (влево от направления линии — сторона правого сайддефа)
  const nx = mx + (dy / len) * 40, ny = my - (dx / len) * 40;
  triggers.push({
    x: EX(nx), z: EZ(ny), r: 1.4, near: 3.2,
    actions: [{ a: 'finish' }],
  });
}

/* ═══════════ сборка уровня ═══════════ */
const level = {
  id: OUT_ID, name: OUT_NAME, version: 1,
  env: 'base',
  envs: {
    base: {
      sky: 'skyCity', fog: '#0c0e14', fogD: 0.010,
      amb: '#9aa0b0', ambI: 3.6, hemiSky: '#aab0c4', hemiGround: '#4a5060', hemiI: 1.2,
      grade: { sat: .9, contrast: 1.12, pivot: .36, lift: .03, shadow: '#101822', light: '#e6eeff', tint: .4, vig: .5 },
    },
  },
  start: {
    x: start ? EX(start.x) : 0, y: start ? EY(floorAt(start.x, start.y)) : 0, z: start ? EZ(start.y) : 0,
    yaw: start ? R(((start.angle - 90) * Math.PI) / 180) : 0,
  },
  bounds: {
    x0: EX(bx0) - 2, z0: EZ(by1) - 2, x1: EX(bx1) + 2, z1: EZ(by0) + 2,
  },
  objective: 'найти выход',
  intro: { msg: '', hint: '' },
  next: null,
  winText: 'Выход найден.',
  player: { stepUp: 0.78 },
  maxEnemies: 44,
  objects, enemies, pickups, triggers,
};

const outFile = path.resolve(here, '../public/levels/' + OUT_ID + '.json');
fs.writeFileSync(outFile, JSON.stringify(level, null, 1));

const idxFile = path.resolve(here, '../public/levels/index.json');
const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
const row = idx.find(r => r.id === OUT_ID);
if (row) row.name = OUT_NAME; else idx.push({ id: OUT_ID, name: OUT_NAME });
idx.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));

console.log(`${outFile}: объектов ${objects.length} (стен ${wallCount}, полов ${rects.length}), врагов ${enemies.length}, предметов ${pickups.length}, триггеров ${triggers.length}`);
console.log(`размер карты ${R((bx1 - bx0) * S)}×${R((by1 - by0) * S)} м, клеток неба ${skyCells}`);
