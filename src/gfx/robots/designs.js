// The six robot designs. Each one has a single exaggerated feature no other piece shares (the readability rule): the pawn's one big eye, the rook's castle turret on treads, the knight's horse head on springs, the bishop's pointed hovering body, the queen's floating crown, the king's bulk and cross antenna. Robots face +z. "L" parts are on +x.
import { Blueprint, G } from './builder.js';
import { SLOT } from '../palette.js';

const { SHELL, SHELL2, METAL, DARK, GLOW, GLOW2, GLASS } = SLOT;
const HALF_PI = Math.PI / 2;

function pawn() {
  const b = new Blueprint('p');
  b.joint('body', 'root', [0, 0.31, 0]);
  b.joint('footL', 'root', [0.105, 0, 0.01]);
  b.joint('footR', 'root', [-0.105, 0, 0.01]);
  for (const foot of ['footL', 'footR']) {
    b.part(foot, G.sphere(0.075, 16, 10), SHELL2, { p: [0, 0.05, 0.012], s: [1, 0.62, 1.38] });
    b.part(foot, G.cyl(0.07, 0.078, 0.022, 16), DARK, { p: [0, 0.011, 0.012], s: [1, 1, 1.35] });
    b.part(foot, G.cyl(0.026, 0.03, 0.1, 10), METAL, { p: [0, 0.12, 0] });
  }
  // Egg body.
  b.part('body', G.latheSmooth([[0, -0.17], [0.12, -0.155], [0.19, -0.07], [0.206, 0.03], [0.176, 0.13], [0.1, 0.2], [0, 0.222]], 28, 26), SHELL);
  b.part('body', G.torus(0.203, 0.011, 8, 36), GLOW, { p: [0, -0.045, 0], r: [HALF_PI, 0, 0] });
  // The one big eye: a short lens barrel that sticks out of the shell like a camera, with a metal collar around the screen.
  b.part('body', G.cyl(0.124, 0.132, 0.075, 28), METAL, { p: [0, 0.06, 0.186], r: [HALF_PI, 0, 0] });
  b.part('body', G.torus(0.117, 0.017, 10, 32), SHELL2, { p: [0, 0.06, 0.222] });
  b.part('body', G.cyl(0.11, 0.11, 0.01, 24), GLASS, { p: [0, 0.06, 0.221], r: [HALF_PI, 0, 0] });
  // Side thruster pods.
  b.pair('body', () => G.cyl(0.048, 0.048, 0.05, 14), METAL, { p: [0.203, -0.01, -0.02], r: [0, 0, HALF_PI] });
  b.pair('body', () => G.cyl(0.03, 0.03, 0.012, 12), GLOW, { p: [0.231, -0.01, -0.02], r: [0, 0, HALF_PI] });
  // Top light and the power cell on the back, so the pawn also reads from above and from behind.
  b.part('body', G.hemisphere(0.046, 16, 6), GLOW2, { p: [0, 0.2, 0] });
  b.part('body', G.cyl(0.058, 0.064, 0.016, 16), METAL, { p: [0, 0.2, 0] });
  b.part('body', G.box(0.085, 0.16, 0.03, 0.014), DARK, { p: [0, 0.01, -0.19], r: [0.08, 0, 0] });
  b.part('body', G.capsule(0.017, 0.085, 4, 10), GLOW, { p: [0, 0.01, -0.204], r: [0.08, 0, 0] });
  b.face('body', { w: 0.212, h: 0.212, p: [0, 0.06, 0.2285], curve: 0.5, spherical: true, eyes: 1, corner: 0.5, shape: { w: 0.24, h: 0.24, round: 1, gap: 0 } });
  b.info = { height: 0.55, radius: 0.24, muzzle: [0, 0.37, 0.25], headHeight: 0.37 };
  return b.finalize();
}

function rook() {
  const b = new Blueprint('r');
  b.joint('treadL', 'root', [0.235, 0.105, 0]);
  b.joint('treadR', 'root', [-0.235, 0.105, 0]);
  b.joint('body', 'root', [0, 0.2, 0]);
  b.joint('head', 'body', [0, 0.17, -0.02]);
  b.joint('cannon', 'head', [0, 0.035, 0.17]);
  for (const [tread, side] of [['treadL', 1], ['treadR', -1]]) {
    b.part(tread, G.box(0.15, 0.21, 0.6, 0.074, 4), DARK);
    b.part(tread, G.box(0.022, 0.1, 0.4, 0.01), SHELL2, { p: [side * 0.076, 0.005, 0] });
    for (const z of [-0.19, 0, 0.19]) {
      b.part(tread, G.cyl(0.043, 0.043, 0.03, 14), METAL, { p: [side * 0.082, -0.012, z], r: [0, 0, HALF_PI] });
      b.part(tread, G.cyl(0.016, 0.016, 0.034, 8), GLOW2, { p: [side * 0.084, -0.012, z], r: [0, 0, HALF_PI] });
    }
    b.part(tread, G.box(0.05, 0.012, 0.38, 0.005), GLOW, { p: [0, 0.106, 0] });
  }
  // Hull.
  b.part('body', G.box(0.38, 0.19, 0.5, 0.055, 4), SHELL, { p: [0, 0.065, 0] });
  b.part('body', G.box(0.33, 0.07, 0.06, 0.025), SHELL2, { p: [0, 0.0, 0.262] });
  b.pair('body', () => G.sphere(0.028, 12, 8), GLOW, { p: [0.115, 0.012, 0.29], s: [1, 1, 0.5] });
  b.part('body', G.box(0.27, 0.085, 0.03, 0.012), DARK, { p: [0, 0.075, -0.252] });
  b.pair('body', () => G.box(0.085, 0.022, 0.02, 0.008), GLOW, { p: [0.075, 0.075, -0.268] });
  // Castle turret.
  b.part('head', G.cyl(0.165, 0.19, 0.045, 28), METAL, { p: [0, 0.0, 0] });
  b.part('head', G.cyl(0.2, 0.2, 0.25, 32), SHELL, { p: [0, 0.145, 0] });
  b.part('head', G.cyl(0.216, 0.204, 0.035, 32), SHELL2, { p: [0, 0.278, 0] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.part('head', G.box(0.1, 0.1, 0.062, 0.016), SHELL, { p: [Math.sin(a) * 0.185, 0.335, Math.cos(a) * 0.185], r: [0, a, 0] });
  }
  b.part('head', G.cyl(0.15, 0.15, 0.012, 28), GLOW2, { p: [0, 0.298, 0] });
  b.part('head', G.cyl(0.07, 0.085, 0.03, 20), METAL, { p: [0, 0.31, 0] });
  // Cannon under the face.
  b.part('cannon', G.cyl(0.052, 0.052, 0.05, 16), METAL, { p: [0, 0, 0.03], r: [HALF_PI, 0, 0] });
  b.part('cannon', G.cyl(0.036, 0.042, 0.2, 16), METAL, { p: [0, 0, 0.13], r: [HALF_PI, 0, 0] });
  b.part('cannon', G.torus(0.04, 0.013, 8, 20), GLOW, { p: [0, 0, 0.232] });
  b.part('cannon', G.cyl(0.028, 0.028, 0.01, 12), DARK, { p: [0, 0, 0.232], r: [HALF_PI, 0, 0] });
  b.face('head', { w: 0.27, h: 0.125, p: [0, 0.165, 0.2035], curve: 0.2035, eyes: 2, corner: 0.36, shape: { w: 0.25, h: 0.21, round: 0.45, gap: 0.5 } });
  b.info = { height: 0.76, radius: 0.33, muzzle: [0, 0.405, 0.4], headHeight: 0.53 };
  return b.finalize();
}

function knight() {
  const b = new Blueprint('n');
  b.joint('legL', 'root', [0.115, 0, 0]);
  b.joint('legR', 'root', [-0.115, 0, 0]);
  b.joint('springL', 'legL', [0, 0.052, 0]);
  b.joint('springR', 'legR', [0, 0.052, 0]);
  b.joint('body', 'root', [0, 0.25, 0]);
  b.joint('head', 'body', [0, 0.565, 0.075]);
  for (const leg of ['legL', 'legR']) {
    b.part(leg, G.cyl(0.085, 0.097, 0.036, 18), DARK, { p: [0, 0.018, 0] });
    b.part(leg, G.cyl(0.068, 0.085, 0.02, 18), METAL, { p: [0, 0.044, 0] });
  }
  for (const spring of ['springL', 'springR']) {
    b.part(spring, G.spring(0.045, 0.2, 4.5, 0.0115), METAL);
    b.part(spring, G.cyl(0.014, 0.014, 0.2, 8), GLOW2, { p: [0, 0.1, 0] });
  }
  // Hips, barrel torso, chest light and a little glowing tail.
  b.part('body', G.box(0.34, 0.085, 0.2, 0.04), SHELL2, { p: [0, 0.03, 0] });
  b.part('body', G.latheSmooth([[0, 0.05], [0.13, 0.06], [0.166, 0.14], [0.17, 0.24], [0.13, 0.33], [0, 0.365]], 26, 22), SHELL, { s: [1, 1, 0.86] });
  b.part('body', G.sphere(0.042, 14, 10), GLOW, { p: [0, 0.2, 0.135], s: [1, 1, 0.45] });
  b.part('body', G.torus(0.05, 0.011, 8, 18), METAL, { p: [0, 0.2, 0.139] });
  b.part('body', G.capsule(0.019, 0.1, 4, 10), GLOW, { p: [0, 0.13, -0.185], r: [-0.95, 0, 0] });
  // Neck leaning forward, with a mane of light fins down its back.
  b.part('body', G.capsule(0.072, 0.2, 5, 14), SHELL, { p: [0, 0.445, 0.035], r: [0.26, 0, 0] });
  for (let i = 0; i < 5; i++) {
    b.part('body', G.box(0.022, 0.07, 0.075, 0.009), GLOW, { p: [0, 0.33 + i * 0.062, -0.058 + i * 0.015], r: [0.26 - 0.5, 0, 0] });
  }
  // Horse head: skull, long snout, ears.
  b.part('head', G.box(0.175, 0.175, 0.2, 0.062, 4), SHELL, { p: [0, 0.03, 0.015] });
  b.part('head', G.box(0.128, 0.118, 0.21, 0.046, 4), SHELL, { p: [0, -0.04, 0.165], r: [0.36, 0, 0] });
  b.part('head', G.box(0.112, 0.075, 0.05, 0.026), SHELL2, { p: [0, -0.083, 0.258], r: [0.36, 0, 0] });
  b.pair('head', () => G.sphere(0.012, 8, 6), GLOW, { p: [0.03, -0.074, 0.287] });
  b.pair('head', () => G.cone(0.038, 0.12, 10), SHELL, { p: [0.062, 0.158, -0.035], r: [-0.12, 0, -0.2] });
  b.pair('head', () => G.cone(0.02, 0.075, 8), GLOW, { p: [0.062, 0.15, -0.02], r: [-0.12, 0, -0.2] });
  b.part('head', G.box(0.15, 0.03, 0.12, 0.012), SHELL2, { p: [0, -0.07, 0.01] });
  b.face('head', { w: 0.156, h: 0.082, p: [0, 0.062, 0.1175], r: [-0.1, 0, 0], eyes: 2, corner: 0.34, shape: { w: 0.2, h: 0.24, round: 1, gap: 0.42, tilt: 0.18 } });
  b.info = { height: 1.03, radius: 0.24, muzzle: [0, 0.75, 0.36], headHeight: 0.84, springHeight: 0.2 };
  return b.finalize();
}

function bishop() {
  const b = new Blueprint('b');
  b.joint('thruster', 'root', [0, 0, 0]);
  b.joint('body', 'root', [0, 0.12, 0]);
  b.joint('collar', 'body', [0, 0.615, 0]);
  b.joint('head', 'body', [0, 0.655, 0]);
  // Hover ring near the ground.
  b.part('thruster', G.torus(0.105, 0.017, 8, 28), METAL, { p: [0, 0.075, 0], r: [HALF_PI, 0, 0] });
  b.part('thruster', G.cyl(0.07, 0.045, 0.02, 20), GLOW, { p: [0, 0.062, 0] });
  // Slim teardrop body with a diagonal sash of light (it moves on diagonals).
  b.part('body', G.latheSmooth([[0, 0], [0.045, 0.015], [0.07, 0.09], [0.12, 0.24], [0.158, 0.38], [0.152, 0.47], [0.105, 0.56], [0.066, 0.61], [0.05, 0.64]], 28, 28), SHELL);
  b.part('body', G.torus(0.153, 0.0125, 8, 36), GLOW, { p: [0, 0.4, 0], r: [HALF_PI, 0, 0.5] });
  b.part('body', G.capsule(0.014, 0.2, 4, 8), GLOW2, { p: [0, 0.4, -0.154], r: [0.03, 0, 0] });
  b.pair('body', () => G.box(0.012, 0.26, 0.07, 0.005), SHELL2, { p: [0.085, 0.42, -0.155], r: [0.06, 0.5, 0] });
  // Floating collar.
  b.part('collar', G.torus(0.128, 0.021, 10, 32), SHELL2, { r: [HALF_PI, 0, 0] });
  b.part('collar', G.torus(0.128, 0.008, 6, 32), GLOW, { p: [0, 0.024, 0], r: [HALF_PI, 0, 0] });
  // Pointed mitre head with the bishop's slanted slit as a band of light.
  b.part('head', G.cyl(0.036, 0.046, 0.05, 14), METAL, { p: [0, -0.01, 0] });
  b.part('head', G.latheSmooth([[0, 0.0], [0.075, 0.008], [0.124, 0.07], [0.13, 0.13], [0.102, 0.21], [0.05, 0.3], [0, 0.345]], 28, 26), SHELL);
  b.part('head', G.torus(0.104, 0.0095, 6, 30), GLOW, { p: [0, 0.215, 0], r: [HALF_PI, 0, 0.62] });
  b.part('head', G.sphere(0.022, 12, 8), GLOW, { p: [0, 0.35, 0] });
  b.face('head', { w: 0.172, h: 0.098, p: [0, 0.1, 0.133], curve: 0.134, spherical: true, eyes: 2, corner: 0.36, shape: { w: 0.115, h: 0.27, round: 1, gap: 0.36 } });
  b.info = { height: 1.13, radius: 0.18, muzzle: [0, 0.9, 0.18], headHeight: 0.9, hover: 0.12 };
  return b.finalize();
}

function queen() {
  const b = new Blueprint('q');
  b.joint('body', 'root', [0, 0.07, 0]);
  b.joint('wingL', 'body', [0.125, 0.66, -0.12]);
  b.joint('wingR', 'body', [-0.125, 0.66, -0.12]);
  b.joint('head', 'body', [0, 0.955, 0]);
  b.joint('crown', 'head', [0, 0.118, 0]);
  // Hovering bell gown with a glowing hem.
  b.part('body', G.latheSmooth([[0.0, 0.012], [0.19, 0.0], [0.236, 0.03], [0.205, 0.13], [0.125, 0.33], [0.072, 0.47], [0.064, 0.52]], 32, 28), SHELL);
  b.part('body', G.torus(0.233, 0.0125, 8, 44), GLOW, { p: [0, 0.032, 0], r: [HALF_PI, 0, 0] });
  b.part('body', G.disc(0.185, 28), GLOW2, { p: [0, 0.004, 0], r: [HALF_PI, 0, 0] });
  b.part('body', G.torus(0.159, 0.006, 6, 40), GLOW2, { p: [0, 0.235, 0], r: [HALF_PI, 0, 0] });
  b.part('body', G.torus(0.074, 0.0145, 8, 24), METAL, { p: [0, 0.505, 0], r: [HALF_PI, 0, 0] });
  // Torso, chest gem, floating shoulders.
  b.part('body', G.latheSmooth([[0.058, 0.5], [0.1, 0.56], [0.126, 0.66], [0.112, 0.76], [0.062, 0.83], [0.04, 0.87]], 26, 22), SHELL);
  b.part('body', G.octa(0.034), GLOW, { p: [0, 0.69, 0.118], s: [0.8, 1.25, 0.5] });
  b.pair('body', () => G.sphere(0.056, 14, 10), SHELL2, { p: [0.158, 0.775, 0], s: [1, 0.72, 1] });
  b.part('body', G.cyl(0.032, 0.042, 0.07, 12), METAL, { p: [0, 0.885, 0] });
  // Floating blade wings behind the shoulders.
  for (const [wing, side] of [['wingL', 1], ['wingR', -1]]) {
    b.part(wing, G.extrude([[0, 0.2], [0.04, 0.02], [0, -0.25], [-0.04, 0.02]], 0.012, 0.004), SHELL2, { r: [0.12, side * 0.5, side * -0.42] });
    b.part(wing, G.capsule(0.006, 0.26, 3, 6), GLOW, { p: [0, -0.02, -0.012], r: [0.12, side * 0.5, side * -0.42] });
  }
  // Head and the crown of floating points.
  b.part('head', G.sphere(0.116, 26, 18), SHELL, { s: [1, 1.05, 1] });
  b.part('crown', G.torus(0.083, 0.0115, 8, 28), METAL, { r: [HALF_PI, 0, 0] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.part('crown', G.octa(0.03), GLOW, { p: [Math.sin(a) * 0.108, 0.075, Math.cos(a) * 0.108], s: [0.72, 2.0, 0.72] });
  }
  b.part('crown', G.octa(0.034), GLOW, { p: [0, 0.13, 0], s: [0.85, 2.5, 0.85] });
  b.face('head', { w: 0.175, h: 0.098, p: [0, 0.008, 0.1195], curve: 0.12, spherical: true, eyes: 2, corner: 0.38, shape: { w: 0.17, h: 0.21, round: 1, gap: 0.38, tilt: 0.3 } });
  b.info = { height: 1.34, radius: 0.25, muzzle: [0, 0.76, 0.2], headHeight: 1.03, hover: 0.07 };
  return b.finalize();
}

function king() {
  const b = new Blueprint('k');
  b.joint('legL', 'root', [0.125, 0, 0]);
  b.joint('legR', 'root', [-0.125, 0, 0]);
  b.joint('body', 'root', [0, 0.27, 0]);
  b.joint('armL', 'body', [0.305, 0.43, 0]);
  b.joint('armR', 'body', [-0.305, 0.43, 0]);
  b.joint('head', 'body', [0, 0.6, 0]);
  b.joint('crown', 'head', [0, 0.262, 0]);
  for (const leg of ['legL', 'legR']) {
    b.part(leg, G.box(0.172, 0.11, 0.26, 0.046, 4), SHELL2, { p: [0, 0.07, 0.022] });
    b.part(leg, G.box(0.182, 0.03, 0.272, 0.012), DARK, { p: [0, 0.016, 0.022] });
    b.part(leg, G.cyl(0.056, 0.066, 0.17, 16), METAL, { p: [0, 0.19, 0] });
    b.part(leg, G.box(0.1, 0.016, 0.02, 0.006), GLOW, { p: [0, 0.075, 0.153] });
  }
  // Broad barrel chest with a glowing core, belt of light and a power pack on the back.
  b.part('body', G.box(0.38, 0.12, 0.26, 0.05, 4), SHELL2, { p: [0, 0.04, 0] });
  b.part('body', G.latheSmooth([[0, 0.06], [0.2, 0.07], [0.252, 0.16], [0.276, 0.32], [0.25, 0.45], [0.17, 0.53], [0, 0.552]], 30, 26), SHELL, { s: [1, 1, 0.82] });
  b.part('body', G.torus(0.243, 0.014, 8, 40), GLOW, { p: [0, 0.135, 0], r: [HALF_PI, 0, 0], s: [1, 0.82, 1] });
  b.part('body', G.cyl(0.074, 0.074, 0.03, 22), GLOW, { p: [0, 0.335, 0.213], r: [HALF_PI, 0, 0] });
  b.part('body', G.torus(0.084, 0.016, 8, 26), METAL, { p: [0, 0.335, 0.215] });
  b.part('body', G.box(0.27, 0.27, 0.08, 0.03), SHELL2, { p: [0, 0.31, -0.215] });
  b.pair('body', () => G.box(0.03, 0.17, 0.02, 0.008), GLOW, { p: [0.07, 0.31, -0.256] });
  b.pair('body', () => G.sphere(0.098, 18, 12), SHELL2, { p: [0.3, 0.445, 0] });
  // Big arms with mitten fists.
  for (const arm of ['armL', 'armR']) {
    b.part(arm, G.capsule(0.05, 0.13, 4, 12), METAL, { p: [0, -0.13, 0] });
    b.part(arm, G.box(0.132, 0.145, 0.145, 0.05, 4), SHELL, { p: [0, -0.275, 0] });
    b.part(arm, G.box(0.1, 0.02, 0.02, 0.008), GLOW, { p: [0, -0.3, 0.073] });
  }
  // Wide head with the biggest screen, ear bolts and the crown with its cross antenna.
  b.part('head', G.cyl(0.072, 0.092, 0.07, 18), METAL, { p: [0, -0.025, 0] });
  b.part('head', G.box(0.37, 0.265, 0.3, 0.088, 5), SHELL, { p: [0, 0.133, 0] });
  b.pair('head', () => G.cyl(0.042, 0.042, 0.04, 14), METAL, { p: [0.195, 0.133, 0], r: [0, 0, HALF_PI] });
  b.pair('head', () => G.cyl(0.024, 0.024, 0.012, 12), GLOW, { p: [0.218, 0.133, 0], r: [0, 0, HALF_PI] });
  b.part('crown', G.torus(0.137, 0.023, 8, 30), METAL, { p: [0, 0.018, 0], r: [HALF_PI, 0, 0] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
    b.part('crown', G.cone(0.036, 0.095, 4), METAL, { p: [Math.sin(a) * 0.137, 0.078, Math.cos(a) * 0.137], r: [0, a + Math.PI / 4, 0] });
    const g = a + Math.PI / 5;
    b.part('crown', G.sphere(0.017, 8, 6), GLOW, { p: [Math.sin(g) * 0.139, 0.03, Math.cos(g) * 0.139] });
  }
  b.part('crown', G.cyl(0.012, 0.017, 0.13, 8), METAL, { p: [0, 0.075, 0] });
  b.part('crown', G.box(0.036, 0.135, 0.036, 0.012), GLOW, { p: [0, 0.2, 0] });
  b.part('crown', G.box(0.104, 0.036, 0.036, 0.012), GLOW, { p: [0, 0.213, 0] });
  b.face('head', { w: 0.305, h: 0.195, p: [0, 0.133, 0.1515], eyes: 2, corner: 0.26, mouth: true, shape: { w: 0.15, h: 0.165, round: 0.75, gap: 0.37 } });
  b.info = { height: 1.42, radius: 0.36, muzzle: [0, 0.6, 0.3], headHeight: 1.0 };
  return b.finalize();
}

const FACTORIES = { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };
const cache = new Map();

/** Get the shared blueprint for a piece type (built once, then reused by every robot of that type). */
export function getBlueprint(type) {
  if (!FACTORIES[type]) throw new Error(`Unknown piece type: ${type}`);
  if (!cache.has(type)) cache.set(type, FACTORIES[type]());
  return cache.get(type);
}

export const PIECE_TYPES = ['p', 'r', 'n', 'b', 'q', 'k'];
