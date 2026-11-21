// Works out which part of the floor mirror image the floor can read: the rectangle of the screen that the board covers. Only that part has to be cleared, drawn and resolved. Pure math with no WebGL, so it is tested without a browser.
import * as THREE from 'three';

/** Extra pixels kept around the rectangle. The floor shader reads up to 1.3 pixels to each side (its soft five-tap cross), smooth filtering reads one pixel further, and at the board's edge the center of a screen pixel can lie a little outside the board. */
export const MIRROR_MARGIN = 4;

const _toScreen = new THREE.Matrix4();
const _corner = new THREE.Vector4();

/**
 * Find the rectangle of the mirror image that the floor can read.
 *
 * The mirror camera is the main camera mirrored in the floor, so a point of the floor has the same place in the mirror image as on the screen, only flipped left to right. The rectangle is therefore the screen rectangle around the four corners of the floor, flipped, cut to the image and grown by `MIRROR_MARGIN`.
 * @param {THREE.Camera} camera The main camera, with its matrices up to date.
 * @param {THREE.Matrix4} floorMatrix World matrix of the mirror floor.
 * @param {number} halfSize Half the side of the square floor, in the floor's own flat x and y.
 * @param {number} width Width of the mirror image in pixels.
 * @param {number} height Height of the mirror image in pixels.
 * @param {THREE.Vector4} out Receives x, y, width and height in whole pixels, counted from the bottom left like a WebGL scissor box.
 * @returns {boolean} False when there is no safe rectangle (a corner of the floor is behind the camera); `out` is then the whole image and the caller must draw all of it.
 */
export function mirrorRegion(camera, floorMatrix, halfSize, width, height, out) {
  _toScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(floorMatrix);
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (let i = 0; i < 4; i++) {
    _corner.set(i & 1 ? halfSize : -halfSize, i & 2 ? halfSize : -halfSize, 0, 1).applyMatrix4(_toScreen);
    // A corner behind the camera has no place on screen, so the four corners no longer bound the visible floor.
    if (!(_corner.w > 0)) {
      out.set(0, 0, width, height);
      return false;
    }
    // Screen position from -1 to 1, with x flipped for the mirror image.
    const x = -_corner.x / _corner.w;
    const y = _corner.y / _corner.w;
    left = Math.min(left, x);
    right = Math.max(right, x);
    bottom = Math.min(bottom, y);
    top = Math.max(top, y);
  }
  const x0 = THREE.MathUtils.clamp(Math.floor((left * 0.5 + 0.5) * width) - MIRROR_MARGIN, 0, width);
  const x1 = THREE.MathUtils.clamp(Math.ceil((right * 0.5 + 0.5) * width) + MIRROR_MARGIN, 0, width);
  const y0 = THREE.MathUtils.clamp(Math.floor((bottom * 0.5 + 0.5) * height) - MIRROR_MARGIN, 0, height);
  const y1 = THREE.MathUtils.clamp(Math.ceil((top * 0.5 + 0.5) * height) + MIRROR_MARGIN, 0, height);
  out.set(x0, y0, x1 - x0, y1 - y0);
  return true;
}
