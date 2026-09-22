/* Процедурные текстуры. Рисуются кодом на канвасе 64×64 и зашумляются —
   без зерна они выглядят как плоский вектор, а не как Doom. */
import * as THREE from 'three';

export const TS = 64;
export const TEX = {};        // name -> THREE.Texture
export const CANVAS = {};     // name -> canvas (для декалей и HUD)

const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b));
const pick = arr => arr[(Math.random() * arr.length) | 0];

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function grain(c, amt, alphaOnly = false) {
  const x = c.getContext('2d');
  const im = x.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (alphaOnly && d[i + 3] === 0) continue;
    const n = (Math.random() * 2 - 1) * amt;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  x.putImageData(im, 0, 0);
  return c;
}

/* Фильтрация. Вблизи текстура обязана оставаться пиксельной (magFilter = Nearest),
   а вот вдаль её нужно уменьшать по мипмапам с анизотропией — иначе пол и стены
   на бегу кипят рябью: на один пиксель экрана приходится десяток текселей,
   и какой из них выпадет, решает дрожание камеры. Это главная причина
   «мельтешения в глазах», а не низкий fps. */
export let ANISO = 1;
export function initTextureQuality(renderer) {
  ANISO = Math.max(1, Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1));
  for (const t of Object.values(TEX)) if (t.minFilter !== THREE.LinearFilter) { t.anisotropy = ANISO; t.needsUpdate = true; }
}
// общий набор параметров: пиксель вблизи, мипмапы вдаль
export function sharpFilter(t) {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = ANISO;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tex(name, c, opts = {}) {
  const t = sharpFilter(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  TEX[name] = t; CANVAS[name] = c;
  return t;
}

function px(name, fn, g = 14, size = TS) {
  const c = makeCanvas(size, size);
  fn(c.getContext('2d'), size);
  if (g) grain(c, g);
  return tex(name, c);
}

/* ─── кладка ─── */
function blocks(x, S, rows, cols, base, mortar, jitter = 10, shade = true) {
  x.fillStyle = mortar; x.fillRect(0, 0, S, S);
  const bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (S / cols / 2);
    for (let cI = -1; cI <= cols; cI++) {
      const bw = S / cols;
      const bx = cI * bw + off + 1, by = r * bh + 1;
      const [R, G, B] = base;
      const j = irnd(-jitter, jitter);
      x.fillStyle = `rgb(${R + j},${G + j},${B + j})`;
      x.fillRect(bx, by, bw - 2, bh - 2);
      if (shade) {
        x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(bx, by, bw - 2, 1);
        x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(bx, by + bh - 3, bw - 2, 1); x.fillRect(bx + bw - 3, by, 1, bh - 2);
      }
    }
  }
}

export function buildTextures() {
  // крепостной камень
  px('stone', (x, S) => {
    blocks(x, S, 4, 3, [118, 112, 104], '#3a3733', 12);
    x.fillStyle = 'rgba(40,60,30,.25)';
    for (let i = 0; i < 8; i++) x.fillRect(irnd(0, S), irnd(0, S), irnd(2, 6), irnd(1, 3));
  });
  // тёмный камень (внутри крепости)
  px('stoneDark', (x, S) => blocks(x, S, 4, 3, [82, 78, 74], '#2a2724', 10));
  // кирпич
  px('brick', (x, S) => blocks(x, S, 8, 4, [128, 58, 44], '#4a3430', 14));
  // старый городской кирпич, грязный
  px('brickCity', (x, S) => {
    blocks(x, S, 8, 4, [92, 60, 56], '#2e2624', 12);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, S - 12, S, 12);
  });
  // доски
  px('plank', (x, S) => {
    for (let i = 0; i < 4; i++) {
      const j = irnd(-14, 14);
      x.fillStyle = `rgb(${120 + j},${82 + j},${44 + j})`; x.fillRect(0, i * 16, S, 16);
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, i * 16 + 15, S, 1);
      x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(0, i * 16, S, 1);
      for (let k = 0; k < 3; k++) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(irnd(0, S), i * 16 + irnd(2, 13), irnd(6, 20), 1); }
      x.fillStyle = '#2b2118'; x.fillRect(irnd(2, 10), i * 16 + 7, 2, 2); x.fillRect(S - irnd(4, 12), i * 16 + 7, 2, 2);
    }
  });
  // вертикальные доски / дверь
  px('plankV', (x, S) => {
    for (let i = 0; i < 4; i++) {
      const j = irnd(-14, 14);
      x.fillStyle = `rgb(${104 + j},${70 + j},${38 + j})`; x.fillRect(i * 16, 0, 16, S);
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(i * 16 + 15, 0, 1, S);
    }
    x.fillStyle = '#3a3a3e'; x.fillRect(0, 10, S, 4); x.fillRect(0, S - 14, S, 4);
    x.fillStyle = '#1a1a1c'; for (let i = 0; i < 4; i++) { x.fillRect(i * 16 + 7, 11, 2, 2); x.fillRect(i * 16 + 7, S - 13, 2, 2); }
  });
  // частокол: брёвна
  px('palisade', (x, S) => {
    x.fillStyle = '#1c1611'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 6; i++) {
      const j = irnd(-12, 12);
      x.fillStyle = `rgb(${96 + j},${64 + j},${34 + j})`; x.fillRect(i * 11, 0, 10, S);
      x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(i * 11 + 2, 0, 2, S);
      x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(i * 11 + 8, 0, 2, S);
    }
  });
  // штукатурка дома с балками
  px('plaster', (x, S) => {
    x.fillStyle = '#c8b894'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(90,70,40,.25)';
    for (let i = 0; i < 20; i++) x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 5), irnd(1, 3));
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, S - 16, S, 16);
  }, 10);
  px('plasterBeam', (x, S) => {
    x.fillStyle = '#c8b894'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(90,70,40,.22)';
    for (let i = 0; i < 20; i++) x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 5), irnd(1, 3));
    x.fillStyle = '#4a3320'; x.fillRect(0, 0, 8, S); x.fillRect(S - 8, 0, 8, S); x.fillRect(0, 0, S, 6);
    x.fillStyle = '#5c4028'; x.fillRect(2, 0, 3, S); x.fillRect(S - 6, 0, 3, S);
  }, 10);
  // булыжник
  px('cobble', (x, S) => {
    x.fillStyle = '#2c2a26'; x.fillRect(0, 0, S, S);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const j = irnd(-16, 16);
      x.fillStyle = `rgb(${96 + j},${92 + j},${86 + j})`;
      x.fillRect(c * 8 + 1 + ((r % 2) * 3), r * 8 + 1, 6, 6);
    }
  });
  // земля
  px('dirt', (x, S) => {
    x.fillStyle = '#4a3a26'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) { x.fillStyle = pick(['#5a4830', '#3c2e1c', '#6a5636', '#2e2416']); x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 4), irnd(1, 3)); }
  }, 12);
  // грязь с травой
  px('grass', (x, S) => {
    x.fillStyle = '#3f4a22'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) { x.fillStyle = pick(['#546332', '#2e3818', '#4a3a26', '#5c6a34']); x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 3), irnd(1, 4)); }
    x.fillStyle = 'rgba(70,50,30,.5)'; x.fillRect(irnd(0, 30), irnd(0, 30), irnd(10, 30), irnd(6, 20));
  }, 12);
  // черепица
  px('roof', (x, S) => {
    x.fillStyle = '#4a2018'; x.fillRect(0, 0, S, S);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) {
      const j = irnd(-14, 14);
      x.fillStyle = `rgb(${132 + j},${58 + j},${40 + j})`;
      x.fillRect(c * 16 + ((r % 2) * 8) - 8, r * 8, 15, 7);
      x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(c * 16 + ((r % 2) * 8) - 8, r * 8 + 6, 15, 1);
    }
  });
  // солома
  px('hay', (x, S) => {
    x.fillStyle = '#9a7a2a'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 160; i++) { x.fillStyle = pick(['#c9a441', '#7a5c1c', '#e0be5a', '#5e4614']); x.fillRect(irnd(0, S), irnd(0, S), irnd(2, 9), 1); }
  }, 8);
  // белая плитка (ванная)
  px('tileWhite', (x, S) => {
    x.fillStyle = '#7f8a88'; x.fillRect(0, 0, S, S);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const j = irnd(-8, 8);
      x.fillStyle = `rgb(${214 + j},${222 + j},${216 + j})`; x.fillRect(c * 16 + 1, r * 16 + 1, 14, 14);
      x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(c * 16 + 1, r * 16 + 1, 14, 1);
    }
    x.fillStyle = 'rgba(60,80,60,.35)'; for (let i = 0; i < 6; i++) x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 3), irnd(1, 3));
  }, 6);
  // шахматный пол ванной
  px('tileChecker', (x, S) => {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      x.fillStyle = (r + c) % 2 ? '#d8dcd4' : '#20242a'; x.fillRect(c * 8, r * 8, 8, 8);
    }
  }, 8);
  // бетон
  px('concrete', (x, S) => {
    x.fillStyle = '#6a6c6a'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 31, S, 2); x.fillRect(31, 0, 2, S);
    for (let i = 0; i < 20; i++) { x.fillStyle = 'rgba(0,0,0,.2)'; x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 6), irnd(1, 2)); }
  }, 14);
  // стена здания с окнами: часть светится
  px('windows', (x, S) => {
    x.fillStyle = '#3c3e44'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(0, 60, S, 4);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const lit = Math.random() < .45;
      x.fillStyle = lit ? pick(['#ffd27a', '#ffb060', '#d0e8ff', '#ff6a9a']) : '#12141a';
      x.fillRect(6 + c * 20, 6 + r * 30, 12, 18);
      x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(6 + c * 20 + 5, 6 + r * 30, 2, 18); x.fillRect(6 + c * 20, 6 + r * 30 + 8, 12, 2);
    }
  }, 8);
  // асфальт
  px('asphalt', (x, S) => {
    x.fillStyle = '#2a2b2e'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) { x.fillStyle = pick(['#34363a', '#202124', '#3c3e42']); x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 3), irnd(1, 3)); }
  }, 10);
  px('asphaltLine', (x, S) => {
    x.fillStyle = '#2a2b2e'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) { x.fillStyle = pick(['#34363a', '#202124']); x.fillRect(irnd(0, S), irnd(0, S), irnd(1, 3), irnd(1, 3)); }
    x.fillStyle = '#c9b25a'; x.fillRect(29, 4, 6, 40);
  }, 10);
  // тротуар
  px('sidewalk', (x, S) => {
    x.fillStyle = '#4a4c4e'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#5c5e60'; x.fillRect(1, 1, 30, 30); x.fillRect(33, 1, 30, 30); x.fillRect(1, 33, 30, 30); x.fillRect(33, 33, 30, 30);
  }, 12);
  // металл
  px('metal', (x, S) => {
    x.fillStyle = '#4e5a60'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(0, 0, S, 3);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(0, S - 4, S, 4);
    x.fillStyle = '#2c3438'; for (let i = 0; i < 4; i++) { x.fillRect(6 + i * 16, 8, 3, 3); x.fillRect(6 + i * 16, S - 11, 3, 3); }
    x.fillStyle = 'rgba(120,60,20,.4)'; x.fillRect(irnd(0, 40), irnd(0, 40), irnd(6, 20), irnd(6, 20));
  }, 10);
  px('metalRed', (x, S) => {
    x.fillStyle = '#7a1c1c'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(0, 0, S, 3);
    x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(0, S - 5, S, 5);
  }, 10);
  // бельё / простынь
  px('linen', (x, S) => {
    x.fillStyle = '#e6e2d6'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(0,0,0,.08)';
    for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(irnd(0, S), irnd(0, S)); x.lineTo(irnd(0, S), irnd(0, S)); x.strokeStyle = 'rgba(0,0,0,.1)'; x.lineWidth = 2; x.stroke(); }
  }, 5);
  // красная ткань (знамёна)
  px('cloth', (x, S) => {
    x.fillStyle = '#7a1418'; x.fillRect(0, 0, S, S);
    x.fillStyle = 'rgba(0,0,0,.2)'; for (let i = 0; i < 4; i++) x.fillRect(i * 16 + 6, 0, 4, S);
    x.fillStyle = '#d8b040'; x.fillRect(24, 20, 16, 4); x.fillRect(30, 12, 4, 20);
  }, 8);
  // тёмная вода (портал) — светится
  /* Вода. Прежняя была просто тёмной заливкой в редкую полоску — на полу
     она читалась как грязь. Воду делает не цвет, а блик: волна, у которой
     есть светлая гребёнка и тень под ней. Поэтому здесь три слоя — глубина,
     ряды волн со светлым верхом и редкие яркие искры на гребнях. Текстура
     ещё и ползёт (см. World.update), так что рисунок волн обязан быть
     бесшовным по вертикали: полосы идут ровными рядами. */
  px('water', (x, S) => {
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#0b3a3c'); g.addColorStop(.5, '#0e4a48'); g.addColorStop(1, '#0b3a3c');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    // рябь: волна = тёмная тень плюс светлый гребень над ней
    for (let r = 0; r < 8; r++) {
      const y = r * (S / 8) + rnd(-1, 1);
      for (let i = 0; i < 5; i++) {
        const w = rnd(S * .12, S * .4), px0 = rnd(-4, S);
        x.fillStyle = 'rgba(4,26,30,.5)'; x.fillRect(px0, y + 2, w, 2);
        x.fillStyle = 'rgba(96,216,200,.45)'; x.fillRect(px0, y, w, 1.5);
      }
    }
    // блики на гребнях: единственное, что по-настоящему выдаёт воду в темноте
    for (let i = 0; i < 26; i++) {
      const w = rnd(2, 9);
      x.fillStyle = 'rgba(190,255,244,.55)'; x.fillRect(rnd(0, S), rnd(0, S), w, 1);
    }
  }, 4, 64);
  /* Падающая вода — своя текстура: у лежачей воды рисунок поперечный,
     а у падающей он обязан быть продольным, иначе полотно водопада читается
     как занавеска. Полосы тянутся сверху вниз и ползут быстрее лужи. */
  px('waterfall', (x, S) => {
    x.fillStyle = '#0d4446'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 46; i++) {
      const w = rnd(1, 4), h = rnd(S * .25, S), y = rnd(-S * .2, S);
      x.fillStyle = pick(['rgba(120,226,214,.5)', 'rgba(70,170,168,.5)', 'rgba(210,255,250,.6)']);
      x.fillRect(rnd(0, S), y, w, h);
      x.fillStyle = 'rgba(6,30,34,.45)'; x.fillRect(rnd(0, S), rnd(-S * .2, S), rnd(1, 3), rnd(S * .3, S));
    }
    // пена вверху: там, где вода срывается с кромки
    x.fillStyle = 'rgba(226,255,252,.65)'; x.fillRect(0, 0, S, 3);
  }, 4, 64);
  px('dark', (x, S) => { x.fillStyle = '#0a0a0c'; x.fillRect(0, 0, S, S); }, 4);
  /* Скала пещеры и земля под ногами.
     Обе рисуются на 128 px и кладутся по 4 м на плитку — столько же текселей
     на метр, сколько у обычной стены, но повтор наступает вдвое реже.
     Главное здесь — бесшовность: каждый ком, трещина и камешек рисуется
     девять раз со сдвигом на плитку, поэтому то, что вылезло за край,
     возвращается с другой стороны. Раньше края обрезались, и на стыке плиток
     шла ровная сетка — именно она и читалась как «повторяется».
     И никаких крупных ярких пятен: заметная деталь сразу выдаёт период. */
  const wrapped = (x, S) => fn => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { x.save(); x.translate(a * S, b * S); fn(); x.restore(); } };
  // ком породы: не круг, а рваный многоугольник — у круга слишком узнаваемый силуэт
  const lump = (x, tile, cx, cy, r, col) => tile(() => {
    x.fillStyle = col; x.beginPath();
    const n = irnd(6, 10);
    for (let i = 0; i <= n; i++) {
      const a = i / n * 6.283, rr = r * rnd(.62, 1.2);
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath(); x.fill();
  });
  /* Порода и грунт рисуются одним генератором с разной палитрой: пещера
     не должна быть сплошь одного цвета от входа до выхода, но и разнобоя
     из чужих текстур в ней быть не может — зоны обязаны выглядеть одной
     породой при разном освещении и составе. Отсюда три набора:
     бурый (обычный камень), серый (известняк) и чёрный (выжженный грунт). */
  const rockTex = (name, P) => px(name, (x, S) => {
    const tile = wrapped(x, S);
    x.fillStyle = P.base; x.fillRect(0, 0, S, S);
    // три масштаба комьев: крупные едва отличаются по тону, мелкие держат зерно
    for (let i = 0; i < 10; i++) lump(x, tile, rnd(0, S), rnd(0, S), rnd(26, 46), pick(P.big));
    for (let i = 0; i < 26; i++) lump(x, tile, rnd(0, S), rnd(0, S), rnd(11, 24), pick(P.mid));
    for (let i = 0; i < 60; i++) lump(x, tile, rnd(0, S), rnd(0, S), rnd(3.5, 9), pick(P.small));
    // трещины
    x.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const sx = rnd(0, S), sy = rnd(0, S), lw = rnd(1, 2.6), seg = irnd(3, 6);
      const pts = [[sx, sy]];
      for (let k = 0; k < seg; k++) pts.push([pts[k][0] + rnd(-20, 20), pts[k][1] + rnd(-20, 20)]);
      tile(() => {
        x.strokeStyle = P.crack; x.lineWidth = lw; x.beginPath();
        pts.forEach(([a, b], k) => k ? x.lineTo(a, b) : x.moveTo(a, b));
        x.stroke();
      });
    }
    // блики на сколах — мелкие и редкие, чтобы не стать «меткой» плитки
    for (let i = 0; i < 46; i++) {
      const sx = rnd(0, S), sy = rnd(0, S), w = rnd(2, 7), h = rnd(1, 2.5), a = rnd(0, 3.14);
      tile(() => { x.save(); x.translate(sx, sy); x.rotate(a); x.fillStyle = P.spark; x.fillRect(-w / 2, -h / 2, w, h); x.restore(); });
    }
  }, 16, 128);
  // земля пещеры: сухая глина с щебнем, тоже бесшовная и на 4 м
  const floorTex = (name, P) => px(name, (x, S) => {
    const tile = wrapped(x, S);
    x.fillStyle = P.base; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 12; i++) lump(x, tile, rnd(0, S), rnd(0, S), rnd(20, 40), pick(P.big));
    for (let i = 0; i < 34; i++) lump(x, tile, rnd(0, S), rnd(0, S), rnd(7, 18), pick(P.mid));
    // щебень
    for (let i = 0; i < 120; i++) lump(x, tile, rnd(0, S), rnd(0, S), rnd(1.2, 4), pick(P.small));
    for (let i = 0; i < 40; i++) {
      const sx = rnd(0, S), sy = rnd(0, S), w = rnd(2, 6);
      tile(() => { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(sx, sy, w, rnd(1, 2)); });
    }
  }, 14, 128);

  rockTex('caveRock', {
    base: '#463322', crack: 'rgba(14,9,4,.55)', spark: 'rgba(196,164,118,.11)',
    big: ['#4c3826', '#42301f', '#503a27', '#3e2d1e'],
    mid: ['#55402b', '#3a2a1b', '#5c4630', '#332415', '#4a3624'],
    small: ['#604a32', '#302213', '#6b5337', '#4a3624', '#382718'],
  });
  rockTex('caveRockGrey', {
    base: '#3c3c40', crack: 'rgba(8,8,10,.55)', spark: 'rgba(196,204,216,.12)',
    big: ['#424248', '#38383c', '#48484e', '#333338'],
    mid: ['#4c4c52', '#313136', '#54545c', '#2a2a2e', '#434349'],
    small: ['#5a5a62', '#282a2e', '#66666f', '#434349', '#35353a'],
  });
  rockTex('caveRockBlack', {
    base: '#1c1a18', crack: 'rgba(0,0,0,.7)', spark: 'rgba(255,150,70,.10)',
    big: ['#221f1c', '#171514', '#262320', '#141312'],
    mid: ['#2a2724', '#151312', '#302c28', '#0f0e0d', '#232019'],
    small: ['#363029', '#111010', '#3d362d', '#232019', '#1a1816'],
  });
  floorTex('caveFloor', {
    base: '#3c2e1e',
    big: ['#443320', '#382a1b', '#4a3826'],
    mid: ['#4e3b26', '#332616', '#453422'],
    small: ['#5c4730', '#2a1e12', '#6a5439', '#3e2e1c'],
  });
  floorTex('caveFloorGrey', {
    base: '#333338',
    big: ['#3a3a40', '#2e2e33', '#414147'],
    mid: ['#45454c', '#2a2a2f', '#3c3c42'],
    small: ['#525259', '#232326', '#5e5e66', '#35353a'],
  });
  floorTex('caveFloorBlack', {
    base: '#161514',
    big: ['#1b1a18', '#121110', '#201e1b'],
    mid: ['#232120', '#0f0e0e', '#1d1b19'],
    small: ['#2e2a26', '#0c0b0b', '#3a3229', '#1a1817'],
  });
  /* Пачка денег: то, что сыплется из убитых. Отдельная текстура, а не спрайт —
     деньги в пещере это вращающийся объёмный блок (как в GTA), и на его грани
     нужна именно пачка купюр с банковской лентой. */
  px('cash', (x, S) => {
    x.fillStyle = '#2a4a2c'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 5; i++) { x.fillStyle = i % 2 ? '#3e6b42' : '#355c38'; x.fillRect(0, i * (S / 5), S, S / 5 - 1); }
    x.fillStyle = '#8fc08f'; x.fillRect(4, 4, S - 8, 2); x.fillRect(4, S - 6, S - 8, 2);
    x.fillStyle = '#d8c060'; x.fillRect(S * .38, 0, S * .24, S);          // банковская лента
    x.fillStyle = '#7a6420'; x.fillRect(S * .38, 0, 2, S); x.fillRect(S * .6, 0, 2, S);
    x.fillStyle = '#b8e0b8'; x.beginPath(); x.arc(S * .2, S * .5, S * .09, 0, 7); x.fill();
    x.fillStyle = '#2a4a2c'; x.beginPath(); x.arc(S * .2, S * .5, S * .05, 0, 7); x.fill();
  }, 6, 32);

  px('glass', (x, S) => { x.fillStyle = '#8ab0c0'; x.fillRect(0, 0, S, S); x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(4, 4, 6, S - 8); }, 4);
  // ковёр в спальне
  px('carpet', (x, S) => {
    x.fillStyle = '#5a1c22'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#7a2c30'; x.fillRect(6, 6, S - 12, S - 12);
    x.fillStyle = '#c8a040'; x.fillRect(10, 10, S - 20, 2); x.fillRect(10, S - 12, S - 20, 2); x.fillRect(10, 10, 2, S - 20); x.fillRect(S - 12, 10, 2, S - 20);
    x.fillStyle = '#5a1c22'; x.fillRect(24, 24, 16, 16);
  }, 8);
  // неон-вывески (эмиссия)
  neonSign('neon1', '#ff2a7a', ['▲▼▲', 'ЖЕНЫ']);
  neonSign('neon2', '#3af0ff', ['ВЛАСТЬ', '♀♀♀']);
  neonSign('neon3', '#ffe23a', ['♀ ОРУЖИЕ']);
  neonSign('neon4', '#a03aff', ['МУЖЧИНАМ', 'ВХОД →']);

  // ── в духе Doom 1 ──
  px('techBase', (x, S) => {   // STARTAN: бежевые панели с тёмными швами и заклёпками
    x.fillStyle = '#8a7a5a'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#94836a' : '#7f6f52'; x.fillRect(0, i * 16, S, 16); x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, i * 16 + 15, S, 1); }
    x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(31, 0, 2, S);
    x.fillStyle = '#3a3020'; for (let i = 0; i < 4; i++) { x.fillRect(4, i * 16 + 6, 3, 3); x.fillRect(S - 7, i * 16 + 6, 3, 3); }
  }, 10);
  px('techBrown', (x, S) => {  // BROWN1: коричневые плиты
    blocks(x, S, 2, 2, [110, 78, 48], '#3a2a18', 10);
    x.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 12; i++) x.fillRect(irnd(0, S), irnd(0, S), irnd(2, 8), 2);
  });
  px('techGray', (x, S) => {   // GRAY: серые панели
    blocks(x, S, 2, 1, [128, 128, 132], '#404044', 8);
    x.fillStyle = 'rgba(255,255,255,.15)'; x.fillRect(2, 2, S - 4, 2);
  });
  px('techLight', (x, S) => {  // LITE: полоса ламп
    x.fillStyle = '#6a6a6e'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#e8f0ff'; x.fillRect(4, 26, S - 8, 12); x.fillStyle = '#ffffff'; x.fillRect(6, 28, S - 12, 4);
    x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(0, 24, S, 2); x.fillRect(0, 38, S, 2);
  }, 6);
  px('computer', (x, S) => {   // COMPTALL: экраны и лампочки
    x.fillStyle = '#20242a'; x.fillRect(0, 0, S, S);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      x.fillStyle = pick(['#103828', '#0a2a50', '#301010']); x.fillRect(c * 32 + 4, r * 32 + 4, 24, 16);
      x.fillStyle = pick(['#40ff80', '#40c0ff', '#ff6040']); for (let i = 0; i < 6; i++) x.fillRect(c * 32 + 6 + irnd(0, 20), r * 32 + 6 + irnd(0, 12), irnd(1, 6), 1);
      for (let i = 0; i < 6; i++) { x.fillStyle = pick(['#ff3030', '#30ff30', '#ffd030', '#404040']); x.fillRect(c * 32 + 6 + i * 4, r * 32 + 24, 2, 2); }
    }
  }, 6);
  px('nukage', (x, S) => {     // NUKAGE: зелёная кислота
    x.fillStyle = '#2a6a18'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) { x.fillStyle = pick(['#48a020', '#1c5010', '#70d030', '#38801c']); x.beginPath(); x.arc(irnd(0, S), irnd(0, S), rnd(2, 7), 0, 7); x.fill(); }
  }, 8);
  px('doomFloor', (x, S) => {  // FLOOR4_8: серые плиты с зазорами
    x.fillStyle = '#404040'; x.fillRect(0, 0, S, S);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { const j = irnd(-10, 10); x.fillStyle = `rgb(${120 + j},${116 + j},${108 + j})`; x.fillRect(c * 32 + 2, r * 32 + 2, 28, 28); }
  }, 12);
  px('doomCeil', (x, S) => {   // CEIL: тёмные панели с лампой
    x.fillStyle = '#4a4a50'; x.fillRect(0, 0, S, S); x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(0, 31, S, 2); x.fillRect(31, 0, 2, S);
    x.fillStyle = '#ffffe0'; x.fillRect(24, 24, 16, 16);
  }, 8);
  px('doorTex', (x, S) => {    // BIGDOOR: металлическая дверь с вертикальными полосами
    x.fillStyle = '#5a5048'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#6a6058' : '#4a4038'; x.fillRect(i * 16, 0, 16, S); x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(i * 16 + 15, 0, 1, S); }
    x.fillStyle = '#c8a040'; x.fillRect(4, 28, S - 8, 8); x.fillStyle = '#1a1a1a'; x.fillRect(6, 30, S - 12, 4);
  }, 8);
  px('marble', (x, S) => {     // MARBLE: зелёный мрамор
    x.fillStyle = '#3a5a3a'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) { x.strokeStyle = pick(['#5a8a5a', '#2a3a2a', '#7aa07a']); x.lineWidth = rnd(1, 2); x.beginPath(); x.moveTo(irnd(0, S), irnd(0, S)); x.lineTo(irnd(0, S), irnd(0, S)); x.stroke(); }
  }, 8);
  px('exitSign', (x, S) => {   // EXIT
    x.fillStyle = '#301010'; x.fillRect(0, 0, S, S);
    x.font = 'bold 26px Impact, Arial Narrow, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#ff3030'; x.fillText('EXIT', 32, 32);
  }, 4);
  px('switchTex', (x, S) => {  // SW1: переключатель
    x.fillStyle = '#6a6058'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#2a2a2a'; x.fillRect(20, 14, 24, 36); x.fillStyle = '#c03030'; x.fillRect(26, 20, 12, 10); x.fillStyle = '#30c030'; x.fillRect(26, 34, 12, 10);
  }, 6);

  buildDecals();
  buildSky();
}

/* ─── свои текстуры: public/textures/index.json + PNG, а также сохранённые в браузере ─── */
export const CUSTOM_TEX = [];
export async function loadCustomTextures(base = './textures/') {
  const list = [];
  try { const r = await fetch(`${base}index.json`, { cache: 'no-cache' }); if (r.ok) list.push(...(await r.json()).map(it => ({ ...it, src: `${base}${it.file || it.name + '.png'}` }))); } catch (e) {}
  try { for (const it of JSON.parse(localStorage.getItem('knight.textures') || '[]')) list.push(it); } catch (e) {}
  await Promise.all(list.map(it => new Promise(res => {
    const img = new Image();
    img.onload = () => { registerTexture(it.name, img, it); res(); };
    img.onerror = () => { console.warn('текстура не загрузилась', it.name); res(); };
    img.src = it.src;
  })));
  return CUSTOM_TEX;
}
// зарегистрировать картинку как текстуру/спрайт под именем
export function registerTexture(name, img, it = {}) {
  const c = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  const t = tex(name, c, { clamp: !!it.sprite });
  if (it.sprite) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (!CUSTOM_TEX.find(x => x.name === name)) CUSTOM_TEX.push({ name, sprite: !!it.sprite, w: c.width, h: c.height });
  return t;
}
export function saveTextureLocal(name, dataURL, sprite) {
  const list = JSON.parse(localStorage.getItem('knight.textures') || '[]').filter(x => x.name !== name);
  list.push({ name, src: dataURL, sprite: !!sprite });
  localStorage.setItem('knight.textures', JSON.stringify(list));
}

function neonSign(name, color, lines) {
  const c = makeCanvas(128, 64);
  const x = c.getContext('2d');
  x.fillStyle = '#0c0c10'; x.fillRect(0, 0, 128, 64);
  x.fillStyle = '#1c1c22'; x.fillRect(2, 2, 124, 60);
  x.font = 'bold 22px Impact, Arial Narrow, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = color; x.shadowBlur = 10; x.fillStyle = color;
  lines.forEach((l, i) => x.fillText(l, 64, 32 + (i - (lines.length - 1) / 2) * 26));
  x.shadowBlur = 0; x.fillStyle = '#fff'; x.globalAlpha = .55;
  lines.forEach((l, i) => x.fillText(l, 64, 32 + (i - (lines.length - 1) / 2) * 26));
  x.globalAlpha = 1;
  tex(name, c, { clamp: true });
}

/* ─── декали крови ─── */
export const BLOOD = [];
export const BLOODWALL = [];
function buildDecals() {
  for (let v = 0; v < 6; v++) {
    const c = makeCanvas(64, 64);
    const x = c.getContext('2d');
    const n = 14 + irnd(0, 16);
    for (let i = 0; i < n; i++) {
      const r = rnd(2, v < 3 ? 12 : 7);
      const a = Math.random() * 6.28, d = Math.random() * (22 - r);
      x.fillStyle = pick(['#6a0408', '#8c0a0c', '#5a0206', '#a01010']);
      x.beginPath(); x.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, r, 0, 7); x.fill();
    }
    for (let i = 0; i < 12; i++) { x.fillStyle = '#7a0608'; x.fillRect(irnd(0, 64), irnd(0, 64), irnd(1, 3), irnd(1, 3)); }
    pixelate(c);
    BLOOD.push(tex('blood' + v, c, { clamp: true }));
  }
  // лужа: круглая, тёмная, для трупов
  {
    const c = makeCanvas(64, 64);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0, '#5a0206'); g.addColorStop(.7, '#6e0408'); g.addColorStop(1, 'rgba(90,2,6,0)');
    x.fillStyle = g; x.beginPath(); x.ellipse(32, 32, 30, 24, 0, 0, 7); x.fill();
    for (let i = 0; i < 8; i++) { x.fillStyle = '#5a0206'; x.beginPath(); x.arc(32 + rnd(-24, 24), 32 + rnd(-18, 18), rnd(3, 8), 0, 7); x.fill(); }
    pixelate(c, 2);
    tex('pool', c, { clamp: true });
  }
  // брызги на стену: с потёками вниз
  for (let v = 0; v < 4; v++) {
    const c = makeCanvas(64, 64);
    const x = c.getContext('2d');
    for (let i = 0; i < 12; i++) {
      const r = rnd(2, 8), cx = 32 + rnd(-18, 18), cy = 20 + rnd(-12, 12);
      x.fillStyle = pick(['#6a0408', '#8c0a0c', '#5a0206']);
      x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
      if (Math.random() < .6) x.fillRect(cx - 1, cy, 2, rnd(8, 36));
    }
    pixelate(c);
    BLOODWALL.push(tex('bloodWall' + v, c, { clamp: true }));
  }
  // пулевая отметина
  {
    const c = makeCanvas(16, 16);
    const x = c.getContext('2d');
    x.fillStyle = '#111'; x.beginPath(); x.arc(8, 8, 4, 0, 7); x.fill();
    x.fillStyle = 'rgba(0,0,0,.4)'; x.beginPath(); x.arc(8, 8, 7, 0, 7); x.fill();
    tex('hole', c, { clamp: true });
  }
  // пролитое вино
  {
    const c = makeCanvas(64, 64);
    const x = c.getContext('2d');
    x.fillStyle = '#4a0a22';
    x.beginPath(); x.ellipse(30, 34, 26, 18, .3, 0, 7); x.fill();
    x.beginPath(); x.ellipse(50, 22, 8, 6, 0, 0, 7); x.fill();
    tex('wine', c, { clamp: true });
  }
  // пламя: три кадра
  for (let f = 0; f < 3; f++) {
    const c = makeCanvas(32, 48);
    const x = c.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const w = (1 - t) * 13 + 2;
      x.fillStyle = t < .3 ? '#ff4a10' : t < .6 ? '#ff9a20' : t < .85 ? '#ffe060' : '#fff8c0';
      const cx = 16 + Math.sin(t * 9 + f * 2.1) * 5 * t;
      x.fillRect(cx - w / 2, 46 - t * 44 + rnd(-2, 2), w, 4);
    }
    x.fillStyle = '#ff3000'; x.globalAlpha = .6; x.fillRect(4, 40, 24, 8); x.globalAlpha = 1;
    tex('fire' + f, c, { clamp: true });
  }
  // дульная вспышка
  {
    const c = makeCanvas(32, 32);
    const x = c.getContext('2d');
    x.fillStyle = '#ffb040'; x.beginPath(); x.arc(16, 16, 12, 0, 7); x.fill();
    x.fillStyle = '#fff6c0'; x.beginPath(); x.arc(16, 16, 6, 0, 7); x.fill();
    tex('flash', c, { clamp: true });
  }
  // светящийся круг (для факела/лампы)
  {
    const c = makeCanvas(32, 32);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 1, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(.4, 'rgba(255,200,120,.6)'); g.addColorStop(1, 'rgba(255,160,60,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    tex('glow', c, { clamp: true });
  }
}

function pixelate(c, k = 2) {
  const x = c.getContext('2d');
  const w = c.width / k, h = c.height / k;
  const tmp = makeCanvas(w, h);
  const tx = tmp.getContext('2d');
  tx.imageSmoothingEnabled = false;
  tx.drawImage(c, 0, 0, w, h);
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(tmp, 0, 0, c.width, c.height);
}

/* ─── небо: вертикальный градиент ─── */
function buildSky() {
  const mk = (name, stops) => {
    const c = makeCanvas(4, 256);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    stops.forEach(([p, col]) => g.addColorStop(p, col));
    x.fillStyle = g; x.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    TEX[name] = t;
  };
  // закат над полем боя: дым и огонь
  mk('skyDusk', [[0, '#1a0c14'], [.45, '#3a1420'], [.62, '#7a2a1c'], [.72, '#c8602a'], [.78, '#3a1a14'], [1, '#1a0c0a']]);
  // ночь над городом
  mk('skyCity', [[0, '#04040a'], [.55, '#0a0a1c'], [.7, '#1c1030'], [.78, '#3a1848'], [1, '#0a0a10']]);
  // своды склепа: мертвенная бирюза у горизонта, выше — чернота
  mk('skyCrypt', [[0, '#02070a'], [.5, '#051016'], [.72, '#0d3a42'], [.8, '#1a6a72'], [.88, '#08181e'], [1, '#02070a']]);
  // лавовые залы: зарево снизу
  mk('skyForge', [[0, '#0a0302'], [.45, '#1a0604'], [.68, '#5a1406'], [.8, '#c04a10'], [.9, '#2a0a04'], [1, '#0a0302']]);
}
