// Generates the PWA icons (PNG) without any image library: a rounded blue square with a white "F".
// Run:  node scripts/generate-icons.mjs        (writes into ./public)
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const BLUE = [37, 99, 235, 255]; // #2563eb, the theme colour
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// size: pixels; radius: corner radius as a fraction of size (0 = full-bleed square, used by the maskable icon);
// glyph: scale of the "F" relative to the icon (smaller for maskable so it stays inside the safe zone).
function png(size, radius, glyph) {
  const px = Buffer.alloc(size * size * 4);
  const r = radius * size;
  const gs = size * glyph; const gx = (size - gs) / 2; const gy = (size - gs) / 2; const t = gs * 0.2; // stroke
  const inGlyph = (x, y) => {
    const u = x - gx, v = y - gy;
    if (u < 0 || v < 0 || u > gs * 0.78 || v > gs) return false;
    return u < t || v < t || (v > gs * 0.42 && v < gs * 0.42 + t && u < gs * 0.62);
  };
  const inShape = (x, y) => {
    if (r === 0) return true;
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = !inShape(x + 0.5, y + 0.5) ? CLEAR : inGlyph(x + 0.5, y + 0.5) ? WHITE : BLUE;
      px.set(c, (y * size + x) * 4);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const files = { 'icon-192.png': png(192, 0.22, 0.56), 'icon-512.png': png(512, 0.22, 0.56), 'icon-maskable-512.png': png(512, 0, 0.42), 'apple-touch-icon.png': png(180, 0, 0.52) };
for (const [name, data] of Object.entries(files)) { writeFileSync(join(out, name), data); console.log(`${name} (${data.length} bytes)`); }
