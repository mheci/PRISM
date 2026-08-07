#!/usr/bin/env node
/*
 * Generates PRISM icons: dark rounded tile with a rainbow prism triangle.
 * Pure node (zlib) PNG writer — no dependencies.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const outDir = path.resolve(__dirname, "..", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function png(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = row + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hues = [0, 45, 120, 195, 260, 330];
const hslToRgb = (h, s, l) => {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size / 2;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cr = r * 0.78;
      const corner =
        (dx < 0 ? Math.max(0, -dx - cr) : 0) +
        (dy < 0 ? Math.max(0, -dy - cr) : 0);
      if (dist > r || corner > 0) {
        px[i + 3] = 0;
        continue;
      }
      const apexX = size * 0.5;
      const apexY = size * 0.22;
      const baseL = size * 0.22;
      const baseR = size * 0.78;
      const baseY = size * 0.8;
      let inside = false;
      if (y >= apexY && y <= baseY) {
        const t = (y - apexY) / (baseY - apexY);
        const xl = apexX + (baseL - apexX) * t;
        const xr = apexX + (baseR - apexX) * t;
        inside = x >= xl && x <= xr;
      }
      if (inside) {
        const t = (y - apexY) / (baseY - apexY);
        const hue = hues[0] + (hues[hues.length - 1] - hues[0]) * t;
        const [hr, hg, hb] = hslToRgb((hue + 360) % 360, 92, 60);
        px[i] = hr; px[i + 1] = hg; px[i + 2] = hb; px[i + 3] = 255;
      } else {
        px[i] = 0x10; px[i + 1] = 0x14; px[i + 2] = 0x22; px[i + 3] = 255;
      }
    }
  }
  return png(size, size, px);
}

for (const s of [16, 32, 48, 96, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), icon(s));
  console.log(`icons/icon${s}.png`);
}
