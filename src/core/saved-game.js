// A game in progress, kept in the browser's storage so that a reload, or a phone that drops the page while it is in the background, does not lose it. Like the settings, every stored value is checked before it is trusted: the moves are played again on a real board, so a damaged or outdated save can never put the game into a broken state.
import { Chess, validateFen } from 'chess.js';
import { MODES, modeHasClock } from './game.js';
import { TIME_CONTROLS } from './clock.js';
import { BOT_LEVEL_MIN, BOT_LEVEL_MAX } from '../engine/bot.js';

/** The storage key. It is separate from the settings, so each can be read, checked and removed on its own. */
export const SAVED_GAME_KEY = 'robot-chess.game.v1';
/** No real game is this long (the longest possible game under the fifty-move rule has about 12,000 half-moves, a played one a few hundred). A longer list is not a game, and playing it again would only freeze the page. */
const MAX_PLIES = 2000;
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const isTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The two clock times of a stored game as a clean object, or null when they are not two times. */
function checkClock(value) {
  if (!value || typeof value !== 'object' || !isTime(value.w) || !isTime(value.b)) return null;
  return { w: value.w, b: value.b };
}

/**
 * Check a value that came out of storage. It passes only when it is a game that can go on: a known mode, a level and a color when the game is against the bot, a real start position, at least one move, every move legal in its turn, clocks where the game has a clock, and a position that is not over yet. A two-player game has no bot level and no player color, so it is not asked for them, and it has a clock only when a time control is stored with it.
 * @param {unknown} raw
 * @returns {{v: 1, mode: string, level: number|null, color: 'w'|'b', colorChoice: 'w'|'b'|'random', timeControl: string|null, startFen: string, plies: Array<{uci: string, clock: {w: number, b: number}|null}>, clock: {w: number, b: number}|null, savedAt: number}|null} A new object with only the known values, or null when the value is not such a game. For a two-player game the level is null and both colors are "w".
 */
export function checkSavedGame(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.v !== 1) return null;
  if (typeof raw.mode !== 'string' || !Object.hasOwn(MODES, raw.mode)) return null;
  const bot = MODES[raw.mode].bot;
  if (bot) {
    if (!Number.isInteger(raw.level) || raw.level < BOT_LEVEL_MIN || raw.level > BOT_LEVEL_MAX) return null;
    if (raw.color !== 'w' && raw.color !== 'b') return null;
    if (raw.colorChoice !== 'w' && raw.colorChoice !== 'b' && raw.colorChoice !== 'random') return null;
  }

  const timed = modeHasClock(raw.mode, raw.timeControl);
  let timeControl = null;
  let clock = null;
  if (timed) {
    if (typeof raw.timeControl !== 'string' || !Object.hasOwn(TIME_CONTROLS, raw.timeControl)) return null;
    timeControl = raw.timeControl;
    clock = checkClock(raw.clock);
    if (!clock) return null;
  }

  if (typeof raw.startFen !== 'string' || !validateFen(raw.startFen).ok) return null;
  if (!Array.isArray(raw.plies) || raw.plies.length === 0 || raw.plies.length > MAX_PLIES) return null;
  const plies = [];
  try {
    const chess = new Chess(raw.startFen);
    for (const ply of raw.plies) {
      if (!ply || typeof ply !== 'object' || typeof ply.uci !== 'string' || !UCI_MOVE.test(ply.uci)) return null;
      const plyClock = timed ? checkClock(ply.clock) : null;
      if (timed && !plyClock) return null;
      // chess.js throws when the move is not legal here.
      const move = chess.move({ from: ply.uci.slice(0, 2), to: ply.uci.slice(2, 4), promotion: ply.uci[4] });
      plies.push({ uci: move.from + move.to + (move.promotion ?? ''), clock: plyClock });
    }
    if (chess.isGameOver()) return null;
  } catch {
    return null;
  }
  return { v: 1, mode: raw.mode, level: bot ? raw.level : null, color: bot ? raw.color : 'w', colorChoice: bot ? raw.colorChoice : 'w', timeControl, startFen: raw.startFen, plies, clock, savedAt: isTime(raw.savedAt) ? raw.savedAt : 0 };
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Some browsers throw when storage is blocked (private mode, strict settings).
    return null;
  }
}

/** Keeps storage in line with the game on the board, and knows the stored game of an earlier visit. Without storage it does nothing: the game still works, it just can not come back after a reload. */
export class GameSaver {
  /** @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [store] The storage to use. Tests pass their own; null means "no storage". */
  constructor(store = browserStorage()) {
    this.store = store;
    /** The game that is in storage now, already checked, or null. The home menu offers to go on with it. */
    this.saved = null;
    /** What was written last, without the time of saving, so that an unchanged game is not written again. */
    this.written = null;
    this.warned = false;
    this.#load();
  }

  #load() {
    if (!this.store) return;
    let text;
    try {
      text = this.store.getItem(SAVED_GAME_KEY);
    } catch (error) {
      console.warn('[saved-game] storage could not be read, so no earlier game is offered', error);
      return;
    }
    if (text === null || text === undefined) return;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON at all: handled below, like any other value that is not a game.
    }
    const checked = checkSavedGame(parsed);
    if (!checked) {
      console.warn('[saved-game] the stored game is damaged or from an older version, so it was removed');
      this.#remove();
      return;
    }
    this.saved = checked;
  }

  #remove() {
    try {
      this.store?.removeItem(SAVED_GAME_KEY);
    } catch (error) {
      console.warn('[saved-game] the stored game could not be removed', error);
    }
  }

  /**
   * Bring storage in line with the game. Call it after every change of the game and when the page is hidden. A running game with at least one move is written; a game that is over, or that has no move left after an undo, is removed. While no game is on the board (the menu, the tutorial) storage is left alone, so an earlier game stays there to go on with.
   * @param {import('./game.js').Game} game
   */
  sync(game) {
    if (game.status === 'idle') return;
    const snapshot = game.snapshot();
    if (!snapshot) {
      this.clear();
      return;
    }
    if (!this.store) return;
    const { savedAt, ...content } = snapshot;
    const fingerprint = JSON.stringify(content);
    if (fingerprint === this.written) return;
    try {
      this.store.setItem(SAVED_GAME_KEY, JSON.stringify(snapshot));
      this.written = fingerprint;
      this.saved = snapshot;
    } catch (error) {
      // Storage is full or blocked. Say it once and let the game go on without a save.
      if (!this.warned) console.warn('[saved-game] the game could not be saved, so it can not come back after a reload', error);
      this.warned = true;
      this.saved = null;
    }
  }

  /** Forget the stored game: the player started a new one, left this one on purpose, or reset the saved data. */
  clear() {
    this.saved = null;
    this.written = null;
    this.#remove();
  }
}
