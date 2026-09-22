#!/usr/bin/env bash
# Установка «Рыцаря» на Steam Deck (и любой Linux x86_64) одной командой.
#
#   curl -fsSL https://raw.githubusercontent.com/ndrwbv/ricar/main/tools/install-deck.sh | bash
#
# Скрипт качает свежий релиз, распаковывает игру в папку knight рядом с собой,
# ставит права на запуск и делает ярлык, который видит Steam.
#
# Флаги (через `| bash -s -- --run`):
#   --run          сразу запустить игру после установки
#   --dir ПАПКА    поставить не в ./knight, а куда сказано
#   --tag v0.1.0   конкретная версия вместо последней
#   --no-desktop   не создавать ярлык
#   --url АДРЕС    взять архив по своему адресу (или локальный file:///path)
set -euo pipefail

REPO="ndrwbv/ricar"
ASSET="knight-deck.tar.gz"
DIR="$PWD/knight"
TAG=""
URL=""
RUN=0
DESKTOP=1

while [ $# -gt 0 ]; do
  case "$1" in
    --run) RUN=1 ;;
    --dir) DIR="${2:?--dir без пути}"; shift ;;
    --tag) TAG="${2:?--tag без версии}"; shift ;;
    --no-desktop) DESKTOP=0 ;;
    --url) URL="${2:?--url без адреса}"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "неизвестный флаг: $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "Это сборка под Linux (Steam Deck). Здесь: $(uname -s)."
[ "$(uname -m)" = "x86_64" ] || die "Нужен x86_64, а тут $(uname -m)."
command -v curl >/dev/null || die "нет curl"
command -v tar  >/dev/null || die "нет tar"

case "$DIR" in /*) ;; *) DIR="$PWD/${DIR#./}" ;; esac
if [ -z "$URL" ]; then
  if [ -n "$TAG" ]; then
    URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
  else
    URL="https://github.com/$REPO/releases/latest/download/$ASSET"
  fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Качаю ${TAG:-последний релиз}…"
curl -fL --progress-bar -o "$TMP/$ASSET" "$URL" \
  || die "Не скачалось. Проверь, что релиз выложен: https://github.com/$REPO/releases"

# Свежая установка или обновление поверх старой: сносим только то, что сами и ставили.
if [ -e "$DIR" ]; then
  if [ -f "$DIR/knight" ] && [ -f "$DIR/resources/app.asar" ]; then
    say "Обновляю установку в $DIR"
    rm -rf "$DIR"
  elif [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    die "Папка $DIR занята чем-то чужим — удали её или укажи другую через --dir."
  fi
fi

mkdir -p "$DIR"
say "Распаковываю в $DIR…"
tar -xzf "$TMP/$ASSET" -C "$DIR" --strip-components=1
[ -f "$DIR/knight" ] || die "В архиве нет бинарника knight — битая сборка."

chmod +x "$DIR/knight" "$DIR/knight.sh" 2>/dev/null || true
chmod +x "$DIR/chrome_crashpad_handler" 2>/dev/null || true
find "$DIR" -name '*.so' -exec chmod +x {} + 2>/dev/null || true

if [ "$DESKTOP" = "1" ]; then
  ENTRY="[Desktop Entry]
Type=Application
Name=Рыцарь
GenericName=Knight
Comment=Ультранасильственный FPS в духе раннего Doom
Exec=\"$DIR/knight.sh\"
Path=$DIR
Terminal=false
Categories=Game;ActionGame;
"
  mkdir -p "$HOME/.local/share/applications"
  printf '%s' "$ENTRY" > "$HOME/.local/share/applications/knight.desktop"
  chmod +x "$HOME/.local/share/applications/knight.desktop"
  if [ -d "$HOME/Desktop" ]; then
    printf '%s' "$ENTRY" > "$HOME/Desktop/knight.desktop"
    chmod +x "$HOME/Desktop/knight.desktop"
  fi
  command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

say ""
say "Готово. Игра: $DIR/knight.sh"
cat <<TXT

  запустить сейчас:   $DIR/knight.sh
  окном, не на весь экран:  $DIR/knight.sh --windowed
  сразу в песочницу:  $DIR/knight.sh '--page=game.html?level=sandbox&mode=sandbox'

  добавить в Steam (чтобы играть из игрового режима):
  Steam → Games → Add a Non-Steam Game → Browse → фильтр All Files →
  $DIR/knight.sh → в свойствах ярлыка НЕ включать Proton.
TXT

if [ "$RUN" = "1" ]; then
  say "Запускаю…"
  exec "$DIR/knight.sh"
fi
