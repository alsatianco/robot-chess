import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { precacheFiles, renderServiceWorker, SERVICE_WORKER_FILE } from './scripts/build-service-worker.mjs';

// macOS writes a hidden `.DS_Store` file into every folder that Finder has opened, `public/` included, and the build copies `public/` as it is. This plugin removes those files from the built site, so a build made on a Mac ships nothing but the game.
function dropFinderFiles() {
  let outDir = 'dist';
  const clean = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) clean(path);
      else if (entry.name === '.DS_Store') rmSync(path);
    }
  };
  return {
    name: 'drop-finder-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      clean(outDir);
    },
  };
}

// The game can be installed as an app and then runs with no internet. For that a service worker keeps every file of the built site on the device. This plugin writes the worker next to the page once the site is built: the worker's source (src/pwa/service-worker.js) with the list of the built files in it. The dev server has no worker, so it always serves fresh files.
function writeServiceWorker() {
  let root = '.';
  let outDir = 'dist';
  return {
    name: 'write-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle(error) {
      // A failed build has no finished site to list, and its own error is the one to show.
      if (error) return;
      const template = readFileSync(resolve(root, 'src/pwa/service-worker.js'), 'utf8');
      writeFileSync(join(outDir, SERVICE_WORKER_FILE), renderServiceWorker(template, precacheFiles(outDir)));
    },
  };
}

// Static site. `base: './'` keeps every asset path relative, so the built `dist/` folder works from any sub-path on any static host.
export default defineConfig({
  base: './',
  plugins: [dropFinderFiles(), writeServiceWorker()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
