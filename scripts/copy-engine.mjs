// Copies the single-threaded Stockfish WebAssembly build from node_modules into public/engine with stable file names. The single-threaded build is used on purpose: the multi-threaded build needs COOP/COEP headers that some static hosts cannot set.
import { readdirSync, copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [join(root, 'node_modules/stockfish/bin'), join(root, 'node_modules/stockfish/src')];
const srcDir = candidates.find((d) => existsSync(d));
if (!srcDir) {
  console.warn('[copy-engine] stockfish package not found yet, skipping.');
  process.exit(0);
}
const files = readdirSync(srcDir);
const js = files.find((f) => /lite-single.*\.js$/.test(f));
if (!js) {
  console.error('[copy-engine] No lite single-threaded Stockfish build found in ' + srcDir + '. Files: ' + files.join(', '));
  process.exit(1);
}
const wasm = js.replace(/\.js$/, '.wasm');
if (!files.includes(wasm)) {
  console.error('[copy-engine] Missing wasm file next to ' + js);
  process.exit(1);
}
const outDir = join(root, 'public/engine');
mkdirSync(outDir, { recursive: true });
copyFileSync(join(srcDir, js), join(outDir, js));
copyFileSync(join(srcDir, wasm), join(outDir, wasm));
writeFileSync(join(outDir, 'engine.json'), JSON.stringify({ js, wasm }, null, 2) + '\n');
console.log('[copy-engine] Copied ' + js + ' and ' + wasm + ' to public/engine');
