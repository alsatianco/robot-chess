// The floating arena: the platform, the 64 tiles, the glowing tile highlights (legal moves, last move, check), the coordinates, the coach arrows and the mirror-like floor reflection.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOARD_THEMES, DEFAULT_THEME, BOARD_COLORS, DEFAULT_BOARD_COLORS, TEAMS, FX_COLORS, tileColors } from './palette.js';
import { squareToWorld, squareIndex, indexToSquare, isDarkSquare, FILES } from './coords.js';
import { mirrorRegion } from './mirror-region.js';

const TILE_SIZE = 0.955;
const TILE_HEIGHT = 0.16;
const FRAME_HALF = 4.64;
const FRAME_TOP = 0.03;
/** Half the side of the mirror floor: it covers the 8 by 8 tiles. */
const MIRROR_HALF = 4;

const _clearColor = new THREE.Color();
const _frustum = new THREE.Frustum();
const _viewProjection = new THREE.Matrix4();

// The same test three.js makes before it draws an object (and so before it runs the object's onBeforeRender): the object and all its parents are visible, it is on a layer the camera sees, and it is inside the camera's view.
function isDrawn(object, camera) {
  for (let o = object; o; o = o.parent) {
    if (!o.visible) return false;
  }
  if (!object.layers.test(camera.layers)) return false;
  if (!object.frustumCulled) return true;
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_viewProjection, THREE.WebGLCoordinateSystem, camera.reversedDepth);
  return object.intersectsFrustum(_frustum);
}

/** Mark shapes drawn on a tile. */
export const MARK = { NONE: 0, DOT: 1, RING: 2, BRACKET: 3 };

/** Highlight layers from the lowest to the highest priority. For each tile the highest layer that sets a fill (or a mark) wins. */
const LAYER_ORDER = ['lastMove', 'hint', 'coach', 'check', 'selected', 'legal', 'hover'];

function roundedSquareShape(half, radius) {
  const shape = new THREE.Shape();
  shape.moveTo(-half + radius, -half);
  shape.lineTo(half - radius, -half);
  shape.absarc(half - radius, -half + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(half, half - radius);
  shape.absarc(half - radius, half - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-half + radius, half);
  shape.absarc(-half + radius, half - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-half, -half + radius);
  shape.absarc(-half + radius, -half + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function squarePath(half) {
  const path = new THREE.Path();
  path.moveTo(-half, -half);
  path.lineTo(-half, half);
  path.lineTo(half, half);
  path.lineTo(half, -half);
  path.lineTo(-half, -half);
  return path;
}

// Strip lights on the platform. Cyan on the white team's side (+z), orange on the black team's side (-z).
const TrimShader = {
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vWorld;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uPower;
    uniform float uTime;
    void main() {
      float side = smoothstep(-3.2, 3.2, vWorld.z);
      vec3 col = mix(uColorB, uColorA, side);
      float flow = 0.82 + 0.18 * sin((vWorld.x + vWorld.z) * 2.2 - uTime * 1.3);
      gl_FragColor = vec4(col * uPower * flow, 1.0);
    }`,
};

const HighlightShader = {
  vertexShader: /* glsl */ `
    attribute vec4 aFill;
    attribute vec4 aMark;
    attribute float aPulse;
    varying vec2 vP;
    varying vec4 vFill;
    varying vec4 vMark;
    varying float vPulse;
    void main() {
      vP = uv - 0.5;
      vFill = aFill;
      vMark = aMark;
      vPulse = aPulse;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vP;
    varying vec4 vFill;
    varying vec4 vMark;
    varying float vPulse;
    uniform float uTime;
    float sdRoundBox(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }
    void main() {
      float box = sdRoundBox(vP, vec2(0.465), 0.07);
      float inside = smoothstep(0.004, -0.012, box);
      float edge = smoothstep(-0.11, -0.005, box);
      float pulse = mix(1.0, 0.55 + 0.45 * sin(uTime * 5.5), vPulse);
      // Tile tint: a soft wash with a brighter frame. Drawn with normal blending so it shows on light tiles as well as dark ones.
      float fillA = vFill.a * (0.3 + 0.6 * edge * edge) * pulse;

      float d = length(vP);
      float m = 0.0;
      if (vMark.x > 0.5 && vMark.x < 1.5) {
        // Dot: an empty square the selected piece can move to.
        float breathe = 0.012 * sin(uTime * 3.0 + vP.x * 3.0);
        m = smoothstep(0.012, -0.012, d - 0.125 - breathe) + 0.4 * smoothstep(0.03, 0.0, abs(d - 0.2) - 0.012);
      } else if (vMark.x > 1.5 && vMark.x < 2.5) {
        // Ring: a piece that can be captured.
        float spin = atan(vP.y, vP.x) * 4.0 + uTime * 2.0;
        m = smoothstep(0.02, 0.0, abs(d - 0.415) - 0.03) * (0.8 + 0.2 * sin(spin));
      } else if (vMark.x > 2.5) {
        // Corner brackets: "move here" in the tutorial and for hints.
        vec2 a = abs(vP);
        float corner = step(0.26, min(a.x, a.y)) * step(max(a.x, a.y), 0.44) * step(0.385, max(a.x, a.y));
        m = corner * (0.75 + 0.25 * sin(uTime * 4.0));
      }
      m = clamp(m, 0.0, 1.0);
      float alpha = clamp(max(fillA, m * 0.95), 0.0, 1.0) * inside;
      if (alpha < 0.004) discard;
      // Colors go a little above 1 so marks pick up a soft glow from the bloom pass.
      vec3 col = mix(vFill.rgb * 1.15, vMark.yzw * 1.5, m);
      gl_FragColor = vec4(col, alpha);
    }`,
};

// Added on top of the tiles: the mirrored scene, stronger at flat viewing angles and on dark tiles.
const ReflectionShader = {
  name: 'ArenaReflection',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uStrength: { value: 0.5 },
    uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv4;
    varying vec3 vWorld;
    void main() {
      vUv4 = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform vec2 uTexel;
    varying vec4 vUv4;
    varying vec3 vWorld;
    void main() {
      // Five taps in a small cross: a slightly soft mirror looks like polished stone and hides stair-steps on small bright lights.
      vec2 uv = vUv4.xy / vUv4.w;
      vec2 px = uTexel * 1.3;
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.36;
      refl += texture2D(tDiffuse, uv + vec2(px.x, px.y)).rgb * 0.16;
      refl += texture2D(tDiffuse, uv + vec2(-px.x, px.y)).rgb * 0.16;
      refl += texture2D(tDiffuse, uv + vec2(px.x, -px.y)).rgb * 0.16;
      refl += texture2D(tDiffuse, uv + vec2(-px.x, -px.y)).rgb * 0.16;
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = mix(0.35, 1.0, pow(1.0 - clamp(v.y, 0.0, 1.0), 2.0));
      vec2 cell = floor(vWorld.xz + 4.0);
      float dark = mod(cell.x + cell.y, 2.0);
      vec2 f = abs(fract(vWorld.xz) - 0.5);
      float gap = smoothstep(0.478, 0.46, max(f.x, f.y));
      float k = uStrength * fres * mix(0.34, 1.0, dark) * gap;
      gl_FragColor = vec4(refl * k, 1.0);
    }`,
};

const ArrowShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform vec3 uColor;
    uniform float uTime;
    uniform float uAlpha;
    void main() {
      float flow = 0.7 + 0.3 * sin(vUv.x * 22.0 - uTime * 7.0);
      float grow = smoothstep(0.0, 0.12, vUv.x);
      gl_FragColor = vec4(uColor * 1.7 * flow * grow * uAlpha, 0.85 * uAlpha * grow);
    }`,
};

export class Arena {
  /** @param {import('./stage.js').Stage} stage */
  constructor(stage) {
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.name = 'arena';
    stage.scene.add(this.group);
    this.themeName = DEFAULT_THEME;
    this.boardColors = DEFAULT_BOARD_COLORS;
    this.orientation = 'w';
    this.coordinatesVisible = true;
    this.time = 0;

    /** @type {Map<string, Map<string, object>>} */
    this.layers = new Map(LAYER_ORDER.map((name) => [name, new Map()]));
    this.highlightsDirty = true;
    /** The mirror pass this arena adds to `stage.prePasses` while the floor reflection is on. */
    this.reflectionPass = null;

    this.#buildPlatform();
    this.#buildTiles();
    this.#buildHighlights();
    this.#buildCoordinates();
    this.#buildArrows();
    this.#applyReflection();
    this.setTheme(this.themeName);

    stage.onQualityChange.add(() => this.#applyReflection());
    if (typeof document !== 'undefined' && document.fonts?.ready) document.fonts.ready.then(() => this.#drawCoordinateAtlas());
  }

  #buildPlatform() {
    this.frameMaterial = new THREE.MeshStandardMaterial({ color: 0x161b2c, roughness: 0.38, metalness: 0.85 });
    this.hullMaterial = new THREE.MeshStandardMaterial({ color: 0x0e1220, roughness: 0.55, metalness: 0.7 });
    this.trimMaterial = new THREE.ShaderMaterial({
      ...TrimShader,
      uniforms: {
        uColorA: { value: TEAMS.w.glow.clone() },
        uColorB: { value: TEAMS.b.glow.clone() },
        uPower: { value: 1.35 },
        uTime: { value: 0 },
      },
    });

    /** Parts under the platform. They show in the space world and are hidden when the board rests on the garden island. */
    this.underside = new THREE.Group();
    this.group.add(this.underside);

    // Top frame: a rounded square slab with a square hole for the tiles.
    const frameShape = roundedSquareShape(FRAME_HALF, 0.6);
    frameShape.holes.push(squarePath(4.1));
    const frameGeometry = new THREE.ExtrudeGeometry(frameShape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 3, curveSegments: 10 });
    frameGeometry.rotateX(Math.PI / 2);
    frameGeometry.translate(0, FRAME_TOP - 0.035, 0);
    const frame = new THREE.Mesh(frameGeometry, this.frameMaterial);
    frame.receiveShadow = true;
    this.group.add(frame);

    // Light strip between the tiles and the frame.
    const innerShape = new THREE.Shape();
    innerShape.moveTo(-4.1, -4.1);
    innerShape.lineTo(4.1, -4.1);
    innerShape.lineTo(4.1, 4.1);
    innerShape.lineTo(-4.1, 4.1);
    innerShape.lineTo(-4.1, -4.1);
    innerShape.holes.push(squarePath(4.02));
    const innerGeometry = new THREE.ShapeGeometry(innerShape);
    innerGeometry.rotateX(-Math.PI / 2);
    innerGeometry.translate(0, 0.004, 0);
    this.group.add(new THREE.Mesh(innerGeometry, this.trimMaterial));

    // Thin light line near the outer edge of the top face.
    const lineShape = roundedSquareShape(FRAME_HALF - 0.1, 0.52);
    lineShape.holes.push(roundedSquareShape(FRAME_HALF - 0.125, 0.5));
    const lineGeometry = new THREE.ShapeGeometry(lineShape, 10);
    lineGeometry.rotateX(-Math.PI / 2);
    lineGeometry.translate(0, FRAME_TOP + 0.0015, 0);
    this.group.add(new THREE.Mesh(lineGeometry, this.trimMaterial));

    // Light strip around the outer side of the slab.
    const sideShape = roundedSquareShape(FRAME_HALF + 0.037, 0.62);
    const sidePoints = sideShape.getPoints(10);
    const sidePositions = [];
    const y0 = -0.075;
    const y1 = -0.045;
    for (let i = 0; i < sidePoints.length - 1; i++) {
      const a = sidePoints[i];
      const b = sidePoints[i + 1];
      // The shape lies in XY; map its y to world -z.
      sidePositions.push(a.x, y0, -a.y, b.x, y0, -b.y, b.x, y1, -b.y, a.x, y0, -a.y, b.x, y1, -b.y, a.x, y1, -a.y);
    }
    const sideGeometry = new THREE.BufferGeometry();
    sideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sidePositions, 3));
    const sideStrip = new THREE.Mesh(sideGeometry, this.trimMaterial);
    sideStrip.material.side = THREE.DoubleSide;
    this.group.add(sideStrip);

    // Floor under the tiles. The thin gaps between tiles let its glow through as a grid of light.
    this.gridMaterial = new THREE.MeshBasicMaterial({ color: 0x6f8cff });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(8.1, 8.1), this.gridMaterial);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.085;
    this.group.add(grid);

    // Underside: an upside-down stepped pyramid ending in a glowing engine core.
    const hullParts = [];
    const frustum = (topSide, bottomSide, yTop, height) => {
      const g = new THREE.CylinderGeometry(topSide / Math.SQRT2, bottomSide / Math.SQRT2, height, 4, 1).toNonIndexed();
      g.rotateY(Math.PI / 4);
      g.translate(0, yTop - height / 2, 0);
      g.computeVertexNormals();
      hullParts.push(g);
    };
    frustum(8.9, 8.0, -0.2, 0.22);
    frustum(7.6, 5.4, -0.42, 0.55);
    frustum(4.6, 2.6, -0.97, 0.6);
    const core = new THREE.CylinderGeometry(1.15, 0.95, 0.5, 40, 1).toNonIndexed();
    core.translate(0, -1.8, 0);
    hullParts.push(core);
    const hull = new THREE.Mesh(mergeGeometries(hullParts), this.hullMaterial);
    this.underside.add(hull);
    hullParts.forEach((g) => g.dispose());

    // Engine light under the core and a soft beam going down toward the galaxy.
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfe9ff').multiplyScalar(3.2) });
    const coreDisc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), this.coreMaterial);
    coreDisc.rotation.x = Math.PI / 2;
    coreDisc.position.y = -2.06;
    this.underside.add(coreDisc);
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.03, 8, 64), this.trimMaterial);
    coreRing.rotation.x = Math.PI / 2;
    coreRing.position.y = -1.62;
    this.underside.add(coreRing);

    this.beamMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#8fd8ff') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float uTime; uniform vec3 uColor; void main(){ float fall = pow(clamp(vUv.y, 0.0, 1.0), 2.2); float streak = 0.75 + 0.25 * sin(vUv.x * 60.0 + uTime * 0.7); float a = fall * streak * 0.5; gl_FragColor = vec4(uColor * a * 1.4, a); }',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 3.4, 9, 48, 1, true), this.beamMaterial);
    beam.position.y = -6.55;
    beam.renderOrder = -3;
    this.underside.add(beam);

    // Corner beacons in the team colors.
    const beaconBase = new THREE.CylinderGeometry(0.11, 0.14, 0.12, 20);
    const beaconCap = new THREE.SphereGeometry(0.075, 16, 10);
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const base = new THREE.Mesh(beaconBase, this.frameMaterial);
      base.position.set(sx * 4.36, FRAME_TOP + 0.06, sz * 4.36);
      const cap = new THREE.Mesh(beaconCap, new THREE.MeshBasicMaterial({ color: (sz > 0 ? TEAMS.w.glow : TEAMS.b.glow).clone().multiplyScalar(2.4) }));
      cap.position.set(sx * 4.36, FRAME_TOP + 0.14, sz * 4.36);
      this.group.add(base, cap);
    }
  }

  #buildTiles() {
    const geometry = new THREE.BoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE);
    this.tileMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, metalness: 0.3, envMapIntensity: 1.1 });
    // A soft chamfer look: tile borders are a little darker and rougher, so each tile reads as its own glossy plate.
    this.tileMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTileWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vec4 rcW = vec4(transformed, 1.0);\n  #ifdef USE_INSTANCING\n    rcW = instanceMatrix * rcW;\n  #endif\n  vTileWorld = (modelMatrix * rcW).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTileWorld;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  vec2 rcF = abs(fract(vTileWorld.xz) - 0.5);\n  float rcEdge = smoothstep(0.405, 0.475, max(rcF.x, rcF.y));\n  roughnessFactor = mix(roughnessFactor, 0.55, rcEdge * 0.8);\n  diffuseColor.rgb *= mix(1.0, 0.7, rcEdge);');
    };
    this.tiles = new THREE.InstancedMesh(geometry, this.tileMaterial, 64);
    this.tiles.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 64; i++) {
      const { x, z } = squareToWorld(indexToSquare(i));
      matrix.makeTranslation(x, -TILE_HEIGHT / 2, z);
      this.tiles.setMatrixAt(i, matrix);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.group.add(this.tiles);
  }

  #buildHighlights() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.fillAttr = new THREE.InstancedBufferAttribute(new Float32Array(64 * 4), 4);
    this.markAttr = new THREE.InstancedBufferAttribute(new Float32Array(64 * 4), 4);
    this.pulseAttr = new THREE.InstancedBufferAttribute(new Float32Array(64), 1);
    geometry.setAttribute('aFill', this.fillAttr);
    geometry.setAttribute('aMark', this.markAttr);
    geometry.setAttribute('aPulse', this.pulseAttr);
    this.highlightMaterial = new THREE.ShaderMaterial({
      ...HighlightShader,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.highlightMesh = new THREE.InstancedMesh(geometry, this.highlightMaterial, 64);
    /** Where the highlight of each square sits. Only the squares that show something are handed to the GPU (see #composeHighlights). */
    this.tileMatrices = [];
    for (let i = 0; i < 64; i++) {
      const { x, z } = squareToWorld(indexToSquare(i));
      this.tileMatrices.push(new THREE.Matrix4().makeTranslation(x, 0.006, z));
    }
    /** Highlight of every square, worked out from the layers before the packing. */
    this.tileFill = new Float32Array(64 * 4);
    this.tileMark = new Float32Array(64 * 4);
    this.tilePulse = new Float32Array(64);
    this.highlightMesh.count = 0;
    this.highlightMesh.visible = false;
    this.highlightMesh.frustumCulled = false;
    this.highlightMesh.renderOrder = 2;
    this.group.add(this.highlightMesh);
  }

  #buildCoordinates() {
    this.coordCanvas = document.createElement('canvas');
    this.coordCanvas.width = 512;
    this.coordCanvas.height = 128;
    this.coordTexture = new THREE.CanvasTexture(this.coordCanvas);
    this.coordTexture.colorSpace = THREE.SRGBColorSpace;
    this.coordTexture.anisotropy = 4;
    this.#drawCoordinateAtlas();
    this.coordMaterial = new THREE.MeshBasicMaterial({ map: this.coordTexture, transparent: true, depthWrite: false, opacity: 0.6 });
    this.coordSets = {};
    for (const side of ['w', 'b']) {
      const positions = [];
      const uvs = [];
      const sign = side === 'w' ? 1 : -1;
      const quad = (cx, cz, col, row) => {
        const h = 0.115;
        const corners = [[-h, h], [h, h], [h, -h], [-h, -h]].map(([dx, dz]) => [cx + dx * sign, cz + dz * sign]);
        const u0 = col / 8;
        const u1 = (col + 1) / 8;
        const v0 = 1 - (row + 1) / 2;
        const v1 = 1 - row / 2;
        const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        for (const i of [0, 1, 2, 0, 2, 3]) {
          positions.push(corners[i][0], FRAME_TOP + 0.003, corners[i][1]);
          uvs.push(uv[i][0], uv[i][1]);
        }
      };
      for (let i = 0; i < 8; i++) {
        quad(i - 3.5, sign * 4.31, i, 0); // file letters along the near edge
        quad(-sign * 4.31, 3.5 - i, i, 1); // rank numbers along the left edge
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(geometry, this.coordMaterial);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.coordSets[side] = mesh;
    }
    this.#applyCoordinateVisibility();
  }

  #drawCoordinateAtlas() {
    const ctx = this.coordCanvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = '#dbe6ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 34px "Unbounded Variable", "Lexend Variable", system-ui, sans-serif';
    for (let i = 0; i < 8; i++) {
      ctx.fillText(FILES[i], i * 64 + 32, 34);
      ctx.fillText(String(i + 1), i * 64 + 32, 98);
    }
    if (this.coordTexture) this.coordTexture.needsUpdate = true;
  }

  #applyCoordinateVisibility() {
    this.coordSets.w.visible = this.coordinatesVisible && this.orientation === 'w';
    this.coordSets.b.visible = this.coordinatesVisible && this.orientation === 'b';
  }

  #buildArrows() {
    this.arrowGroup = new THREE.Group();
    this.arrowGroup.position.y = 0.012;
    this.group.add(this.arrowGroup);
    this.arrowMaterials = new Set();
  }

  #applyReflection() {
    const wanted = this.stage.quality.reflection;
    if (wanted && !this.reflector) {
      const geometry = new THREE.PlaneGeometry(MIRROR_HALF * 2, MIRROR_HALF * 2);
      this.reflector = new Reflector(geometry, { shader: ReflectionShader, textureWidth: 512, textureHeight: 512, clipBias: 0.002, multisample: 4 });
      this.#resizeReflection();
      this.reflector.rotation.x = -Math.PI / 2;
      this.reflector.position.y = 0.002;
      const material = this.reflector.material;
      material.transparent = true;
      material.blending = THREE.AdditiveBlending;
      material.depthWrite = false;
      this.reflector.renderOrder = 1;
      // Only the color of the mirror image is read, so its multisampled depth is not copied out.
      this.reflector.getRenderTarget().resolveDepthBuffer = false;
      // Only objects on layer 1 (robots and effects) are mirrored, and the sky is left out: the tiles already reflect the studio lights.
      this.reflector.getReflectionCamera(this.stage.camera).layers.set(1);
      // three.js draws the mirror image from inside the main scene pass, when it reaches the floor. The stage draws it before the main pass instead (see Stage.prePasses), with the same three.js code and the same rule for when it is drawn, so the stock hook does nothing in the main pass.
      const renderMirror = this.reflector.onBeforeRender;
      this.reflector.onBeforeRender = () => {};
      const reflector = this.reflector;
      this.reflectionPass = (renderer, scene, camera) => {
        if (!isDrawn(reflector, camera)) return;
        // The floor reads the mirror image only where the board is on screen, so only that rectangle is cleared, drawn and resolved. The rest of the image keeps old content that is never read. The picture stays the same and the GPU moves far fewer pixels.
        const target = reflector.getRenderTarget();
        target.scissorTest = mirrorRegion(camera, reflector.matrixWorld, MIRROR_HALF, target.width, target.height, target.scissor);
        const background = scene.background;
        scene.background = null;
        const clearAlpha = renderer.getClearAlpha();
        const clearColor = renderer.getClearColor(_clearColor);
        renderer.setClearColor(0x000000, 1);
        try {
          renderMirror.call(reflector, renderer, scene, camera);
        } finally {
          scene.background = background;
          renderer.setClearColor(clearColor, clearAlpha);
        }
      };
      this.stage.prePasses.add(this.reflectionPass);
      this.group.add(this.reflector);
    } else if (!wanted && this.reflector) {
      this.stage.prePasses.delete(this.reflectionPass);
      this.reflectionPass = null;
      this.group.remove(this.reflector);
      this.reflector.dispose();
      this.reflector.geometry.dispose();
      this.reflector = null;
    }
  }

  // The mirror image follows the screen resolution (capped), so small lights stay clean in the reflection.
  #resizeReflection() {
    if (!this.reflector) return;
    const scale = Math.min(1, 1600 / Math.max(1, this.stage.width));
    const w = Math.max(64, Math.floor(this.stage.width * scale));
    const h = Math.max(64, Math.floor(this.stage.height * scale));
    const target = this.reflector.getRenderTarget();
    if (target.width !== w || target.height !== h) {
      target.setSize(w, h);
      this.reflector.material.uniforms.uTexel.value.set(1 / w, 1 / h);
    }
  }

  /** Apply a board theme: frame, grid light and the theme's tile colors for the current board color choice. */
  setTheme(name) {
    this.themeName = Object.hasOwn(BOARD_THEMES, name) ? name : DEFAULT_THEME;
    const theme = BOARD_THEMES[this.themeName];
    this.#paintTiles();
    this.frameMaterial.color.copy(theme.frame);
    this.hullMaterial.color.copy(theme.frame).multiplyScalar(0.7);
    this.gridMaterial.color.copy(theme.grid).multiplyScalar(theme.lights.seam);
    this.underside.visible = theme.world === 'space';
    this.trimMaterial.uniforms.uPower.value = theme.lights.trim;
  }

  /** Pick the tile colors (one of BOARD_COLORS). The current theme decides the exact shades. */
  setBoardColors(name) {
    this.boardColors = BOARD_COLORS.includes(name) ? name : DEFAULT_BOARD_COLORS;
    this.#paintTiles();
  }

  #paintTiles() {
    const { light, dark } = tileColors(this.themeName, this.boardColors);
    for (let i = 0; i < 64; i++) this.tiles.setColorAt(i, isDarkSquare(indexToSquare(i)) ? dark : light);
    this.tiles.instanceColor.needsUpdate = true;
  }

  setCoordinates(visible) {
    this.coordinatesVisible = visible;
    this.#applyCoordinateVisibility();
  }

  /** Which color sits at the bottom of the screen; moves the coordinate labels to that side. */
  setOrientation(color) {
    this.orientation = color;
    this.#applyCoordinateVisibility();
  }

  /**
   * Replace one highlight layer.
   * @param {string} layer One of: lastMove, hint, coach, check, selected, legal, hover.
   * @param {Array<{square:string, color?:THREE.Color, alpha?:number, mark?:number, markColor?:THREE.Color, pulse?:boolean}>} entries
   */
  setLayer(layer, entries) {
    const map = this.layers.get(layer);
    if (!map) throw new Error(`Unknown highlight layer: ${layer}`);
    map.clear();
    for (const entry of entries) map.set(entry.square, entry);
    this.highlightsDirty = true;
  }

  clearLayer(layer) {
    this.setLayer(layer, []);
  }

  // Work out each square's highlight from the layers, then hand only the squares that show something to the GPU, in square order. A square with no fill and no mark draws nothing (its shader would throw away every pixel), so leaving it out keeps the picture the same and saves that work every frame.
  #composeHighlights() {
    const fill = this.tileFill;
    const mark = this.tileMark;
    const pulse = this.tilePulse;
    fill.fill(0);
    mark.fill(0);
    pulse.fill(0);
    for (const name of LAYER_ORDER) {
      for (const [square, entry] of this.layers.get(name)) {
        const i = squareIndex(square);
        if (entry.color) {
          fill[i * 4] = entry.color.r;
          fill[i * 4 + 1] = entry.color.g;
          fill[i * 4 + 2] = entry.color.b;
          fill[i * 4 + 3] = entry.alpha ?? 1;
          pulse[i] = entry.pulse ? 1 : 0;
        }
        if (entry.mark) {
          const color = entry.markColor ?? entry.color ?? FX_COLORS.white;
          mark[i * 4] = entry.mark;
          mark[i * 4 + 1] = color.r;
          mark[i * 4 + 2] = color.g;
          mark[i * 4 + 3] = color.b;
        }
      }
    }
    const fillOut = this.fillAttr.array;
    const markOut = this.markAttr.array;
    const pulseOut = this.pulseAttr.array;
    let count = 0;
    for (let i = 0; i < 64; i++) {
      // The shader shows a fill only when its alpha is above 0 and a mark only when the mark number is 1 or more.
      if (!(fill[i * 4 + 3] > 0) && !(mark[i * 4] > 0.5)) continue;
      fillOut.set(fill.subarray(i * 4, i * 4 + 4), count * 4);
      markOut.set(mark.subarray(i * 4, i * 4 + 4), count * 4);
      pulseOut[count] = pulse[i];
      this.highlightMesh.setMatrixAt(count, this.tileMatrices[i]);
      count++;
    }
    this.highlightMesh.count = count;
    this.highlightMesh.visible = count > 0;
    this.highlightMesh.instanceMatrix.needsUpdate = true;
    this.fillAttr.needsUpdate = true;
    this.markAttr.needsUpdate = true;
    this.pulseAttr.needsUpdate = true;
    this.highlightsDirty = false;
  }

  /**
   * Show coach arrows on the board. Pass an empty list to remove them.
   * @param {Array<{from:string, to:string, kind:'danger'|'good'|'info'|'target'}>} arrows
   */
  setArrows(arrows) {
    for (const child of [...this.arrowGroup.children]) {
      this.arrowGroup.remove(child);
      child.geometry.dispose();
      child.material.dispose();
    }
    this.arrowMaterials.clear();
    for (const arrow of arrows) {
      const a = squareToWorld(arrow.from);
      const b = squareToWorld(arrow.to);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.01) continue;
      const start = 0.32;
      const end = length - 0.3;
      const head = 0.34;
      const half = 0.085;
      const shape = new THREE.Shape();
      shape.moveTo(start, -half);
      shape.lineTo(end - head, -half);
      shape.lineTo(end - head, -half * 2.6);
      shape.lineTo(end, 0);
      shape.lineTo(end - head, half * 2.6);
      shape.lineTo(end - head, half);
      shape.lineTo(start, half);
      shape.lineTo(start, -half);
      const geometry = new THREE.ShapeGeometry(shape);
      const pos = geometry.attributes.position;
      const uv = geometry.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - start) / (end - start), pos.getY(i));
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.ShaderMaterial({
        ...ArrowShader,
        uniforms: { uColor: { value: (FX_COLORS[arrow.kind] ?? FX_COLORS.info).clone() }, uTime: { value: 0 }, uAlpha: { value: 1 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(a.x, 0, a.z);
      mesh.rotation.y = Math.atan2(-dz, dx);
      mesh.renderOrder = 6;
      this.arrowGroup.add(mesh);
      this.arrowMaterials.add(material);
    }
  }

  update(dt, time) {
    this.time = time;
    if (this.highlightsDirty) this.#composeHighlights();
    this.#resizeReflection();
    this.highlightMaterial.uniforms.uTime.value = time;
    this.trimMaterial.uniforms.uTime.value = time;
    this.beamMaterial.uniforms.uTime.value = time;
    for (const material of this.arrowMaterials) material.uniforms.uTime.value = time;
  }
}
