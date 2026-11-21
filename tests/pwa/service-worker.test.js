// The service worker keeps the game's files on the device, so an installed game starts with no internet. These tests run the real worker source, with the file list the real build step writes into it, against a stand-in for the browser's cache and for the network.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderServiceWorker } from '../../scripts/build-service-worker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = readFileSync(join(ROOT, 'src', 'pwa', 'service-worker.js'), 'utf8');
/** The game lives in a sub-folder here, as it may on a real host. */
const SCOPE = 'https://play.example/robot-chess/';

const V1 = { './': 'page1', 'assets/index-aaa.js': 'js1', 'engine/engine.wasm': 'wasm1', 'data/openings.json': 'data1' };
const V2 = { './': 'page2', 'assets/index-bbb.js': 'js2', 'engine/engine.wasm': 'wasm1', 'data/openings.json': 'data2' };
/** The file list as the build writes it. A stand-in fingerprint is enough: it changes exactly when the content changes. */
const listOf = (site) => Object.fromEntries(Object.entries(site).map(([path, content]) => [path, `fp-${content}`]));

class FakeCache {
  entries = new Map();
  async match(key) {
    return this.entries.get(String(key.url ?? key))?.clone();
  }
  async put(key, response) {
    this.entries.set(String(key.url ?? key), response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(key) {
    return this.entries.delete(String(key.url ?? key));
  }
}

/** One device: its cache storage outlives every version of the worker. */
function makeDevice() {
  const stores = new Map();
  return {
    stores,
    caches: {
      async open(name) {
        if (!stores.has(name)) stores.set(name, new FakeCache());
        return stores.get(name);
      },
    },
    /** Everything the device holds, as "address → content". */
    async held() {
      const out = {};
      for (const cache of stores.values()) for (const [url, response] of cache.entries) out[url] = await response.clone().text();
      return out;
    },
  };
}

/** A host that serves `site`. `broken` paths answer with an error, `redirected` paths answer after a redirect. */
function makeServer(site, { broken = [], redirected = [] } = {}) {
  return (url) => {
    const path = url.slice(SCOPE.length) || './';
    if (!url.startsWith(SCOPE) || !(path in site) || broken.includes(path)) return new Response('not found', { status: 404 });
    const response = new Response(site[path], { status: 200, headers: { 'content-type': 'text/plain' } });
    if (redirected.includes(path)) Object.defineProperty(response, 'redirected', { value: true });
    return response;
  };
}

/** Start one version of the worker on a device. */
function startWorker(site, device, server = makeServer(site)) {
  const listeners = {};
  const network = [];
  const self = {
    registration: { scope: SCOPE },
    claimed: 0,
    clients: { claim: async () => void self.claimed++ },
    addEventListener: (type, listener) => void (listeners[type] = listener),
  };
  const fetch = async (input, init = {}) => {
    const url = String(input.url ?? input);
    network.push({ url, cache: init.cache ?? null });
    return server(url);
  };
  // The text that runs here is the game's own worker source with the build's file list in it, the same text a browser would run. Nothing from outside the repository reaches it.
  new Function('self', 'caches', 'fetch', renderServiceWorker(SOURCE, listOf(site)))(self, device.caches, fetch);
  const lifecycle = async (type) => {
    let done = null;
    listeners[type]({ waitUntil: (promise) => void (done = promise) });
    await done;
  };
  return {
    self,
    network,
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    /** Send one request of a page through the worker. Returns the worker's answer as text, or null when the worker leaves the request to the browser. */
    async ask(url, init) {
      let answer = null;
      listeners.fetch({ request: new Request(url, init), respondWith: (promise) => void (answer = promise) });
      return answer ? (await answer).text() : null;
    },
  };
}

async function installed(site, device = makeDevice()) {
  const worker = startWorker(site, device);
  await worker.install();
  await worker.activate();
  worker.network.length = 0;
  return { worker, device };
}

describe('service worker: first install', () => {
  it('downloads every file of the list once, from the game folder', async () => {
    const worker = startWorker(V1, makeDevice());
    await worker.install();
    expect(worker.network.map((call) => call.url).sort()).toEqual([SCOPE, `${SCOPE}assets/index-aaa.js`, `${SCOPE}data/openings.json`, `${SCOPE}engine/engine.wasm`]);
  });

  it('asks the host each time, so a stale copy in the browser cache can not end up in a new version', async () => {
    const worker = startWorker(V1, makeDevice());
    await worker.install();
    expect(new Set(worker.network.map((call) => call.cache))).toEqual(new Set(['no-cache']));
  });

  it('fails as a whole when one file can not be downloaded, so a half copy is never used', async () => {
    const worker = startWorker(V1, makeDevice(), makeServer(V1, { broken: ['engine/engine.wasm'] }));
    await expect(worker.install()).rejects.toThrow(/engine\/engine\.wasm/);
  });

  it('takes over the open page when it is ready', async () => {
    const { worker } = await installed(V1);
    expect(worker.self.claimed).toBe(1);
  });

  it('stores a redirected answer as a plain one, because a redirected answer can not open a page', async () => {
    const device = makeDevice();
    const worker = startWorker(V1, device, makeServer(V1, { redirected: ['./'] }));
    await worker.install();
    const stored = [...device.stores.values()].flatMap((cache) => [...cache.entries.values()]);
    expect(stored).toHaveLength(4);
    expect(stored.some((response) => response.redirected)).toBe(false);
    expect(await worker.ask(SCOPE)).toBe('page1');
  });
});

describe('service worker: answering the game', () => {
  it('answers a page load from the device, with no network', async () => {
    const { worker } = await installed(V1);
    expect(await worker.ask(SCOPE)).toBe('page1');
    expect(await worker.ask(`${SCOPE}index.html`)).toBe('page1');
    expect(await worker.ask(`${SCOPE}?source=homescreen`)).toBe('page1');
    expect(worker.network).toEqual([]);
  });

  it('answers the game files from the device, with no network', async () => {
    const { worker } = await installed(V1);
    expect(await worker.ask(`${SCOPE}assets/index-aaa.js`)).toBe('js1');
    expect(await worker.ask(`${SCOPE}engine/engine.wasm`)).toBe('wasm1');
    expect(await worker.ask(`${SCOPE}data/openings.json`)).toBe('data1');
    expect(worker.network).toEqual([]);
  });

  it('leaves alone what is not a file of the game', async () => {
    const { worker } = await installed(V1);
    expect(await worker.ask(`${SCOPE}assets/unknown.js`)).toBe(null);
    expect(await worker.ask(`${SCOPE}constructor`)).toBe(null);
    expect(await worker.ask('https://play.example/other-app/index.html')).toBe(null);
    expect(await worker.ask('https://play.example/robot-chess-two/')).toBe(null);
    expect(await worker.ask('https://elsewhere.example/robot-chess/assets/index-aaa.js')).toBe(null);
    expect(await worker.ask(`${SCOPE}data/openings.json`, { method: 'POST', body: 'x' })).toBe(null);
    expect(worker.network).toEqual([]);
  });

  it('falls back to the network when the device has lost a file', async () => {
    const { worker, device } = await installed(V1);
    for (const cache of device.stores.values()) cache.entries.clear();
    expect(await worker.ask(`${SCOPE}data/openings.json`)).toBe('data1');
    expect(worker.network.map((call) => call.url)).toEqual([`${SCOPE}data/openings.json`]);
  });
});

describe('service worker: a new version of the game', () => {
  it('downloads only the files that changed', async () => {
    const { device } = await installed(V1);
    const next = startWorker(V2, device);
    await next.install();
    expect(next.network.map((call) => call.url).sort()).toEqual([SCOPE, `${SCOPE}assets/index-bbb.js`, `${SCOPE}data/openings.json`]);
  });

  it('keeps the old files while a page of the old version is still open', async () => {
    const { worker: old, device } = await installed(V1);
    await startWorker(V2, device).install();
    expect(await old.ask(SCOPE)).toBe('page1');
    expect(await old.ask(`${SCOPE}assets/index-aaa.js`)).toBe('js1');
    expect(await old.ask(`${SCOPE}data/openings.json`)).toBe('data1');
    expect(old.network).toEqual([]);
  });

  it('serves the new files and removes the old ones once it takes over', async () => {
    const { device } = await installed(V1);
    const { worker: next } = await installed(V2, device);
    expect(await next.ask(SCOPE)).toBe('page2');
    expect(await next.ask(`${SCOPE}assets/index-bbb.js`)).toBe('js2');
    expect(await next.ask(`${SCOPE}engine/engine.wasm`)).toBe('wasm1');
    expect(await next.ask(`${SCOPE}assets/index-aaa.js`)).toBe(null);
    expect(Object.values(await device.held()).sort()).toEqual(['data2', 'js2', 'page2', 'wasm1']);
  });
});
