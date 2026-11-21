// The world around the board. There are two worlds: the garden (a floating meadow island under an open sky) and space (a galaxy below a ringed arena). This class owns the lights, the baked sky, the reflection map that makes the robot shells shine, and the small floating lights (pollen, fireflies, star dust). A board theme picks the world and its colors.
import * as THREE from 'three';
import { TEAMS, BOARD_THEMES, DEFAULT_THEME } from './palette.js';
import { Garden } from './garden.js';

const NOISE_GLSL = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec3(17.1, 3.7, 9.2);
      a *= 0.5;
    }
    return s;
  }`;

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Space sky: a slow spiral galaxy seen from above. The arena floats over its bright core. It is symmetric around the vertical axis, which lets the whole sky rotate slowly for free.
const SPACE_SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uCore;
  uniform vec3 uArm;
  uniform vec3 uFar;
  ${NOISE_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uMid * 0.34, uTop, smoothstep(-0.5, 0.8, h));

    // Galaxy below: r is 0 straight down and 1 at the horizon. Two spiral arms, warped by noise, with bright knots and dark dust lanes.
    float r = acos(clamp(-d.y, -1.0, 1.0)) / 1.5708;
    float th = atan(d.z, d.x);
    float n1 = fbm(d * 3.0);
    float n2 = fbm(d * 6.9 + 7.0);
    float swirl = th * 2.0 - log(r + 0.05) * 5.2 + (n1 - 0.5) * 4.4;
    float arms = smoothstep(0.3, 0.98, 0.5 + 0.5 * sin(swirl));
    float fil = n2 * n2 * 2.4;
    float disk = exp(-r * 1.55);
    vec3 galaxy = uArm * arms * (0.35 + fil) * disk * 2.3;
    galaxy += mix(uArm, uMid, 0.5) * disk * 0.22;
    float knots = smoothstep(0.6, 0.92, fbm(d * 10.0 + 2.0)) * arms;
    galaxy += uCore * knots * disk * 1.5;
    float dust = smoothstep(0.3, 0.72, fbm(d * 4.6 - 3.0 + vec3(sin(swirl) * 0.35)));
    galaxy *= mix(0.2, 1.0, dust);
    galaxy += uCore * exp(-r * r * 20.0) * 1.3;
    galaxy += uFar * 2.2 * arms * fil * exp(-(r - 0.8) * (r - 0.8) * 7.0);
    col += galaxy * smoothstep(1.35, 0.1, r);

    // Thin colored clouds higher up.
    float wisps = fbm(d * 2.1 + 11.0);
    col += uFar * wisps * wisps * wisps * 1.6 * smoothstep(-0.4, 0.5, h);
    float wisps2 = fbm(d * 3.4 - 5.0);
    col += uArm * wisps2 * wisps2 * wisps2 * wisps2 * 0.5 * smoothstep(-0.2, 0.7, h);

    // Stars: a 3D grid of cells on the sky sphere, a few of them lit.
    vec3 p = d * 190.0;
    vec3 ip = floor(p);
    float rnd = hash13(ip);
    float star = step(0.9972, rnd) * smoothstep(0.42, 0.0, length(fract(p) - 0.5));
    col += mix(vec3(0.75, 0.86, 1.0), vec3(1.0, 0.86, 0.72), hash13(ip + 7.0)) * star * (0.5 + 1.6 * fract(rnd * 431.0));
    vec3 p2 = d * 70.0;
    col += vec3(0.9, 0.95, 1.0) * step(0.9988, hash13(floor(p2) + 3.3)) * smoothstep(0.3, 0.0, length(fract(p2) - 0.5)) * 1.8;

    col += (hash13(d * 913.0) - 0.5) * 0.012;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }`;

// Garden sky: a blue-to-warm gradient, a soft sun, puffy clouds around the horizon and a sea of clouds below the island. With uStars above zero it becomes a dusk sky.
const GARDEN_SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSun;
  uniform vec3 uCloudLight;
  uniform vec3 uCloudShade;
  uniform vec3 uSunDir;
  uniform float uStars;
  ${NOISE_GLSL}
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, max(h, 0.0)), 0.5));
    if (h < 0.0) col = mix(uHorizon, uHaze, smoothstep(0.0, -0.75, h));

    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSun * (pow(sd, 420.0) * 5.0 + pow(sd, 28.0) * 0.4 + pow(sd, 5.0) * 0.14);

    // Stars for the dusk sky.
    vec3 p = d * 170.0;
    float rnd = hash13(floor(p));
    col += vec3(0.9, 0.93, 1.0) * uStars * step(0.997, rnd) * smoothstep(0.42, 0.0, length(fract(p) - 0.5)) * smoothstep(0.05, 0.5, h) * (0.6 + 1.2 * fract(rnd * 431.0));

    // Puffy clouds in a band around the horizon.
    vec2 q = d.xz / (abs(h) * 1.6 + 0.3);
    float c1 = fbm(vec3(q * 1.5, 1.7));
    float band = smoothstep(0.62, 0.02, abs(h - 0.06));
    float cloud = smoothstep(0.46, 0.78, c1) * band;
    // Thin high clouds.
    float c2 = fbm(vec3(d.xz * 2.6 / max(h + 0.45, 0.05), 7.3));
    float wisp = smoothstep(0.56, 0.9, c2) * smoothstep(0.1, 0.45, h) * 0.5;
    vec3 cloudCol = mix(uCloudShade, uCloudLight, smoothstep(0.42, 0.85, c1)) + uSun * pow(sd, 6.0) * 0.35;
    col = mix(col, cloudCol, clamp(cloud + wisp, 0.0, 1.0));

    // Sea of clouds far below the island.
    float sea = fbm(vec3(d.xz * 1.7 / max(0.22 - h, 0.05), 3.1));
    vec3 seaCol = mix(uCloudShade, uCloudLight, smoothstep(0.3, 0.75, sea));
    col = mix(col, seaCol, smoothstep(-0.1, -0.55, h) * (0.55 + 0.4 * smoothstep(0.35, 0.7, sea)));

    col += (hash13(d * 913.0) - 0.5) * 0.01;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }`;

// Segmented light rings around the space arena, cyan on the white team's side and orange on the black team's side.
const RingShader = {
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    varying vec2 vUv;
    void main() {
      vPos = position;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vPos;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uSpeed;
    uniform float uCount;
    uniform float uPower;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    void main() {
      float ang = atan(vPos.y, vPos.x);
      float seg = fract(ang / 6.28318 * uCount + uTime * uSpeed);
      float dash = smoothstep(0.0, 0.06, seg) * smoothstep(0.72, 0.6, seg);
      float pulse = 0.6 + 0.4 * sin(ang * 3.0 - uTime * uSpeed * 9.0);
      float side = smoothstep(-0.75, 0.75, sin(ang));
      vec3 col = mix(uColorA, uColorB, side);
      float edge = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
      float a = (0.12 + dash * pulse) * edge;
      gl_FragColor = vec4(col * a * uPower, a);
    }`,
};

// Small drifting lights: star dust in space, pollen by day and fireflies at dusk in the garden.
const MoteShader = {
  vertexShader: /* glsl */ `
    attribute vec4 aSeed;
    uniform float uTime;
    uniform float uScale;
    uniform vec2 uRange;
    varying float vTwinkle;
    varying float vMix;
    void main() {
      vec3 p = position;
      float t = uTime * (0.05 + aSeed.x * 0.08);
      p.x += sin(t * 2.0 + aSeed.y * 40.0) * 0.6;
      p.z += cos(t * 1.7 + aSeed.z * 40.0) * 0.6;
      p.y = uRange.x + mod(p.y - uRange.x + uTime * (0.05 + aSeed.w * 0.09), uRange.y);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uScale * (0.5 + aSeed.x) / max(0.1, -mv.z);
      vTwinkle = 0.45 + 0.55 * sin(uTime * (0.8 + aSeed.y * 2.0) + aSeed.z * 30.0);
      vMix = aSeed.w;
    }`,
  fragmentShader: /* glsl */ `
    varying float vTwinkle;
    varying float vMix;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uPower;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d);
      a *= a;
      gl_FragColor = vec4(mix(uColorA, uColorB, vMix) * a * vTwinkle * uPower, a);
    }`,
};

function makeMotes(count, place, range, colorA, colorB) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    positions.set(place(rand), i * 3);
    seeds.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
  const material = new THREE.ShaderMaterial({
    ...MoteShader,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 60 },
      uRange: { value: new THREE.Vector2(range[0], range[1] - range[0]) },
      uColorA: { value: colorA.clone() },
      uColorB: { value: colorB.clone() },
      uPower: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -4;
  return points;
}

export class Environment {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    this.scene = stage.scene;
    this.themeName = null;
    this.world = null;
    /** Only used by the space world. */
    this.spaceGroup = new THREE.Group();
    this.spaceGroup.name = 'space';
    this.scene.add(this.spaceGroup);
    /** @type {Garden|null} Built the first time a garden theme is shown. */
    this.garden = null;

    this.#buildLights();
    this.#buildRings();
    this.spaceMotes = makeMotes(
      220,
      (rand) => {
        // Outside the playing field, so the dust never floats in front of the pieces.
        const angle = rand() * Math.PI * 2;
        const radius = 6.5 + rand() * 9;
        return [Math.cos(angle) * radius, -6 + rand() * 9, Math.sin(angle) * radius];
      },
      [-6, 3],
      TEAMS.w.glowSoft,
      TEAMS.b.glowSoft,
    );
    this.spaceGroup.add(this.spaceMotes);
    this.setTheme(DEFAULT_THEME);

    stage.onQualityChange.add(() => {
      this.#applyShadowQuality();
      this.setTheme(this.themeName, true);
    });
  }

  #buildLights() {
    // Soft base light so nothing is ever fully black.
    this.hemi = new THREE.HemisphereLight(0xa8c4ff, 0x2a1840, 0.3);
    this.scene.add(this.hemi);

    // Key light from the front left, the only shadow caster. In the garden it is the sun.
    this.key = new THREE.DirectionalLight(0xfff4e6, 1.75);
    this.key.position.set(-5.5, 11, 6.5);
    this.key.target.position.set(0, 0, 0);
    this.key.castShadow = true;
    const cam = this.key.shadow.camera;
    cam.left = -6.2;
    cam.right = 6.2;
    cam.top = 6.2;
    cam.bottom = -6.2;
    cam.near = 2;
    cam.far = 30;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.radius = 5;
    this.scene.add(this.key, this.key.target);

    // The duel lights: cyan from the white team's side, orange from the black team's side. They rim-light every robot in its enemy's color.
    this.rimWhite = new THREE.DirectionalLight(TEAMS.w.glow, 1.2);
    this.rimWhite.position.set(2.5, 2.2, 9);
    this.rimBlack = new THREE.DirectionalLight(TEAMS.b.glow, 1.25);
    this.rimBlack.position.set(-2.5, 2.2, -9);
    this.scene.add(this.rimWhite, this.rimBlack);
    // Layer 1 is the floor reflection pass; lights must be on it to light the mirrored robots.
    for (const light of [this.hemi, this.key, this.rimWhite, this.rimBlack]) light.layers.enable(1);
    this.#applyShadowQuality();
  }

  #applyShadowQuality() {
    const q = this.stage.quality;
    this.key.castShadow = q.shadows;
    if (q.shadows && this.key.shadow.mapSize.x !== q.shadowSize) {
      this.key.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
  }

  #buildRings() {
    this.rings = [];
    const specs = [
      { radius: 8.3, width: 0.16, y: -1.0, count: 36, speed: 0.012, power: 2.2 },
      { radius: 10.6, width: 0.1, y: -2.1, count: 60, speed: -0.008, power: 1.6 },
      { radius: 13.4, width: 0.22, y: -3.6, count: 24, speed: 0.005, power: 1.2 },
    ];
    for (const spec of specs) {
      const geometry = new THREE.RingGeometry(spec.radius - spec.width / 2, spec.radius + spec.width / 2, 160, 1);
      // RingGeometry maps uv over the square bounds; remap v to 0..1 across the ring's width for a soft edge.
      const pos = geometry.attributes.position;
      const uv = geometry.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, 0, (r - (spec.radius - spec.width / 2)) / spec.width);
      }
      const material = new THREE.ShaderMaterial({
        ...RingShader,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: spec.speed },
          uCount: { value: spec.count },
          uPower: { value: spec.power },
          uColorA: { value: TEAMS.w.glow.clone() },
          uColorB: { value: TEAMS.b.glow.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = spec.y;
      ring.renderOrder = -5;
      this.spaceGroup.add(ring);
      this.rings.push(ring);
    }
  }

  #skyMaterial(theme) {
    const sky = theme.sky;
    if (theme.world === 'garden') {
      return new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: GARDEN_SKY_FRAGMENT,
        side: THREE.BackSide,
        uniforms: {
          uZenith: { value: sky.zenith },
          uHorizon: { value: sky.horizon },
          uHaze: { value: sky.haze },
          uSun: { value: sky.sun },
          uCloudLight: { value: sky.cloudLight },
          uCloudShade: { value: sky.cloudShade },
          uSunDir: { value: new THREE.Vector3(...sky.sunDir) },
          uStars: { value: sky.stars },
        },
      });
    }
    return new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SPACE_SKY_FRAGMENT,
      side: THREE.BackSide,
      uniforms: { uTop: { value: sky.top }, uMid: { value: sky.mid }, uCore: { value: sky.core }, uArm: { value: sky.arm }, uFar: { value: sky.far } },
    });
  }

  // The reflection map. Space uses a small "photo studio" (a dark room with a big soft light overhead and one colored strip per team). The garden uses its own sky over a green floor, plus a soft overhead light for clean highlights on the shells.
  #bakeReflections(theme) {
    const studio = new THREE.Scene();
    const disposables = [];
    const add = (mesh) => {
      studio.add(mesh);
      disposables.push(mesh);
    };
    const panel = (w, h, color, intensity, position, lookAt) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
      mesh.position.set(...position);
      mesh.lookAt(...lookAt);
      add(mesh);
    };
    if (theme.world === 'garden') {
      add(new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), this.#skyMaterial(theme)));
      const floor = new THREE.Mesh(new THREE.CircleGeometry(38, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#4f8a3a').multiply(theme.lights.grass).multiplyScalar(0.7) }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.5;
      add(floor);
      panel(20, 12, theme.lights.key, theme.sky.stars > 0 ? 2.2 : 3.6, [-6, 22, 6], [0, 0, 0]);
      panel(30, 4, TEAMS.w.glow, 1.6, [0, 2.5, 26], [0, 2, 0]);
      panel(30, 4, TEAMS.b.glow, 1.6, [0, 2.5, -26], [0, 2, 0]);
    } else {
      add(
        new THREE.Mesh(
          new THREE.SphereGeometry(40, 32, 16),
          new THREE.ShaderMaterial({
            side: THREE.BackSide,
            vertexShader: SKY_VERTEX,
            fragmentShader: 'varying vec3 vDir; void main(){ float h = normalize(vDir).y; vec3 c = mix(vec3(0.05,0.03,0.09), vec3(0.03,0.05,0.10), smoothstep(-0.6,0.6,h)); c += vec3(0.10,0.12,0.2) * smoothstep(0.2,1.0,h); gl_FragColor = vec4(c,1.0); }',
          }),
        ),
      );
      panel(22, 14, '#ffffff', 5.0, [0, 22, 2], [0, 0, 0]);
      panel(10, 5, '#fff1e0', 7.0, [-16, 15, 12], [0, 0, 0]);
      panel(30, 5, TEAMS.w.glow, 4.5, [0, 3, 26], [0, 2, 0]);
      panel(30, 5, TEAMS.b.glow, 4.5, [0, 3, -26], [0, 2, 0]);
      panel(6, 10, '#bcd0ff', 2.2, [26, 8, 0], [0, 2, 0]);
      panel(6, 10, '#d8c0ff', 1.8, [-26, 8, 0], [0, 2, 0]);
    }
    const pmrem = new THREE.PMREMGenerator(this.stage.renderer);
    const target = pmrem.fromScene(studio, 0.035);
    pmrem.dispose();
    for (const mesh of disposables) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
  }

  #bakeSky(theme) {
    const size = this.stage.quality.skySize;
    if (!this.skyTarget || this.skyTarget.width !== size) {
      this.skyTarget?.dispose();
      this.skyTarget = new THREE.WebGLCubeRenderTarget(size, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, generateMipmaps: false });
    }
    const material = this.#skyMaterial(theme);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), material);
    const bakeScene = new THREE.Scene();
    bakeScene.add(sphere);
    new THREE.CubeCamera(1, 100, this.skyTarget).update(this.stage.renderer, bakeScene);
    sphere.geometry.dispose();
    material.dispose();
    this.scene.background = this.skyTarget.texture;
  }

  /** Switch to a board theme: world, sky, reflections and light. */
  setTheme(name, force = false) {
    const key = BOARD_THEMES[name] ? name : DEFAULT_THEME;
    if (!force && key === this.themeName) return;
    const theme = BOARD_THEMES[key];
    this.themeName = key;
    this.world = theme.world;

    if (theme.world === 'garden' && !this.garden) {
      this.garden = new Garden(this.stage);
      this.scene.add(this.garden.group);
      this.gardenMotes = makeMotes(
        150,
        (rand) => {
          const angle = rand() * Math.PI * 2;
          const radius = 5.6 + rand() * 7;
          return [Math.cos(angle) * radius, 0.2 + rand() * 2.6, Math.sin(angle) * radius];
        },
        [0.15, 2.9],
        new THREE.Color('#fff6c8'),
        new THREE.Color('#d8ff9a'),
      );
      this.garden.group.add(this.gardenMotes);
    }
    if (this.garden) this.garden.group.visible = theme.world === 'garden';
    this.spaceGroup.visible = theme.world === 'space';

    const lights = theme.lights;
    this.hemi.color.copy(lights.hemiSky);
    this.hemi.groundColor.copy(lights.hemiGround);
    this.hemi.intensity = lights.hemi;
    this.key.color.copy(lights.key);
    this.key.intensity = lights.keyPower;
    this.rimWhite.intensity = lights.rim;
    this.rimBlack.intensity = lights.rim * 1.04;
    this.scene.environmentIntensity = lights.env;
    this.scene.backgroundIntensity = lights.background;
    this.scene.backgroundRotation.y = 0;
    this.stage.bloomPass.strength = lights.bloom;
    if (theme.world === 'garden') {
      this.garden.setLook(lights);
      this.gardenMotes.material.uniforms.uPower.value = lights.motes;
    } else {
      this.spaceMotes.material.uniforms.uPower.value = lights.motes * 0.9;
    }

    this.#bakeSky(theme);
    this.#bakeReflections(theme);
  }

  update(dt, time) {
    if (this.world === 'space') {
      for (const ring of this.rings) ring.material.uniforms.uTime.value = time;
      this.spaceMotes.material.uniforms.uTime.value = time;
      this.spaceMotes.material.uniforms.uScale.value = this.stage.height * 0.085;
      // The sky turns very slowly around the vertical axis: the galaxy below the arena rotates.
      this.scene.backgroundRotation.y = time * 0.006;
    } else if (this.garden) {
      this.garden.update(dt, time);
      this.gardenMotes.material.uniforms.uTime.value = time;
      this.gardenMotes.material.uniforms.uScale.value = this.stage.height * 0.05;
    }
  }
}
