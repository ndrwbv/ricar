/* Спрайты персонажей, гибсов, трупов и предметов. Рисуются кодом.
   Плотность ~62 px/м против 32 px/м у текстур стен: персонажи заметно чётче фона. */
import * as THREE from 'three';
import { makeCanvas, sharpFilter } from './textures.js';

export const SPR = {};       // name -> { tex, w, h, aspect } — то, что рисует игра
/* Отдельный реестр процедурных спрайтов. loadEnemyDefs() кладёт в SPR нарезку из
   public/enemies/*.png поверх процедурных, поэтому экспорт листов (buildSheet) обязан
   брать картинки отсюда — иначе он пересохраняет уже загруженный PNG сам в себя
   и при смене размера кадра выдаёт кашу из съехавших кадров. */
export const PROC = {};
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b));
const pick = arr => arr[(Math.random() * arr.length) | 0];
// затемнить/осветлить hex-цвет: рукава делаем темнее корпуса, иначе широкое тело
// сливается в одну плиту и рук не видно
const shade = (hex, k) => '#' + [1, 3, 5].map(i => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');

function toTex(c) {
  const t = sharpFilter(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function reg(name, c) {
  SPR[name] = PROC[name] = { tex: toTex(c), canvas: c, w: c.width, h: c.height };
  return SPR[name];
}

// прямоугольник с зерном: чтобы одежда не была плоской заливкой
function fr(x, X, Y, W, H, col, g = 0) {
  x.fillStyle = col; x.fillRect(X, Y, W, H);
  if (g) {
    for (let i = 0; i < (W * H) / 6; i++) {
      x.fillStyle = Math.random() < .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.08)';
      x.fillRect(X + irnd(0, W), Y + irnd(0, H), 1, 1);
    }
  }
}
function line(x, x0, y0, x1, y1, w, col) {
  x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'butt';
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
}
function bloodSplotches(x, X, Y, W, H, n) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = pick(['#7a0408', '#9a0a0c', '#5a0206']);
    x.beginPath(); x.arc(X + rnd(0, W), Y + rnd(0, H), rnd(1.5, 4), 0, 7); x.fill();
  }
}
// фонтан из шеи для безголового кадра
function neckSpurt(x, cx, cy) {
  x.fillStyle = '#8a0608'; x.fillRect(cx - 5, cy, 10, 5);
  x.fillStyle = '#c01014';
  for (let i = 0; i < 14; i++) { x.fillRect(cx + rnd(-8, 8), cy - rnd(2, 26), rnd(1, 3), rnd(2, 6)); }
  x.fillStyle = '#e02020'; x.fillRect(cx - 2, cy - 18, 3, 16); x.fillRect(cx + 2, cy - 12, 2, 12);
}

/* ═══════════ бумажная кукла ═══════════
   cfg: цвета и предметы; pose:
     'walk0' | 'walk1' | 'idle'  — ходьба и стойка
     'attack' | 'shoot'          — замах / выстрел
     'pain' | 'headless'         — попадание и обезглавленный
     'crouch'                    — присел в укрытии (ниже, попасть труднее)
     'surrender'                 — руки вверх (сдаётся или притворяется)
     'knife'                     — удар ножом из положения «руки вверх»
     'hop0' | 'hop1'             — скачет на одной ноге: вторую отстрелили
     'crawl0' | 'crawl1'         — ползёт: обеих ног нет
     'dead' | 'deadHeadless'     — труп: лежит грудой, спрайт всегда лицом к камере */
function humanoid(cfg, pose) {
  const W = cfg.W || 128, H = cfg.H || 176;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const cx = W / 2;
  const walk = pose === 'walk0' ? 1 : pose === 'walk1' ? -1 : 0;
  const pain = pose === 'pain';
  const headless = pose === 'headless';
  const crouch = pose === 'crouch';
  const surrender = pose === 'surrender';
  const knife = pose === 'knife';
  const hop = pose === 'hop0' || pose === 'hop1';
  const crawl = pose === 'crawl0' || pose === 'crawl1';
  const attack = pose === 'attack' || pose === 'shoot';
  if (crawl) { drawCrawl(x, cfg, pose === 'crawl1', W, H); outline(c); return c; }
  if (pose === 'dead' || pose === 'deadHeadless') { drawDead(x, cfg, pose === 'deadHeadless', W, H); outline(c); return c; }
  const lean = pain ? 4 : (pose === 'hop1' ? 5 : hop ? -3 : 0);
  const feet = H - 2;
  // присев, персонаж складывается: бёдра и плечи ниже, ноги короче
  const hipY = feet - Math.round(H * (crouch ? .20 : .38));
  const shoulderY = hipY - Math.round(H * (crouch ? .25 : .30));
  const headR = Math.round(H * .08);
  const headY = shoulderY - headR - 2;

  // ноги
  const legW = Math.round(W * .18);
  if (hop) {
    /* Одна нога: стоит по центру, вторая — короткая культя. hop1 — фаза в воздухе:
       опорная нога поджата, всё тело выше. */
    const air = pose === 'hop1';
    const lift = air ? Math.round(H * .07) : 0;
    const legTop = hipY - lift, legBot = feet - lift;
    fr(x, cx - legW / 2 - 2, legTop, legW, legBot - legTop, cfg.legs, 1);
    fr(x, cx - legW / 2 - 3, legBot - 8, legW + 2, 8, cfg.boots);
    // культя второй ноги
    const stumpX = cx + legW / 2 + 1, stumpH = Math.round(H * (air ? .09 : .11));
    fr(x, stumpX, hipY - lift, legW - 4, stumpH, cfg.legs, 1);
    x.fillStyle = '#7a0408'; x.fillRect(stumpX, hipY - lift + stumpH - 4, legW - 4, 5);
    x.fillStyle = '#c01014'; x.fillRect(stumpX + 1, hipY - lift + stumpH - 3, legW - 7, 3);
    for (let i = 0; i < 7; i++) { x.fillStyle = '#9a0a0c'; x.fillRect(stumpX + rnd(-2, legW - 4), hipY - lift + stumpH + rnd(0, 22), 2, 3); }
  } else {
    const lLeg = cx - legW - 3 + (walk * 4), rLeg = cx + 3 - (walk * 4);
    fr(x, lLeg, hipY, legW, feet - hipY, cfg.legs, 1);
    fr(x, rLeg, hipY, legW, feet - hipY, cfg.legs, 1);
    // сапоги / обувь
    fr(x, lLeg - 1, feet - 8, legW + 2 + (walk > 0 ? 3 : 0), 8, cfg.boots);
    fr(x, rLeg - 1, feet - 8, legW + 2 + (walk < 0 ? 3 : 0), 8, cfg.boots);
  }
  // торс
  const tw = Math.round(W * .50);
  fr(x, cx - tw / 2 + lean, shoulderY, tw, hipY - shoulderY + 2, cfg.body, 1);
  // плечи: полоса чуть шире торса — силуэт читается широким даже в тумане
  fr(x, cx - tw / 2 - 4 + lean, shoulderY, tw + 8, Math.round(H * .055), cfg.sleeve, 1);
  x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(cx - tw / 2 - 4 + lean, shoulderY + Math.round(H * .055) - 2, tw + 8, 2);
  if (cfg.bodyDetail) cfg.bodyDetail(x, cx + lean, shoulderY, tw, hipY - shoulderY);
  // пояс
  fr(x, cx - tw / 2 + lean, hipY - 5, tw, 4, cfg.belt);
  // боковая тень на торсе: широкое тело иначе читается плоской плитой,
  // а в позах «боль» и «без головы» руки сливаются с корпусом в один прямоугольник
  x.fillStyle = 'rgba(0,0,0,.3)';
  x.fillRect(cx - tw / 2 + lean, shoulderY, 3, hipY - shoulderY + 2);
  x.fillRect(cx + tw / 2 - 3 + lean, shoulderY, 3, hipY - shoulderY + 2);
  // руки
  const armW = Math.round(W * .15), armL = Math.round(H * .27);
  const shL = cx - tw / 2 + lean, shR = cx + tw / 2 - armW + lean;
  // тёмная кромка вдоль руки со стороны корпуса — отделяет силуэт
  const armEdge = (X, Y, h) => { x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(X, Y, 1, h); };
  if (attack && cfg.weapon) {
    // обе руки вперёд к зрителю: оружие рисуется отдельно
    fr(x, shL - 2, shoulderY + 6, armW + 2, Math.round(armL * .6), cfg.sleeve, 1);
    fr(x, shR, shoulderY + 6, armW + 2, Math.round(armL * .6), cfg.sleeve, 1);
    fr(x, shL - 2, shoulderY + 6 + Math.round(armL * .6), armW + 2, 6, cfg.skin);
    fr(x, shR, shoulderY + 6 + Math.round(armL * .6), armW + 2, 6, cfg.skin);
  } else if (pain) {
    fr(x, shL - 10, shoulderY - 10, armW, armL, cfg.sleeve, 1);
    fr(x, shR + 10, shoulderY - 12, armW, armL, cfg.sleeve, 1);
    fr(x, shL - 10, shoulderY - 16, armW, 6, cfg.skin);
    fr(x, shR + 10, shoulderY - 18, armW, 6, cfg.skin);
    armEdge(shL - 10 + armW - 1, shoulderY - 10, armL); armEdge(shR + 10, shoulderY - 12, armL);
  } else if (hop) {
    // руки в стороны: боец балансирует
    const sw2 = pose === 'hop1' ? -8 : 0;
    fr(x, shL - 12, shoulderY + 2 + sw2, armW, Math.round(armL * .85), cfg.sleeve, 1);
    fr(x, shR + 12, shoulderY - 4 + sw2, armW, Math.round(armL * .85), cfg.sleeve, 1);
    fr(x, shL - 12, shoulderY + 2 + sw2 + Math.round(armL * .85), armW, 6, cfg.skin);
    fr(x, shR + 12, shoulderY - 4 + sw2 + Math.round(armL * .85), armW, 6, cfg.skin);
    armEdge(shL - 12 + armW - 1, shoulderY + 2 + sw2, Math.round(armL * .85));
    armEdge(shR + 12, shoulderY - 4 + sw2, Math.round(armL * .85));
  } else if (surrender || knife) {
    // руки подняты над головой — характерная поза «не стреляй»
    const upL = Math.round(armL * .82);
    fr(x, shL - 5, shoulderY - upL + 4, armW, upL, cfg.sleeve, 1);
    fr(x, shL - 5, shoulderY - upL - 2, armW, 6, cfg.skin);
    armEdge(shL - 5 + armW - 1, shoulderY - upL + 4, upL);
    if (knife) {
      // вторая рука уже пошла вперёд с ножом — обман раскрыт
      fr(x, shR + 2, shoulderY + 10, armW + 2, Math.round(armL * .55), cfg.sleeve, 1);
      fr(x, shR + 2, shoulderY + 10 + Math.round(armL * .55), armW + 2, 7, cfg.skin);
      const kx = shR + armW / 2 + 2, ky = shoulderY + 10 + Math.round(armL * .55) + 6;
      fr(x, kx - 2, ky, 4, 5, '#3a2a1a');                       // рукоять
      fr(x, kx - 2, ky + 5, 4, 16, '#d8e0ea');                   // клинок
      fr(x, kx - 2, ky + 5, 1, 16, '#ffffff');
      x.fillStyle = '#8a1418'; x.fillRect(kx - 2, ky + 16, 4, 4);  // кровь на острие
    } else {
      fr(x, shR + 5, shoulderY - upL + 4, armW, upL, cfg.sleeve, 1);
      fr(x, shR + 5, shoulderY - upL - 2, armW, 6, cfg.skin);
      armEdge(shR + 5, shoulderY - upL + 4, upL);
    }
  } else {
    const sw = walk * 3;
    fr(x, shL - 3, shoulderY + 2 + sw, armW, armL, cfg.sleeve, 1);
    fr(x, shR + 3, shoulderY + 2 - sw, armW, armL, cfg.sleeve, 1);
    armEdge(shL - 3 + armW - 1, shoulderY + 2 + sw, armL); armEdge(shR + 3, shoulderY + 2 - sw, armL);
    fr(x, shL - 3, shoulderY + 2 + armL + sw, armW, 6, cfg.skin);
    fr(x, shR + 3, shoulderY + 2 + armL - sw, armW, 6, cfg.skin);
  }
  // оружие в руках: сдающийся его бросил
  if (cfg.weapon && !surrender && !knife && !hop) cfg.weapon(x, cx + lean, shoulderY, hipY, attack, walk, W, H);
  // щит: закрывает корпус и одну руку, поэтому рисуется последним
  if (cfg.shield && !surrender && !knife && !hop) cfg.shield(x, cx + lean, shoulderY, hipY, pose, W, H);

  // голова
  if (!headless) {
    const hx = cx + lean * 1.5, hy = headY + (pain ? -2 : 0);
    fr(x, hx - headR, hy - headR, headR * 2, headR * 2, cfg.skin, 1);
    // шея
    fr(x, hx - 3, hy + headR - 1, 6, 4, cfg.skin);
    // глаза
    x.fillStyle = '#111'; x.fillRect(hx - 4, hy - 1, 2, 2); x.fillRect(hx + 2, hy - 1, 2, 2);
    if (pain || attack) { x.fillStyle = '#300'; x.fillRect(hx - 3, hy + 4, 6, 2); }  // оскал
    else { x.fillStyle = '#5a2a20'; x.fillRect(hx - 2, hy + 4, 4, 1); }
    if (cfg.head) cfg.head(x, hx, hy, headR);
    if (pain) bloodSplotches(x, hx - headR, hy - headR, headR * 2, headR * 2, 3);
  } else {
    neckSpurt(x, cx + lean * 1.5, headY + headR - 2);
    bloodSplotches(x, cx - tw / 2, shoulderY, tw, 20, 10);
  }
  if (pain || pose === 'stagger') bloodSplotches(x, cx - tw / 2 - 4, shoulderY, tw + 8, hipY - shoulderY, pain ? 8 : 14);
  // контур: тёмная обводка по альфе — читается на любом фоне
  outline(c);
  return c;
}

/* Ползущий: обеих ног нет. Вид спереди — голова низко у нижнего края, плечи широко,
   руки подгребают вперёд, за спиной волочится обрубленный таз и кровавый след.
   Занимает нижнюю треть кадра: попасть по такому заметно труднее. */
function drawCrawl(x, cfg, phase, W, H) {
  const cx = W / 2, base = H - 3;
  const bodyH = Math.round(H * .26);
  const top = base - bodyH;
  const tw = Math.round(W * .54);
  // кровавый след позади
  x.fillStyle = 'rgba(122,4,8,.75)';
  for (let i = 0; i < 26; i++) x.fillRect(cx + rnd(-tw * .6, tw * .6), base - rnd(0, 10), rnd(2, 6), rnd(1, 3));
  // таз и обрубки ног — самая дальняя часть
  fr(x, cx - tw * .34, top + bodyH * .55, tw * .68, bodyH * .45, cfg.legs, 1);
  x.fillStyle = '#7a0408'; x.fillRect(cx - tw * .3, base - 7, tw * .6, 7);
  x.fillStyle = '#c01014'; x.fillRect(cx - tw * .22, base - 5, tw * .44, 4);
  x.fillStyle = '#e8e0d0'; x.fillRect(cx - 5, base - 5, 3, 3); x.fillRect(cx + 3, base - 5, 3, 3);
  // торс
  fr(x, cx - tw / 2, top + Math.round(bodyH * .18), tw, Math.round(bodyH * .6), cfg.body, 1);
  x.fillStyle = 'rgba(0,0,0,.3)';
  x.fillRect(cx - tw / 2, top + Math.round(bodyH * .18), 3, Math.round(bodyH * .6));
  x.fillRect(cx + tw / 2 - 3, top + Math.round(bodyH * .18), 3, Math.round(bodyH * .6));
  // руки: одна вытянута вперёд, вторая подтягивает
  const reach = phase ? 1 : 0;
  const aw = Math.round(W * .15), al = Math.round(H * .13);
  fr(x, cx - tw / 2 - aw + 2, top + (reach ? -4 : 4), aw, al, cfg.sleeve, 1);
  fr(x, cx + tw / 2 - 2, top + (reach ? 6 : -2), aw, al, cfg.sleeve, 1);
  fr(x, cx - tw / 2 - aw + 2, top + (reach ? -10 : -2), aw, 7, cfg.skin);
  fr(x, cx + tw / 2 - 2, top + (reach ? 0 : -8), aw, 7, cfg.skin);
  // голова у самого низа, смотрит на игрока
  const hr = Math.round(H * .075), hy = top + Math.round(bodyH * .1);
  fr(x, cx - hr, hy - hr, hr * 2, hr * 2, cfg.skin, 1);
  x.fillStyle = '#111'; x.fillRect(cx - 4, hy - 1, 2, 2); x.fillRect(cx + 2, hy - 1, 2, 2);
  x.fillStyle = '#300'; x.fillRect(cx - 4, hy + 4, 8, 3);                 // оскал
  if (cfg.head) cfg.head(x, cx, hy, hr);
  bloodSplotches(x, cx - tw / 2, top, tw, bodyH, 7);
}

/* Труп: плоская груда, как в Doom. Спрайт всегда развёрнут к камере, лежит у самой
   земли и занимает нижнюю четверть кадра — широкий силуэт вместо стоящей фигуры.
   Кровь и лужа добавляются уже движком (gore.heap), а вещи рядом — из drop врага. */
function drawDead(x, cfg, headless, W, H) {
  const cx = W / 2, base = H - 2;
  const bodyH = Math.round(H * .20);
  const top = base - bodyH;
  const tw = Math.round(W * .62);
  // лужа под телом
  x.fillStyle = 'rgba(96,3,6,.85)';
  x.beginPath(); x.ellipse(cx, base - 3, tw * .72, bodyH * .34, 0, 0, 7); x.fill();
  x.fillStyle = 'rgba(122,4,8,.9)';
  x.beginPath(); x.ellipse(cx - tw * .18, base - 4, tw * .42, bodyH * .24, 0, 0, 7); x.fill();
  // ноги в стороны
  fr(x, cx + tw * .12, base - Math.round(bodyH * .42), Math.round(tw * .40), Math.round(bodyH * .3), cfg.legs, 1);
  fr(x, cx + tw * .18, base - Math.round(bodyH * .70), Math.round(tw * .34), Math.round(bodyH * .28), cfg.legs, 1);
  fr(x, cx + tw * .48, base - Math.round(bodyH * .40), 11, 9, cfg.boots);
  fr(x, cx + tw * .46, base - Math.round(bodyH * .68), 11, 9, cfg.boots);
  // торс
  fr(x, cx - tw * .40, base - Math.round(bodyH * .78), Math.round(tw * .56), Math.round(bodyH * .66), cfg.body, 1);
  fr(x, cx - tw * .04, base - Math.round(bodyH * .74), 5, Math.round(bodyH * .6), cfg.belt);
  // руки раскинуты
  const aw = Math.round(W * .13);
  fr(x, cx - tw * .46, base - Math.round(bodyH * 1.0), Math.round(tw * .3), aw, cfg.sleeve, 1);
  fr(x, cx - tw * .30, base - Math.round(bodyH * .22), Math.round(tw * .3), aw, cfg.sleeve, 1);
  fr(x, cx - tw * .52, base - Math.round(bodyH * 1.0), 9, aw, cfg.skin);
  fr(x, cx - tw * .04, base - Math.round(bodyH * .22), 9, aw, cfg.skin);
  if (headless) {
    // обрубок шеи и растёкшаяся лужа вместо головы
    fr(x, cx - tw * .44, base - Math.round(bodyH * .60), 9, 12, '#9a0a0c');
    x.fillStyle = '#7a0408';
    x.beginPath(); x.ellipse(cx - tw * .60, base - Math.round(bodyH * .42), 17, 11, 0, 0, 7); x.fill();
    x.fillStyle = '#c01014';
    for (let i = 0; i < 9; i++) x.fillRect(cx - tw * .62 + rnd(-12, 12), base - Math.round(bodyH * .42) + rnd(-7, 7), 3, 2);
  } else {
    const hr = Math.round(H * .062), hx = cx - tw * .52, hy = base - Math.round(bodyH * .58);
    fr(x, hx - hr, hy - hr, hr * 2, hr * 2, cfg.skin, 1);
    x.fillStyle = '#111'; x.fillRect(hx - 4, hy - 1, 3, 2); x.fillRect(hx + 2, hy - 1, 3, 2);   // мёртвые глаза
    x.fillStyle = '#300'; x.fillRect(hx - 3, hy + 4, 7, 2);
    if (cfg.head) cfg.head(x, hx, hy, hr);
    x.fillStyle = '#7a0408'; x.fillRect(hx - 2, hy + hr - 1, 5, 6);
  }
  bloodSplotches(x, cx - tw * .45, base - bodyH, tw * .9, bodyH, 10);
}

function outline(c) {
  const x = c.getContext('2d');
  const im = x.getImageData(0, 0, c.width, c.height);
  const d = im.data, W = c.width, H = c.height;
  const a = (i, j) => (i < 0 || j < 0 || i >= W || j >= H) ? 0 : d[(j * W + i) * 4 + 3];
  const out = new Uint8ClampedArray(d);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = (j * W + i) * 4;
    if (d[k + 3] === 0 && (a(i - 1, j) || a(i + 1, j) || a(i, j - 1) || a(i, j + 1))) {
      out[k] = 10; out[k + 1] = 6; out[k + 2] = 6; out[k + 3] = 200;
    }
  }
  im.data.set(out);
  x.putImageData(im, 0, 0);
}

/* ─── конфиги персонажей ─── */
const peasantCfg = (variant) => {
  const tunics = ['#6a4a2a', '#5a5a3a', '#7a5a3a', '#4a4a4a', '#6a3a2a'];
  const tunic = tunics[variant % tunics.length];
  return {
    skin: pick(['#c8956a', '#b8865c', '#d0a070']), legs: pick(['#3a3020', '#2a2a2a', '#4a3a2a']), boots: '#2a1a10',
    body: tunic, sleeve: shade(tunic, .72), belt: '#2a1a10',
    bodyDetail: (x, cx, y, w, h) => {
      // заплатки и шнуровка
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(cx - 1, y + 2, 2, h - 8);
      x.fillStyle = pick(['#4a3a2a', '#7a6a4a']); x.fillRect(cx + rnd(-8, 4), y + rnd(8, h - 12), 5, 5);
    },
    head: (x, hx, hy, r) => {
      if (variant % 2 === 0) {
        // соломенная шляпа
        fr(x, hx - r - 5, hy - r + 1, r * 2 + 10, 3, '#b89a3a');
        fr(x, hx - r + 1, hy - r - 5, r * 2 - 2, 7, '#c8a848', 1);
      } else {
        // капюшон
        fr(x, hx - r - 1, hy - r - 2, r * 2 + 2, 5, '#3a3a2a');
        fr(x, hx - r - 1, hy - r - 2, 3, r * 2 + 2, '#3a3a2a'); fr(x, hx + r - 2, hy - r - 2, 3, r * 2 + 2, '#3a3a2a');
      }
      // борода
      fr(x, hx - 4, hy + 4, 8, 4, variant % 3 === 0 ? '#5a4a3a' : '#2a2018');
    },
    weapon: (x, cx, sy, hy, attack, walk) => {
      // вилы: древко и три зубца
      if (attack) {
        // выпад: вилы горизонтально к зрителю — древко коротко, зубцы крупно
        line(x, cx - 6, sy + 30, cx + 4, sy + 20, 4, '#5a4020');
        fr(x, cx - 2, sy + 4, 12, 4, '#8a8a90');
        for (let i = 0; i < 3; i++) fr(x, cx - 2 + i * 5, sy - 6, 2, 12, '#b0b0b8');
      } else {
        line(x, cx + 12, hy + 30, cx + 8, sy - 26, 3, '#5a4020');
        fr(x, cx + 2, sy - 30, 14, 3, '#8a8a90');
        for (let i = 0; i < 3; i++) fr(x, cx + 2 + i * 6, sy - 40, 2, 11, '#b0b0b8');
      }
    },
  };
};

const womanCfg = (variant, claw = false) => {
  const hair = pick(['#1a1a1a', '#5a2a10', '#c8a030', '#8a1a1a', '#e0e0e0']);
  const suit = claw ? '#1a2a4a' : '#1c1c22';
  const accent = claw ? '#3ad0ff' : pick(['#c81020', '#ff3060', '#d09020']);
  return {
    W: 136, H: 192,
    skin: pick(['#e8b898', '#d8a888', '#c89878', '#f0c8a8']), legs: suit, boots: '#0a0a0c',
    body: suit, sleeve: shade(suit, 1.45), belt: accent,
    bodyDetail: (x, cx, y, w, h) => {
      // бронежилет и полосы
      fr(x, cx - w / 2 + 2, y + 6, w - 4, h - 16, '#2a2a30', 1);
      x.fillStyle = accent; x.fillRect(cx - w / 2 + 2, y + 6, 2, h - 16); x.fillRect(cx + w / 2 - 4, y + 6, 2, h - 16);
      x.fillStyle = accent; x.fillRect(cx - 5, y + 8, 10, 3);          // знак ♀ — упрощённо
      x.fillRect(cx - 1, y + 11, 2, 10); x.fillRect(cx - 4, y + 16, 8, 2);
    },
    head: (x, hx, hy, r) => {
      // волосы длинные за спиной и чёлка
      fr(x, hx - r - 2, hy - r - 3, r * 2 + 4, 4, hair, 1);
      fr(x, hx - r - 3, hy - r, 3, r * 3, hair, 1); fr(x, hx + r, hy - r, 3, r * 3, hair, 1);
      fr(x, hx - r, hy - r - 1, r * 2, 3, hair);
      // губы
      x.fillStyle = '#b02030'; x.fillRect(hx - 2, hy + 4, 4, 1);
      // визор/повязка
      x.fillStyle = accent; x.fillRect(hx - r, hy - r + 3, r * 2, 1);
    },
    weapon: claw
      ? (x, cx, sy, hy, attack) => {
        // когти: длинные лезвия из пальцев
        const y = attack ? sy - 10 : sy + 34;
        for (let s = -1; s <= 1; s += 2) {
          const bx = cx + s * (attack ? 16 : 14);
          for (let i = 0; i < 4; i++) line(x, bx + (i - 1.5) * 2.4, y + (attack ? 16 : 0), bx + (i - 1.5) * 4 + s * 2, y - (attack ? 14 : -18), 1.6, '#d8e8ff');
        }
      }
      : (x, cx, sy, hy, attack) => {
        // автомат
        if (attack) {
          // ствол к зрителю: короткий, крупный срез
          fr(x, cx - 8, sy + 14, 16, 12, '#1a1a1e'); fr(x, cx - 5, sy + 17, 10, 6, '#0a0a0c'); fr(x, cx - 2, sy + 19, 4, 2, '#3a3a40');
          fr(x, cx - 12, sy + 26, 24, 5, '#2a2a30');
        } else {
          line(x, cx - 14, sy + 34, cx + 16, sy + 6, 5, '#1a1a1e');
          line(x, cx - 14, sy + 34, cx + 16, sy + 6, 1, '#3a3a44');
          fr(x, cx + 6, sy + 18, 4, 10, '#2a2a30');  // магазин
          fr(x, cx + 12, sy + 1, 6, 6, '#3a3a40');
        }
      },
  };
};

/* Стражник со щитом. Сам щит в кадре НЕ рисуется: это отдельная картинка
   public/enemies/shield.png, которая висит поверх бойца (см. Enemy.buildShield).
   Так её легко перерисовать, и она падает вместе с рукой, которая её держит. */
const guardCfg = (variant) => {
  const cloaks = ['#2a3448', '#3a2a30', '#243a34'];
  const SZ = { W: 132, H: 184 };
  const cloak = cloaks[variant % cloaks.length];
  const trim = ['#c8a040', '#a83028', '#7a8aa0'][variant % 3];
  return {
    ...SZ,
    skin: pick(['#c8956a', '#b8865c', '#d0a070']), legs: '#2a2a32', boots: '#1a1410',
    body: cloak, sleeve: shade(cloak, .74), belt: '#2a1a10',
    bodyDetail: (x, cx, y, w, h) => {
      // кираса с заклёпками
      fr(x, cx - w / 2 + 3, y + 5, w - 6, h - 12, '#5a6068', 1);
      x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(cx - 1, y + 5, 2, h - 12);
      x.fillStyle = '#8a929c';
      for (let i = 0; i < 4; i++) { x.fillRect(cx - w / 2 + 6, y + 9 + i * 9, 2, 2); x.fillRect(cx + w / 2 - 8, y + 9 + i * 9, 2, 2); }
      x.fillStyle = trim; x.fillRect(cx - w / 2 + 3, y + 5, w - 6, 3);
    },
    head: (x, hx, hy, r) => {
      fr(x, hx - r - 2, hy - r - 4, r * 2 + 4, r * 2 + 2, '#6a727c', 1);      // шлем
      fr(x, hx - r, hy - 2, r * 2, 3, '#0a0a0c');                              // смотровая щель
      fr(x, hx - 1, hy - r - 8, 2, 5, trim);                                   // гребень
      fr(x, hx - r - 2, hy + r - 3, r * 2 + 4, 3, '#4a5058');                   // подбородник
    },
    weapon: (x, cx, sy, hy, attack) => {
      // короткий меч в дальней от щита руке
      if (attack) { fr(x, cx - 24, sy + 6, 5, 26, '#c8d0d8'); fr(x, cx - 26, sy + 30, 9, 4, '#4a4038'); }
      else { fr(x, cx - 30, sy + 22, 4, 26, '#c8d0d8'); fr(x, cx - 33, sy + 18, 10, 4, '#4a4038'); }
    },
    shieldColors: { face: '#3a4048', plate: '#6a727c', boss: '#c8a040' },
    _unusedShield: (x, cx, sy, hy, pose, W, H) => {
      // каплевидный щит: перекрывает торс и правую (со стороны зрителя) руку
      const sx = cx + Math.round(W * .12), top = sy - 6, w = Math.round(W * .30), h = Math.round(H * .40);
      x.fillStyle = '#3a4048';
      x.beginPath(); x.moveTo(sx - w / 2, top + 6); x.quadraticCurveTo(sx, top - 6, sx + w / 2, top + 6);
      x.lineTo(sx + w / 2, top + h * .6); x.quadraticCurveTo(sx, top + h, sx - w / 2, top + h * .6); x.closePath(); x.fill();
      x.fillStyle = '#6a727c'; x.lineWidth = 0;
      x.beginPath(); x.moveTo(sx - w / 2 + 3, top + 9); x.quadraticCurveTo(sx, top - 2, sx + w / 2 - 3, top + 9);
      x.lineTo(sx + w / 2 - 3, top + h * .58); x.quadraticCurveTo(sx, top + h - 5, sx - w / 2 + 3, top + h * .58); x.closePath(); x.fill();
      fr(x, sx - 2, top + 4, 4, h * .72, '#3a4048');                 // ребро
      x.fillStyle = '#c8a040'; x.beginPath(); x.arc(sx, top + h * .36, 5, 0, 7); x.fill();   // умбон
      x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(sx - w / 2 + 4, top + 10, 3, h * .5);
      for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(sx + rnd(-w / 2 + 4, w / 2 - 4), top + rnd(6, h * .8), 2, 2); }
    },
  };
};

const knightCfg = () => ({
  skin: '#c8956a', legs: '#5a5a62', boots: '#2a2a30', body: '#8a1418', sleeve: '#6a6a72', belt: '#3a2a1a',
  bodyDetail: (x, cx, y, w, h) => { x.fillStyle = '#e0c060'; x.fillRect(cx - 2, y + 6, 4, h - 14); x.fillRect(cx - 7, y + 12, 14, 4); },
  head: (x, hx, hy, r) => {
    fr(x, hx - r - 1, hy - r - 3, r * 2 + 2, r * 2 + 1, '#7a7a86', 1);  // шлем
    fr(x, hx - r + 1, hy - 2, r * 2 - 2, 3, '#111');                     // прорезь
    fr(x, hx - 1, hy - r - 7, 2, 5, '#c81020');                          // плюмаж
  },
  weapon: (x, cx, sy, hy) => { line(x, cx + 14, hy + 20, cx + 14, sy - 30, 3, '#c8d0d8'); fr(x, cx + 9, hy + 2, 11, 3, '#4a3a2a'); },
});

/* ═══════════ новые бойцы ═══════════
   Оба рисуются той же humanoid(), что и остальные, поэтому получают сразу все
   четырнадцать поз — включая hop/crawl (отстрел ног) и headless. Чтобы заменить
   их своей графикой, достаточно перерисовать лист: npm run sheets положит рядом
   <имя>_template.png с разметкой кадров и зон попадания. */

// Лучник: лёгкий, держится в стороне и бьёт издалека. Узнаётся по капюшону и луку.
const archerCfg = (variant) => {
  const coats = ['#3a4a32', '#2f3a44', '#4a3a28'];
  const coat = coats[variant % coats.length];
  const cord = ['#8a7a4a', '#6a8a6a', '#8a6a4a'][variant % 3];
  return {
    W: 128, H: 176,
    skin: pick(['#c8956a', '#b8865c', '#d0a070']), legs: '#2f2a22', boots: '#1e1810',
    body: coat, sleeve: shade(coat, .72), belt: '#3a2a16',
    bodyDetail: (x, cx, y, w, h) => {
      // перевязь колчана наискось и стрелы за плечом
      x.fillStyle = shade(coat, .55);
      x.save(); x.translate(cx, y + h / 2); x.rotate(-.5); x.fillRect(-4, -h / 2 - 4, 7, h + 8); x.restore();
      fr(x, cx + w / 2 - 6, y - 12, 9, 20, '#4a3a22', 1);                 // колчан
      for (let i = 0; i < 3; i++) {
        fr(x, cx + w / 2 - 5 + i * 3, y - 24, 1, 13, '#8a7a5a');           // древки
        fr(x, cx + w / 2 - 6 + i * 3, y - 24, 3, 4, cord);                 // оперение
      }
      x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(cx - w / 2 + 3, y + 4, w - 6, 2);
    },
    head: (x, hx, hy, r) => {
      // капюшон: козырёк, тень на лице, плечевая накидка
      fr(x, hx - r - 3, hy - r - 5, r * 2 + 6, r + 6, shade('#3a3a2e', 1));
      fr(x, hx - r - 3, hy - r - 2, 4, r * 2 + 3, '#3a3a2e');
      fr(x, hx + r - 1, hy - r - 2, 4, r * 2 + 3, '#3a3a2e');
      x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(hx - r + 1, hy - r + 1, r * 2 - 2, r);
      fr(x, hx - r - 5, hy + r - 2, r * 2 + 10, 5, '#32322a');             // накидка на плечах
    },
    weapon: (x, cx, sy, hy, attack) => {
      const bowX = attack ? cx - 16 : cx + 16;
      // дуга лука
      x.strokeStyle = '#6a4a26'; x.lineWidth = 3;
      x.beginPath(); x.arc(bowX, sy + 16, 30, attack ? -1.25 : 1.9, attack ? 1.25 : 4.4); x.stroke();
      // тетива: при выстреле оттянута к плечу
      x.strokeStyle = '#d8d0b8'; x.lineWidth = 1;
      x.beginPath();
      if (attack) { x.moveTo(bowX + 3, sy - 12); x.lineTo(bowX + 22, sy + 16); x.lineTo(bowX + 3, sy + 44); }
      else { x.moveTo(bowX - 3, sy - 12); x.lineTo(bowX - 3, sy + 44); }
      x.stroke();
      if (attack) { fr(x, bowX + 4, sy + 15, 26, 2, '#8a7a5a'); fr(x, bowX + 28, sy + 13, 4, 5, '#c0c6cc'); }   // стрела на тетиве
    },
  };
};

// Громила: медленный таран с кувалдой. Шире всех, поэтому и кадр крупнее.
const bruteCfg = (variant) => {
  const aprons = ['#4a2a22', '#3a3228', '#472a2a'];
  const apron = aprons[variant % aprons.length];
  const iron = ['#6a6a72', '#7a6a58', '#5a6068'][variant % 3];
  return {
    W: 152, H: 184,
    skin: pick(['#b8865c', '#c08a60', '#a87a52']), legs: '#2a241c', boots: '#171310',
    body: apron, sleeve: shade(apron, .8), belt: '#241a12',
    bodyDetail: (x, cx, y, w, h) => {
      // кожаный фартук поверх брюха, железные пластины внахлёст
      fr(x, cx - w / 2 + 5, y + 8, w - 10, h - 12, shade(apron, 1.25), 1);
      x.fillStyle = iron;
      for (let i = 0; i < 3; i++) fr(x, cx - w / 2 + 7, y + 12 + i * 12, w - 14, 5, iron, 1);
      x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(cx - w / 2 + 5, y + 8, w - 10, 2);
      // цепь через плечо
      x.fillStyle = '#8a8a92';
      for (let i = 0; i < 6; i++) x.fillRect(cx - w / 2 + 8 + i * 6, y + 2 + i, 4, 3);
    },
    head: (x, hx, hy, r) => {
      // низкий железный намордник и бритый череп
      fr(x, hx - r, hy - r - 2, r * 2, 5, '#5a4a3a');
      fr(x, hx - r - 1, hy + 1, r * 2 + 2, r - 1, iron, 1);                 // маска на нижней половине лица
      for (let i = 0; i < 4; i++) fr(x, hx - r + 2 + i * 4, hy + 3, 2, 4, '#2a2a30');   // прорези
      fr(x, hx - r - 3, hy + r - 2, r * 2 + 6, 4, '#3a3a42');               // воротник
      x.fillStyle = '#7a2a2a'; x.fillRect(hx - r + 2, hy - 4, 3, 2); x.fillRect(hx + r - 5, hy - 4, 3, 2);
    },
    weapon: (x, cx, sy, hy, attack) => {
      // кувалда: при замахе занесена над головой, иначе лежит на плече
      if (attack) {
        line(x, cx - 2, hy + 6, cx + 6, sy - 40, 5, '#4a3418');
        fr(x, cx - 6, sy - 56, 26, 16, '#5a5a64', 1);
        fr(x, cx - 6, sy - 56, 26, 4, '#8a8a94');
        fr(x, cx + 18, sy - 52, 5, 8, '#3a3a42');
      } else {
        line(x, cx + 22, hy + 24, cx + 14, sy - 26, 5, '#4a3418');
        fr(x, cx + 2, sy - 42, 24, 15, '#5a5a64', 1);
        fr(x, cx + 2, sy - 42, 24, 4, '#8a8a94');
      }
    },
  };
};

/* ═══════════ пёс ═══════════
   Не гуманоид: рук нет, силуэт низкий и широкий, морда на уровне пояса игрока.
   Своя отрисовка, потому что humanoid() строит прямоходящую фигуру. Кадров
   меньше, чем у людей, — остальные механики движок отключает сам. */
function beast(cfg, pose) {
  const W = cfg.W || 144, H = cfg.H || 104;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const cx = W / 2, feet = H - 2;
  const dead = pose === 'dead';
  const crawl = pose === 'crawl0' || pose === 'crawl1';
  const hop = pose === 'hop0' || pose === 'hop1';
  const attack = pose === 'attack';
  const pain = pose === 'pain';
  const headless = pose === 'headless';
  const step = pose === 'walk1' || pose === 'hop1' ? -4 : pose === 'walk0' || pose === 'hop0' ? 4 : 0;

  if (dead) {
    // туша на боку: вытянутая груда, лапы врозь
    fr(x, cx - 34, feet - 22, 68, 20, cfg.fur, 1);
    fr(x, cx - 44, feet - 18, 14, 12, shade(cfg.fur, .8), 1);
    for (let i = 0; i < 4; i++) fr(x, cx - 26 + i * 15, feet - 30, 7, 12, shade(cfg.fur, .85), 1);
    fr(x, cx + 28, feet - 26, 22, 6, shade(cfg.fur, .7));                 // хвост
    bloodSplotches(x, cx - 40, feet - 30, 80, 28, 16);
    fr(x, cx - 46, feet - 8, 92, 6, '#7a0a0c');                            // лужа
    outline(c); return c;
  }

  const low = crawl ? 16 : hop ? 6 : 0;           // подранок припадает к земле
  const bodyY = feet - (crawl ? 30 : hop ? 40 : 46);
  const bodyH = crawl ? 24 : 30;

  // задние лапы
  fr(x, cx + 16, bodyY + bodyH - 4, 10, feet - (bodyY + bodyH) + 4 - low, shade(cfg.fur, .78), 1);
  fr(x, cx + 28, bodyY + bodyH - 6, 9, feet - (bodyY + bodyH) + 6 - low, shade(cfg.fur, .72), 1);
  // корпус
  fr(x, cx - 30, bodyY, 62, bodyH, cfg.fur, 1);
  fr(x, cx - 30, bodyY, 62, 6, shade(cfg.fur, 1.2));                       // загривок
  if (cfg.bodyDetail) cfg.bodyDetail(x, cx, bodyY, 62, bodyH);
  // хвост
  fr(x, cx + 30, bodyY + 4, 18, 5, shade(cfg.fur, .7));
  // передние лапы: в шаге расходятся; на трёх лапах дальняя — обрубок
  const legH = feet - (bodyY + bodyH) + 2 - low;
  fr(x, cx - 26 - step, bodyY + bodyH - 2, 11, legH, shade(cfg.fur, .9), 1);
  fr(x, cx - 27 - step, feet - 6 - low, 13, 6, cfg.claws);                 // когти
  if (hop) {
    const stub = Math.round(legH * .35);
    fr(x, cx - 8, bodyY + bodyH - 2, 11, stub, shade(cfg.fur, .82), 1);
    fr(x, cx - 8, bodyY + bodyH - 2 + stub, 11, 5, '#7a0408');             // срез
    x.fillStyle = '#c01014'; x.fillRect(cx - 6, bodyY + bodyH + stub, 6, 3);
    for (let i = 0; i < 5; i++) { x.fillStyle = '#9a0a0c'; x.fillRect(cx - 9 + (Math.random() * 12 | 0), bodyY + bodyH + stub + 4 + (Math.random() * 10 | 0), 2, 2); }
  } else {
    fr(x, cx - 8 + step, bodyY + bodyH - 2, 11, legH, shade(cfg.fur, .82), 1);
    fr(x, cx - 9 + step, feet - 6 - low, 13, 6, cfg.claws);
  }

  if (!headless) {
    // голова: морда вперёд, пасть раскрыта при атаке
    const hx = cx - 28, hy = bodyY - (crawl ? 2 : 10);
    fr(x, hx - 16, hy - 14, 32, 24, cfg.fur, 1);
    fr(x, hx - 6, hy - 22, 8, 9, shade(cfg.fur, .85));                     // уши
    fr(x, hx + 6, hy - 22, 8, 9, shade(cfg.fur, .85));
    fr(x, hx - 22, hy - 4, 16, 12, shade(cfg.fur, 1.12), 1);               // морда
    x.fillStyle = '#141018'; x.fillRect(hx - 24, hy - 2, 5, 4);            // нос
    x.fillStyle = cfg.eye; x.fillRect(hx - 8, hy - 8, 4, 3); x.fillRect(hx + 2, hy - 8, 4, 3);
    if (attack) {
      fr(x, hx - 24, hy + 4, 22, 10, '#4a0a12');                           // раскрытая пасть
      x.fillStyle = '#e8e0d0';
      for (let i = 0; i < 5; i++) { x.fillRect(hx - 22 + i * 4, hy + 4, 2, 4); x.fillRect(hx - 20 + i * 4, hy + 10, 2, 4); }
    } else {
      x.fillStyle = '#e8e0d0'; x.fillRect(hx - 18, hy + 6, 2, 4); x.fillRect(hx - 12, hy + 6, 2, 4);
    }
    if (pain) bloodSplotches(x, hx - 24, hy - 14, 40, 26, 8);
  } else {
    neckSpurt(x, cx - 26, bodyY - 2);
  }
  if (pain || crawl || hop) bloodSplotches(x, cx - 30, bodyY, 62, bodyH, crawl ? 12 : 8);
  outline(c);
  return c;
}

const houndCfg = (variant) => ({
  W: 144, H: 104,
  fur: ['#4a3a2e', '#33302c', '#503028'][variant % 3],
  claws: '#d8d0c0', eye: ['#e8c040', '#d83020', '#c8e040'][variant % 3],
  bodyDetail: (x, cx, y, w, h) => {
    // рёбра проступают сквозь шкуру — зверь голодный
    x.fillStyle = 'rgba(0,0,0,.22)';
    for (let i = 0; i < 4; i++) x.fillRect(cx - 18 + i * 10, y + 8, 3, h - 14);
  },
});

/* ═══════════ щит отдельным спрайтом ═══════════
   Одна картинка — четыре стадии в ряд: целый → помятый → треснувший → разбитый.
   Каждый принятый удар переключает стадию, после последней щит пропадает.
   Заменить щит = перерисовать этот PNG (public/enemies/shield.png), число стадий
   берётся из `frames` в stats.shield врага. */
const SHIELD_STAGES = 4;
function shieldSprite(name, faceCol, plateCol, bossCol) {
  const FW = 96, FH = 128;
  const c = makeCanvas(FW * SHIELD_STAGES, FH);
  const x = c.getContext('2d');
  for (let st = 0; st < SHIELD_STAGES; st++) {
    const ox = st * FW, cx = ox + FW / 2, w = FW - 10, h = FH - 8, top = 4;
    const kite = (inset) => {
      x.beginPath();
      x.moveTo(cx - w / 2 + inset, top + 12 + inset);
      x.quadraticCurveTo(cx, top + inset - 8, cx + w / 2 - inset, top + 12 + inset);
      x.lineTo(cx + w / 2 - inset, top + h * .58);
      x.quadraticCurveTo(cx, top + h - inset, cx - w / 2 + inset, top + h * .58);
      x.closePath();
    };
    x.save();
    // на последней стадии от щита остаётся рваный огрызок
    if (st === SHIELD_STAGES - 1) { kite(0); x.clip(); x.beginPath(); x.rect(ox, top, FW, h * .55); x.clip(); }
    x.fillStyle = faceCol; kite(0); x.fill();
    x.fillStyle = plateCol; kite(5); x.fill();
    fr(x, cx - 3, top + 8, 6, Math.round(h * .74), faceCol);
    x.fillStyle = bossCol; x.beginPath(); x.arc(cx, top + h * .34, 9, 0, 7); x.fill();
    x.fillStyle = bossCol;
    for (let i = 0; i < 7; i++) { const t = i / 6; x.fillRect(cx - w / 2 + 7 + t * (w - 14), top + 14 + Math.sin(t * Math.PI) * -6, 3, 3); }
    fr(x, cx - w / 2 + 9, top + 18, 5, Math.round(h * .5), 'rgba(255,255,255,.12)');
    for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(cx + rnd(-w / 2 + 8, w / 2 - 8), top + rnd(10, h * .85), 2, 2); }
    // повреждения копятся от стадии к стадии
    for (let d = 0; d < st; d++) {
      const bx = cx + rnd(-w / 2 + 12, w / 2 - 12), by = top + rnd(16, h * .7);
      x.strokeStyle = 'rgba(0,0,0,.8)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(bx, by);
      for (let k = 0; k < 4; k++) x.lineTo(bx + rnd(-16, 16), by + rnd(-18, 18));
      x.stroke();
      x.fillStyle = 'rgba(0,0,0,.45)';
      for (let k = 0; k < 9; k++) x.fillRect(bx + rnd(-14, 14), by + rnd(-14, 14), rnd(2, 5), rnd(2, 5));
      x.fillStyle = 'rgba(255,255,255,.2)'; x.fillRect(bx, by, 3, 3);
    }
    if (st >= 2) {
      // выломанный кусок кромки
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(cx + w / 2 - 6, top + h * (st === 2 ? .3 : .45), st === 2 ? 11 : 17, 0, 7); x.fill();
      x.restore();
    }
    x.restore();
  }
  outline(c);
  return reg(name, c);
}

/* ═══════════ гибсы ═══════════ */
function gib(name, w, h, fn) {
  const c = makeCanvas(w, h);
  fn(c.getContext('2d'), w, h);
  outline(c);
  return reg(name, c);
}
function head(name, skin, hat) {
  gib(name, 18, 20, (x) => {
    fr(x, 2, 3, 14, 14, skin, 1);
    x.fillStyle = '#111'; x.fillRect(5, 8, 2, 2); x.fillRect(11, 8, 2, 2);
    x.fillStyle = '#300'; x.fillRect(6, 13, 6, 2);
    fr(x, 6, 17, 6, 3, '#9a0a0c');                                     // срез шеи
    x.fillStyle = '#e02020'; x.fillRect(7, 18, 2, 2); x.fillRect(10, 17, 1, 3);
    hat(x);
  });
}

/* ═══════════ лежащие трупы (вид сверху) ═══════════ */
function corpse(name, cfg, headless) {
  const c = makeCanvas(112, 56);
  const x = c.getContext('2d');
  const cy = 28;
  // ноги вправо, голова влево
  fr(x, 58, cy - 12, 46, 9, cfg.legs, 1); fr(x, 58, cy + 3, 46, 9, cfg.legs, 1);
  fr(x, 98, cy - 13, 12, 10, cfg.boots); fr(x, 98, cy + 2, 12, 10, cfg.boots);
  fr(x, 30, cy - 12, 32, 24, cfg.body, 1);
  fr(x, 56, cy - 12, 4, 24, cfg.belt);
  // руки раскинуты
  fr(x, 34, cy - 30, 8, 20, cfg.sleeve, 1); fr(x, 42, cy + 10, 8, 20, cfg.sleeve, 1);
  fr(x, 34, cy - 36, 8, 6, cfg.skin); fr(x, 42, cy + 30, 8, 6, cfg.skin);
  if (!headless) {
    fr(x, 14, cy - 8, 16, 16, cfg.skin, 1);
    x.fillStyle = '#111'; x.fillRect(18, cy - 3, 2, 2); x.fillRect(18, cy + 3, 2, 2);
    x.fillStyle = '#7a0408'; x.fillRect(12, cy - 2, 3, 5);
    if (cfg.corpseHead) cfg.corpseHead(x, 22, cy);
  } else {
    fr(x, 26, cy - 5, 6, 10, '#9a0a0c');
    x.fillStyle = '#7a0408'; x.beginPath(); x.ellipse(16, cy, 14, 10, 0, 0, 7); x.fill();
  }
  bloodSplotches(x, 28, cy - 14, 40, 28, 6);
  outline(c);
  return reg(name, c);
}

/* ═══════════ сборка ═══════════ */
export function buildSprites() {
  const POSES = ['walk0', 'walk1', 'attack', 'pain', 'headless', 'crouch', 'surrender', 'knife', 'hop0', 'hop1', 'crawl0', 'crawl1', 'dead', 'deadHeadless'];

  // крестьяне: 3 варианта внешности
  // (трупы теперь объёмные груды — см. gore.heap; плоские спрайты трупов не генерируются)
  for (let v = 0; v < 3; v++) {
    const cfg = peasantCfg(v);
    for (const p of POSES) reg(`peasant${v}_${p}`, humanoid(cfg, p));
  }
  // воительницы с автоматом: 3 варианта; когтистая: 2
  for (let v = 0; v < 3; v++) {
    const cfg = womanCfg(v, false);
    for (const p of POSES) reg(`woman${v}_${p}`, humanoid(cfg, p));
  }
  for (let v = 0; v < 2; v++) {
    const cfg = womanCfg(v, true);
    for (const p of POSES) reg(`claw${v}_${p}`, humanoid(cfg, p));
  }
  // стражники со щитом: 3 варианта
  for (let v = 0; v < 3; v++) {
    const cfg = guardCfg(v);
    for (const p of POSES) reg(`guard${v}_${p}`, humanoid(cfg, p));
  }
  // лучник и громила — обычные люди, поэтому все четырнадцать поз
  for (let v = 0; v < 3; v++) { const cfg = archerCfg(v); for (const p of POSES) reg(`archer${v}_${p}`, humanoid(cfg, p)); }
  for (let v = 0; v < 2; v++) { const cfg = bruteCfg(v); for (const p of POSES) reg(`brute${v}_${p}`, humanoid(cfg, p)); }
  /* Пёс: поз меньше — на четырёх ногах не сдаются, не приседают и не скачут на
     одной. Движок сам не включает то, чего нет в листе. */
  const BEAST_POSES = ['walk0', 'walk1', 'attack', 'pain', 'headless', 'hop0', 'hop1', 'crawl0', 'crawl1', 'dead'];
  for (let v = 0; v < 3; v++) { const cfg = houndCfg(v); for (const p of BEAST_POSES) reg(`hound${v}_${p}`, beast(cfg, p)); }

  // союзник-рыцарь
  const kc = knightCfg();
  reg('knight_idle', humanoid(kc, 'idle'));
  reg('knight_walk0', humanoid(kc, 'walk0'));

  /* Щит — отдельная картинка (public/enemies/shield.png), а не часть кадра бойца:
     так его легко перерисовать, он отваливается вместе с рукой и корректно ломается. */
  shieldSprite('shield_kite', '#3a4048', '#6a727c', '#c8a040');

  // головы
  head('head_peasant', '#c8956a', x => { fr(x, 0, 4, 18, 2, '#b89a3a'); fr(x, 3, 0, 12, 5, '#c8a848'); fr(x, 5, 15, 8, 3, '#2a2018'); });
  head('head_peasant2', '#b8865c', x => { fr(x, 1, 1, 16, 4, '#3a3a2a'); fr(x, 5, 15, 8, 3, '#5a4a3a'); });
  head('head_woman', '#e8b898', x => { fr(x, 0, 1, 18, 4, '#1a1a1a'); fr(x, 0, 3, 3, 14, '#1a1a1a'); fr(x, 15, 3, 3, 14, '#1a1a1a'); x.fillStyle = '#b02030'; x.fillRect(7, 13, 4, 1); });
  head('head_woman2', '#d8a888', x => { fr(x, 0, 1, 18, 4, '#c8a030'); fr(x, 0, 3, 3, 14, '#c8a030'); fr(x, 15, 3, 3, 14, '#c8a030'); x.fillStyle = '#b02030'; x.fillRect(7, 13, 4, 1); });
  head('head_woman3', '#c89878', x => { fr(x, 0, 1, 18, 4, '#8a1a1a'); fr(x, 0, 3, 3, 14, '#8a1a1a'); fr(x, 15, 3, 3, 14, '#8a1a1a'); });

  // конечности и мясо
  gib('gib_arm', 20, 10, x => { fr(x, 0, 2, 14, 6, '#c8956a', 1); fr(x, 12, 1, 8, 8, '#8a1418'); x.fillStyle = '#e8e0d0'; x.fillRect(14, 4, 3, 2); });
  gib('gib_armW', 22, 10, x => { fr(x, 0, 2, 16, 6, '#1c1c22', 1); fr(x, 14, 1, 8, 8, '#8a1418'); fr(x, 0, 3, 4, 4, '#e8b898'); });
  gib('gib_leg', 26, 12, x => { fr(x, 0, 2, 20, 8, '#3a3020', 1); fr(x, 18, 1, 8, 10, '#8a1418'); fr(x, 0, 6, 8, 6, '#2a1a10'); x.fillStyle = '#e8e0d0'; x.fillRect(20, 5, 3, 2); });
  gib('gib_legW', 28, 12, x => { fr(x, 0, 2, 22, 8, '#1c1c22', 1); fr(x, 20, 1, 8, 10, '#8a1418'); fr(x, 0, 6, 8, 6, '#0a0a0c'); });
  gib('gib_torso', 24, 22, x => { fr(x, 2, 2, 20, 18, '#6a4a2a', 1); fr(x, 4, 8, 16, 12, '#8a1418'); x.fillStyle = '#e8e0d0'; for (let i = 0; i < 4; i++) x.fillRect(5 + i * 4, 10, 2, 8); });
  gib('gib_torsoW', 24, 22, x => { fr(x, 2, 2, 20, 18, '#1c1c22', 1); fr(x, 4, 8, 16, 12, '#8a1418'); x.fillStyle = '#e8e0d0'; for (let i = 0; i < 4; i++) x.fillRect(5 + i * 4, 10, 2, 8); });
  gib('gib_ribs', 22, 16, x => { fr(x, 2, 2, 18, 12, '#8a1418'); x.fillStyle = '#e8e0d0'; for (let i = 0; i < 5; i++) x.fillRect(3 + i * 4, 3, 2, 10); });
  gib('gib_meat0', 12, 10, x => { fr(x, 1, 1, 10, 8, '#9a1418', 1); x.fillStyle = '#c03030'; x.fillRect(3, 3, 3, 2); });
  gib('gib_meat1', 14, 12, x => { fr(x, 1, 2, 12, 8, '#7a0a10', 1); x.fillStyle = '#e8e0d0'; x.fillRect(4, 4, 2, 2); });
  gib('gib_meat2', 10, 14, x => { fr(x, 2, 1, 6, 12, '#a81a1e', 1); x.fillStyle = '#5a0206'; x.fillRect(3, 6, 3, 4); });
  gib('gib_gut', 24, 8, x => { x.strokeStyle = '#c86070'; x.lineWidth = 4; x.beginPath(); x.moveTo(2, 4); x.quadraticCurveTo(8, 0, 12, 4); x.quadraticCurveTo(16, 8, 22, 4); x.stroke(); x.strokeStyle = '#8a3040'; x.lineWidth = 1; x.beginPath(); x.moveTo(2, 4); x.quadraticCurveTo(8, 0, 12, 4); x.quadraticCurveTo(16, 8, 22, 4); x.stroke(); });
  gib('gib_skull', 12, 12, x => { fr(x, 2, 1, 8, 8, '#e8e0d0', 1); x.fillStyle = '#111'; x.fillRect(3, 4, 2, 2); x.fillRect(7, 4, 2, 2); fr(x, 3, 9, 6, 2, '#9a1418'); });
  gib('gib_brain', 12, 10, x => { fr(x, 1, 1, 10, 8, '#e0a0a8', 1); x.strokeStyle = '#b06070'; x.lineWidth = 1; x.beginPath(); x.moveTo(2, 5); x.lineTo(10, 5); x.moveTo(6, 1); x.lineTo(6, 9); x.stroke(); });
  gib('gib_eye', 6, 6, x => { fr(x, 0, 0, 6, 6, '#eee'); x.fillStyle = '#26a'; x.fillRect(2, 2, 2, 2); });
  gib('gib_hand', 10, 10, x => { fr(x, 1, 3, 8, 6, '#c8956a', 1); fr(x, 1, 1, 2, 4, '#c8956a'); fr(x, 4, 1, 2, 3, '#c8956a'); fr(x, 7, 1, 2, 4, '#c8956a'); fr(x, 1, 8, 8, 2, '#8a1418'); });
  gib('gib_hat', 20, 8, x => { fr(x, 0, 5, 20, 3, '#b89a3a'); fr(x, 4, 0, 12, 6, '#c8a848', 1); });
  gib('gib_rifle', 30, 10, x => { line(x, 1, 5, 29, 5, 4, '#1a1a1e'); fr(x, 12, 5, 4, 5, '#2a2a30'); fr(x, 22, 1, 5, 4, '#3a3a40'); });
  gib('gib_shield', 26, 30, x => {
    x.fillStyle = '#3a4048'; x.beginPath(); x.moveTo(3, 6); x.quadraticCurveTo(13, -4, 23, 6); x.lineTo(21, 20); x.quadraticCurveTo(13, 29, 5, 20); x.closePath(); x.fill();
    x.fillStyle = '#6a727c'; x.fillRect(6, 8, 14, 12);
    x.fillStyle = '#c8a040'; x.beginPath(); x.arc(13, 14, 4, 0, 7); x.fill();
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(11, 0, 3, 30); x.fillRect(2, 15, 24, 2);   // трещины
  });
  gib('gib_shieldPiece', 14, 12, x => { fr(x, 1, 2, 11, 8, '#5a626c', 1); fr(x, 1, 2, 11, 2, '#8a929c'); });
  gib('gib_knife', 20, 8, x => { fr(x, 1, 3, 5, 3, '#3a2a1a'); fr(x, 6, 3, 13, 3, '#d8e0ea'); fr(x, 6, 3, 13, 1, '#ffffff'); });
  gib('gib_fork', 34, 10, x => { line(x, 1, 5, 26, 5, 2, '#5a4020'); fr(x, 24, 3, 3, 5, '#8a8a90'); for (let i = 0; i < 3; i++) fr(x, 26, 1 + i * 3, 8, 1.5, '#b0b0b8'); });

  // предметы
  gib('pickup_pistol', 32, 22, x => {
    fr(x, 2, 6, 24, 7, '#2a2c30'); fr(x, 2, 6, 24, 2, '#4a4c52'); fr(x, 22, 4, 6, 3, '#4a4c52');
    fr(x, 6, 12, 8, 10, '#1a1a1c'); fr(x, 7, 13, 6, 8, '#3a2a1a', 1); fr(x, 14, 12, 4, 4, '#2a2c30');
    fr(x, 0, 8, 3, 3, '#0a0a0c');
  });
  gib('pickup_cloth', 26, 26, x => {
    x.fillStyle = '#e8e0d0'; x.beginPath(); x.moveTo(2, 4); x.lineTo(22, 2); x.lineTo(24, 18); x.lineTo(12, 24); x.lineTo(4, 16); x.closePath(); x.fill();
    x.fillStyle = '#c81020'; x.fillRect(6, 8, 12, 3); x.fillRect(10, 5, 3, 12);       // узор платья
    x.fillStyle = '#d0b060'; x.fillRect(4, 14, 16, 1);
    x.fillStyle = 'rgba(0,0,0,.2)'; x.fillRect(14, 14, 8, 6);
  });
  gib('pickup_shotgun', 44, 18, x => {
    fr(x, 2, 6, 34, 5, '#2a2c30'); fr(x, 2, 6, 34, 2, '#4a4c52'); fr(x, 2, 11, 28, 4, '#3a2a1a', 1);   // ствол и магазин
    fr(x, 30, 9, 12, 8, '#5a3a1a', 1); fr(x, 36, 12, 8, 6, '#4a2a10');                             // приклад
    fr(x, 22, 10, 6, 6, '#1a1a1c'); fr(x, 0, 7, 3, 3, '#0a0a0c');
  });
  gib('pickup_rocket', 46, 20, x => {
    fr(x, 2, 6, 34, 9, '#4a4f58', 1); fr(x, 2, 6, 34, 3, '#7a828c');                    // труба со светлым верхом
    fr(x, 34, 4, 8, 13, '#3a3f46', 1); fr(x, 34, 4, 8, 3, '#6a727c');                    // раструб сзади
    for (let i = 0; i < 3; i++) fr(x, 8 + i * 9, 6, 2, 9, '#2a2c30');                     // хомуты
    fr(x, 10, 2, 16, 3, '#6a727c', 1); fr(x, 11, 0, 3, 3, '#c03030');                     // планка прицела и мушка
    fr(x, 14, 15, 5, 5, '#1a1a1c'); fr(x, 26, 15, 5, 5, '#1a1a1c');                       // рукояти
    fr(x, 0, 6, 3, 9, '#0a0a0c');                                                          // срез дула
  });
  gib('pickup_rockets', 22, 16, x => {
    fr(x, 1, 7, 20, 8, '#5a5a2a', 1); fr(x, 1, 7, 20, 2, '#7a7a3a');                       // ящик
    for (let i = 0; i < 2; i++) { const bx = 3 + i * 9; fr(x, bx, 2, 7, 6, '#8a929c', 1); fr(x, bx + 1, 0, 5, 3, '#c03030'); fr(x, bx + 1, 5, 5, 2, '#3a4048'); }
  });
  // иконка меча для HUD (огнестрела иконки берутся из pickup_*)
  gib('icon_sword', 14, 34, x => {
    fr(x, 6, 1, 3, 22, '#c8d0d8'); fr(x, 6, 1, 1, 22, '#eef4fa'); fr(x, 8, 3, 1, 19, '#7a828c');  // клинок
    fr(x, 5, 0, 5, 2, '#e8eef4');                                                                  // остриё
    fr(x, 1, 23, 13, 3, '#4a4038'); fr(x, 6, 23, 3, 3, '#c8a040');                                 // гарда
    fr(x, 6, 26, 3, 6, '#4a2e1a'); fr(x, 5, 32, 5, 2, '#c8a040');                                  // рукоять и навершие
  });
  gib('pickup_shells', 18, 12, x => { fr(x, 1, 3, 16, 8, '#4a3a2a', 1); for (let i = 0; i < 4; i++) { fr(x, 2 + i * 4, 1, 3, 9, '#c03030'); fr(x, 2 + i * 4, 8, 3, 2, '#c8a030'); } });
  gib('pickup_health', 14, 22, x => { fr(x, 3, 6, 8, 14, '#c81020', 1); fr(x, 5, 1, 4, 6, '#8a8a90'); x.fillStyle = '#ffe8e8'; x.fillRect(5, 9, 4, 6); x.fillStyle = '#c81020'; x.fillRect(6, 10, 2, 4); });
  gib('pickup_ammo', 16, 12, x => { fr(x, 1, 3, 14, 8, '#5a5a2a', 1); for (let i = 0; i < 4; i++) fr(x, 2 + i * 3.5, 1, 2, 4, '#c8a030'); });
  gib('rose', 10, 14, x => { fr(x, 4, 5, 2, 9, '#2a5a20'); fr(x, 2, 0, 6, 6, '#c01020', 1); x.fillStyle = '#e83040'; x.fillRect(3, 1, 2, 2); });
  gib('candle', 8, 16, x => { fr(x, 1, 6, 6, 10, '#e8e0c0', 1); fr(x, 3, 3, 2, 3, '#222'); fr(x, 2, 0, 4, 4, '#ffd060'); x.fillStyle = '#fff8c0'; x.fillRect(3, 1, 2, 2); });

  /* Обломки от взрыва: не мясо, а кусок стены или мусор с пола. Три силуэта,
     чтобы разлёт не выглядел одинаковыми квадратами. */
  gib('debris0', 10, 8, x => { fr(x, 1, 1, 8, 6, '#6a6f78', 1); fr(x, 1, 1, 8, 2, '#98a0aa'); fr(x, 3, 5, 3, 2, '#3a4048'); });
  gib('debris1', 8, 10, x => { fr(x, 1, 2, 6, 7, '#5a5f66', 1); fr(x, 1, 2, 2, 7, '#8a929c'); fr(x, 4, 6, 3, 3, '#33383e'); });
  gib('debris2', 12, 6, x => { fr(x, 0, 1, 11, 4, '#4a4f56', 1); fr(x, 0, 1, 11, 1, '#7a828c'); fr(x, 6, 3, 4, 2, '#2e3238'); });

  // Монета — только значок золота на HUD: в мире деньги объёмные (см. src/cave/money.js)
  gib('coin', 10, 10, x => {
    fr(x, 2, 1, 6, 8, '#d8a020'); fr(x, 3, 0, 4, 10, '#d8a020');
    fr(x, 3, 1, 4, 3, '#ffe070'); fr(x, 3, 6, 4, 3, '#a06c10');
    x.fillStyle = '#7a4c08'; x.fillRect(4, 4, 2, 2);
  });

  /* Столб света из дыры в своде. Мягкого градиента здесь быть не может:
     спрайты рисуются с alphaTest, и плавный край всё равно обрежется по
     порогу. Поэтому свет набран вертикальными полосами убывающей плотности —
     ровно как рисовали лучи в спрайтовых играх, и край выглядит нарочным. */
  gib('lightShaft', 64, 256, x => {
    /* Биллборд кладётся низом кадра к полу и переворачивает картинку по
       вертикали, поэтому узкий яркий конец луча рисуется ВНИЗУ холста —
       в мире он окажется у дыры в своде, а размытый широкий низ ляжет на пол. */
    const band = (w, a) => {
      const g = x.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, `rgba(255,228,180,${a * .3})`);
      g.addColorStop(.4, `rgba(255,236,196,${a * .6})`);
      g.addColorStop(1, `rgba(255,246,220,${a})`);
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(32 - w * .9, 0); x.lineTo(32 + w * .9, 0);
      x.lineTo(32 + w / 2, 256); x.lineTo(32 - w / 2, 256);
      x.closePath(); x.fill();
    };
    band(34, .15); band(20, .21); band(9, .32);
  });
  // трава и светящиеся грибы: ставятся только там, где до пола достаёт свет
  gib('grassTuft', 26, 18, x => {
    for (let i = 0; i < 9; i++) {
      const bx = 2 + i * 2.6, h = rnd(7, 17);
      line(x, bx, 18, bx + rnd(-3, 3), 18 - h, rnd(1, 2), pick(['#4a6a28', '#3a5420', '#5c7c32', '#2e4418']));
    }
  });
  gib('shroom', 18, 22, x => {
    fr(x, 7, 10, 4, 12, '#d8d0c0');
    x.fillStyle = '#7ad8f0'; x.beginPath(); x.ellipse(9, 10, 8, 6, 0, Math.PI, 0); x.fill();
    x.fillStyle = '#c8f4ff'; x.beginPath(); x.ellipse(9, 10, 5, 3.5, 0, Math.PI, 0); x.fill();
    x.fillStyle = '#4aa0c0'; x.fillRect(4, 9, 2, 1); x.fillRect(12, 9, 2, 1);
  });

  // капля крови для частиц: одиночный пиксельный кружок
  gib('drop', 4, 4, x => { fr(x, 0, 0, 4, 4, '#8c0a0c'); });
  gib('spark', 4, 4, x => { fr(x, 0, 0, 4, 4, '#ffd070'); });
}

/* Куски, на которые разлетается тело. Только мясо, кости и конечности: ничего
   «именного» вроде шляпы или оружия, иначе из любого врага сыплется чужой инвентарь.
   Своё добавляется через gibExtra в описании врага. */
export const gibsFor = (kind) => kind === 'meat'
  // нечеловеческая туша: только мясо, рёбра и потроха — ни рук, ни кистей
  ? ['gib_meat0', 'gib_meat1', 'gib_meat2', 'gib_gut']
  : kind.startsWith('woman') || kind.startsWith('claw')
  ? ['gib_armW', 'gib_legW', 'gib_torsoW', 'gib_ribs', 'gib_meat0', 'gib_meat1', 'gib_meat2', 'gib_gut', 'gib_hand', 'gib_eye']
  : ['gib_arm', 'gib_leg', 'gib_torso', 'gib_ribs', 'gib_meat0', 'gib_meat1', 'gib_meat2', 'gib_gut', 'gib_hand', 'gib_eye'];
export const headFor = (kind) => kind.startsWith('woman') || kind.startsWith('claw')
  ? pick(['head_woman', 'head_woman2', 'head_woman3']) : pick(['head_peasant', 'head_peasant2']);
