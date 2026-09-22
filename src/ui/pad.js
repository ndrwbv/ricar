/* Страница диагностики геймпада (pad.html).

   Показывает всё, что отдаёт браузер (id, mapping, оси, кнопки), и рядом — как это
   разобрала игра (src/engine/input.js). Нужна, когда на Steam Deck «не работает ходьба»
   или удары уезжают не на те кнопки: сразу видно, пришла ли стандартная раскладка
   или «сырая», и какой оси соответствует стик. */
import { pollGamepad, flushInput, gamepad } from '../engine/input.js';

const out = document.getElementById('out');
const logBox = document.getElementById('log');
const log = [];

const bar = v => `<span class="bar"><i style="width:${Math.round((v + 1) / 2 * 100)}%"></i></span> ${v.toFixed(2)}`;
const flag = (name, on) => `<span class="${on ? 'on' : 'dim'}">${name}</span>`;

const ONESHOT = ['jump', 'dash', 'swap', 'reload', 'finish', 'use', 'mode', 'kick', 'pause', 'menuOk', 'menuBack', 'menuUp', 'menuDown', 'menuLeft', 'menuRight'];

function frame() {
  requestAnimationFrame(frame);
  pollGamepad();

  const pads = Array.prototype.filter.call(navigator.getGamepads ? navigator.getGamepads() : [], p => p && p.connected);
  let html = '';
  if (!pads.length) html = '<p class="dim">Контроллеров не видно. Нажми любую кнопку — браузер показывает геймпад только после нажатия.</p>';
  for (const p of pads) {
    const axes = Array.prototype.map.call(p.axes, (v, i) => `<tr><td>ось ${i}</td><td>${bar(v)}</td></tr>`).join('');
    const btns = Array.prototype.map.call(p.buttons, (b, i) => b.pressed || b.value > .1
      ? `<span class="on">${i}${b.value > 0 && b.value < 1 ? `(${b.value.toFixed(2)})` : ''}</span>` : `<span class="dim">${i}</span>`).join(' ');
    html += `<h2 style="font-size:15px">#${p.index} ${p.id}</h2>
      <p>mapping: <b>${p.mapping || '(пусто — «сырая» раскладка)'}</b> · осей ${p.axes.length} · кнопок ${p.buttons.length}</p>
      <table>${axes}</table>
      <p>кнопки: ${btns}</p>`;
  }

  html += `<h2 style="font-size:15px">Как разобрала игра</h2>
    <p>активный: <b>${gamepad.id || '—'}</b> · раскладка: <b>${gamepad.raw ? 'сырая' : gamepad.mapping || '—'}</b></p>
    <table>
      <tr><td>движение</td><td>x ${gamepad.lx.toFixed(2)} · y ${gamepad.ly.toFixed(2)}</td></tr>
      <tr><td>обзор</td><td>x ${gamepad.lx2.toFixed(2)} · y ${gamepad.ly2.toFixed(2)}</td></tr>
      <tr><td>курки</td><td>${flag('LT (левая рука)', gamepad.alt)} · ${flag('RT (правая рука)', gamepad.fire)}</td></tr>
    </table>`;
  out.innerHTML = html;

  for (const k of ONESHOT) if (gamepad[k]) { log.unshift(k); if (log.length > 12) log.pop(); }
  logBox.textContent = log.join('  ·  ') || '—';

  flushInput();
}
frame();
