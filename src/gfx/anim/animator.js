// A small promise-based animation driver. Choreography is written as plain async functions ("await tween, await wait"), and this class advances every running tween from the render loop. Skipping works by fast-forwarding time, so every tween still reaches its final value and no end state is lost.

export const Ease = {
  linear: (k) => k,
  inQuad: (k) => k * k,
  outQuad: (k) => k * (2 - k),
  inOutQuad: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  inCubic: (k) => k * k * k,
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outQuart: (k) => 1 - Math.pow(1 - k, 4),
  inQuart: (k) => k * k * k * k,
  outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
  inExpo: (k) => (k <= 0 ? 0 : Math.pow(2, 10 * k - 10)),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
  outSine: (k) => Math.sin((k * Math.PI) / 2),
  inSine: (k) => 1 - Math.cos((k * Math.PI) / 2),
  inBack: (k) => 2.70158 * k * k * k - 1.70158 * k * k,
  outBack: (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2),
  outElastic: (k) => (k === 0 || k === 1 ? k : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (k) => {
    const n = 7.5625;
    const d = 2.75;
    if (k < 1 / d) return n * k * k;
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
    return n * (k -= 2.625 / d) * k + 0.984375;
  },
};

/** Speed multiplier used while the player skips an animation with a tap. */
const FAST_FORWARD = 30;

export class Animator {
  constructor() {
    /** @type {Set<{step:(dt:number)=>boolean, finish:()=>void}>} */
    this.items = new Set();
    /** Global speed. 1 is normal; the "best move" moment lowers it for a short slow motion. */
    this.timeScale = 1;
    /** True while the player is skipping the current animation. */
    this.fast = false;
    /** True for the Instant preset: every tween jumps to its end value. */
    this.instant = false;
    this.time = 0;
  }

  /** Advance all running animations. Call once per rendered frame with the real frame time in seconds. */
  update(dtReal) {
    const dt = dtReal * this.timeScale * (this.fast ? FAST_FORWARD : 1);
    this.time += dt;
    for (const item of [...this.items]) {
      let done = false;
      try {
        done = item.step(dt);
      } catch (error) {
        // A broken animation step must never freeze the game: drop it, report it and let the awaiting sequence continue.
        console.error('[animator] animation step failed', error);
        done = true;
      }
      if (done) {
        this.items.delete(item);
        item.finish();
      }
    }
  }

  /** True while anything is still animating. */
  get busy() {
    return this.items.size > 0;
  }

  /**
   * Animate numeric properties of `target` to the given end values.
   * @param {object} target
   * @param {Record<string, number>} props End values.
   * @param {number} duration Seconds.
   * @param {(k:number)=>number} [ease]
   * @param {{delay?: number, onUpdate?: (k:number)=>void}} [options]
   * @returns {Promise<void>} Resolves when the tween has reached its end values.
   */
  tween(target, props, duration, ease = Ease.inOutQuad, options = {}) {
    const keys = Object.keys(props);
    if (this.instant || duration <= 0) {
      for (const key of keys) target[key] = props[key];
      options.onUpdate?.(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let elapsed = -(options.delay ?? 0);
      let from = null;
      this.items.add({
        step: (dt) => {
          elapsed += dt;
          if (elapsed < 0) return false;
          if (!from) {
            from = {};
            for (const key of keys) from[key] = target[key];
          }
          const k = Math.min(1, elapsed / duration);
          const e = ease(k);
          for (const key of keys) target[key] = from[key] + (props[key] - from[key]) * e;
          options.onUpdate?.(k);
          return k >= 1;
        },
        finish: resolve,
      });
    });
  }

  /** Wait for a number of seconds of animation time (skips and slow motion apply). */
  wait(seconds) {
    if (this.instant || seconds <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let elapsed = 0;
      this.items.add({ step: (dt) => (elapsed += dt) >= seconds, finish: resolve });
    });
  }

  /**
   * Run a custom per-frame function for a fixed time. `fn` receives progress 0..1 and the frame time. In Instant mode it is called once with progress 1 so end states are still applied.
   * @param {number} duration Seconds.
   * @param {(k:number, dt:number)=>void} fn
   * @returns {Promise<void>}
   */
  run(duration, fn) {
    if (this.instant || duration <= 0) {
      fn(1, 0);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let elapsed = 0;
      this.items.add({
        step: (dt) => {
          elapsed += dt;
          const k = Math.min(1, elapsed / duration);
          fn(k, dt);
          return k >= 1;
        },
        finish: resolve,
      });
    });
  }

  /**
   * Drop every running animation without finishing it. Their promises never resolve, so the async choreography that was waiting on them simply stops where it is and can never touch the scene again. Used when the whole position is replaced (new game, undo); the caller then resets what the dropped choreography left behind.
   */
  abortAll() {
    this.items.clear();
    this.fast = false;
    this.timeScale = 1;
  }

  /** Jump every running animation to its end right now. */
  finishAll() {
    let guard = 0;
    while (this.items.size > 0 && guard++ < 200) this.update(1000);
  }
}
