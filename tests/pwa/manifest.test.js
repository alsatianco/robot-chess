// What a phone or a browser needs before it offers to install the game as an app: a web app manifest, icons in the right sizes and a few lines in the page head. These tests read the real files, so a wrong path or a missing size shows up here and not on a player's home screen.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_FILES } from '../../scripts/build-icons.mjs';
import en from '../../src/i18n/en.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...path) => readFileSync(join(ROOT, ...path), 'utf8');
const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
const page = read('index.html');
/** The value of one attribute of the first tag in the page head that matches `pattern`. */
const headValue = (pattern, attribute) => new RegExp(`${attribute}="([^"]*)"`).exec(pattern.exec(page)?.[0] ?? '')?.[1] ?? null;
const INK = /--ink:\s*(#[0-9a-f]{6})/i.exec(read('src', 'styles.css'))[1];

describe('web app manifest', () => {
  it('names the game the way the game names itself', () => {
    expect(manifest.name).toBe(en.app.name);
    // A home screen shows about twelve letters under an icon.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.description.length).toBeGreaterThan(20);
    expect(manifest.lang).toBe('en');
  });

  it('opens as its own window, from any folder on any host', () => {
    expect(manifest.display).toBe('standalone');
    // Relative addresses: the built site must work from a sub-path, like every other address in it.
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    // An `id` is read against the root of the host, not against the folder of the game, so it would be wrong on a sub-path. Without it the start address is the id.
    expect(manifest).not.toHaveProperty('id');
    // The game has a layout for every way to hold the device, so it must not lock one.
    expect(manifest).not.toHaveProperty('orientation');
  });

  it('uses the dark color of the interface while the app starts', () => {
    expect(manifest.background_color).toBe(INK);
    expect(manifest.theme_color).toBe(INK);
    expect(headValue(/<meta name="theme-color"[^>]*>/, 'content')).toBe(INK);
  });

  it('lists every icon the script draws for it, with the right size and purpose', () => {
    const drawn = ICON_FILES.filter(({ kind }) => kind !== 'apple').map(({ file, size, kind }) => ({ src: `icons/${file}`, sizes: `${size}x${size}`, type: 'image/png', purpose: kind }));
    expect(manifest.icons).toEqual(drawn);
    // Chrome asks for a 192 and a 512 pixel icon before it offers the install, and Android wants a maskable one for its own icon shapes.
    const has = (size, purpose) => manifest.icons.some((entry) => entry.sizes === `${size}x${size}` && entry.purpose === purpose);
    expect(has(192, 'any') && has(512, 'any') && has(512, 'maskable')).toBe(true);
  });
});

describe('page head', () => {
  it('points to the manifest', () => {
    expect(headValue(/<link rel="manifest"[^>]*>/, 'href')).toBe('/manifest.webmanifest');
  });

  it('gives iOS its own icon, name and full-screen look', () => {
    const apple = ICON_FILES.find(({ kind }) => kind === 'apple');
    expect(headValue(/<link rel="apple-touch-icon"[^>]*>/, 'href')).toBe(`/icons/${apple.file}`);
    expect(apple.size).toBe(180);
    expect(headValue(/<meta name="apple-mobile-web-app-title"[^>]*>/, 'content')).toBe(en.app.name);
    expect(headValue(/<meta name="mobile-web-app-capable"[^>]*>/, 'content')).toBe('yes');
    // The game draws under the status bar and keeps its own controls out of the way with the safe-area values, so the page must ask for the whole screen.
    expect(headValue(/<meta name="apple-mobile-web-app-status-bar-style"[^>]*>/, 'content')).toBe('black-translucent');
    expect(headValue(/<meta name="viewport"[^>]*>/, 'content')).toContain('viewport-fit=cover');
  });
});

describe('icon files on disk', () => {
  it('are written by npm install and can be written again by hand', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts.postinstall).toContain('scripts/build-icons.mjs');
    expect(scripts['icons:build']).toBe('node scripts/build-icons.mjs');
    expect(read('.gitignore')).toContain('public/icons/');
  });

  it.each(ICON_FILES)('$file is a PNG of $size pixels', ({ file, size }) => {
    const png = readFileSync(join(ROOT, 'public', 'icons', file));
    expect(png.toString('latin1', 1, 4)).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
  });
});
