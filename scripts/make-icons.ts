// Renders the app icon (a white sprout on green) to PNG without any image library.
//   node scripts/make-icons.ts

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GREEN = [47, 107, 58];
const WHITE = [255, 255, 255];

/** Coverage of the sprout at a point in a 0..1 square, as a signed-distance test. */
function inSprout(x: number, y: number): boolean {
  // Stem
  if (Math.abs(x - 0.5) < 0.035 && y > 0.42 && y < 0.8) return true;
  // Two leaves: each is the intersection of two circles (a lens), tilted outwards.
  const leaf = (cx: number, cy: number, angle: number) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const lx = (x - cx) * c + (y - cy) * s;
    const ly = -(x - cx) * s + (y - cy) * c;
    const r = 0.2, d = 0.13;
    return Math.hypot(lx, ly - d) < r && Math.hypot(lx, ly + d) < r;
  };
  return leaf(0.36, 0.42, -0.6) || leaf(0.64, 0.38, 0.6);
}

function png(size: number): Buffer {
  const ss = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        if (inSprout((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)) hits++;
      }
      const a = hits / (ss * ss);
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(GREEN[i] * (1 - a) + WHITE[i] * a);
      raw[o + 3] = 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

for (const size of [192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size));
