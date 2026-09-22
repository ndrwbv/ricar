/* Привал перед входом в пещеру: отсюда начинается и сюда же возвращается
   каждая вылазка. Уровень собран руками — он один на всю игру, и именно
   здесь показывают итоги прошлой ходки, поэтому случайность тут только
   мешала бы: место должно узнаваться с первого взгляда.

   Всё, что от него требуется: понятный чёрный зев в скале и ничего похожего
   на него больше в кадре. */

const rnd = (a, b) => a + Math.random() * (b - a);

export function campLevel() {
  const objects = [];
  const W = 56, D = 46;                       // площадка перед скалой
  const X0 = -W / 2, Z0 = -D + 8;

  objects.push({ t: 'floor', tex: 'dirt', x: X0, y: 0, z: Z0, w: W, d: D, o: { cell: 3, uvScale: .5, lit: .95 } });

  // ── скала с проёмом ──
  const CLIFF_Z = Z0 + 2, CH = 16, half = 2.6;
  objects.push({ t: 'box', tex: 'caveRock', x: X0, y: 0, z: CLIFF_Z, w: W / 2 - half, h: CH, d: 5, o: { uvScale: .5, lit: .86 } });
  objects.push({ t: 'box', tex: 'caveRock', x: half, y: 0, z: CLIFF_Z, w: W / 2 - half, h: CH, d: 5, o: { uvScale: .5, lit: .9 } });
  objects.push({ t: 'box', tex: 'caveRock', x: -half, y: 4.2, z: CLIFF_Z, w: half * 2, h: CH - 4.2, d: 5, o: { uvScale: .5, lit: .8 } });
  // короткий тоннель вглубь: в его торце темно, туда и идёт игрок
  objects.push({ t: 'box', tex: 'caveRock', x: -half - .8, y: 0, z: CLIFF_Z - 7, w: .8, h: 5, d: 7, o: { lit: .7 } });
  objects.push({ t: 'box', tex: 'caveRock', x: half, y: 0, z: CLIFF_Z - 7, w: .8, h: 5, d: 7, o: { lit: .7 } });
  objects.push({ t: 'floor', tex: 'caveRock', x: -half, y: 4.4, z: CLIFF_Z - 7, w: half * 2, d: 7.4, o: { ceiling: true, lit: .55 } });
  objects.push({ t: 'floor', tex: 'caveFloor', x: -half, y: .02, z: CLIFF_Z - 7, w: half * 2, d: 7.4, o: { cell: 2, lit: .7 } });
  objects.push({ t: 'box', tex: 'dark', x: -half, y: 0, z: CLIFF_Z - 7.2, w: half * 2, h: 4.4, d: .4, o: { lit: .2 } });

  // ── стены по краям площадки: дальше идти некуда, но забора не видно ──
  for (const [x, z, w, d] of [[X0 - 4, Z0, 4, D + 8], [X0 + W, Z0, 4, D + 8], [X0 - 4, Z0 + D, W + 8, 4]]) {
    objects.push({ t: 'box', tex: 'caveRock', x, y: 0, z, w, h: 12, d, o: { uvScale: .5, lit: .8 } });
  }
  // валуны вдоль скалы — чтобы стык земли и камня не был линейкой
  for (let k = 0; k < 22; k++) {
    const x = rnd(X0 + 1, X0 + W - 1), z = rnd(Z0 + 1, Z0 + D - 6);
    if (Math.abs(x) < 5 && z < CLIFF_Z + 6) continue;         // у входа чисто
    const r = rnd(.5, 1.6);
    objects.push({ t: 'cyl', tex: 'caveRock', x: x - r, y: 0, z: z - r, r, h: rnd(.6, 2.2), seg: 6, o: { r2: r * rnd(.5, .9), lit: +rnd(.8, 1).toFixed(2) } });
  }

  // ── костёр привала и два факела по бокам зева ──
  objects.push({ t: 'prefab', kind: 'torchPost', x: -4.2, z: CLIFF_Z + 1.6 });
  objects.push({ t: 'prefab', kind: 'torchPost', x: 4.2, z: CLIFF_Z + 1.6 });
  // костёр сдвинут в сторону: по центру он закрывал бы собой сам зев
  objects.push({ t: 'fire', x: -6, y: 0, z: CLIFF_Z + 9, size: 1.6, color: '#ff8a30', i: 3, dist: 18 });
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * 6.283;
    objects.push({ t: 'cyl', tex: 'caveRock', x: -6 + Math.cos(a) * 1.6 - .25, y: 0, z: CLIFF_Z + 9 + Math.sin(a) * 1.6 - .25, r: .25, h: .35, seg: 5, o: { solid: false, lit: .9 } });
  }

  return {
    id: 'cave-camp', name: 'привал', version: 1,
    env: 'dusk', envs: {},
    // взгляд направлен в зев: вперёд у героя — это −z при yaw 0 (см. player.aimDir)
    start: { x: 0, y: 0, z: CLIFF_Z + 14, yaw: 0 },
    bounds: { x0: X0 - 8, z0: Z0 - 12, x1: X0 + W + 8, z1: Z0 + D + 8 },
    objective: '', objects, enemies: [], pickups: [], npcs: [],
    // торец тоннеля: шаг сюда — и начинается новая пещера
    triggers: [{ x: 0, z: CLIFF_Z - 5.5, r: 2.2, actions: [{ a: 'finish' }] }],
    rules: [], next: null,
    camp: true,
  };
}
