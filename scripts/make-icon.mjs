// Draws the Doppel app icon (two overlapping circles on a rounded square)
// as build/icon.png. electron-builder turns it into .icns and .ico.
import fs from "node:fs";
import zlib from "node:zlib";

const SIZE = 1024;
const px = Buffer.alloc(SIZE * SIZE * 4);

function blend(i, [r, g, b], a) {
  const inv = 1 - a;
  px[i] = Math.round(r * a + px[i] * inv);
  px[i + 1] = Math.round(g * a + px[i + 1] * inv);
  px[i + 2] = Math.round(b * a + px[i + 2] * inv);
  px[i + 3] = Math.round(255 * a + px[i + 3] * inv);
}

const cover = (d) => Math.max(0, Math.min(1, d + 0.5)); // antialiased edge
const inset = SIZE * 0.1, radius = SIZE * 0.2, half = SIZE / 2 - inset;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // rounded-square background
    const qx = Math.max(Math.abs(x + 0.5 - SIZE / 2) - (half - radius), 0);
    const qy = Math.max(Math.abs(y + 0.5 - SIZE / 2) - (half - radius), 0);
    const bg = cover(radius - Math.hypot(qx, qy));
    if (bg > 0) blend(i, [246, 247, 249], bg);
    // the two of you
    const r = SIZE * 0.2;
    const ink = cover(r - Math.hypot(x + 0.5 - SIZE * 0.41, y + 0.5 - SIZE / 2));
    if (ink > 0) blend(i, [16, 21, 28], ink);
    const twin = cover(r - Math.hypot(x + 0.5 - SIZE * 0.59, y + 0.5 - SIZE / 2));
    if (twin > 0) blend(i, [14, 124, 102], twin * 0.92);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/icon.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log("wrote build/icon.png");
