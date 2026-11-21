// Visual effects: sparks, lightning zaps and beams, shockwave rings, flashes, light columns, energy trails and the loose parts of a robot that pops apart. Everything is pooled and runs on the animation clock, so skipping or slow motion affects effects and robots the same way.
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _side = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------------------------------------------
// Sparks. Positions are computed on the GPU from a start point, a velocity and a birth time, so thousands of sparks cost almost nothing per frame.
class Particles {
  constructor(capacity) {
    this.capacity = capacity;
    this.cursor = 0;
    this.dirty = false;
    const geometry = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.aVel = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.aColor = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.aTime = new THREE.BufferAttribute(new Float32Array(capacity * 2).fill(-1000), 2);
    this.aMisc = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    geometry.setAttribute('position', this.aPos);
    geometry.setAttribute('aVel', this.aVel);
    geometry.setAttribute('aColor', this.aColor);
    geometry.setAttribute('aTime', this.aTime);
    geometry.setAttribute('aMisc', this.aMisc);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aVel;
        attribute vec3 aColor;
        attribute vec2 aTime;
        attribute vec3 aMisc;
        uniform float uTime;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float age = uTime - aTime.x;
          float life = aTime.y;
          float k = clamp(age / max(life, 0.001), 0.0, 1.0);
          float drag = aMisc.z;
          float tt = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
          vec3 p = position + aVel * tt;
          p.y -= 0.5 * aMisc.y * age * age;
          // Sparks that fall on the board come to rest on it instead of sinking through.
          if (abs(p.x) < 4.6 && abs(p.z) < 4.6 && position.y > 0.0) p.y = max(p.y, 0.015);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float alive = step(0.0, age) * step(age, life);
          gl_Position = alive > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
          gl_PointSize = alive * aMisc.x * (1.0 - k * k) * uScale / max(0.1, -mv.z);
          vColor = aColor;
          vAlpha = alive * (1.0 - k);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor * a * vAlpha, a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.layers.enable(1);
    // Nothing is drawn while no spark is alive (the shader moves dead sparks off screen), so the points are skipped until the next emit.
    this.points.visible = false;
    /** Time when the last spark still alive dies. */
    this.aliveUntil = -Infinity;
  }

  /** Spawn one spark. `color` may be brighter than 1 so it blooms. */
  emit(time, position, velocity, color, life, size, gravity = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.aPos.setXYZ(i, position.x, position.y, position.z);
    this.aVel.setXYZ(i, velocity.x, velocity.y, velocity.z);
    this.aColor.setXYZ(i, color.r, color.g, color.b);
    this.aTime.setXY(i, time, life);
    this.aMisc.setXYZ(i, size, gravity, drag);
    this.dirty = true;
    // The shader keeps a spark while 0 <= age <= life.
    this.aliveUntil = Math.max(this.aliveUntil, time + life);
  }

  flush(time, scale) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uScale.value = scale;
    this.points.visible = time <= this.aliveUntil;
    if (!this.dirty) return;
    this.aPos.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aTime.needsUpdate = true;
    this.aMisc.needsUpdate = true;
    this.dirty = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Streaks: camera-facing ribbons between two points. With jitter they are lightning bolts, without jitter they are beams.
const STREAK_POINTS = 14;

class Streak {
  constructor() {
    const count = STREAK_POINTS;
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    const index = [];
    for (let i = 0; i < count; i++) {
      uvs.set([i / (count - 1), 0, i / (count - 1), 1], i * 4);
      if (i < count - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform float uTime;
        void main() {
          // Values are clamped before pow(): at the edge of a shape the interpolated coordinate can be a hair outside 0..1, pow() of a negative number is not a number, and the bloom pass would smear that one bad pixel over the whole screen.
          float c = clamp(1.0 - abs(vUv.y * 2.0 - 1.0), 0.0, 1.0);
          float core = pow(c, 5.0);
          float glow = c * c;
          float flicker = 0.85 + 0.15 * sin(uTime * 90.0 + vUv.x * 40.0);
          vec3 col = (uColor * glow * 2.2 + vec3(1.0) * core * 2.6) * flicker * uAlpha;
          gl_FragColor = vec4(col, glow * uAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
    this.mesh.layers.enable(1);
    this.active = false;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.offsets = new Float32Array(count * 3);
  }

  start(from, to, options) {
    this.from.copy(from);
    this.to.copy(to);
    this.life = options.life ?? 0.25;
    this.age = 0;
    this.width = options.width ?? 0.08;
    this.jitter = options.jitter ?? 0;
    this.reroll = 0;
    this.material.uniforms.uColor.value.copy(options.color ?? WHITE);
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt, camera) {
    if (!this.active) return;
    this.age += dt;
    const k = this.age / this.life;
    if (k >= 1) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    // Re-roll the zigzag about 30 times per second so the bolt crackles.
    this.reroll -= dt;
    if (this.reroll <= 0) {
      this.reroll = 0.033;
      for (let i = 0; i < STREAK_POINTS; i++) {
        const edge = Math.sin((i / (STREAK_POINTS - 1)) * Math.PI);
        this.offsets[i * 3] = rand(-1, 1) * this.jitter * edge;
        this.offsets[i * 3 + 1] = rand(-1, 1) * this.jitter * edge;
        this.offsets[i * 3 + 2] = rand(-1, 1) * this.jitter * edge;
      }
    }
    const envelope = Math.sin(Math.min(1, k * 1.15) * Math.PI);
    const width = this.width * (0.35 + 0.65 * envelope);
    _c.subVectors(this.to, this.from);
    for (let i = 0; i < STREAK_POINTS; i++) {
      const t = i / (STREAK_POINTS - 1);
      _a.copy(this.from).addScaledVector(_c, t);
      _a.x += this.offsets[i * 3];
      _a.y += this.offsets[i * 3 + 1];
      _a.z += this.offsets[i * 3 + 2];
      _b.subVectors(camera.position, _a);
      _side.crossVectors(_c, _b).normalize().multiplyScalar(width);
      this.positions.set([_a.x + _side.x, _a.y + _side.y, _a.z + _side.z, _a.x - _side.x, _a.y - _side.y, _a.z - _side.z], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.material.uniforms.uAlpha.value = Math.min(1, envelope * 1.6);
    this.material.uniforms.uTime.value = this.age;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Shockwave rings that lie on the board and grow outward.
class Ring {
  constructor(geometry) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uK: { value: 0 }, uThickness: { value: 0.12 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uK;
        uniform float uThickness;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float radius = mix(0.08, 0.92, 1.0 - pow(clamp(1.0 - uK, 0.0, 1.0), 3.0));
          float band = smoothstep(uThickness, 0.0, abs(d - radius));
          float a = band * (1.0 - uK) * (1.0 - uK);
          gl_FragColor = vec4(uColor * a * 2.4, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
    this.active = false;
  }

  start(position, options) {
    this.mesh.position.copy(position);
    this.mesh.scale.setScalar(options.size ?? 2);
    this.life = options.life ?? 0.5;
    this.age = 0;
    this.material.uniforms.uColor.value.copy(options.color ?? WHITE);
    this.material.uniforms.uThickness.value = options.thickness ?? 0.12;
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.active) return;
    this.age += dt;
    const k = this.age / this.life;
    if (k >= 1) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    this.material.uniforms.uK.value = k;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Soft round flashes that always face the camera (muzzle flashes, impacts, sparkles).
function makeFlashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  // Four thin rays for a star-like sparkle.
  ctx.globalCompositeOperation = 'lighter';
  for (const angle of [0, Math.PI / 2]) {
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate(angle);
    const ray = ctx.createLinearGradient(-64, 0, 64, 0);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = ray;
    ctx.fillRect(-64, -1.5, 128, 3);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

class Flash {
  constructor(texture) {
    this.material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.visible = false;
    this.sprite.renderOrder = 10;
    this.sprite.layers.enable(1);
    this.active = false;
  }

  start(position, options) {
    this.sprite.position.copy(position);
    this.size = options.size ?? 1;
    this.life = options.life ?? 0.2;
    this.age = 0;
    this.power = options.power ?? 2;
    this.material.color.copy(options.color ?? WHITE).multiplyScalar(this.power);
    this.material.rotation = Math.random() * Math.PI;
    this.active = true;
    this.sprite.visible = true;
  }

  update(dt) {
    if (!this.active) return;
    this.age += dt;
    const k = this.age / this.life;
    if (k >= 1) {
      this.active = false;
      this.sprite.visible = false;
      return;
    }
    const grow = 0.45 + 0.55 * (1 - Math.pow(1 - k, 3));
    this.sprite.scale.setScalar(this.size * grow);
    this.material.opacity = (1 - k) * (1 - k);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Light columns for teleports and promotion.
class Column {
  constructor(geometry) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uAlpha;
        uniform float uTime;
        void main() {
          float rise = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6);
          float streak = 0.6 + 0.4 * sin(vUv.x * 50.0 + uTime * 5.0) * sin(vUv.y * 9.0 - uTime * 9.0);
          float a = max(rise * streak * uAlpha, 0.0);
          gl_FragColor = vec4((uColor * 1.8 + 0.5) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
    this.mesh.layers.enable(1);
    this.active = false;
  }

  start(position, options) {
    this.mesh.position.set(position.x, 0, position.z);
    this.radius = options.radius ?? 0.42;
    this.height = options.height ?? 3;
    this.life = options.life ?? 0.6;
    this.age = 0;
    this.material.uniforms.uColor.value.copy(options.color ?? WHITE);
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.active) return;
    this.age += dt;
    const k = this.age / this.life;
    if (k >= 1) {
      this.active = false;
      this.mesh.visible = false;
      return;
    }
    const envelope = Math.sin(Math.min(1, k) * Math.PI);
    const squeeze = 0.35 + 0.65 * envelope;
    this.mesh.scale.set(this.radius * squeeze, this.height * (0.5 + 0.5 * k), this.radius * squeeze);
    this.material.uniforms.uAlpha.value = envelope;
    this.material.uniforms.uTime.value = this.age;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Energy trail: a ribbon of light that follows a moving robot (the queen's dash).
const TRAIL_POINTS = 22;

class Trail {
  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(TRAIL_POINTS * 2 * 3);
    const uvs = new Float32Array(TRAIL_POINTS * 2 * 2);
    const index = [];
    for (let i = 0; i < TRAIL_POINTS; i++) {
      uvs.set([i / (TRAIL_POINTS - 1), 0, i / (TRAIL_POINTS - 1), 1], i * 4);
      if (i < TRAIL_POINTS - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uAlpha;
        void main() {
          float along = pow(clamp(1.0 - vUv.x, 0.0, 1.0), 1.5);
          float across = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159);
          float a = along * across * uAlpha;
          gl_FragColor = vec4((uColor * 2.0 + vec3(0.6) * across * along) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 7;
    this.mesh.layers.enable(1);
    this.history = [];
    this.active = false;
    this.fading = false;
  }

  start(getPosition, options) {
    this.getPosition = getPosition;
    this.low = options.low ?? 0.1;
    this.high = options.high ?? 1;
    this.material.uniforms.uColor.value.copy(options.color ?? WHITE);
    this.history.length = 0;
    this.alpha = 1;
    this.active = true;
    this.fading = false;
    this.mesh.visible = true;
  }

  stop() {
    this.fading = true;
  }

  update(dt) {
    if (!this.active) return;
    if (!this.fading) {
      const p = this.getPosition(_a);
      this.history.unshift(p.x, p.z);
      if (this.history.length > TRAIL_POINTS * 2) this.history.length = TRAIL_POINTS * 2;
    } else {
      this.alpha -= dt * 4;
      if (this.alpha <= 0) {
        this.active = false;
        this.mesh.visible = false;
        return;
      }
    }
    const count = this.history.length / 2;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const j = Math.min(i, count - 1);
      const x = this.history[j * 2];
      const z = this.history[j * 2 + 1];
      this.positions.set([x, this.low, z, x, this.high, z], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.material.uniforms.uAlpha.value = this.alpha * 0.8;
  }
}

// ---------------------------------------------------------------------------------------------------------------
export class Effects {
  /**
   * @param {import('../stage.js').Stage} stage
   */
  constructor(stage) {
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.name = 'effects';
    stage.scene.add(this.group);
    this.time = 0;
    /** Pixels per world unit at distance 1; set by the app from the camera so sparks keep their size on any screen. */
    this.pixelScale = 600;

    /** @type {Particles|null} */
    this.particles = null;
    this.density = 0;
    this.#buildParticles();
    stage.onQualityChange.add(() => this.#buildParticles());

    this.streaks = Array.from({ length: 5 }, () => new Streak());
    const ringGeometry = new THREE.PlaneGeometry(1, 1);
    ringGeometry.rotateX(-Math.PI / 2);
    this.rings = Array.from({ length: 8 }, () => new Ring(ringGeometry));
    const flashTexture = makeFlashTexture();
    this.flashes = Array.from({ length: 10 }, () => new Flash(flashTexture));
    const columnGeometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
    columnGeometry.translate(0, 0.5, 0);
    this.columns = Array.from({ length: 4 }, () => new Column(columnGeometry));
    this.trails = Array.from({ length: 2 }, () => new Trail());
    for (const item of this.streaks) this.group.add(item.mesh);
    for (const item of this.rings) this.group.add(item.mesh);
    for (const item of this.flashes) this.group.add(item.sprite);
    for (const item of this.columns) this.group.add(item.mesh);
    for (const item of this.trails) this.group.add(item.mesh);

    /** @type {Array<{object:THREE.Object3D, velocity:THREE.Vector3, spin:THREE.Vector3, age:number, life:number, radius:number, onDone?:()=>void}>} */
    this.debris = [];
    this.debrisGroup = new THREE.Group();
    this.group.add(this.debrisGroup);

    this.projectileGeometry = new THREE.SphereGeometry(1, 14, 10);
    /** @type {Set<THREE.Mesh>} */
    this.projectiles = new Set();
  }

  // The spark pool follows the quality level: a lower level has fewer sparks in a burst and a smaller pool. A change of the level starts a new pool, so the sparks that fly at that moment are dropped.
  #buildParticles() {
    const density = this.stage.quality.particles;
    if (this.particles && density === this.density) return;
    if (this.particles) {
      this.group.remove(this.particles.points);
      this.particles.points.geometry.dispose();
      this.particles.material.dispose();
    }
    this.density = density;
    this.particles = new Particles(Math.round(2600 * density));
    this.group.add(this.particles.points);
  }

  #free(pool) {
    return pool.find((item) => !item.active) ?? pool[0];
  }

  /**
   * A burst of sparks.
   * @param {THREE.Vector3} position
   * @param {number} count
   * @param {{color?:THREE.Color, color2?:THREE.Color, speed?:number, up?:number, life?:number, size?:number, gravity?:number, drag?:number, spread?:number, power?:number, direction?:THREE.Vector3}} [options]
   */
  burst(position, count, options = {}) {
    const { color = WHITE, color2 = null, speed = 2, up = 0.4, life = 0.6, size = 0.05, gravity = 4, drag = 1.2, spread = 0.05, power = 2.2, direction = null } = options;
    const n = Math.max(1, Math.round(count * this.density));
    const tint = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // Random direction on a sphere, optionally pulled toward a main direction.
      const u = rand(-1, 1);
      const a = rand(0, Math.PI * 2);
      const s = Math.sqrt(1 - u * u);
      _a.set(Math.cos(a) * s, u, Math.sin(a) * s);
      if (direction) _a.multiplyScalar(0.55).add(direction).normalize();
      _a.multiplyScalar(speed * rand(0.35, 1));
      _a.y += up * speed;
      _b.set(position.x + rand(-spread, spread), position.y + rand(-spread, spread), position.z + rand(-spread, spread));
      tint.copy(color2 && Math.random() < 0.5 ? color2 : color).multiplyScalar(power * rand(0.6, 1.2));
      this.particles.emit(this.time, _b, _a, tint, life * rand(0.5, 1.1), size * rand(0.5, 1.3), gravity, drag);
    }
  }

  /** One spark with full control (used for trails behind moving things). */
  spark(position, velocity, color, life, size, gravity = 0, drag = 0, power = 2) {
    this.particles.emit(this.time, position, velocity, _colorScratch.copy(color).multiplyScalar(power), life, size, gravity, drag);
  }

  /** Lightning zap between two points. */
  bolt(from, to, options = {}) {
    this.#free(this.streaks).start(from, to, { life: 0.28, width: 0.07, jitter: 0.16, ...options });
  }

  /** Straight energy beam between two points. */
  beam(from, to, options = {}) {
    this.#free(this.streaks).start(from, to, { life: 0.45, width: 0.13, jitter: 0, ...options });
  }

  /** Shockwave ring on the board. */
  ring(position, options = {}) {
    _a.set(position.x, (position.y ?? 0) + 0.03, position.z);
    this.#free(this.rings).start(_a, options);
  }

  /** Round flash that faces the camera. */
  flash(position, options = {}) {
    this.#free(this.flashes).start(position, options);
  }

  /** Column of light rising from a tile. */
  column(position, options = {}) {
    this.#free(this.columns).start(position, options);
  }

  /**
   * Start a ribbon trail behind a moving thing. Returns a handle; call stop() to let it fade.
   * @param {(target:THREE.Vector3)=>THREE.Vector3} getPosition
   */
  trail(getPosition, options = {}) {
    const trail = this.#free(this.trails);
    trail.start(getPosition, options);
    return trail;
  }

  /** Create a small glowing ball (cannon shot). The caller moves it and must call removeProjectile when done. */
  createProjectile(color, radius = 0.07) {
    const mesh = new THREE.Mesh(this.projectileGeometry, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3.2) }));
    mesh.scale.setScalar(radius);
    mesh.layers.enable(1);
    this.group.add(mesh);
    this.projectiles.add(mesh);
    return mesh;
  }

  removeProjectile(mesh) {
    if (!this.projectiles.delete(mesh)) return;
    this.group.remove(mesh);
    mesh.material.dispose();
  }

  /** Remove things an interrupted animation may have left in the air (cannon shots, loose parts). */
  clearTransient() {
    for (const mesh of [...this.projectiles]) this.removeProjectile(mesh);
    for (const trail of this.trails) trail.stop();
    this.clearDebris();
  }

  /**
   * Turn an object into a loose part that flies, bounces on the board and then shrinks away.
   * @param {THREE.Object3D} object It is re-parented into the effects layer, keeping its place in the world.
   */
  addDebris(object, velocity, spin, options = {}) {
    this.debrisGroup.attach(object);
    this.debris.push({ object, velocity: velocity.clone(), spin: spin.clone(), age: 0, life: options.life ?? 1.5, radius: options.radius ?? 0.08, onDone: options.onDone });
  }

  /** Remove every loose part right now (used when the board is reset). */
  clearDebris() {
    for (const piece of this.debris) {
      this.debrisGroup.remove(piece.object);
      piece.onDone?.();
    }
    this.debris.length = 0;
  }

  update(dt, camera) {
    this.time += dt;
    this.particles.flush(this.time, this.pixelScale);
    for (const item of this.streaks) item.update(dt, camera);
    for (const item of this.rings) item.update(dt);
    for (const item of this.flashes) item.update(dt);
    for (const item of this.columns) item.update(dt);
    for (const item of this.trails) item.update(dt);

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];
      piece.age += dt;
      const o = piece.object;
      piece.velocity.y -= 9.5 * dt;
      o.position.addScaledVector(piece.velocity, dt);
      o.rotation.x += piece.spin.x * dt;
      o.rotation.y += piece.spin.y * dt;
      o.rotation.z += piece.spin.z * dt;
      const onBoard = Math.abs(o.position.x) < 4.7 && Math.abs(o.position.z) < 4.7;
      if (onBoard && o.position.y < piece.radius && piece.velocity.y < 0) {
        // Bounce, losing energy each time.
        o.position.y = piece.radius;
        piece.velocity.y *= -0.42;
        piece.velocity.x *= 0.7;
        piece.velocity.z *= 0.7;
        piece.spin.multiplyScalar(0.6);
      }
      const fade = THREE.MathUtils.clamp((piece.life - piece.age) / 0.35, 0, 1);
      if (fade < 1) o.scale.multiplyScalar(Math.max(0.0001, fade / Math.max(0.0001, piece.lastFade ?? 1)));
      piece.lastFade = fade;
      if (piece.age >= piece.life || o.position.y < -12) {
        this.debrisGroup.remove(o);
        this.debris.splice(i, 1);
        piece.onDone?.();
      }
    }
  }
}

const _colorScratch = new THREE.Color();
