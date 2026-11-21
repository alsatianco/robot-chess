// Builds public/data/openings.json from the open Lichess openings dataset (repository lichess-org/chess-openings on GitHub, licence CC0). It downloads the five files a.tsv to e.tsv (columns: eco, name, pgn), replays every line of moves with chess.js and writes a compact map from a position key to [eco, name]. The key is made by the same function the game uses at run time, so the two always agree. Run it with `npm run openings:build`. If anything goes wrong, the script stops with an error and does not write a half-finished file.
import { mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { openingKey } from '../src/coach/openings.js';

const SOURCE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];
const HEADER = 'eco\tname\tpgn';
const ECO_PATTERN = /^[A-E]\d\d$/;
const DOWNLOAD_TIMEOUT_MS = 30000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'public/data/openings.json');

async function download(name) {
  const response = await fetch(SOURCE + name, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${name}: the server answered ${response.status}`);
  return response.text();
}

// Reads one file into rows. The files are plain text from the network, so every line is checked before it is used.
function parseFile(name, text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== HEADER) throw new Error(`${name}: the first line should be the column names eco, name, pgn, but it is "${lines[0]}"`);
  const rows = [];
  lines.slice(1).forEach((line, index) => {
    if (line.trim() === '') return;
    const where = `${name} line ${index + 2}`;
    const columns = line.split('\t');
    if (columns.length !== 3) throw new Error(`${where}: expected 3 columns, found ${columns.length}`);
    const [eco, openingName, pgn] = columns.map((column) => column.trim());
    if (!ECO_PATTERN.test(eco)) throw new Error(`${where}: "${eco}" is not an ECO code`);
    if (openingName === '' || pgn === '') throw new Error(`${where}: the name or the moves are empty`);
    rows.push({ where, eco, name: openingName, pgn });
  });
  if (rows.length === 0) throw new Error(`${name}: the file has no openings`);
  return rows;
}

function positionKey(row) {
  const chess = new Chess();
  try {
    chess.loadPgn(row.pgn);
  } catch (error) {
    throw new Error(`${row.where}: chess.js can not replay "${row.pgn}": ${error.message}`);
  }
  if (chess.history().length === 0) throw new Error(`${row.where}: "${row.pgn}" has no moves`);
  return openingKey(chess.fen());
}

async function main() {
  const texts = await Promise.all(FILES.map(download));
  const openings = new Map();
  let rowCount = 0;
  let sameName = 0;
  const otherName = [];
  FILES.forEach((name, index) => {
    for (const row of parseFile(name, texts[index])) {
      rowCount += 1;
      const key = positionKey(row);
      const known = openings.get(key);
      if (!known) {
        openings.set(key, [row.eco, row.name]);
      } else if (known[1] === row.name) {
        sameName += 1;
      } else {
        // Two lines of moves that reach the same position under two names. The first one in the dataset is kept.
        otherName.push(`${row.where}: "${row.name}" reaches the same position as "${known[1]}"`);
      }
    }
  });

  mkdirSync(dirname(outFile), { recursive: true });
  const tempFile = outFile + '.tmp';
  writeFileSync(tempFile, JSON.stringify(Object.fromEntries(openings)) + '\n');
  renameSync(tempFile, outFile);

  const kilobytes = (statSync(outFile).size / 1024).toFixed(1);
  console.log(`[build-openings] Read ${rowCount} openings from ${FILES.length} files.`);
  console.log(`[build-openings] Wrote ${openings.size} positions to public/data/openings.json (${kilobytes} kB).`);
  if (sameName > 0) console.log(`[build-openings] ${sameName} lines reach a position that already had the same name.`);
  if (otherName.length > 0) {
    console.log(`[build-openings] ${otherName.length} lines reach a position that already had another name. The first name was kept:`);
    for (const note of otherName) console.log('  ' + note);
  }
}

main().catch((error) => {
  console.error(`[build-openings] Failed: ${error.message}. No file was written.`);
  process.exit(1);
});
