/* Упаковка распакованного linux-билда для Steam Deck.

   Запуск: node tools/pack-deck.mjs       (обычно через npm run dist:deck)

   Кладёт в release/linux-unpacked скрипт запуска knight.sh и сворачивает папку
   в release/knight-deck.tar.gz — этот архив и надо перекинуть на Deck.
   Скрипт нужен потому, что Steam запускает игру из своей рабочей папки, а
   Electron ищет ресурсы рядом с бинарником. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'release', 'linux-unpacked');
if (!fs.existsSync(path.join(dir, 'knight'))) {
  console.error('нет release/linux-unpacked/knight — сначала: npx electron-builder --linux dir --x64');
  process.exit(1);
}

const sh = `#!/bin/bash
# Запуск «Рыцаря» на Steam Deck / любом Linux.
# Аргументы пробрасываются в игру: --windowed, --log, --page=game.html?level=sandbox&mode=sandbox
cd "$(dirname "$(readlink -f "$0")")" || exit 1
exec ./knight --no-sandbox "$@"
`;
fs.writeFileSync(path.join(dir, 'knight.sh'), sh);
fs.chmodSync(path.join(dir, 'knight.sh'), 0o755);

const out = path.join(root, 'release', 'knight-deck.tar.gz');
fs.rmSync(out, { force: true });
execFileSync('tar', ['-czf', out, '-C', path.join(root, 'release'), 'linux-unpacked'], { stdio: 'inherit' });
const mb = (fs.statSync(out).size / 1048576).toFixed(0);
console.log(`готово: release/knight-deck.tar.gz (${mb} МБ)`);
console.log('на Deck: scp этот архив в ~/Games, tar -xzf, затем «Добавить стороннюю игру» → linux-unpacked/knight.sh');
