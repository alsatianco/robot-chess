// Frame-rate limit for the frame loop. For every screen refresh it decides whether the game draws a frame, so the game never draws much more often than the player's limit. On fast screens (120 Hz and more) this saves a lot of GPU work, battery and heat. Pure timing logic with no DOM, so it is tested without a browser.

/** Limits the player can pick, in frames per second. 'max' draws on every screen refresh. */
export const FRAME_RATES = [30, 60, 'max'];
export const DEFAULT_FRAME_RATE = 60;

/** A refresh that comes up to this many milliseconds before the planned time still counts as on time, because refresh timestamps wobble a little. It must stay below half a refresh of the fastest screens (4.2 ms at 240 Hz). */
const EARLY_MS = 2;

/** Average frame rate below which the "auto" graphics quality steps down, when the game is not held back by a limit. */
const SLOW_FPS = 27;

export class FrameLimiter {
  /** @param {30|60|'max'} [limit] */
  constructor(limit = DEFAULT_FRAME_RATE) {
    this.setLimit(limit);
  }

  /** @param {30|60|'max'} limit */
  setLimit(limit) {
    if (!FRAME_RATES.includes(limit)) throw new Error(`Unknown frame rate limit: ${JSON.stringify(limit)}`);
    this.limit = limit;
    /** @type {number|null} Time in milliseconds at which the next frame is due. */
    this.next = null;
  }

  /**
   * Call once per screen refresh with the requestAnimationFrame timestamp.
   * @param {number} now Milliseconds.
   * @returns {boolean} True when the game should draw a frame now.
   */
  shouldDraw(now) {
    if (this.limit === 'max') return true;
    const interval = 1000 / this.limit;
    if (this.next !== null && now < this.next - EARLY_MS) return false;
    let planned = this.next === null ? now + interval : this.next + interval;
    // Behind the beat (a slow frame or a hidden tab): start a new beat from now, so there is no burst of catch-up frames.
    if (planned < now) planned = now + interval;
    // Never plan more than one interval ahead. Without this, a screen a little faster than the limit (60.5 Hz with a limit of 60) would slowly drift ahead of the plan and drop a frame every second or so, which shows as a stutter.
    this.next = Math.min(planned, now + interval);
    return true;
  }
}

/**
 * Average frame rate under which the "auto" graphics quality steps down. A game held at 30 on purpose runs near 30 all the time, so with that limit only a clear shortfall counts as slow.
 * @param {30|60|'max'} limit
 */
export function slowFrameRate(limit) {
  return limit === 'max' ? SLOW_FPS : Math.min(SLOW_FPS, limit * 0.75);
}
