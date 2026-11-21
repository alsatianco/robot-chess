import { describe, it, expect, vi, afterEach } from 'vitest';
import { QUALITY_LEVELS, KEEP_FRAME_MS, guessQuality, measureFrameMs, pickQuality, QualityMemory } from '../../src/app/auto-quality.js';
import { slowFrameRate } from '../../src/app/frame-limiter.js';
import { QUALITY } from '../../src/gfx/stage.js';

const STORAGE_KEY = 'robot-chess.quality.v1';

// What real browsers tell about a device. Safari tells no memory size and says 4 cores for every device with fewer than 8; an iPad also says that it is a Mac.
const IPAD_SAFARI = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', maxTouchPoints: 5, hardwareConcurrency: 4 };
const IPHONE_SAFARI = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', maxTouchPoints: 5, hardwareConcurrency: 4 };
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', maxTouchPoints: 0, hardwareConcurrency: 8 };
const DESKTOP_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

describe('quality levels', () => {
  it('has the levels of the render pipeline, from the lightest to the heaviest', () => {
    expect(QUALITY_LEVELS).toEqual(Object.keys(QUALITY));
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high']);
  });

  it('keeps a level that runs clearly above the rate that the watchdog calls slow', () => {
    const keepFps = 1000 / KEEP_FRAME_MS;
    expect(keepFps).toBeGreaterThan(slowFrameRate('max') * 1.1);
    expect(keepFps).toBeLessThan(40);
  });
});

describe('first guess from the browser', () => {
  it('does not put an iPad or an iPhone on Low because Safari hides the memory size and the core count', () => {
    expect(guessQuality(IPAD_SAFARI)).toBe('medium');
    expect(guessQuality(IPHONE_SAFARI)).toBe('medium');
  });

  it('starts an Android phone on Low only when the browser tells a small memory', () => {
    expect(guessQuality({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, hardwareConcurrency: 8, deviceMemory: 8 })).toBe('medium');
    expect(guessQuality({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, hardwareConcurrency: 8, deviceMemory: 4 })).toBe('low');
    expect(guessQuality({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, hardwareConcurrency: 4, deviceMemory: 2 })).toBe('low');
  });

  it('does not count a memory size that is not told against a phone (Chrome on a page without https, Firefox)', () => {
    expect(guessQuality({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, hardwareConcurrency: 8 })).toBe('medium');
  });

  it('starts a desktop on High, and on Medium when few cores or little memory are told', () => {
    expect(guessQuality({ userAgent: DESKTOP_CHROME, maxTouchPoints: 0, hardwareConcurrency: 12, deviceMemory: 16 })).toBe('high');
    expect(guessQuality({ userAgent: DESKTOP_CHROME, maxTouchPoints: 0, hardwareConcurrency: 4, deviceMemory: 16 })).toBe('medium');
    expect(guessQuality({ userAgent: DESKTOP_CHROME, maxTouchPoints: 0, hardwareConcurrency: 12, deviceMemory: 4 })).toBe('medium');
  });

  it('does not hold a desktop back because Safari or Firefox tell no memory size', () => {
    expect(guessQuality(MAC_SAFARI)).toBe('high');
    expect(guessQuality({ userAgent: DESKTOP_FIREFOX, maxTouchPoints: 0, hardwareConcurrency: 12 })).toBe('high');
  });

  it('works when the browser tells nothing at all', () => {
    expect(guessQuality({})).toBe('high');
    expect(QUALITY_LEVELS).toContain(guessQuality());
  });
});

/**
 * A stand-in for a device: every drawn frame costs time, and the clock only moves on when the graphics chip is waited for, as on a real device where drawing calls come back at once.
 * @param {(time: number, frame: number) => number} cost Milliseconds for a frame that is drawn at this time; `frame` counts the frames drawn so far.
 * @param {(time: number) => number} [clock] What the browser's clock shows for a real time.
 */
function fakeDevice(cost, clock = (time) => time) {
  let time = 0;
  let pending = 0;
  const device = {
    frames: 0,
    /** Real time spent so far. */
    get time() {
      return time;
    },
    drawFrame: () => {
      pending += cost(time + pending, device.frames);
      device.frames += 1;
    },
    waitForGpu: () => {
      time += pending;
      pending = 0;
    },
    now: () => clock(time),
  };
  return device;
}

/** The frame time at a point in time from a list of [from this millisecond on, milliseconds per frame]. */
const trace = (steps) => (time) => steps.reduce((ms, [from, value]) => (time >= from ? value : ms), steps[0][1]);

// How a graphics chip that was idle speeds up under load, as measured on an M3 Pro (time in ms: frame time in ms). The first frames take up to 2.6 times as long as the later ones, and the way down is not even.
const M3_MEDIUM_FROM_IDLE = [[0, 10.4], [63, 8.4], [88, 6.3], [107, 5.1], [122, 4.7], [136, 4.2], [149, 4.0], [161, 3.9]];
const M3_HIGH_FROM_IDLE = [[0, 12.4], [37, 11], [70, 17.7], [123, 13.9], [165, 10.3], [196, 9.1], [223, 8.8], [250, 8.7]];

describe('measuring the frame time', () => {
  it('returns the frame time of a steady device after about a third of a second', () => {
    const device = fakeDevice(() => 10);
    expect(measureFrameMs(device)).toBeCloseTo(10, 6);
    // 2 warm-up frames, then 300 ms of frames: the least time a level is drawn.
    expect(device.frames).toBe(2 + 30);
  });

  it('does not time the first frames after a change of level, which build the shaders', () => {
    const device = fakeDevice((time, frame) => (frame < 2 ? 900 : 8));
    expect(measureFrameMs(device)).toBeCloseTo(8, 1);
  });

  it('waits until a graphics chip that was idle runs at full speed', () => {
    const medium = fakeDevice(trace(M3_MEDIUM_FROM_IDLE));
    expect(measureFrameMs(medium)).toBeCloseTo(3.9, 1);
    expect(medium.time).toBeLessThan(450);
    const high = fakeDevice(trace(M3_HIGH_FROM_IDLE));
    expect(measureFrameMs(high)).toBeCloseTo(8.7, 1);
    expect(high.time).toBeLessThan(500);
  });

  it('goes on for a chip that needs longer to speed up', () => {
    // Full speed only after 0.7 seconds.
    const device = fakeDevice(trace([[0, 40], [250, 30], [500, 24], [700, 18]]));
    expect(measureFrameMs(device)).toBeCloseTo(18, 1);
    expect(device.time).toBeLessThan(1100);
  });

  it('is not misled by a slow moment', () => {
    const device = fakeDevice(trace([[0, 12], [100, 60], [220, 12]]));
    expect(measureFrameMs(device)).toBeCloseTo(12, 1);
  });

  it('measures a slow level with a few frames', () => {
    const device = fakeDevice(() => 100);
    expect(measureFrameMs(device)).toBeCloseTo(100, 6);
    // Two samples of 3 frames: the second one shows that the first was not a cold start.
    expect(device.frames).toBe(2 + 6);
  });

  it('gives a hopeless level up after one sample', () => {
    const device = fakeDevice(() => 200);
    expect(measureFrameMs(device)).toBeCloseTo(200, 6);
    expect(device.frames).toBe(2 + 3);
  });

  it('follows the limit for giving up that the caller passes', () => {
    const device = fakeDevice(() => 100);
    expect(measureFrameMs(device, 50)).toBeCloseTo(100, 6);
    expect(device.frames).toBe(2 + 3);
  });

  it('stops after 1.2 seconds on a device that never settles', () => {
    // Every 50 ms the frames get 5% faster.
    const device = fakeDevice((time) => 20 * 0.95 ** Math.floor(time / 50));
    const ms = measureFrameMs(device);
    expect(device.time).toBeGreaterThanOrEqual(1200);
    expect(device.time).toBeLessThan(1350);
    expect(ms).toBeLessThan(20 * 0.95 ** 20);
  });

  it('measures fast and slow frames well with a clock that only shows whole milliseconds (Safari, Firefox)', () => {
    for (const real of [0.4, 2.3, 20.4]) {
      const ms = measureFrameMs(fakeDevice(() => real, Math.floor));
      expect(ms, `${real} ms`).toBeGreaterThan(real * 0.95);
      expect(ms, `${real} ms`).toBeLessThan(real * 1.05);
    }
  });

  it('says that it can not measure when the clock stands still, and does not hang', () => {
    const device = fakeDevice(() => 10, () => 0);
    expect(measureFrameMs(device)).toBeNull();
    expect(device.frames).toBe(2 + 300);
  });
});

/** A `measure` function for `pickQuality` from a table of frame times; null in the table means "can not be measured". It records the order of the levels it was asked for. */
function fakeMeasure(times) {
  const asked = [];
  const measure = (level) => {
    asked.push(level);
    return times[level];
  };
  return { measure, asked };
}

describe('picking the level', () => {
  const keepMs = 30;

  it('keeps the start level when it fits and there is no level above', () => {
    const { measure, asked } = fakeMeasure({ low: 2, medium: 5, high: 10 });
    expect(pickQuality({ start: 'high', measure, keepMs })).toEqual({ level: 'high', measured: true, times: { high: 10 } });
    expect(asked).toEqual(['high']);
  });

  it('keeps a level that needs exactly the allowed time', () => {
    const { measure } = fakeMeasure({ high: 30 });
    expect(pickQuality({ start: 'high', measure, keepMs }).level).toBe('high');
  });

  it('goes down while the level is too slow', () => {
    const one = fakeMeasure({ low: 6, medium: 14, high: 31 });
    expect(pickQuality({ start: 'high', measure: one.measure, keepMs })).toEqual({ level: 'medium', measured: true, times: { high: 31, medium: 14 } });
    expect(one.asked).toEqual(['high', 'medium']);
    const two = fakeMeasure({ low: 20, medium: 50, high: 110 });
    expect(pickQuality({ start: 'high', measure: two.measure, keepMs }).level).toBe('low');
    expect(two.asked).toEqual(['high', 'medium', 'low']);
  });

  it('ends on Low when even Low is too slow', () => {
    const { measure } = fakeMeasure({ low: 45, medium: 110 });
    expect(pickQuality({ start: 'medium', measure, keepMs })).toEqual({ level: 'low', measured: true, times: { medium: 110, low: 45 } });
  });

  it('tries High from Medium when Medium is fast enough, and keeps High when it fits', () => {
    // The user's iPad: Medium is fast, High is slower but still fits.
    const { measure, asked } = fakeMeasure({ medium: 12, high: 27 });
    expect(pickQuality({ start: 'medium', measure, keepMs })).toEqual({ level: 'high', measured: true, times: { medium: 12, high: 27 } });
    expect(asked).toEqual(['medium', 'high']);
  });

  it('comes back to Medium when the try of High does not fit, without measuring Medium again', () => {
    const { measure, asked } = fakeMeasure({ medium: 15, high: 36 });
    expect(pickQuality({ start: 'medium', measure, keepMs }).level).toBe('medium');
    expect(asked).toEqual(['medium', 'high']);
  });

  it('does not try High when Medium is not fast enough for High to be likely', () => {
    // High costs at least 1.8 times as much as Medium: 17 ms would become more than 30 ms.
    const { measure, asked } = fakeMeasure({ medium: 17, high: 25 });
    expect(pickQuality({ start: 'medium', measure, keepMs }).level).toBe('medium');
    expect(asked).toEqual(['medium']);
  });

  it('is more careful with the try of Medium from Low, which builds every shader again', () => {
    // Medium costs about 2.5 times as much as Low: 12 ms is the limit for a kept time of 30 ms.
    const slow = fakeMeasure({ low: 12.5, medium: 20 });
    expect(pickQuality({ start: 'low', measure: slow.measure, keepMs }).level).toBe('low');
    expect(slow.asked).toEqual(['low']);
    const fast = fakeMeasure({ low: 12, medium: 28 });
    expect(pickQuality({ start: 'low', measure: fast.measure, keepMs }).level).toBe('medium');
    expect(fast.asked).toEqual(['low', 'medium']);
  });

  it('climbs from Low to High on a strong device', () => {
    const { measure, asked } = fakeMeasure({ low: 1.5, medium: 4, high: 9 });
    expect(pickQuality({ start: 'low', measure, keepMs })).toEqual({ level: 'high', measured: true, times: { low: 1.5, medium: 4, high: 9 } });
    expect(asked).toEqual(['low', 'medium', 'high']);
  });

  it('uses the real limit of about 31 milliseconds when none is given', () => {
    expect(pickQuality({ start: 'high', measure: () => KEEP_FRAME_MS - 0.1 }).level).toBe('high');
    expect(pickQuality({ start: 'high', measure: (level) => (level === 'high' ? KEEP_FRAME_MS + 0.1 : 5) }).level).toBe('medium');
  });

  it('keeps the start level when nothing can be measured', () => {
    const { measure } = fakeMeasure({ medium: null });
    expect(pickQuality({ start: 'medium', measure, keepMs })).toEqual({ level: 'medium', measured: false, times: {} });
  });

  it('stays on the level that fits when the level above can not be measured', () => {
    const { measure } = fakeMeasure({ medium: 8, high: null });
    expect(pickQuality({ start: 'medium', measure, keepMs })).toEqual({ level: 'medium', measured: false, times: { medium: 8 } });
  });

  it('takes the lower level when the start level is too slow and the lower one can not be measured', () => {
    const { measure } = fakeMeasure({ high: 80, medium: null });
    expect(pickQuality({ start: 'high', measure, keepMs })).toEqual({ level: 'medium', measured: false, times: { high: 80 } });
  });

  it('refuses a start level that does not exist', () => {
    expect(() => pickQuality({ start: 'ultra', measure: () => 1 })).toThrow(/Unknown quality level/);
  });
});

/** A storage that lives in memory, like localStorage. */
function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

describe('remembering the level', () => {
  afterEach(() => vi.restoreAllMocks());

  it('knows nothing on a first visit', () => {
    const memory = new QualityMemory(memoryStore());
    expect(memory.level).toBeNull();
    expect(memory.fits(1_000_000)).toBe(false);
  });

  it('brings the level back at the next visit', () => {
    const store = memoryStore();
    new QualityMemory(store).save('high', 3_870_400);
    const memory = new QualityMemory(store);
    expect(memory.level).toBe('high');
    expect(memory.fits(3_870_400)).toBe(true);
  });

  it('uses the level again for a picture of about the same size only', () => {
    const memory = new QualityMemory(memoryStore());
    memory.save('medium', 1_000_000);
    expect(memory.fits(1_250_000)).toBe(true);
    expect(memory.fits(800_000)).toBe(true);
    expect(memory.fits(1_400_000)).toBe(false);
    expect(memory.fits(700_000)).toBe(false);
    expect(memory.fits(0)).toBe(false);
    expect(memory.fits(Number.NaN)).toBe(false);
  });

  it('writes a newer level over the old one', () => {
    const store = memoryStore();
    const memory = new QualityMemory(store);
    memory.save('high', 2_000_000);
    memory.save('medium', 2_000_000);
    expect(new QualityMemory(store).level).toBe('medium');
  });

  it('forgets the level when asked', () => {
    const store = memoryStore();
    const memory = new QualityMemory(store);
    memory.save('high', 2_000_000);
    memory.clear();
    expect(memory.level).toBeNull();
    expect(store.data.has(STORAGE_KEY)).toBe(false);
    expect(new QualityMemory(store).level).toBeNull();
  });

  it('does not use a damaged record or one from other rules', () => {
    const bad = ['not json', 'null', '[]', '{}', JSON.stringify({ rules: 1, level: 'ultra', pixels: 100 }), JSON.stringify({ rules: 1, level: 'high', pixels: 0 }), JSON.stringify({ rules: 1, level: 'high', pixels: 'many' }), JSON.stringify({ rules: 1, level: 'high' }), JSON.stringify({ rules: 0, level: 'high', pixels: 100 }), JSON.stringify({ level: 'high', pixels: 100 })];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const text of bad) {
      const memory = new QualityMemory(memoryStore({ [STORAGE_KEY]: text }));
      expect(memory.level, text).toBeNull();
      expect(memory.fits(100), text).toBe(false);
    }
  });

  it('refuses to remember a level that does not exist or a size that is not a number', () => {
    const memory = new QualityMemory(memoryStore());
    expect(() => memory.save('ultra', 100)).toThrow(/Bad quality record/);
    expect(() => memory.save('high', 0)).toThrow(/Bad quality record/);
    expect(() => memory.save('high', Number.NaN)).toThrow(/Bad quality record/);
    expect(memory.level).toBeNull();
  });

  it('works without storage: it remembers for this visit only', () => {
    const memory = new QualityMemory(null);
    expect(memory.level).toBeNull();
    memory.save('medium', 500_000);
    expect(memory.level).toBe('medium');
    expect(memory.fits(500_000)).toBe(true);
    memory.clear();
    expect(memory.level).toBeNull();
  });

  it('goes on when the storage fails, and says so once', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const memory = new QualityMemory(broken);
    expect(memory.level).toBeNull();
    expect(warned).toHaveBeenCalledTimes(1);
    memory.save('high', 100);
    memory.save('medium', 100);
    expect(memory.level).toBe('medium');
    expect(warned).toHaveBeenCalledTimes(2);
    memory.clear();
    expect(memory.level).toBeNull();
    expect(warned).toHaveBeenCalledTimes(3);
  });
});
