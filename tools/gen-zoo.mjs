/* Зал-зверинец в песочнице: ряд открытых комнат прямо перед точкой появления,
   в каждой — свой вид врага, который возрождается после смерти.

   Запуск: node tools/gen-zoo.mjs             — построить/обновить зал
           node tools/gen-zoo.mjs --remove    — убрать зал и вернуть песочницу как была
           node tools/gen-zoo.mjs --keep-old  — не трогать врагов и спавнеры самой песочницы

   Список комнат берётся из public/enemies/index.json, так что после добавления
   или удаления врага достаточно перезапустить скрипт.

   Всё, что ставит зал, помечено полем zoo: 1. То, что он забирает у песочницы
   (кусок северной стены, старых врагов, спавнеры, прежнюю точку появления),
   складывается в zooStash и возвращается при --remove. Рядом остаётся копия
   sandbox.json.bak. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEVEL = path.join(here, '..', 'public', 'levels', 'sandbox.json');
const INDEX = path.join(here, '..', 'public', 'enemies', 'index.json');

const REMOVE = process.argv.includes('--remove');
const KEEP_OLD = process.argv.includes('--keep-old');

const ROOM = 10;         // ширина комнаты, м
const DEPTH = 12;        // глубина комнаты
const DOOR = 5;          // ширина проёма в фасаде
const WALL_H = 4.2;
const THICK = 0.5;
const FRONT = -46;       // линия фасада: комнаты стоят к северу от неё
const STAND = 12;        // на сколько метров южнее фасада появляется игрок

const level = JSON.parse(fs.readFileSync(LEVEL, 'utf8'));
fs.writeFileSync(LEVEL + '.bak', JSON.stringify(level, null, 2) + '\n');

// снести прежний зал и вернуть песочнице всё, что он забирал
level.objects = (level.objects || []).filter(o => !o.zoo);
level.enemies = (level.enemies || []).filter(e => e.tag !== 'zoo');
level.pickups = (level.pickups || []).filter(p => !p.zoo);
if (level.zooStash) {
  level.objects.push(...(level.zooStash.objects || []));
  level.enemies.push(...(level.zooStash.enemies || []));
  if (level.zooStash.start) level.start = level.zooStash.start;
  delete level.zooStash;
}

if (REMOVE) {
  level.bounds = { x0: -34, z0: -34, x1: 34, z1: 34 };
  fs.writeFileSync(LEVEL, JSON.stringify(level, null, 2) + '\n');
  console.log('зал убран, песочница вернулась к прежнему виду');
  process.exit(0);
}

const stash = { objects: [], enemies: [], start: level.start };
const add = o => level.objects.push({ ...o, zoo: 1 });
const wall = (x0, z0, x1, z1, tex = 'stoneDark') =>
  add({ t: 'wall', x0, z0, x1, z1, y: 0, h: WALL_H, thick: THICK, tex });

const names = JSON.parse(fs.readFileSync(INDEX, 'utf8')).map(e => e.name).filter(Boolean);
if (!names.length) { console.error('в index.json нет врагов — нечего расставлять'); process.exit(1); }

/* Габариты ряда. Игрок появляется по центру, в STAND метрах перед фасадом,
   и видит комнаты сразу — за тем и затевалось. */
const width = names.length * ROOM;
const xLeft = -width / 2, xRight = width / 2;
const zBack = FRONT - DEPTH;                         // глухая задняя стена
const zStand = FRONT + STAND;

// пол и потолок: захватываем и площадку перед комнатами
add({ t: 'floor', tex: 'cobble', x: xLeft - 6, y: 0, z: zBack - 4, w: width + 12, d: DEPTH + STAND + 14 });
add({ t: 'box', tex: 'stoneDark', x: xLeft - 6, y: WALL_H + 1.6, z: zBack - 4, w: width + 12, h: 0.6, d: DEPTH + STAND + 14 });

// внешний контур: задняя стена, бока и стенка за спиной игрока с проходом в песочницу
wall(xLeft - 6, zBack, xRight + 6, zBack);
wall(xLeft - 6, zBack, xLeft - 6, zStand + 6);
wall(xRight + 6, zBack, xRight + 6, zStand + 6);
wall(xLeft - 6, zStand + 6, -DOOR, zStand + 6);
wall(DOOR, zStand + 6, xRight + 6, zStand + 6);

/* Северная стена песочницы сплошная — 64 м камня без единого проёма. Режем её
   на две половины, чтобы из песочницы можно было дойти до зала и обратно. */
const keep = [];
for (const o of level.objects) {
  const blocksDoor = o.t === 'box' && o.h > 3 && o.d <= 2
    && o.z <= -30 && o.z + o.d >= -36 && o.x < -DOOR && o.x + o.w > DOOR;
  if (!blocksDoor) { keep.push(o); continue; }
  stash.objects.push(o);
  add({ ...o, w: -DOOR - o.x });
  add({ ...o, x: DOOR, w: o.x + o.w - DOOR });
  console.log(`в северной стене песочницы прорублен проход шириной ${DOOR * 2} м`);
}
level.objects = keep.concat(level.objects.filter(o => o.zoo && !keep.includes(o)));

// в самом проёме не должно остаться колонн и факельных столбов
const inDoor = o => !o.zoo && o.x !== undefined && o.z !== undefined
  && o.x > -DOOR - 1.2 && o.x < DOOR + 1.2 && o.z > -38 && o.z < -23;
const blocking = level.objects.filter(inDoor);
if (blocking.length) {
  stash.objects.push(...blocking);
  level.objects = level.objects.filter(o => !blocking.includes(o));
}
// соединительный коридор от песочницы к площадке
add({ t: 'floor', tex: 'cobble', x: -DOOR, y: 0, z: zStand + 6, w: DOOR * 2, d: 16 });
wall(-DOOR, zStand + 20, -DOOR, zStand + 6);
wall(DOOR, zStand + 20, DOOR, zStand + 6);

/* Комнаты. Фасад каждой — две стенки с проёмом посередине, так что врага видно
   прямо с площадки. Вместо живого врага ставим спавнер: убил — через пару
   секунд в комнате снова тот же вид. */
names.forEach((name, i) => {
  const cx = xLeft + i * ROOM + ROOM / 2;
  const a = cx - ROOM / 2, b = cx + ROOM / 2;

  wall(a, zBack, a, FRONT);                                  // боковая (у соседей общая)
  if (i === names.length - 1) wall(b, zBack, b, FRONT);
  wall(a, FRONT, cx - DOOR / 2, FRONT);                      // фасад с проёмом
  wall(cx + DOOR / 2, FRONT, b, FRONT);

  // пол через одну другой текстурой, чтобы клетки различались
  add({ t: 'floor', tex: i % 2 ? 'stone' : 'cobble', x: a + THICK, y: 0.02, z: zBack + THICK, w: ROOM - THICK * 2, d: DEPTH - THICK * 2 });
  // факел у края проёма — иначе вглубь комнаты ничего не видно
  add({ t: 'prefab', kind: 'torchPost', x: cx - DOOR / 2 - 1.4, z: FRONT - 1.6 });

  /* period — пауза перед новым врагом, max 1 — в комнате всегда один,
     total 0 — бесконечно, near покрывает весь ряд, чтобы дальние комнаты
     не пустовали, пока игрок стоит в центре. */
  add({
    t: 'prefab', kind: 'spawner', x: cx - 1, z: zBack + DEPTH / 2,
    p: { type: name, period: 3, max: 1, r: 2, total: 0, near: width + 40, tag: 'zoo', hold: 8 },
  });
});

// припасы на площадке перед комнатами
for (const [dx, kind] of [[-4, 'shells'], [4, 'health'], [-10, 'ammo'], [10, 'shells'], [-16, 'rockets'], [16, 'rockets']])
  level.pickups.push({ kind, x: dx, z: zStand + 2, y: 1.1, zoo: 1 });

/* Враги и спавнеры самой песочницы только мешают: каждый вид должен сидеть
   в своей комнате. Убираем, но сохраняем — вернутся при --remove. */
if (!KEEP_OLD) {
  stash.enemies.push(...level.enemies);
  level.enemies = [];
  const old = level.objects.filter(o => o.t === 'prefab' && o.kind === 'spawner' && !o.zoo);
  stash.objects.push(...old);
  level.objects = level.objects.filter(o => !old.includes(o));
  if (stash.enemies.length || old.length)
    console.log(`из песочницы убрано: врагов ${stash.enemies.length}, спавнеров ${old.length} (--keep-old оставит)`);
}

// появляемся лицом к ряду комнат
level.start = { x: 0, y: 0, z: zStand, yaw: 0 };
level.zooStash = stash;
level.bounds = { x0: Math.min(-34, xLeft - 10), z0: Math.min(-34, zBack - 8), x1: Math.max(34, xRight + 10), z1: 34 };
level.maxEnemies = Math.max(level.maxEnemies || 0, names.length + 8);

fs.writeFileSync(LEVEL, JSON.stringify(level, null, 2) + '\n');
console.log(`зал: ${names.length} комнат в ряд по ${ROOM}×${DEPTH} м`);
console.log(`  появление в точке (0, ${zStand}) лицом к фасаду; ряд занял x ${xLeft}…${xRight}`);
console.log(`  в комнатах: ${names.join(', ')}`);
console.log('  враги возрождаются через 3 с после смерти, по одному на комнату');
