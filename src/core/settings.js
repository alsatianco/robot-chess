// Player settings. They apply at once, are saved to localStorage, and every stored value is checked against the allowed values when loaded, so a damaged or outdated save can never put the game into a broken state.
import { BOARD_THEMES, DEFAULT_THEME, BOARD_COLORS, DEFAULT_BOARD_COLORS } from '../gfx/palette.js';
import { TIME_CONTROLS, DEFAULT_TIME_CONTROL } from './clock.js';
import { FRAME_RATES, DEFAULT_FRAME_RATE } from '../app/frame-limiter.js';
import { DEFAULT_LEVEL } from '../coach/levels.js';

const STORAGE_KEY = 'robot-chess.settings.v1';

const oneOf = (...values) => (value) => values.includes(value);
const bool = (value) => typeof value === 'boolean';
const range = (min, max) => (value) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Every setting: its default and a check for allowed values. */
const SCHEMA = {
  onboarded: [false, bool],
  tutorialDone: [false, bool],
  // Gameplay
  moveInput: ['both', oneOf('both', 'drag', 'tap')],
  legalHints: [true, bool],
  moveConfirm: [false, bool],
  autoQueen: [false, bool],
  // Coach
  coachLevel: [DEFAULT_LEVEL, oneOf(1, 2, 3)],
  coachWhen: ['every', oneOf('every', 'mistakes')],
  evalBar: [false, bool],
  // Two players at one device
  twoPlayerFlip: [true, bool],
  twoPlayerCoach: [false, bool],
  twoPlayerClock: ['none', (value) => value === 'none' || (typeof value === 'string' && Object.hasOwn(TIME_CONTROLS, value))],
  // Board
  boardTheme: [DEFAULT_THEME, (value) => Object.hasOwn(BOARD_THEMES, value)],
  boardColors: [DEFAULT_BOARD_COLORS, oneOf(...BOARD_COLORS)],
  coordinates: [true, bool],
  camera: ['angled', oneOf('angled', 'top')],
  // Animation and effects
  animation: ['standard', oneOf('cinematic', 'standard', 'minimal', 'instant')],
  shake: [true, bool],
  quality: ['auto', oneOf('auto', 'low', 'medium', 'high')],
  frameRate: [DEFAULT_FRAME_RATE, oneOf(...FRAME_RATES)],
  // Sound
  volume: [0.8, range(0, 1)],
  // Last game setup, so the menu opens the way the player left it
  mode: ['coach', oneOf('free', 'timed', 'ranked', 'coach', 'two')],
  botLevel: [1, (value) => Number.isInteger(value) && value >= 1 && value <= 8],
  playerColor: ['w', oneOf('w', 'b', 'random')],
  timeControl: [DEFAULT_TIME_CONTROL, (value) => Object.hasOwn(TIME_CONTROLS, value)],
};

function defaults() {
  const values = {};
  for (const [key, [fallback]] of Object.entries(SCHEMA)) values[key] = fallback;
  return values;
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Some browsers throw when storage is blocked (private mode, strict settings).
    return null;
  }
}

export class Settings {
  constructor() {
    this.values = defaults();
    /** @type {Set<(key:string, value:any) => void>} */
    this.listeners = new Set();
    /** False when the browser refuses storage; the game still works, it just forgets on reload. */
    this.persistent = true;
    this.#load();
  }

  #load() {
    const store = storage();
    if (!store) {
      this.persistent = false;
      return;
    }
    let saved = null;
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (error) {
      console.warn('[settings] saved settings could not be read, using defaults', error);
    }
    if (saved && typeof saved === 'object') {
      for (const [key, [, isValid]] of Object.entries(SCHEMA)) {
        if (key in saved && isValid(saved[key])) this.values[key] = saved[key];
      }
    }
    // First launch on a device that asks for less motion: start with the Minimal preset.
    if (!saved && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.values.animation = 'minimal';
      this.values.shake = false;
    }
  }

  #save() {
    const store = storage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch (error) {
      if (this.persistent) console.warn('[settings] settings could not be saved', error);
      this.persistent = false;
    }
  }

  get(key) {
    return this.values[key];
  }

  /** Change one setting. Unknown keys and values that are not allowed are refused with an error, never stored. */
  set(key, value) {
    const entry = SCHEMA[key];
    if (!entry) throw new Error(`Unknown setting: ${key}`);
    if (!entry[1](value)) throw new Error(`Value not allowed for setting ${key}: ${JSON.stringify(value)}`);
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.#save();
    for (const listener of this.listeners) listener(key, value);
  }

  /** Listen for changes. Returns a function that removes the listener. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Erase everything saved by the game and go back to the defaults. */
  reset() {
    const store = storage();
    try {
      store?.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[settings] saved data could not be removed', error);
    }
    this.values = defaults();
    for (const listener of this.listeners) listener('*', null);
  }
}

/**
 * Starting values from the onboarding answer. A player who plays often starts on the Advanced coach with the evaluation bar, and every other player on Middle: coach levels follow chess understanding, and the game does not ask for the age. No answer leads to the Beginner coach or to the confirm step before each move: a player who wants one of them turns it on in the settings.
 * @param {'new'|'rules'|'player'} experience
 */
export function onboardingDefaults(experience) {
  const coachLevel = experience === 'player' ? 3 : DEFAULT_LEVEL;
  const botLevel = experience === 'new' ? 1 : experience === 'rules' ? 2 : 4;
  return {
    coachLevel,
    botLevel,
    legalHints: true,
    // Off for every answer. Asking before each move slows the game down, so it is the player's own choice.
    moveConfirm: false,
    evalBar: coachLevel === 3,
    mode: 'coach',
  };
}
