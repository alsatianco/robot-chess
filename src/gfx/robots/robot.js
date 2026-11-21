// One robot on the board. All motion goes through a flat set of numbers called the rig (position, lean, squash, walk phase, spring, power and so on). Animations only tween rig numbers; `update` turns the rig plus a small idle motion into joint transforms. Because every piece type shares the same rig, clips such as "hop", "power down" or "celebrate" work for all six robots.
import * as THREE from 'three';
import { getBlueprint } from './designs.js';
import { createFaceGeometry } from './builder.js';
import { Face } from './face.js';
import { createMarker } from './marker.js';
import { createRobotMaterial, createGhostMaterial, setRobotMaterialQuality } from '../materials.js';
import { TEAMS } from '../palette.js';

/** All robots are drawn a little larger than their design size so they fill their tiles like real chess pieces do. */
export const ROBOT_SCALE = 1.2;

const faceGeometries = new Map();
const clamp = THREE.MathUtils.clamp;

function getFaceGeometry(blueprint) {
  if (!faceGeometries.has(blueprint.type)) faceGeometries.set(blueprint.type, createFaceGeometry(blueprint.faceSpec));
  return faceGeometries.get(blueprint.type);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** The rig: every number an animation may change. */
export function createRig() {
  return {
    x: 0, // board position
    z: 0,
    y: 0, // height above the tile (jumps, lifts)
    yaw: 0, // facing; 0 looks toward +z
    lean: 0, // forward pitch of the body
    roll: 0, // sideways tilt of the body
    twist: 0, // body turn on top of yaw
    squash: 1, // 1 is normal; below 1 is squashed flat, above 1 is stretched tall
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    armL: 0, // king: arm swing forward
    armR: 0,
    spread: 0, // king: arms out; queen: wings out
    walk: 0, // walk cycle in steps; whole numbers mean feet together
    walkAmp: 0, // how strongly the walk cycle (or tread rumble) shows
    spring: 0, // knight legs: 1 is fully pressed down, negative is stretched
    hover: 0, // extra hover height for the bishop and queen
    recoil: 0, // rook cannon kick
    special: 0, // free extra per piece (queen: crown lift)
    shake: 0, // trembling
    idle: 1, // weight of the idle motion
    power: 1, // lights; 0 is shut down
    scale: 1,
    glow: 0, // flash in the team color (selection, best move)
    select: 0, // 1 while selected: stronger rim light
    wipe: 1000, // teleport cut height in world units; large means not cut
  };
}

// Per-piece pose code. r is the rig, j the joints (already reset to their rest pose), t the robot's own clock and w the idle weight.
const POSES = {
  p(robot, r, j, t, w) {
    j.body.position.y += Math.sin(t * 2.1) * 0.012 * w;
    j.body.rotation.z += Math.sin(t * 1.3) * 0.035 * w;
    const phase = r.walk * Math.PI;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const amp = r.walkAmp;
    // Waddle: rock from foot to foot.
    j.body.rotation.z += s * 0.22 * amp;
    j.body.position.x += s * 0.022 * amp;
    j.body.position.y += Math.abs(s) * 0.03 * amp;
    j.footL.position.y += Math.max(0, s) * 0.06 * amp;
    j.footR.position.y += Math.max(0, -s) * 0.06 * amp;
    j.footL.position.z += c * 0.04 * amp;
    j.footR.position.z -= c * 0.04 * amp;
    j.footL.rotation.x -= Math.max(0, s) * 0.35 * amp;
    j.footR.rotation.x -= Math.max(0, -s) * 0.35 * amp;
  },
  r(robot, r, j, t, w) {
    const rumble = r.walkAmp;
    j.body.position.y += Math.sin(t * 2.0) * 0.003 * w + Math.sin(t * 38) * 0.004 * rumble;
    j.treadL.position.y += Math.sin(t * 46 + 1) * 0.004 * rumble;
    j.treadR.position.y += Math.sin(t * 43 + 2) * 0.004 * rumble;
    // The turret slowly scans left and right.
    j.head.rotation.y += Math.sin(t * 0.55) * 0.2 * w;
    j.cannon.position.z -= r.recoil * 0.1;
    j.head.rotation.x -= r.recoil * 0.13;
    j.body.position.z -= r.recoil * 0.035;
    j.body.rotation.x -= r.recoil * 0.05;
  },
  n(robot, r, j, t, w) {
    const press = clamp(r.spring + (0.12 + Math.sin(t * 2.4) * 0.07) * w, -0.6, 1);
    const height = robot.blueprint.info.springHeight;
    j.springL.scale.y = 1 - 0.62 * press;
    j.springR.scale.y = 1 - 0.62 * press;
    j.body.position.y -= height * 0.62 * press;
    j.head.rotation.x += Math.sin(t * 2.4 + 0.7) * 0.06 * w;
    j.body.rotation.x += Math.sin(t * 2.4 + 0.3) * 0.02 * w;
  },
  b(robot, r, j, t, w) {
    const bob = Math.sin(t * 1.7) * 0.022 * w;
    j.body.position.y += bob + r.hover;
    j.thruster.position.y += bob * 0.35 + r.hover * 0.5;
    j.body.rotation.z += Math.sin(t * 0.9) * 0.028 * w;
    j.collar.rotation.x += Math.sin(t * 1.3) * 0.14 * w + r.special * 0.5;
    j.collar.rotation.z += Math.cos(t * 1.1) * 0.14 * w;
    j.collar.position.y += Math.sin(t * 2.3) * 0.012 * w;
  },
  q(robot, r, j, t, w) {
    j.body.position.y += Math.sin(t * 1.5) * 0.02 * w + r.hover;
    j.body.rotation.z += Math.sin(t * 0.8) * 0.022 * w;
    j.crown.rotation.y += t * 0.7;
    j.crown.position.y += Math.sin(t * 2.2) * 0.008 * w + r.special * 0.07;
    const flap = Math.sin(t * 1.8) * 0.07 * w + r.spread * 0.85;
    j.wingL.rotation.z -= flap;
    j.wingR.rotation.z += flap;
    j.wingL.position.x += r.spread * 0.05;
    j.wingR.position.x -= r.spread * 0.05;
  },
  k(robot, r, j, t, w) {
    const breath = Math.sin(t * 1.2) * w;
    j.body.position.y += breath * 0.006;
    const out = 0.07 * w + breath * 0.025 + r.spread * 1.25;
    j.armL.rotation.z += out;
    j.armR.rotation.z -= out;
    j.armL.rotation.x -= r.armL + Math.sin(t * 1.2 + 1) * 0.04 * w;
    j.armR.rotation.x -= r.armR - Math.sin(t * 1.2 + 1) * 0.04 * w;
    const phase = r.walk * Math.PI;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const amp = r.walkAmp;
    // One heavy step at a time.
    j.legL.position.y += Math.max(0, s) * 0.075 * amp;
    j.legR.position.y += Math.max(0, -s) * 0.075 * amp;
    j.legL.position.z += c * 0.055 * amp;
    j.legR.position.z -= c * 0.055 * amp;
    j.body.rotation.z += s * 0.075 * amp;
    j.body.position.y += Math.abs(s) * 0.022 * amp;
    j.crown.rotation.z += Math.sin(t * 1.9) * 0.02 * w;
  },
};

export class Robot {
  /**
   * @param {'p'|'r'|'n'|'b'|'q'|'k'} type
   * @param {'w'|'b'} team
   * @param {{clearcoat:boolean}} quality
   * @param {{ghost?:boolean}} [options] Ghost robots are the see-through pieces the coach uses to show a line.
   */
  constructor(type, team, quality, options = {}) {
    this.type = type;
    this.team = team;
    this.ghost = Boolean(options.ghost);
    this.blueprint = getBlueprint(type);
    this.info = this.blueprint.info;
    /** Real height on the board in tiles. */
    this.height = this.info.height * ROBOT_SCALE;
    this.rig = createRig();
    this.clock = Math.random() * 20;
    this.lookYaw = 0;
    this.lookPitch = 0;
    /** @type {THREE.Vector3|null} World point the robot watches with its head and eyes. */
    this.lookTarget = null;
    this.alive = true;

    this.group = new THREE.Group();
    this.group.name = `robot-${team}${type}`;
    this.material = this.ghost ? createGhostMaterial(team) : createRobotMaterial(team, quality);
    this.uniforms = this.ghost ? this.material.uniforms : this.material.userData.uniforms;

    /** @type {Record<string, THREE.Group>} */
    this.joints = {};
    this.rest = {};
    /** @type {THREE.Mesh[]} */
    this.meshes = [];
    for (const spec of this.blueprint.joints.values()) {
      const joint = new THREE.Group();
      joint.name = spec.name;
      joint.position.set(...spec.position);
      joint.rotation.set(...spec.rotation);
      this.joints[spec.name] = joint;
      this.rest[spec.name] = { position: joint.position.clone(), rotation: joint.rotation.clone() };
      if (spec.geometry) {
        const mesh = new THREE.Mesh(spec.geometry, this.material);
        mesh.castShadow = !this.ghost;
        mesh.receiveShadow = false;
        // Layer 1 is what the floor reflection sees.
        if (!this.ghost) mesh.layers.enable(1);
        mesh.userData.joint = spec.name;
        joint.add(mesh);
        this.meshes.push(mesh);
      }
      if (spec.parent) this.joints[spec.parent].add(joint);
    }
    this.root = this.joints.root;
    this.group.add(this.root);

    this.face = null;
    this.faceMesh = null;
    if (!this.ghost && this.blueprint.faceSpec) {
      const spec = this.blueprint.faceSpec;
      this.face = new Face(team, spec);
      this.faceMesh = new THREE.Mesh(getFaceGeometry(this.blueprint), this.face.material);
      this.faceMesh.position.set(...spec.p);
      this.faceMesh.rotation.set(...spec.r);
      this.faceMesh.layers.enable(1);
      this.joints[spec.joint].add(this.faceMesh);
    }

    this.marker = null;
    if (!this.ghost) {
      this.marker = createMarker(type, team);
      this.group.add(this.marker);
    }
    this.update(0, true);
  }

  /** Place the robot on the board without animation. */
  place(x, z, yaw) {
    this.rig.x = x;
    this.rig.z = z;
    this.rig.yaw = yaw;
  }

  setMood(mood) {
    this.face?.setMood(mood);
  }

  /** World position of a named point of the design (for example the muzzle where zaps and beams start). */
  getPoint(name, target = new THREE.Vector3()) {
    const p = this.info[name];
    if (!p) throw new Error(`Robot ${this.type} has no point "${name}"`);
    target.set(p[0], p[1], p[2]);
    this.root.updateWorldMatrix(true, false);
    return target.applyMatrix4(this.root.matrixWorld);
  }

  /** World position of the middle of the robot's body, a good target for attacks. */
  getCenter(target = new THREE.Vector3()) {
    return target.set(this.rig.x, this.rig.y + this.height * 0.5, this.rig.z);
  }

  setQuality(quality) {
    if (!this.ghost) setRobotMaterialQuality(this.material, quality);
  }

  /**
   * Apply the rig to the joints. Call every frame.
   * @param {number} dt Seconds since the last frame.
   * @param {boolean} [snap] Skip smoothing (used when a robot is created or moved instantly).
   * @param {number} [markerYaw] Rotation that turns the base badge toward the camera.
   * @param {number} [markerScale] Size factor of the base ring (larger in the top-down view).
   */
  update(dt, snap = false, markerYaw = 0, markerScale = 1) {
    const r = this.rig;
    const j = this.joints;
    this.clock += dt;
    const t = this.clock;
    const w = r.idle;

    for (const name in j) {
      const joint = j[name];
      const rest = this.rest[name];
      joint.position.copy(rest.position);
      joint.rotation.copy(rest.rotation);
      joint.scale.set(1, 1, 1);
    }

    const shakeX = r.shake ? Math.sin(t * 71) * 0.012 * r.shake : 0;
    const shakeZ = r.shake ? Math.cos(t * 83) * 0.012 * r.shake : 0;
    this.group.position.set(r.x, 0, r.z);
    this.root.position.set(shakeX, r.y, shakeZ);
    this.root.rotation.y = r.yaw;
    // Squash and stretch keeps the volume: squashing down makes the robot wider.
    const wide = 1 / Math.sqrt(Math.max(0.05, r.squash));
    const size = r.scale * ROBOT_SCALE;
    this.root.scale.set(size * wide, size * r.squash, size * wide);

    const body = j.body;
    body.rotation.x += r.lean;
    body.rotation.z += r.roll;
    body.rotation.y += r.twist;

    // Head and eyes follow the look target.
    let wantYaw = 0;
    let wantPitch = 0;
    let eyeX = 0;
    let eyeY = 0;
    if (this.lookTarget) {
      const dx = this.lookTarget.x - r.x;
      const dz = this.lookTarget.z - r.z;
      const rel = wrapAngle(Math.atan2(dx, dz) - r.yaw - r.twist);
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05 && Math.abs(rel) < 2.3) {
        wantYaw = clamp(rel, -0.85, 0.85);
        eyeX = clamp((rel - wantYaw) * 2.5 + rel * 0.6, -1, 1);
        const dy = this.lookTarget.y - (r.y + this.info.headHeight * ROBOT_SCALE);
        wantPitch = clamp(-Math.atan2(dy, Math.max(dist, 0.3)), -0.5, 0.5);
        eyeY = clamp(-wantPitch * 1.5, -1, 1);
      }
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    this.lookYaw += (wantYaw - this.lookYaw) * k;
    this.lookPitch += (wantPitch - this.lookPitch) * k;
    const head = j.head ?? body;
    // The pawn's head is its body, so it turns less.
    const headShare = j.head ? 1 : 0.6;
    head.rotation.y += (r.headYaw + this.lookYaw) * headShare;
    head.rotation.x += r.headPitch + this.lookPitch * headShare;
    head.rotation.z += r.headRoll;

    POSES[this.type](this, r, j, t, w);

    if (this.ghost) {
      this.uniforms.uTime.value = t;
      return;
    }

    this.uniforms.uPower.value = r.power;
    this.uniforms.uFlash.value.set(TEAMS[this.team].glow.r, TEAMS[this.team].glow.g, TEAMS[this.team].glow.b, r.glow);
    this.uniforms.uRimPower.value = this.material.userData.baseRim + r.select * 0.9 + r.glow * 0.6;
    this.uniforms.uWipe.value.x = r.wipe;
    // During a teleport wipe the screen face must vanish together with the head it sits on.
    if (this.faceMesh && r.wipe < 900) this.faceMesh.visible = r.wipe > r.y + this.info.headHeight * ROBOT_SCALE;
    if (this.face) {
      this.face.power = r.power;
      this.face.setLook(eyeX, eyeY);
      this.face.update(dt, snap);
    }
    if (this.marker) {
      this.marker.rotation.y = markerYaw;
      this.marker.scale.setScalar(0.98 * markerScale);
      this.marker.material.opacity = clamp(r.scale, 0, 1) * (0.55 + 0.45 * r.power);
      this.marker.visible = r.scale > 0.02 && r.wipe > 0.05;
    }
  }

  /** Free GPU resources owned by this robot. Shared geometry and textures stay. */
  dispose() {
    this.alive = false;
    this.group.removeFromParent();
    this.material.dispose();
    this.face?.dispose();
    this.marker?.material.dispose();
  }
}
