/* Общее для инструментов импорта из WAD: чтение лампов, палитра, распаковка
   картинок Doom (patch) и запись PNG без внешних зависимостей.

   WAD — это заголовок (IWAD/PWAD, число лампов, смещение каталога) и каталог
   записей по 16 байт: позиция, размер, имя из 8 символов. Всё остальное —
   просто куски файла, которые адресуются по имени. */
import fs from 'fs';
import zlib from 'zlib';

/* ═══════════ WAD ═══════════ */
export function openWad(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'IWAD' && magic !== 'PWAD') throw new Error(`${file}: не WAD (сигнатура ${magic})`);
  const n = buf.readInt32LE(4), dir = buf.readInt32LE(8);
  const lumps = [];
  for (let i = 0; i < n; i++) {
    const o = dir + i * 16;
    lumps.push({
      pos: buf.readInt32LE(o), size: buf.readInt32LE(o + 4),
      name: buf.toString('ascii', o + 8, o + 16).replace(/\0.*$/, '').toUpperCase(),
    });
  }
  const byName = new Map();
  lumps.forEach((l, i) => { if (!byName.has(l.name)) byName.set(l.name, i); });
  return {
    buf, lumps, magic,
    data: l => buf.subarray(l.pos, l.pos + l.size),
    find: name => { const i = byName.get(name.toUpperCase()); return i === undefined ? null : lumps[i]; },
  };
}

// 256 цветов из PLAYPAL (берём первую палитру — обычную, без вспышек боли)
export function palette(wad) {
  const l = wad.find('PLAYPAL');
  if (!l) throw new Error('в WAD нет PLAYPAL');
  const d = wad.data(l), pal = new Uint8Array(256 * 3);
  pal.set(d.subarray(0, 768));
  return pal;
}

/* ═══════════ картинка Doom (patch) ═══════════
   Заголовок: ширина, высота, смещение влево и вверх от «горячей точки» (у монстров
   это середина подошв). Дальше на каждую колонку — смещение на цепочку постов:
   отступ сверху, длина, мусорный байт, пиксели, мусорный байт. 0xFF — конец колонки.
   Пустые места остаются прозрачными. */
export function readPatch(data, pal) {
  const w = data.readInt16LE(0), h = data.readInt16LE(2);
  const left = data.readInt16LE(4), top = data.readInt16LE(6);
  if (w <= 0 || h <= 0 || w > 4096 || h > 4096) throw new Error(`битая картинка ${w}×${h}`);
  const px = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    let o = data.readInt32LE(8 + x * 4);
    if (o < 0 || o >= data.length) continue;
    let prevTop = -1;
    while (o < data.length) {
      const td = data[o];
      if (td === 0xFF) break;
      const len = data[o + 1];
      // «высокие» посты (topdelta меньше предыдущего) продолжают колонку ниже — формат Doom II
      const y0 = td <= prevTop ? prevTop + td : td;
      prevTop = y0;
      o += 3;
      for (let i = 0; i < len; i++, o++) {
        const y = y0 + i;
        if (y < 0 || y >= h) continue;
        const c = data[o] * 3, p = (y * w + x) * 4;
        px[p] = pal[c]; px[p + 1] = pal[c + 1]; px[p + 2] = pal[c + 2]; px[p + 3] = 255;
      }
      o++;
    }
  }
  return { w, h, left, top, px };
}

/* ═══════════ PNG ═══════════
   Минимальный кодировщик: IHDR + IDAT (deflate из zlib) + IEND. Фильтр 0 у каждой
   строки — картинки маленькие, экономить нечего, зато код короткий и без зависимостей. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 бит, RGBA
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
