// The app icons (home screen, app list, Dock) are drawn in code by scripts/build-icons.mjs, like every other picture in the game. These tests check the picture rules that an installed app needs: a real PNG file, a full square for the systems that cut their own shape, and all the art inside the part that is never cut away.
import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { ICON_FILES, renderIcon, encodePng } from '../../scripts/build-icons.mjs';

const SIZE = 96;
const pixel = (rgba, size, x, y) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
const brightness = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Read a PNG back into its size and pixels. Only the simple kind that the script writes: 8-bit RGBA, not interlaced, every row with filter 0. */
function decodePng(buffer) {
  expect([...buffer.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    chunks.push({ type: buffer.toString('latin1', at + 4, at + 8), data: buffer.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const raw = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    expect(raw[row]).toBe(0);
    rgba.set(raw.subarray(row + 1, row + 1 + width * 4), y * width * 4);
  }
  return { width, height, bitDepth: header[8], colorType: header[9], types: chunks.map((chunk) => chunk.type), rgba };
}

describe('app icon files', () => {
  it('lists the sizes that Android, desktop browsers and iOS ask for', () => {
    const wanted = ICON_FILES.map(({ size, kind }) => `${kind} ${size}`).sort();
    expect(wanted).toEqual(['any 192', 'any 512', 'apple 180', 'maskable 192', 'maskable 512']);
    expect(new Set(ICON_FILES.map(({ file }) => file)).size).toBe(ICON_FILES.length);
  });

  it('writes a PNG that reads back to the same pixels', () => {
    const rgba = renderIcon(SIZE, 'any');
    const png = decodePng(encodePng(rgba, SIZE, SIZE));
    expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([SIZE, SIZE, 8, 6]);
    expect(png.types[0]).toBe('IHDR');
    expect(png.types.at(-1)).toBe('IEND');
    expect(Buffer.compare(Buffer.from(png.rgba), Buffer.from(rgba))).toBe(0);
  });

  it('draws the same picture every time', () => {
    expect(Buffer.compare(Buffer.from(renderIcon(SIZE, 'maskable')), Buffer.from(renderIcon(SIZE, 'maskable')))).toBe(0);
  });
});

describe('app icon picture', () => {
  it('gives the plain icon round corners that are see-through', () => {
    const rgba = renderIcon(SIZE, 'any');
    for (const [x, y] of [[0, 0], [SIZE - 1, 0], [0, SIZE - 1], [SIZE - 1, SIZE - 1]]) expect(pixel(rgba, SIZE, x, y)[3]).toBe(0);
    expect(pixel(rgba, SIZE, SIZE / 2, 2)[3]).toBe(255);
  });

  it.each(['maskable', 'apple'])('fills the whole square of the %s icon, because the system cuts its own shape', (kind) => {
    const rgba = renderIcon(SIZE, kind);
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255);
  });

  it('keeps the robot inside the safe circle of the maskable icon', () => {
    // Android may cut a maskable icon down to a circle that is 80% as wide as the square. Outside that circle there must be nothing but the dark background.
    const rgba = renderIcon(SIZE, 'maskable');
    const middle = (SIZE - 1) / 2;
    let brightest = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (Math.hypot(x - middle, y - middle) > SIZE * 0.4) brightest = Math.max(brightest, brightness(pixel(rgba, SIZE, x, y)));
      }
    }
    expect(brightest).toBeLessThan(70);
  });

  it.each(['any', 'maskable', 'apple'])('shows a light robot head with two cyan eyes on the %s icon', (kind) => {
    const rgba = renderIcon(SIZE, kind);
    const rows = [];
    for (let y = 0; y < SIZE; y++) {
      let cyan = 0;
      let light = 0;
      for (let x = 0; x < SIZE; x++) {
        const [r, g, b] = pixel(rgba, SIZE, x, y);
        if (b > 200 && g > 170 && r < 150) cyan++;
        if (r > 200 && g > 180 && b > 110 && r > b) light++;
      }
      rows.push({ cyan, light });
    }
    // The eye row has cyan on both sides of the middle and the dark screen between them.
    const eyeRow = rows.reduce((best, row, y) => (row.cyan > rows[best].cyan ? y : best), 0);
    const cyanAt = [];
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixel(rgba, SIZE, x, eyeRow);
      if (b > 200 && g > 170 && r < 150) cyanAt.push(x);
    }
    expect(cyanAt.some((x) => x < SIZE / 2 - 2)).toBe(true);
    expect(cyanAt.some((x) => x > SIZE / 2 + 2)).toBe(true);
    expect(brightness(pixel(rgba, SIZE, SIZE / 2, eyeRow))).toBeLessThan(60);
    expect(rows.reduce((sum, row) => sum + row.light, 0)).toBeGreaterThan(SIZE * SIZE * 0.08);
  });
});
