// Construction kit for the robots. A robot design ("blueprint") is a small tree of joints; each joint holds rigid parts made from simple shapes. All parts of one joint are merged into one mesh, and every vertex remembers its material slot. Both teams share the same blueprints.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Shape helpers. Sizes are in tiles (one tile is one unit). */
export const G = {
  box: (w, h, d, radius = 0.02, segments = 3) => new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, Math.min(w, h, d) / 2 - 0.0005)),
  sphere: (r, widthSegments = 22, heightSegments = 14) => new THREE.SphereGeometry(r, widthSegments, heightSegments),
  hemisphere: (r, widthSegments = 22, heightSegments = 8) => new THREE.SphereGeometry(r, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: (rTop, rBottom, h, segments = 22, open = false) => new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open),
  cone: (r, h, segments = 18) => new THREE.ConeGeometry(r, h, segments),
  capsule: (r, length, capSegments = 5, radialSegments = 14) => new THREE.CapsuleGeometry(r, length, capSegments, radialSegments),
  torus: (R, r, tubeSegments = 8, radialSegments = 30, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, tubeSegments, radialSegments, arc),
  disc: (r, segments = 24) => new THREE.CircleGeometry(r, segments),
  octa: (r) => new THREE.OctahedronGeometry(r, 0),
  /** Smooth body of revolution from [radius, height] profile points, bottom to top. */
  lathe: (points, segments = 26) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), segments),
  /** Same, but the profile is first smoothed with a spline for soft organic shells. */
  latheSmooth: (points, segments = 26, samples = 22) => {
    const curve = new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y)));
    return new THREE.LatheGeometry(curve.getPoints(samples).map((v) => new THREE.Vector2(Math.max(v.x, 0.0001), v.y)), segments);
  },
  /** Flat outline pushed into depth, centered on z. `outline` is a list of [x, y] points or a THREE.Shape. */
  extrude: (outline, depth, bevel = 0.01) => {
    const shape = outline instanceof THREE.Shape ? outline : new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
    geometry.translate(0, 0, -depth / 2);
    return geometry;
  },
  /** A coil spring standing on the y axis, from y = 0 to y = height. */
  spring: (radius, height, turns, tubeRadius) => {
    class Helix extends THREE.Curve {
      getPoint(t, target = new THREE.Vector3()) {
        const a = t * turns * Math.PI * 2;
        return target.set(Math.cos(a) * radius, t * height, Math.sin(a) * radius);
      }
    }
    return new THREE.TubeGeometry(new Helix(), Math.round(turns * 14), tubeRadius, 6, false);
  },
};

function prepare(geometry, slot, transform) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = transform;
  _p.set(p[0], p[1], p[2]);
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  g.applyMatrix4(_m.compose(_p, _q, _s));
  // A mirrored part (negative scale) has its triangles turned inside out; flip them back.
  if (_s.x * _s.y * _s.z < 0) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i += 3) {
      for (const attr of [pos, nor]) {
        const ax = attr.getX(i + 1);
        const ay = attr.getY(i + 1);
        const az = attr.getZ(i + 1);
        attr.setXYZ(i + 1, attr.getX(i + 2), attr.getY(i + 2), attr.getZ(i + 2));
        attr.setXYZ(i + 2, ax, ay, az);
      }
    }
  }
  const slots = new Float32Array(g.attributes.position.count).fill(slot);
  g.setAttribute('aSlot', new THREE.BufferAttribute(slots, 1));
  geometry.dispose();
  return g;
}

export class Blueprint {
  /** @param {string} type Chess piece letter: p, r, n, b, q or k. */
  constructor(type) {
    this.type = type;
    /** @type {Map<string, {name:string, parent:string|null, position:number[], rotation:number[], parts:THREE.BufferGeometry[], geometry:THREE.BufferGeometry|null}>} */
    this.joints = new Map();
    this.faceSpec = null;
    /** Free-form numbers the pose code and effects need (heights, muzzle positions and so on). */
    this.info = {};
    this.joint('root', null);
  }

  /** Add a joint (a hinge point). Children move with their parent. */
  joint(name, parent, position = [0, 0, 0], rotation = [0, 0, 0]) {
    if (this.joints.has(name)) throw new Error(`Joint "${name}" already exists on ${this.type}`);
    if (parent !== null && !this.joints.has(parent)) throw new Error(`Unknown parent joint "${parent}" on ${this.type}`);
    this.joints.set(name, { name, parent, position, rotation, parts: [], geometry: null });
    return this;
  }

  /**
   * Add a rigid part to a joint. The transform is given in the joint's own space.
   * @param {string} joint
   * @param {THREE.BufferGeometry} geometry
   * @param {number} slot Material slot from SLOT.
   * @param {{p?:number[], r?:number[], s?:number[]|number}} [transform]
   */
  part(joint, geometry, slot, transform = {}) {
    const target = this.joints.get(joint);
    if (!target) throw new Error(`Unknown joint "${joint}" on ${this.type}`);
    target.parts.push(prepare(geometry, slot, transform));
    return this;
  }

  /** Add the same part twice, mirrored left and right (x and -x). */
  pair(joint, makeGeometry, slot, transform = {}) {
    const { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = transform;
    const scale = typeof s === 'number' ? [s, s, s] : s;
    this.part(joint, makeGeometry(), slot, { p, r, s: scale });
    this.part(joint, makeGeometry(), slot, { p: [-p[0], p[1], p[2]], r: [r[0], -r[1], -r[2]], s: scale });
    return this;
  }

  /**
   * Define the screen face.
   * @param {string} joint Joint the face is attached to.
   * @param {{w:number, h:number, p:number[], r?:number[], curve?:number, spherical?:boolean, eyes?:number, corner?:number, shape?:object, mouth?:boolean}} spec `curve` bends the screen around a head of that radius.
   */
  face(joint, spec) {
    if (!this.joints.has(joint)) throw new Error(`Unknown joint "${joint}" on ${this.type}`);
    this.faceSpec = { joint, r: [0, 0, 0], eyes: 2, corner: 0.3, mouth: false, ...spec };
    return this;
  }

  /** Merge the parts of every joint into one geometry. Call once after the design is complete. */
  finalize() {
    for (const joint of this.joints.values()) {
      if (joint.parts.length === 0) continue;
      const merged = mergeGeometries(joint.parts, false);
      joint.parts.forEach((g) => g.dispose());
      joint.parts = [];
      joint.geometry = mergeVertices(merged, 1e-4);
      merged.dispose();
      joint.geometry.computeBoundingSphere();
      joint.geometry.computeBoundingBox();
    }
    return this;
  }
}

/**
 * Build the screen-face geometry: a plane with UVs, optionally bent to sit on a round head.
 * @param {{w:number, h:number, curve?:number, spherical?:boolean}} spec
 */
export function createFaceGeometry(spec) {
  const geometry = new THREE.PlaneGeometry(spec.w, spec.h, spec.curve ? 12 : 1, spec.curve && spec.spherical ? 8 : 1);
  if (spec.curve) {
    const R = spec.curve;
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const a = pos.getX(i) / R;
      const b = spec.spherical ? pos.getY(i) / R : 0;
      const y = spec.spherical ? R * Math.sin(b) : pos.getY(i);
      pos.setXYZ(i, R * Math.sin(a) * Math.cos(b), y, R * Math.cos(a) * Math.cos(b) - R);
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}
