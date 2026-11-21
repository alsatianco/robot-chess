import { describe, it, expect } from 'vitest';
import { FrameLimiter, FRAME_RATES, DEFAULT_FRAME_RATE, slowFrameRate } from '../../src/app/frame-limiter.js';

/**
 * Feed the limiter one screen refresh after another, the way requestAnimationFrame does, and return the times of the frames it lets through.
 * @param {FrameLimiter} limiter
 * @param {number} hz Refresh rate of the simulated screen.
 * @param {number} seconds
 * @param {{start?:number, jitter?:(i:number)=>number}} [options] `jitter` moves single refresh times a little, as real timestamps do.
 */
function run(limiter, hz, seconds, { start = 1000, jitter = () => 0 } = {}) {
  const drawn = [];
  const period = 1000 / hz;
  const count = Math.round(seconds * hz);
  for (let i = 0; i < count; i++) {
    const now = start + i * period + jitter(i);
    if (limiter.shouldDraw(now)) drawn.push(now);
  }
  return drawn;
}

const gaps = (times) => times.slice(1).map((t, i) => t - times[i]);
// A small wobble of up to 0.6 ms, the size real refresh timestamps show.
const wobble = (i) => Math.sin(i * 12.9898) * 0.6;

describe('frame limiter', () => {
  it('offers 30, 60 and max, with 60 as the default', () => {
    expect(FRAME_RATES).toEqual([30, 60, 'max']);
    expect(DEFAULT_FRAME_RATE).toBe(60);
  });

  it('draws every refresh when set to max', () => {
    const limiter = new FrameLimiter('max');
    expect(run(limiter, 120, 2)).toHaveLength(240);
  });

  it('draws every other refresh at 60 on a 120 Hz screen, with an even beat', () => {
    const limiter = new FrameLimiter(60);
    const drawn = run(limiter, 120, 10, { jitter: wobble });
    expect(drawn).toHaveLength(600);
    for (const gap of gaps(drawn)) expect(gap).toBeCloseTo(1000 / 60, 0);
  });

  it('changes nothing at 60 on a 60 Hz screen', () => {
    const limiter = new FrameLimiter(60);
    expect(run(limiter, 60, 10, { jitter: wobble })).toHaveLength(600);
  });

  it('never skips a refresh at 60 on a screen a little faster than 60 Hz', () => {
    // A plain "add one interval each frame" timer drifts here and drops a frame about every 14 frames, which shows as a stutter.
    const limiter = new FrameLimiter(60);
    expect(run(limiter, 60.5, 10)).toHaveLength(605);
  });

  it('draws 30 frames a second at 30 on 60 Hz and 120 Hz screens', () => {
    expect(run(new FrameLimiter(30), 60, 10, { jitter: wobble })).toHaveLength(300);
    expect(run(new FrameLimiter(30), 120, 10, { jitter: wobble })).toHaveLength(300);
  });

  it('hits the limit exactly on screens whose refresh rate is a multiple of it', () => {
    for (const hz of [72, 75, 90, 100, 120, 240]) expect(run(new FrameLimiter(60), hz, 10)).toHaveLength(600);
  });

  it('stays within 5% of the limit on 144 Hz and 165 Hz screens, where 60 does not fit evenly', () => {
    for (const hz of [144, 165]) {
      const drawn = run(new FrameLimiter(60), hz, 10);
      expect(drawn.length).toBeGreaterThanOrEqual(570);
      expect(drawn.length).toBeLessThanOrEqual(630);
    }
  });

  it('does not draw a burst of catch-up frames after a long pause', () => {
    const limiter = new FrameLimiter(60);
    run(limiter, 120, 1, { start: 0 });
    // The tab was hidden for two seconds; then refreshes come every 8.3 ms again.
    const after = run(limiter, 120, 1, { start: 3000 });
    expect(after).toHaveLength(60);
    expect(Math.min(...gaps(after))).toBeGreaterThan(1000 / 60 - 3);
  });

  it('follows a new limit at once', () => {
    const limiter = new FrameLimiter(30);
    run(limiter, 120, 1, { start: 0 });
    limiter.setLimit('max');
    expect(run(limiter, 120, 1, { start: 1000 })).toHaveLength(120);
    limiter.setLimit(60);
    expect(run(limiter, 120, 1, { start: 2000 })).toHaveLength(60);
  });

  it('refuses a limit it does not know', () => {
    expect(() => new FrameLimiter(45)).toThrow();
    expect(() => new FrameLimiter(60).setLimit('fast')).toThrow();
  });
});

describe('slow frame rate for the quality watchdog', () => {
  it('keeps the old threshold for 60 and max', () => {
    expect(slowFrameRate('max')).toBe(27);
    expect(slowFrameRate(60)).toBe(27);
  });

  it('does not call a game slow for running at the 30 it was asked for', () => {
    const threshold = slowFrameRate(30);
    expect(threshold).toBeLessThan(27);
    // A 30 limit with a few missed refreshes still averages well above the threshold.
    expect(28).toBeGreaterThan(threshold);
    // A device that only manages 20 frames is still found slow.
    expect(20).toBeLessThan(threshold);
  });
});
