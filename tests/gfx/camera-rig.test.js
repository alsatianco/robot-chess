import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraRig, CAMERA_LIMITS } from '../../src/gfx/camera-rig.js';

/** A rig on a bare camera with a desktop-size free area. The rig only needs `stage.camera`. */
function makeRig() {
  const rig = new CameraRig({ camera: new THREE.PerspectiveCamera() });
  rig.setViewport(1800, 916, { x: 12, y: 68, w: 1366, h: 836 });
  return rig;
}

/** Run enough frames for the camera to arrive at its goal. */
function settle(rig, seconds = 4) {
  for (let i = 0; i < seconds * 60; i++) rig.update(1 / 60);
}

describe('camera default view', () => {
  it('has a default zoom inside the zoom limits', () => {
    expect(CAMERA_LIMITS.zoomDefault).toBeGreaterThan(CAMERA_LIMITS.zoomMin);
    expect(CAMERA_LIMITS.zoomDefault).toBeLessThan(CAMERA_LIMITS.zoomMax);
  });

  it('starts in the default view', () => {
    const rig = makeRig();
    expect(rig.userZoom).toBe(CAMERA_LIMITS.zoomDefault);
    expect(rig.isDefaultView).toBe(true);
  });

  it('uses the distance that fits the whole board as the default', () => {
    const rig = makeRig();
    settle(rig);
    expect(rig.distance).toBeCloseTo(rig.fitDistance * CAMERA_LIMITS.zoomDefault, 4);
  });

  it('leaves the default view when the player zooms', () => {
    const rig = makeRig();
    rig.zoom(1.05);
    expect(rig.isDefaultView).toBe(false);
  });

  it('leaves the default view when the player turns or tilts the camera', () => {
    const turned = makeRig();
    turned.orbit(0.1, 0);
    expect(turned.isDefaultView).toBe(false);
    const tilted = makeRig();
    tilted.orbit(0, 0.1);
    expect(tilted.isDefaultView).toBe(false);
  });

  it('counts a view that came back to the default by hand as the default view', () => {
    const rig = makeRig();
    // Thirty small steps out and the same thirty back end a rounding error away from the default.
    for (let i = 0; i < 30; i++) rig.zoom(Math.exp(0.0035));
    for (let i = 0; i < 30; i++) rig.zoom(Math.exp(-0.0035));
    for (let i = 0; i < 7; i++) rig.orbit(0.03, 0.03);
    for (let i = 0; i < 7; i++) rig.orbit(-0.03, -0.03);
    expect(rig.isDefaultView).toBe(true);
  });

  it('does not count a small but visible change as the default view', () => {
    const zoomed = makeRig();
    zoomed.zoom(1.002);
    expect(zoomed.isDefaultView).toBe(false);
    const turned = makeRig();
    turned.orbit(0.002, 0);
    expect(turned.isDefaultView).toBe(false);
  });

  it('keeps the zoom inside the limits', () => {
    const rig = makeRig();
    for (let i = 0; i < 200; i++) rig.zoom(1.05);
    expect(rig.userZoom).toBe(CAMERA_LIMITS.zoomMax);
    for (let i = 0; i < 400; i++) rig.zoom(0.95);
    expect(rig.userZoom).toBe(CAMERA_LIMITS.zoomMin);
  });

  it('goes back to the default zoom, turn and tilt on reset', () => {
    const rig = makeRig();
    settle(rig);
    const home = { distance: rig.distance, azimuth: rig.azimuth, elevation: rig.elevation };
    rig.zoom(0.8);
    rig.orbit(0.3, -0.2);
    settle(rig);
    expect(rig.distance).not.toBeCloseTo(home.distance, 2);

    rig.resetView();
    expect(rig.isDefaultView).toBe(true);
    expect(rig.userZoom).toBe(CAMERA_LIMITS.zoomDefault);
    settle(rig);
    expect(rig.distance).toBeCloseTo(home.distance, 4);
    expect(rig.azimuth).toBeCloseTo(home.azimuth, 4);
    expect(rig.elevation).toBeCloseTo(home.elevation, 4);
  });

  it('glides back on reset instead of jumping', () => {
    const rig = makeRig();
    settle(rig);
    const home = rig.distance;
    rig.zoom(1.25);
    settle(rig);
    const far = rig.distance;
    rig.resetView();
    rig.update(1 / 60);
    expect(rig.distance).toBeLessThan(far);
    expect(rig.distance).toBeGreaterThan(home + (far - home) * 0.5);
  });

  it('counts the top view at its default zoom as a default view', () => {
    const rig = makeRig();
    rig.setTopDown(true);
    expect(rig.isDefaultView).toBe(true);
    rig.zoom(0.9);
    expect(rig.isDefaultView).toBe(false);
    rig.resetView();
    expect(rig.isDefaultView).toBe(true);
    expect(rig.topDown).toBe(true);
  });
});
