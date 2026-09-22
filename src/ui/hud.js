/* HUD без единой надписи: только иконки и полосы, как просили.
   Слева внизу — иконка аптечки и полоса здоровья, справа внизу — иконка текущего
   оружия и патроны отдельными гильзами. В центре — точка прицела; когда враг
   оглушён, вокруг точки сходятся четыре красных клина (это и есть «можно добить»).
   Никаких сообщений, подсказок, задач, счётчиков и анонсов убийств: методы msg/hint/
   objective/announce оставлены пустыми, чтобы уровни и песочница не ломались.

   Рисуется на канвасе в том же низком разрешении, что и сцена. */
import * as THREE from 'three';
import { SPR } from '../engine/sprites.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const el = id => document.getElementById(id);

// иконки оружия: что рисовать и в какую ширину вписывать (в единицах u)
const WEAPON_ICON = {
  sword: { spr: 'icon_sword', h: 26 },
  pistol: { spr: 'pickup_pistol', h: 17 },
  shotgun: { spr: 'pickup_shotgun', h: 14 },
  rocket: { spr: 'pickup_rocket', h: 14 },
};

export class HUD {
  constructor(game, canvas) {
    this.g = game; this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.splats = [];            // кровь на экране
    this.painT = 0; this.healT = 0;
    this.killFlash = 0;
    this.popT = 0; this.popSpr = null;   // всплывающая иконка подобранного предмета
    this.floats = [];                    // цифры урона (включаются в настройках)
    this.takenT = 0; this.takenN = 0;
    this._v = new THREE.Vector3();
    this.time = 0;
  }
  resize(w, h) { this.cv.width = w; this.cv.height = h; }

  screenBlood(n) {
    if (this.g.settings && this.g.settings.screenBlood === false) return;
    for (let i = 0; i < 1 + n; i++) {
      this.splats.push({ x: rnd(.05, .95), y: rnd(.05, .95), r: rnd(.015, .045) * (1 + n * .1), life: rnd(1.8, 3.2), max: 0, drips: Array.from({ length: 1 + (Math.random() * 2 | 0) }, () => ({ dx: rnd(-.6, .6), len: rnd(.04, .2), sp: rnd(.02, .07) })), t: 0 });
      this.splats[this.splats.length - 1].max = this.splats[this.splats.length - 1].life;
    }
    if (this.splats.length > 18) this.splats.splice(0, this.splats.length - 18);
  }
  pain(a) { this.painT = Math.min(1, this.painT + a); const p = el('pain'); p.style.opacity = Math.min(1, this.painT).toFixed(2); }
  flashHeal() { this.healT = .5; }
  kill() { this.killFlash = .25; }

  // подобрали предмет — иконка всплывает над центром экрана, без слов
  pop(kind) {
    const map = { health: 'pickup_health', ammo: 'pickup_ammo', shells: 'pickup_shells', gun: 'pickup_pistol', shotgun: 'pickup_shotgun', rocket: 'pickup_rocket', rockets: 'pickup_rockets', cloth: 'pickup_cloth' };
    const s = SPR[map[kind] || kind];
    if (!s) return;
    this.popSpr = s.canvas; this.popT = 1;
  }

  /* Цифры урона — единственный текст в бою, и он выключен по умолчанию
     (настройки → «Отладка»). Врагу цифра всплывает над телом, полученный урон —
     у прицела. */
  damageNumber(e, dmg, part) {
    if (!this.g.settings?.dmgNumbers) return;
    this.floats.push({ x: e.pos.x, y: e.pos.y + e.type.h * .9, z: e.pos.z, n: Math.round(dmg), t: 1, crit: part === 'head', dx: rnd(-.3, .3) });
    if (this.floats.length > 24) this.floats.shift();
  }
  damageTaken(n) {
    if (!this.g.settings?.dmgTaken) return;
    this.takenN = Math.round(n); this.takenT = 1.1;
  }

  // надписей в игре нет — заглушки, чтобы уровни/песочница/подбор не падали
  announce() {}
  msg() {}
  hint() {}
  objective() {}

  update(dt) {
    this.time += dt;
    if (this.painT > 0) { this.painT = Math.max(0, this.painT - dt * 1.6); el('pain').style.opacity = (this.painT * .9).toFixed(2); }
    this.healT = Math.max(0, this.healT - dt);
    this.killFlash -= dt;
    this.popT = Math.max(0, this.popT - dt * 1.2);
    this.takenT = Math.max(0, this.takenT - dt);
    for (let i = this.floats.length - 1; i >= 0; i--) { const f = this.floats[i]; f.t -= dt * .8; f.y += dt * .9; f.x += f.dx * dt; if (f.t <= 0) this.floats.splice(i, 1); }
    for (let i = this.splats.length - 1; i >= 0; i--) { const s = this.splats[i]; s.life -= dt; s.t += dt; if (s.life <= 0) this.splats.splice(i, 1); }
  }

  /* ─── кирпичики оформления ─── */
  // тёмная плашка с бронзовой рамкой: панели Bonehold сделаны так же
  panel(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(6,7,9,.66)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(122,98,54,.85)';
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x + 1, y + 1, w - 2, 1);
  }
  // спрайт вписывается по высоте, без сглаживания
  sprite(name, x, y, h) {
    const s = SPR[name]; if (!s) return 0;
    const k = h / s.h, w = s.w * k;
    this.ctx.drawImage(s.canvas, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    return w;
  }
  // ряд патронов: заполненные и пустые гнёзда
  pips(x, y, n, filled, pw, ph, gap, col) {
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const px = Math.round(x + i * (pw + gap));
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(px - 1, Math.round(y) - 1, pw + 2, ph + 2);
      ctx.fillStyle = i < filled ? col : 'rgba(255,255,255,.12)';
      ctx.fillRect(px, Math.round(y), pw, ph);
    }
  }

  /* Полоса стамины меча. Без цифр, как и всё здесь: тёмная часть слева до
     насечки — запас, которого на замах ещё не хватает; дальше идёт разгон
     от тусклой бронзы к белому калёному. Полная полоса пульсирует — значит
     следующий удар сокрушительный. Пустая мигает красным, если пытались бить. */
  staminaBar(p, x, y, w, h, u) {
    const ctx = this.ctx;
    const f = Math.max(0, Math.min(1, p.stamina / p.staminaMax));
    const minF = Math.max(0, Math.min(1, p.staminaMin / p.staminaMax));
    const ready = f >= minF;
    const full = f > .985;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#16120a'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    // сколько накоплено
    const iw = w - 2, fw = Math.round(iw * f);
    if (fw > 0) {
      if (!ready) ctx.fillStyle = p.staminaBlink > 0 && Math.sin(this.time * 30) > 0 ? '#ff4040' : '#5c2a16';
      else if (full) ctx.fillStyle = Math.sin(this.time * 9) > 0 ? '#fff4c0' : '#ffd060';
      else { const k = (f - minF) / Math.max(.01, 1 - minF); ctx.fillStyle = k > .6 ? '#ffc040' : k > .3 ? '#d08830' : '#9a6a28'; }
      ctx.fillRect(x + 1, y + 1, fw, h - 2);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x + 1, y + 1, fw, 1);
    }
    // насечка порога: левее неё замах не начинается
    ctx.fillStyle = ready ? 'rgba(0,0,0,.6)' : 'rgba(255,90,60,.9)';
    ctx.fillRect(Math.round(x + 1 + iw * minF), y, Math.max(1, Math.round(u)), h);
    // накопили полную — по краям загораются клинья
    if (full) {
      ctx.fillStyle = '#fff4c0';
      const t = Math.max(1, Math.round(1.5 * u));
      ctx.fillRect(x - t - 1, y, t, h); ctx.fillRect(x + w + 1, y, t, h);
    }
  }

  draw() {
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height, p = this.g.player;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    if (!this.g.running) return;

    // кровь на экране
    for (const s of this.splats) {
      const a = Math.min(1, s.life / s.max * 1.4) * .6;
      ctx.fillStyle = `rgba(120,6,10,${a})`;
      const x = s.x * W, y = s.y * H, r = s.r * H;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * .8, 0, 0, 7); ctx.fill();
      for (const d of s.drips) {
        const len = Math.min(d.len, s.t * d.sp) * H;
        ctx.fillRect(x + d.dx * r - 2, y, 3, len);
        ctx.beginPath(); ctx.arc(x + d.dx * r - .5, y + len, 3, 0, 7); ctx.fill();
      }
    }
    if (p.dead) return;

    const u = H / 360;                        // единица под низкое разрешение
    const cx = W / 2, cy = H / 2;

    // ── прицел ──
    const ft = p.finisherTarget;
    const dr = Math.max(1.5, 1.6 * u);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(Math.round(cx - dr - 1), Math.round(cy - dr - 1), Math.round(dr * 2 + 2), Math.round(dr * 2 + 2));
    ctx.fillStyle = ft ? '#ff3030' : this.g.aimEnemy ? '#ff6060' : 'rgba(255,255,255,.95)';
    ctx.fillRect(Math.round(cx - dr), Math.round(cy - dr), Math.round(dr * 2), Math.round(dr * 2));
    // добивание: четыре клина сходятся к точке — вместо надписи
    if (ft) {
      const pulse = 8 * u + Math.sin(this.time * 12) * 2.5 * u;
      const len = 5 * u, th = Math.max(1, 1.6 * u);
      ctx.fillStyle = `rgb(255,${60 + Math.sin(this.time * 14) * 50 | 0},40)`;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const bx = cx + dx * pulse, by = cy + dy * pulse;
        if (dx) ctx.fillRect(Math.round(bx - (dx < 0 ? len : 0)), Math.round(by - th / 2), Math.round(len), Math.round(th));
        else ctx.fillRect(Math.round(bx - th / 2), Math.round(by - (dy < 0 ? len : 0)), Math.round(th), Math.round(len));
      }
    }

    // ── слева внизу: здоровье ──
    const PW = 116 * u, PH = 30 * u, PY = H - PH - 6 * u;
    this.panel(6 * u, PY, PW, PH);
    this.sprite('pickup_health', 12 * u, PY + 5 * u, 20 * u);
    const hpF = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const bx = 32 * u, bw = PW - 32 * u, bh = 10 * u, by = PY + PH / 2 - bh / 2;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#2a0808'; ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
    const low = hpF <= .25 && Math.sin(this.time * 12) > 0;
    ctx.fillStyle = this.healT > 0 ? '#ffe090' : hpF > .5 ? '#b81c24' : hpF > .25 ? '#e06018' : low ? '#ff6060' : '#8a1010';
    ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * hpF), bh - 2);
    // насечки: полоса читается без цифр
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    for (let i = 1; i < 10; i++) ctx.fillRect(Math.round(bx + 1 + (bw - 2) * i / 10), by + 1, 1, bh - 2);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(bx + 1, by + 1, bw - 2, 1);

    // ── справа внизу: оружие и патроны ──
    const QX = W - PW - 6 * u;
    this.panel(QX, PY, PW, PH);
    /* Иконки по рукам: меч слева в панели (он и в игре в левой руке), ствол правее.
       В режиме «обе руки» видно обе, неактивная — притушена. */
    let ix = QX + 6 * u;
    const drawIcon = (kind, dim) => {
      const ic = WEAPON_ICON[kind]; if (!ic) return;
      if (dim) ctx.globalAlpha = .3;
      ix += this.sprite(ic.spr, ix, PY + PH / 2 - ic.h * u / 2, ic.h * u) + 3 * u;
      ctx.globalAlpha = 1;
    };
    if (p.hasSwordOut) drawIcon('sword', false);
    if (p.hasGunOut) drawIcon(p.gunKind, false);
    if (!p.hasSwordOut && !p.hasGunOut) drawIcon('sword', true);
    const gn = p.hasGunOut ? p.gun() : null;
    if (gn) {
      const mag = p.magSize(), pw = Math.max(2, 3 * u), ph = Math.max(4, 9 * u);
      const px0 = Math.max(ix, QX + 40 * u), room = QX + PW - 6 * u - px0;
      const gap = Math.max(1, Math.min(2.5 * u, room / mag - pw));
      this.pips(px0, PY + 5 * u, mag, gn.mag, pw, ph, gap,
        p.reloadT > 0 ? '#c8a040' : gn.mag === 0 ? '#ff4040' : '#e8d8a8');
      // запас — тонкая полоска под гильзами
      const px1 = Math.max(ix, QX + 40 * u), rw = QX + PW - 6 * u - px1, ry = PY + PH - 9 * u;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(px1, ry, rw, 4 * u);
      ctx.fillStyle = '#7a6a3a';
      ctx.fillRect(px1 + 1, ry + 1, Math.round((rw - 2) * Math.min(1, gn.reserve / p.WEAPONS[p.gunKind].reserveMax)), 4 * u - 2);
      // перезарядка — бегущая полоса поверх гильз
      if (p.reloadT > 0) {
        const f = 1 - p.reloadT / p.WEAPONS[p.gunKind].reload;
        ctx.fillStyle = '#ffd070'; ctx.fillRect(px1, PY + 3 * u, Math.round(rw * f), Math.max(1, 1.5 * u));
      }
    }
    /* У меча патронов нет — вместо них стамина. Когда в руках ещё и ствол,
       полоса ужимается в тонкую ленту над самым низом панели, чтобы не лезть
       на гильзы. */
    if (p.hasSwordOut) {
      const sx = Math.max(ix, QX + 40 * u), sw = QX + PW - 6 * u - sx;
      if (gn) this.staminaBar(p, sx, PY + PH - 4.5 * u, sw, Math.max(2, 3 * u), u);
      else this.staminaBar(p, sx, PY + PH / 2 - 5 * u, sw, Math.max(5, 10 * u), u);
    }

    // ── подобранный предмет: иконка всплывает и тает ──
    if (this.popT > 0 && this.popSpr) {
      const a = Math.min(1, this.popT * 2), rise = (1 - this.popT) * 18 * u;
      ctx.save(); ctx.globalAlpha = a;
      const h = 26 * u, k = h / this.popSpr.height;
      ctx.drawImage(this.popSpr, Math.round(cx - this.popSpr.width * k / 2), Math.round(H * .66 - rise), Math.round(this.popSpr.width * k), Math.round(h));
      ctx.restore();
    }

    // ── цифры урона (только если включены в настройках) ──
    if (this.floats.length) {
      ctx.textAlign = 'center';
      for (const f of this.floats) {
        this._v.set(f.x, f.y, f.z).project(this.g.camera);
        if (this._v.z > 1) continue;
        const sx = (this._v.x * .5 + .5) * W, sy = (-this._v.y * .5 + .5) * H;
        const a = Math.min(1, f.t * 1.6);
        ctx.globalAlpha = a;
        ctx.font = `bold ${Math.round((f.crit ? 20 : 15) * u)}px Impact, Arial Narrow, sans-serif`;
        ctx.fillStyle = '#000'; ctx.fillText(f.n, sx + 1, sy + 1);
        ctx.fillStyle = f.crit ? '#ffd040' : '#ff6a4a'; ctx.fillText(f.n, sx, sy);
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
    }
    if (this.takenT > 0) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, this.takenT * 1.4);
      ctx.font = `bold ${Math.round(20 * u)}px Impact, Arial Narrow, sans-serif`;
      ctx.fillStyle = '#000'; ctx.fillText(`-${this.takenN}`, cx + 1, cy + 34 * u + 1);
      ctx.fillStyle = '#ff3030'; ctx.fillText(`-${this.takenN}`, cx, cy + 34 * u);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }

    /* Режимные счётчики. Вылазка по пещерам — единственный режим, где на
       экране обязаны быть цифры (золото и глубина), и рисует их он сам:
       в HUD об этом знать нечего. */
    this.g.hudExtra?.(ctx, W, H, u);

    // ── убийство: короткая красная рамка по краям кадра ──
    if (this.killFlash > 0) {
      const a = Math.max(0, this.killFlash) * 1.6, t = Math.round(3 * u);
      ctx.fillStyle = `rgba(200,20,20,${a * .5})`;
      ctx.fillRect(0, 0, W, t); ctx.fillRect(0, H - t, W, t); ctx.fillRect(0, 0, t, H); ctx.fillRect(W - t, 0, t, H);
    }
  }
}
