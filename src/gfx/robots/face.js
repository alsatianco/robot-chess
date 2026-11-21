// The screen face. The eyes are drawn by a small shader from a few numbers (size, smile, tilt, blink, look direction), so a face can blend smoothly between moods, blink, and follow things with its eyes.
import * as THREE from 'three';
import { TEAMS } from '../palette.js';

const FaceShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform vec3 uColor;
    uniform float uPower;
    uniform float uTime;
    uniform float uEyes;
    uniform float uAspect;
    uniform float uCorner;
    uniform vec4 uEye;     // half width, half height, roundness, distance of each eye from the center
    uniform vec4 uMood;    // smile, tilt, wide, squint
    uniform vec4 uMouth;   // on, curve, half width, open
    uniform vec2 uLook;
    uniform float uBlink;
    uniform float uJitter;

    float sdRoundBox(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }
    // Arc around the +y axis ("happy eye"). sc is sin/cos of half the opening angle.
    float sdArc(vec2 p, vec2 sc, float ra, float rb) {
      p.x = abs(p.x);
      return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) : abs(length(p) - ra)) - rb;
    }
    float eye(vec2 p, float side) {
      float ang = uMood.y * 0.5 * side;
      float c = cos(ang);
      float s = sin(ang);
      p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
      vec2 hs = vec2(uEye.x, max(0.012, uEye.y * (1.0 - uBlink * 0.94)));
      float r = min(hs.x, hs.y) * uEye.z;
      float dBox = sdRoundBox(p, hs, r);
      // Squint: a lid comes down from the top.
      dBox = max(dBox, p.y - hs.y * (1.0 - 1.5 * uMood.w));
      // Happy: the eye becomes an arch.
      float ra = uEye.x * 0.92;
      float dArc = sdArc(p + vec2(0.0, ra * 0.45), vec2(sin(1.2), cos(1.2)), ra, ra * 0.3);
      // Scared: a wide ring with a small dot.
      float R = max(uEye.x, uEye.y) * 1.12;
      float dRing = min(abs(length(p) - R) - R * 0.2, length(p) - R * 0.26);
      float d = mix(dBox, dArc, uMood.x);
      return mix(d, dRing, uMood.z);
    }
    void main() {
      vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
      float plate = sdRoundBox(p, vec2(uAspect * 0.5, 0.5), uCorner);
      if (plate > 0.0) discard;

      vec2 shake = vec2(sin(uTime * 47.0), cos(uTime * 53.0)) * 0.014 * uJitter;
      vec2 look = uLook * vec2(0.075, 0.06) + shake;
      float d;
      if (uEyes < 1.5) {
        d = eye(p - look, 0.0);
      } else {
        d = min(eye(p - vec2(-uEye.w, 0.0) - look, -1.0), eye(p - vec2(uEye.w, 0.0) - look, 1.0));
      }
      if (uMouth.x > 0.5) {
        vec2 m = p - vec2(0.0, -0.27) - look * 0.5;
        float bend = uMouth.y * 0.11 * (m.x * m.x / (uMouth.z * uMouth.z) - 0.5);
        float line = max(abs(m.y - bend) - 0.022, abs(m.x) - uMouth.z);
        float oval = length(m * vec2(1.0, 1.25)) - 0.075;
        d = min(d, mix(line, oval, uMouth.w));
      }

      float led = smoothstep(0.014, -0.014, d);
      float halo = exp(-max(d, 0.0) * 16.0) * 0.3;
      // LED dot grid, faded out when the face is small on screen so it never flickers.
      vec2 cell = fract(p * 30.0) - 0.5;
      float dots = smoothstep(0.52, 0.18, length(cell));
      float near = clamp(1.0 - fwidth(p.y) * 30.0 * 1.4, 0.0, 1.0);
      led *= mix(1.0, 0.5 + 0.5 * dots, near);

      vec3 base = vec3(0.010, 0.014, 0.024);
      base += uColor * 0.035 * uPower;
      // A fixed glassy streak so the screen reads as glass.
      float glint = smoothstep(0.09, 0.0, abs(p.x * 0.55 + p.y - 0.3)) * 0.05;
      float bezel = smoothstep(-0.05, 0.0, plate);
      vec3 col = base + glint;
      col += uColor * (led * 2.8 + halo) * uPower;
      col = mix(col, vec3(0.0, 0.002, 0.006), bezel * 0.85);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/**
 * Mood presets. Each number blends smoothly when the mood changes.
 * w, h: eye size multipliers. smile: 1 turns the eyes into happy arches. tilt: below 0 is sad (outer corners down), above 0 is fierce. wide: 1 is the scared ring eye. squint: upper lid. jitter: trembling. mouth: -1 frown to 1 smile (king only). open: round "oh" mouth. bright: LED brightness.
 */
export const MOODS = {
  neutral: { w: 1, h: 1, smile: 0, tilt: 0, wide: 0, squint: 0, jitter: 0, mouth: 0.25, open: 0, bright: 1 },
  happy: { w: 1.05, h: 1, smile: 1, tilt: 0, wide: 0, squint: 0, jitter: 0, mouth: 1, open: 0, bright: 1.15 },
  wow: { w: 1.2, h: 1.3, smile: 0, tilt: 0, wide: 0, squint: 0, jitter: 0, mouth: 0.2, open: 1, bright: 1.25 },
  scared: { w: 1, h: 1, smile: 0, tilt: 0, wide: 1, squint: 0, jitter: 1, mouth: -0.7, open: 0.8, bright: 1.1 },
  sad: { w: 0.95, h: 0.7, smile: 0, tilt: -0.9, wide: 0, squint: 0.25, jitter: 0, mouth: -1, open: 0, bright: 0.75 },
  fierce: { w: 1.05, h: 0.72, smile: 0, tilt: 0.9, wide: 0, squint: 0.3, jitter: 0, mouth: -0.4, open: 0, bright: 1.3 },
  dead: { w: 1.1, h: 0.14, smile: 0, tilt: 0, wide: 0, squint: 0, jitter: 0, mouth: -0.5, open: 0, bright: 0.3 },
};

const MOOD_KEYS = Object.keys(MOODS.neutral);

export class Face {
  /**
   * @param {'w'|'b'} team
   * @param {{w:number, h:number, eyes:number, corner:number, mouth:boolean, shape?:{w:number,h:number,round:number,gap:number,tilt?:number}}} spec
   */
  constructor(team, spec) {
    const shape = { w: 0.11, h: 0.13, round: 0.9, gap: 0.2, tilt: 0, ...spec.shape };
    this.shape = shape;
    this.mood = 'neutral';
    this.current = { ...MOODS.neutral };
    this.target = { ...MOODS.neutral };
    this.look = new THREE.Vector2();
    this.lookTarget = new THREE.Vector2();
    this.blink = 0;
    this.blinkTimer = 1 + Math.random() * 4;
    this.blinkPhase = -1;
    /** Extra brightness factor driven by the robot's power level. */
    this.power = 1;
    this.material = new THREE.ShaderMaterial({
      ...FaceShader,
      uniforms: {
        uColor: { value: TEAMS[team].glow.clone() },
        uPower: { value: 1 },
        uTime: { value: Math.random() * 10 },
        uEyes: { value: spec.eyes },
        uAspect: { value: spec.w / spec.h },
        uCorner: { value: spec.corner },
        uEye: { value: new THREE.Vector4(shape.w, shape.h, shape.round, shape.gap) },
        uMood: { value: new THREE.Vector4() },
        uMouth: { value: new THREE.Vector4(spec.mouth ? 1 : 0, 0, 0.13, 0) },
        uLook: { value: this.look },
        uBlink: { value: 0 },
        uJitter: { value: 0 },
      },
    });
  }

  /** Change the mood. The face blends to it over a fraction of a second. */
  setMood(name) {
    if (!MOODS[name]) throw new Error(`Unknown mood: ${name}`);
    this.mood = name;
    Object.assign(this.target, MOODS[name]);
  }

  /** Point the eyes. x and y are in the range -1..1 (right and up are positive). */
  setLook(x, y) {
    this.lookTarget.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  update(dt, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 13);
    for (const key of MOOD_KEYS) this.current[key] += (this.target[key] - this.current[key]) * k;
    this.look.lerp(this.lookTarget, snap ? 1 : 1 - Math.exp(-dt * 9));

    // Blink now and then, but not while the eyes are arches, rings or shut down.
    const canBlink = this.current.smile < 0.3 && this.current.wide < 0.3 && this.mood !== 'dead';
    if (this.blinkPhase < 0) {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0 && canBlink) this.blinkPhase = 0;
    } else {
      this.blinkPhase += dt / 0.16;
      if (this.blinkPhase >= 1) {
        this.blinkPhase = -1;
        this.blinkTimer = 1.8 + Math.random() * 4.5;
      }
    }
    this.blink = this.blinkPhase < 0 ? 0 : Math.sin(Math.min(1, this.blinkPhase) * Math.PI);

    const u = this.material.uniforms;
    const c = this.current;
    u.uTime.value += dt;
    u.uEye.value.set(this.shape.w * c.w, this.shape.h * c.h, this.shape.round, this.shape.gap);
    u.uMood.value.set(c.smile, c.tilt + this.shape.tilt * (1 - c.smile), c.wide, c.squint);
    u.uMouth.value.y = c.mouth;
    u.uMouth.value.w = c.open;
    u.uBlink.value = this.blink;
    u.uJitter.value = c.jitter;
    u.uPower.value = c.bright * this.power;
  }

  dispose() {
    this.material.dispose();
  }
}
