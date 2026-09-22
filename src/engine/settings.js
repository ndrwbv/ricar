/* Настройки игры: одна точка правды, хранится в localStorage (knight.settings).
   Схема используется хабом для построения формы. */
export const SETTINGS_SCHEMA = {
  video: { title: 'Картинка', fields: {
    /* Игра рисуется в буфер меньше экрана и растягивается. Растяжение всегда
       целое (см. resize() в main.js): дробное давало пиксели разного размера,
       и на бегу картинка шла рябью. Поэтому доля округляется до ближайшей
       достижимой — 1, ½, ⅓, ¼ экрана; на что именно ляжет «0.75×», зависит
       от плотности экрана. */
    pixelScale: { label: 'Внутреннее разрешение', type: 'select', def: .5, options: [[.35, 'самый крупный пиксель (≈⅓ экрана)'], [.5, 'половина экрана (Steam Deck)'], [.75, 'три четверти'], [1, 'полное, без пикселизации']] },
    fov: { label: 'Поле зрения', type: 'range', def: 88, min: 60, max: 120, step: 1 },
    headBob: { label: 'Покачивание камеры', type: 'bool', def: true },
    cameraTilt: { label: 'Наклон камеры при стрейфе', type: 'bool', def: true },
    /* Главный рычаг производительности. Каждый источник в сцене прогоняется
       заново для каждого пикселя каждой поверхности, поэтому цена растёт
       линейно по их числу. Движок светит только самыми важными — ближние
       факелы горят, дальние отдают свой фонарь соседям; пламя видно всегда,
       оно рисуется отдельной картинкой. */
    lightBudget: { label: 'Одновременных источников света', type: 'select', def: 8, options: [[4, '4 — самый быстрый'], [6, '6'], [8, '8 (Steam Deck)'], [12, '12'], [16, '16 — самый богатый свет']] },
    post: { label: 'Постобработка (стиль Bonehold)', type: 'bool', def: true },
    posterize: { label: 'Ступени цвета', type: 'select', def: 0, options: [[0, 'плавно'], [32, '32 ступени'], [20, '20 ступеней'], [12, '12 ступеней (грубо)']] },
    showFps: { label: 'Показывать FPS и draw calls', type: 'bool', def: false },
    screenBlood: { label: 'Кровь на экране', type: 'bool', def: true },
  } },
  sound: { title: 'Звук', fields: {
    // выключен по умолчанию: и разработка, и игра пока идут в тишине
    sound: { label: 'Звук', type: 'bool', def: false },
    volume: { label: 'Громкость', type: 'range', def: .8, min: 0, max: 1, step: .05 },
  } },
  control: { title: 'Управление', fields: {
    sens: { label: 'Чувствительность мыши', type: 'range', def: 1, min: .2, max: 3, step: .05 },
    invertY: { label: 'Инвертировать вертикаль', type: 'bool', def: false },
    hints: { label: 'Подсказки по управлению', type: 'bool', def: true },
  } },
  player: { title: 'Герой', fields: {
    speed: { label: 'Скорость бега, м/с', type: 'range', def: 8.6, min: 3, max: 16, step: .1 },
    maxHp: { label: 'Здоровье', type: 'range', def: 100, min: 10, max: 500, step: 10 },
    dashCd: { label: 'Перезарядка рывка, с', type: 'range', def: .55, min: 0, max: 3, step: .05 },
    jump: { label: 'Прыжок', type: 'bool', def: true },
    swordDmg: { label: 'Урон меча ×', type: 'range', def: 1, min: .1, max: 5, step: .1 },
    /* Меч живёт на стамине: замах тратит весь накопленный запас, урон равен
       тому, сколько успело накопиться. Регенерация — это и есть темп боя. */
    swordRegen: { label: 'Стамина меча: восстановление, ед/с', type: 'range', def: .62, min: .15, max: 3, step: .02 },
    swordMinStamina: { label: 'Стамина меча: минимум на замах', type: 'range', def: .34, min: .05, max: .9, step: .01 },
    gunDmg: { label: 'Урон пистолета ×', type: 'range', def: 1, min: .1, max: 5, step: .1 },
    magSize: { label: 'Магазин пистолета', type: 'range', def: 12, min: 1, max: 60, step: 1 },
    startGun: { label: 'Пистолет с самого начала', type: 'bool', def: false },
    gunSlots: { label: 'Сколько огнестрела носить', type: 'select', def: 1, options: [[1, 'одно (новое заменяет старое)'], [2, 'два ствола сразу'], [3, 'все три ствола']] },
    shotgunDmg: { label: 'Урон дробовика ×', type: 'range', def: 1, min: .1, max: 5, step: .1 },
    rocketDmg: { label: 'Урон ракетницы ×', type: 'range', def: 1, min: .1, max: 5, step: .1 },
    finisherHeal: { label: 'Лечение за казнь', type: 'range', def: 30, min: 0, max: 100, step: 5 },
    finisherSlowmo: { label: 'Замедление при казни', type: 'bool', def: true },
  } },
  enemies: { title: 'Враги', fields: {
    hpMul: { label: 'Здоровье врагов ×', type: 'range', def: 1, min: .1, max: 5, step: .1 },
    speedMul: { label: 'Скорость врагов ×', type: 'range', def: 1, min: .2, max: 3, step: .1 },
    dmgMul: { label: 'Урон врагов ×', type: 'range', def: 1, min: 0, max: 5, step: .1 },
    alertMul: { label: 'Дальность обнаружения ×', type: 'range', def: 1, min: .2, max: 3, step: .1 },
    // новый ключ вместо staggerAt: старое сохранённое значение (38 %) с добиванием одним попаданием сделало бы бой слишком лёгким
    finishAt: { label: 'Добивание («красный») при здоровье ниже, %', type: 'range', def: 10, min: 1, max: 40, step: 1 },
    flanking: { label: 'Заходы с флангов', type: 'bool', def: true },
    atkMelee: { label: 'Одновременно бьют в ближнем бою', type: 'range', def: 2, min: 1, max: 8, step: 1 },
    atkRanged: { label: 'Одновременно стреляют', type: 'range', def: 3, min: 1, max: 10, step: 1 },
  } },
  gore: { title: 'Кровь', fields: {
    intensity: { label: 'Количество крови ×', type: 'range', def: 1, min: 0, max: 3, step: .1 },
    gibsMax: { label: 'Макс. кусков на сцене', type: 'range', def: 90, min: 10, max: 400, step: 10 },
    corpsesMax: { label: 'Макс. груд тел', type: 'range', def: 40, min: 5, max: 200, step: 5 },
  } },
  cheats: { title: 'Читы и отладка', fields: {
    god: { label: 'Бессмертие', type: 'bool', def: false },
    infiniteAmmo: { label: 'Бесконечные патроны', type: 'bool', def: false },
    noclip: { label: 'Полёт сквозь стены (F6)', type: 'bool', def: false },
    enemiesFrozen: { label: 'Враги стоят', type: 'bool', def: false },
    dmgNumbers: { label: 'Показывать урон врагу', type: 'bool', def: false },
    dmgTaken: { label: 'Показывать полученный урон', type: 'bool', def: false },
  } },
};

export const DEFAULTS = Object.fromEntries(Object.values(SETTINGS_SCHEMA).flatMap(g => Object.entries(g.fields).map(([k, f]) => [k, f.def])));

export function loadSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('knight.settings') || '{}')) }; }
  catch (e) { return { ...DEFAULTS }; }
}
export function saveSettings(s) { localStorage.setItem('knight.settings', JSON.stringify(s)); }
export function resetSettings() { localStorage.removeItem('knight.settings'); return { ...DEFAULTS }; }
