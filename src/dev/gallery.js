// Development-only page to inspect the art and the animations. Query options: ?q=low|medium|high, ?theme=..., ?colors=blue|sand|classic, ?fen=..., ?preset=cinematic|standard|minimal. In the console, `__gallery.play('e2e4')` animates a move and `__gallery.pause(true)` freezes time for a screenshot.
import * as THREE from 'three';
import { Chess } from 'chess.js';
import { Stage } from '../gfx/stage.js';
import { Environment } from '../gfx/environment.js';
import { Arena } from '../gfx/arena.js';
import { Effects } from '../gfx/fx/effects.js';
import { CameraRig } from '../gfx/camera-rig.js';
import { BoardView } from '../gfx/boardview.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
const stage = new Stage(canvas, params.get('q') ?? 'high');
const environment = new Environment(stage);
const arena = new Arena(stage);
const effects = new Effects(stage);
const rig = new CameraRig(stage);
const view = new BoardView({ stage, arena, effects, rig });
if (params.get('theme')) {
  environment.setTheme(params.get('theme'));
  arena.setTheme(params.get('theme'));
}
if (params.get('colors')) arena.setBoardColors(params.get('colors'));
view.setPreset(params.get('preset') ?? 'standard');

const chess = new Chess(params.get('fen') ?? undefined);
view.sync(chess.fen());

const resize = () => {
  stage.resize(window.innerWidth, window.innerHeight);
  rig.setViewport(window.innerWidth, window.innerHeight, null);
};
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let frames = 0;
let fpsTime = 0;
let paused = false;
let freeCamera = null;
function frame(now) {
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;
  fpsTime += real;
  if (fpsTime > 1) {
    window.__fps = Math.round(frames / fpsTime);
    frames = 0;
    fpsTime = 0;
  }
  const dt = paused ? 0 : real;
  rig.update(dt);
  if (freeCamera) {
    stage.camera.clearViewOffset();
    stage.camera.fov = freeCamera.fov;
    stage.camera.aspect = window.innerWidth / window.innerHeight;
    stage.camera.up.set(0, 1, 0);
    stage.camera.position.set(...freeCamera.position);
    stage.camera.lookAt(...freeCamera.target);
    stage.camera.updateProjectionMatrix();
    stage.camera.updateMatrixWorld(true);
  }
  effects.pixelScale = stage.height / (2 * Math.tan((stage.camera.fov * Math.PI) / 360));
  view.update(dt);
  environment.update(dt, stage.time);
  arena.update(dt, stage.time);
  stage.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__gallery = {
  stage,
  arena,
  environment,
  effects,
  rig,
  view,
  chess,
  THREE,
  pause(on) {
    paused = on;
  },
  /** Fixed camera for close-up screenshots; pass null to give the camera back to the rig. */
  setCam(position, target, fov = 30) {
    freeCamera = position ? { position, target, fov } : null;
  },
  /** Play a move given as UCI ("e2e4") or SAN ("Nf3"). Optionally freeze time after `freezeMs`. */
  async play(text, freezeMs = null) {
    let move;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) move = chess.move({ from: text.slice(0, 2), to: text.slice(2, 4), promotion: text[4] });
    else move = chess.move(text);
    if (freezeMs !== null) setTimeout(() => (paused = true), freezeMs);
    await view.playMove(move);
    view.setLastMove(move.from, move.to);
    return move.san;
  },
  load(fen) {
    chess.load(fen);
    view.sync(fen);
  },
};
