// Рисует иконки приложения SprintGames в PNG (без сторонних библиотек).
// Запуск: node gen-icons.js  -> папка icons/
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

const PLAYERS = [['#ff6161', .33, .33], ['#4fa8ff', .67, .33], ['#8ee04f', .33, .67], ['#ff9f43', .67, .67]].map(([c, x, y]) => [hex(c), x, y]);
const BOLT = [[.57, .16], [.35, .54], [.49, .54], [.43, .85], [.67, .44], [.53, .44], [.61, .16]];
const BOLT_SH = BOLT.map(([x, y]) => [x + .014, y + .018]);
const TOP = hex('#24304a'), BOT = hex('#0b0e14'), GOLD = hex('#ffd166');

function sample(u, v) {
  // фон: вертикальный градиент
  let c = TOP.map((t, i) => t + (BOT[i] - t) * v);
  const blend = (col, a) => { c = c.map((x, i) => x + (col[i] - x) * a); };
  // мягкое свечение в центре
  const d = Math.hypot(u - .5, v - .5);
  if (d < .42) blend(GOLD, .10 * (1 - d / .42));
  // четыре игрока
  for (const [col, x, y] of PLAYERS) {
    const r = Math.hypot(u - x, v - y);
    if (r < .135) { blend(col.map(z => z * .62), 1); if (r < .118) blend(col, 1); if (Math.hypot(u - x + .04, v - y + .045) < .035) blend([255, 255, 255], .35); }
  }
  // молния
  if (inPoly(u, v, BOLT_SH)) blend([8, 10, 16], .65);
  if (inPoly(u, v, BOLT)) blend(GOLD, 1);
  return c;
}
function render(N, rounded) {
  const S = 4, buf = Buffer.alloc(N * N * 4), R = rounded ? .2 : 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + .5) / S) / N, v = (y + (sy + .5) / S) / N;
      if (R) { const cx = Math.min(Math.max(u, R), 1 - R), cy = Math.min(Math.max(v, R), 1 - R); if (Math.hypot(u - cx, v - cy) > R) continue; }
      const c = sample(u, v); r += c[0]; g += c[1]; b += c[2]; a++;
    }
    const o = (y * N + x) * 4, n = S * S;
    if (a) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; }
    buf[o + 3] = Math.round(255 * a / n);
  }
  return png(N, N, buf);
}
const out = path.join(__dirname, 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512, false));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, false));
fs.writeFileSync(path.join(out, 'favicon-64.png'), render(64, true));
console.log('Иконки готовы:', fs.readdirSync(out).join(', '));
