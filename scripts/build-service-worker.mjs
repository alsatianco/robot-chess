// Build step for the service worker: lists every file of the built site with a fingerprint of its content, and writes that list into the worker (src/pwa/service-worker.js). The Vite config calls it after the site is built. The worker's text changes whenever any file changes, and that change is how a browser learns that there is a new version of the game.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_WORKER_FILE } from '../src/pwa/register.js';

/** The line in the worker's source that the build replaces with the file list. */
export const PRECACHE_MARK = '/* __PRECACHE__ */';
// The worker is written under this name into the game's own folder: a worker can only serve pages in its folder and below. The game starts it under the same name.
export { SERVICE_WORKER_FILE };
/** The address of the page inside the list. The page is kept under the address of its folder, because some hosts answer a request for "index.html" with a redirect, and a redirected answer cannot be used to open a page. */
export const PAGE_KEY = './';

// Left out: the worker itself (the browser handles it) and the hidden files that Finder writes on a Mac. The app icons stay in, because the browser asks for one on every start of the page, and with no internet that request would fail and show as an error.
const skip = (path) => path === SERVICE_WORKER_FILE || path.split('/').pop() === '.DS_Store';
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function walk(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]));
}

/**
 * The files of a built site that the worker keeps on the device.
 * @param {string} outDir The folder of the built site.
 * @returns {Record<string, string>} Address inside the game's folder, written as in a web address, to a fingerprint of the file's content. Sorted by address.
 */
export function precacheFiles(outDir) {
  const paths = walk(outDir).filter((path) => !skip(path));
  if (!paths.includes('index.html')) throw new Error(`No index.html in ${outDir}: the service worker would have no page to start from.`);
  const entries = paths.map((path) => [path === 'index.html' ? PAGE_KEY : encodeURI(path), fingerprint(readFileSync(join(outDir, path)))]);
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The text of the finished worker.
 * @param {string} template The worker's source, with the mark on a line of its own.
 * @param {Record<string, string>} files The result of `precacheFiles`.
 * @returns {string}
 */
export function renderServiceWorker(template, files) {
  const marks = template.split(PRECACHE_MARK).length - 1;
  if (marks !== 1) throw new Error(`The service worker source must hold the mark ${PRECACHE_MARK} once, but it holds it ${marks} times.`);
  const version = fingerprint(JSON.stringify(files));
  return template.replace(PRECACHE_MARK, () => `const PRECACHE = ${JSON.stringify({ version, files })};`);
}
