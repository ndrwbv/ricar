/* Песочница: панель разработчика поверх игры (F1), статистика (F2), полёт (F6), заморозка врагов (F7). */
import * as THREE from 'three';
import { DEFS } from '../engine/enemydefs.js';
import { saveSettings } from '../engine/settings.js';
import { mouse, keys } from '../engine/input.js';

export function initSandbox(game, panel, stats) {
  const g = game;
  g.sandboxOpen = false;
  stats.hidden = false;
  panel.innerHTML = `
    <div class="sb-title">ПЕСОЧНИЦА <span class="dim">F1 — скрыть · F2 — статистика · F6 — полёт · F7 — заморозить врагов · F5 — перезапуск · ⌘/Ctrl (зажать) — облёт сцены камерой: мышь вращает, колесо приближает, WASD/QE двигают точку обзора</span></div>
    <div class="sb-row"><b>Спавн у прицела</b> ${Object.keys(DEFS).map(k => `<button data-spawn="${k}">${k}</button>`).join('')} <label><input type="checkbox" id="sbAlerted" checked> сразу агрессивны</label></div>
    <div class="sb-row"><b>Игрок</b> <button data-act="heal">лечить</button> <button data-act="gun">дать пистолет</button> <button data-act="shotgun">дать дробовик</button> <button data-act="rocket">дать ракетницу</button> <button data-act="ammo">+патроны</button>
      <label><input type="checkbox" data-mod="god"> бессмертие</label> <label><input type="checkbox" data-mod="infiniteAmmo"> беск. патроны</label> <label><input type="checkbox" data-mod="noclip"> полёт</label>
      <label><input type="checkbox" data-set="dmgNumbers"> урон врагу</label> <label><input type="checkbox" data-set="dmgTaken"> полученный урон</label></div>
    <div class="sb-row"><b>Враги</b> <button data-act="killAll">убить всех</button> <button data-act="wakeAll">разбудить всех</button> <button data-act="staggerAll">оглушить всех</button>
      <label><input type="checkbox" data-mod="enemiesFrozen"> стоят</label> <label><input type="checkbox" data-mod="flanking" checked> фланги</label></div>
    <div class="sb-row"><b>Время</b> <button data-pace=".25">×0.25</button> <button data-pace=".5">×0.5</button> <button data-pace="1">×1</button> <button data-pace="2">×2</button>
      <b>Телепорт</b> <button data-act="tpStart">на старт</button> <button data-act="tpEnemy">к ближайшему врагу</button> <span id="sbTriggers"></span></div>
    <div class="sb-row"><b>Кровь</b> <button data-act="clearGore">очистить</button> <button data-act="burst">взрыв тела у прицела</button>
      <b>Окружение</b> <span id="sbEnvs"></span> <button data-act="reload">перезагрузить уровень</button> <a href="./editor.html?level=${encodeURIComponent(g.levelData?.id || '')}" class="btn">открыть в редакторе</a></div>
    <div class="sb-row dim" id="sbInfo"></div>`;
  panel.hidden = true;

  const aimPoint = () => {
    const p = g.player, d = p.aimDir();
    const h = g.world.raycast(p.pos.x, p.eye, p.pos.z, d.x, d.y, d.z, 40);
    const t = h ? Math.max(0, h.t - .6) : 6;
    return [p.pos.x + d.x * t, p.pos.z + d.z * t];
  };
  const refreshEnvs = () => {
    document.getElementById('sbEnvs').innerHTML = Object.keys(g.level?.envs || {}).map(k => `<button data-env="${k}">${k}</button>`).join('');
    document.getElementById('sbTriggers').innerHTML = (g.levelData?.triggers || []).slice(0, 8).map((t, i) => `<button data-tp="${i}" title="триггер ${i}">т${i}</button>`).join('');
    document.getElementById('sbInfo').textContent = `уровень ${g.levelData?.id}: ${g.levelData?.objects?.length || 0} объектов, ${g.enemies.list.length} врагов, триггеров ${g.levelData?.triggers?.length || 0}, правил ${g.levelData?.rules?.length || 0}`;
  };
  refreshEnvs();
  for (const cb of panel.querySelectorAll('[data-mod]')) { cb.checked = !!g.mods[cb.dataset.mod] || (cb.dataset.mod === 'flanking' && g.mods.flanking !== false); cb.onchange = () => { g.mods[cb.dataset.mod] = cb.checked; }; }
  // отладочные показы урона живут в настройках, чтобы сохраняться между запусками
  for (const cb of panel.querySelectorAll('[data-set]')) { cb.checked = !!g.settings[cb.dataset.set]; cb.onchange = () => { g.settings[cb.dataset.set] = cb.checked; saveSettings(g.settings); }; }

  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const p = g.player;
    if (b.dataset.spawn) { const [x, z] = aimPoint(); g.enemies.spawn(b.dataset.spawn, x, z, { alerted: document.getElementById('sbAlerted').checked, tag: 'sb' }); }
    if (b.dataset.pace) g.paceMul = +b.dataset.pace;
    if (b.dataset.env) g.setEnvironment(g.level.envs[b.dataset.env]);
    if (b.dataset.tp !== undefined) { const t = g.levelData.triggers[+b.dataset.tp]; const x = t.x ?? (t.x0 + t.x1) / 2, z = t.z ?? (t.z0 + t.z1) / 2; g.teleport(x, 0, z + (t.r ? t.r + 1 : 0), p.yaw); }
    switch (b.dataset.act) {
      case 'heal': p.hp = p.maxHp; break;
      case 'gun': p.giveWeapon('pistol'); break;
      case 'shotgun': p.giveWeapon('shotgun'); break;
      case 'rocket': p.giveWeapon('rocket'); break;
      case 'ammo': for (const k of p.gunList()) p.giveAmmo(k, 48); break;
      case 'killAll': for (const en of g.enemies.alive()) en.hurt(9999, new THREE.Vector3(0, 0, 1), { heavy: Math.random() < .5, headshot: Math.random() < .3 }); break;
      case 'wakeAll': for (const en of g.enemies.alive()) if (!en.alerted) en.wake(); break;
      case 'staggerAll': for (const en of g.enemies.alive()) { en.state = 'stagger'; en.staggered = true; en.staggerT = 8; en.stateT = 0; en.setAnim('pain'); } break;
      case 'tpStart': { const s = g.level.start; g.teleport(s.x, s.y || 0, s.z, s.yaw || 0); break; }
      case 'tpEnemy': { let best = null, bd = 1e9; for (const en of g.enemies.alive()) { const d = en.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = en; } } if (best) g.teleport(best.pos.x + 3, 0, best.pos.z + 3, Math.atan2(-(best.pos.x - best.pos.x - 3), -(-3))); break; }
      case 'clearGore': g.gore.clear(); break;
      case 'burst': { const [x, z] = aimPoint(); g.gore.burst(x, 0, z, 0, 0, ['gib_arm', 'gib_leg', 'gib_torso', 'gib_ribs', 'gib_meat0', 'gib_gut'], 10, 1); break; }
      case 'reload': g.loadLevel(g.levelData.id).then(refreshEnvs); break;
    }
  });

  const toggle = () => {
    g.sandboxOpen = !g.sandboxOpen; panel.hidden = !g.sandboxOpen;
    if (g.sandboxOpen) { document.exitPointerLock?.(); g.paused = false; document.getElementById('pause').hidden = true; }
    else document.getElementById('gl').requestPointerLock?.();
  };
  window.addEventListener('keydown', e => {
    if (e.code === 'F1' || e.code === 'Backquote') { e.preventDefault(); toggle(); }
    if (e.code === 'F2') { e.preventDefault(); stats.hidden = !stats.hidden; }
    if (e.code === 'F5') { e.preventDefault(); g.loadLevel(g.levelData.id).then(refreshEnvs); }
    if (e.code === 'F6') { e.preventDefault(); g.mods.noclip = !g.mods.noclip; panel.querySelector('[data-mod="noclip"]').checked = g.mods.noclip; }
    if (e.code === 'F7') { e.preventDefault(); g.mods.enemiesFrozen = !g.mods.enemiesFrozen; panel.querySelector('[data-mod="enemiesFrozen"]').checked = g.mods.enemiesFrozen; }
  });

  /* Облёт сцены: зажатый ⌘ (или Ctrl) отцепляет камеру от героя и разрешает
     осмотреть уровень со стороны. Мышь вращает вокруг точки обзора, колесо
     приближает, WASD/QE двигают саму точку. Отпустил — камера вернулась к герою. */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const orbit = { on: false, yaw: 0, pitch: -.45, dist: 7, cx: 0, cy: 1.6, cz: 0 };
  const startOrbit = () => {
    if (orbit.on) return;
    orbit.on = true;
    const p = g.player;
    orbit.cx = p.pos.x; orbit.cy = p.pos.y + 1.6; orbit.cz = p.pos.z;
    orbit.yaw = p.yaw; orbit.pitch = clamp(p.pitch - .25, -1.4, 1.4);
    g.camOrbit = true;
  };
  const stopOrbit = () => { orbit.on = false; g.camOrbit = false; g.camOverride = null; };
  window.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && g.running) startOrbit(); });
  window.addEventListener('keyup', e => { if (!e.metaKey && !e.ctrlKey) stopOrbit(); });
  window.addEventListener('blur', stopOrbit);

  return {
    update(dt) {
      if (!orbit.on) { g.camOverride = null; return; }
      // мышь и колесо забираем себе, чтобы герой не крутился вместе с камерой
      orbit.yaw -= mouse.dx * .004;
      orbit.pitch = clamp(orbit.pitch - mouse.dy * .004, -1.45, 1.45);
      if (mouse.wheel) orbit.dist = clamp(orbit.dist * (1 + mouse.wheel * .14), 1.2, 80);
      mouse.dx = 0; mouse.dy = 0; mouse.wheel = 0;
      g.player.frozen = Math.max(g.player.frozen, .08);
      // точка обзора двигается в плоскости взгляда камеры
      const sp = (keys.dash ? 26 : 10) * dt;
      const fx = -Math.sin(orbit.yaw), fz = -Math.cos(orbit.yaw);
      const mv = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0), st = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      orbit.cx += (fx * mv + Math.cos(orbit.yaw) * st) * sp;
      orbit.cz += (fz * mv - Math.sin(orbit.yaw) * st) * sp;
      if (keys.jump) orbit.cy += sp;
      if (keys.use) orbit.cy -= sp;
      const cp = Math.cos(orbit.pitch);
      const dx = -Math.sin(orbit.yaw) * cp, dy = Math.sin(orbit.pitch), dz = -Math.cos(orbit.yaw) * cp;
      g.camOverride = (cam) => {
        cam.position.set(orbit.cx - dx * orbit.dist, orbit.cy - dy * orbit.dist, orbit.cz - dz * orbit.dist);
        cam.rotation.order = 'YXZ';
        cam.rotation.set(orbit.pitch, orbit.yaw, 0);
      };
    },
    refresh: refreshEnvs,
  };
}
