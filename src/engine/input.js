/* Ввод: клавиатура, мышь с pointer lock, колесо, геймпад (Steam Deck).
   Стрелки поворачивают камеру без мыши (для игры на клавиатуре и тестов). */

export const keys = Object.create(null);
export const mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false, middle: false, leftDown: 0, rightDown: 0, middleDown: 0 };
// геймпад: оси и одноразовые нажатия, снимаются потребителем
export const gamepad = { connected: false, lx: 0, ly: 0, lx2: 0, ly2: 0, fire: false, alt: false, kick: false, kick2: false, mode: false, jump: false, dash: false, swap: false, reload: false, finish: false, use: false, pause: false, slot: 0 };
const pressed = new Set();   // одноразовые нажатия за кадр
const gpPrev = [];

const MAP = {
  KeyW: 'fwd', ArrowUp: 'lookUp', KeyS: 'back', ArrowDown: 'lookDown',
  KeyA: 'left', KeyD: 'right', ArrowLeft: 'turnL', ArrowRight: 'turnR',
  ShiftLeft: 'dash', ShiftRight: 'dash', Space: 'jump',
  KeyE: 'use', KeyF: 'finish', KeyQ: 'swap', Digit1: 'w1', Digit2: 'w2', Digit3: 'w3', Digit4: 'w4', KeyR: 'reload',
  KeyP: 'pixel', Escape: 'pause', Tab: 'tab', KeyM: 'map', Enter: 'enter',
};

export function initInput(canvas) {
  window.addEventListener('keydown', e => {
    const k = MAP[e.code];
    if (!k) return;
    if (!keys[k]) pressed.add(k);
    keys[k] = true;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', e => {
    const k = MAP[e.code];
    if (k) keys[k] = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.left = mouse.right = mouse.middle = false; });

  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) { mouse.left = true; mouse.leftDown++; }
    if (e.button === 1) { mouse.middle = true; mouse.middleDown++; }   // средняя кнопка — пинок в режиме «обе руки»
    if (e.button === 2) { mouse.right = true; mouse.rightDown++; }
    e.preventDefault();
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 1) mouse.middle = false;
    if (e.button === 2) mouse.right = false;
  });
  window.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('mousemove', e => {
    if (document.pointerLockElement === canvas) { mouse.dx += e.movementX; mouse.dy += e.movementY; }
  });
  window.addEventListener('wheel', e => { mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
  window.addEventListener('gamepadconnected', () => { gamepad.connected = true; });
}

export function once(k) {
  if (pressed.has(k)) { pressed.delete(k); return true; }
  return false;
}

/* Раскладка Steam Deck / Xbox (standard mapping):
   RT — правая рука (стрельба, в режиме меча — рубит), LT — левая рука (в режиме ствола тоже стреляет,
   в режиме меча и «обе руки» — удар клинком), A — прыжок, B — рывок, X — перезарядка, Y — перебор стволов,
   LB — действие, RB — добивание, L3/R3 — пинок, Select — режим рук, Start — пауза,
   крестовина — меч / пистолет / дробовик / ракетница. */
export function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) { gamepad.lx = gamepad.ly = gamepad.lx2 = gamepad.ly2 = 0; gamepad.fire = gamepad.alt = false; return; }
  gamepad.connected = true;
  const dz = v => Math.abs(v) < .15 ? 0 : Math.sign(v) * (Math.abs(v) - .15) / .85;
  gamepad.lx = dz(gp.axes[0] || 0); gamepad.ly = dz(gp.axes[1] || 0);
  const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
  gamepad.lx2 = rx * Math.abs(rx); gamepad.ly2 = ry * Math.abs(ry);   // квадратичная кривая
  const b = i => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > .35));
  // курки: в standard mapping это кнопки 6/7 с аналоговым value; у «сырых» линуксовых драйверов — оси 4/5 (-1 отпущен)
  const axisTrig = gp.buttons.length < 7 && gp.axes.length >= 6;
  const lt = axisTrig ? (gp.axes[4] || -1) > -.3 : b(6);
  const rt = axisTrig ? (gp.axes[5] || -1) > -.3 : b(7);
  const edge = i => { const now = b(i); const was = gpPrev[i] || false; gpPrev[i] = now; return now && !was; };
  gamepad.fire = rt;                     // RT — правая рука: стрельба / рубка
  gamepad.alt = lt;                      // LT — левая рука: стрельба в режиме ствола, клинок в остальных
  if (edge(0)) gamepad.jump = true;
  if (edge(1)) gamepad.dash = true;
  if (edge(3)) gamepad.swap = true;
  if (edge(2)) gamepad.reload = true;
  if (edge(5)) gamepad.finish = true;
  if (edge(4)) gamepad.use = true;
  if (edge(8)) gamepad.mode = true;      // Select/View — переключить руки (меч / ствол / обе)
  if (edge(10) || edge(11)) gamepad.kick = true;   // нажатие стиков — пинок
  if (edge(9)) gamepad.pause = true;
  if (edge(12)) gamepad.slot = 1;        // крестовина вверх — меч
  if (edge(14)) gamepad.slot = 2;        // влево — пистолет
  if (edge(15)) gamepad.slot = 3;        // вправо — дробовик
  if (edge(13)) gamepad.slot = 4;        // вниз — ракетница
}

// вызывается в конце кадра
export function flushInput() {
  pressed.clear();
  mouse.dx = mouse.dy = 0; mouse.wheel = 0;
  mouse.leftDown = mouse.rightDown = mouse.middleDown = 0;
  gamepad.kick = gamepad.kick2 = gamepad.mode = gamepad.jump = gamepad.dash = gamepad.swap = gamepad.reload = gamepad.finish = gamepad.use = gamepad.pause = false;
  gamepad.slot = 0;
}

export function lockPointer(canvas) {
  if (document.pointerLockElement !== canvas) {
    const swallow = p => { if (p && p.catch) p.catch(() => {}); };
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { swallow(canvas.requestPointerLock()); } catch (_) {} });
    } catch (e) { try { swallow(canvas.requestPointerLock()); } catch (_) {} }
  }
}
export const pointerLocked = canvas => document.pointerLockElement === canvas;
