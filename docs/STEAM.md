# Как раздавать игру в Steam (Windows + Linux/Deck)

Steam раздаёт не инсталлятор, а просто папку с файлами: он сам качает депот, кладёт его в
`steamapps/common/<игра>` и запускает указанный исполняемый файл. Поэтому от electron-builder
нужны «распакованные» таргеты (`dir` / `zip`), а не `nsis`/`AppImage` — это уже так и настроено.

Одна кодовая база даёт обе платформы: `electron/main.cjs` одинаковый, разница только в том,
что на Linux добавляется `--no-sandbox` (SteamOS не даёт setuid-бит на `chrome-sandbox`).

## 1. Что собирает CI

Воркфлоу [.github/workflows/release.yml](../.github/workflows/release.yml) по ручному запуску
собирает обе платформы и кладёт в релиз:

| Файл | Что это | Откуда |
| --- | --- | --- |
| `knight-deck.tar.gz` | распакованный linux-x64 (`linux-unpacked/`) | ubuntu-latest |
| `knight-win.zip` | распакованный win-x64 (`Knight.exe` + ресурсы) | windows-latest |
| `install-deck.sh` | установщик для Deck | тот же прогон |

Windows-сборку обязательно собирать **на windows-раннере**: правка иконки и версии в `.exe`
на Linux/macOS требует wine, а на своём раннере всё штатно. Локально на Mac —
`npm run dist:mac`, `npm run dist:deck`; Windows локально с Mac лучше не собирать.

Перед первым релизом в Steam стоит добавить иконки (`build/icon.ico` для Windows,
`build/icon.png` 512×512 для Linux) — сейчас их нет, и `.exe` получает стандартную иконку Electron.

## 2. Разовая возня со Steamworks

1. Партнёрский аккаунт: <https://partner.steamgames.com>. Взнос Steam Direct — 100 $ за приложение
   (возвращается после 1000 $ выручки), плюс налоговая форма и банковские реквизиты.
   **Актуальные суммы и сроки смотреть на сайте — они меняются.**
2. Создать приложение → появится **App ID**.
3. App Admin → **SteamPipe → Depots**: сделать два депота, например
   `<appid>+1` — Windows, `<appid>+2` — Linux. У каждого в свойствах выставить ОС.
4. Store page: описание, скриншоты, трейлер, теги, возрастной рейтинг (у нас 18+, сцены крайней
   жестокости — указать честно, иначе развернут на review). Страница проходит проверку Valve
   (обычно около недели-двух), сборка — отдельную. От оплаты взноса до возможности релиза
   выдерживается срок ожидания (порядка 30 дней).

## 3. Загрузка сборки: SteamPipe

Скачать Steamworks SDK → `tools/ContentBuilder`. Два конфига:

`scripts/app_build.vdf`:

```
"appbuild"
{
  "appid" "<APPID>"
  "desc"  "Рыцарь <версия>"
  "buildoutput" "..\\output\\"
  "contentroot" "..\\content\\"
  "setlive" ""            // пусто = никуда не выкатывать, только загрузить
  "depots"
  {
    "<APPID+1>" "depot_win.vdf"
    "<APPID+2>" "depot_linux.vdf"
  }
}
```

`scripts/depot_win.vdf` (для линуксового — то же самое со своим депотом и папкой):

```
"DepotBuild"
{
  "DepotID" "<APPID+1>"
  "contentroot" "..\\content\\win\\"
  "FileMapping" { "LocalPath" "*" "DepotPath" "." "recursive" "1" }
  "FileExclusion" "*.pdb"
}
```

В `content/win/` кладётся распакованный `knight-win.zip`, в `content/linux/` — содержимое
`linux-unpacked/` (вместе с `knight.sh`). Заливка:

```bash
steamcmd +login <билд-аккаунт> +run_app_build ../scripts/app_build.vdf +quit
```

Дальше в Steamworks: **Builds** → выбрать билд → выкатить на ветку `beta`, проверить самому,
и только потом на `default`. Для CI понадобится отдельный билд-аккаунт с ограниченными правами
и сохранённым Steam Guard (`config.vdf`/`ssfn`) — на первых порах проще заливать с руки.

## 4. Launch Options — чтобы «на винде тоже работало»

App Admin → **Installation → General Installation → Launch Options**, по строке на платформу:

| ОС | Executable | Arguments |
| --- | --- | --- |
| Windows | `Knight.exe` | — |
| Linux | `knight.sh` | — |

Steam сам подставит нужную по платформе покупателя: на ПК с Windows скачается Windows-депот,
на Deck и линуксовых машинах — линуксовый, нативно, без Proton. `knight.sh` из нашей сборки
сам переходит в свою папку и добавляет `--no-sandbox`, так что менять ничего не нужно;
права на исполнение SteamPipe сохраняет.

Если когда-нибудь захочется выпустить **только** Windows-сборку — Deck её тоже запустит через
Proton, но это лишний слой и минус к шансам на Deck Verified. Раз линуксовая сборка уже есть,
смысла отказываться нет.

## 5. Steam Deck Verified

Заявка подаётся из Steamworks бесплатно. Требования, важные для нас:

* игра стартует и играется только с контроллера — да (вся раскладка в [DECK.md](DECK.md));
* читаемый текст при 1280×800 — в бою надписей нет вообще, следить надо за хабом и меню паузы;
* дефолтная раскладка контроллера — стоит завести и опубликовать официальную Steam Input раскладку,
  иначе игрок получит шаблон «Gamepad with Mouse Trackpad»;
* экранная клавиатура вызывается, если игра просит ввод текста (у нас — только имя уровня в редакторе);
* нет тяжёлых просадок: внутренний рендер 0.5× (640×400), запас по fps большой (см. [TECH.md](TECH.md)).

## 6. Чего Electron не умеет в Steam

* **Steam Overlay (Shift+Tab) со сборкой на Chromium обычно не работает**: оверлей хукает
  D3D/OpenGL/Vulkan в процессе игры, а Electron рисует в отдельном GPU-процессе. Последствия —
  нет оверлея, значит нет скриншотов Steam, браузера и приглашений поверх игры.
  Иногда помогает запуск с `--in-process-gpu` на Windows, но гарантий нет.
  Если оверлей окажется принципиален — это главный довод за переезд на Godot (см. [TECH.md](TECH.md)).
* **Steam Input** работает: Deck и любой геймпад видны через Gamepad API как стандартный контроллер.
* **Достижения и статистика** — через [steamworks.js](https://github.com/ceifa/steamworks.js)
  в `electron/main.cjs` (main-процесс), в рендерер прокидывается по IPC через `preload.cjs`.
  Ставится как зависимость; `electron-builder` кладёт нативный модуль в `resources/`.
* **Облачные сохранения** (Steam Cloud) — мапятся на папку с уровнями: `%APPDATA%\Knight\levels`
  на Windows и `~/.config/Knight/levels` на Linux.

## 7. Порядок действий, если делать это завтра

1. Добавить иконки в `build/` и поле `build.win.icon` / `build.linux.icon` в `package.json`.
2. Прогнать релизный воркфлоу, скачать `knight-win.zip`, проверить на живой Windows-машине.
3. Оплатить Steam Direct, завести App ID и два депота.
4. Собрать страницу магазина, отправить на review.
5. Залить первый билд SteamPipe'ом на ветку `beta`, проверить установку на Windows и на Deck.
6. Подключить steamworks.js, если нужны достижения.
7. Подать заявку на Deck Verified.
