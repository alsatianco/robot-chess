// Chess clock for the Timed and Ranked modes. The game controller starts and stops it explicitly, which is how the rule "an animation never uses clock time" is kept: the clock of a side only runs while that side is really thinking.

/** Time presets: minutes plus seconds added per move. */
export const TIME_CONTROLS = {
  '3+2': { minutes: 3, increment: 2 },
  '5+0': { minutes: 5, increment: 0 },
  '10+0': { minutes: 10, increment: 0 },
  '15+10': { minutes: 15, increment: 10 },
};
export const DEFAULT_TIME_CONTROL = '5+0';
/** Below this many milliseconds a clock counts as "low" and is shown in red. */
export const LOW_TIME_MS = 20000;

export class ChessClock {
  /**
   * @param {string} control Key of TIME_CONTROLS.
   * @param {() => number} [now] Time source in milliseconds, replaceable in tests.
   */
  constructor(control, now = () => performance.now()) {
    const preset = TIME_CONTROLS[control] ?? TIME_CONTROLS[DEFAULT_TIME_CONTROL];
    this.control = TIME_CONTROLS[control] ? control : DEFAULT_TIME_CONTROL;
    this.incrementMs = preset.increment * 1000;
    this.remaining = { w: preset.minutes * 60000, b: preset.minutes * 60000 };
    this.now = now;
    /** @type {'w'|'b'|null} Side whose clock is running. */
    this.running = null;
    this.startedAt = 0;
    /** @type {'w'|'b'|null} Side that ran out of time. */
    this.flagged = null;
  }

  /** Time left for a side right now, in milliseconds (never below zero). */
  timeLeft(color) {
    const base = this.remaining[color];
    if (this.running !== color) return Math.max(0, base);
    return Math.max(0, base - (this.now() - this.startedAt));
  }

  /** Start the clock of one side. The other side's clock is stopped first. */
  start(color) {
    if (this.flagged) return;
    this.pause();
    this.running = color;
    this.startedAt = this.now();
  }

  /** Stop whichever clock is running and keep the time used. */
  pause() {
    if (!this.running) return;
    this.remaining[this.running] = this.timeLeft(this.running);
    this.running = null;
  }

  /** A side completed a move: stop its clock and add the increment. */
  completeMove(color) {
    if (this.running === color) this.pause();
    if (!this.flagged) this.remaining[color] += this.incrementMs;
  }

  /**
   * Check for a timeout. Call regularly while a clock runs.
   * @returns {'w'|'b'|null} The side that just ran out of time, once.
   */
  tick() {
    if (this.flagged || !this.running) return null;
    if (this.timeLeft(this.running) > 0) return null;
    this.flagged = this.running;
    this.remaining[this.running] = 0;
    this.running = null;
    return this.flagged;
  }

  /** Snapshot used for undo. */
  snapshot() {
    return { w: this.timeLeft('w'), b: this.timeLeft('b') };
  }

  /** Restore a snapshot (after an undo). The clock is left stopped. */
  restore(snapshot) {
    this.running = null;
    this.flagged = null;
    this.remaining = { w: snapshot.w, b: snapshot.b };
  }
}

/** Format milliseconds as m:ss, with tenths of a second under ten seconds. */
export function formatClock(ms) {
  const total = Math.max(0, ms);
  if (total < 10000) {
    const tenths = Math.floor(total / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const seconds = Math.ceil(total / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
