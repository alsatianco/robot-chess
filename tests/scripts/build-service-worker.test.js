// The build writes the service worker with a list of every file of the game and a fingerprint of each file's content. A file that is missing from the list is not there when the player is offline, and a fingerprint that does not change with the content means players never get the new version. These tests check that list.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { precacheFiles, renderServiceWorker, PRECACHE_MARK } from '../../scripts/build-service-worker.mjs';

const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
/** A folder that looks like a built site. `files` maps a path to its content. */
function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'robot-chess-sw-'));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}
const BUILT = { 'index.html': '<html>', 'assets/index-abc.js': 'js', 'assets/index-abc.css': 'css', 'engine/engine.wasm': 'wasm', 'data/openings.json': '{}', 'licenses.txt': 'MIT', 'manifest.webmanifest': '{}' };

describe('list of files to keep on the device', () => {
  it('holds every file of the game, with the page itself under the address of its folder', () => {
    expect(Object.keys(precacheFiles(site(BUILT)))).toEqual(['./', 'assets/index-abc.css', 'assets/index-abc.js', 'data/openings.json', 'engine/engine.wasm', 'licenses.txt', 'manifest.webmanifest']);
  });

  it('leaves out the service worker itself and Finder files', () => {
    const files = precacheFiles(site({ ...BUILT, 'sw.js': 'old worker', '.DS_Store': 'x', 'assets/.DS_Store': 'x' }));
    expect(Object.keys(files)).toEqual(Object.keys(precacheFiles(site(BUILT))));
  });

  it('holds the app icons too, because the browser asks for one on every start, also with no internet', () => {
    expect(Object.keys(precacheFiles(site({ ...BUILT, 'icons/icon-192.png': 'png' })))).toContain('icons/icon-192.png');
  });

  it('gives each file a fingerprint that follows its content and nothing else', () => {
    const first = precacheFiles(site(BUILT));
    const same = precacheFiles(site(BUILT));
    const changed = precacheFiles(site({ ...BUILT, 'data/openings.json': '{"a":1}' }));
    expect(same).toEqual(first);
    for (const fingerprint of Object.values(first)) expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(changed['data/openings.json']).not.toBe(first['data/openings.json']);
    expect(changed['engine/engine.wasm']).toBe(first['engine/engine.wasm']);
  });

  it('writes a file name the way it looks inside a web address', () => {
    expect(Object.keys(precacheFiles(site({ 'index.html': 'x', 'data/two words.json': '{}' })))).toEqual(['./', 'data/two%20words.json']);
  });

  it('refuses a site with no page, because nothing could start offline', () => {
    expect(() => precacheFiles(site({ 'assets/a.js': 'js' }))).toThrow(/index\.html/);
  });
});

describe('service worker text', () => {
  const template = `// worker\n${PRECACHE_MARK}\nself.addEventListener('install', () => {});\n`;
  const read = (text) => JSON.parse(/^const PRECACHE = (.*);$/m.exec(text)[1]);

  it('puts the list in place of the mark and keeps the rest of the worker', () => {
    const files = precacheFiles(site(BUILT));
    const text = renderServiceWorker(template, files);
    expect(text).not.toContain(PRECACHE_MARK);
    expect(text.startsWith('// worker\n')).toBe(true);
    expect(text).toContain("self.addEventListener('install', () => {});");
    expect(read(text).files).toEqual(files);
  });

  it('changes when any file changes, so the browser sees a new version', () => {
    const before = renderServiceWorker(template, precacheFiles(site(BUILT)));
    const again = renderServiceWorker(template, precacheFiles(site(BUILT)));
    const after = renderServiceWorker(template, precacheFiles(site({ ...BUILT, 'engine/engine.wasm': 'new wasm' })));
    expect(again).toBe(before);
    expect(after).not.toBe(before);
    expect(read(after).version).not.toBe(read(before).version);
    expect(read(before).version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('fails loudly when the worker has no mark, or more than one', () => {
    expect(() => renderServiceWorker('// worker with no mark\n', { './': 'a' })).toThrow(/mark/);
    expect(() => renderServiceWorker(`${PRECACHE_MARK}\n${PRECACHE_MARK}\n`, { './': 'a' })).toThrow(/mark/);
  });
});
