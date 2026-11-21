// The "auto" graphics quality: it finds the best quality level that this device draws fast enough. A browser does not say how strong the graphics chip is, so the game measures it: it draws a few real frames, waits for the graphics chip and takes the time. The result is kept in the browser's storage, so a device is measured once. Pure logic with no DOM and no three.js, so it is tested without a browser.
import { slowFrameRate } from './frame-limiter.js';

/** The quality levels from the lightest to the heaviest. The same names and order as `QUALITY` in `src/gfx/stage.js`. */
export const QUALITY_LEVELS = ['low', 'medium', 'high'];

/** A level is kept when the device draws it this much faster than the rate at which the watchdog in the frame loop calls the game slow. The room is for the busy moments of a game (effects, a phone that gets warm), so a level that is kept is not lowered again right away. */
const KEEP_MARGIN = 1.2;
/** The longest time in milliseconds that one frame of a level may take for the level to be kept (about 32 frames per second). The look comes first: a level is not given up for a higher frame rate, only when the game would be slow. */
export const KEEP_FRAME_MS = 1000 / (slowFrameRate('max') * KEEP_MARGIN);

/** How many times more a level costs than the level below it, at least. The next level is only tried when this forecast says that it can fit, because a try costs start-up time. From Low to Medium the screen has 2.25 times the pixels and every shader is built again, so that try must be likely to work; from Medium to High the shaders stay, so that try is cheap and may be more hopeful (measured on an M3 Pro: 2.5 and 2.2 times). */
const STEP_COST = { medium: 2.5, high: 1.8 };

/** Frames drawn and thrown away after a change of level: the first ones build shaders and textures. */
const WARMUP_FRAMES = 2;
/** Frames are drawn in groups of this size with one wait for the graphics chip at the end, like frames in a game that follow each other. */
const FRAMES_PER_GROUP = 3;
/** One sample is as many groups as it takes to fill this time in milliseconds, so a clock that only shows whole milliseconds (Safari, Firefox) still measures fast frames well. */
const SAMPLE_MS = 40;
/** A sample that does not fill its time after this many groups means that the clock of the browser does not move. */
const MAX_GROUPS_PER_SAMPLE = 100;
/** A graphics chip that was idle runs at a low clock speed, and it needs about a quarter of a second of work before it runs at full speed: on an M3 Pro the first frames took 2.6 times as long as the later ones. So a level is drawn for at least this many milliseconds. */
const MIN_LOAD_MS = 300;
/** The measuring of a level ends when no sample was faster for this many milliseconds. A sample counts as faster when it beats the best one by `FASTER_SHARE`. */
const SETTLE_MS = 150;
const FASTER_SHARE = 0.03;
/** The longest time in milliseconds spent on one level. */
const MAX_LOAD_MS = 1200;
/** A level that is still this many times too slow after `MIN_LOAD_MS` is given up at once: no warm-up closes such a gap. */
const GIVE_UP_FACTOR = 4;

/** The record of an earlier measurement is used again while the picture has about the same number of pixels: up to this factor more or fewer. */
const PIXEL_TOLERANCE = 1.3;
/** Goes up when the levels or the rules above change, so that devices are measured again. */
const RULES_VERSION = 1;
const STORAGE_KEY = 'robot-chess.quality.v1';

const isLevel = (value) => QUALITY_LEVELS.includes(value);
/** True when the browser tells this number and it is `limit` or lower. A number that the browser does not tell says nothing about the device, so it never counts against it. */
const atMost = (value, limit) => typeof value === 'number' && Number.isFinite(value) && value <= limit;

/**
 * A first guess of the quality level from what the browser tells about the device. It is where the measuring starts, and the answer when measuring is not possible. Browsers tell little: Safari tells no memory size and only "4 or 8" processor cores, on iPhone, iPad and Mac alike; Firefox tells no memory size; Chrome tells it only on https pages. So the guess only goes down for a number that is really told.
 * @param {{userAgent?: string, maxTouchPoints?: number, hardwareConcurrency?: number, deviceMemory?: number}} [nav]
 * @returns {'low'|'medium'|'high'}
 */
export function guessQuality(nav = globalThis.navigator ?? {}) {
  const agent = nav.userAgent ?? '';
  // An iPad says that it is a Mac, so a "Mac" with a touch screen is taken as an iPad.
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(agent) || (nav.maxTouchPoints > 1 && /Macintosh/.test(agent));
  // The core count is not used on phones and tablets: Safari says 4 for every iPhone and for most iPads.
  if (mobile) return atMost(nav.deviceMemory, 4) ? 'low' : 'medium';
  if (atMost(nav.hardwareConcurrency, 4) || atMost(nav.deviceMemory, 4)) return 'medium';
  return 'high';
}

/**
 * Measure how long the device needs for one frame at the level that is set now. It draws frames one after the other until the graphics chip runs at full speed, and returns the time of the fastest sample: a slow sample comes from a chip that is not warm yet or from other work on the device, and never from a faster device.
 * @param {object} hooks
 * @param {() => void} hooks.drawFrame Draws one frame like the game does.
 * @param {() => void} hooks.waitForGpu Comes back when the graphics chip has finished all frames drawn so far.
 * @param {() => number} hooks.now The time in milliseconds.
 * @param {number} [giveUpMs] A level that is still slower than this after the warm-up time is not measured further.
 * @returns {number|null} Milliseconds per frame, or null when the clock of the browser does not move, so nothing can be measured.
 */
export function measureFrameMs({ drawFrame, waitForGpu, now }, giveUpMs = KEEP_FRAME_MS * GIVE_UP_FACTOR) {
  for (let i = 0; i < WARMUP_FRAMES; i++) drawFrame();
  waitForGpu();
  const begin = now();
  let best = Infinity;
  let bestAt = begin;
  let from = begin;
  for (;;) {
    let frames = 0;
    let to = from;
    for (let group = 0; group < MAX_GROUPS_PER_SAMPLE && to - from < SAMPLE_MS; group++) {
      for (let i = 0; i < FRAMES_PER_GROUP; i++) drawFrame();
      waitForGpu();
      frames += FRAMES_PER_GROUP;
      to = now();
    }
    if (to - from < SAMPLE_MS) return null;
    const ms = (to - from) / frames;
    if (ms < best * (1 - FASTER_SHARE)) bestAt = to;
    best = Math.min(best, ms);
    const load = to - begin;
    if (load >= MAX_LOAD_MS) break;
    if (load >= MIN_LOAD_MS && (to - bestAt >= SETTLE_MS || best > giveUpMs)) break;
    from = to;
  }
  return best;
}

/**
 * Find the best level that fits the frame time. It starts at `start`, goes down while a level is too slow, and goes up while the level is fast enough for the next one to be likely to fit. Every level is measured at most once.
 * @param {object} options
 * @param {'low'|'medium'|'high'} options.start
 * @param {(level: 'low'|'medium'|'high') => number|null} options.measure Sets the level and returns its frame time in milliseconds, or null when it can not be measured.
 * @param {number} [options.keepMs]
 * @returns {{level: 'low'|'medium'|'high', measured: boolean, times: Record<string, number>}} `measured` is false when a level could not be measured; `level` is then the safest answer from what is known.
 */
export function pickQuality({ start, measure, keepMs = KEEP_FRAME_MS }) {
  if (!isLevel(start)) throw new Error(`Unknown quality level: ${JSON.stringify(start)}`);
  /** @type {Record<string, number>} */
  const times = {};
  let index = QUALITY_LEVELS.indexOf(start);
  /** The answer when the next level can not be measured: the level that is known to fit, or else the lowest one reached. */
  let safe = start;
  for (;;) {
    const level = QUALITY_LEVELS[index];
    if (!(level in times)) {
      const ms = measure(level);
      if (ms === null) return { level: safe, measured: false, times };
      times[level] = ms;
    }
    const below = QUALITY_LEVELS[index - 1];
    const above = QUALITY_LEVELS[index + 1];
    if (times[level] > keepMs) {
      if (!below) return { level, measured: true, times };
      // Too slow. The level below is the answer when it was measured before (the way up came through it), and is measured now when it was not.
      safe = below;
      index -= 1;
      continue;
    }
    safe = level;
    if (above && !(above in times) && times[level] * STEP_COST[above] <= keepMs) {
      index += 1;
      continue;
    }
    return { level, measured: true, times };
  }
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Some browsers throw when storage is blocked (private mode, strict settings).
    return null;
  }
}

/** Remembers the level that "auto" found on this device, with the size of the picture it was found for. Without storage it remembers nothing: the game still works, it just measures again at the next start. */
export class QualityMemory {
  /** @param {Pick<Storage, 'getItem'|'setItem'|'removeItem'>|null} [store] The storage to use. Tests pass their own; null means "no storage". */
  constructor(store = browserStorage()) {
    this.store = store;
    this.warned = false;
    /** @type {{level: 'low'|'medium'|'high', pixels: number}|null} */
    this.record = this.#load();
  }

  #load() {
    if (!this.store) return null;
    let parsed = null;
    try {
      const text = this.store.getItem(STORAGE_KEY);
      if (text) parsed = JSON.parse(text);
    } catch (error) {
      console.warn('[quality] the stored quality level could not be read, so the device is measured again', error);
      return null;
    }
    // A record from other rules, or a damaged one, is not used: the device is measured again and the record is written over.
    if (!parsed || typeof parsed !== 'object' || parsed.rules !== RULES_VERSION || !isLevel(parsed.level) || !(Number.isFinite(parsed.pixels) && parsed.pixels > 0)) return null;
    return { level: parsed.level, pixels: parsed.pixels };
  }

  /** The level to start with before the size of the picture is known, or null when nothing is remembered. */
  get level() {
    return this.record?.level ?? null;
  }

  /**
   * True when the remembered level was found for a picture of about this size, so it can be used without measuring. The time of a frame follows the number of pixels, so a much bigger or smaller window is measured again.
   * @param {number} pixels The number of screen pixels of the picture.
   */
  fits(pixels) {
    if (!this.record || !(pixels > 0)) return false;
    const ratio = pixels / this.record.pixels;
    return ratio <= PIXEL_TOLERANCE && ratio >= 1 / PIXEL_TOLERANCE;
  }

  /**
   * @param {'low'|'medium'|'high'} level
   * @param {number} pixels
   */
  save(level, pixels) {
    if (!isLevel(level) || !(Number.isFinite(pixels) && pixels > 0)) throw new Error(`Bad quality record: ${JSON.stringify({ level, pixels })}`);
    this.record = { level, pixels };
    if (!this.store) return;
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify({ rules: RULES_VERSION, level, pixels }));
    } catch (error) {
      if (!this.warned) console.warn('[quality] the quality level could not be stored, so the device is measured again at the next start', error);
      this.warned = true;
    }
  }

  /** Forget the level, so the device is measured again. */
  clear() {
    this.record = null;
    try {
      this.store?.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[quality] the stored quality level could not be removed', error);
    }
  }
}
