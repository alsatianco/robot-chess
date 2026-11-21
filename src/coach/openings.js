// Opening names. The data comes from the open Lichess openings dataset (CC0) and is built into public/data/openings.json by scripts/build-openings.mjs. The file is a map from a position key to [eco, name]. The game works without it: until it is loaded, and when it can not be loaded, every lookup simply answers null.

/** @type {Map<string, unknown>|null} */
let data = null;
/** @type {Promise<boolean>|null} */
let pending = null;
// Counts every change made by setOpeningsData, so that a download that finishes late does not overwrite data that was set by hand in the meantime.
let generation = 0;

/**
 * The key of a position in the openings data: the first three FEN fields, which are the pieces, the side to move and the castling rights. The build script and the game both make the key with this function from a chess.js FEN, so the two always agree. The en passant square and the move counters are left out on purpose, because the same opening position can be reached with different values there.
 * @param {string} fen
 * @returns {string}
 */
export function openingKey(fen) {
  return fen.trim().split(/\s+/).slice(0, 3).join(' ');
}

/**
 * Set the openings data by hand. Tests use this, and it can also be used to ship the data in another way.
 * @param {Record<string, [string, string]>|Map<string, [string, string]>|null} map A map from `openingKey(fen)` to [eco, name]. null removes the data and lets `loadOpenings` fetch again.
 * @throws {TypeError} When the value is not an object, a Map or null.
 */
export function setOpeningsData(map) {
  generation += 1;
  pending = null;
  if (map == null) {
    data = null;
    return;
  }
  if (map instanceof Map) data = new Map(map);
  else if (typeof map === 'object' && !Array.isArray(map)) data = new Map(Object.entries(map));
  else throw new TypeError('setOpeningsData: expected an object or a Map from position key to [eco, name], or null.');
}

async function fetchOpenings(url, startedAt) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    const json = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('the file is not a map of positions');
    if (startedAt === generation) data = new Map(Object.entries(json));
    return true;
  } catch (error) {
    console.warn(`[coach] Opening names could not be loaded from ${url}: ${error instanceof Error ? error.message : String(error)}. The game goes on without opening names.`);
    return false;
  }
}

/**
 * Load the openings data. It is safe to call this many times: the file is fetched only once, and every call gets the same answer. A failed load is not tried again in the same page, so there is only ever one warning in the console.
 * @param {string} [url] Where the JSON file is. The default is a relative path, because the game is served with relative paths. Only the first call's URL is used.
 * @returns {Promise<boolean>} true when the data is ready. false when the file could not be loaded; this never rejects.
 */
export function loadOpenings(url = './data/openings.json') {
  if (data) return Promise.resolve(true);
  if (!pending) pending = fetchOpenings(url, generation);
  return pending;
}

/**
 * Look up the opening name of a position.
 * @param {string} fen
 * @returns {{ eco: string, name: string }|null} null when the position has no name, or when the data is not loaded (yet). The game should then keep showing the last name it found.
 */
export function findOpening(fen) {
  if (!data || typeof fen !== 'string') return null;
  const entry = data.get(openingKey(fen));
  if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') return null;
  return { eco: entry[0], name: entry[1] };
}
