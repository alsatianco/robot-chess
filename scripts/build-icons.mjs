// Draws the app icons (home screen, app list, Dock) in code and writes them as PNG files into public/icons/. The picture is the robot face of the loading screen inside an ivory robot head, in the game's own colors. It runs on `npm install` and with `npm run icons:build`, so no picture file is kept in the repository.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/**
 * The files to write. `any` is the plain icon with round, see-through corners (desktop and older Android). `maskable` fills the whole square and keeps the robot inside the middle circle, because Android cuts its own shape out of it. `apple` fills the whole square with no see-through pixels, because iOS rounds the corners itself and shows see-through pixels as black.
 * @type {{file: string, size: number, kind: 'any'|'maskable'|'apple'}[]}
 */
export const ICON_FILES = [
  { file: 'icon-192.png', size: 192, kind: 'any' },
  { file: 'icon-512.png', size: 512, kind: 'any' },
  { file: 'icon-maskable-192.png', size: 192, kind: 'maskable' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'apple' },
];

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const COLORS = {
  skyGlow: rgb('#1f3266'),
  skyEdge: rgb('#0a0f1e'),
  shadow: rgb('#03050b'),
  shellTop: rgb('#fff3c4'),
  shellBottom: rgb('#e2c47c'),
  shellEdge: rgb('#b3924c'),
  gloss: rgb('#ffffff'),
  ear: rgb('#c9b07a'),
  metal: rgb('#8d98a8'),
  screenTop: rgb('#0d1424'),
  screenBottom: rgb('#05070d'),
  screenRim: rgb('#1d2942'),
  eye: rgb('#25d9ff'),
  eyeCore: rgb('#c9f6ff'),
  lamp: rgb('#ff8a2b'),
  lampCore: rgb('#ffd9a8'),
};

/** How large the robot is drawn, and how far down it is moved so that head and antenna sit in the middle together. The maskable icon is a little smaller, so that every part stays inside the circle Android may cut (80% of the width). */
const ART = { any: { scale: 1.1, down: 0.12 }, maskable: { scale: 0.96, down: 0.12 }, apple: { scale: 1.1, down: 0.12 } };
/** Corner radius of the plain icon, where 1 is half the icon's width. */
const TILE_RADIUS = 0.46;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Distance from a point to the edge of a box with round corners: below zero inside, above zero outside. */
function roundBox(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x - cx) - (halfWidth - radius);
  const qy = Math.abs(y - cy) - (halfHeight - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}
const circle = (x, y, cx, cy, radius) => Math.hypot(x - cx, y - cy) - radius;

/**
 * Draw one icon. Every shape is a distance function, so its edge is smooth at any size without drawing the picture larger first.
 * @param {number} size Width and height in pixels.
 * @param {'any'|'maskable'|'apple'} kind
 * @returns {Uint8Array} RGBA pixels, row by row.
 */
export function renderIcon(size, kind) {
  const art = ART[kind];
  if (!art) throw new Error(`Unknown icon kind: ${kind}`);
  const rgba = new Uint8Array(size * size * 4);
  /** Width of one pixel, in the units of the art (the icon is 2 units wide before the art is scaled). */
  const pixel = 2 / size / art.scale;
  /** How much of a pixel a shape covers, from its distance to the shape's edge. */
  const cover = (distance) => clamp01(0.5 - distance / pixel);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Icon space: -1..1 in both directions. Art space: the same, scaled and moved down.
      const ix = ((px + 0.5) / size) * 2 - 1;
      const iy = ((py + 0.5) / size) * 2 - 1;
      const x = ix / art.scale;
      const y = iy / art.scale - art.down;

      // Night sky with a soft light from above.
      let color = mix(COLORS.skyGlow, COLORS.skyEdge, clamp01(Math.hypot(ix, iy + 0.85) / 1.9));

      // Soft shadow under the head.
      const shadow = roundBox(x, y, 0, 0.15, 0.6, 0.5, 0.21);
      color = mix(color, COLORS.shadow, 0.55 * clamp01(1 - shadow / 0.2) ** 2);

      // Antenna: a metal stem with an orange lamp, the other team's light color.
      color = mix(color, COLORS.metal, cover(roundBox(x, y, 0, -0.6, 0.024, 0.11, 0.024)));
      const lamp = circle(x, y, 0, -0.72, 0.066);
      const lampGlow = 0.5 * Math.exp(-Math.max(lamp, 0) / 0.05);
      color = [color[0] + COLORS.lamp[0] * lampGlow, color[1] + COLORS.lamp[1] * lampGlow, color[2] + COLORS.lamp[2] * lampGlow];
      color = mix(color, mix(COLORS.lamp, COLORS.lampCore, clamp01(-circle(x, y, -0.015, -0.735, 0.03) / 0.03)), cover(lamp));

      // Ears, half hidden behind the head.
      color = mix(color, COLORS.ear, cover(roundBox(Math.abs(x), y, 0.635, 0.04, 0.05, 0.13, 0.04)));

      // Head: ivory shell, lighter at the top, a little darker at its lower edge, with one soft band of gloss.
      const head = roundBox(x, y, 0, 0.04, 0.6, 0.5, 0.21);
      let shell = mix(COLORS.shellTop, COLORS.shellBottom, clamp01((y + 0.46) / 1));
      shell = mix(shell, COLORS.shellEdge, 0.45 * clamp01(1 + head / 0.06) * clamp01((y + 0.1) / 0.6));
      shell = mix(shell, COLORS.gloss, 0.38 * cover(roundBox(x, y, 0, -0.33, 0.47, 0.075, 0.075)));
      color = mix(color, shell, cover(head));

      // Screen: dark glass with a thin lighter rim.
      const screen = roundBox(x, y, 0, 0.07, 0.46, 0.27, 0.15);
      let glass = mix(COLORS.screenTop, COLORS.screenBottom, clamp01((y + 0.2) / 0.54));
      glass = mix(glass, COLORS.screenRim, clamp01(1 + screen / 0.02));
      // Eyes: two cyan lights that glow on the glass.
      const eye = roundBox(Math.abs(x), y, 0.19, 0.07, 0.072, 0.118, 0.072);
      const eyeGlow = 0.55 * Math.exp(-Math.max(eye, 0) / 0.07);
      glass = [glass[0] + COLORS.eye[0] * eyeGlow, glass[1] + COLORS.eye[1] * eyeGlow, glass[2] + COLORS.eye[2] * eyeGlow];
      glass = mix(glass, mix(COLORS.eye, COLORS.eyeCore, 0.45 * clamp01(-eye / 0.07)), cover(eye));
      color = mix(color, glass, cover(screen));

      const at = (py * size + px) * 4;
      rgba[at] = Math.round(Math.min(255, color[0]));
      rgba[at + 1] = Math.round(Math.min(255, color[1]));
      rgba[at + 2] = Math.round(Math.min(255, color[2]));
      rgba[at + 3] = kind === 'any' ? Math.round(255 * clamp01(0.5 - roundBox(ix, iy, 0, 0, 1, 1, TILE_RADIUS) / (2 / size))) : 255;
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/**
 * Pack RGBA pixels into a PNG file (8 bits per channel, with transparency).
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) throw new Error(`Expected ${width * height * 4} bytes of pixels, got ${rgba.length}`);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  // Every row starts with one byte that names its filter; 0 means the row is stored as it is.
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Run as a script: write the files into public/icons/, from where the build copies them next to the game.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
  try {
    mkdirSync(outDir, { recursive: true });
    for (const { file, size, kind } of ICON_FILES) writeFileSync(join(outDir, file), encodePng(renderIcon(size, kind), size, size));
    console.log(`[icons] Wrote ${ICON_FILES.length} app icons to public/icons`);
  } catch (error) {
    console.error(`[icons] ${error.message}`);
    process.exit(1);
  }
}
