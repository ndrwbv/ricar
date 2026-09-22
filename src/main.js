/* Игра: game.html?level=<id>&mode=play|sandbox|cave
   Рендер, цикл, экраны, загрузка уровней из JSON, применение настроек.
   Режим cave — вылазка по сгенерированным пещерам (src/cave, правила в docs/CAVE.md):
   уровень в нём не читается с диска, а собирается генератором на лету. */
import * as THREE from 'three';
import { buildTextures, TEX, loadCustomTextures, initTextureQuality } from './engine/textures.js';
import { buildSprites } from './engine/sprites.js';
import { World } from './engine/world.js';
import { Gore } from './engine/gore.js';
import { FX } from './engine/fx.js';
import { Enemies } from './engine/enemies.js';
import { Player } from './engine/player.js';
import { Rockets } from './engine/rockets.js';
import { HUD } from './ui/hud.js';
import { initInput, flushInput, once, lockPointer, pointerLocked, pollGamepad, gamepad, keys, mouse } from './engine/input.js';
import { resumeAudio, setMuffle, setVolume } from './engine/audio.js';
import { loadEnemyDefs, loadGibs, buildSheet, buildTemplate, buildShield, swappableGibs, gibCanvas, builtinDefs } from './engine/enemydefs.js';
import { ViewModel } from './engine/viewmodel3d.js';
import { buildLevel, DEFAULT_ENVS, parseColor } from './engine/levelloader.js';
import { loadLevelData } from './engine/levelstore.js';
import { loadSettings } from './engine/settings.js';
import { Post } from './engine/post.js';
import { initSandbox } from './sandbox/sandbox.js';
import { initCaveRun } from './cave/run.js';

const el = id => document.getElementById(id);
const glCanvas = el('gl'), hudCanvas = el('hud');
const params = new URLSearchParams(location.search);
const MODE = ['sandbox', 'cave'].includes(params.get('mode')) ? params.get('mode') : 'play';
let LEVEL_ID = params.get('level') || 'sandbox';

const settings = loadSettings();
setVolume(settings.sound ? (settings.volume ?? .8) : 0);   // по умолчанию тихо
let pixelScale = +settings.pixelScale || .5;
const SCALES = [.5, .35, .75, 1];

const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(88, 16 / 9, .05, 400);
scene.add(camera);
const ambient = new THREE.AmbientLight(0x404040, 1);
const hemi = new THREE.HemisphereLight(0x606060, 0x202020, 1);
scene.add(ambient, hemi);
const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 12), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }));
sky.renderOrder = -10;
scene.add(sky);
// постобработка «как в Bonehold»: тонирование зоны, контраст, виньетка
const post = new Post(renderer);
post.enabled = settings.post !== false;
post.material.uniforms.uSteps.value = +settings.posterize || 0;

const game = {
  scene, camera, renderer, settings, mode: MODE, running: false, paused: false, won: false, time: 0, timeScale: 1, slowT: 0, slowV: 1, aimEnemy: null, tint: 0,
  mods: {
    enemyHp: settings.hpMul, enemySpeed: settings.speedMul, enemyDmg: settings.dmgMul, enemyAlert: settings.alertMul, finishAt: settings.finishAt / 100, flanking: settings.flanking,
    god: settings.god, infiniteAmmo: settings.infiniteAmmo, noclip: settings.noclip, enemiesFrozen: settings.enemiesFrozen,
  },
  slowmo(scale, dur) { this.slowV = scale; this.slowT = dur; },
  setEnvironment(e) {
    sky.material.map = TEX[e.sky] || TEX.skyDusk; sky.material.needsUpdate = true;
    post.setGrade(e.grade);
    if (+settings.posterize) post.material.uniforms.uSteps.value = +settings.posterize;
    scene.fog = new THREE.FogExp2(parseColor(e.fog), e.fogD);
    ambient.color.setHex(parseColor(e.amb)); ambient.intensity = e.ambI;
    hemi.color.setHex(parseColor(e.hemiSky)); hemi.groundColor.setHex(parseColor(e.hemiGround)); hemi.intensity = e.hemiI;
  },
  setTint(a) { this.tint = a; el('pain').style.opacity = Math.max(a, this.hud.painT * .9).toFixed(2); },
  fade(to, dur) { const f = el('fade'); f.style.transition = `opacity ${dur}s`; f.style.opacity = to; },
  teleport(x, y, z, yaw) { const p = this.player; p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.yaw = yaw; },
  onPlayerDeath() {
    setTimeout(() => {
      el('dead').hidden = false; document.exitPointerLock?.();
      this.running = false;
    }, 1600);
  },
  onWin() {
    this.won = true;
    el('nextLevel').hidden = !this.levelData.next;
    el('win').hidden = false; document.exitPointerLock?.();
    this.running = false;
  },
  // загрузка уровня по имени: данные берутся из хранилища (public/levels, localStorage, Electron)
  async loadLevel(id, o = {}) { return this.applyLevel(await loadLevelData(id), o); },
  /* Построение уровня из готовых данных. Отдельно от loadLevel потому, что
     режим вылазок кормит движок пещерой, которой нет ни в одном файле:
     она собрана генератором прямо сейчас (src/cave/gen.js). */
  async applyLevel(data, o = {}) {
    const id = data.id || 'generated';
    LEVEL_ID = id; this.levelData = data;
    if (this.world) { this.world.dispose(); this.enemies.clear(); this.gore.clear(); this.rockets?.clear(); }
    if (this.level) { for (const pk of this.level.pickups) { scene.remove(pk.m, pk.glow); } for (const n of this.level.npcs) scene.remove(n.m); for (const b of this.level.bills) scene.remove(b); for (const b of this.level.glows) scene.remove(b); }
    // прочие объекты уровня (пятна вина и т.п.) — всё, что не системное
    for (const c of [...scene.children]) if (c.userData.levelObj) scene.remove(c);
    /* Бюджет фонарей. Уровень вправе попросить больше, чем стоит в настройках
       (пещеры — см. src/cave/gen.js): там свет раздан мелкими источниками,
       и при восьми слотах между кострами наступала темнота. Берём больший
       из двух — настройка остаётся потолком только для тех уровней,
       которые своего числа не просят. */
    const budget = Math.max(+settings.lightBudget || 0, data.lightBudget || 0);
    this.world = new World(scene, { lightBudget: budget || undefined });
    this.level = buildLevel(this, data);
    this.world.flush();
    const t0 = performance.now();
    this.world.buildNav(.5);
    console.log(`уровень ${id}: nav ${this.world.nav.W}×${this.world.nav.H} за ${(performance.now() - t0) | 0} мс; solids ${this.world.solids.length}; мешей ${this.world.staticGroup.children.length}`);
    const s = this.level.start;
    if (!o.keepPlayer) { this.player.hp = this.player.maxHp; this.player.dead = false; }
    this.teleport(s.x, s.y || 0, s.z, s.yaw || 0);
    this.player.pitch = 0;
    this.won = false; this.level.done = false;
    el('levelName').textContent = data.name || id;
    // мир для крови и эффектов сменился вместе с уровнем
    this.gore.world = this.world; this.fx.world = this.world;
    if (o.url !== false) history.replaceState(null, '', `?level=${encodeURIComponent(id)}&mode=${MODE}`);
    return data;
  },
};

initTextureQuality(renderer);   // анизотропия по возможностям железа — до того, как текстуры созданы
buildTextures();
buildSprites();
await loadCustomTextures('./textures/');
await loadEnemyDefs('./enemies/');
await loadGibs('./gibs/');
const vm = new ViewModel();
game.gore = new Gore(scene, new World(new THREE.Group()));   // временный мир, заменится в loadLevel
game.gore.k = settings.intensity; game.gore.MAXGIBS = settings.gibsMax; game.gore.MAXCORPSES = settings.corpsesMax;
game.fx = new FX(scene, null);
game.enemies = new Enemies(game);
game.player = new Player(game);
game.rockets = new Rockets(game);
game.hud = new HUD(game, hudCanvas);
if (settings.startGun) game.player.giveWeapon('pistol');
/* Режим вылазок сам решает, какой уровень показать первым (привал перед
   пещерой), поэтому уровень из адреса в нём не грузится. */
const caveRun = MODE === 'cave' ? initCaveRun(game, glCanvas) : null;
if (!caveRun) {
  try { await game.loadLevel(LEVEL_ID); }
  catch (e) { el('levelName').textContent = `ошибка: ${e.message}`; console.error(e); }
}

game.exportSheets = () => { for (const n of ['peasant', 'woman', 'claw', 'guard']) { const a = document.createElement('a'); a.href = buildSheet(n).toDataURL('image/png'); a.download = `${n}.png`; a.click(); } };
game.sheetDataURL = n => buildSheet(n).toDataURL('image/png');
game.shieldDataURL = () => buildShield()?.toDataURL('image/png') || null;
game.templateDataURL = n => buildTemplate(n).toDataURL('image/png');
/* Замер кадра прямо из игры: в консоли браузера набрать game.fps() и играть
   3 секунды. Печатает средний fps, медиану и худшие кадры — по ним видно,
   ровная просадка это или редкие рывки. */
game.fps = (sec = 3) => new Promise(res => {
  const d = []; let last = performance.now(); const t0 = last;
  const tick = now => {
    d.push(now - last); last = now;
    if (now - t0 < sec * 1000) requestAnimationFrame(tick);
    else {
      const s = d.slice(3).sort((a, b) => a - b);
      const q = f => +s[Math.floor(s.length * f)].toFixed(1);
      const r = { fps: Math.round(1000 / (s.reduce((a, b) => a + b, 0) / s.length)), медиана: q(.5), 'худшие 5%': q(.95), макс: +s[s.length - 1].toFixed(1), кадров: s.length, врагов: game.enemies.alive().length };
      console.table(r); res(r);
    }
  };
  requestAnimationFrame(tick);
});
game.gibList = () => swappableGibs();
game.gibDataURL = n => gibCanvas(n)?.toDataURL('image/png') || null;
game.defJSON = n => { const d = builtinDefs()[n]; return d ? JSON.stringify(d, null, 2) : null; };
game.exportTemplates = () => { for (const n of ['peasant', 'woman', 'claw', 'guard']) { const a = document.createElement('a'); a.href = buildTemplate(n).toDataURL('image/png'); a.download = `${n}_template.png`; a.click(); } };

initInput(glCanvas);

/* Размер кадра. Игровой пиксель обязан растягиваться в ЦЕЛОЕ число пикселей
   экрана: при дробном растяжении соседние пиксели получают разный размер,
   и на каждом шаге камеры картинка идёт волнами. Поэтому считаем кратность k,
   а лишние доли пикселя выпускаем за край экрана — обрезки не видно. */
function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const k = Math.max(1, Math.round(dpr / pixelScale));
  const w = Math.max(320, Math.ceil(W * dpr / k)), h = Math.max(200, Math.ceil(H * dpr / k));
  renderer.setSize(w, h, false);
  const cssW = w * k / dpr, cssH = h * k / dpr;
  for (const c of [glCanvas, hudCanvas]) { c.style.width = `${cssW}px`; c.style.height = `${cssH}px`; }
  post.setSize(w, h);
  camera.aspect = cssW / cssH; camera.updateProjectionMatrix();
  vm.setFov(camera.fov, cssW / cssH);
  game.hud.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

/* ─── экраны ─── */
function begin() {
  el('start').hidden = true; el('pause').hidden = true;
  resumeAudio(); lockPointer(glCanvas);
  game.running = true; game.paused = false;
}
el('play').onclick = begin;
el('retry').onclick = () => location.reload();
el('again').onclick = () => location.reload();
el('nextLevel').onclick = async () => { el('win').hidden = true; await game.loadLevel(game.levelData.next, { keepPlayer: true }); game.running = true; lockPointer(glCanvas); };
el('pause').onclick = e => { if (e.target.tagName === 'A') return; game.paused = false; el('pause').hidden = true; lockPointer(glCanvas); };
glCanvas.addEventListener('click', () => { if (game.running && !game.paused) lockPointer(glCanvas); });
document.addEventListener('pointerlockchange', () => {
  if (!pointerLocked(glCanvas) && game.running && !game.player.dead && !game.won && !gamepad.connected && !game.sandboxOpen) { game.paused = true; el('pause').hidden = false; }
});
if (params.get('autostart') === '1') begin();

const sandbox = MODE === 'sandbox' ? initSandbox(game, el('sandbox'), el('stats')) : null;
if (settings.showFps) el('stats').hidden = false;

/* ─── цикл ─── */
let last = performance.now();
let dtAvg = 1 / 60;
let fpsAcc = 0, fpsN = 0, fpsShown = 0, drawCalls = 0, drawTris = 0;
const aimDir = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(.05, (now - last) / 1000); last = now;
  /* Шаг времени сглаживаем. Метки requestAnimationFrame дрожат на доли
     миллисекунды даже при ровных 60 кадрах, и от этого дрожания движение
     на глаз «плывёт» сильнее, чем от настоящей просадки. Скользящее среднее
     по нескольким кадрам держит шаг ровным, но за реальным временем следит. */
  dtAvg += (realDt - dtAvg) * .2;
  const rawDt = Math.min(.05, dtAvg);
  pollGamepad();
  if (once('pixel')) { const i = (SCALES.indexOf(pixelScale) + 1) % SCALES.length; pixelScale = SCALES[i]; resize(); }
  if ((once('pause') || gamepad.pause) && game.running) {
    game.paused = !game.paused; el('pause').hidden = !game.paused;
    if (game.paused) document.exitPointerLock?.(); else lockPointer(glCanvas);
  }
  sandbox?.update(rawDt);
  caveRun?.update(rawDt);
  if (game.running && !game.paused && game.world) {
    if (game.slowT > 0) { game.slowT -= rawDt; game.timeScale += (game.slowV - game.timeScale) * Math.min(1, rawDt * 20); }
    else game.timeScale += (1 - game.timeScale) * Math.min(1, rawDt * 6);
    const dt = rawDt * game.timeScale * (game.paceMul || 1);
    game.time += dt;
    game.player.update(dt, rawDt);
    game.enemies.update(dt);
    game.rockets.update(dt, camera);
    game.level.update(dt);
    game.gore.update(dt, camera);
    game.fx.update(dt, camera);
    game.world.update(dt, camera);
    game.hud.update(dt);
    const p = game.player; p.aimDir(aimDir);
    const wall = game.world.raycast(p.pos.x, p.eye, p.pos.z, aimDir.x, aimDir.y, aimDir.z, 60);
    game.aimEnemy = game.enemies.rayHit(p.pos.x, p.eye, p.pos.z, aimDir, wall ? wall.t : 60, null)?.enemy || null;
  }
  game.player.applyCamera(camera);
  // песочница: зажатый ⌘/Ctrl отводит камеру от героя для облёта сцены
  if (game.camOverride) { game.camOverride(camera); camera.updateMatrixWorld(); }
  // фонари раздаются по камере, а не по игровому времени: на паузе и на стартовом экране свет тоже нужен
  game.world?.bindLights(rawDt, camera);
  sky.position.copy(camera.position);
  // сцена и оружие в руках рисуются в буфер, потом один проход красит кадр
  post.begin();
  renderer.render(scene, camera);
  if (game.running && !game.camOrbit) { vm.update(game.player, game.time); vm.render(renderer); }
  // статистику снимаем до финального прохода, иначе в ней окажется один полноэкранный квад
  const ri = renderer.info.render; drawCalls = ri.calls; drawTris = ri.triangles;
  post.end();
  game.hud.draw();
  // статистика
  fpsAcc += realDt; fpsN++;
  if (fpsAcc >= .5) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0;
    if (!el('stats').hidden) { el('stats').textContent = `${fpsShown} fps · ${drawCalls} calls · ${(drawTris / 1000).toFixed(1)}k tris · врагов ${game.enemies.alive().length} · ${renderer.domElement.width}×${renderer.domElement.height}`; } }
  flushInput();
}
requestAnimationFrame(frame);

game.post = post; game.vm = vm;
window.game = game;
window.__input = { keys, mouse, gamepad, pollGamepad, flushInput };
