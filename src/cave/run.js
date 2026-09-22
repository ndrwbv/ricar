/* Режим вылазок (game.html?mode=cave).

   Круг игры: привал перед скалой → шаг в зев → сгенерированная пещера →
   нашёл выход → итоги ходки → снова привал. Смерть обнуляет всё: счётчик
   пройденных пещер, золото и оружие.

   Здесь только оболочка: правила самой генерации живут в gen.js и docs/CAVE.md. */
import { generateCave } from './gen.js';
import { campLevel } from './camp.js';
import { Money } from './money.js';
import { SPR } from '../engine/sprites.js';
import { once, lockPointer } from '../engine/input.js';

const el = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function initCaveRun(game, glCanvas) {
  const S = {
    place: 'none',              // camp | cave
    depth: 0,                   // пройдено пещер
    money: 0,
    run: { kills: 0, taken: 0, time: 0, gold: 0 },
    leg: { kills: 0, gold: 0, time: 0 },
    bossDead: false,
    busy: false,
    map: false,
    mapCv: null, mapInfo: null,
    lastHp: 0,
    goldFlash: 0,
  };
  const money = new Money(game);
  money.onPick = (v) => { S.money += v; S.run.gold += v; S.leg.gold += v; S.goldFlash = 1; };
  game.money = money;

  /* ── переходы ── */
  /* Переход между уровнями. Экран гасится, мир меняется, экран возвращается.
     Всё тело в try/finally: любая осечка внутри без этого оставила бы игрока
     в чёрном экране навсегда — busy уже поднят, а опустить его некому. */
  const fadeTo = async (fn) => {
    if (S.busy) return;
    S.busy = true;
    game.fade(1, .45);
    await new Promise(r => setTimeout(r, 480));
    money.clear();
    try { await fn(); }
    catch (e) { console.error('переход не удался', e); await game.applyLevel(campLevel(), { keepPlayer: true, url: false }).then(afterLoad); S.place = 'camp'; }
    finally { game.fade(0, .5); S.busy = false; }
  };

  const toCamp = async () => {
    S.place = 'camp';
    await game.applyLevel(campLevel(), { keepPlayer: true, url: false });
    afterLoad();
  };

  const enterCave = () => fadeTo(async () => {
    S.place = 'cave';
    S.bossDead = false;
    S.leg = { kills: 0, gold: 0, time: 0 };
    /* Генератор изредка не складывает план и честно об этом сообщает. Пробуем
       другое зерно: это дешевле, чем разбирать полусобранную пещеру. */
    let data = null;
    for (let tryN = 0; tryN < 5 && !data; tryN++) {
      try { data = generateCave((Math.random() * 1e9) | 0, S.depth + 1); }
      catch (e) { console.warn('пещера не собралась, пробуем другое зерно', e.message); }
    }
    if (!data) throw new Error('генератор не дал уровень');
    guaranteeGun(data);
    await game.applyLevel(data, { keepPlayer: true, url: false });
    afterLoad();
  });

  /* Оружие копится между ходками, поэтому генератор про него ничего не знает
     и знать не должен. Одно правило всё же жёсткое: если ствола нет вовсе
     (начало вылазки или после смерти), в пещере обязан лежать пистолет —
     иначе рыцарь идёт на баронов с одним мечом. Кладём его в первый попавшийся
     некрупный зал: не у выхода и не посреди арены. */
  const guaranteeGun = (data) => {
    if (game.player.gunList().length) return;
    const rooms = data.cave?.rooms || [];
    const spot = rooms.find(r => r.kind === 'cache') || rooms.find(r => r.kind === 'hall');
    if (!spot) return;
    data.pickups.push({ kind: 'gun', x: spot.x, z: spot.z });
  };

  // меч остаётся всегда, стволы теряются вместе с вылазкой
  function stripGuns() {
    const p = game.player;
    for (const k of p.gunList()) delete p.guns[k];
    p.gunKind = null;
    p.weapon = 'sword';
  }

  const leaveCave = () => {
    // всё, что осталось лежать на полу, игрок уносит с собой — иначе выход
    // из пещеры означал бы «вернись и собери каждую монету»
    const rest = money.pickupAll();
    S.money += rest; S.run.gold += rest; S.leg.gold += rest;
    S.depth++;
    fadeTo(async () => {
      await toCamp();
      // привал лечит, но не досыта: пещеры должны накапливать усталость
      const p = game.player;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * .4);
      p.giveAmmo('pistol', 12);
      showStats();
    });
  };

  const afterLoad = () => {
    /* Убийства считаем поверх правил уровня: onKill у уровня уже занят
       (по нему работают триггеры «зачищено»), поэтому оборачиваем. */
    const L = game.level;
    const prev = L.onKill;
    L.onKill = (e) => { prev?.call(L, e); onKill(e); };
    S.lastHp = game.player.hp;
    /* Клады: генератор помечает закутки, а пачки денег кладёт режим —
       они живут в физике золота, а не в списке предметов уровня. */
    for (const st of game.levelData.cave?.stashes || []) {
      money.drop(st.x, .9, st.z, st.n, { power: .25 });
    }
    buildMap();
  };

  /* Из стреляющего врага падает то, из чего он стрелял. Часть врагов роняет
     свой ствол сама (это записано им в drop), у остальных там патроны или
     ничего — за них решаем здесь: пока такого оружия у героя нет, с убитого
     падает ствол, а когда уже есть — патроны к нему. Иначе рыцарь, начавший
     с одним мечом, так и ходил бы с мечом мимо стрелков. */
  const GUNS = { gun: 'pistol', shotgun: 'shotgun', rocket: 'rocket' };
  const dropShooterGun = (e) => {
    const st = e.def?.stats?.ranged;
    if (!st) return;
    const own = e.def.drop?.weapon?.kind;
    if (own && GUNS[own]) return;                       // свой ствол он уже уронил
    // чем тяжелее один выстрел, тем крупнее ствол: очередь мелким — пистолет
    const kind = st.dmg >= 14 ? 'shotgun' : 'gun';
    if (!game.player.hasWeapon(GUNS[kind])) {
      /* Ствол ИЛИ патроны, но не то и другое разом. Подобранный ствол сам
         приходит с боезапасом, и валявшаяся рядом обойма была просто мусором
         под ногами. Обратное неверно: патроны стволом не становятся, поэтому
         тем, у кого оружие уже есть, падает именно обойма.
         Свой дроп врага (у думовских стрелков это клип) при этом гасим:
         onKill вызывается до dropWeapon, так что достаточно отметить флаг. */
      e.weaponDropped = true;
      game.level.addPickup({ kind, x: e.pos.x, z: e.pos.z });
    } else if (!own && Math.random() < .28) {
      game.level.addPickup({ kind: kind === 'shotgun' ? 'shells' : 'ammo', x: e.pos.x, z: e.pos.z });
    }
  };

  const onKill = (e) => {
    if (S.place !== 'cave') return;
    S.run.kills++; S.leg.kills++;
    const boss = e.tag === 'boss';
    if (boss) S.bossDead = true;
    dropShooterGun(e);
    /* Цена головы — от её живучести: крестьянин даёт мелочь, барон окупает
       всю ходку. Разброс небольшой, чтобы добыча была предсказуемой. */
    /* Цена головы намеренно мелкая: главный доход — клады в закутках,
       а не отстрел. Иначе выгоднее всего зачищать пещеру подчистую, и вылазка
       превращается в ферму. У мини-босса здоровье уже раздуто множителем,
       так что его вдвое хватает за глаза. */
    const base = Math.max(1, Math.round((e.maxHp || 30) * .07 * rnd(.8, 1.2)));
    money.drop(e.pos.x, e.pos.y + .6, e.pos.z, boss ? base * 2 : base, { power: boss ? 1.5 : 1, big: boss });
  };

  /* ── экраны ── */
  const statRow = (k, v) => `<div class="cs-row"><span>${k}</span><b>${v}</b></div>`;
  const showStats = () => {
    game.running = false;
    document.exitPointerLock?.();
    el('caveStats').innerHTML = `
      <div class="title">ПЕЩЕРА ${S.depth}</div>
      <div class="sub">пройдена</div>
      <div class="cs-box">
        ${statRow('убито', S.leg.kills)}
        ${statRow('золота за ходку', S.leg.gold)}
        ${statRow('время', fmtTime(S.leg.time))}
        ${statRow('всего пещер', S.depth)}
        ${statRow('всего золота', S.money)}
        ${statRow('здоровье', `${Math.round(game.player.hp)} / ${game.player.maxHp}`)}
      </div>
      <button id="caveGo">ДАЛЬШЕ</button>
      <a href="./index.html" class="link">← в хаб</a>`;
    el('caveStats').hidden = false;
    el('caveGo').onclick = () => {
      el('caveStats').hidden = true;
      game.running = true;
      lockPointer(glCanvas);
    };
  };

  const showDeath = () => {
    el('caveDead').innerHTML = `
      <div class="title red">✖</div>
      <div class="sub">погиб на глубине ${S.depth + 1}</div>
      <div class="cs-box">
        ${statRow('пещер пройдено', S.depth)}
        ${statRow('убито всего', S.run.kills)}
        ${statRow('золота собрано', S.run.gold)}
        ${statRow('в этой пещере', S.leg.kills)}
        ${statRow('время вылазки', fmtTime(S.run.time))}
      </div>
      <button id="caveRetry">ЗАНОВО</button>
      <a href="./index.html" class="link">← в хаб</a>`;
    el('caveDead').hidden = false;
    el('caveRetry').onclick = () => { el('caveDead').hidden = true; resetRun(); };
  };

  const resetRun = async () => {
    S.depth = 0; S.money = 0;
    S.run = { kills: 0, taken: 0, time: 0, gold: 0 };
    S.leg = { kills: 0, gold: 0, time: 0 };
    const p = game.player;
    p.dead = false; p.hp = p.maxHp;
    stripGuns();
    await fadeTo(toCamp);
    game.running = true;
    lockPointer(glCanvas);
  };

  /* ── карта для отладки генерации (клавиша M) ──
     Рисуется один раз на уровень в отдельный канвас: по данным уровня, а не
     по геометрии, так что видно ровно то, что собрал генератор. */
  const buildMap = () => {
    const d = game.levelData;
    const b = d.bounds;
    const N = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const x = cv.getContext('2d');
    const sx = N / (b.x1 - b.x0), sz = N / (b.z1 - b.z0);
    const X = v => (v - b.x0) * sx, Z = v => (v - b.z0) * sz;
    x.fillStyle = 'rgba(6,6,8,.72)'; x.fillRect(0, 0, N, N);
    for (const o of d.objects || []) {
      if (o.t === 'floor' && !o.o?.ceiling) { x.fillStyle = 'rgba(150,120,90,.5)'; x.fillRect(X(o.x), Z(o.z), o.w * sx, o.d * sz); }
    }
    x.strokeStyle = 'rgba(230,200,160,.75)'; x.lineWidth = 1;
    for (const o of d.objects || []) {
      if (o.t !== 'wall' || o.y > .2) continue;
      x.beginPath(); x.moveTo(X(o.x0), Z(o.z0)); x.lineTo(X(o.x1), Z(o.z1)); x.stroke();
    }
    const dot = (wx, wz, col, r = 4) => { x.fillStyle = col; x.beginPath(); x.arc(X(wx), Z(wz), r, 0, 7); x.fill(); };
    for (const e of d.enemies || []) dot(e.x, e.z, e.tag === 'boss' ? '#ff3020' : 'rgba(255,90,60,.7)', e.tag === 'boss' ? 5 : 2);
    for (const p of d.pickups || []) dot(p.x, p.z, '#60ff90', 2.5);
    if (d.cave) { dot(d.cave.exit.x, d.cave.exit.z, '#40e0ff', 5); }
    dot(d.start.x, d.start.z, '#ffd050', 4);
    S.mapCv = cv;
    S.mapInfo = { b, sx, sz, N };
  };

  /* ── счётчики поверх боя ── золото и глубина числом: единственные цифры,
     которые в этом режиме нужны, и обе крупные, чтобы читались на бегу. */
  game.hudExtra = (ctx, W, H, u) => {
    const num = (s, x, y, size, col) => {
      ctx.font = `bold ${Math.round(size * u)}px Impact, Arial Narrow, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#000'; ctx.fillText(s, x + 1, y + 1);
      ctx.fillStyle = col; ctx.fillText(s, x, y);
      ctx.textAlign = 'left';
    };
    // золото
    const gx = W - 10 * u, gy = 26 * u;
    const flash = S.goldFlash > 0;
    num(String(S.money), gx, gy, 22, flash ? '#fff0b0' : '#ffd050');
    const cs = SPR.coin;
    if (cs) {
      const h = 16 * u, w = cs.w / cs.h * h;
      const tw = ctx.measureText(String(S.money)).width;
      ctx.drawImage(cs.canvas, Math.round(gx - tw - w - 5 * u), Math.round(gy - h), Math.round(w), Math.round(h));
    }
    // глубина
    if (S.place === 'cave') num(`${S.depth + 1}`, W - 10 * u, 48 * u, 15, '#b09a78');

    /* Указатель на выход. Появляется только после смерти мини-босса: до этого
       пещеру положено разведывать, а после — не положено плутать по уже
       зачищенным коридорам. */
    const c = game.levelData?.cave;
    if (S.place === 'cave' && S.bossDead && c) {
      const p = game.player;
      const dx = c.exit.x - p.pos.x, dz = c.exit.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      // курс на выход в системе экрана: 0 — прямо по взгляду, плюс — вправо
      const a = Math.atan2(dx, -dz) + p.yaw;
      const r = Math.min(W, H) * .21;
      const px = W / 2 + Math.sin(a) * r, py = H / 2 - Math.cos(a) * r;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = `rgba(64,224,255,${(.5 + Math.sin(game.time * 4) * .25).toFixed(2)})`;
      const s = 4 * u;
      ctx.beginPath(); ctx.moveTo(0, -s * 1.6); ctx.lineTo(s, s); ctx.lineTo(-s, s); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (d < 14) { ctx.globalAlpha = .5; ctx.fillStyle = '#40e0ff'; ctx.fillRect(px - 1, py - 1, 2, 2); ctx.globalAlpha = 1; }
    }

    // карта генерации
    if (S.map && S.mapCv) {
      const size = Math.min(W, H) * .58;
      const mx = W - size - 6 * u, my = H - size - 40 * u;
      ctx.globalAlpha = .92;
      ctx.drawImage(S.mapCv, Math.round(mx), Math.round(my), Math.round(size), Math.round(size));
      ctx.globalAlpha = 1;
      const b = S.mapInfo.b, p = game.player;
      const px = mx + (p.pos.x - b.x0) / (b.x1 - b.x0) * size;
      const py = my + (p.pos.z - b.z0) / (b.z1 - b.z0) * size;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(px - 2), Math.round(py - 2), 4, 4);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.sin(p.yaw) * 9, py - Math.cos(p.yaw) * 9); ctx.stroke();
    }
  };

  /* ── подмена концовок ── выход из пещеры и смерть в этом режиме значат
     не то же, что в обычном уровне, поэтому забираем оба обработчика себе. */
  game.onWin = () => {
    if (S.busy) return;
    if (S.place === 'camp') enterCave();
    else leaveCave();
  };
  game.onPlayerDeath = () => {
    setTimeout(() => {
      game.running = false;
      document.exitPointerLock?.();
      showDeath();
    }, 1600);
  };

  /* ── отладка генерации ── */
  const dbg = {
    state: S,
    regen: () => enterCave(),                      // новая пещера той же глубины
    deeper: (n = 1) => { S.depth += n; return enterCave(); },
    json: () => JSON.stringify(game.levelData, null, 1),
    save: () => {
      const blob = new Blob([JSON.stringify(game.levelData, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${game.levelData.id}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
  };
  game.cave = dbg;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F9') { e.preventDefault(); dbg.regen(); }
    if (e.code === 'F10') { e.preventDefault(); dbg.save(); }
  });

  // старт: с одним мечом на привале
  stripGuns();
  toCamp();

  return {
    update(dt) {
      if (once('map')) S.map = !S.map;
      S.goldFlash = Math.max(0, S.goldFlash - dt * 2);
      if (!game.running || game.paused) return;
      money.update(dt, game.camera);
      const p = game.player;
      if (p.hp < S.lastHp) S.run.taken += S.lastHp - p.hp;
      S.lastHp = p.hp;
      if (!p.dead) { S.run.time += dt; if (S.place === 'cave') S.leg.time += dt; }
    },
  };
}
