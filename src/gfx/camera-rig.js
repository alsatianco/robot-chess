// Camera control. The camera orbits the board center at a fixed angle with limited rotation, can snap to a top-down view of the same 3D scene, turns around when the board is flipped, and frames the board inside the free part of the screen (the part not covered by panels).
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const DEG = Math.PI / 180;

export const CAMERA_LIMITS = {
  elevationDefault: 53 * DEG,
  elevationMin: 34 * DEG,
  elevationMax: 80 * DEG,
  elevationTop: 89.2 * DEG,
  yawRange: 42 * DEG,
  // Zoom is a factor on the distance at which the whole board just fits in the free part of the screen. The default 1 is that distance: the closest view that still shows every square, the frame and the tallest pieces.
  zoomDefault: 1,
  zoomMin: 0.78,
  zoomMax: 1.3,
};

/** Changes of the zoom factor or of an angle (in radians) below this move the picture by less than a pixel. */
const VIEW_EPSILON = 1e-4;

// Points that must stay on screen: the corners of the platform and the tops of tall pieces on the edge ranks.
const FIT_POINTS = [];
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    FIT_POINTS.push(new THREE.Vector3(sx * 4.72, 0, sz * 4.72));
    FIT_POINTS.push(new THREE.Vector3(sx * 3.9, 1.72, sz * 3.6));
  }
}

const _v = new THREE.Vector3();
const _probe = new THREE.PerspectiveCamera();

export class CameraRig {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    this.camera = stage.camera;
    this.fov = 30;
    this.orientation = 'w';
    this.topDown = false;
    /** Player offsets on top of the base view. */
    this.userYaw = 0;
    this.userElevation = CAMERA_LIMITS.elevationDefault;
    this.userZoom = CAMERA_LIMITS.zoomDefault;
    /** Slow drifting orbit used behind menus. */
    this.attract = false;
    this.attractTime = 0;

    this.azimuth = 0;
    this.elevation = CAMERA_LIMITS.elevationDefault;
    this.distance = 16;
    this.target = new THREE.Vector3(0, 0.3, 0);
    this.fitDistance = 16;
    this.centerShift = new THREE.Vector2();

    /** Cinematic focus: a point to lean toward and how strongly (0..1). */
    this.focusPoint = new THREE.Vector3();
    this.focusAmount = 0;
    this.focusGoal = 0;

    this.shakeAmount = 0;
    this.shakeEnabled = true;
    this.time = 0;

    /** Free area of the canvas in CSS pixels where the board should be centered. */
    this.viewport = { x: 0, y: 0, w: 1, h: 1 };
    this.canvasSize = { w: 1, h: 1 };
    this.fitDirty = true;
    this.snapNext = true;
  }

  /** Tell the rig the canvas size and the free rectangle the board should fill. */
  setViewport(canvasWidth, canvasHeight, rect) {
    this.canvasSize = { w: canvasWidth, h: canvasHeight };
    this.viewport = rect ?? { x: 0, y: 0, w: canvasWidth, h: canvasHeight };
    this.fitDirty = true;
  }

  /** Which color sits at the bottom. The camera swings around the board when this changes. */
  setOrientation(color, animate = true) {
    if (color === this.orientation) return;
    this.orientation = color;
    this.userYaw = 0;
    if (!animate) this.snapNext = true;
  }

  setTopDown(on) {
    this.topDown = on;
    this.fitDirty = true;
  }

  /** Rotate by a drag, in radians. Rotation is limited so the player never loses the board. */
  orbit(deltaYaw, deltaElevation) {
    this.userYaw = clamp(this.userYaw + deltaYaw, -CAMERA_LIMITS.yawRange, CAMERA_LIMITS.yawRange);
    if (!this.topDown) {
      this.userElevation = clamp(this.userElevation + deltaElevation, CAMERA_LIMITS.elevationMin, CAMERA_LIMITS.elevationMax);
      this.fitDirty = true;
    }
  }

  /** Change the zoom by a factor on the camera distance: above 1 moves away, below 1 moves closer. */
  zoom(factor) {
    this.userZoom = clamp(this.userZoom * factor, CAMERA_LIMITS.zoomMin, CAMERA_LIMITS.zoomMax);
  }

  /** Go back to the default zoom, turn and tilt. The camera glides there; the top view stays on if it is on. */
  resetView() {
    this.userYaw = 0;
    this.userElevation = CAMERA_LIMITS.elevationDefault;
    this.userZoom = CAMERA_LIMITS.zoomDefault;
    this.fitDirty = true;
  }

  /** True while the zoom, turn and tilt are at their defaults, so there is nothing to reset. A difference too small to see (a rounding error after zooming out and back) still counts as the default. */
  get isDefaultView() {
    const same = (value, base) => Math.abs(value - base) < VIEW_EPSILON;
    return same(this.userYaw, 0) && same(this.userElevation, CAMERA_LIMITS.elevationDefault) && same(this.userZoom, CAMERA_LIMITS.zoomDefault);
  }

  /** Lean the camera toward a point on the board for a cinematic moment. Call release() afterwards. */
  focusOn(point, amount = 1) {
    this.focusPoint.copy(point);
    this.focusGoal = amount;
  }

  release() {
    this.focusGoal = 0;
  }

  /** Add screen shake (0..1). Ignored when the player turned shake off. */
  shake(amount) {
    if (this.shakeEnabled) this.shakeAmount = Math.min(1, this.shakeAmount + amount);
  }

  get goalElevation() {
    return this.topDown ? CAMERA_LIMITS.elevationTop : this.userElevation;
  }

  get goalAzimuth() {
    const base = this.orientation === 'w' ? 0 : Math.PI;
    const drift = this.attract ? Math.sin(this.attractTime * 0.11) * 0.5 : 0;
    return base + this.userYaw + drift;
  }

  // Find the distance at which every fit point is inside the free rectangle, for the goal viewing angle. Solved by bisection on a probe camera.
  #computeFit() {
    const rect = this.viewport;
    const aspect = Math.max(0.2, rect.w / Math.max(1, rect.h));
    const elevation = this.attract ? 30 * DEG : this.goalElevation;
    const azimuth = this.orientation === 'w' ? 0 : Math.PI;
    _probe.fov = this.fov;
    _probe.aspect = aspect;
    _probe.near = 0.1;
    _probe.far = 400;
    _probe.updateProjectionMatrix();
    const margin = 0.94;
    const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const measure = (distance) => {
      this.#placeCamera(_probe, azimuth, elevation, distance, _v.set(0, 0.3, 0));
      _probe.updateMatrixWorld(true);
      bounds.minX = bounds.minY = Infinity;
      bounds.maxX = bounds.maxY = -Infinity;
      for (const point of FIT_POINTS) {
        const p = point.clone().project(_probe);
        bounds.minX = Math.min(bounds.minX, p.x);
        bounds.maxX = Math.max(bounds.maxX, p.x);
        bounds.minY = Math.min(bounds.minY, p.y);
        bounds.maxY = Math.max(bounds.maxY, p.y);
      }
      return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    };
    let lo = 4;
    let hi = 90;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (measure(mid) > margin) lo = mid;
      else hi = mid;
    }
    this.fitDistance = hi;
    measure(hi);
    // Shift so the board's screen bounds are centered in the free rectangle.
    this.centerShift.set((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
    this.fitDirty = false;
  }

  #placeCamera(camera, azimuth, elevation, distance, target) {
    const ce = Math.cos(elevation);
    const se = Math.sin(elevation);
    const sa = Math.sin(azimuth);
    const ca = Math.cos(azimuth);
    camera.position.set(target.x + distance * sa * ce, target.y + distance * se, target.z + distance * ca * ce);
    // The true "up" of an orbiting camera. Unlike a fixed (0,1,0) it stays valid when looking straight down.
    camera.up.set(-sa * se, ce, -ca * se);
    camera.lookAt(target);
  }

  update(dt) {
    this.time += dt;
    if (this.attract) this.attractTime += dt;
    if (this.fitDirty) this.#computeFit();

    const snap = this.snapNext;
    this.snapNext = false;
    const k = snap ? 1 : 1 - Math.exp(-dt * 5.5);
    const kFocus = snap ? 1 : 1 - Math.exp(-dt * 3.2);

    // Take the short way around when the board flips.
    let goalAz = this.goalAzimuth;
    while (goalAz - this.azimuth > Math.PI) goalAz -= Math.PI * 2;
    while (goalAz - this.azimuth < -Math.PI) goalAz += Math.PI * 2;
    this.azimuth += (goalAz - this.azimuth) * k;
    if (Math.abs(this.azimuth) > Math.PI * 4) this.azimuth %= Math.PI * 2;

    this.focusAmount += (this.focusGoal - this.focusAmount) * kFocus;
    const f = this.focusAmount;
    const goalElevation = this.attract ? 30 * DEG : this.goalElevation;
    const elevationWithFocus = goalElevation - f * (goalElevation - 36 * DEG) * (this.topDown ? 0 : 0.75);
    this.elevation += (elevationWithFocus - this.elevation) * k;
    const goalDistance = this.fitDistance * (this.attract ? 0.92 : this.userZoom) * (1 - 0.3 * f);
    this.distance += (goalDistance - this.distance) * k;
    const tx = this.focusPoint.x * f * 0.75;
    const ty = 0.3 + (this.focusPoint.y - 0.3) * f * 0.6;
    const tz = this.focusPoint.z * f * 0.75;
    this.target.lerp(_v.set(tx, ty, tz), k);

    this.#placeCamera(this.camera, this.azimuth, this.elevation, this.distance, this.target);

    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount * this.shakeAmount * 0.16;
      const t = this.time;
      this.camera.position.x += Math.sin(t * 97) * s;
      this.camera.position.y += Math.sin(t * 113 + 1.7) * s;
      this.camera.position.z += Math.sin(t * 89 + 0.6) * s * 0.6;
      this.shakeAmount *= Math.exp(-dt * 7);
    } else {
      this.shakeAmount = 0;
    }

    // Off-center projection: the base view is the free rectangle, widened to cover the whole canvas.
    const rect = this.viewport;
    const canvas = this.canvasSize;
    const shiftX = this.centerShift.x * rect.w * 0.5 * (1 - f);
    const shiftY = this.centerShift.y * rect.h * 0.5 * (1 - f);
    this.camera.fov = this.fov;
    this.camera.aspect = rect.w / Math.max(1, rect.h);
    this.camera.setViewOffset(rect.w, rect.h, -rect.x + shiftX, -rect.y - shiftY, canvas.w, canvas.h);
    this.camera.updateMatrixWorld(true);
  }

  /** Rotation that makes flat badges on the board face the camera. */
  get markerYaw() {
    return this.azimuth;
  }
}
