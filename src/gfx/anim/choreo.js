// Choreography: how each robot travels, attacks, falls apart, teleports, gets promoted and celebrates. Every clip is an async function that tweens rig numbers and fires effects and sounds. Each robot moves the way its chess rule works (the pawn waddles one step, the rook rolls straight, the knight leaps over others, the bishop glides on diagonals, the queen dashes, the king takes one heavy step), so the animation itself teaches the rule.
import * as THREE from 'three';
import { Ease } from './animator.js';
import { TEAMS, FX_COLORS } from '../palette.js';

const PI = Math.PI;
const lerp = THREE.MathUtils.lerp;
const rand = (min, max) => min + Math.random() * (max - min);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/**
 * @typedef {Object} ChoreoContext
 * @property {import('./animator.js').Animator} A
 * @property {import('../fx/effects.js').Effects} fx
 * @property {{play:(name:string, opts?:object)=>void}} sfx
 * @property {number} pace Duration multiplier of the animation preset (1 is Standard).
 * @property {boolean} cinematic True for the Cinematic preset: camera moves on every capture.
 * @property {(amount:number)=>void} shake Screen shake (the view checks the player's setting).
 * @property {(point:THREE.Vector3, amount?:number)=>void} focus Lean the camera toward a point.
 * @property {()=>void} release Give the camera back.
 * @property {(color:THREE.Color, amount:number)=>void} screenFlash Short full-screen flash (the view checks the player's setting).
 * @property {(robot:object)=>void} releaseRobot Stop updating a robot that is being taken apart.
 */

const T = (ctx, seconds) => seconds * ctx.pace;

/** Facing of a team when it stands still: toward the enemy. */
export function homeYaw(color) {
  return color === 'w' ? PI : 0;
}

function wrapAngle(a) {
  while (a > PI) a -= PI * 2;
  while (a < -PI) a += PI * 2;
  return a;
}

function yawToward(rig, to) {
  return Math.atan2(to.x - rig.x, to.z - rig.z);
}

/** Turn a robot to a facing, the short way around. */
export function turn(ctx, robot, yaw, seconds = 0.12) {
  const delta = wrapAngle(yaw - robot.rig.yaw);
  if (Math.abs(delta) < 0.01) return Promise.resolve();
  return ctx.A.tween(robot.rig, { yaw: robot.rig.yaw + delta }, T(ctx, seconds), Ease.inOutQuad);
}

/** Bring every pose number back to rest and face the enemy again. */
export async function settle(ctx, robot) {
  const rig = robot.rig;
  await Promise.all([
    ctx.A.tween(rig, { lean: 0, roll: 0, twist: 0, squash: 1, y: 0, hover: 0, spread: 0, special: 0, walkAmp: 0, spring: 0, recoil: 0, headPitch: 0, armL: 0, armR: 0, glow: 0, shake: 0 }, T(ctx, 0.2), Ease.outCubic),
    turn(ctx, robot, homeYaw(robot.team), 0.2),
  ]);
  rig.walk = 0;
  rig.yaw = homeYaw(robot.team);
  ctx.A.tween(rig, { idle: 1 }, 0.3);
}

function glowOf(robot) {
  return TEAMS[robot.team].glow;
}

function softOf(robot) {
  return TEAMS[robot.team].glowSoft;
}

// --- Travel clips -------------------------------------------------------------------------------------------

async function pawnTravel(ctx, robot, to) {
  const { A, sfx } = ctx;
  const rig = robot.rig;
  const sx = rig.x;
  const sz = rig.z;
  const steps = Math.max(1, Math.round(Math.hypot(to.x - sx, to.z - sz) - 0.2));
  const stepTime = T(ctx, 0.3);
  A.tween(rig, { walkAmp: 1, idle: 0.2 }, 0.08);
  for (let i = 1; i <= steps; i++) {
    sfx.play('move.pawn');
    const k = i / steps;
    await Promise.all([A.tween(rig, { x: lerp(sx, to.x, k), z: lerp(sz, to.z, k) }, stepTime, Ease.inOutSine), A.tween(rig, { walk: rig.walk + 2 }, stepTime, Ease.linear)]);
  }
  A.tween(rig, { walkAmp: 0 }, T(ctx, 0.12));
}

async function rookTravel(ctx, robot, to) {
  const { A, fx, sfx } = ctx;
  const rig = robot.rig;
  const dist = Math.hypot(to.x - rig.x, to.z - rig.z);
  const time = T(ctx, 0.28 + dist * 0.075);
  sfx.play('move.rook', { duration: time });
  rig.walkAmp = 1;
  A.tween(rig, { idle: 0 }, 0.1);
  A.tween(rig, { lean: -0.07 }, time * 0.3, Ease.outQuad).then(() => A.tween(rig, { lean: 0.1 }, time * 0.5, Ease.inOutQuad));
  const soft = softOf(robot);
  A.run(time, () => {
    // Small sparks kicked back by the treads.
    if (Math.random() < 0.6) {
      const side = Math.random() < 0.5 ? 0.28 : -0.28;
      _v.set(rig.x + Math.cos(rig.yaw) * side - Math.sin(rig.yaw) * 0.3, 0.05, rig.z - Math.sin(rig.yaw) * side - Math.cos(rig.yaw) * 0.3);
      _w.set(rand(-0.3, 0.3) - Math.sin(rig.yaw) * 0.8, rand(0.4, 1), rand(-0.3, 0.3) - Math.cos(rig.yaw) * 0.8);
      fx.spark(_v, _w, soft, 0.32, 0.035, 5, 1.5, 1.8);
    }
  });
  await A.tween(rig, { x: to.x, z: to.z }, time, Ease.inOutCubic);
  rig.walkAmp = 0;
  A.tween(rig, { lean: 0 }, T(ctx, 0.25), Ease.outBack);
}

async function knightTravel(ctx, robot, to, options = {}) {
  const { A, fx, sfx } = ctx;
  const rig = robot.rig;
  const height = options.height ?? 1.15;
  await A.tween(rig, { spring: 0.95, squash: 0.88, lean: 0.14, idle: 0 }, T(ctx, 0.14), Ease.outQuad);
  sfx.play('move.knight.jump');
  fx.burst(_v.set(rig.x, 0.05, rig.z), 8, { color: softOf(robot), speed: 1.2, up: 0.3, life: 0.35, size: 0.04 });
  const sx = rig.x;
  const sz = rig.z;
  await A.run(T(ctx, 0.46), (k) => {
    rig.x = lerp(sx, to.x, k);
    rig.z = lerp(sz, to.z, k);
    rig.y = height * 4 * k * (1 - k);
    rig.spring = lerp(0.2, -0.55, Math.sin(k * PI));
    rig.squash = 1 + 0.12 * Math.sin(k * PI);
    rig.lean = 0.32 - 0.6 * k;
    options.onFlight?.(k);
  });
  rig.y = 0;
  options.onLand?.();
  const stomp = Boolean(options.stomp);
  sfx.play(stomp ? 'attack.stomp' : 'move.knight.land');
  fx.ring(to, { color: glowOf(robot), size: stomp ? 2.8 : 1.8, life: 0.45 });
  fx.burst(_v.set(to.x, 0.06, to.z), stomp ? 26 : 10, { color: softOf(robot), speed: stomp ? 3 : 1.8, up: 0.25, life: 0.5, size: 0.045 });
  ctx.shake(stomp ? 0.34 : 0.12);
  rig.spring = 0.9;
  rig.squash = 0.78;
  rig.lean = 0.1;
  A.tween(rig, { spring: 0, squash: 1, lean: 0 }, T(ctx, 0.45), Ease.outElastic);
  await A.wait(T(ctx, 0.14));
}

async function bishopTravel(ctx, robot, to) {
  const { A, fx, sfx } = ctx;
  const rig = robot.rig;
  const dist = Math.hypot(to.x - rig.x, to.z - rig.z);
  const time = T(ctx, 0.3 + dist * 0.065);
  sfx.play('move.bishop', { duration: time });
  A.tween(rig, { lean: 0.28, hover: 0.06, idle: 0.3 }, time * 0.3, Ease.outQuad);
  const glow = glowOf(robot);
  A.run(time, () => {
    _v.set(rig.x + rand(-0.06, 0.06), 0.1, rig.z + rand(-0.06, 0.06));
    _w.set(rand(-0.2, 0.2), rand(-0.1, 0.3), rand(-0.2, 0.2));
    fx.spark(_v, _w, glow, 0.45, 0.05, -0.5, 1, 1.6);
  });
  await A.tween(rig, { x: to.x, z: to.z }, time, Ease.inOutCubic);
  A.tween(rig, { lean: -0.1 }, T(ctx, 0.1)).then(() => A.tween(rig, { lean: 0, hover: 0 }, T(ctx, 0.25), Ease.outBack));
}

async function queenTravel(ctx, robot, to, options = {}) {
  const { A, fx, sfx } = ctx;
  const rig = robot.rig;
  const dist = Math.hypot(to.x - rig.x, to.z - rig.z);
  const time = T(ctx, 0.2 + dist * 0.045);
  await A.tween(rig, { spread: 1, special: 1, lean: -0.1, idle: 0.2 }, T(ctx, 0.1), Ease.outQuad);
  sfx.play('move.queen', { duration: time });
  const glow = glowOf(robot);
  const trail = fx.trail((target) => target.set(rig.x, 0, rig.z), { color: glow, low: 0.1, high: robot.height * 0.72 });
  A.tween(rig, { lean: 0.32 }, time * 0.4);
  let fired = false;
  A.run(time, (k) => {
    _v.set(rig.x + rand(-0.15, 0.15), rand(0.15, 1.1), rig.z + rand(-0.15, 0.15));
    _w.set(rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3));
    fx.spark(_v, _w, glow, 0.4, 0.05, 0, 1.5, 1.8);
    if (!fired && k >= 0.8) {
      fired = true;
      options.onNear?.();
    }
  });
  await A.tween(rig, { x: to.x, z: to.z }, time, Ease.inOutQuart);
  if (!fired) options.onNear?.();
  trail.stop();
  A.tween(rig, { lean: -0.12 }, T(ctx, 0.08)).then(() => A.tween(rig, { lean: 0, spread: 0, special: 0 }, T(ctx, 0.3), Ease.outBack));
}

async function kingTravel(ctx, robot, to, options = {}) {
  const { A, fx, sfx } = ctx;
  const rig = robot.rig;
  const time = T(ctx, options.time ?? 0.55);
  sfx.play('move.king');
  A.tween(rig, { walkAmp: 1, idle: 0.2 }, 0.08);
  A.tween(rig, { walk: rig.walk + (options.steps ?? 2) }, time, Ease.inOutSine);
  A.run(time, (k) => {
    rig.armL = Math.sin(k * PI * 2) * 0.5;
    rig.armR = -rig.armL;
  });
  await A.tween(rig, { x: to.x, z: to.z }, time, Ease.inOutSine);
  rig.armL = 0;
  rig.armR = 0;
  A.tween(rig, { walkAmp: 0 }, T(ctx, 0.15));
  fx.ring(to, { size: 1.6, life: 0.35, color: softOf(robot), thickness: 0.09 });
  ctx.shake(0.1);
}

const TRAVEL = { p: pawnTravel, r: rookTravel, n: knightTravel, b: bishopTravel, q: queenTravel, k: kingTravel };

/** Move a robot to a board position in its own style. The robot first turns to face where it is going. */
export async function travel(ctx, robot, to, options = {}) {
  await turn(ctx, robot, yawToward(robot.rig, to), 0.1);
  await TRAVEL[robot.type](ctx, robot, to, options);
}

/** Plain slide for the Minimal preset and for taking moves back. */
export async function slide(ctx, robot, to, seconds = 0.16) {
  await ctx.A.tween(robot.rig, { x: to.x, z: to.z }, seconds, Ease.inOutQuad);
}

// --- Defeat -------------------------------------------------------------------------------------------------

/**
 * A robot falls apart: every joint becomes a loose part that flies off, bounces and fades. Non-violent by design: no fire, just a toy popping apart with sparks.
 * @param {{direction?:THREE.Vector3|null, force?:number}} [options] Push direction and strength.
 */
export function pop(ctx, victim, options = {}) {
  const { fx, sfx, A } = ctx;
  const { direction = null, force = 1 } = options;
  const glow = glowOf(victim);
  const center = victim.getCenter(new THREE.Vector3());
  sfx.play('robot.popapart');
  fx.flash(center, { color: glow, size: 1.7, life: 0.25, power: 2.4 });
  fx.burst(center, 30, { color: glow, color2: FX_COLORS.white, speed: 3.2 * force, up: 0.3, life: 0.75, size: 0.06, gravity: 7 });
  fx.ring({ x: victim.rig.x, y: 0, z: victim.rig.z }, { color: glow, size: 2.1, life: 0.4 });
  ctx.releaseRobot(victim);
  victim.damaged = true;

  // The face screen travels with the part it is mounted on.
  if (victim.faceMesh) {
    const host = victim.meshes.find((mesh) => mesh.userData.joint === victim.blueprint.faceSpec.joint);
    host?.attach(victim.faceMesh);
  }
  victim.group.updateWorldMatrix(true, true);
  let remaining = victim.meshes.length;
  const finish = () => {
    remaining -= 1;
    if (remaining === 0) victim.dispose();
  };
  for (const mesh of victim.meshes) {
    const part = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld);
    const out = part.sub(center);
    out.y = 0;
    if (out.lengthSq() < 1e-4) out.set(rand(-1, 1), 0, rand(-1, 1));
    out.normalize().multiplyScalar(rand(0.7, 1.9) * force);
    out.y = rand(2.3, 4.3) * Math.sqrt(force);
    if (direction) out.addScaledVector(direction, 2.3 * force);
    const spin = new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    fx.addDebris(mesh, out, spin, { life: rand(1.1, 1.7), radius: 0.07, onDone: finish });
  }
  if (victim.marker) A.tween(victim.marker.material, { opacity: 0 }, 0.3);
}

/** The full defeat: lights flicker and fade, the head drops, then the robot pops apart. */
export async function defeat(ctx, victim, options = {}) {
  const { A, sfx } = ctx;
  const rig = victim.rig;
  victim.setMood('dead');
  victim.lookTarget = null;
  sfx.play('robot.powerdown');
  rig.idle = 0;
  A.tween(rig, { headPitch: 0.4, lean: 0.12 }, T(ctx, 0.2), Ease.outQuad);
  await A.run(T(ctx, options.delay ?? 0.24), (k) => {
    rig.power = (1 - k) * (0.6 + 0.4 * Math.sin(k * 40));
    rig.shake = 1 - k;
  });
  rig.power = 0;
  rig.shake = 0;
  pop(ctx, victim, options);
}

/** Instant removal for the Minimal preset: the robot just shrinks away. */
export async function vanish(ctx, victim) {
  ctx.releaseRobot(victim);
  victim.damaged = true;
  await ctx.A.tween(victim.rig, { scale: 0 }, 0.12, Ease.inQuad, { onUpdate: () => victim.update(0, true) });
  victim.dispose();
}

// --- Capture clips ------------------------------------------------------------------------------------------

function direction2D(from, to) {
  return new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
}

async function pawnCapture(ctx, attacker, victim, to) {
  const { A, fx, sfx } = ctx;
  const rig = attacker.rig;
  const glow = glowOf(attacker);
  await A.tween(rig, { glow: 0.5, squash: 0.92, lean: -0.1, idle: 0 }, T(ctx, 0.16), Ease.outQuad);
  sfx.play('attack.zap');
  const from = attacker.getPoint('muzzle', new THREE.Vector3());
  const hit = victim.getCenter(new THREE.Vector3());
  fx.bolt(from, hit, { color: glow });
  fx.bolt(from, hit, { color: FX_COLORS.white, width: 0.035, jitter: 0.1 });
  fx.flash(from, { color: glow, size: 0.9, life: 0.2 });
  fx.burst(hit, 14, { color: glow, speed: 2.5, life: 0.4 });
  A.tween(rig, { glow: 0, squash: 1, lean: 0.1 }, T(ctx, 0.12));
  victim.rig.glow = 0.9;
  A.tween(victim.rig, { glow: 0 }, 0.3);
  ctx.shake(0.12);
  await A.wait(T(ctx, 0.12));
  const dying = defeat(ctx, victim, { direction: direction2D(rig, victim.rig) });
  await A.wait(T(ctx, 0.22));
  attacker.setMood('happy');
  A.tween(rig, { lean: 0 }, 0.1);
  await travel(ctx, attacker, to);
  await dying;
}

async function rookCapture(ctx, attacker, victim, to) {
  const { A, fx, sfx } = ctx;
  const rig = attacker.rig;
  const glow = glowOf(attacker);
  const dist = Math.hypot(victim.rig.x - rig.x, victim.rig.z - rig.z);
  const dir = direction2D(rig, victim.rig);
  rig.idle = 0;
  if (dist < 1.6) {
    // Next to the target: ram it.
    sfx.play('move.rook', { duration: 0.3 });
    rig.walkAmp = 1;
    await A.tween(rig, { lean: -0.12, x: rig.x - dir.x * 0.12, z: rig.z - dir.z * 0.12 }, T(ctx, 0.16), Ease.outQuad);
    await A.tween(rig, { x: lerp(rig.x, victim.rig.x, 0.55), z: lerp(rig.z, victim.rig.z, 0.55), lean: 0.14 }, T(ctx, 0.15), Ease.inCubic);
    sfx.play('attack.ram');
    ctx.shake(0.3);
    fx.flash(victim.getCenter(new THREE.Vector3()), { color: glow, size: 1.8, life: 0.2, power: 2.6 });
    victim.setMood('dead');
    victim.rig.power = 0;
    pop(ctx, victim, { direction: dir, force: 1.5 });
    attacker.setMood('happy');
    await A.tween(rig, { x: to.x, z: to.z, lean: 0 }, T(ctx, 0.24), Ease.outCubic);
    rig.walkAmp = 0;
    return;
  }
  // Far away: fire the cannon, then roll in.
  await A.tween(rig, { glow: 0.35 }, T(ctx, 0.16));
  sfx.play('attack.cannon');
  const from = attacker.getPoint('muzzle', new THREE.Vector3());
  const hit = victim.getCenter(new THREE.Vector3());
  fx.flash(from, { color: glow, size: 1.5, life: 0.18, power: 3 });
  fx.burst(from, 12, { color: glow, direction: dir, speed: 3, life: 0.35, size: 0.05, gravity: 2 });
  rig.recoil = 1;
  A.tween(rig, { recoil: 0, glow: 0 }, T(ctx, 0.4), Ease.outCubic);
  ctx.shake(0.18);
  const ball = fx.createProjectile(glow, 0.075);
  try {
    await A.run(Math.max(0.08, dist / 22), (k) => {
      ball.position.lerpVectors(from, hit, k);
      ball.position.y += Math.sin(k * PI) * 0.12;
      fx.spark(ball.position, _w.set(rand(-0.4, 0.4), rand(-0.2, 0.4), rand(-0.4, 0.4)), glow, 0.25, 0.06, 0, 2, 2);
    });
  } finally {
    fx.removeProjectile(ball);
  }
  fx.flash(hit, { color: glow, size: 2.1, life: 0.22, power: 2.8 });
  ctx.shake(0.26);
  victim.setMood('dead');
  victim.rig.power = 0;
  pop(ctx, victim, { direction: dir, force: 1.3 });
  await A.wait(T(ctx, 0.18));
  attacker.setMood('happy');
  await travel(ctx, attacker, to);
}

async function knightCapture(ctx, attacker, victim, to) {
  const squashStart = 0.84;
  await knightTravel(ctx, attacker, to, {
    stomp: true,
    height: 1.45,
    onFlight: (k) => {
      // The target is flattened in the last moment before the landing.
      if (k > squashStart) victim.rig.squash = lerp(1, 0.32, (k - squashStart) / (1 - squashStart));
    },
    onLand: () => {
      victim.setMood('dead');
      victim.rig.power = 0;
      pop(ctx, victim, { force: 1.25 });
      attacker.setMood('happy');
    },
  });
}

async function bishopCapture(ctx, attacker, victim, to) {
  const { A, fx, sfx } = ctx;
  const rig = attacker.rig;
  const glow = glowOf(attacker);
  await A.tween(rig, { glow: 0.5, special: 1, hover: 0.08, idle: 0 }, T(ctx, 0.2), Ease.outQuad);
  sfx.play('attack.beam');
  const from = attacker.getPoint('muzzle', new THREE.Vector3());
  const hit = victim.getCenter(new THREE.Vector3());
  const beamTime = T(ctx, 0.42);
  fx.beam(from, hit, { color: glow, life: beamTime, width: 0.15 });
  fx.flash(from, { color: glow, size: 1.1, life: 0.3 });
  A.run(beamTime * 0.75, (k) => {
    victim.rig.shake = 1;
    victim.rig.glow = 0.35 + 0.55 * k;
    fx.spark(hit, _w.set(rand(-1.5, 1.5), rand(0, 2), rand(-1.5, 1.5)), glow, 0.35, 0.05, 5, 1, 2);
  });
  await A.wait(beamTime * 0.75);
  victim.rig.glow = 0;
  const dying = defeat(ctx, victim, { delay: 0.1, direction: direction2D(rig, victim.rig) });
  A.tween(rig, { glow: 0, special: 0, hover: 0 }, T(ctx, 0.2));
  await A.wait(T(ctx, 0.22));
  attacker.setMood('happy');
  await travel(ctx, attacker, to);
  await dying;
}

async function queenCapture(ctx, attacker, victim, to) {
  const { A, fx, sfx } = ctx;
  const rig = attacker.rig;
  const glow = glowOf(attacker);
  const dir = direction2D(rig, victim.rig);
  await turn(ctx, attacker, yawToward(rig, to), 0.1);
  await queenTravel(ctx, attacker, to, {
    onNear: () => {
      // The strike: a bright slash across the target at the end of the dash.
      sfx.play('attack.slash');
      const hit = victim.getCenter(new THREE.Vector3());
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const a = hit.clone().addScaledVector(side, 0.7).add(_v.set(0, 0.55, 0));
      const b = hit.clone().addScaledVector(side, -0.7).add(_v.set(0, -0.35, 0));
      fx.beam(a, b, { color: glow, life: 0.2, width: 0.2 });
      fx.flash(hit, { color: glow, size: 2, life: 0.22, power: 2.8 });
      ctx.shake(0.24);
      victim.setMood('dead');
      victim.rig.power = 0;
      pop(ctx, victim, { direction: dir, force: 1.35 });
      attacker.setMood('happy');
    },
  });
  // A proud twirl after the strike.
  await A.tween(rig, { twist: PI * 2 }, T(ctx, 0.38), Ease.outCubic);
  rig.twist = 0;
}

async function kingCapture(ctx, attacker, victim, to) {
  const { A, fx, sfx } = ctx;
  const rig = attacker.rig;
  const glow = glowOf(attacker);
  const dir = direction2D(rig, victim.rig);
  const mid = { x: lerp(rig.x, victim.rig.x, 0.4), z: lerp(rig.z, victim.rig.z, 0.4) };
  await kingTravel(ctx, attacker, mid, { time: 0.32, steps: 1 });
  // Slow wind-up, then a heavy hit.
  await A.tween(rig, { armR: 2.7, lean: -0.15, twist: 0.25 }, T(ctx, 0.3), Ease.outQuad);
  await A.wait(T(ctx, 0.07));
  await A.tween(rig, { armR: 0.9, lean: 0.4, twist: -0.15 }, T(ctx, 0.1), Ease.inCubic);
  sfx.play('attack.smash');
  ctx.shake(0.42);
  const hit = victim.getCenter(new THREE.Vector3());
  fx.flash(hit, { color: glow, size: 2.3, life: 0.24, power: 3 });
  fx.ring({ x: victim.rig.x, y: 0, z: victim.rig.z }, { color: glow, size: 3.2, life: 0.5 });
  victim.rig.squash = 0.4;
  victim.setMood('dead');
  victim.rig.power = 0;
  pop(ctx, victim, { direction: dir, force: 1.4 });
  A.tween(rig, { armR: 0, lean: 0, twist: 0 }, T(ctx, 0.3), Ease.outBack);
  await A.wait(T(ctx, 0.22));
  attacker.setMood('happy');
  await kingTravel(ctx, attacker, to, { time: 0.36, steps: 1 });
}

const CAPTURE = { p: pawnCapture, r: rookCapture, n: knightCapture, b: bishopCapture, q: queenCapture, k: kingCapture };

/** The attacker takes the victim in its own style and ends on the square `to`. */
export async function capture(ctx, attacker, victim, to) {
  attacker.setMood('fierce');
  victim.setMood('scared');
  victim.lookTarget = attacker.getCenter(new THREE.Vector3());
  // The knight and the queen turn inside their travel; the others first face their target.
  if (attacker.type !== 'n' && attacker.type !== 'q') await turn(ctx, attacker, yawToward(attacker.rig, victim.rig), 0.1);
  if (ctx.cinematic) {
    ctx.focus(victim.getCenter(new THREE.Vector3()), 0.6);
    await ctx.A.wait(0.25);
  }
  try {
    await CAPTURE[attacker.type](ctx, attacker, victim, to);
  } finally {
    if (ctx.cinematic) ctx.release();
  }
}

/** Capture for a piece the player dropped by hand: it is already above the square, so it just strikes down. */
export async function dropCapture(ctx, attacker, victim) {
  const { fx, sfx } = ctx;
  sfx.play(attacker.type === 'n' ? 'attack.stomp' : 'attack.zap');
  fx.flash(victim.getCenter(new THREE.Vector3()), { color: glowOf(attacker), size: 1.8, life: 0.2, power: 2.6 });
  ctx.shake(0.2);
  victim.setMood('dead');
  victim.rig.power = 0;
  pop(ctx, victim, { force: 1.2 });
  attacker.setMood('happy');
}

// --- Special moments ----------------------------------------------------------------------------------------

/** Teleport: the robot is wiped away from the top down inside a column of light and built up again at the new place. */
export async function teleport(ctx, robot, to) {
  const { A, fx } = ctx;
  const rig = robot.rig;
  const glow = glowOf(robot);
  const top = robot.height + 0.25;
  rig.idle = 0;
  fx.column({ x: rig.x, z: rig.z }, { color: glow, life: T(ctx, 0.5), height: 3.2 });
  rig.wipe = top;
  await A.tween(rig, { wipe: 0 }, T(ctx, 0.28), Ease.inQuad);
  fx.burst(_v.set(rig.x, 0.3, rig.z), 16, { color: glow, speed: 1.6, up: 1, life: 0.5, size: 0.05, gravity: -1 });
  rig.x = to.x;
  rig.z = to.z;
  fx.column(to, { color: glow, life: T(ctx, 0.5), height: 3.2 });
  await A.tween(rig, { wipe: top }, T(ctx, 0.3), Ease.outQuad);
  rig.wipe = 1000;
  fx.ring(to, { color: glow, size: 1.9, life: 0.4 });
  A.tween(rig, { idle: 1 }, 0.3);
}

/** Castling: king and rook swap sides with a short teleport. */
export async function castle(ctx, king, rook, kingTo, rookTo) {
  ctx.sfx.play('castle');
  await Promise.all([teleport(ctx, king, kingTo), ctx.A.wait(T(ctx, 0.08)).then(() => teleport(ctx, rook, rookTo))]);
}

/**
 * Promotion, the biggest moment in the game: the pawn rises, spins into a ball of light, and the new piece is built out of that light part by part, from the feet up.
 * @param {object} pawn The pawn robot standing on the last rank.
 * @param {object} next The new robot, already placed on the same square and hidden.
 * @param {(robot:object)=>void} discard Removes the old pawn.
 */
export async function promote(ctx, pawn, next, discard) {
  const { A, fx, sfx } = ctx;
  const rig = pawn.rig;
  const glow = glowOf(pawn);
  const pos = { x: rig.x, z: rig.z };
  ctx.focus(new THREE.Vector3(pos.x, 0.7, pos.z), 0.85);
  try {
    sfx.play('promote.start');
    pawn.setMood('wow');
    rig.idle = 0;
    fx.column(pos, { color: glow, life: T(ctx, 2.2), height: 4.6, radius: 0.58 });
    await Promise.all([A.tween(rig, { y: 0.55, glow: 1 }, T(ctx, 0.5), Ease.outCubic), A.tween(rig, { yaw: rig.yaw + PI * 6 }, T(ctx, 0.72), Ease.inCubic), A.tween(rig, { scale: 0.22 }, T(ctx, 0.72), Ease.inBack)]);
    const core = new THREE.Vector3(pos.x, 0.85, pos.z);
    fx.flash(core, { color: glow, size: 2.4, life: 0.4, power: 3 });
    fx.burst(core, 44, { color: glow, color2: FX_COLORS.white, speed: 2.6, life: 0.8, size: 0.06, gravity: 1, drag: 2 });
    discard(pawn);

    // Build the new robot part by part, lowest part first. Each part flies out of the light and snaps into place.
    next.group.visible = true;
    next.rig.idle = 0;
    next.rig.power = 0;
    next.update(0, true);
    next.group.updateWorldMatrix(true, true);
    if (next.faceMesh) next.faceMesh.visible = false;
    const parts = next.meshes
      .map((mesh) => ({ mesh, height: mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld).y }))
      .sort((a, b) => a.height - b.height);
    for (const { mesh } of parts) mesh.visible = false;
    const snaps = [];
    let index = 0;
    for (const { mesh, height } of parts) {
      const start = mesh.parent.worldToLocal(core.clone());
      mesh.position.copy(start);
      mesh.scale.setScalar(0.02);
      mesh.visible = true;
      sfx.play('promote.build', { pitch: 0.85 + index * 0.09 });
      const where = new THREE.Vector3(pos.x, height, pos.z);
      snaps.push(
        Promise.all([A.tween(mesh.position, { x: 0, y: 0, z: 0 }, T(ctx, 0.26), Ease.outBack), A.tween(mesh.scale, { x: 1, y: 1, z: 1 }, T(ctx, 0.26), Ease.outBack)]).then(() => {
          fx.burst(where, 7, { color: glow, speed: 1.3, life: 0.35, size: 0.04 });
          fx.flash(where, { color: glow, size: 0.7, life: 0.15, power: 1.8 });
        }),
      );
      index += 1;
      await A.wait(T(ctx, 0.13));
    }
    await Promise.all(snaps);
    for (const { mesh } of parts) {
      mesh.position.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
    }

    // Power on.
    if (next.faceMesh) next.faceMesh.visible = true;
    await A.run(T(ctx, 0.32), (k) => {
      next.rig.power = k * (0.7 + 0.3 * Math.sin(k * 30));
    });
    next.rig.power = 1;
    sfx.play('promote.done');
    next.setMood('happy');
    fx.ring(pos, { size: 3.6, life: 0.6, color: glow });
    fx.burst(new THREE.Vector3(pos.x, next.height, pos.z), 50, { color: glow, color2: FX_COLORS.white, speed: 3.4, up: 0.5, life: 0.9, size: 0.06, gravity: 5 });
    fx.flash(new THREE.Vector3(pos.x, next.height * 0.6, pos.z), { color: glow, size: 3.2, life: 0.4, power: 2.6 });
    ctx.shake(0.22);
    ctx.screenFlash(glow, 0.22);
    await A.tween(next.rig, { y: 0.4, squash: 1.1 }, T(ctx, 0.16), Ease.outQuad);
    await A.tween(next.rig, { y: 0, squash: 1 }, T(ctx, 0.2), Ease.inQuad);
    next.rig.squash = 0.86;
    A.tween(next.rig, { squash: 1 }, T(ctx, 0.3), Ease.outElastic);
    A.tween(next.rig, { idle: 1 }, 0.3);
    await A.wait(T(ctx, 0.25));
  } finally {
    ctx.release();
  }
}

/** A quick happy hop used for selection and small wins. */
export async function hop(ctx, robot, height = 0.14) {
  const { A } = ctx;
  await A.tween(robot.rig, { y: height, squash: 1.06 }, 0.09, Ease.outQuad);
  await A.tween(robot.rig, { y: 0, squash: 1 }, 0.16, Ease.outBounce);
}

/** The king notices it is in check: a jump of fright and a tremble. */
export async function checkAlarm(ctx, king) {
  const { A } = ctx;
  king.setMood('scared');
  A.tween(king.rig, { y: 0.16 }, 0.08, Ease.outQuad).then(() => A.tween(king.rig, { y: 0 }, 0.14, Ease.inQuad));
  await A.run(0.55, (k) => {
    king.rig.shake = 1 - k;
    king.rig.spread = 0.5 * (1 - k);
  });
  king.rig.shake = 0;
  king.rig.spread = 0;
}

/** Winners jump for joy. Hops are staggered so the whole team ripples. */
export async function celebrate(ctx, robots, fireworksArea = null) {
  const { A, fx } = ctx;
  const jobs = robots.map(async (robot, i) => {
    robot.setMood('happy');
    robot.lookTarget = null;
    const rig = robot.rig;
    await A.wait(0.05 * (i % 8) + rand(0, 0.15));
    for (let n = 0; n < 3; n++) {
      A.tween(rig, { spread: 1, special: 1 }, 0.15);
      if (n === 1) A.tween(rig, { twist: rig.twist + PI * 2 }, 0.5, Ease.inOutCubic);
      await A.tween(rig, { y: rand(0.3, 0.5), squash: 1.08, spring: -0.4 }, 0.2, Ease.outQuad);
      await A.tween(rig, { y: 0, squash: 0.9, spring: 0.6 }, 0.2, Ease.inQuad);
      await A.tween(rig, { squash: 1, spring: 0 }, 0.12, Ease.outQuad);
    }
    rig.twist = 0;
    A.tween(rig, { spread: 0, special: 0 }, 0.3);
  });
  if (fireworksArea && robots.length > 0) {
    const glow = glowOf(robots[0]);
    const soft = softOf(robots[0]);
    jobs.push(
      (async () => {
        for (let i = 0; i < 9; i++) {
          const p = new THREE.Vector3(rand(-3.5, 3.5), rand(2.2, 3.6), rand(-3.5, 3.5));
          fx.flash(p, { color: glow, size: 1.6, life: 0.3, power: 2.4 });
          fx.burst(p, 46, { color: glow, color2: i % 2 ? soft : FX_COLORS.white, speed: 3, life: 1.1, size: 0.06, gravity: 2.5, drag: 1.6 });
          ctx.sfx.play('robot.happy', { pitch: rand(0.9, 1.3), gain: 0.5 });
          await A.wait(rand(0.18, 0.34));
        }
      })(),
    );
  }
  await Promise.all(jobs);
}

/** Checkmate: the losing king shuts down and drops its crown, its team is sad, then the winners celebrate. */
export async function checkmate(ctx, loser, winners, losers) {
  const { A, fx, sfx } = ctx;
  const rig = loser.rig;
  ctx.focus(loser.getCenter(new THREE.Vector3()), 0.9);
  try {
    loser.setMood('scared');
    loser.lookTarget = null;
    rig.idle = 0;
    await A.run(0.5, (k) => {
      rig.shake = 0.4 + 0.6 * k;
    });
    sfx.play('robot.powerdown', { pitch: 0.8 });
    loser.setMood('dead');
    await A.run(0.7, (k) => {
      rig.power = (1 - k) * (0.5 + 0.5 * Math.sin(k * 50));
      rig.shake = 1 - k;
      rig.headPitch = 0.55 * k;
      rig.lean = 0.2 * k;
      rig.squash = 1 - 0.06 * k;
    });
    rig.power = 0;
    rig.shake = 0;
    // The crown falls off and stays on the board.
    const crown = loser.meshes.find((mesh) => mesh.userData.joint === 'crown');
    if (crown) {
      loser.damaged = true;
      loser.meshes = loser.meshes.filter((mesh) => mesh !== crown);
      const forward = new THREE.Vector3(Math.sin(rig.yaw), 0, Math.cos(rig.yaw));
      fx.addDebris(crown, forward.multiplyScalar(0.9).add(_v.set(rand(-0.4, 0.4), 1.7, 0)), new THREE.Vector3(rand(3, 6), rand(-2, 2), rand(-3, 3)), { life: 1e9, radius: 0.06 });
      sfx.play('piece.drop', { delay: 0.45 });
    }
    for (const robot of losers) {
      if (robot !== loser) robot.setMood('sad');
    }
    await A.wait(0.7);
  } finally {
    ctx.release();
  }
  await celebrate(ctx, winners, true);
}
