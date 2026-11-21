// The garden world: a floating island of meadow around the chess board, with grass that moves in the wind, rocks, bushes, logs, trees, flowers and mushrooms. Everything is built in code from simple low-poly shapes and merged into a few meshes, so the whole garden costs only a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ISLAND_RADIUS = 13.6;
const BOARD_CLEAR = 4.84;
const smoothstep = THREE.MathUtils.smoothstep;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth 2D value noise in 0..1, used for color patches in the meadow. */
function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, 0, iz);
  const b = hash3(ix + 1, 0, iz);
  const c = hash3(ix, 0, iz + 1);
  const d = hash3(ix + 1, 0, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Radius of the island edge in a direction; the edge is wavy, not a perfect circle. */
function rimRadius(angle) {
  return ISLAND_RADIUS + Math.sin(angle * 3 + 1) * 0.9 + Math.sin(angle * 7 + 2.3) * 0.45 + Math.sin(angle * 13 + 0.7) * 0.2;
}

/** Height of the meadow at a point. Flat next to the board, soft hills further out, falling away at the island edge. */
export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const hills = (Math.sin(x * 0.52 + 1.3) * Math.cos(z * 0.43 - 0.7) + 0.5 * Math.sin(x * 1.13 - z * 0.91 + 2)) * 0.24;
  const rim = rimRadius(Math.atan2(z, x));
  const edge = smoothstep(r, rim - 1.7, rim);
  return -0.13 + hills * smoothstep(r, 5.6, 9.5) - edge * edge * 0.95;
}

const col = (hex) => new THREE.Color(hex);
const GREENS = [col('#4f9a3c'), col('#3f8a42'), col('#63a843'), col('#2f7a48'), col('#7ab04a')];
const ROCK = col('#8b9097');
const MOSS = col('#55803a');
const BARK = col('#6a482e');
const WOOD_END = col('#c8a26a');
const FLOWER_COLORS = [col('#ffffff'), col('#ffd84d'), col('#ff8fb3'), col('#b58cff'), col('#ff6b5a'), col('#8fd0ff')];

// Give a geometry flat faces and one color per face (with a small random shade), then move it into place.
function finish(geometry, rng, colorOf, transform = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position') g.deleteAttribute(name);
  }
  const { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = transform;
  const scale = typeof s === 'number' ? [s, s, s] : s;
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...scale)));
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    colorOf(c, nor.getX(i), nor.getY(i), nor.getZ(i), pos.getY(i));
    c.multiplyScalar(0.88 + rng() * 0.24);
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function lumpy(detail, seed, amount) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Same displacement for vertices that share a position, so faces stay joined.
    const k = 1 + (hash3(Math.round(x * 50) + seed, Math.round(y * 50), Math.round(z * 50)) - 0.5) * amount;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  return g;
}

export class Garden {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.name = 'garden';
    /** Circles where no grass grows: [x, z, radius]. */
    this.blocked = [];
    /** Soft dark spots under props, standing in for shadows on the grass: [x, z, radius, strength]. */
    this.shade = [];
    this.#buildGround();
    this.#buildProps();
    this.#buildGrass();
    this.#buildFar();
    stage.onQualityChange.add(() => this.#buildGrass());
  }

  #buildGround() {
    const rings = 30;
    const segments = 84;
    const positions = [];
    const colors = [];
    const index = [];
    const c = new THREE.Color();
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j <= segments; j++) {
        const angle = (j / segments) * Math.PI * 2;
        const r = (i / rings) * rimRadius(angle);
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        positions.push(x, groundHeight(x, z), z);
        const patch = noise2(x * 0.35 + 9, z * 0.35 + 4);
        c.copy(GREENS[1]).lerp(GREENS[3], patch).multiplyScalar(0.62);
        colors.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segments; j++) {
        const a = i * (segments + 1) + j;
        const b = a + segments + 1;
        index.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    this.groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    // The ground is almost fully covered by grass, which is drawn without real shadows (the dark spots under props are painted into the blades instead), so no shadow work is spent here.
    const ground = new THREE.Mesh(geometry, this.groundMaterial);
    this.group.add(ground);

    // The rock under the island: rings that shrink toward a point far below, with color bands like layers of stone.
    const rng = mulberry32(77);
    const under = [];
    const depthRings = 9;
    const seg = 40;
    const ringPoint = (i, jRaw) => {
      // Wrap the last column onto the first so the ring closes without a seam.
      const j = jRaw % seg;
      const angle = (j / seg) * Math.PI * 2;
      const t = i / depthRings;
      const r = rimRadius(angle) * Math.pow(1 - t, 1.35) * (1 + (hash3(i * 3.1, j * 1.7, 5) - 0.5) * 0.22 * (i > 0 ? 1 : 0)) + 0.2;
      const y = i === 0 ? groundHeight(Math.cos(angle) * rimRadius(angle), Math.sin(angle) * rimRadius(angle)) - 0.02 : -0.9 - t * 9.5 + (hash3(j * 2.3, i, 1) - 0.5) * 0.5;
      return [Math.cos(angle) * r, y, Math.sin(angle) * r];
    };
    for (let i = 0; i < depthRings; i++) {
      for (let j = 0; j < seg; j++) {
        const a = ringPoint(i, j);
        const b = ringPoint(i, j + 1);
        const d = ringPoint(i + 1, j);
        const e = ringPoint(i + 1, j + 1);
        under.push(...a, ...b, ...d, ...b, ...e, ...d);
      }
    }
    const underGeometry = new THREE.BufferGeometry();
    underGeometry.setAttribute('position', new THREE.Float32BufferAttribute(under, 3));
    const rock = finish(underGeometry, rng, (out, nx, ny, nz, y) => {
      const band = Math.floor(-y * 1.3) % 2 === 0 ? 0.82 : 1;
      out.copy(col('#7b6a58')).lerp(col('#5f6470'), smoothstep(-y, 1.5, 7)).multiplyScalar(band);
      if (y > -0.9) out.lerp(GREENS[3], 0.55);
    });
    this.group.add(new THREE.Mesh(rock, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide })));
  }

  #buildProps() {
    const rng = mulberry32(2026);
    const parts = [];
    const range = (min, max) => min + rng() * (max - min);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    const sun = new THREE.Vector2(0.62, -0.5);

    const block = (x, z, radius, shadeRadius = radius * 1.9, strength = 0.55) => {
      this.blocked.push([x, z, radius]);
      // The shade spot is pushed away from the sun, where a real shadow would fall.
      this.shade.push([x + sun.x * shadeRadius * 0.45, z + sun.y * shadeRadius * 0.45, shadeRadius, strength]);
    };
    const free = (x, z, radius) => {
      if (Math.abs(x) < BOARD_CLEAR + radius && Math.abs(z) < BOARD_CLEAR + radius) return false;
      if (Math.hypot(x, z) > rimRadius(Math.atan2(z, x)) - 1.2 - radius) return false;
      return this.blocked.every(([bx, bz, br]) => Math.hypot(x - bx, z - bz) > br + radius + 0.15);
    };
    // Try random spots in a ring until one is free.
    const spot = (minR, maxR, radius, angleOf = null) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const angle = angleOf ? angleOf() : rng() * Math.PI * 2;
        const r = range(minR, maxR);
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (free(x, z, radius)) return { x, z, y: groundHeight(x, z) };
      }
      return null;
    };

    const addRock = (x, y, z, size) => {
      const squash = range(0.5, 0.8);
      parts.push(
        finish(lumpy(1, Math.floor(rng() * 1000), 0.5), rng, (out, nx, ny) => out.copy(ROCK).lerp(MOSS, ny > 0.55 ? 0.6 : 0), { p: [x, y + size * squash * 0.35, z], r: [0, rng() * 6.28, 0], s: [size * range(0.8, 1.25), size * squash, size * range(0.8, 1.25)] }),
      );
    };
    const addMushroom = (x, y, z, size) => {
      const cap = rng() < 0.7 ? col('#d9403a') : col('#c98a4b');
      parts.push(finish(new THREE.CylinderGeometry(0.03, 0.045, 0.13, 6), rng, (out) => out.set('#f3ead8'), { p: [x, y + 0.065 * size, z], s: size }));
      parts.push(finish(new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), rng, (out) => out.copy(cap), { p: [x, y + 0.12 * size, z], s: [size, size * 0.8, size] }));
    };
    const addBush = (x, y, z, size) => {
      const base = pick(GREENS);
      const blobs = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < blobs; i++) {
        const a = rng() * 6.28;
        const d = i === 0 ? 0 : range(0.25, 0.55) * size;
        const s = size * range(0.42, 0.7);
        parts.push(finish(lumpy(1, Math.floor(rng() * 1000), 0.28), rng, (out, nx, ny) => out.copy(base).multiplyScalar(0.72 + 0.4 * Math.max(0, ny)), { p: [x + Math.cos(a) * d, y + s * 0.62, z + Math.sin(a) * d], s: [s, s * 0.85, s] }));
      }
      if (rng() < 0.55) {
        const bloom = pick(FLOWER_COLORS);
        for (let i = 0; i < 7; i++) {
          const a = rng() * 6.28;
          const e = range(0.2, 1.1);
          const rr = size * 0.72;
          parts.push(finish(new THREE.IcosahedronGeometry(0.05, 0), rng, (out) => out.copy(bloom), { p: [x + Math.cos(a) * Math.cos(e) * rr * 0.8, y + size * 0.5 + Math.sin(e) * rr * 0.75, z + Math.sin(a) * Math.cos(e) * rr * 0.8] }));
        }
      }
    };
    const addTree = (x, y, z, size, pine) => {
      parts.push(finish(new THREE.CylinderGeometry(0.11 * size, 0.2 * size, 1.5 * size, 7), rng, (out) => out.copy(BARK), { p: [x, y + 0.75 * size, z] }));
      if (pine) {
        const green = col('#2c6e4a');
        for (let i = 0; i < 3; i++) {
          parts.push(finish(new THREE.ConeGeometry((1.15 - i * 0.28) * size, 1.35 * size, 8), rng, (out, nx, ny) => out.copy(green).multiplyScalar(0.8 + 0.35 * Math.max(0, ny)), { p: [x, y + (1.6 + i * 0.85) * size, z], r: [0, rng() * 6.28, 0] }));
        }
      } else {
        const green = pick(GREENS);
        const blobs = [[0, 2.35, 0, 1.15], [0.75, 1.95, 0.2, 0.8], [-0.7, 2.05, -0.3, 0.85], [0.1, 2.0, 0.8, 0.75], [-0.1, 3.0, -0.1, 0.8]];
        for (const [bx, by, bz, bs] of blobs) {
          parts.push(finish(lumpy(1, Math.floor(rng() * 1000), 0.3), rng, (out, nx, ny) => out.copy(green).multiplyScalar(0.7 + 0.45 * Math.max(0, ny)), { p: [x + bx * size, y + by * size, z + bz * size], s: bs * size }));
        }
      }
    };
    const addLog = (x, y, z, length, angle) => {
      const radius = range(0.2, 0.27);
      const axis = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
      parts.push(
        finish(new THREE.CylinderGeometry(radius, radius * 1.08, length, 9), rng, (out, nx, ny, nz) => out.copy(Math.abs(nx * axis.x + nz * axis.z) > 0.9 ? WOOD_END : BARK), { p: [x, y + radius * 0.9, z], r: [0, angle, Math.PI / 2] }),
      );
      // A short broken branch stub.
      parts.push(finish(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6), rng, (out) => out.copy(BARK), { p: [x + axis.x * length * 0.2, y + radius * 1.7, z + axis.z * length * 0.2], r: [0.5, angle, 0] }));
      for (let i = -2; i <= 2; i++) block(x + axis.x * (length / 5) * i, z + axis.z * (length / 5) * i, radius + 0.08, 0.6, 0.4);
      if (rng() < 0.8) addMushroom(x + axis.z * (radius + 0.14), y, z - axis.x * (radius + 0.14), range(0.9, 1.5));
    };

    // Trees stand toward the four corners and far from the board, so they frame the view and never hide a square.
    for (let i = 0; i < 9; i++) {
      const corner = (Math.floor(i % 4) + 0.5) * (Math.PI / 2);
      const place = spot(9.3, 11.6, 1.2, () => corner + range(-0.42, 0.42));
      if (!place) continue;
      const size = range(0.85, 1.25);
      addTree(place.x, place.y, place.z, size, rng() < 0.4);
      block(place.x, place.z, 0.35, 2.3 * size, 0.6);
    }
    // Logs.
    for (let i = 0; i < 4; i++) {
      const place = spot(6.4, 9.6, 1.2);
      if (place) addLog(place.x, place.y, place.z, range(1.3, 2.1), rng() * Math.PI);
    }
    // Rocks, often in small groups.
    for (let i = 0; i < 13; i++) {
      const size = range(0.28, 0.85);
      const place = spot(5.7, 12, size);
      if (!place) continue;
      addRock(place.x, place.y, place.z, size);
      block(place.x, place.z, size * 0.85);
      const friends = Math.floor(rng() * 3);
      for (let k = 0; k < friends; k++) {
        const a = rng() * 6.28;
        const s = size * range(0.3, 0.55);
        const fx = place.x + Math.cos(a) * (size + s) * 0.9;
        const fz = place.z + Math.sin(a) * (size + s) * 0.9;
        if (!free(fx, fz, s * 0.5)) continue;
        addRock(fx, groundHeight(fx, fz), fz, s);
        block(fx, fz, s * 0.8);
      }
    }
    // Bushes.
    for (let i = 0; i < 16; i++) {
      const size = range(0.55, 1.05);
      const place = spot(5.9, 12, size * 0.7);
      if (!place) continue;
      addBush(place.x, place.y, place.z, size);
      block(place.x, place.z, size * 0.7, size * 1.7, 0.5);
    }
    // Mushrooms and flowers in little clusters. They do not block grass.
    for (let i = 0; i < 9; i++) {
      const place = spot(5.4, 11.5, 0.2);
      if (!place) continue;
      for (let k = 0; k < 3; k++) {
        const mx = place.x + range(-0.3, 0.3);
        const mz = place.z + range(-0.3, 0.3);
        addMushroom(mx, groundHeight(mx, mz), mz, range(0.8, 1.7));
      }
    }
    for (let i = 0; i < 46; i++) {
      const place = spot(5.2, 12.2, 0.1);
      if (!place) continue;
      const bloom = pick(FLOWER_COLORS);
      const count = 3 + Math.floor(rng() * 6);
      for (let k = 0; k < count; k++) {
        const fx = place.x + range(-0.55, 0.55);
        const fz = place.z + range(-0.55, 0.55);
        if (Math.abs(fx) < BOARD_CLEAR && Math.abs(fz) < BOARD_CLEAR) continue;
        const fy = groundHeight(fx, fz);
        const tall = range(0.22, 0.4);
        parts.push(finish(new THREE.BoxGeometry(0.014, tall, 0.014), rng, (out) => out.copy(GREENS[1]), { p: [fx, fy + tall / 2, fz] }));
        parts.push(finish(new THREE.IcosahedronGeometry(0.05, 0), rng, (out) => out.copy(bloom), { p: [fx, fy + tall, fz], s: [1, 0.7, 1] }));
        parts.push(finish(new THREE.IcosahedronGeometry(0.022, 0), rng, (out) => out.set('#ffd84d'), { p: [fx, fy + tall + 0.03, fz] }));
      }
    }

    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    this.propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
    this.props = new THREE.Mesh(merged, this.propMaterial);
    this.group.add(this.props);
  }

  // How dark the grass is at a point: under trees and next to rocks it gets darker, as if in shadow.
  #shadeAt(x, z) {
    let light = 1;
    for (const [sx, sz, radius, strength] of this.shade) {
      const d = Math.hypot(x - sx, z - sz) / radius;
      if (d < 1) light *= 1 - strength * (1 - d * d) * (1 - d * d);
    }
    // Soft contact shadow where the board platform meets the meadow.
    const edge = Math.max(Math.abs(x), Math.abs(z)) - 4.68;
    if (edge < 0.6) light *= 0.62 + 0.38 * smoothstep(edge, 0, 0.6);
    return light;
  }

  #buildGrass() {
    if (this.grass) {
      this.group.remove(this.grass);
      this.grass.geometry.dispose();
    }
    const quality = this.stage.qualityName;
    const count = quality === 'high' ? 70000 : quality === 'medium' ? 34000 : 11000;
    const fat = quality === 'low' ? 1.9 : quality === 'medium' ? 1.3 : 1;
    const rng = mulberry32(4242);

    // One blade: a tapering strip with three segments.
    const blade = new THREE.BufferGeometry();
    const w = [0.5, 0.42, 0.27];
    const verts = [];
    for (let i = 0; i < 3; i++) verts.push(-w[i], i / 3, 0, w[i], i / 3, 0);
    verts.push(0, 1, 0);
    blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);

    const offsets = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    const tints = new Float32Array(count * 3);
    const c = new THREE.Color();
    let n = 0;
    let guard = 0;
    while (n < count && guard++ < count * 30) {
      const angle = rng() * Math.PI * 2;
      const rim = rimRadius(angle);
      // Uniform over the disc area.
      const r = Math.sqrt(rng()) * (rim - 0.25);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      if (Math.abs(x) < BOARD_CLEAR && Math.abs(z) < BOARD_CLEAR) continue;
      // Thinner far from the board, where the camera rarely looks.
      if (r > 10.5 && rng() > 0.5) continue;
      let ok = true;
      for (const [bx, bz, br] of this.blocked) {
        if ((x - bx) * (x - bx) + (z - bz) * (z - bz) < br * br) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const near = smoothstep(Math.max(Math.abs(x), Math.abs(z)), BOARD_CLEAR, BOARD_CLEAR + 0.9);
      const patch = noise2(x * 0.45, z * 0.45);
      const fine = noise2(x * 1.9 + 31, z * 1.9 + 17);
      const height = (0.16 + 0.26 * near) * (0.7 + 0.6 * rng()) * (0.75 + 0.5 * patch);
      offsets.set([x, groundHeight(x, z) - 0.01, z], n * 3);
      params.set([rng() * Math.PI * 2, height, (0.055 + rng() * 0.04) * fat, rng()], n * 4);
      c.copy(GREENS[0]).lerp(GREENS[2], patch).lerp(GREENS[4], fine * 0.55).lerp(GREENS[3], (1 - patch) * 0.35);
      c.multiplyScalar(this.#shadeAt(x, z) * (0.9 + rng() * 0.2));
      tints.set([c.r, c.g, c.b], n * 3);
      n++;
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = blade.index;
    geometry.setAttribute('position', blade.attributes.position);
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets.subarray(0, n * 3), 3));
    geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params.subarray(0, n * 4), 4));
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints.subarray(0, n * 3), 3));
    geometry.instanceCount = n;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), ISLAND_RADIUS + 3);

    if (!this.grassMaterial) {
      this.grassMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uLight: { value: new THREE.Color(1, 1, 1) },
          uTipLight: { value: new THREE.Color(1, 0.95, 0.6) },
        },
        vertexShader: /* glsl */ `
          attribute vec3 aOffset;
          attribute vec4 aParams;
          attribute vec3 aTint;
          uniform float uTime;
          varying float vH;
          varying vec3 vTint;
          void main() {
            float h = position.y;
            vec3 p = vec3(position.x * aParams.z, h * aParams.y, 0.0);
            // Each blade curves over a little.
            p.z += (0.22 + aParams.w * 0.4) * h * h * aParams.y;
            float c = cos(aParams.x);
            float s = sin(aParams.x);
            p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
            vec3 world = aOffset + p;
            // Wind: slow waves that roll over the meadow plus a quick flutter per blade.
            float wave = sin(uTime * 1.25 + aOffset.x * 0.55 + aOffset.z * 0.42);
            float flutter = sin(uTime * 3.1 + aOffset.x * 1.9 - aOffset.z * 1.4 + aParams.w * 6.28);
            float gust = 0.55 + 0.45 * sin(uTime * 0.33 + aOffset.x * 0.14 + aOffset.z * 0.1);
            world.xz += vec2(0.85, 0.5) * (wave * 0.34 + flutter * 0.09) * gust * h * h * aParams.y;
            vH = h;
            vTint = aTint * (0.94 + 0.12 * wave * gust * h);
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uLight;
          uniform vec3 uTipLight;
          varying float vH;
          varying vec3 vTint;
          void main() {
            // Dark at the root (blades shade each other), bright and a little yellow at the sunlit tip.
            // Clamped: the blade coordinate can be a hair outside 0..1 at blade edges, and pow() of a negative number would give a broken pixel.
            float hgt = clamp(vH, 0.0, 1.0);
            vec3 col = vTint * (0.34 + 0.9 * hgt);
            col += uTipLight * vTint * hgt * hgt * hgt * 0.5;
            gl_FragColor = vec4(col * uLight, 1.0);
          }`,
        side: THREE.DoubleSide,
      });
    }
    this.grass = new THREE.Mesh(geometry, this.grassMaterial);
    this.grass.frustumCulled = false;
    this.group.add(this.grass);
  }

  // Small islands and cloud puffs far away, for depth when the camera is low (the menu view).
  #buildFar() {
    const rng = mulberry32(99);
    const parts = [];
    const range = (min, max) => min + rng() * (max - min);
    const spots = [[-34, -4, -30, 5], [38, 2, -22, 4], [-30, -9, 26, 3.4], [44, -6, 20, 4.4], [6, 5, -52, 6]];
    for (const [x, y, z, size] of spots) {
      parts.push(finish(new THREE.ConeGeometry(size, size * 1.7, 9), rng, (out, nx, ny, nz, py) => out.copy(col('#7b6a58')).lerp(col('#5f6470'), 0.4), { p: [x, y - size * 0.85, z], r: [Math.PI, rng() * 6, 0] }));
      parts.push(finish(new THREE.CylinderGeometry(size * 1.02, size, size * 0.14, 9), rng, (out) => out.copy(GREENS[0]), { p: [x, y + size * 0.05, z] }));
      for (let i = 0; i < 3; i++) {
        const a = rng() * 6.28;
        const d = range(0, size * 0.6);
        const s = size * range(0.22, 0.34);
        parts.push(finish(new THREE.ConeGeometry(s, s * 2.6, 7), rng, (out) => out.set('#2c6e4a'), { p: [x + Math.cos(a) * d, y + size * 0.12 + s * 1.3, z + Math.sin(a) * d] }));
      }
    }
    const islands = new THREE.Mesh(mergeGeometries(parts, false), this.propMaterial);
    parts.forEach((g) => g.dispose());
    this.group.add(islands);

    const puffs = [];
    for (let i = 0; i < 9; i++) {
      const angle = rng() * Math.PI * 2;
      const r = range(24, 46);
      const cx = Math.cos(angle) * r;
      const cz = Math.sin(angle) * r;
      const cy = range(-9, -2.5);
      const scale = range(2.4, 4.6);
      for (let k = 0; k < 5; k++) {
        puffs.push(finish(lumpy(1, Math.floor(rng() * 1000), 0.2), rng, (out, nx, ny) => out.setScalar(0.78 + 0.22 * Math.max(0, ny)), { p: [cx + range(-1.4, 1.4) * scale, cy + range(-0.2, 0.3) * scale, cz + range(-1.4, 1.4) * scale], s: [scale * range(0.7, 1.2), scale * range(0.45, 0.7), scale * range(0.7, 1.2)] }));
      }
    }
    this.cloudMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
    this.clouds = new THREE.Mesh(mergeGeometries(puffs, false), this.cloudMaterial);
    puffs.forEach((g) => g.dispose());
    this.group.add(this.clouds);
  }

  /**
   * Match the garden to a theme's light.
   * @param {{grass:THREE.Color, tip:THREE.Color, cloud:THREE.Color}} look
   */
  setLook(look) {
    this.grassMaterial.uniforms.uLight.value.copy(look.grass);
    this.grassMaterial.uniforms.uTipLight.value.copy(look.tip);
    this.cloudMaterial.color.copy(look.cloud);
  }

  update(dt, time) {
    this.grassMaterial.uniforms.uTime.value = time;
    this.clouds.rotation.y = time * 0.004;
  }
}
