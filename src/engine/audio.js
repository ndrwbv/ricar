/* Звук: всё синтезируется WebAudio. Музыки и шагов нет намеренно —
   только удары, мясо, выстрелы, крики и сердцебиение.

   По умолчанию звук ВЫКЛЮЧЕН (настройки → Звук → «Звук»): пока идёт работа над
   механикой, играть и тестировать удобнее в тишине. Громкость — там же. */
let ac = null, master = null, muffle = null;
let volume = 0;          // 0 — тишина; ставится из настроек через setVolume()
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, +v || 0));
  if (master) master.gain.value = volume;
}
export const audioOn = () => volume > 0;
const ctx = () => {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    muffle = ac.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
    master = ac.createGain(); master.gain.value = volume;
    muffle.connect(master); master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
};
export const resumeAudio = () => { if (volume > 0) ctx(); };
// приглушение всего (сцена в спальне)
export function setMuffle(on) { if (volume <= 0) return; const c = ctx(); muffle.frequency.setTargetAtTime(on ? 500 : 20000, c.currentTime, .3); }

function env(node, t0, a, d, vol) {
  const g = ctx().createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(.0001, t0 + a + d);
  node.connect(g); g.connect(muffle);
  return g;
}
/* Отключить цепочку, когда источник доиграл. Без этого узлы остаются висеть на
   графе навсегда: WebAudio продолжает считать каждый из них, и после пары минут
   боя (особенно от очередей) звук начинает съедать заметную долю кадра. */
function release(src, nodes) {
  src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* уже отключён */ } } };
}
function tone(f0, f1, dur, type, vol, delay = 0) {
  if (volume <= 0) return;
  const c = ctx(); const t = c.currentTime + delay;
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = env(o, t, .005, dur, vol);
  o.start(t); o.stop(t + dur + .05);
  release(o, [o, g]);
}
let noiseBuf = null;
function noise(dur, vol, fLo, fHi, delay = 0, q = 1) {
  if (volume <= 0) return;
  const c = ctx(); const t = c.currentTime + delay;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  let node = s;
  const chain = [s];
  if (fHi) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fHi; f.Q.value = q; node.connect(f); node = f; chain.push(f); }
  if (fLo) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = fLo; node.connect(f); node = f; chain.push(f); }
  chain.push(env(node, t, .003, dur, vol));
  s.start(t); s.stop(t + dur + .05);
  release(s, chain);
}

export const SFX = {
  swing() { noise(.14, .25, 600, 4000); tone(300, 120, .12, 'sine', .05); },
  swingHeavy() { noise(.22, .35, 300, 3000); tone(200, 60, .2, 'sine', .1); },
  // меч по мясу: глухой удар + хлюп
  flesh() { tone(160, 40, .12, 'sine', .5); noise(.12, .4, 200, 1800); noise(.25, .18, 80, 600, .05); },
  // разруб / отсечение головы
  chop() { tone(120, 30, .18, 'sine', .7); noise(.18, .55, 150, 2400); noise(.4, .3, 60, 900, .06); tone(900, 200, .08, 'square', .06, .02); },
  // взрыв тела
  gibs() { tone(90, 25, .3, 'sine', .8); noise(.3, .6, 100, 1400); noise(.6, .35, 40, 700, .08); for (let i = 0; i < 5; i++) noise(.06, .2, 300, 2500, .1 + i * .07); },
  // пинок
  kick() { tone(140, 50, .1, 'sine', .5); noise(.08, .3, 100, 1200); },
  // стук о стену
  thud() { tone(80, 30, .15, 'sine', .5); noise(.1, .25, 60, 800); },
  // выстрел пистолета
  pistol() { noise(.09, .9, 200, 6000); tone(180, 40, .16, 'square', .35); tone(1200, 200, .05, 'sawtooth', .12); },
  // автомат врага (дальше и тише)
  rifle() { noise(.06, .3, 300, 5000); tone(150, 50, .1, 'square', .15); },
  // дробовик: тяжёлый выстрел и лязг помпы
  shotgun() { noise(.16, 1.0, 80, 4000); tone(110, 30, .3, 'square', .5); tone(60, 25, .35, 'sine', .7); noise(.06, .25, 1200, 6000, .45); tone(900, 600, .04, 'square', .12, .5); tone(700, 1000, .04, 'square', .12, .7); },
  // ракетница: хлопок и уходящий шип двигателя
  rocket() { noise(.4, .6, 120, 2400); tone(320, 70, .35, 'sawtooth', .3); tone(90, 40, .22, 'square', .35); },
  // взрыв: удар, долгий низкий гул и осколки
  explosion() { tone(140, 22, .75, 'sine', 1); tone(70, 20, .9, 'sine', .8, .02); noise(.5, .9, 40, 1400); noise(1.1, .35, 30, 500, .07); for (let i = 0; i < 6; i++) noise(.05, .18, 600, 5000, .08 + i * .06); },
  dry() { tone(800, 500, .03, 'square', .08); },
  reload() { tone(500, 300, .04, 'square', .1); tone(700, 900, .04, 'square', .1, .25); noise(.03, .15, 800, 4000, .25); },
  ricochet() { tone(1800, 400, .12, 'sine', .08); noise(.05, .12, 1500, 8000); },
  // рык / крик врага
  grunt(p = 1) { tone(180 * p, 90 * p, .22, 'sawtooth', .16); noise(.2, .08, 200, 1200); },
  scream(p = 1) { tone(520 * p, 220 * p, .35, 'sawtooth', .16); tone(700 * p, 300 * p, .3, 'square', .05, .05); },
  // боль героя
  hurt() { tone(90, 40, .2, 'sine', .6); noise(.15, .3, 80, 900); },
  pickup() { tone(400, 800, .08, 'square', .12); tone(600, 1200, .1, 'square', .12, .08); },
  heart() { tone(60, 35, .12, 'sine', .9); tone(55, 30, .12, 'sine', .7, .22); },
  portal() { for (let i = 0; i < 8; i++) tone(120 + i * 60, 60 + i * 30, .5, 'sine', .15, i * .1); noise(1.2, .2, 60, 500); },
  alert() { tone(400, 600, .08, 'square', .08); tone(400, 600, .08, 'square', .08, .12); },
  finisher() { noise(.3, .3, 80, 400); tone(50, 25, .4, 'sine', .6); },
  dash() { noise(.12, .18, 400, 3000); },
  land() { tone(70, 40, .08, 'sine', .3); },
};
