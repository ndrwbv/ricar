/* Импорт монстров из WAD в формат врагов движка.
   Запуск: node tools/doom-enemies.mjs <путь/к.wad> [имена через запятую]
           node tools/doom-enemies.mjs freedoom2.wad zombieman,sergeant,imp

   Что делает: достаёт из WAD кадры монстра, складывает их в лист
   public/enemies/<имя>/sheet.png и пишет рядом enemy.json с анимациями и статами.
   Дальше это обычный враг движка — его можно ставить в редакторе и
   перерисовывать поверх, как любого другого.

   Ассеты берутся из ТОГО WAD, который указали: Freedoom (свободная лицензия),
   собственная копия Doom, свой PWAD. Инструмент ничего не скачивает.

   Чего в думовских спрайтах нет: кадров «сдаётся», «бьёт ножом», «присел»,
   «скачет на одной ноге», «ползёт», «стоит без головы». Эти механики у
   импортированных врагов выключаются сами — движок включает их только при
   наличии кадров. Отстрел рук работает (руки вырезаются из кадра маской),
   отстрел ног — нет, пока не дорисованы hop0/hop1.

   Спрайты в WAD именуются так: 4 символа монстра + буква кадра + цифра ракурса,
   например POSSA1 — кадр A, вид спереди. Имя из 8 символов (POSSA2A8) значит
   «кадр A ракурс 2, он же ракурс 8 зеркально». Ракурс 0 — один вид на все стороны. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openWad, palette, readPatch, writePng } from './wadlib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'public', 'enemies');

const [wadPath, only] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!wadPath) {
  console.error('нужен путь к WAD: node tools/doom-enemies.mjs <файл.wad> [имена через запятую]');
  process.exit(1);
}

const S = 1 / 32;          // метров в юните Doom — тот же масштаб, что у импорта карт

/* ═══════════ монстры ═══════════
   `frames` — раскладка кадров в WAD: какие буквы за что отвечают. Она у каждого
   монстра своя и здесь записана по факту (Doom и совместимые с ним наборы).
   Если в вашем WAD раскладка другая, инструмент это заметит и напечатает, какие
   буквы реально нашлись.

   Броня (armor) — доля урона, которую держит корпус: у крупных тварей шкура
   и доспех гасят обычную пулю, но дробь в упор и тяжёлый замах их пробивают.
   Здоровье НЕ взято из Doom: там пистолет бьёт на 5–15, а здесь на 34, поэтому
   числа пересчитаны под оружие игрока с сохранением порядка «кто крепче».
   Скорости и дистанции — тоже под этот движок. */
const MONSTERS = {
  zombieman: {
    gibs: 'meat',
    sprite: 'POSS', title: 'зомби-солдат',
    frames: { walk: 'ABCD', attack: 'EF', pain: 'G', death: 'HIJKL' },
    hp: 190, speed: 3.9, alertR: 22, radius: 0.62,
    ranged: { range: 24, burst: 1, gap: .1, dmg: 8, aim: .55, cooldown: 1.5, spread: .07 },
    flank: [0, 0, 0.8, -0.8], tactics: { cover: .3, surrender: 0, fake: 0, knifeDmg: 0 },
    drop: { weapon: { kind: 'ammo', n: 10 } },          // обойма из подсумка
  },
  sergeant: {
    gibs: 'meat',
    sprite: 'SPOS', title: 'сержант с дробовиком',
    frames: { walk: 'ABCD', attack: 'EF', pain: 'G', death: 'HIJKL' },
    hp: 260, armor: .05, speed: 3.7, alertR: 24, radius: 0.62,
    ranged: { range: 20, burst: 1, gap: .1, dmg: 18, aim: .6, cooldown: 1.9, spread: .13 },
    flank: [0, 0.6, -0.6], tactics: { cover: .45, surrender: 0, fake: 0, knifeDmg: 0 },
    drop: { weapon: { kind: 'shotgun', n: 8 } },        // его дробовик — крутится и подбирается
  },
  commando: {
    gibs: 'meat',
    sprite: 'CPOS', title: 'пулемётчик',
    frames: { walk: 'ABCD', attack: 'EF', pain: 'G', death: 'HIJKL' },
    hp: 340, armor: .1, speed: 4.1, alertR: 26, radius: 0.62,
    ranged: { range: 28, burst: 6, gap: .07, dmg: 7, aim: .5, cooldown: 1.6, spread: .06 },
    flank: [0, 0.7, -0.7, 1.4], tactics: { cover: .6, surrender: 0, fake: 0, knifeDmg: 0 },
    drop: { weapon: { kind: 'ammo', n: 25 } },          // полная лента к пулемёту
  },
  imp: {
    gibs: 'meat',
    sprite: 'TROO', title: 'бес',
    frames: { walk: 'ABCD', attack: 'EFG', pain: 'H', death: 'IJKLM' },
    hp: 320, armor: .12, speed: 4.6, alertR: 26, radius: 0.62,
    melee: { range: 2.2, dmg: 16, windup: .45, cooldown: 1.1 },
    flank: [0, 1.2, -1.2, 2.2], tactics: { cover: .1, surrender: 0, fake: 0, knifeDmg: 0 },
  },
  demon: {
    gibs: 'meat',
    sprite: 'SARG', title: 'демон',
    frames: { walk: 'ABCD', attack: 'EF', pain: 'G', death: 'HIJKLMN' },
    hp: 620, armor: .25, speed: 7.2, alertR: 24, radius: 0.85,
    melee: { range: 2.4, dmg: 24, windup: .3, cooldown: .8 }, lunge: true,
    flank: [0, 0, 0.5, -0.5], tactics: { cover: 0, surrender: 0, fake: 0, knifeDmg: 0 },
    // четвероногая туша: рук нет, ноги под брюхом — отстреливать нечего, кроме головы
    parts: { armL: null, armR: null, legL: null, legR: null, head: [0.30, 0.10, 0.70, 0.42] },
  },
  knight: {
    gibs: 'meat',
    sprite: 'BOS2', title: 'рыцарь ада',
    frames: { walk: 'ABCD', attack: 'EFG', pain: 'H', death: 'IJKLMN' },
    hp: 900, armor: .35, speed: 3.6, alertR: 24, radius: 0.9,
    melee: { range: 2.8, dmg: 34, windup: .7, cooldown: 1.5 },
    flank: [0, 0, 0.4, -0.4], tactics: { cover: .05, surrender: 0, fake: 0, knifeDmg: 0 },
  },
  baron: {
    gibs: 'meat',
    sprite: 'BOSS', title: 'барон ада',
    frames: { walk: 'ABCD', attack: 'EFG', pain: 'H', death: 'IJKLMN' },
    hp: 1400, armor: .45, speed: 3.4, alertR: 26, radius: 0.9,
    melee: { range: 2.8, dmg: 44, windup: .75, cooldown: 1.6 },
    flank: [0, 0], tactics: { cover: 0, surrender: 0, fake: 0, knifeDmg: 0 },
  },
  cacodemon: {
    gibs: 'meat',
    sprite: 'HEAD', title: 'какодемон',
    frames: { walk: 'A', attack: 'BC', pain: 'D', death: 'EFGHIJ' },
    hp: 780, armor: .3, speed: 3.2, alertR: 28, radius: 1.0,
    melee: { range: 2.6, dmg: 26, windup: .5, cooldown: 1.3 },
    flank: [0, 0.9, -0.9], tactics: { cover: 0, surrender: 0, fake: 0, knifeDmg: 0 },
    parts: { armL: null, armR: null, legL: null, legR: null, head: [0.22, 0.14, 0.78, 0.70] },
  },
};

/* ═══════════ чтение кадров ═══════════ */
const wad = openWad(wadPath);
const pal = palette(wad);
console.log(`${path.basename(wadPath)}: ${wad.magic}, лампов ${wad.lumps.length}`);

/* Все лампы монстра: имя начинается с его четырёх букв. Ищем по всему WAD, а не
   между S_START/S_END, — в PWAD-ах эти метки часто стоят иначе или отсутствуют. */
function spriteLumps(prefix) {
  const out = [];
  for (const l of wad.lumps) {
    if (l.size < 8 || l.name.length < 6 || !l.name.startsWith(prefix)) continue;
    const rest = l.name.slice(4);
    if (rest.length !== 2 && rest.length !== 4) continue;
    out.push(l);
  }
  return out;
}

/* Кадр `frame` с ракурса `rot`. Возвращает картинку и признак «зеркалить».
   Порядок поиска: точное совпадение → всеракурсный кадр (0) → зеркальная половина
   восьмисимвольного имени → любой другой ракурс, лишь бы кадр был. */
function findFrame(lumps, prefix, frame, rot) {
  const want = [String(rot), '0'];
  for (const r of want) {
    const exact = lumps.find(l => l.name === prefix + frame + r);
    if (exact) return { lump: exact, flip: false };
  }
  for (const l of lumps) {
    if (l.name.length !== 8) continue;
    const a = l.name[4], ar = l.name[5], b = l.name[6], br = l.name[7];
    if (a === frame && want.includes(ar)) return { lump: l, flip: false };
    if (b === frame && want.includes(br)) return { lump: l, flip: true };   // вторая половина — зеркало
  }
  const any = lumps.find(l => l.name[4] === frame);
  return any ? { lump: any, flip: false } : null;
}

function patchOf(hit) {
  const p = readPatch(wad.data(hit.lump), pal);
  if (!hit.flip) return p;
  const px = new Uint8Array(p.px.length);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const s = (y * p.w + (p.w - 1 - x)) * 4, d = (y * p.w + x) * 4;
    px[d] = p.px[s]; px[d + 1] = p.px[s + 1]; px[d + 2] = p.px[s + 2]; px[d + 3] = p.px[s + 3];
  }
  return { ...p, px, left: p.w - p.left };
}

/* Зоны попадания по силуэту.
   Доли кадра, рассчитанные под наши процедурные спрайты, думовским не годятся:
   у них фигура уже и смещена, поэтому прямоугольник «руки» попадал в туловище —
   при отстреле из спрайта вырезался кусок корпуса. Меряем реальный силуэт кадра
   ходьбы и раскладываем зоны по нему. */
function partsFromSilhouette(img, W, H, ox, oy) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const rowMin = new Int32Array(H).fill(1e9), rowMax = new Int32Array(H).fill(-1);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (!img.px[(y * img.w + x) * 4 + 3]) continue;
    const gx = ox + x, gy = oy + y;
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) continue;
    if (gx < minX) minX = gx; if (gx > maxX) maxX = gx;
    if (gy < minY) minY = gy; if (gy > maxY) maxY = gy;
    if (gx < rowMin[gy]) rowMin[gy] = gx;
    if (gx > rowMax[gy]) rowMax[gy] = gx;
  }
  if (maxX < minX) return null;
  const top = minY, bot = maxY + 1, h = bot - top;
  const f = (a, b) => [a / W, b / H];

  /* Голова. Ширину берём по медиане верхних строк, а не по максимуму: у рогатых
     и у тех, кто держит оружие поднятым, самая широкая строка сверху — совсем не
     голова, и зона расползалась на полкадра. Низ головы — там, где силуэт устойчиво
     шире медианной ширины верхушки. */
  const widthAt = y => (rowMax[y] >= 0 ? rowMax[y] - rowMin[y] + 1 : 0);
  const med = arr => { const a = arr.filter(v => v > 0).sort((x, y2) => x - y2); return a.length ? a[a.length >> 1] : 1; };
  const probe = Math.max(2, Math.round(h * 0.12));
  const topRows = Array.from({ length: probe }, (_, i) => top + i);
  const headW = med(topRows.map(widthAt));
  const headCx = med(topRows.filter(y => rowMax[y] >= 0).map(y => Math.round((rowMin[y] + rowMax[y]) / 2)));
  let headBot = top + Math.round(h * 0.20);
  for (let y = top + probe; y < top + h * 0.42; y++) {
    if (widthAt(y) > headW * 1.45) { headBot = y; break; }         // пошли плечи
  }
  const hx0 = headCx - Math.round(headW / 2) - 1, hx1 = headCx + Math.round(headW / 2) + 1;

  // туловище с руками и ноги: делим оставшуюся высоту
  const legTop = top + Math.round(h * 0.62);
  const bodyRows = [];
  for (let y = headBot; y < legTop; y++) if (rowMax[y] >= 0) bodyRows.push([rowMin[y], rowMax[y]]);
  const bx0 = Math.min(...bodyRows.map(r => r[0])), bx1 = Math.max(...bodyRows.map(r => r[1]));
  const bw = bx1 - bx0 + 1;
  const armW = Math.max(3, Math.round(bw * 0.38));                 // рука прижата к телу, поэтому зона шире трети

  const legRows = [];
  for (let y = legTop; y < bot; y++) if (rowMax[y] >= 0) legRows.push([rowMin[y], rowMax[y]]);
  const lx0 = legRows.length ? Math.min(...legRows.map(r => r[0])) : bx0;
  const lx1 = legRows.length ? Math.max(...legRows.map(r => r[1])) : bx1;
  const lmid = (lx0 + lx1 + 1) / 2;

  const r4 = a => a.map(v => +v.toFixed(3));
  return {
    head: r4([...f(hx0 - 1, top), ...f(hx1 + 2, headBot + 1)]),
    armL: r4([...f(bx0, headBot), ...f(bx0 + armW, legTop)]),
    armR: r4([...f(bx1 - armW + 1, headBot), ...f(bx1 + 1, legTop)]),
    legL: r4([...f(lx0, legTop), ...f(lmid, bot)]),
    legR: r4([...f(lmid, legTop), ...f(lx1 + 1, bot)]),
  };
}

/* ═══════════ кадры «без конечности» ═══════════
   В Brutal Doom культи не вырезают из картинки на лету — для каждого состояния
   нарисован свой кадр. Делаем так же, только заготовки генерируем сами: берём
   кадр, убираем зону конечности по контуру и дорисовываем кровавый срез.
   Это рабочая заглушка, поверх которой можно нарисовать нормальную культю. */
function severed(img, W, H, ox, oy, zone, fromLeft) {
  const px = new Uint8Array(img.px);                      // копия кадра
  // зона задана в долях клетки листа, переводим в координаты этого кадра
  const zx0 = Math.round(zone[0] * W) - ox, zx1 = Math.round(zone[2] * W) - ox;
  const zy0 = Math.round(zone[1] * H) - oy, zy1 = Math.round(zone[3] * H) - oy;
  const at = (x, y) => (y * img.w + x) * 4;
  const solid = (x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h && px[at(x, y) + 3] > 0;

  // 1. убираем всё, что попало в зону
  for (let y = Math.max(0, zy0); y < Math.min(img.h, zy1); y++)
    for (let x = Math.max(0, zx0); x < Math.min(img.w, zx1); x++) px[at(x, y) + 3] = 0;

  /* 2. кровавый срез по внутренней границе зоны: идём по строкам и красим те,
        где тело действительно оборвано, а не пустота. Кромка ложится по контуру,
        поэтому у тонкой руки она узкая, у плеча — широкая. */
  const edge = fromLeft ? zx1 : zx0 - 1;                  // с какой стороны осталось тело
  const dir = fromLeft ? 1 : -1;
  for (let y = Math.max(0, zy0); y < Math.min(img.h, zy1); y++) {
    let x = edge;
    let guard = 0;
    while (guard++ < img.w && !solid(x, y)) x += dir;     // ищем край оставшегося тела
    if (!solid(x, y)) continue;
    for (let i = 0; i < 3; i++) {
      const cx = x - dir * i;
      if (cx < 0 || cx >= img.w) break;
      const o = at(cx, y);
      const dark = i === 0;
      px[o] = dark ? 150 : 96; px[o + 1] = dark ? 14 : 6; px[o + 2] = dark ? 18 : 10; px[o + 3] = 255;
    }
    // редкая кость в середине среза
    if (y === Math.round((zy0 + zy1) / 2)) {
      const o = at(x, y);
      px[o] = 232; px[o + 1] = 224; px[o + 2] = 208;
    }
  }
  // 3. пара капель вниз от нижнего края среза
  for (let k = 0; k < 4; k++) {
    const y = Math.min(img.h - 1, zy1 + k);
    const x = Math.max(0, Math.min(img.w - 1, fromLeft ? zx1 + 1 : zx0 - 2));
    if (y < 0) continue;
    const o = at(x, y);
    px[o] = 130; px[o + 1] = 10; px[o + 2] = 14; px[o + 3] = 255;
  }
  return { ...img, px };
}

/* ═══════════ сборка листа ═══════════ */
function build(name, M) {
  const lumps = spriteLumps(M.sprite);
  if (!lumps.length) return console.warn(`${name}: в WAD нет спрайтов ${M.sprite}* — пропущен`);
  const have = [...new Set(lumps.map(l => l.name[4]).concat(lumps.filter(l => l.name.length === 8).map(l => l.name[6])))].sort().join('');

  // какие кадры кладём в лист и под какими именами их ждёт движок
  const plan = [];
  const walk = [...M.frames.walk];
  walk.forEach((f, i) => plan.push({ key: `walk${i}`, frame: f, rot: 1 }));
  [...M.frames.attack].forEach((f, i) => plan.push({ key: i ? `attack${i}` : 'attack', frame: f, rot: 1 }));
  plan.push({ key: 'pain', frame: M.frames.pain[0], rot: 1 });
  const death = [...M.frames.death];
  death.forEach((f, i) => plan.push({ key: `die${i}`, frame: f, rot: 0 }));
  plan.push({ key: 'dead', frame: death[death.length - 1], rot: 0 });

  // достаём картинки
  const got = [];
  for (const p of plan) {
    const hit = findFrame(lumps, M.sprite, p.frame, p.rot);
    if (!hit) { console.warn(`  ${name}: нет кадра ${M.sprite}${p.frame} — пропущен`); continue; }
    got.push({ ...p, img: patchOf(hit) });
  }
  if (!got.length) return console.warn(`${name}: ни одного кадра не собралось`);

  /* Размер клетки листа. Doom рисует спрайт от «горячей точки»: left — сколько
     пикселей left от неё, top — сколько вверх. Ставим все кадры так, чтобы точка
     была в одном месте: по центру по ширине и на линии пола по высоте.
     Считается до генерации культей: тем нужны и клетка, и зоны. */
  let maxL = 0, maxR = 0, maxT = 0, maxB = 0;
  for (const g of got) {
    maxL = Math.max(maxL, g.img.left);
    maxR = Math.max(maxR, g.img.w - g.img.left);
    maxT = Math.max(maxT, g.img.top);
    maxB = Math.max(maxB, g.img.h - g.img.top);
  }
  const half = Math.max(maxL, maxR);
  const W = half * 2, H = maxT + maxB;

  // зоны попадания: по силуэту первого кадра ходьбы, если враг их не задал сам
  const walkImg = got.find(gg => gg.key === 'walk0');
  const autoParts = walkImg
    ? partsFromSilhouette(walkImg.img, W, H, half - walkImg.img.left, maxT - walkImg.img.top)
    : null;

  /* Кадры состояний тела — как в Brutal Doom: отдельная картинка на «без правой
     руки», «без левой», «без обеих», «на одной ноге». Пока это заготовки,
     сгенерированные из кадров ходьбы; их можно перерисовать поверх, движок
     возьмёт то, что лежит в листе. */
  if (autoParts) {
    /* Состояния делаем для всех ходовых кадров, а не только для ходьбы: в бою
       боец почти всё время в кадре боли или замаха, и если культю дорисовать
       только к ходьбе, отстреленной руки почти не видно. */
    const src = got.filter(gg => /^(walk[01]|pain|attack)$/.test(gg.key));
    const states = [
      ['NoArmR', [['armR', false]]],
      ['NoArmL', [['armL', true]]],
      ['NoArms', [['armR', false], ['armL', true]]],
      ['Hop', [['legL', true]]],
    ];
    for (const [suffix, cuts] of states) {
      for (const gg of src) {
        let img = gg.img;
        for (const [zoneName, fromLeft] of cuts) {
          const zone = autoParts[zoneName];
          if (!zone) continue;
          img = severed(img, W, H, half - gg.img.left, maxT - gg.img.top, zone, fromLeft);
        }
        got.push({ key: `${gg.key}${suffix}`, frame: gg.frame, rot: gg.rot, img, generated: true });
      }
    }
  }

  const cols = got.length;
  const sheet = new Uint8Array(cols * W * H * 4);
  got.forEach((g, i) => {
    const ox = i * W + half - g.img.left, oy = maxT - g.img.top;
    for (let y = 0; y < g.img.h; y++) for (let x = 0; x < g.img.w; x++) {
      const s = (y * g.img.w + x) * 4;
      if (!g.img.px[s + 3]) continue;
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= cols * W || dy >= H) continue;
      const d = (dy * cols * W + dx) * 4;
      sheet[d] = g.img.px[s]; sheet[d + 1] = g.img.px[s + 1]; sheet[d + 2] = g.img.px[s + 2]; sheet[d + 3] = 255;
    }
  });
  // всё про врага лежит в его собственной папке: лист, описание, разметка зон, вещи
  const dir = path.join(OUT, name);
  fs.mkdirSync(path.join(dir, 'drops'), { recursive: true });
  writePng(path.join(dir, 'sheet.png'), cols * W, H, sheet);

  /* ═══ описание ═══ */
  const frames = {}; got.forEach((g, i) => { frames[g.key] = i; });
  const walkKeys = got.filter(g => /^walk\d$/.test(g.key)).map(g => g.key);
  const atkKeys = got.filter(g => /^attack/.test(g.key)).map(g => g.key);
  const dieKeys = got.filter(g => /^die\d$/.test(g.key)).map(g => g.key);
  const anims = {
    idle: { frames: [walkKeys[0]] },
    walk: { frames: walkKeys, fps: Math.min(8, 2 + walkKeys.length) },
    attack: { frames: [atkKeys[0]] },
    pain: { frames: ['pain'] },
  };
  if (atkKeys.length > 1) anims.attack = { frames: atkKeys, fps: 6 };
  if (dieKeys.length) anims.die = { frames: dieKeys, fps: Math.max(8, dieKeys.length / .42) };
  /* Ходьба в состояниях «без руки» и «на одной ноге». Движок сам переключится на
     них, когда конечность отлетит, и перестанет вырезать её из кадра на лету.
     hop — штатное имя: с ним у бойца отстреливается нога, а не валит насмерть. */
  for (const suffix of ['NoArmR', 'NoArmL', 'NoArms', 'Hop']) {
    const wk = got.filter(g => /^walk[01]/.test(g.key) && g.key.endsWith(suffix)).map(g => g.key);
    // ходьба в этом состоянии: для ноги имя штатное — hop, движок ищет именно его
    if (wk.length) anims[suffix === 'Hop' ? 'hop' : `walk${suffix}`] = { frames: wk, fps: suffix === 'Hop' ? 4 : 6 };
    for (const base of ['pain', 'attack']) {
      const k = `${base}${suffix}`;
      if (got.some(g => g.key === k)) anims[k] = { frames: [k] };
    }
  }


  const def = {
    name, title: M.title, sheet: 'sheet.png',
    frameW: W, frameH: H, variants: 1,
    size: [+(W * S).toFixed(2), +(H * S).toFixed(2)],
    radius: M.radius,
    frames, anims,
    stats: {
      hp: M.hp, speed: M.speed, alertR: M.alertR, female: false,
      ...(M.armor ? { armor: M.armor } : {}),
      ...(M.melee ? { melee: M.melee } : {}),
      ...(M.ranged ? { ranged: M.ranged } : {}),
      ...(M.lunge ? { lunge: true } : {}),
      flank: M.flank, tactics: M.tactics,
    },
    ...(M.parts || autoParts ? { parts: { ...(autoParts || {}), ...(M.parts || {}) } } : {}),
    colors: { body: '#6a5a44', legs: '#4a3c2c', skin: '#b08a60', hair: '#2a2018' },
    /* head не задаём: рисованной головы для чужого монстра у нас нет, и лучше
       пусть отлетает череп, чем чужое лицо из другого набора. */
    gibs: M.gibs || 'male',
    /* Что остаётся после него: вещи ложатся рядом с телом, оружие можно подобрать.
       У чужого монстра в руках ничего нет — вписывается руками, см. docs/ENEMIES.md. */
    drop: M.drop || { items: [] },
    source: `WAD ${path.basename(wadPath)}, спрайты ${M.sprite}*`,
  };
  fs.writeFileSync(path.join(dir, 'enemy.json'), JSON.stringify(def, null, 2) + '\n');

  /* --zones: тот же лист, но поверх кадров нарисованы рамки зон попадания.
     Картинка нужна только чтобы посмотреть глазами, игрой она не читается. */
  if (process.argv.includes('--zones') && def.parts) {
    const dbg = sheet.slice();
    const COL = { head: [255, 200, 80], armL: [80, 160, 255], armR: [80, 160, 255], legL: [120, 255, 120], legR: [120, 255, 120] };
    const px = (x, y, c) => {
      if (x < 0 || y < 0 || x >= cols * W || y >= H) return;
      const o = (y * cols * W + x) * 4;
      dbg[o] = c[0]; dbg[o + 1] = c[1]; dbg[o + 2] = c[2]; dbg[o + 3] = 255;
    };
    for (let i = 0; i < cols; i++) for (const [k, r] of Object.entries(def.parts)) {
      if (!Array.isArray(r)) continue;
      const c = COL[k] || [255, 255, 255];
      const x0 = i * W + Math.round(r[0] * W), x1 = i * W + Math.round(r[2] * W);
      const y0 = Math.round(r[1] * H), y1 = Math.round(r[3] * H);
      for (let x = x0; x <= x1; x++) { px(x, y0, c); px(x, y1, c); }
      for (let y = y0; y <= y1; y++) { px(x0, y, c); px(x1, y, c); }
    }
    writePng(path.join(dir, 'zones.png'), cols * W, H, dbg);
  }

  console.log(`${name} (${M.sprite}): кадров ${cols}, клетка ${W}×${H} = ${def.size[0]}×${def.size[1]} м`);
  console.log(`  ходьба ${walkKeys.length}, атака ${atkKeys.length}, смерть ${dieKeys.length}; буквы в WAD: ${have}`);
  if (autoParts) console.log(`  зоны по силуэту: голова ${autoParts.head.join(',')}  рука ${autoParts.armR.join(',')}`);
  const gen = got.filter(gg => gg.generated).length;
  if (gen) console.log(`  кадров-заготовок «без конечности»: ${gen} (перерисуйте их поверх — движок возьмёт из листа)`);
  return name;
}

const names = only ? only.split(',').map(s => s.trim()).filter(Boolean) : Object.keys(MONSTERS);
const done = [];
for (const n of names) {
  const M = MONSTERS[n];
  if (!M) { console.warn(`${n}: такого монстра нет в таблице (есть: ${Object.keys(MONSTERS).join(', ')})`); continue; }
  const r = build(n, M);
  if (r) done.push(r);
}

if (done.length) {
  // список врагов: дописываем импортированных, ничего не теряя
  const idxFile = path.join(OUT, 'index.json');
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (e) { /* списка ещё нет */ }
  for (const n of done) if (!idx.some(it => it?.name === n)) idx.push({ name: n, title: MONSTERS[n].title });
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2) + '\n');
  console.log(`\nготово: ${done.join(', ')} → public/enemies/, вписаны в index.json`);
}
