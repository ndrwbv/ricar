/* Ввод: клавиатура, мышь с pointer lock, колесо, геймпад (Steam Deck).
   Стрелки поворачивают камеру без мыши (для игры на клавиатуре и тестов). */

export const keys = Object.create(null);
export const mouse = { dx: 0, dy: 0, wheel: 0, left: false, right: false, middle: false, leftDown: 0, rightDown: 0, middleDown: 0 };
// геймпад: оси и одноразовые нажатия, снимаются потребителем
export const gamepad = {
  connected: false, id: '', mapping: '', raw: false,        // id/mapping — для страницы диагностики pad.html
  lx: 0, ly: 0, lx2: 0, ly2: 0,
  fire: false, alt: false, kick: false, kick2: false, mode: false, jump: false, dash: false,
  swap: false, reload: false, finish: false, use: false, pause: false, slot: 0,
  menuUp: false, menuDown: false, menuLeft: false, menuRight: false, menuOk: false, menuBack: false,
};
const pressed = new Set();   // одноразовые нажатия за кадр
const gpPrev = Object.create(null);   // прошлое состояние кнопок геймпада, по смыслу, а не по номеру
const padAxes = new Map();            // прошлые оси каждого пада — чтобы понять, на каком играют

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

/* Геймпад. Раскладка (Steam Deck, Xbox, DualShock):
   RT — правая рука (стрельба, в режиме меча — удар), LT — левая рука (в режиме ствола тоже стреляет,
   в режиме меча и «обе руки» — удар клинком), A — прыжок, B — рывок, X — перезарядка, Y — перебор стволов,
   LB — действие, RB — добивание, L3/R3 — пинок, Select — режим рук, Start — пауза,
   крестовина — меч / пистолет / дробовик / ракетница. В меню: крестовина и левый стик — выбор, A — нажать, B — назад.

   Браузер отдаёт две принципиально разные раскладки. Обычная (`mapping: 'standard'`) — кнопки по номерам
   из спецификации. Но если игра запущена мимо Steam (например прямо из десктоп-режима Deck'а), контроллер
   приезжает «сырым» драйвером: другой порядок кнопок, курки и крестовина живут на осях. Обе разбираются ниже,
   иначе ходьба и удары уезжают не туда. */
function pickPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const live = [];
  for (const p of pads) if (p && p.connected) live.push(p);
  if (!live.length) { padAxes.clear(); return null; }
  /* Падов может быть несколько сразу (виртуальный от Steam Input плюс «сырое» устройство),
     и молчащий может оказаться первым в списке. Главным считаем тот, на котором последним шевелились. */
  for (const p of live) {
    const prev = padAxes.get(p.index);
    let act = false;
    if (prev) for (let i = 0; i < p.axes.length; i++) if (Math.abs((p.axes[i] || 0) - (prev[i] || 0)) > .2) { act = true; break; }
    padAxes.set(p.index, Array.prototype.slice.call(p.axes));
    if (!act) for (const b of p.buttons) if (b && (b.pressed || b.value > .5)) { act = true; break; }
    if (act) pickPad.active = p.index;
  }
  return live.find(p => p.index === pickPad.active) || live.find(p => p.mapping === 'standard') || live[0];
}

export function pollGamepad() {
  const gp = pickPad();
  if (!gp) {
    gamepad.lx = gamepad.ly = gamepad.lx2 = gamepad.ly2 = 0;
    gamepad.fire = gamepad.alt = false;
    return;
  }
  gamepad.connected = true;
  gamepad.id = gp.id; gamepad.mapping = gp.mapping;
  // «сырая» раскладка: у неё оси под курки и крестовину, кнопок меньше полутора десятков
  const raw = gp.mapping !== 'standard' && gp.axes.length >= 6;
  gamepad.raw = raw;
  const ax = i => gp.axes[i] || 0;
  const btn = i => { const b = gp.buttons[i]; return !!(b && (b.pressed || b.value > .35)); };
  const dz = v => Math.abs(v) < .15 ? 0 : Math.sign(v) * (Math.abs(v) - .15) / .85;

  let lx, ly, rx, ry, lt, rt, dUp, dDown, dLeft, dRight, B;
  if (raw) {
    lx = ax(0); ly = ax(1); rx = ax(3); ry = ax(4);
    lt = ax(2) > -.4; rt = ax(5) > -.4;                       // курки-оси: покой -1, нажатие к +1
    const hx = ax(6), hy = ax(7);                             // крестовина тоже осями
    dLeft = hx < -.5; dRight = hx > .5; dUp = hy < -.5; dDown = hy > .5;
    B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 6, start: 7, l3: 9, r3: 10 };
  } else {
    lx = ax(0); ly = ax(1); rx = ax(2); ry = ax(3);
    lt = btn(6); rt = btn(7);
    dUp = btn(12); dDown = btn(13); dLeft = btn(14); dRight = btn(15);
    B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, l3: 10, r3: 11 };
  }

  gamepad.lx = dz(lx); gamepad.ly = dz(ly);
  const rdx = dz(rx), rdy = dz(ry);
  gamepad.lx2 = rdx * Math.abs(rdx); gamepad.ly2 = rdy * Math.abs(rdy);   // квадратичная кривая
  gamepad.fire = rt;                     // RT — правая рука: стрельба / рубка
  gamepad.alt = lt;                      // LT — левая рука: стрельба в режиме ствола, клинок в остальных

  const edge = (name, now) => { const was = gpPrev[name] || false; gpPrev[name] = now; return now && !was; };
  const a = edge('a', btn(B.a)), b = edge('b', btn(B.b));
  if (a) { gamepad.jump = true; gamepad.menuOk = true; }
  if (b) { gamepad.dash = true; gamepad.menuBack = true; }
  if (edge('y', btn(B.y))) gamepad.swap = true;
  if (edge('x', btn(B.x))) gamepad.reload = true;
  if (edge('rb', btn(B.rb))) gamepad.finish = true;
  if (edge('lb', btn(B.lb))) gamepad.use = true;
  if (edge('back', btn(B.back))) gamepad.mode = true;        // Select/View — переключить руки (меч / ствол / обе)
  if (edge('l3', btn(B.l3)) || edge('r3', btn(B.r3))) gamepad.kick = true;   // нажатие стиков — пинок
  if (edge('start', btn(B.start))) gamepad.pause = true;
  if (edge('up', dUp)) { gamepad.slot = 1; gamepad.menuUp = true; }          // крестовина: оружие в бою, выбор в меню
  if (edge('left', dLeft)) { gamepad.slot = 2; gamepad.menuLeft = true; }
  if (edge('right', dRight)) { gamepad.slot = 3; gamepad.menuRight = true; }
  if (edge('down', dDown)) { gamepad.slot = 4; gamepad.menuDown = true; }
  // левый стик тоже листает меню — крестовиной на Deck'е пользуются реже
  if (edge('stickUp', gamepad.ly < -.6)) gamepad.menuUp = true;
  if (edge('stickDown', gamepad.ly > .6)) gamepad.menuDown = true;
  if (edge('stickLeft', gamepad.lx < -.6)) gamepad.menuLeft = true;
  if (edge('stickRight', gamepad.lx > .6)) gamepad.menuRight = true;
}

// вызывается в конце кадра
export function flushInput() {
  pressed.clear();
  mouse.dx = mouse.dy = 0; mouse.wheel = 0;
  mouse.leftDown = mouse.rightDown = mouse.middleDown = 0;
  gamepad.kick = gamepad.kick2 = gamepad.mode = gamepad.jump = gamepad.dash = gamepad.swap = gamepad.reload = gamepad.finish = gamepad.use = gamepad.pause = false;
  gamepad.slot = 0;
  gamepad.menuUp = gamepad.menuDown = gamepad.menuLeft = gamepad.menuRight = gamepad.menuOk = gamepad.menuBack = false;
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
