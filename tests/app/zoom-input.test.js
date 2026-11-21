import { describe, it, expect } from 'vitest';
import { wheelZoomFactor, pinchZoomFactor } from '../../src/app/zoom-input.js';
import { CAMERA_LIMITS } from '../../src/gfx/camera-rig.js';

/** Multiply the zoom steps of a list of wheel events, the way the camera does. */
const zoomAfter = (events) => events.reduce((zoom, event) => zoom * wheelZoomFactor(event), 1);
const repeat = (count, event) => Array.from({ length: count }, () => event);

describe('wheel zoom', () => {
  it('moves the camera away when scrolling down and closer when scrolling up', () => {
    expect(wheelZoomFactor({ deltaY: 100 })).toBeGreaterThan(1);
    expect(wheelZoomFactor({ deltaY: -100 })).toBeLessThan(1);
  });

  it('keeps a normal trackpad swipe (30 small events) well inside the zoom range', () => {
    const swipe = repeat(30, { deltaY: 10 });
    const zoom = zoomAfter(swipe);
    expect(zoom).toBeGreaterThan(1.05);
    expect(zoom).toBeLessThan(1.15);
    expect(zoom).toBeLessThan(CAMERA_LIMITS.zoomMax);
  });

  it('follows the scroll distance, not the number of events', () => {
    expect(zoomAfter(repeat(10, { deltaY: 10 }))).toBeCloseTo(wheelZoomFactor({ deltaY: 100 }), 12);
    expect(zoomAfter(repeat(25, { deltaY: -4 }))).toBeCloseTo(wheelZoomFactor({ deltaY: -100 }), 12);
  });

  it('comes back to the same zoom after scrolling down and up by the same amount', () => {
    expect(wheelZoomFactor({ deltaY: 80 }) * wheelZoomFactor({ deltaY: -80 })).toBeCloseTo(1, 12);
  });

  it('needs at least 6 mouse wheel notches from the default zoom to either end', () => {
    const notch = Math.log(wheelZoomFactor({ deltaY: 100 }));
    expect(Math.log(CAMERA_LIMITS.zoomMax / CAMERA_LIMITS.zoomDefault) / notch).toBeGreaterThanOrEqual(6);
    expect(Math.log(CAMERA_LIMITS.zoomDefault / CAMERA_LIMITS.zoomMin) / notch).toBeGreaterThanOrEqual(6);
  });

  it('still crosses the whole range in under 20 mouse wheel notches', () => {
    const notch = Math.log(wheelZoomFactor({ deltaY: 100 }));
    expect(Math.log(CAMERA_LIMITS.zoomMax / CAMERA_LIMITS.zoomMin) / notch).toBeLessThan(20);
  });

  it('does not zoom on a sideways scroll', () => {
    expect(wheelZoomFactor({ deltaY: 0, deltaX: 40 })).toBe(1);
    expect(wheelZoomFactor({ deltaY: -0, deltaX: -40 })).toBe(1);
  });

  it('limits one event to a small step, however large its scroll amount', () => {
    const far = wheelZoomFactor({ deltaY: 5000 });
    const near = wheelZoomFactor({ deltaY: -5000 });
    expect(far).toBeGreaterThan(1);
    expect(far).toBeLessThanOrEqual(1.06);
    expect(near).toBeLessThan(1);
    expect(near).toBeGreaterThanOrEqual(1 / 1.06);
    expect(far * near).toBeCloseTo(1, 12);
  });

  it('reads scroll amounts given in lines (3 lines are about one notch)', () => {
    const lines = wheelZoomFactor({ deltaY: 3, deltaMode: 1 });
    expect(lines).toBeCloseTo(wheelZoomFactor({ deltaY: 120, deltaMode: 0 }), 12);
  });

  it('reads scroll amounts given in pages as one limited step', () => {
    expect(wheelZoomFactor({ deltaY: 1, deltaMode: 2 })).toBe(wheelZoomFactor({ deltaY: 5000 }));
    expect(wheelZoomFactor({ deltaY: -1, deltaMode: 2 })).toBe(wheelZoomFactor({ deltaY: -5000 }));
  });

  it('gives the small amounts of a trackpad pinch (ctrlKey) more weight than a scroll', () => {
    const pinch = wheelZoomFactor({ deltaY: 2, ctrlKey: true });
    const scroll = wheelZoomFactor({ deltaY: 2 });
    expect(pinch).toBeGreaterThan(scroll);
    // A whole trackpad pinch adds up to about 50 units; it must not run through the range from the default zoom.
    expect(zoomAfter(repeat(25, { deltaY: 2, ctrlKey: true }))).toBeLessThan(CAMERA_LIMITS.zoomMax);
    expect(zoomAfter(repeat(25, { deltaY: -2, ctrlKey: true }))).toBeGreaterThan(CAMERA_LIMITS.zoomMin);
  });

  it('ignores a broken scroll amount', () => {
    expect(wheelZoomFactor({ deltaY: NaN })).toBe(1);
    expect(wheelZoomFactor({ deltaY: Infinity })).toBe(1);
    expect(wheelZoomFactor({})).toBe(1);
  });
});

describe('pinch zoom', () => {
  it('moves the camera closer when the fingers spread and away when they close', () => {
    expect(pinchZoomFactor(100, 150)).toBeLessThan(1);
    expect(pinchZoomFactor(150, 100)).toBeGreaterThan(1);
  });

  it('zooms much slower than the fingers move', () => {
    // At the speed of the fingers, doubling their distance would halve the camera distance.
    expect(pinchZoomFactor(100, 200)).toBeGreaterThan(0.75);
    expect(pinchZoomFactor(200, 100)).toBeLessThan(1 / 0.75);
  });

  it('stays inside the zoom range from the default when the finger distance doubles or halves', () => {
    expect(CAMERA_LIMITS.zoomDefault * pinchZoomFactor(100, 200)).toBeGreaterThan(CAMERA_LIMITS.zoomMin);
    expect(CAMERA_LIMITS.zoomDefault * pinchZoomFactor(200, 100)).toBeLessThan(CAMERA_LIMITS.zoomMax);
  });

  it('reaches both ends of the zoom range from the default with one wide pinch (3 times the finger distance)', () => {
    expect(CAMERA_LIMITS.zoomDefault * pinchZoomFactor(100, 300)).toBeLessThanOrEqual(CAMERA_LIMITS.zoomMin);
    expect(CAMERA_LIMITS.zoomDefault * pinchZoomFactor(300, 100)).toBeGreaterThanOrEqual(CAMERA_LIMITS.zoomMax);
  });

  it('zooms as fast as a trackpad pinch of the same size', () => {
    // A trackpad pinch that doubles the picture adds up to 100 * ln(2) units in the browser.
    const units = 100 * Math.log(2);
    expect(pinchZoomFactor(100, 200)).toBeCloseTo(zoomAfter(repeat(100, { deltaY: -units / 100, ctrlKey: true })), 12);
  });

  it('gives the same zoom for one big move and for many small moves', () => {
    const steps = pinchZoomFactor(100, 130) * pinchZoomFactor(130, 170) * pinchZoomFactor(170, 200);
    expect(steps).toBeCloseTo(pinchZoomFactor(100, 200), 12);
  });

  it('does not zoom when a finger distance is zero or broken', () => {
    expect(pinchZoomFactor(0, 100)).toBe(1);
    expect(pinchZoomFactor(100, 0)).toBe(1);
    expect(pinchZoomFactor(NaN, 100)).toBe(1);
    expect(pinchZoomFactor(100, Infinity)).toBe(1);
    expect(pinchZoomFactor(100, 100)).toBe(1);
  });
});
