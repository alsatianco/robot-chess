import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mirrorRegion, MIRROR_MARGIN } from '../../src/gfx/mirror-region.js';

// The floor mirror only clears, draws and resolves the part of its image that the floor can read. These tests take the reading positions from the real three.js mirror code (its texture matrix), so a three.js update that changes the mirror math is caught here and not on screen.

const WIDTH = 1600;
const HEIGHT = 764;
const HALF = 4;
/** How far from a reading position the floor shader can still fetch a pixel: 1.3 for its soft five-tap cross plus 1 for smooth filtering. */
const READ_REACH = 2.3;

/** A stand-in for the WebGL renderer: the mirror code only needs these calls to exist, the math under test does not depend on them. */
const fakeRenderer = {
  xr: { enabled: false },
  shadowMap: { autoUpdate: true },
  autoClear: true,
  state: { buffers: { depth: { setMask() {} } }, viewport() {} },
  getRenderTarget: () => null,
  setRenderTarget() {},
  clear() {},
  render() {},
};

/** The floor as the arena builds it: an 8 by 8 plane lying flat, a hair above the tiles. */
function makeFloor() {
  const floor = new Reflector(new THREE.PlaneGeometry(HALF * 2, HALF * 2), { textureWidth: WIDTH, textureHeight: HEIGHT });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.updateMatrixWorld(true);
  return floor;
}

/** A camera placed like the game's camera rig does it: an orbit around a target, with an off-center view inside a larger canvas. */
function makeCamera({ azimuth = 0, elevation = 53, distance = 17, target = [0, 0.3, 0], offset = null }) {
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const el = (elevation * Math.PI) / 180;
  const ce = Math.cos(el);
  const se = Math.sin(el);
  const sa = Math.sin(azimuth);
  const ca = Math.cos(azimuth);
  camera.position.set(target[0] + distance * sa * ce, target[1] + distance * se, target[2] + distance * ca * ce);
  camera.up.set(-sa * se, ce, -ca * se);
  camera.lookAt(...target);
  const view = offset ?? { w: 1200, h: 860, x: 0, y: 0, canvasW: 1800, canvasH: 860 };
  camera.aspect = view.w / view.h;
  camera.setViewOffset(view.w, view.h, -view.x, -view.y, view.canvasW, view.canvasH);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Where the floor reads the mirror image, in pixels, for a grid of points on the floor. Taken from the real mirror code. */
function readPositions(floor, camera) {
  floor.onBeforeRender(fakeRenderer, new THREE.Scene(), camera);
  const textureMatrix = floor.material.uniforms.textureMatrix.value;
  const points = [];
  const p = new THREE.Vector4();
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      p.set(-HALF + (2 * HALF * i) / steps, -HALF + (2 * HALF * j) / steps, 0, 1).applyMatrix4(textureMatrix);
      if (p.w <= 0) continue;
      points.push({ x: (p.x / p.w) * WIDTH, y: (p.y / p.w) * HEIGHT });
    }
  }
  return points;
}

const VIEWS = {
  'game view': {},
  'game view, board flipped': { azimuth: Math.PI },
  'turned to the left limit': { azimuth: (-42 * Math.PI) / 180, elevation: 34 },
  'turned to the right limit': { azimuth: (42 * Math.PI) / 180, elevation: 80 },
  'top-down view': { elevation: 89.2, distance: 19 },
  'menu view, low and close': { azimuth: 0.5, elevation: 30, distance: 14, offset: { w: 1100, h: 860, x: 700, y: 0, canvasW: 1800, canvasH: 860 } },
  'cinematic focus on a corner': { elevation: 40, distance: 11, target: [2.6, 0.5, 2.6] },
  'phone screen, board at the top': { distance: 30, offset: { w: 390, h: 420, x: 0, y: 60, canvasW: 390, canvasH: 844 } },
};

describe('mirrorRegion', () => {
  for (const [name, view] of Object.entries(VIEWS)) {
    it(`covers every pixel the floor can read: ${name}`, () => {
      const floor = makeFloor();
      const camera = makeCamera(view);
      const rect = new THREE.Vector4();
      expect(mirrorRegion(camera, floor.matrixWorld, HALF, WIDTH, HEIGHT, rect)).toBe(true);
      const positions = readPositions(floor, camera);
      expect(positions.length).toBeGreaterThan(100);
      let onScreen = 0;
      for (const { x, y } of positions) {
        // Only floor points that are on screen are drawn, so only they read the mirror image.
        if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) continue;
        onScreen++;
        expect(Math.max(0, x - READ_REACH)).toBeGreaterThanOrEqual(rect.x);
        expect(Math.min(WIDTH, x + READ_REACH)).toBeLessThanOrEqual(rect.x + rect.z);
        expect(Math.max(0, y - READ_REACH)).toBeGreaterThanOrEqual(rect.y);
        expect(Math.min(HEIGHT, y + READ_REACH)).toBeLessThanOrEqual(rect.y + rect.w);
      }
      expect(onScreen).toBeGreaterThan(0);
    });

    it(`is no larger than needed: ${name}`, () => {
      const floor = makeFloor();
      const camera = makeCamera(view);
      const rect = new THREE.Vector4();
      mirrorRegion(camera, floor.matrixWorld, HALF, WIDTH, HEIGHT, rect);
      const positions = readPositions(floor, camera);
      const clampX = (x) => Math.min(WIDTH, Math.max(0, x));
      const clampY = (y) => Math.min(HEIGHT, Math.max(0, y));
      const minX = Math.min(...positions.map((p) => clampX(p.x)));
      const maxX = Math.max(...positions.map((p) => clampX(p.x)));
      const minY = Math.min(...positions.map((p) => clampY(p.y)));
      const maxY = Math.max(...positions.map((p) => clampY(p.y)));
      // The grid includes the four corners, so the rectangle may only be the margin (plus rounding to whole pixels) larger than the grid's bounds.
      const slack = MIRROR_MARGIN + 1;
      expect(rect.x).toBeGreaterThanOrEqual(Math.max(0, minX - slack));
      expect(rect.y).toBeGreaterThanOrEqual(Math.max(0, minY - slack));
      expect(rect.x + rect.z).toBeLessThanOrEqual(Math.min(WIDTH, maxX + slack));
      expect(rect.y + rect.w).toBeLessThanOrEqual(Math.min(HEIGHT, maxY + slack));
    });
  }

  it('saves most of the image in the normal game view', () => {
    const floor = makeFloor();
    const rect = new THREE.Vector4();
    mirrorRegion(makeCamera({ offset: { w: 1230, h: 860, x: 0, y: 0, canvasW: 1800, canvasH: 860 } }), floor.matrixWorld, HALF, WIDTH, HEIGHT, rect);
    expect((rect.z * rect.w) / (WIDTH * HEIGHT)).toBeLessThan(0.45);
  });

  it('gives whole pixels inside the image', () => {
    const floor = makeFloor();
    for (const view of Object.values(VIEWS)) {
      const rect = new THREE.Vector4();
      mirrorRegion(makeCamera(view), floor.matrixWorld, HALF, WIDTH, HEIGHT, rect);
      for (const value of [rect.x, rect.y, rect.z, rect.w]) expect(Number.isInteger(value)).toBe(true);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.z).toBeGreaterThanOrEqual(0);
      expect(rect.w).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.z).toBeLessThanOrEqual(WIDTH);
      expect(rect.y + rect.w).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it('asks for the whole image when a corner of the floor is behind the camera', () => {
    const floor = makeFloor();
    // The camera stands on the board and looks along it, so part of the floor is behind it and has no place on screen.
    const camera = makeCamera({ elevation: 20, distance: 1.5 });
    const rect = new THREE.Vector4();
    expect(mirrorRegion(camera, floor.matrixWorld, HALF, WIDTH, HEIGHT, rect)).toBe(false);
    expect(rect.toArray()).toEqual([0, 0, WIDTH, HEIGHT]);
  });

  it('gives an empty rectangle, never a negative size, when the board is off screen', () => {
    const floor = makeFloor();
    // The camera looks at a point far to the side of the board.
    const camera = makeCamera({ distance: 17, target: [60, 0.3, 0] });
    const rect = new THREE.Vector4();
    expect(mirrorRegion(camera, floor.matrixWorld, HALF, WIDTH, HEIGHT, rect)).toBe(true);
    expect(rect.z * rect.w).toBe(0);
    expect(rect.z).toBeGreaterThanOrEqual(0);
    expect(rect.w).toBeGreaterThanOrEqual(0);
  });
});
