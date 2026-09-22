/* Генератор пещер для режима вылазок (game.html?mode=cave).

   На выходе — обычные данные уровня того же формата, что и public/levels/*.json
   (см. docs/EDITOR.md). Это принципиально: сгенерированную пещеру можно
   сохранить, открыть в редакторе и разобрать руками — при отладке генерации
   это важнее, чем экономия пары объектов.

   Правила, по которым собирается интересный уровень, вынесены в docs/CAVE.md.
   Коротко:
     · один критический путь из трёх актов: подход → арена → отход к выходу;
     · арена всегда на пути наружу: мимо мини-босса не проскочить;
     · петли обязательны — по кольцу врага можно обежать, а не только пятиться;
     · тупик всегда оплачен: в каждом тупике лежит припас;
     · соседние залы разного размера и разной высоты — иначе пещера читается
       как коридор одной ширины;
     · коридоры гнутся: из зала не должно быть видно следующий зал;
     · свет редкий в коридорах и щедрый на арене — темнота для разведки,
       читаемость для боя.

   Геометрия кладётся на сетку клеток по 2 м: залы вырезаются эллипсами
   с шумом по углу, коридоры — цепочкой дисков. Дальше открытые клетки
   сливаются в прямоугольники (пол, потолки по высотам) и в прогоны стен
   по границам. Пятна яркости раздаются по объектам числом (lit), а не
   функцией: так они переживают сохранение в JSON. */
import { DEFS } from '../engine/enemydefs.js';

const CELL = 2;                       // сторона клетки сетки, м

/* Генератор с зерном. Пещера обязана быть одинаковой при каждой загрузке
   одного и того же зерна: иначе не воспроизвести жалобу «вот здесь дыра». */
const mulberry32 = (a) => () => {
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* Кто водится на какой глубине. Списка имён здесь нет намеренно: набор врагов
   в проекте меняется (public/enemies/index.json), и прибитый гвоздями список
   рано или поздно начал бы ссылаться на тех, кого уже нет, — а пещера молча
   населялась бы одним и тем же зомби. Поэтому опасность каждого врага
   считается по его же описанию, и ярусы нарезаются из того, что загрузилось. */
const threatOf = (d) => {
  const s = d.stats || {};
  const melee = s.melee ? s.melee.dmg / Math.max(.3, s.melee.cooldown) : 0;
  const ranged = s.ranged ? s.ranged.dmg * (s.ranged.burst || 1) / Math.max(.3, s.ranged.cooldown) : 0;
  // здоровье с бронёй, лучший из двух способов бить и подвижность
  return (s.hp || 50) * (1 + (s.armor || 0)) * .5 + Math.max(melee, ranged) * 7 + (s.speed || 3) * 5;
};
// четыре яруса по возрастанию опасности; слабых всегда хотя бы один
function tiers() {
  const list = Object.entries(DEFS).map(([k, d]) => ({ k, t: threatOf(d) })).sort((a, b) => a.t - b.t);
  if (!list.length) return [[]];
  const n = Math.min(4, list.length);
  const out = Array.from({ length: n }, () => []);
  for (let i = 0; i < list.length; i++) out[Math.min(n - 1, Math.floor(i * n / list.length))].push(list[i].k);
  return out;
}

const pickA = (R, arr) => arr[(R() * arr.length) | 0];

/* Набор врагов для глубины: все ярусы до текущего, но верхний идёт с тройным
   весом — глубина должна чувствоваться по составу, а не только по счёту. */
function roster(depth) {
  const T = tiers();
  const top = Math.min(T.length - 1, Math.floor((depth - 1) / 2));
  const out = [];
  for (let t = 0; t <= top; t++) {
    const w = t === top ? 3 : 1;
    for (const k of T[t]) for (let i = 0; i < w; i++) out.push(k);
  }
  return out.length ? out : Object.keys(DEFS);
}
/* Мини-босс — самый опасный из доступных на этой глубине, но не обязательно
   единственный: на мелких глубинах берём верх текущего яруса, дальше — верх
   всего бестиария. Раздувает его уже сам спавн (scale/hpMul). */
function bossKind(R, depth) {
  const T = tiers();
  const top = Math.min(T.length - 1, Math.floor((depth - 1) / 2) + 1);
  const tier = T[top].length ? T[top] : roster(depth);
  return pickA(R, tier);
}

/* ═════════════ зоны ═════════════
   Зона должна быть объяснима, а не просто «другая текстура». Серая каменная
   стена посреди пещеры сама по себе ниоткуда не берётся: порода в одной
   пещере одна. Поэтому зон всего два рода.

   Естественные — то, что с пещерой могло случиться само:
     · обычная порода — основа, её больше всего;
     · вода — нижняя часть, куда стекает: озеро и водопад со свода;
     · мох — там, где свод пробит и до пола достаёт дневной свет, растёт трава;
     · гарь — прогретый участок с трещинами, из которых сочится жар.
   У всех у них стены из той же породы (кроме прогоревшей), меняется грунт
   и то, что в зале происходит.

   И одна рукотворная: `vault` — построенная кем-то комната, вросшая в пещеру.
   Вот ей серый тёсаный камень, плиты под ногами, колонны, лампы и щитки
   как раз положены, и пол в ней поднят на ступень — видно, что это постройка,
   а не продолжение пещеры. Свод над ней остаётся каменным.

   Коридоры всегда естественные: постройка — это отдельная комната, а не
   тоннель. w — вес при жеребьёвке, lit — множитель яркости зоны. */
const BIOMES = {
  rock:  { w: 9, rock: 'caveRock', floor: 'caveFloor', lit: 1 },
  water: { w: 3, rock: 'caveRock', floor: 'caveFloorGrey', lit: .98, pool: true, falls: true },
  moss:  { w: 3, rock: 'caveRock', floor: 'grass', lit: 1.12, shafts: true, plants: true },
  ember: { w: 2, rock: 'caveRockBlack', floor: 'caveFloorBlack', lit: .85, embers: true },
  vault: { w: 3, rock: 'caveRockGrey', floor: 'techBase', ceil: 'caveRock', lit: 1, panels: true, built: true },
};
const BIOME_KEYS = Object.keys(BIOMES);
const ROCK_BIOME = BIOME_KEYS.indexOf('rock');
const biomeRoll = (R) => {
  const total = BIOME_KEYS.reduce((a, k) => a + BIOMES[k].w, 0);
  let t = R() * total;
  for (const k of BIOME_KEYS) { t -= BIOMES[k].w; if (t <= 0) return k; }
  return 'rock';
};

/* ═════════════ 1. план: залы и связи ═════════════ */

/* Комнаты ставятся цепочкой: вход у края карты, дальше шаги в сторону
   противоположного края со случайным отклонением. Цепочка — это и есть
   критический путь, арена стоит в нём предпоследним крупным узлом.
   Если очередной зал некуда воткнуть, план бракуется целиком: подвинуть
   один зал дешевле, но тогда цепочка сминается в клубок. */
function layout(R, depth) {
  const G = Math.min(86, 66 + depth * 3);          // сторона карты в клетках
  const X0 = -G * CELL / 2, Z0 = -G * CELL / 2;
  const rnd = (a, b) => a + R() * (b - a);
  const rooms = [], edges = [];

  const fits = (cx, cz, rx, rz, pad = 4) => {
    if (cx - rx < 4 || cz - rz < 4 || cx + rx > G - 4 || cz + rz > G - 4) return false;
    for (const o of rooms) {
      if (Math.abs(cx - o.cx) < rx + o.rx + pad && Math.abs(cz - o.cz) < rz + o.rz + pad) return false;
    }
    return true;
  };
  const add = (kind, cx, cz, rx, rz, h) => {
    /* Вход всегда обычная бурая порода: это точка отсчёта, по ней игрок
       отличает «ещё не заходил» от «уже был». Соседним залам зона не
       повторяется подряд — два одинаковых зала рядом стирают саму мысль
       о том, что зоны разные. */
    let biome = kind === 'entrance' ? 'rock' : biomeRoll(R);
    const prev = rooms[rooms.length - 1];
    if (prev && prev.biome === biome && R() < .75) biome = biomeRoll(R);
    const r = { kind, cx, cz, rx, rz, h, biome, i: rooms.length };
    rooms.push(r);
    return r;
  };

  // ── вход: у случайной стороны карты, в средней трети ──
  const side = (R() * 4) | 0;
  const t = rnd(.3, .7);
  const er = 3;
  const EDGE = 9;                                  // отступ от края: у самой стенки зал не помещается
  const ex = side === 3 ? EDGE : side === 1 ? G - EDGE : Math.round(t * (G - 2 * EDGE)) + EDGE;
  const ez = side === 2 ? EDGE : side === 0 ? G - EDGE : Math.round(t * (G - 2 * EDGE)) + EDGE;
  if (!fits(ex, ez, er, er)) return null;
  const entrance = add('entrance', ex, ez, er, er, 5);

  // общее направление хода — на другой конец карты, чтобы цепочка не свернулась
  let heading = Math.atan2(G / 2 - ez, G / 2 - ex) + rnd(-.4, .4);

  const nMid = 2 + Math.min(3, Math.floor(depth / 2));   // залов до арены и после
  const before = Math.max(1, Math.ceil(nMid * .6)), after = Math.max(1, nMid - before);
  const chain = [];
  for (let k = 0; k < before; k++) chain.push('hall');
  chain.push('arena');
  for (let k = 0; k < after; k++) chain.push('hall');
  chain.push('exit');

  let prev = entrance, lastSize = er;
  for (const kind of chain) {
    let rx, rz, h;
    if (kind === 'arena') { rx = Math.round(rnd(9, 11)); rz = Math.round(rx * rnd(.85, 1.1)); h = rnd(11, 14); }
    else if (kind === 'exit') { rx = rz = 3; h = rnd(5, 6.5); }
    else {
      /* Соседние залы обязаны различаться размером: два одинаковых подряд
         читаются как один длинный, и пещера перестаёт «дышать». Потолок
         у зала ограничен семью клетками: зал размером с арену отнимает
         у арены то единственное, чем она берёт, — простор. */
      const small = lastSize > 4.5;
      rx = Math.round(small ? rnd(3, 4.5) : rnd(4.5, 6.5));
      rz = Math.max(2, Math.min(7, Math.round(rx * rnd(.7, 1.3))));
      h = rnd(4.5, 8);
    }
    /* Зал ищет себе место сам: сперва в нужную сторону, потом всё шире по углу,
       а если совсем некуда — ужимается. Ужать зал дешевле, чем выбросить
       готовый план: заново собранная цепочка ничем не лучше, просто другая. */
    let placed = null;
    for (let shrink = 0; shrink < 3 && !placed; shrink++) {
      if (shrink) { rx = Math.max(kind === 'arena' ? 8 : 2, rx - 1); rz = Math.max(kind === 'arena' ? 8 : 2, rz - 1); }
      for (let tryN = 0; tryN < 60 && !placed; tryN++) {
        const spread = .5 + tryN / 60 * 1.9;       // сначала строго вперёд, дальше куда пустят
        const ang = heading + rnd(-spread, spread);
        /* Зазор между залами — это и есть длина коридора. Ставить залы вплотную
           нельзя: они сливаются в одну пещеру, и разведывать становится нечего. */
        const dist = prev.rx + rx + rnd(6, 13);
        const cx = Math.round(prev.cx + Math.cos(ang) * dist);
        const cz = Math.round(prev.cz + Math.sin(ang) * dist);
        if (fits(cx, cz, rx, rz)) placed = { cx, cz, ang };
      }
    }
    if (!placed) return null;
    const r = add(kind, placed.cx, placed.cz, rx, rz, h);
    edges.push({ a: prev.i, b: r.i, main: true });
    heading = heading * .6 + placed.ang * .4;
    prev = r; lastSize = rx;
  }

  const arena = rooms.find(r => r.kind === 'arena');
  const exit = rooms.find(r => r.kind === 'exit');

  // ── тупики с припасом: висят на боковинах, к арене — обязательно один ──
  const nCache = 2 + Math.min(2, Math.floor(depth / 3));
  for (let k = 0; k < nCache; k++) {
    const host = k === 0 ? arena : rooms[1 + ((R() * (rooms.length - 2)) | 0)];
    const rx = Math.round(rnd(2, 3.2)), rz = Math.round(rx * rnd(.8, 1.2));
    for (let tryN = 0; tryN < 30; tryN++) {
      const ang = R() * 6.283;
      const dist = host.rx + rx + rnd(5, 11);
      const cx = Math.round(host.cx + Math.cos(ang) * dist);
      const cz = Math.round(host.cz + Math.sin(ang) * dist);
      if (!fits(cx, cz, rx, rz)) continue;
      const r = add('cache', cx, cz, rx, rz, rnd(3.6, 5));
      edges.push({ a: host.i, b: r.i, main: false });
      break;
    }
  }

  /* ── петли ── без них пещера это дерево: врага не обойти, назад только
     тем же коридором. Кольцо даёт и обходной путь для игрока, и фланг для ИИ. */
  const cand = [];
  const ai = rooms.indexOf(arena);
  for (let i = 0; i < rooms.length; i++) for (let j = i + 2; j < rooms.length; j++) {
    if (rooms[i].kind === 'cache' || rooms[j].kind === 'cache') continue;
    /* Перемычка не должна обходить арену: кольцо из зала «до» в зал «после»
       открыло бы дорогу к выходу мимо мини-босса, а он там не для красоты.
       Значит, соединяем только залы по одну сторону от арены — или саму арену
       с чем угодно. */
    if (i !== ai && j !== ai && Math.sign(i - ai) !== Math.sign(j - ai)) continue;
    if (edges.some(e => (e.a === i && e.b === j) || (e.a === j && e.b === i))) continue;
    cand.push({ i, j, d: Math.hypot(rooms[i].cx - rooms[j].cx, rooms[i].cz - rooms[j].cz) });
  }
  cand.sort((a, b) => a.d - b.d);
  /* Одна перемычка ставится всегда, даже если тянуть далеко: пещера без кольца
     это дерево, где от врага можно только пятиться. Остальные — только если
     залы и так рядом, иначе карта зарастает длинными обходами. */
  const want = 2 + (R() < .5 ? 1 : 0);
  for (let k = 0; k < cand.length && k < want; k++) {
    if (k > 0 && cand[k].d > 30) break;
    edges.push({ a: cand[k].i, b: cand[k].j, main: false, loop: true });
  }

  /* ── у арены должно быть не меньше трёх входов ── иначе это не арена,
     а комната с дверью: отступать некуда и обойти противника нечем. */
  let ways = edges.filter(e => e.a === arena.i || e.b === arena.i).length;
  if (ways < 3) {
    const near = rooms.filter(r => r !== arena && r.kind !== 'exit')
      .map(r => ({ r, d: Math.hypot(r.cx - arena.cx, r.cz - arena.cz) }))
      .sort((a, b) => a.d - b.d);
    for (const n of near) {
      if (ways >= 3) break;
      if (edges.some(e => (e.a === arena.i && e.b === n.r.i) || (e.b === arena.i && e.a === n.r.i))) continue;
      edges.push({ a: arena.i, b: n.r.i, main: false, loop: true });
      ways++;
    }
  }
  /* ── нычки ── узкие боковые тоннели, уводящие от зала в сторону.
     Они не нужны ни для прохождения, ни для связности: это то, во что лезут
     из любопытства. Поэтому и тоннель узкий, и низкий, и петляет — по нему
     видно, что он ведёт не «дальше», а «в сторону». Припас лежит по всей
     длине, а не только в конце: иначе награда достаётся только упрямым. */
  const burrows = [];
  const nB = 3 + ((R() * 2) | 0);
  for (let k = 0; k < nB; k++) {
    /* Нычка должна быть в каждой пещере, поэтому место под неё ищется
       настойчиво: другой зал-хозяин, другое направление, а не вышло —
       тоннель короче. Раньше одной неудачной попытки хватало, чтобы
       на карте не оказалось ни одной. */
    let made = null;
    for (let tryN = 0; tryN < 30 && !made; tryN++) {
      const host = rooms[1 + ((R() * (rooms.length - 1)) | 0)];
      const steps = Math.max(2, (4 - Math.floor(tryN / 8)) + ((R() * 2) | 0));
      const segLen = rnd(4, 7);
      let ang = R() * 6.283, cx = host.cx, cz = host.cz;
      const pts = [[cx, cz]];
      let ok = true;
      for (let s2 = 0; s2 < steps; s2++) {
        /* Поворот на шаг ограничен: на крутом изломе сглаженный контур
           срезает внутренний угол, и тоннель в этом месте пережимается
           до щели, в которую уже не протиснуться. */
        ang += rnd(-.65, .65);
        cx += Math.cos(ang) * segLen; cz += Math.sin(ang) * segLen;
        if (cx < 6 || cz < 6 || cx > G - 6 || cz > G - 6) { ok = false; break; }
        if (rooms.some(r => r !== host && Math.abs(cx - r.cx) < r.rx + 1.5 && Math.abs(cz - r.cz) < r.rz + 1.5)) { ok = false; break; }
        pts.push([cx, cz]);
      }
      if (ok && pts.length >= 3) made = { pts, w: rnd(1, 1.2), h: rnd(3, 3.9), end: rnd(1.8, 2.6) };
    }
    if (made) burrows.push(made);
  }
  if (!burrows.length) return null;            // без нычек пещеру не выпускаем

  return { G, X0, Z0, rooms, edges, burrows, entrance, arena, exit };
}

/* ═════════════ 2. резка сетки ═════════════ */

/* Плавная кривая через опорные точки (Catmull-Rom). Коридор, склеенный
   из прямых отрезков, даёт на стыках острые углы: в них упираешься плечом,
   и пространство читается как угловатое. Кривая проходит через те же точки,
   но без изломов — идти по ней ровно, и следующий зал она всё так же
   открывает не сразу. */
function smoothPath(pts, step = .35) {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out = [];
  for (let s = 0; s < P.length - 3; s++) {
    const p0 = P[s], p1 = P[s + 1], p2 = P[s + 2], p3 = P[s + 3];
    const n = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([
        .5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        .5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

function carve(R, P, depth) {
  const { G, rooms, edges } = P;
  const N = G * G;
  const open = new Uint8Array(N);
  const ceilH = new Float32Array(N);
  const zone = new Int16Array(N).fill(-1);
  const biome = new Uint8Array(N);            // индекс в BIOME_KEYS
  const rnd = (a, b) => a + R() * (b - a);
  const idx = (i, j) => j * G + i;
  const inside = (i, j) => i >= 0 && j >= 0 && i < G && j < G;

  /* Зал всегда перебивает коридор: на стыке и потолок, и зона берутся у зала.
     Раньше сравнивались только высоты, и высокий тоннель протаскивал свою
     породу внутрь построенной комнаты — комната переставала быть комнатой. */
  const put = (i, j, h, z, b) => {
    if (!inside(i, j)) return;
    const c = idx(i, j);
    if (!open[c]) { open[c] = 1; ceilH[c] = h; zone[c] = z; biome[c] = b; return; }
    if (z >= 0) { ceilH[c] = h; zone[c] = z; biome[c] = b; return; }
    if (zone[c] < 0 && h > ceilH[c]) { ceilH[c] = h; biome[c] = b; }
  };
  const disc = (px, pz, rr, h, z, b) => {
    for (let j = Math.floor(pz - rr); j <= Math.ceil(pz + rr); j++) {
      for (let i = Math.floor(px - rr); i <= Math.ceil(px + rr); i++) {
        if (Math.hypot(i + .5 - px, j + .5 - pz) <= rr) put(i, j, h, z, b);
      }
    }
  };

  // ── залы: эллипс с мягким шумом по углу, чтобы не получилось блюдце ──
  for (const r of rooms) {
    const ph = [R() * 6.283, R() * 6.283, R() * 6.283];
    /* Шум по контуру нарочно мелкий. Крупные вмятины в стене зала выглядят
       не пещерой, а обгрызенным прямоугольником, и в них застревают: игрок
       обходит зал по стенке и упирается в каждый зуб. */
    const wob = r.kind === 'arena' ? .07 : .13;
    for (let j = Math.floor(r.cz - r.rz * 1.4); j <= Math.ceil(r.cz + r.rz * 1.4); j++) {
      for (let i = Math.floor(r.cx - r.rx * 1.4); i <= Math.ceil(r.cx + r.rx * 1.4); i++) {
        const dx = (i + .5 - r.cx) / r.rx, dz = (j + .5 - r.cz) / r.rz;
        const d = Math.hypot(dx, dz);
        if (d > 1.4) continue;
        const a = Math.atan2(dz, dx);
        const rad = 1 + wob * Math.sin(3 * a + ph[0]) + wob * .6 * Math.sin(5 * a + ph[1]) + wob * .35 * Math.sin(7 * a + ph[2]);
        if (d <= rad) put(i, j, r.h, r.i, BIOME_KEYS.indexOf(r.biome));
      }
    }
  }

  /* ── коридоры ── плавная кривая через два-три колена. Ширина задана
     с запасом: по коридору должны свободно расходиться игрок и боец,
     а стена ест ещё по 0.4 м с каждой стороны. Ниже 4 м прохода
     не опускаемся нигде. */
  for (const e of edges) {
    const a = rooms[e.a], b = rooms[e.b];
    const wCells = e.main ? rnd(1.6, 2.1) : rnd(1.3, 1.6);
    const h = e.main ? rnd(4.6, 6) : rnd(4, 5);
    const dx = b.cx - a.cx, dz = b.cz - a.cz, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const knees = 1 + ((R() * 2) | 0);
    const ctrl = [[a.cx, a.cz]];
    for (let k = 1; k <= knees; k++) {
      const t = k / (knees + 1);
      const off = rnd(-1, 1) * Math.min(8, len * .34);
      ctrl.push([a.cx + dx * t + nx * off, a.cz + dz * t + nz * off]);
    }
    ctrl.push([b.cx, b.cz]);
    const path = smoothPath(ctrl);
    const bph = R() * 6.283, bn = 1 + ((R() * 3) | 0);
    for (let k = 0; k < path.length; k++) {
      const t = k / (path.length - 1);
      /* Карман: коридор плавно раздаётся вширь и так же плавно сходится.
         Ступенчатое расширение давало прямоугольную нишу — именно то,
         что читается как угол. */
      const bulge = Math.max(0, Math.sin(t * 6.283 * bn + bph)) ** 2 * 1.3;
      disc(path[k][0], path[k][1], wCells + bulge, h + bulge * .6, -1, ROCK_BIOME);
    }
  }

  // ── нычки: тот же плавный ход, только узкий и низкий ──
  for (const b of P.burrows) {
    const path = smoothPath(b.pts, .3);
    for (let k = 0; k < path.length; k++) {
      const t = k / (path.length - 1);
      // к концу тоннель чуть сужается — но только чуть: он обязан остаться проходимым
      const w = b.w * (1 - t * .07);
      disc(path[k][0], path[k][1], w, b.h, -1, ROCK_BIOME);
    }
    /* На самих коленях тоннель раздаётся: сглаженный контур срезает
       внутренний угол поворота, и без этого запаса ровно в колене
       остаётся щель в метр — пройти можно, а разминуться уже нет. */
    for (const q of b.pts) disc(q[0], q[1], b.w + .45, b.h, -1, ROCK_BIOME);
    const e = b.pts[b.pts.length - 1];
    for (let j = Math.floor(e[1] - b.end - 1); j <= Math.ceil(e[1] + b.end + 1); j++) {
      for (let i = Math.floor(e[0] - b.end - 1); i <= Math.ceil(e[0] + b.end + 1); i++) {
        if (Math.hypot(i + .5 - e[0], j + .5 - e[1]) <= b.end) put(i, j, b.h + .6, -1, ROCK_BIOME);
      }
    }
  }

  /* ── замыкание ── морфологическое закрытие убирает одноклеточные зубцы
     породы, торчащие в проход: именно они превращают широкий коридор
     в «не пройти». Операция только добавляет клетки, отнять уже открытое
     она не может. */
  const dil = new Uint8Array(N);
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
    const c = idx(i, j);
    if (open[c] || open[c - 1] || open[c + 1] || open[c - G] || open[c + G]) dil[c] = 1;
  }
  for (let j = 2; j < G - 2; j++) for (let i = 2; i < G - 2; i++) {
    const c = idx(i, j);
    if (open[c]) continue;
    if (dil[c] && dil[c - 1] && dil[c + 1] && dil[c - G] && dil[c + G]) {
      // клетка досыпана к проходу — высоту и зону берём у соседа
      let h = 0, b = 0;
      for (const n of [c - 1, c + 1, c - G, c + G]) if (open[n] && ceilH[n] > h) { h = ceilH[n]; b = biome[n]; }
      if (h > 0) { open[c] = 1; ceilH[c] = h; biome[c] = b; zone[c] = -1; }
    }
  }

  /* ── карта просвета ── сколько клеток до ближайшей породы. По ней ставят
     камни и врагов: и то и другое обязано оставлять проход свободным. */
  const clear = new Int16Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let c = 0; c < N; c++) {
    if (!open[c]) { clear[c] = 0; queue[qt++] = c; }
    else clear[c] = -1;
  }
  while (qh < qt) {
    const c = queue[qh++], i = c % G, j = (c / G) | 0, d = clear[c];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
      const nc = idx(ni, nj);
      if (clear[nc] !== -1) continue;
      clear[nc] = d + 1; queue[qt++] = nc;
    }
  }
  return { open, ceilH, zone, biome, clear, idx, inside };
}

/* Связность: до каждого зала обязан быть путь от входа. Проверка дешёвая,
   а без неё тупиковый зал с припасом иногда оказывался замурован. */
function connected(P, C) {
  const { G, rooms, entrance } = P;
  const { open, idx } = C;
  const seen = new Uint8Array(G * G);
  const st = [idx(entrance.cx, entrance.cz)];
  if (!open[st[0]]) return false;
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop();
    const i = c % G, j = (c / G) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
      const nc = idx(ni, nj);
      if (seen[nc] || !open[nc]) continue;
      seen[nc] = 1; st.push(nc);
    }
  }
  for (const r of rooms) if (!seen[idx(r.cx, r.cz)]) return false;

  /* Мало быть связной — по пещере надо ходить. Второй проход идёт только
     по клеткам, от которых до породы не меньше двух клеток: это коридор
     шириной от пяти метров с учётом толщины стены. Если так до какого-то
     зала не дойти, значит где-то есть горлышко, в котором игрок застрянет
     плечом, — план бракуется целиком. Проверять дешевле, чем расширять
     задним числом: расширение ломает уже посчитанные зоны и потолки. */
  const wide = new Uint8Array(G * G);
  const start = idx(entrance.cx, entrance.cz);
  if (C.clear[start] < 2) return false;
  wide[start] = 1;
  const st2 = [start];
  while (st2.length) {
    const c = st2.pop();
    const i = c % G, j = (c / G) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
      const nc = idx(ni, nj);
      if (wide[nc] || C.clear[nc] < 2) continue;
      wide[nc] = 1; st2.push(nc);
    }
  }
  for (const r of rooms) if (!wide[idx(r.cx, r.cz)]) return false;
  C.seen = seen;
  return true;
}

/* ═════════════ 3. геометрия ═════════════ */

/* ═══ контур открытого пространства ═══
   Резать пещеру по клеткам в 2 м удобно, но стены, поставленные прямо
   по этим клеткам, — это лесенка из прямых углов, и она-то и читается как
   «угловато и неуютно». Поэтому границу сначала собирают точно, по рёбрам
   клеток, а потом сглаживают и упрощают: стены движок умеет ставить под
   любым углом, и по сглаженному контуру пещера получается округлой.

   Обход идёт так, что открытая сторона всегда слева, а порода — справа:
   по этому и считается внешняя нормаль, нужная для окон и водопадов. */
function contourLoops(G, open) {
  const idx = (i, j) => j * G + i;
  const key = (i, j) => i * 8192 + j;
  const outs = new Map();                     // угол -> список концов
  const push = (ax, az, bx, bz) => {
    const k = key(ax, az);
    if (!outs.has(k)) outs.set(k, []);
    outs.get(k).push([bx, bz]);
  };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (!open[idx(i, j)]) continue;
    const solid = (a, b) => a < 0 || b < 0 || a >= G || b >= G || !open[idx(a, b)];
    if (solid(i, j - 1)) push(i, j, i + 1, j);
    if (solid(i + 1, j)) push(i + 1, j, i + 1, j + 1);
    if (solid(i, j + 1)) push(i + 1, j + 1, i, j + 1);
    if (solid(i - 1, j)) push(i, j + 1, i, j);
  }
  const loops = [];
  for (const [k0] of outs) {
    while (outs.get(k0)?.length) {
      const loop = [];
      let cur = [Math.floor(k0 / 8192), k0 % 8192];
      let guard = G * G * 4;
      while (guard-- > 0) {
        const list = outs.get(key(cur[0], cur[1]));
        if (!list || !list.length) break;
        const next = list.pop();
        loop.push(cur);
        cur = next;
        if (cur[0] === Math.floor(k0 / 8192) && cur[1] === k0 % 8192) break;
      }
      if (loop.length > 7) loops.push(loop);
    }
  }
  return loops;
}
// сглаживание по Чайкину: два прохода срезают все прямые углы контура
function chaikin(loop, iter = 2) {
  let p = loop;
  for (let n = 0; n < iter; n++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25]);
      out.push([a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    p = out;
  }
  return p;
}
/* Упрощение: после сглаживания точек становится вчетверо больше, а стена
   из полуметровых кусков — это лишние тысячи коллизий ни за чем. Склеиваем
   подряд идущие точки, пока контур не отходит от хорды дальше tol. */
function simplify(loop, tol = .22, maxLen = 4) {
  const out = [];
  let a = 0;
  const n = loop.length;
  while (a < n) {
    let b = a + 1;
    while (b < n) {
      const p0 = loop[a], p1 = loop[b % n];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (L > maxLen) break;
      let bad = false;
      for (let k = a + 1; k < b; k++) {
        const p = loop[k % n];
        const d = Math.abs((p1[0] - p0[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (p1[1] - p0[1])) / Math.max(.001, L);
        if (d > tol) { bad = true; break; }
      }
      if (bad) break;
      b++;
    }
    out.push(loop[a]);
    a = Math.max(a + 1, b - 1);
  }
  return out;
}

// слияние открытых клеток в прямоугольники: меньше объектов, меньше треугольников
function mergeRects(G, keyOf) {
  const used = new Uint8Array(G * G);
  const out = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const c = j * G + i;
    if (used[c]) continue;
    const k = keyOf(i, j);
    if (k === null) continue;
    let w = 1;
    while (i + w < G && !used[c + w] && keyOf(i + w, j) === k) w++;
    let h = 1;
    outer: while (j + h < G) {
      for (let t = 0; t < w; t++) {
        const cc = (j + h) * G + i + t;
        if (used[cc] || keyOf(i + t, j + h) !== k) break outer;
      }
      h++;
    }
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) used[(j + b) * G + i + a] = 1;
    out.push({ i, j, w, h, k });
  }
  return out;
}

export function emit(R, P, C, depth, seed) {
  const { G, X0, Z0, rooms, edges: links, burrows, arena, entrance, exit } = P;
  const { open, ceilH, biome, clear, idx, inside } = C;
  const rnd = (a, b) => a + R() * (b - a);
  const objects = [], enemies = [], pickups = [], triggers = [];
  const wx = (i) => X0 + i * CELL, wz = (j) => Z0 + j * CELL;
  const cxw = (i) => X0 + (i + .5) * CELL, czw = (j) => Z0 + (j + .5) * CELL;

  /* Пятна яркости. Порода кладётся плиткой по 4 м, и на большой стене глаз
     сразу находит период. Низкочастотный шум поверх плитки ничем с ней
     не совпадает — повтор перестаёт читаться. Тот же расчёт, что в префабе
     «Пещера», только значение выдаётся числом на объект. */
  const ph = [R() * 6.283, R() * 6.283, R() * 6.283, R() * 6.283];
  const mot = (x, z) => +(0.9
    + .18 * Math.sin(x * .19 + ph[0]) * Math.sin(z * .17 + ph[1])
    + .09 * Math.sin(x * .41 + ph[2]) * Math.sin(z * .47 + ph[3])).toFixed(3);

  // выход и вход считаем сразу: их координаты нужны уже при расстановке окон
  const exw = cxw(exit.cx), ezw = czw(exit.cz);
  const nearWall = (i, j) => {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!inside(i + di, j + dj) || !open[idx(i + di, j + dj)]) return true;
    }
    return false;
  };
  const B = (i, j) => BIOMES[BIOME_KEYS[biome[idx(i, j)]]] || BIOMES.rock;
  // выбрать клетку в зале по условию
  const cellIn = (r, test) => {
    for (let n = 0; n < 60; n++) {
      const a = R() * 6.283, t = Math.sqrt(R());
      const i = Math.round(r.cx + Math.cos(a) * r.rx * t * .85);
      const j = Math.round(r.cz + Math.sin(a) * r.rz * t * .85);
      if (!inside(i, j) || !open[idx(i, j)]) continue;
      if (test && !test(i, j)) continue;
      return [i, j];
    }
    return null;
  };

  const bKey = (i, j) => biome[idx(i, j)];
  // вода: отдельная отметка поверх зоны — лужи занимают не весь зал
  const pool = new Uint8Array(G * G);

  /* ── лужи ── вырезаются до пола: по этим клеткам вместо грунта ляжет вода,
     а грунт уйдёт на дно. Лужа занимает середину зала-водоёма и никогда
     не расползается на весь: драться по колено в воде на всей карте скучно. */
  for (const r of rooms) {
    if (!BIOMES[r.biome].pool) continue;
    const pr = rnd(.45, .7), ox = rnd(-.2, .2), oz = rnd(-.2, .2);
    for (let j = Math.floor(r.cz - r.rz); j <= Math.ceil(r.cz + r.rz); j++) {
      for (let i = Math.floor(r.cx - r.rx); i <= Math.ceil(r.cx + r.rx); i++) {
        if (!inside(i, j) || !open[idx(i, j)]) continue;
        const dx = (i + .5 - r.cx) / r.rx - ox, dz = (j + .5 - r.cz) / r.rz - oz;
        const a = Math.atan2(dz, dx);
        const wob = 1 + .22 * Math.sin(3 * a + r.i) + .12 * Math.sin(5 * a + r.cx);
        if (Math.hypot(dx, dz) <= pr * wob) pool[idx(i, j)] = 1;
      }
    }
  }

  /* ── пол и потолок ── кладутся на клетку шире прохода. Сглаженная стена
     местами уходит наружу от клеточной границы, и без этого запаса под ней
     зияла бы щель в пустоту. Лишний пол просто прячется в породе. */
  const openD = new Uint8Array(G * G);
  const hD = new Float32Array(G * G);
  const bD = new Uint8Array(G * G);
  const poolD = new Uint8Array(G * G);
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++) {
    const c = idx(i, j);
    if (open[c]) { openD[c] = 1; hD[c] = ceilH[c]; bD[c] = biome[c]; poolD[c] = pool[c]; continue; }
    let h = 0, b = 0;
    for (const n of [c - 1, c + 1, c - G, c + G, c - G - 1, c - G + 1, c + G - 1, c + G + 1]) {
      if (open[n] && ceilH[n] > h) { h = ceilH[n]; b = biome[n]; }
    }
    if (h > 0) { openD[c] = 1; hD[c] = h; bD[c] = b; }
  }

  for (const r of mergeRects(G, (i, j) => openD[idx(i, j)] ? (poolD[idx(i, j)] ? 100 + bD[idx(i, j)] : bD[idx(i, j)]) : null)) {
    const water = r.k >= 100;
    const bi = BIOMES[BIOME_KEYS[r.k % 100]];
    const lit = mot(wx(r.i) + r.w, wz(r.j) + r.h) * bi.lit;
    if (water) {
      // дно под водой и сама вода: поверхность чуть ниже ног, поэтому герой бредёт по щиколотку
      objects.push({ t: 'floor', tex: bi.floor, x: wx(r.i), y: -.45, z: wz(r.j), w: r.w * CELL, d: r.h * CELL, o: { cell: 2, uvScale: .5, lit: lit * .55 } });
      objects.push({ t: 'floor', tex: 'water', x: wx(r.i), y: -.06, z: wz(r.j), w: r.w * CELL, d: r.h * CELL, o: { cell: 4, uvScale: 1.1, lit: lit * 1.3 } });
    } else if (bi.built) {
      /* Пол постройки поднят на ступень. Это и есть главный признак, по
         которому комната читается как сделанная руками, а не как продолжение
         пещеры: на входе в неё поднимаешься на порог. Ступень в четверть метра
         навигация не замечает (она слепа ниже полуметра), поэтому по ней
         одинаково свободно ходят и герой, и бойцы. */
      objects.push({ t: 'box', tex: 'stoneDark', x: wx(r.i), y: 0, z: wz(r.j), w: r.w * CELL, h: .24, d: r.h * CELL, o: { uvScale: .5, lit: lit * .8 } });
      objects.push({ t: 'floor', tex: bi.floor, x: wx(r.i), y: .245, z: wz(r.j), w: r.w * CELL, d: r.h * CELL, o: { cell: 2, uvScale: .5, lit } });
    } else {
      objects.push({ t: 'floor', tex: bi.floor, x: wx(r.i), y: 0, z: wz(r.j), w: r.w * CELL, d: r.h * CELL, o: { cell: 2, uvScale: .5, lit } });
    }
  }
  for (const r of mergeRects(G, (i, j) => openD[idx(i, j)] ? `${Math.round(hD[idx(i, j)] * 4)}|${bD[idx(i, j)]}` : null)) {
    const [hq, bk] = r.k.split('|');
    const bi = BIOMES[BIOME_KEYS[+bk]];
    objects.push({
      t: 'floor', tex: bi.ceil || bi.rock, x: wx(r.i), y: +hq / 4, z: wz(r.j), w: r.w * CELL, d: r.h * CELL,
      o: { ceiling: true, cell: 2.5, uvScale: .5, lit: mot(wx(r.i) - r.h * 3, wz(r.j) + r.w * 3) * .8 * bi.lit },
    });
  }

  /* ── стены по сглаженному контуру ──
     Высоту и породу каждый кусок берёт у той открытой клетки, к которой
     прижат. Толщина 0.9 м: тоньше — и в стыках соседних кусков, стоящих
     под углом, появляются щели. */
  const cellAt = (x, z) => {
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
    return inside(i, j) ? idx(i, j) : -1;
  };
  const WT = .9;
  const windows = [];                       // куда прорезаны окна (для отладки)
  const segs = [];
  const chains = [];                        // те же отрезки, но по петлям и по порядку
  for (const loop of contourLoops(G, open)) {
    const pts = simplify(chaikin(loop.map(([i, j]) => [wx(i), wz(j)]), 2), .22, 4);
    const chain = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < .08) continue;
      // наружу — вправо от направления обхода (порода всегда справа)
      const nx = dz / L, nz = -dx / L;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      let c = cellAt(mx - nx * .9, mz - nz * .9);
      if (c < 0 || !open[c]) c = cellAt(mx - nx * 1.8, mz - nz * 1.8);
      if (c < 0 || !open[c]) continue;
      const sg = { a, b, nx, nz, mx, mz, L, h: ceilH[c] + .9, bk: biome[c] };
      segs.push(sg); chain.push(sg);
    }
    if (chain.length) chains.push(chain);
  }

  /* ── окна ── там, где две части пещеры разделены тонкой перемычкой,
     в ней прорезается щель на уровне глаз. Через неё видно соседний зал
     и простреливается насквозь, но перелезть нельзя: снизу остаётся
     метровый парапет. Без окон соседние пространства не связаны ничем,
     и пещера разваливается на не видящие друг друга коробки. */
  const winAt = [];
  for (const chain of chains) {
    for (let k = 0; k < chain.length; k++) {
      if (windows.length >= 9) break;
      const sg = chain[k];
      if (sg.L < 1.2 || sg.window) continue;
      let hit = 0;
      for (let d = 1.6; d <= 5; d += .4) {
        const c = cellAt(sg.mx + sg.nx * d, sg.mz + sg.nz * d);
        if (c >= 0 && open[c]) { hit = d; break; }
      }
      if (!hit) continue;
      // за самой стеной должна быть именно порода, а не тот же зал за углом
      const near = cellAt(sg.mx + sg.nx * .9, sg.mz + sg.nz * .9);
      if (near < 0 || open[near]) continue;
      if (winAt.some(w => Math.hypot(w[0] - sg.mx, w[1] - sg.mz) < 11)) continue;
      if (Math.hypot(sg.mx - exw, sg.mz - ezw) < 6) continue;
      winAt.push([sg.mx, sg.mz]);
      /* Дыра, а не прорезанное окно. Проём разбирается сразу по нескольким
         подряд идущим кускам стены, и у каждого свой уровень низа и верха —
         снизу получается неровный порожек, сверху рваный свод. Плюс обломки
         по краям, чтобы контур нигде не шёл по линейке. Одинаковые высоты
         по всей длине и давали тот самый аккуратный квадрат. */
      const span = 1 + ((R() * 2) | 0);
      for (let d = -span; d <= span; d++) {
        const t = chain[(k + d + chain.length) % chain.length];
        if (!t || t.h < 3) continue;
        const edge = Math.abs(d) === span;
        t.window = hit;
        t.sill = edge ? rnd(1.25, 1.6) : rnd(.8, 1.15);
        t.top = Math.min(t.h - .5, edge ? rnd(1.9, 2.3) : rnd(2.4, 3));
        if (t.top - t.sill < .7) { t.window = 0; continue; }
        // обломки по краю проёма: они и сбивают прямую линию
        for (let m = 0; m < (edge ? 2 : 1); m++) {
          const rr = rnd(.22, .5);
          const px = t.mx - t.nx * rnd(.1, .5) + (t.b[0] - t.a[0]) / t.L * rnd(-.6, .6);
          const pz = t.mz - t.nz * rnd(.1, .5) + (t.b[1] - t.a[1]) / t.L * rnd(-.6, .6);
          objects.push({
            t: 'cyl', tex: (BIOMES[BIOME_KEYS[t.bk]] || BIOMES.rock).rock,
            x: +(px - rr).toFixed(2), y: +(R() < .5 ? t.sill - rr : t.top - rr * .5).toFixed(2), z: +(pz - rr).toFixed(2),
            r: +rr.toFixed(2), h: +rnd(.25, .6).toFixed(2), seg: 5, o: { solid: false, lit: mot(px, pz) },
          });
        }
      }
      windows.push({ x: +sg.mx.toFixed(1), z: +sg.mz.toFixed(1), d: +hit.toFixed(1) });
    }
  }

  for (const sg of segs) {
    const bi = BIOMES[BIOME_KEYS[sg.bk]] || BIOMES.rock;
    const o = { uvScale: .5, uvOff: [+R().toFixed(2), +R().toFixed(2)], lit: mot(sg.mx, sg.mz) * bi.lit };
    if (!sg.window) {
      objects.push({ t: 'wall', x0: +sg.a[0].toFixed(2), z0: +sg.a[1].toFixed(2), x1: +sg.b[0].toFixed(2), z1: +sg.b[1].toFixed(2), y: 0, h: sg.h, thick: WT, tex: bi.rock, o });
      continue;
    }
    // порожек и свод проёма: щель между ними и есть дыра
    objects.push({ t: 'wall', x0: +sg.a[0].toFixed(2), z0: +sg.a[1].toFixed(2), x1: +sg.b[0].toFixed(2), z1: +sg.b[1].toFixed(2), y: 0, h: +sg.sill.toFixed(2), thick: WT, tex: bi.rock, o });
    if (sg.h > sg.top + .3) {
      objects.push({ t: 'wall', x0: +sg.a[0].toFixed(2), z0: +sg.a[1].toFixed(2), x1: +sg.b[0].toFixed(2), z1: +sg.b[1].toFixed(2), y: +sg.top.toFixed(2), h: +(sg.h - sg.top).toFixed(2), thick: WT, tex: bi.rock, o: { ...o, uvOff: [+R().toFixed(2), +R().toFixed(2)] } });
    }
  }

  /* Перемычки над перепадом потолка остаются на клетках: они высоко,
     их угловатости не видно, а щель в пустоту между залами разной высоты
     закрыть чем-то надо. */
  const lintel = (i, j, di, dj) => {
    const c = idx(i, j);
    if (!open[c]) return null;
    const ni = i + di, nj = j + dj;
    if (!inside(ni, nj) || !open[idx(ni, nj)]) return null;
    const h = ceilH[c], nh = ceilH[idx(ni, nj)];
    if (nh < h - .35) return `${(nh - .15).toFixed(2)}|${(h + .15).toFixed(2)}|${biome[c]}`;
    return null;
  };
  for (const [di, dj] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const along = di === 0;
    for (let o = 0; o < G; o++) {
      let run = null, from = 0;
      for (let a = 0; a <= G; a++) {
        const i = along ? a : o, j = along ? o : a;
        const sgv = a < G ? lintel(i, j, di, dj) : null;
        if (sgv !== run) {
          if (run) {
            const [y0, y1, bk] = run.split('|').map(Number);
            const bi = BIOMES[BIOME_KEYS[bk]] || BIOMES.rock;
            const oo = { uvScale: .5, uvOff: [+R().toFixed(2), +R().toFixed(2)], lit: mot(wx(from), wz(o)) * bi.lit };
            if (along) { const z = wz(o + (dj > 0 ? 1 : 0)); objects.push({ t: 'wall', x0: wx(from), z0: z, x1: wx(a), z1: z, y: y0, h: y1 - y0, thick: .7, tex: bi.rock, o: oo }); }
            else { const x = wx(o + (di > 0 ? 1 : 0)); objects.push({ t: 'wall', x0: x, z0: wz(from), x1: x, z1: wz(a), y: y0, h: y1 - y0, thick: .7, tex: bi.rock, o: oo }); }
          }
          run = sgv; from = a;
        }
      }
    }
  }

  /* ── мелочь ── сталагмиты и валуны жмутся к стенам: середина зала обязана
     остаться проходимой, навигационная сетка раздувает каждый камень ещё
     на 0.4 м, и лес камней посреди арены запирает бойцов намертво. */
  const cells = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (open[idx(i, j)]) cells.push([i, j]);
  for (const [i, j] of cells) {
    const wall = nearWall(i, j);
    const c = idx(i, j);
    const bi = B(i, j);
    const lit = mot(cxw(i), czw(j)) * bi.lit;
    const wet = pool[c];
    /* Всё, обо что можно споткнуться, ставится только там, где после него
       остаётся проход. Просвет считается в клетках по 2 м: камень с опорой
       разрешён с трёх клеток (6 м до породы), валун — с двух. Раньше камни
       жались к стене «на глаз», и в узком коридоре они и съедали проход. */
    const room = clear[c] >= 3, roomy = clear[c] >= 2;
    if (wall && room && !wet && R() < .16) {         // сталагмит
      const base = rnd(.18, .45), hh = rnd(.7, 2.2);
      const x = cxw(i) + rnd(-.4, .4), z = czw(j) + rnd(-.4, .4);
      objects.push({ t: 'cyl', tex: bi.rock, x: x - .03, y: 0, z: z - .03, r: .03, h: hh, seg: 5, o: { r2: base, solid: false, lit } });
      objects.push({ t: 'blocker', x: x - base, y: 0, z: z - base, w: base * 2, h: hh, d: base * 2 });
    } else if (wall && roomy && R() < .1) {          // валун (в воде — торчит из неё)
      const r = rnd(.35, .8);
      objects.push({ t: 'cyl', tex: bi.rock, x: cxw(i) - r, y: wet ? -.4 : 0, z: czw(j) - r, r, h: rnd(.5, 1.2), seg: 6, o: { r2: r * rnd(.55, .85), lit } });
    }
    if (R() < .09) {                                  // сталактит
      const top = ceilH[c], hh = Math.min(rnd(.5, 1.8), top * .45);
      objects.push({ t: 'cyl', tex: bi.rock, x: cxw(i) - .25, y: top - hh, z: czw(j) - .25, r: rnd(.18, .5), h: hh, seg: 5, o: { r2: .03, solid: false, lit } });
    }
    // трава и светящиеся грибы — только в своей зоне и только на суше
    if (bi.plants && !wet && R() < .3) {
      const gx = cxw(i) + rnd(-.6, .6), gz = czw(j) + rnd(-.6, .6);
      if (R() < .72) objects.push({ t: 'sprite', img: 'grassTuft', x: +gx.toFixed(2), y: 0, z: +gz.toFixed(2), w: rnd(.5, 1.1) });
      else objects.push({ t: 'sprite', img: 'shroom', x: +gx.toFixed(2), y: 0, z: +gz.toFixed(2), w: rnd(.3, .55), emissive: true });
    }
  }

  /* ── столбы на арене ── это единственное укрытие в открытом бою: за ними
     разрывают прямую видимость, из-за них выглядывают. Ставим по кольцу
     в средней трети — у стен они бесполезны, в центре мешают. */
  const pillars = 4 + ((R() * 4) | 0);
  for (let k = 0; k < pillars; k++) {
    const a = (k + rnd(-.25, .25)) / pillars * 6.283;
    const t = rnd(.45, .78);
    const i = Math.round(arena.cx + Math.cos(a) * arena.rx * t);
    const j = Math.round(arena.cz + Math.sin(a) * arena.rz * t);
    if (!inside(i, j) || !open[idx(i, j)]) continue;
    // столб у стены перекрывает проход вдоль неё: ставим только на просторе
    if (clear[idx(i, j)] < 3) continue;
    const r = rnd(1, 1.9);
    objects.push({ t: 'cyl', tex: B(i, j).rock, x: cxw(i) - r, y: 0, z: czw(j) - r, r, h: ceilH[idx(i, j)] + .5, seg: 7, o: { r2: r * rnd(.7, 1.05), lit: mot(cxw(i), czw(j)) * B(i, j).lit } });
  }

  /* ── свет ── коридоры держим впроголодь (разведка идёт в потёмках),
     арену заливаем: бой должен читаться. Костры ставим только у стен,
     иначе на них натыкаешься в перестрелке. */
  const fireAt = (i, j, size, color, dist) => {
    objects.push({ t: 'cyl', tex: B(i, j).rock, x: cxw(i) - .4, y: 0, z: czw(j) - .4, r: .4, h: .25, seg: 6, o: { solid: false, lit: mot(cxw(i), czw(j)) } });
    objects.push({ t: 'fire', x: cxw(i), y: .2, z: czw(j), size, color, i: 2.6, dist });
  };
  const litCells = [];
  for (const [i, j] of cells) if (nearWall(i, j) && !pool[idx(i, j)]) litCells.push([i, j]);
  // плотность: один костёр примерно на 70 м² пола, на арене вдвое чаще
  const shuffled = litCells.slice().sort(() => R() - .5);
  const placed = [];
  for (const [i, j] of shuffled) {
    const x = cxw(i), z = czw(j);
    const inArena = Math.hypot(i - arena.cx, j - arena.cz) < Math.max(arena.rx, arena.rz) * 1.1;
    const gap = inArena ? 5.6 : 8.5;
    if (placed.some(p => Math.hypot(p[0] - x, p[1] - z) < gap)) continue;
    placed.push([x, z]);
    fireAt(i, j, inArena ? 1.5 : 1.1, '#ff6a24', inArena ? 24 : 14);
  }
  /* Ни один зал не имеет права остаться чёрным. Огонь раздавался по всей
     карте с общим шагом, и маленький зал мог не получить ни одного:
     в него заходишь — и не видно ни пола, ни того, кто в нём стоит. */
  for (const r of rooms) {
    const rx = cxw(r.cx), rz = czw(r.cz), rad = Math.max(r.rx, r.rz) * CELL;
    const has = placed.filter(p => Math.hypot(p[0] - rx, p[1] - rz) < rad).length;
    const want = r.kind === 'arena' ? 4 : rad > 14 ? 2 : 1;
    for (let k = has; k < want; k++) {
      const c = cellIn(r, (i, j) => nearWall(i, j) && !pool[idx(i, j)]) || cellIn(r, (i, j) => !pool[idx(i, j)]);
      if (!c) break;
      placed.push([cxw(c[0]), czw(c[1])]);
      fireAt(c[0], c[1], 1.2, '#ff6a24', 16);
    }
    // и общий мягкий подсвет под сводом: от него зал перестаёт быть колодцем
    objects.push({ t: 'light', x: +rx.toFixed(2), y: +(r.h * .7).toFixed(2), z: +rz.toFixed(2), color: '#ffa860', i: 1.6, dist: rad + 10 });
  }
  /* Своды арены подсвечены отдельно, источниками без огня: костров по стенам
     на сорок метров не хватает, а поставить их в середине нельзя — в них
     упираешься в бою. Свет сверху не мешает никому и вытягивает арену
     из темноты ровно настолько, чтобы читались силуэты. */
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * 6.283 + R() * 2;
    const i = Math.round(arena.cx + Math.cos(a) * arena.rx * .45);
    const j = Math.round(arena.cz + Math.sin(a) * arena.rz * .45);
    if (!inside(i, j) || !open[idx(i, j)]) continue;
    objects.push({ t: 'light', x: cxw(i), y: ceilH[idx(i, j)] * .72, z: czw(j), color: '#ff9040', i: 2.6, dist: 26 });
  }

  /* ═════════════ особые места зон ═════════════
     То, ради чего зоны и заведены: в пещере должны попадаться места, которые
     запоминаются сами по себе — пробитый светом свод, водопад, вросшая
     в камень техника. Все они ставятся по одной штуке на зал и только там,
     где зона это допускает: редкое событие перестаёт быть событием, если
     случается в каждом зале. */

  /* Свет из дыры в своде. Собран из четырёх частей: светлое пятно на своде
     (сама дыра), столб света биллбордом, засвеченный круг на полу и источник
     света. Одного столба мало — без пятна на полу он висит в воздухе. */
  const shaftAt = (i, j) => {
    const x = cxw(i), z = czw(j), h = ceilH[idx(i, j)], bi = B(i, j);
    const w = rnd(2.4, 4);
    /* Дыра и пятно света круглые и с растушёвкой. Квадратная плашка
       с задранной яркостью выглядела ровно тем, чем была, — покрашенным
       кубиком. Круг собирается из трёх плоских дисков разного радиуса
       и яркости: у центра горячо, к краю сходит на нет, и переход виден
       как свет, а не как граница текстуры. */
    const disc = (r, y, lit, ceiling) => objects.push({
      t: 'cyl', tex: ceiling ? bi.rock : bi.floor, x: +(x - r).toFixed(2), y: +y.toFixed(3), z: +(z - r).toFixed(2),
      r: +r.toFixed(2), h: .04, seg: 16, o: { solid: false, emissive: true, lit },
    });
    disc(w * .5, h - .12, 3.1, true); disc(w * .72, h - .2, 2.1, true); disc(w * .95, h - .3, 1.45, true);
    objects.push({ t: 'sprite', img: 'lightShaft', x: +x.toFixed(2), y: 0, z: +z.toFixed(2), w: +(w * 1.35).toFixed(2), h: +h.toFixed(2), emissive: true });
    disc(w * .7, .04, 2.2, false); disc(w * 1.15, .03, 1.7, false); disc(w * 1.7, .02, 1.3, false);
    /* Источников три по высоте: один фонарь под сводом оставлял пол тёмным,
       а пятно на нём — нарисованным. Свет должен идти вдоль всего столба. */
    objects.push({ t: 'light', x: +x.toFixed(2), y: +(h * .8).toFixed(2), z: +z.toFixed(2), color: '#ffeccc', i: 2.6, dist: 22 });
    objects.push({ t: 'light', x: +x.toFixed(2), y: +(h * .45).toFixed(2), z: +z.toFixed(2), color: '#ffe6b0', i: 2.2, dist: 18 });
    objects.push({ t: 'light', x: +x.toFixed(2), y: 1.1, z: +z.toFixed(2), color: '#ffdca0', i: 2, dist: 14 });
  };

  /* Водопад и техпанели вешаются на настоящую стену, а не на границу клетки.
     Стены идут по сглаженному контуру и отходят от сетки на полметра —
     всё, что ставилось «по клетке», висело в воздухе или тонуло в породе.
     Поэтому и то и другое строится из куска того самого отрезка стены,
     сдвинутого внутрь: под любым углом и точно по месту. */
  const piece = (sg, inset, half) => {
    const ux = (sg.b[0] - sg.a[0]) / sg.L, uz = (sg.b[1] - sg.a[1]) / sg.L;
    const h = Math.min(half, sg.L / 2);
    return [
      +(sg.mx - ux * h - sg.nx * inset).toFixed(2), +(sg.mz - uz * h - sg.nz * inset).toFixed(2),
      +(sg.mx + ux * h - sg.nx * inset).toFixed(2), +(sg.mz + uz * h - sg.nz * inset).toFixed(2),
    ];
  };
  const segsNear = (r, test) => {
    const rx = cxw(r.cx), rz = czw(r.cz), rad = Math.max(r.rx, r.rz) * CELL * 1.15;
    return segs.filter(sg => !sg.window && Math.hypot(sg.mx - rx, sg.mz - rz) < rad && (!test || test(sg)))
      .sort(() => R() - .5);
  };

  /* Водопад: полотно воды по стене, у которого есть исток. Раньше вода
     начиналась прямо у свода и текла из ровного камня — теперь наверху
     вырезана тёмная ниша, из неё выступает каменная кромка, и вода
     срывается уже с кромки. Полотно проходимо насквозь: за водой
     обычно есть куда встать. */
  const fallAt = (sg) => {
    const bi = BIOMES[BIOME_KEYS[sg.bk]] || BIOMES.rock;
    const h = sg.h - .9;
    const wq = Math.min(1.7, sg.L / 2);
    const mouthY = Math.max(2.6, h - 1.4);
    const [ax, az, bx, bz] = piece(sg, .45, wq);
    const [nax, naz, nbx, nbz] = piece(sg, .1, wq + .45);
    const [lax, laz, lbx, lbz] = piece(sg, .7, wq + .3);
    objects.push({ t: 'wall', x0: nax, z0: naz, x1: nbx, z1: nbz, y: mouthY, h: Math.max(.8, h - mouthY + .6), thick: .4, tex: 'dark', o: { solid: false, lit: .22 } });
    objects.push({ t: 'wall', x0: lax, z0: laz, x1: lbx, z1: lbz, y: mouthY - .38, h: .4, thick: .8, tex: bi.rock, o: { solid: false, uvScale: .5, lit: mot(sg.mx, sg.mz) * 1.15 } });
    objects.push({ t: 'wall', x0: ax, z0: az, x1: bx, z1: bz, y: -.3, h: mouthY + .3, thick: .22, tex: 'waterfall', o: { solid: false, uvScale: .5, lit: 1.5 } });
    // чаша под водопадом, брызговые камни и холодный отблеск
    const px = sg.mx - sg.nx * 1.6, pz = sg.mz - sg.nz * 1.6;
    objects.push({ t: 'floor', tex: 'water', x: px - 2, y: -.05, z: pz - 2, w: 4, d: 4, o: { cell: 2, uvScale: 1.1, lit: 1.3 } });
    objects.push({ t: 'light', x: +px.toFixed(2), y: 1.4, z: +pz.toFixed(2), color: '#6ad8d0', i: 2, dist: 14 });
    objects.push({ t: 'light', x: +sg.mx.toFixed(2), y: +(mouthY - .3).toFixed(2), z: +sg.mz.toFixed(2), color: '#8ae8e0', i: 1.4, dist: 10 });
    for (let k = 0; k < 6; k++) {
      const a = R() * 6.283, rr = rnd(1, 2.4), r = rnd(.2, .45);
      objects.push({ t: 'cyl', tex: bi.rock, x: px + Math.cos(a) * rr - r, y: -.35, z: pz + Math.sin(a) * rr - r, r, h: rnd(.4, .9), seg: 5, o: { r2: r * .7, solid: false, lit: mot(px, pz) } });
    }
  };

  /* Вросшая в камень постройка: лампа-полоса и щиток на породе. Свет у неё
     холодный — единственный холодный свет в пещере, кроме выхода, поэтому
     техно-зал узнаётся с порога. */
  const panelAt = (sg) => {
    const lamp = R() < .6;
    const half = Math.min(lamp ? rnd(.9, 1.6) : rnd(.7, 1.1), sg.L / 2);
    const y = lamp ? rnd(2.2, 3.2) : 1.1;
    const hq = lamp ? .5 : 1.5;
    if (sg.h < y + hq + .4) return;
    const [ax, az, bx, bz] = piece(sg, .3, half);
    objects.push({ t: 'wall', x0: ax, z0: az, x1: bx, z1: bz, y, h: hq, thick: .3, tex: lamp ? 'techLight' : 'computer', o: { solid: false, emissive: true, uvScale: 1 } });
    const lx = sg.mx - sg.nx * .8, lz = sg.mz - sg.nz * .8;
    objects.push({ t: 'light', x: +lx.toFixed(2), y: y + .2, z: +lz.toFixed(2), color: lamp ? '#a8d8ff' : '#40ff90', i: lamp ? 2.2 : 1.2, dist: lamp ? 15 : 8 });
  };

  for (const r of rooms) {
    const bi = BIOMES[r.biome];
    const big = r.kind === 'arena';
    // светлые пятна: во мшистом зале обязательно (трава без света не растёт), иначе изредка
    const shafts = bi.shafts ? 1 + (big || R() < .5 ? 1 : 0) : (R() < .22 ? 1 : 0);
    for (let k = 0; k < shafts; k++) {
      const c = cellIn(r, (i, j) => !nearWall(i, j) && !pool[idx(i, j)] && ceilH[idx(i, j)] > 4);
      if (c) shaftAt(c[0], c[1]);
    }
    if (bi.falls) {
      const cand = segsNear(r, sg => sg.h > 4.4 && sg.L > 1.6);
      const used = [];
      for (const sg of cand) {
        if (used.length >= (big ? 2 : 1)) break;
        if (used.some(u => Math.hypot(u.mx - sg.mx, u.mz - sg.mz) < 9)) continue;
        used.push(sg); fallAt(sg);
      }
    }
    if (bi.panels) {
      const cand = segsNear(r, sg => sg.L > 1.2);
      const used = [];
      for (const sg of cand) {
        if (used.length >= (big ? 6 : 4)) break;
        if (used.some(u => Math.hypot(u.mx - sg.mx, u.mz - sg.mz) < 5)) continue;
        used.push(sg); panelAt(sg);
      }
    }
    /* Гарь: прогретый участок с трещинами, из которых сочится жар. Свечение
       кладётся цветным множителем на белую текстуру — так на чёрном грунте
       получается именно оранжевый накал, а не серое пятно. */
    if (bi.embers) {
      for (let k = 0; k < (big ? 7 : 4); k++) {
        const c = cellIn(r, (i, j) => !pool[idx(i, j)] && clear[idx(i, j)] >= 2);
        if (!c) continue;
        const x = cxw(c[0]) + rnd(-.6, .6), z = czw(c[1]) + rnd(-.6, .6), rr = rnd(.5, 1.1);
        objects.push({ t: 'cyl', tex: 'flash', x: +(x - rr).toFixed(2), y: .03, z: +(z - rr).toFixed(2), r: +rr.toFixed(2), h: .03, seg: 8, o: { solid: false, emissive: true, lit: [2.4, .85, .3] } });
        objects.push({ t: 'light', x: +x.toFixed(2), y: .4, z: +z.toFixed(2), color: '#ff5a14', i: 1.5, dist: 9, pulse: 2.2 });
        if (R() < .4) objects.push({ t: 'fire', x: +x.toFixed(2), y: .05, z: +z.toFixed(2), size: .5, color: '#ff7a20', i: 1.2, dist: 7 });
      }
    }
    /* Постройка: колонны вдоль стен. Они и держат «потолок», и разбивают
       пустую коробку — комната без колонн выглядит вырезанной в камне
       коробкой, а не построенной. */
    if (bi.built) {
      const n = 4 + ((R() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const a = (k + rnd(-.2, .2)) / n * 6.283, t = rnd(.6, .82);
        const i = Math.round(r.cx + Math.cos(a) * r.rx * t), j = Math.round(r.cz + Math.sin(a) * r.rz * t);
        if (!inside(i, j) || !open[idx(i, j)] || clear[idx(i, j)] < 3) continue;
        const rr = rnd(.5, .8);
        objects.push({ t: 'cyl', tex: 'stoneDark', x: +(cxw(i) - rr).toFixed(2), y: .24, z: +(czw(j) - rr).toFixed(2), r: +rr.toFixed(2), h: ceilH[idx(i, j)], seg: 8, o: { uvScale: .6, lit: mot(cxw(i), czw(j)) } });
        objects.push({ t: 'cyl', tex: 'techGray', x: +(cxw(i) - rr - .14).toFixed(2), y: .24, z: +(czw(j) - rr - .14).toFixed(2), r: +(rr + .14).toFixed(2), h: .3, seg: 8, o: { solid: false, uvScale: .6, lit: mot(cxw(i), czw(j)) } });
      }
    }
  }

  /* ═════════════ этажность арены ═════════════
     Плоская арена в сорок метров читается как поле. Уровни дают ей форму:
     низкий помост посреди — высокое место, за которое дерутся, и галерея
     под сводом — точка, откуда простреливают весь зал.

     Высоты выбраны не на глаз, а по тому, что умеет движок. Помост ровно
     в полшага (0.45 м): навигационная сетка не замечает препятствий ниже
     0.5 м, поэтому по помосту одинаково свободно ходят и герой, и бойцы.
     Галерея, наоборот, заведомо выше — по ней ходит только герой (и те,
     кого там поставили): лестницу навигация уже считает стеной. Это не изъян,
     а разделение ролей: внизу мясорубка, наверху снайперская точка,
     за которую надо лезть. */
  const arenaBi = BIOMES[arena.biome];
  const AX = cxw(arena.cx), AZ = czw(arena.cz);
  const ARX = arena.rx * CELL, ARZ = arena.rz * CELL;
  // ── помост ──
  {
    const pw = rnd(7, 11), pd = rnd(7, 11);
    const a = R() * 6.283, off = rnd(0, .28);
    const px = AX + Math.cos(a) * ARX * off, pz = AZ + Math.sin(a) * ARZ * off;
    objects.push({ t: 'box', tex: arenaBi.rock, x: px - pw / 2, y: 0, z: pz - pd / 2, w: pw, h: .45, d: pd, o: { uvScale: .5, lit: mot(px, pz) * arenaBi.lit } });
    objects.push({ t: 'floor', tex: arenaBi.floor, x: px - pw / 2, y: .451, z: pz - pd / 2, w: pw, d: pd, o: { cell: 2, uvScale: .5, lit: mot(px, pz) * arenaBi.lit * 1.06 } });
    // приступок сбоку, чтобы помост не выглядел плитой, положенной сверху
    const sw = rnd(2.5, 4);
    objects.push({ t: 'box', tex: arenaBi.rock, x: px - pw / 2 - sw, y: 0, z: pz - pd / 4, w: sw, h: .22, d: pd / 2, o: { uvScale: .5, lit: mot(px, pz) * arenaBi.lit * .95 } });
  }
  // ── галерея под стеной ──
  const gallery = [];
  {
    const side = (R() * 4) | 0;
    const alongX = side % 2 === 0;
    const sgn = side < 2 ? 1 : -1;
    const RI = alongX ? ARZ : ARX;                  // радиус поперёк галереи
    const RA = alongX ? ARX : ARZ;                  // радиус вдоль неё
    const A0 = alongX ? AX : AZ, I0 = alongX ? AZ : AX;
    const steps = 9;
    const gh = +(steps * .45).toFixed(2);           // верх лестницы обязан совпасть с полом галереи
    const len = Math.min(RA * 1.25, 20), dep = rnd(4, 5.5);
    const outer = I0 + sgn * (RI * .92);
    const innerI = outer - sgn * dep;
    // плита, бортик и опоры
    const put3 = (ac, ic, as, is, y, h, tex, o) => {
      const x = alongX ? ac : ic, z = alongX ? ic : ac;
      const w = alongX ? as : is, d = alongX ? is : as;
      objects.push({ t: 'box', tex, x: x - w / 2, y, z: z - d / 2, w, h, d, o });
    };
    const lit = mot(AX, AZ) * arenaBi.lit;
    put3(A0, (outer + innerI) / 2, len, dep, gh - .45, .45, arenaBi.rock, { uvScale: .5, lit });
    put3(A0, innerI + sgn * .18, len, .36, gh, .38, arenaBi.rock, { uvScale: .5, lit: lit * 1.1 });
    for (let k = -1; k <= 1; k++) {
      const ac = A0 + k * len * .34;
      const x = alongX ? ac : innerI + sgn * .9, z = alongX ? innerI + sgn * .9 : ac;
      objects.push({ t: 'cyl', tex: arenaBi.rock, x: x - .55, y: 0, z: z - .55, r: .55, h: gh - .45, seg: 6, o: { r2: .7, lit: lit * .9 } });
    }
    // лестница: ступени ровно в полшага, иначе на галерею не подняться
    const sAc = A0 + len * .5 - 1.6;
    for (let k = 1; k <= steps; k++) {
      const ic = innerI - sgn * (steps - k + .5) * .75;
      put3(sAc, ic, 3, .75, 0, .45 * k, arenaBi.rock, { uvScale: .5, lit: lit * (.9 + k * .01) });
    }
    // на галерее всегда что-то лежит: лезть наверх должно окупаться
    const gx = alongX ? A0 - len * .3 : (outer + innerI) / 2;
    const gz = alongX ? (outer + innerI) / 2 : A0 - len * .3;
    pickups.push({ kind: depth >= 3 && R() < .4 ? 'shells' : 'health', x: +gx.toFixed(2), z: +gz.toFixed(2), y: gh, n: 35 });
    for (let k = 0; k < 3; k++) {
      const ac = A0 + (k - 1) * len * .3;
      gallery.push({
        x: +(alongX ? ac : (outer + innerI) / 2).toFixed(2),
        z: +(alongX ? (outer + innerI) / 2 : ac).toFixed(2),
        y: gh,
      });
    }
  }

  /* ── вход и выход ── два конца пути обязаны различаться с первого взгляда:
     вход — тёплый огонь и завал, выход — холодное синее свечение. Иначе
     на обратном пути игрок час ходит между ними кругами. */
  objects.push({ t: 'fire', x: cxw(entrance.cx), y: .2, z: czw(entrance.cz), size: 1.5, color: '#ff8a30', i: 3, dist: 16 });
  objects.push({ t: 'light', x: exw, y: 2.4, z: ezw, color: '#40e0ff', i: 3.4, dist: 22 });
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * 6.283, rr = 2.4;
    objects.push({
      t: 'cyl', tex: 'techLight', x: exw + Math.cos(a) * rr - .22, y: 0, z: ezw + Math.sin(a) * rr - .22,
      r: .22, h: rnd(1.4, 2.6), seg: 5, o: { r2: .04, emissive: true, solid: false },
    });
  }
  objects.push({ t: 'quad', x: exw, y: 1.6, z: ezw, w: 3.2, h: 2.2, tex: 'exitSign', face: 0, o: { emissive: true } });
  triggers.push({ x: exw, z: ezw, r: 2.6, actions: [{ a: 'finish' }] });

  /* ═════════════ 4. население ═════════════ */

  const kinds = roster(depth);
  /* Клетки зала, куда можно кого-то поставить. Просвет не меньше двух клеток:
     боец, втиснутый в угол, не может ни отступить, ни обойти — он просто
     стоит и получает по голове, а выглядит это как мусор, забытый в углу. */
  const spots = (r) => {
    const out = [];
    for (let j = Math.floor(r.cz - r.rz); j <= Math.ceil(r.cz + r.rz); j++) {
      for (let i = Math.floor(r.cx - r.rx); i <= Math.ceil(r.cx + r.rx); i++) {
        if (!inside(i, j) || !open[idx(i, j)] || clear[idx(i, j)] < 2) continue;
        if (Math.hypot(i - entrance.cx, j - entrance.cz) < 5) continue;
        out.push([cxw(i) + rnd(-.4, .4), czw(j) + rnd(-.4, .4)]);
      }
    }
    return out.sort(() => R() - .5);
  };
  // никаких двух тел в одной точке: между бойцами всегда есть куда шагнуть
  const taken = [];
  const freeSpot = (x, z, gap = 2.4) => !taken.some(t => Math.hypot(t[0] - x, t[1] - z) < gap);
  const okCell = (x, z) => {
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
    return inside(i, j) && open[idx(i, j)] && clear[idx(i, j)] >= 2;
  };

  /* Бюджет врагов на пещеру. Растёт линейно, но упирается в потолок: больше
     сорока тел на карте — это уже не бой, а очередь, и кадр проседает. */
  const budget = Math.min(42, 7 + depth * 4);
  const share = { arena: .45, before: .28, after: .15, cache: .12 };
  const chainRooms = rooms.filter(r => r.kind === 'hall');
  const arenaIdxInChain = rooms.indexOf(arena);
  const before = chainRooms.filter(r => rooms.indexOf(r) < arenaIdxInChain);
  const after = chainRooms.filter(r => rooms.indexOf(r) > arenaIdxInChain);
  const caches = rooms.filter(r => r.kind === 'cache');

  const fill = (list, n, o = {}) => {
    if (!list.length || n <= 0) return;
    /* Враги ставятся кучками по 2-3: одиночки по всей карте превращают
       пещеру в отстрел столбиков, а группа заставляет отступать в коридор.
       Но кучка — это полукольцо в паре метров друг от друга, а не стопка
       в одной точке: иначе они мешают сами себе и застревают. */
    let left = Math.round(n), guard = 60;
    while (left > 0 && guard-- > 0) {
      const r = list[(R() * list.length) | 0];
      const pts = spots(r).filter(([x, z]) => freeSpot(x, z, 5));
      if (!pts.length) continue;
      const group = Math.min(left, 2 + ((R() * 2) | 0));
      const [gx, gz] = pts[0];
      const a0 = R() * 6.283;
      let made = 0;
      for (let k = 0; k < group; k++) {
        let put = null;
        for (let tryN = 0; tryN < 8 && !put; tryN++) {
          const a = a0 + (k / group) * 6.283 + rnd(-.5, .5), d = k === 0 ? 0 : rnd(1.9, 3.4);
          const x = +(gx + Math.cos(a) * d).toFixed(2), z = +(gz + Math.sin(a) * d).toFixed(2);
          if (okCell(x, z) && freeSpot(x, z)) put = [x, z];
        }
        if (!put) continue;
        taken.push(put);
        enemies.push({
          type: pickA(R, kinds), x: put[0], z: put[1],
          tag: o.tag || 'cave', alerted: !!o.alerted, guardR: o.guardR ?? 0,
        });
        made++;
      }
      left -= Math.max(1, made);
    }
  };
  fill(before.length ? before : [rooms[1]], budget * share.before, { guardR: 14 });
  fill(after.length ? after : [rooms[rooms.length - 2]], budget * share.after, { guardR: 14 });
  fill(caches, budget * share.cache, { guardR: 9 });

  /* На галерее сидят стрелки: смысл верхней точки в том, что оттуда
     простреливают весь зал, а достать её можно только поднявшись.
     Радиус поста маленький — со своей площадки они не сходят. */
  const shooters = kinds.filter(k => DEFS[k]?.stats?.ranged);
  let onGallery = 0;
  for (const gp of gallery) {
    if (R() < .25) continue;
    enemies.push({
      type: shooters.length ? pickA(R, shooters) : pickA(R, kinds),
      x: gp.x, z: gp.z, y: gp.y, tag: 'arena', guardR: 5,
    });
    onGallery++;
  }
  fill([arena], budget * share.arena - onGallery, { tag: 'arena', guardR: Math.max(arena.rx, arena.rz) * CELL });

  // ── мини-босс: в центре арены, держит её и не бежит за игроком по карте ──
  const bk = bossKind(R, depth);
  taken.push([cxw(arena.cx), czw(arena.cz)]);
  enemies.push({
    type: bk, x: +cxw(arena.cx).toFixed(2), z: +czw(arena.cz).toFixed(2), tag: 'boss',
    guardR: Math.max(arena.rx, arena.rz) * CELL + 6,
    scale: +(1.35 + Math.min(.35, depth * .04)).toFixed(2),
    hpMul: +(2.6 + depth * .5).toFixed(2),
    dmgMul: 1.4,
  });

  /* ── припас ── каждый тупик оплачен: пустой тупик наказывает за разведку,
     а весь смысл коридоров в том, чтобы в них лезли. Дальше по глубине
     припаса больше — но не пропорционально, иначе на десятой пещере
     ходишь с полным боезапасом. */
  const stashes = [];
  const drop = (r, kind, n) => {
    const pts = spots(r, .8);
    if (!pts.length) return;
    const [x, z] = pts[(R() * pts.length) | 0];
    pickups.push({ kind, x: +x.toFixed(2), z: +z.toFixed(2), ...(n ? { n } : {}) });
  };
  /* Закуток обязан окупиться. Кроме припаса в нём лежит куча золота:
     свернуть с дороги в тупик игрок должен не из любопытства, а зная,
     что за это платят. Деньги кладёт уже режим при загрузке (см. run.js) —
     они не предмет уровня, а физические пачки. */
  for (const c of caches) {
    drop(c, 'health', 35);
    drop(c, R() < .5 ? 'ammo' : 'shells');
    if (R() < .35 + depth * .05) drop(c, R() < .7 ? 'shells' : 'ammo');
    const sp = cellIn(c, (i, j) => clear[idx(i, j)] >= 2) || cellIn(c);
    if (sp) stashes.push({ x: +cxw(sp[0]).toFixed(2), z: +czw(sp[1]).toFixed(2), n: Math.round(rnd(25, 45) + depth * 6) });
  }
  /* Нычки. Припас лежит по всей длине тоннеля, а не только в каморке:
     награда должна начинаться сразу, иначе на середине разворачиваются.
     В конце — клад. */
  const wpt = (p) => [X0 + p[0] * CELL, Z0 + p[1] * CELL];
  for (const b of burrows) {
    const path = smoothPath(b.pts, .3);
    for (const t of [.35, .62, .85]) {
      if (R() < .25) continue;
      const [px, pz] = wpt(path[Math.round(t * (path.length - 1))]);
      const kind = R() < .45 ? 'health' : R() < .6 ? 'ammo' : 'shells';
      pickups.push({ kind, x: +px.toFixed(2), z: +pz.toFixed(2), ...(kind === 'health' ? { n: 25 } : {}) });
    }
    const [ex2, ez2] = wpt(b.pts[b.pts.length - 1]);
    stashes.push({ x: +ex2.toFixed(2), z: +ez2.toFixed(2), n: Math.round(rnd(30, 55) + depth * 7) });
    /* В каморке всегда горит: тоннель уводит в сторону от общего света,
       и без своего огня конец нычки — чёрная дыра, в которой не видно,
       за чем ты сюда шёл. */
    objects.push({ t: 'fire', x: +ex2.toFixed(2), y: .2, z: +(ez2 - .8).toFixed(2), size: .9, color: '#ff6a24', i: 2.4, dist: 12 });
    const mid = wpt(path[Math.round(path.length * .5)]);
    objects.push({ t: 'light', x: +mid[0].toFixed(2), y: 1.6, z: +mid[1].toFixed(2), color: '#c08040', i: 1.2, dist: 9 });
    if (depth >= 2 && R() < .3) pickups.push({ kind: R() < .6 ? 'shotgun' : 'rockets', x: +ex2.toFixed(2), z: +(ez2 + 1).toFixed(2) });
  }

  // перед ареной — лечение и патроны: заходить в бой на последнем здоровье незачем
  const prep = before[before.length - 1] || rooms[1];
  drop(prep, 'health', 35); drop(prep, 'ammo'); drop(prep, 'shells');
  // после арены — награда за бой
  const relief = after[0] || exit;
  drop(relief, 'health', 50); drop(relief, 'shells');
  // дробовик находится в пещере, если его ещё нет — со второй глубины
  if (depth >= 2 && R() < .5) drop(caches[0] || prep, 'shotgun');
  if (depth >= 4 && R() < .25) drop(caches[caches.length - 1] || relief, 'rocket');
  // на арене припас лежит по краям, как точки респавна предметов в дезматче
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * 6.283 + R();
    const i = Math.round(arena.cx + Math.cos(a) * arena.rx * .8);
    const j = Math.round(arena.cz + Math.sin(a) * arena.rz * .8);
    if (!inside(i, j) || !open[idx(i, j)]) continue;
    pickups.push({ kind: k === 0 ? 'health' : k === 1 ? 'shells' : 'ammo', x: +cxw(i).toFixed(2), z: +czw(j).toFixed(2) });
  }

  const nextRoom = rooms[1] || arena;
  const sdx = cxw(nextRoom.cx) - cxw(entrance.cx), sdz = czw(nextRoom.cz) - czw(entrance.cz);
  const startYaw = Math.atan2(-sdx, -sdz);

  const pad = 6;
  return {
    id: `cave-${depth}-${seed}`,
    name: `пещера ${depth}`,
    version: 1,
    env: 'cave',
    envs: {
      /* Туман здесь не для дали, а для воздуха: в пещере он съедает чёрную
         пустоту в проёмах и даёт свету объём. Цвет у него не чёрный, а тёплый
         дымный — чёрный туман неотличим от темноты и только гасит картинку.
         Вместе с поднятым общим светом это и значит «нет мест, где не видно
         совсем ничего»: даже без единого костра силуэты читаются. */
      cave: {
        sky: 'skyCrypt', fog: '#241a14', fogD: .028, amb: '#96683f', ambI: 2.5,
        hemiSky: '#b87a44', hemiGround: '#241610', hemiI: 2,
        grade: { sat: .92, contrast: 1.2, pivot: .27, lift: .05, shadow: '#2a180e', light: '#ffd8a8', tint: .5, vig: .62 },
      },
    },
    /* Куда смотреть на входе. Раньше герой всегда появлялся с yaw 0 и
       в половине пещер утыкался носом в породу. Разворачиваем его вдоль
       первого коридора: шагнул — и сразу видно, куда идти.
       Вперёд у героя — это (−sin yaw, −cos yaw), отсюда и знаки. */
    start: { x: +cxw(entrance.cx).toFixed(2), y: 0, z: +czw(entrance.cz).toFixed(2), yaw: +startYaw.toFixed(3) },
    bounds: { x0: X0 - pad, z0: Z0 - pad, x1: X0 + G * CELL + pad, z1: Z0 + G * CELL + pad },
    objective: '',
    objects, enemies, pickups, npcs: [], triggers, rules: [],
    next: null,
    maxEnemies: 42,
    /* Фонарей на карте под сотню, а гореть одновременно может лишь несколько:
       движок цепляет на записи света ограниченный пул. Восьми штук на пещеру
       с костром в каждом зале мало — в коридоре между двумя огнями наступала
       темнота. Двенадцать закрывают разрыв и в кадр укладываются. */
    lightBudget: 12,
    // метаданные пещеры: ими пользуется режим вылазки (указатель на выход, статистика)
    cave: {
      depth, seed,
      exit: { x: +exw.toFixed(2), z: +ezw.toFixed(2) },
      arena: { x: +cxw(arena.cx).toFixed(2), z: +czw(arena.cz).toFixed(2), r: Math.max(arena.rx, arena.rz) * CELL },
      boss: bk,
      stashes,
      windows,
      // ход каждой нычки в мировых координатах — по нему рисуется карта отладки
      burrows: burrows.map(b => b.pts.map(q => wpt(q).map(v => +v.toFixed(1)))),
      rooms: [
        ...rooms.map(r => ({ kind: r.kind, biome: r.biome, x: +cxw(r.cx).toFixed(1), z: +czw(r.cz).toFixed(1), r: Math.max(r.rx, r.rz) * CELL })),
        ...burrows.map(b => { const e = wpt(b.pts[b.pts.length - 1]); return { kind: 'burrow', biome: 'rock', x: +e[0].toFixed(1), z: +e[1].toFixed(1), r: b.end * CELL }; }),
      ],
      // граф залов: по нему проверяют, что арена и правда стоит на пути наружу
      links: links.map(e => [e.a, e.b, e.main ? 1 : 0]),
    },
  };
}

/* Пещера целиком: план → резка → проверка связности → геометрия.
   План иногда не складывается (цепочке некуда идти) — тогда берём
   следующее зерно, а не чиним криво поставленный зал. */
export function generateCave(seed, depth = 1) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const R = mulberry32((Math.imul(seed >>> 0, 2654435761) + attempt * 40503) >>> 0);
    const P = layout(R, depth);
    if (!P) continue;
    const C = carve(R, P, depth);
    if (!connected(P, C)) continue;
    return emit(R, P, C, depth, seed);
  }
  throw new Error('генератор пещеры не смог собрать уровень');
}
