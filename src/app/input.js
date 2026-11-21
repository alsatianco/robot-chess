// Pointer input on the 3D board. It supports both ways to move a piece (tap a piece then tap a square, or drag and drop), a tap to skip a running animation, dragging on empty space to turn the camera a little, and pinch or wheel to zoom (the zoom speed is in `zoom-input.js`). The same code drives real games and the tutorial through a small "target" interface.
import * as THREE from 'three';
import { worldToSquare } from '../gfx/coords.js';
import { wheelZoomFactor, pinchZoomFactor } from './zoom-input.js';

/** Pixels the pointer must travel before a press becomes a drag. Larger for fingers than for a mouse. */
const DRAG_THRESHOLD = { mouse: 5, touch: 12, pen: 8 };
const PICK_RADIUS = 0.3;
const PICK_TOP_RADIUS = 0.13;
const DRAG_PLANE_HEIGHT = 0.42;

const _plane = new THREE.Plane();
const _point = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _ndc = new THREE.Vector2();

export class InputController {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {import('../gfx/stage.js').Stage} deps.stage
   * @param {import('../gfx/camera-rig.js').CameraRig} deps.rig
   * @param {import('../gfx/boardview.js').BoardView} deps.view
   * @param {import('../core/settings.js').Settings} deps.settings
   * @param {{play:(name:string, opts?:object)=>void}} deps.sfx
   * @param {() => ({canInteract:()=>boolean, isOwnPiece:(square:string)=>boolean, targetsFrom:(square:string)=>object[], attemptMove:(from:string, to:string, options?:object)=>Promise<boolean>}|null)} deps.getTarget Returns the game or tutorial that currently receives moves, or null.
   */
  constructor({ canvas, stage, rig, view, settings, sfx, getTarget }) {
    this.canvas = canvas;
    this.stage = stage;
    this.rig = rig;
    this.view = view;
    this.settings = settings;
    this.sfx = sfx;
    this.getTarget = getTarget;
    this.raycaster = new THREE.Raycaster();
    this.selected = null;
    /** @type {Map<number, {x:number, y:number}>} */
    this.pointers = new Map();
    this.press = null;
    this.pinch = null;

    canvas.addEventListener('pointerdown', (event) => this.#down(event));
    canvas.addEventListener('pointermove', (event) => this.#move(event));
    canvas.addEventListener('pointerup', (event) => this.#up(event));
    canvas.addEventListener('pointercancel', (event) => this.#cancel(event));
    canvas.addEventListener('pointerleave', () => {
      this.view.setHover(null);
      this.view.setPointerAttention(null);
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.rig.zoom(wheelZoomFactor(event));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  #setRay(event) {
    const rect = this.canvas.getBoundingClientRect();
    _ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(_ndc, this.stage.camera);
  }

  #planePoint(height, target) {
    _plane.set(THREE.Object3D.DEFAULT_UP, -height);
    return this.raycaster.ray.intersectPlane(_plane, target);
  }

  /** Find the square under the pointer. Robots are tall, so a robot under the pointer wins over the tile behind it. */
  #pick(event) {
    this.#setRay(event);
    const ray = this.raycaster.ray;
    let best = null;
    let bestDistance = Infinity;
    for (const [square, robot] of this.view.bySquare) {
      const top = robot.height - 0.05;
      // Robots are wide at the bottom and narrow at the top. A tight shape matters: a tall king in front must not steal taps meant for the pawn behind it.
      const base = Math.min(PICK_RADIUS, robot.info.radius * 1.1);
      for (let i = 0; i <= 5; i++) {
        const f = i / 5;
        const radius = base + (PICK_TOP_RADIUS - base) * f;
        _probe.set(robot.rig.x, 0.12 + (top - 0.12) * f, robot.rig.z);
        if (ray.distanceSqToPoint(_probe) < radius * radius) {
          const along = _probe.sub(ray.origin).dot(ray.direction);
          if (along < bestDistance) {
            bestDistance = along;
            best = square;
          }
          break;
        }
      }
    }
    const ground = this.#planePoint(0, _point);
    return { square: best ?? (ground ? worldToSquare(ground.x, ground.z) : null), ground: ground ? ground.clone() : null };
  }

  /** Drop the selection (called when the game state changes under the player). */
  clearSelection() {
    if (!this.selected) return;
    this.selected = null;
    this.view.setSelected(null);
    this.view.clearLegalTargets();
  }

  /** Keep the selection only while it still makes sense. Call after every game change. */
  validate() {
    const target = this.getTarget();
    if (this.selected && (!target || !target.canInteract() || !target.isOwnPiece(this.selected))) this.clearSelection();
  }

  #select(square) {
    const target = this.getTarget();
    this.selected = square;
    this.view.setSelected(square);
    if (this.settings.get('legalHints')) this.view.setLegalTargets(target.targetsFrom(square));
    else this.view.clearLegalTargets();
    this.sfx.play('piece.select');
  }

  #down(event) {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail for synthetic events; input still works without it.
    }
    if (this.pointers.size === 2) {
      // Second finger: this is a pinch, not a move.
      if (this.press?.mode === 'drag') this.view.cancelDrag();
      this.press = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (this.pointers.size > 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;

    // Any tap during an animation skips it.
    if (this.view.busy) this.view.skip();

    const { square } = this.#pick(event);
    const target = this.getTarget();
    const own = Boolean(target && square && target.canInteract() && target.isOwnPiece(square));
    this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, square, own, wasSelected: own && this.selected === square, mode: 'pending', type: event.pointerType };
    if (own && this.selected !== square) this.#select(square);
  }

  #move(event) {
    const known = this.pointers.get(event.pointerId);
    if (known) {
      known.x = event.clientX;
      known.y = event.clientY;
    }
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      this.rig.zoom(pinchZoomFactor(this.pinch.distance, distance));
      this.pinch.distance = distance;
      return;
    }
    const press = this.press;
    if (!press || press.id !== event.pointerId) {
      // Just hovering: light the tile under the mouse and let the robots look at it.
      if (event.pointerType === 'mouse') {
        const { square, ground } = this.#pick(event);
        const target = this.getTarget();
        this.view.setHover(target?.canInteract() ? square : null);
        if (ground && Math.abs(ground.x) < 5 && Math.abs(ground.z) < 5) this.view.setPointerAttention(ground.setY(0.4));
        else this.view.setPointerAttention(null);
      }
      return;
    }
    if (press.mode === 'pending') {
      const travelled = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (travelled < (DRAG_THRESHOLD[press.type] ?? 8)) return;
      const canDrag = press.own && this.settings.get('moveInput') !== 'tap' && this.getTarget()?.canInteract();
      if (canDrag && this.view.beginDrag(press.square)) {
        press.mode = 'drag';
        this.view.clearLegalTargets();
        if (this.settings.get('legalHints')) this.view.setLegalTargets(this.getTarget().targetsFrom(press.square));
      } else {
        press.mode = 'orbit';
      }
    }
    if (press.mode === 'drag') {
      this.#setRay(event);
      const hit = this.#planePoint(DRAG_PLANE_HEIGHT, _point);
      if (hit) {
        this.view.dragTo(hit.x, hit.z);
        this.view.setHover(worldToSquare(hit.x, hit.z));
      }
    } else if (press.mode === 'orbit') {
      this.rig.orbit(-(event.clientX - press.lastX) * 0.005, (event.clientY - press.lastY) * 0.004);
    }
    press.lastX = event.clientX;
    press.lastY = event.clientY;
  }

  async #up(event) {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const press = this.press;
    if (!press || press.id !== event.pointerId) return;
    this.press = null;
    this.view.setHover(null);
    const target = this.getTarget();

    if (press.mode === 'drag') {
      const drag = this.view.drag;
      const dropSquare = drag ? worldToSquare(drag.x, drag.z) : null;
      const from = press.square;
      if (!target || !dropSquare || dropSquare === from) {
        // Dropped back on its own square: keep it selected so a tap on a target still works.
        this.view.cancelDrag();
        if (dropSquare === from && target?.canInteract()) this.view.setSelected(from);
        return;
      }
      this.selected = null;
      this.view.clearLegalTargets();
      const played = await target.attemptMove(from, dropSquare, { fromDrag: true });
      if (!played) this.view.cancelDrag();
      this.view.setSelected(null);
      return;
    }
    if (press.mode !== 'pending') return;

    // A tap.
    if (!target || !target.canInteract()) return;
    const square = press.square;
    if (press.own) {
      // Tapping the selected piece again puts it down.
      if (press.wasSelected) this.clearSelection();
      return;
    }
    if (this.selected && square && this.settings.get('moveInput') !== 'drag') {
      const from = this.selected;
      this.clearSelection();
      await target.attemptMove(from, square, { fromDrag: false });
      return;
    }
    this.clearSelection();
  }

  #cancel(event) {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.press?.id === event.pointerId) {
      if (this.press.mode === 'drag') this.view.cancelDrag();
      this.press = null;
    }
  }
}
