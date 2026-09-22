# Запуск на Steam Deck

Сборка — распакованный Electron-пакет под linux-x64 (Deck именно x64), без установщика и без Proton:
папка кладётся в домашний каталог Deck'а, а `knight.sh` добавляется в Steam как сторонняя игра.

Готовые сборки лежат в релизах: <https://github.com/ndrwbv/ricar/releases>.
Файл всегда называется `knight-deck.tar.gz` (~110 МБ), поэтому ссылка на свежий не меняется:

```
https://github.com/ndrwbv/ricar/releases/latest/download/knight-deck.tar.gz
```

## 1. Установка из десктоп-режима (весь путь, копипастой)

1. **Перейти в десктоп-режим**: зажать кнопку **STEAM** → `Power` → **Switch to Desktop**
   (или зажать кнопку питания → `Switch to Desktop`). Deck станет обычным KDE-компьютером.
2. Открыть **Konsole** (внизу слева меню «пуск» → `System` → `Konsole`; или через `Alt+Space` набрать `konsole`).
   Экранная клавиатура в десктоп-режиме — `STEAM + X`.
3. Скачать, распаковать и запустить:

```bash
mkdir -p ~/Games && cd ~/Games
curl -L -o knight-deck.tar.gz https://github.com/ndrwbv/ricar/releases/latest/download/knight-deck.tar.gz
tar -xzf knight-deck.tar.gz && rm knight-deck.tar.gz
chmod +x ~/Games/linux-unpacked/knight.sh
~/Games/linux-unpacked/knight.sh
```

Игра должна открыться на весь экран — это и есть проверка, что сборка живая.
Выйти — `Alt+F4`, окном вместо полного экрана — `knight.sh --windowed`.

Обновление до новой версии — те же четыре команды: старая папка `linux-unpacked` перезапишется
(сохранённые уровни лежат отдельно, в `~/.config/Knight/levels`, и не пострадают).

Если качать в браузере (Firefox на Deck'е) — файл попадёт в `~/Downloads`, тогда:

```bash
mkdir -p ~/Games && tar -xzf ~/Downloads/knight-deck.tar.gz -C ~/Games
chmod +x ~/Games/linux-unpacked/knight.sh
```

## 2. Добавить в Steam, чтобы играть из игрового режима

Всё там же, в десктоп-режиме:

1. Steam → **Games → Add a Non-Steam Game to My Library → Browse**.
2. В диалоге снизу переключить фильтр на **All Files** (иначе `.sh` не видно),
   указать `/home/deck/Games/linux-unpacked/knight.sh` → **Add Selected Programs**.
3. Правый клик по игре в библиотеке → **Properties**:
   * имя — `Рыцарь`;
   * **Launch Options** (не обязательно) — сразу в песочницу, минуя хаб:
     `--page=game.html?level=sandbox&mode=sandbox`; для режима пещер — `--page=game.html?mode=cave`;
   * вкладка **Compatibility** — **не** включать Proton: сборка нативная под Linux.
4. Ярлык на рабочем столе **Return to Gaming Mode** — игра будет в библиотеке, раздел **Non-Steam**.

Значок можно подставить свой там же в Properties (иначе Steam покажет пустой квадрат).

## 3. Управление на Deck

Раскладка Steam Input по умолчанию для сторонних игр — **Gamepad with Mouse Trackpad**;
она и нужна: стики с кнопками идут в игру как Xbox-геймпад, а правый тачпад работает мышью —
им нажимаются кнопки в хабе, меню паузы и редакторе.

| Кнопка | Действие |
| --- | --- |
| Левый стик | движение |
| Правый стик | обзор |
| **RT** | правая рука: выстрел, в режиме меча — удар клинком |
| **LT** | левая рука: в режиме ствола — тоже выстрел, в режиме меча и «обе руки» — удар клинком |
| A / B | прыжок / рывок |
| X / Y | перезарядка / сменить ствол |
| LB / RB | действие / добить оглушённого |
| Нажатие стика (L3 или R3) | пинок |
| Крестовина ↑ ← → ↓ | меч / пистолет / дробовик / ракетница |
| Select | режим рук: меч → ствол → обе |
| Start | пауза |

Курки аналоговые, срабатывание с 35 % хода. Геймпад появляется в игре после первого
нажатия любой кнопки — это требование браузерного Gamepad API.

## 4. Производительность и мелочи

* Внутреннее разрешение по умолчанию 0.5× (640×400 при экране 1280×800),
  клавиша `P` перебирает 0.35 / 0.5 / 0.75 / 1.0.
* Ограничитель кадров Deck'а (быстрое меню → значок батареи) на 60 fps: игра упирается в vsync
  и меньше ест батарею.
* `F11` / `Alt+Enter` — полный экран.
* Уровни из редактора — в `~/.config/Knight/levels`.

## 5. Если не запускается

* Запустить из Konsole с логом: `~/Games/linux-unpacked/knight.sh --log`.
* «The SUID sandbox helper binary was found, but is not configured correctly» — запущен
  бинарник `knight` напрямую вместо `knight.sh`; нужен флаг `--no-sandbox` (скрипт его и ставит).
* Чёрный экран в игровом режиме, но в десктопе всё работает — в свойствах ярлыка включён Proton, выключить.
* Нет реакции на геймпад — в раскладке контроллера выбран шаблон с клавиатурой; переключить на
  **Gamepad with Mouse Trackpad**.
* `Permission denied` при запуске — `chmod +x ~/Games/linux-unpacked/knight.sh`.

## 6. Как выпускается релиз

Сборка ручная, через GitHub Actions: вкладка **Actions** → **Релиз для Steam Deck** →
**Run workflow** (можно задать тег и описание). Воркфлоу ставит зависимости, собирает
веб-часть, пакует Electron под linux-x64, прогоняет `tools/pack-deck.mjs` и создаёт релиз
с `knight-deck.tar.gz`. Файл: [.github/workflows/release-deck.yml](../.github/workflows/release-deck.yml).

То же самое локально на Mac:

```bash
npm run dist:deck     # release/linux-unpacked/ + release/knight-deck.tar.gz
```
