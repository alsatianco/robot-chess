// The board as the player sees it: which robot stands on which square, and every visual reaction (moves, captures, selection, dragging, check, game end, coach ghost lines). The game controller owns the chess state; this class only shows it. After every animation the robots are forced back in line with the real position, so the picture can never drift away from the game.
import * as THREE from 'three';
import { Chess } from 'chess.js';
import { Animator, Ease } from './anim/animator.js';
import * as choreo from './anim/choreo.js';
import { Robot } from './robots/robot.js';
import { squareToWorld } from './coords.js';
import { MARK } from './arena.js';
import { FX_COLORS, TEAMS } from './palette.js';

/** Animation presets from the settings screen. */
export const PRESETS = {
  cinematic: { pace: 1.2, cinematic: true, effects: true },
  standard: { pace: 1, cinematic: false, effects: true },
  minimal: { pace: 1, cinematic: false, effects: false },
  instant: { pace: 0, cinematic: false, effects: false },
};

const NO_SOUND = { play() {} };
const _v = new THREE.Vector3();

function epSquare(move) {
  // The pawn taken "in passing" stands on the mover's start rank, on the target file.
  return move.to[0] + move.from[1];
}

function castleRookSquares(move) {
  const rank = move.from[1];
  return move.flags.includes('k') ? { from: 'h' + rank, to: 'f' + rank } : { from: 'a' + rank, to: 'd' + rank };
}

export class BoardView {
  /**
   * @param {object} deps
   * @param {import('./stage.js').Stage} deps.stage
   * @param {import('./arena.js').Arena} deps.arena
   * @param {import('./fx/effects.js').Effects} deps.effects
   * @param {import('./camera-rig.js').CameraRig} deps.rig
   * @param {{play:(name:string, opts?:object)=>void}} [deps.sfx]
   */
  constructor({ stage, arena, effects, rig, sfx = NO_SOUND }) {
    this.stage = stage;
    this.arena = arena;
    this.fx = effects;
    this.rig = rig;
    this.sfx = sfx;
    this.animator = new Animator();
    this.group = new THREE.Group();
    this.group.name = 'robots';
    stage.scene.add(this.group);

    /** @type {Map<string, Robot>} */
    this.bySquare = new Map();
    /** Every robot that still gets a per-frame update (on the board or mid-animation). */
    this.active = new Set();
    this.presetName = 'standard';
    this.flashesEnabled = true;
    this.busy = false;
    this.selected = null;
    this.checkSquare = null;
    this.drag = null;
    /** Point all robots look at (the action, or the player's pointer). */
    this.attention = null;
    this.attentionTimer = 0;
    this.ghost = null;
    this.slowTimer = 0;
    this.flashAmount = 0;
    this.flashColor = new THREE.Color();

    this.ctx = {
      A: this.animator,
      fx: this.fx,
      sfx: this.sfx,
      pace: 1,
      cinematic: false,
      shake: (amount) => this.rig.shake(amount),
      focus: (point, amount) => this.rig.focusOn(point, amount),
      release: () => this.rig.release(),
      screenFlash: (color, amount) => {
        if (!this.flashesEnabled) return;
        this.flashColor.copy(color);
        this.flashAmount = Math.max(this.flashAmount, amount);
      },
      releaseRobot: (robot) => this.active.delete(robot),
    };

    stage.onQualityChange.add((quality) => {
      for (const robot of this.active) robot.setQuality(quality);
    });
  }

  setSfx(sfx) {
    this.sfx = sfx ?? NO_SOUND;
    this.ctx.sfx = this.sfx;
  }

  /** @param {'cinematic'|'standard'|'minimal'|'instant'} name */
  setPreset(name) {
    this.presetName = PRESETS[name] ? name : 'standard';
    const preset = PRESETS[this.presetName];
    this.ctx.pace = preset.pace || 1;
    this.ctx.cinematic = preset.cinematic;
  }

  get preset() {
    return PRESETS[this.presetName];
  }

  // --- Robots and position -----------------------------------------------------------------------------------

  #spawn(type, color, square) {
    const robot = new Robot(type, color, this.stage.quality);
    const { x, z } = squareToWorld(square);
    robot.place(x, z, choreo.homeYaw(color));
    robot.square = square;
    this.group.add(robot.group);
    this.active.add(robot);
    return robot;
  }

  #discard(robot) {
    this.active.delete(robot);
    robot.dispose();
  }

  #resetRig(robot, square) {
    const { x, z } = squareToWorld(square);
    const rig = robot.rig;
    Object.assign(rig, { x, z, y: 0, yaw: choreo.homeYaw(robot.team), lean: 0, roll: 0, twist: 0, squash: 1, headYaw: 0, headPitch: 0, headRoll: 0, armL: 0, armR: 0, spread: 0, walk: 0, walkAmp: 0, spring: 0, hover: 0, recoil: 0, special: 0, shake: 0, idle: 1, power: 1, scale: 1, glow: 0, select: 0, wipe: 1000 });
    robot.square = square;
    robot.group.visible = true;
    // Undo anything an interrupted animation did to the parts themselves (a half-built promotion, a face hidden by a teleport).
    for (const mesh of robot.meshes) {
      mesh.position.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      mesh.visible = true;
    }
    if (robot.faceMesh) robot.faceMesh.visible = true;
    if (robot.marker) robot.marker.material.opacity = 1;
    robot.moodTimer = 0;
    robot.setMood('neutral');
    robot.lookTarget = null;
  }

  /**
   * Make the robots match a position right now, without animation. Robots already in the right place are kept, others are moved or created.
   * @param {string} fen
   */
  sync(fen) {
    // Stop any choreography that is still running. It must not go on moving robots that are about to be reused for the new position.
    this.animator.abortAll();
    this.busy = false;
    this.slowTimer = 0;
    this.attention = null;
    this.#endGhost();
    this.fx.clearTransient();
    this.drag = null;
    const chess = new Chess(fen);
    /** @type {Map<string, {type:string, color:string}>} */
    const wanted = new Map();
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell) wanted.set(cell.square, { type: cell.type, color: cell.color });
      }
    }
    const next = new Map();
    const spare = [];
    for (const [square, robot] of this.bySquare) {
      const want = wanted.get(square);
      if (want && !robot.damaged && want.type === robot.type && want.color === robot.team) {
        next.set(square, robot);
        wanted.delete(square);
      } else {
        spare.push(robot);
      }
    }
    for (const [square, want] of wanted) {
      const index = spare.findIndex((robot) => !robot.damaged && robot.type === want.type && robot.team === want.color);
      const robot = index >= 0 ? spare.splice(index, 1)[0] : this.#spawn(want.type, want.color, square);
      next.set(square, robot);
    }
    for (const robot of spare) this.#discard(robot);
    // Anything still active but not on the board is a leftover from an interrupted animation.
    const keep = new Set(next.values());
    for (const robot of [...this.active]) {
      if (!keep.has(robot)) this.#discard(robot);
    }
    this.bySquare = next;
    for (const [square, robot] of next) {
      this.active.add(robot);
      this.#resetRig(robot, square);
      robot.update(0, true, this.rig.markerYaw);
      robot.face?.update(0, true);
    }
    this.selected = null;
    if (this.checkSquare) this.setCheck(this.checkSquare, false);
    this.rig.release();
  }

  getRobot(square) {
    return this.bySquare.get(square) ?? null;
  }

  // --- Moves ------------------------------------------------------------------------------------------------

  /** Fast-forward the running animation (the player tapped to skip). */
  skip() {
    if (this.busy) this.animator.fast = true;
  }

  /**
   * Hold the game for a moment while something other than the robots moves: the camera that turns the board to the other player in a two-player game. It counts as an animation, so a tap skips it like any other, and the Instant preset has no wait at all.
   * @param {number} seconds
   */
  async pause(seconds) {
    if (this.presetName === 'instant' || this.busy) return;
    this.busy = true;
    this.animator.fast = false;
    try {
      await this.animator.wait(seconds);
    } finally {
      this.animator.fast = false;
      this.busy = false;
    }
  }

  /**
   * Animate one move. `move` is a chess.js verbose move (it carries `before` and `after` positions).
   * @param {import('chess.js').Move} move
   * @param {{fromDrag?:boolean}} [options] `fromDrag` means the player dropped the piece by hand, so it is already at the target.
   */
  async playMove(move, options = {}) {
    const preset = this.preset;
    if (this.presetName === 'instant' || this.busy) {
      this.sync(move.after);
      return;
    }
    // Start from a quiet state: drop the selection (without the turn-back animation, the move itself turns the robot), end any ghost line and finish leftover tweens so nothing fights the new animation.
    this.#clearSelection();
    this.#endGhost();
    // A piece dropped by hand stays where the player let go; stop following the pointer.
    const dropped = this.drag;
    this.drag = null;
    if (dropped && !options.fromDrag) dropped.robot.rig.y = 0;
    this.animator.finishAll();
    this.busy = true;
    this.animator.fast = false;
    const ctx = this.ctx;
    try {
      const mover = this.bySquare.get(move.from);
      if (!mover) throw new Error(`No robot on ${move.from} for move ${move.san}`);
      const to = squareToWorld(move.to);
      const isCastle = move.flags.includes('k') || move.flags.includes('q');
      const isEnPassant = move.flags.includes('e');
      const victimSquare = isEnPassant ? epSquare(move) : move.to;
      const victim = move.captured ? this.bySquare.get(victimSquare) : null;

      // Book-keeping first, so the map is right even if an animation step fails.
      this.bySquare.delete(move.from);
      if (victim) this.bySquare.delete(victimSquare);
      this.bySquare.set(move.to, mover);
      mover.square = move.to;
      let rook = null;
      let rookTo = null;
      if (isCastle) {
        const squares = castleRookSquares(move);
        rook = this.bySquare.get(squares.from);
        if (rook) {
          this.bySquare.delete(squares.from);
          this.bySquare.set(squares.to, rook);
          rook.square = squares.to;
          rookTo = squareToWorld(squares.to);
        }
      }

      this.#watch(mover);
      if (!preset.effects) {
        // Minimal: pieces slide, no effects.
        this.sfx.play(victim ? 'piece.drop' : 'move.pawn', { gain: 0.6 });
        const jobs = [choreo.slide(ctx, mover, to)];
        if (rook) jobs.push(choreo.slide(ctx, rook, rookTo));
        if (victim) jobs.push(choreo.vanish(ctx, victim));
        await Promise.all(jobs);
      } else if (options.fromDrag) {
        mover.rig.x = to.x;
        mover.rig.z = to.z;
        if (victim) await choreo.dropCapture(ctx, mover, victim);
        this.sfx.play('piece.drop');
        if (rook) await choreo.teleport(ctx, rook, rookTo);
        await this.animator.tween(mover.rig, { y: 0, squash: 0.86, roll: 0, lean: 0 }, 0.1, Ease.inQuad);
        this.fx.ring(to, { color: TEAMS[mover.team].glowSoft, size: 1.4, life: 0.3, thickness: 0.08 });
        this.animator.tween(mover.rig, { squash: 1 }, 0.3, Ease.outElastic);
      } else if (isCastle && rook) {
        await choreo.castle(ctx, mover, rook, to, rookTo);
      } else if (victim) {
        await choreo.capture(ctx, mover, victim, to);
      } else {
        await choreo.travel(ctx, mover, to);
      }

      if (move.promotion) {
        const next = this.#spawn(move.promotion, move.color, move.to);
        this.bySquare.set(move.to, next);
        if (preset.effects) {
          next.group.visible = false;
          await choreo.promote(ctx, mover, next, (pawn) => this.#discard(pawn));
        } else {
          this.#discard(mover);
        }
        await choreo.settle(ctx, next);
      } else {
        const settling = [choreo.settle(ctx, mover)];
        if (rook) settling.push(choreo.settle(ctx, rook));
        await Promise.all(settling);
      }
      if (victim && preset.effects) this.#teamMood(move.color, 'happy', 1.4);
    } catch (error) {
      console.error('[boardview] move animation failed, snapping to the real position', error);
    } finally {
      this.animator.fast = false;
      this.busy = false;
      this.#enforce(move.after);
    }
  }

  // After an animation: check that every square shows the right robot, and repair with a full sync when it does not.
  #enforce(fen) {
    const chess = new Chess(fen);
    let ok = true;
    let count = 0;
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        count += 1;
        const robot = this.bySquare.get(cell.square);
        if (!robot || robot.type !== cell.type || robot.team !== cell.color) ok = false;
      }
    }
    if (!ok || count !== this.bySquare.size) {
      this.sync(fen);
      return;
    }
    for (const [square, robot] of this.bySquare) {
      const { x, z } = squareToWorld(square);
      robot.rig.x = x;
      robot.rig.z = z;
      robot.rig.wipe = 1000;
      robot.rig.scale = 1;
      robot.group.visible = true;
    }
  }

  #watch(robot) {
    this.attention = robot;
    this.attentionTimer = 1.2;
  }

  #teamMood(color, mood, seconds) {
    for (const robot of this.bySquare.values()) {
      if (robot.team === color && robot.face?.mood !== 'scared') {
        robot.setMood(mood);
        robot.moodTimer = seconds;
      }
    }
  }

  // --- Selection, dragging and highlights -------------------------------------------------------------------

  /** Mark a square as selected (or clear the selection with null). The robot turns to the camera and perks up. */
  setSelected(square) {
    if (this.selected === square) return;
    const previous = this.selected ? this.bySquare.get(this.selected) : null;
    if (previous && !this.busy) {
      this.animator.tween(previous.rig, { select: 0, yaw: previous.rig.yaw + this.#shortTurn(previous.rig.yaw, choreo.homeYaw(previous.team)) }, 0.18);
      if (previous.face?.mood === 'happy') previous.setMood('neutral');
    } else if (previous) {
      previous.rig.select = 0;
    }
    this.selected = square;
    const robot = square ? this.bySquare.get(square) : null;
    if (robot) {
      robot.setMood('happy');
      // Face the player.
      this.animator.tween(robot.rig, { select: 1, yaw: robot.rig.yaw + this.#shortTurn(robot.rig.yaw, this.rig.azimuth) }, 0.2, Ease.outCubic);
      choreo.hop(this.ctx, robot);
      this.arena.setLayer('selected', [{ square, color: FX_COLORS.selected, alpha: 0.9 }]);
    } else {
      this.arena.clearLayer('selected');
    }
  }

  #clearSelection() {
    const robot = this.selected ? this.bySquare.get(this.selected) : null;
    this.selected = null;
    this.arena.clearLayer('selected');
    if (robot) {
      robot.rig.select = 0;
      if (robot.face?.mood === 'happy') robot.setMood('neutral');
    }
  }

  #shortTurn(from, to) {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  /**
   * Show where the selected piece can go: dots on empty squares, rings on pieces that can be captured.
   * @param {Array<{to:string, captured?:string, flags?:string}>} moves chess.js verbose moves of the selected piece.
   */
  setLegalTargets(moves) {
    const seen = new Set();
    const entries = [];
    for (const move of moves) {
      if (seen.has(move.to)) continue;
      seen.add(move.to);
      const takes = Boolean(move.captured) && !move.flags?.includes('e');
      entries.push({ square: move.to, mark: takes ? MARK.RING : MARK.DOT, markColor: takes ? FX_COLORS.capture : FX_COLORS.legal });
    }
    this.arena.setLayer('legal', entries);
  }

  clearLegalTargets() {
    this.arena.clearLayer('legal');
  }

  setLastMove(from, to) {
    this.arena.setLayer('lastMove', from && to ? [{ square: from, color: FX_COLORS.lastMove, alpha: 0.5 }, { square: to, color: FX_COLORS.lastMove, alpha: 0.75 }] : []);
  }

  setHover(square) {
    this.arena.setLayer('hover', square ? [{ square, color: FX_COLORS.white, alpha: 0.22 }] : []);
  }

  /**
   * Show or clear check. The king's tile pulses red and, when `alarm` is true, the king jumps in fright.
   * @param {string|null} square The square of the king in check.
   */
  setCheck(square, alarm = true) {
    const previous = this.checkSquare ? this.bySquare.get(this.checkSquare) : null;
    if (previous && previous.face?.mood === 'scared' && this.checkSquare !== square) previous.setMood('neutral');
    this.checkSquare = square;
    if (!square) {
      this.arena.clearLayer('check');
      return;
    }
    this.arena.setLayer('check', [{ square, color: FX_COLORS.check, alpha: 1, pulse: true }]);
    const king = this.bySquare.get(square);
    if (king && alarm) {
      this.sfx.play('check');
      choreo.checkAlarm(this.ctx, king);
    } else if (king) {
      king.setMood('scared');
    }
  }

  /** Coach and tutorial marks on squares. kind: danger, target, good or info. */
  setCoachMarks(highlights = [], arrows = []) {
    this.arena.setLayer(
      'coach',
      highlights.map((h) => ({ square: h.square, color: FX_COLORS[h.kind] ?? FX_COLORS.info, alpha: 0.95, pulse: h.kind === 'danger', mark: h.kind === 'target' ? MARK.BRACKET : MARK.NONE, markColor: FX_COLORS[h.kind] })),
    );
    this.arena.setArrows(arrows);
  }

  clearCoachMarks() {
    this.arena.clearLayer('coach');
    this.arena.setArrows([]);
  }

  /** "Move here" brackets used by the tutorial. */
  setHint(squares) {
    this.arena.setLayer('hint', squares.map((square) => ({ square, color: FX_COLORS.target, alpha: 0.7, mark: MARK.BRACKET, markColor: FX_COLORS.target })));
  }

  /** Tell the robots where the player's pointer is, so they can look at it. Pass null when the pointer leaves the board. */
  setPointerAttention(point) {
    if (this.attention && this.attention.rig) return;
    this.attention = point ? { point: point.clone() } : null;
    this.attentionTimer = point ? 2.5 : 0;
  }

  /** Lift a piece for dragging. */
  beginDrag(square) {
    const robot = this.bySquare.get(square);
    if (!robot || this.busy) return false;
    this.drag = { robot, square, x: robot.rig.x, z: robot.rig.z, vx: 0, vz: 0 };
    robot.setMood('wow');
    robot.rig.idle = 0.3;
    this.animator.tween(robot.rig, { y: 0.38, select: 1 }, 0.12, Ease.outCubic);
    this.sfx.play('piece.select');
    return true;
  }

  /** Move the dragged piece toward a board position. */
  dragTo(x, z) {
    if (!this.drag) return;
    this.drag.x = THREE.MathUtils.clamp(x, -4.4, 4.4);
    this.drag.z = THREE.MathUtils.clamp(z, -4.4, 4.4);
  }

  /** Put the dragged piece back on its square (the drop was not a legal move). */
  cancelDrag() {
    if (!this.drag) return;
    const { robot, square } = this.drag;
    this.drag = null;
    const home = squareToWorld(square);
    robot.setMood('neutral');
    this.animator.tween(robot.rig, { x: home.x, z: home.z, y: 0, roll: 0, lean: 0, select: 0, idle: 1 }, 0.2, Ease.outCubic);
  }

  /** Stop following the pointer; the piece stays in the air until playMove (fromDrag) or cancelDrag is called. */
  releaseDrag() {
    const drag = this.drag;
    this.drag = null;
    return drag;
  }

  // --- Special moments --------------------------------------------------------------------------------------

  /** The coach rated the last move as the best: a short slow motion, a glow and rising sparkles on the piece. */
  celebrateBestMove(square) {
    const robot = this.bySquare.get(square);
    if (!robot || !this.preset.effects) return;
    this.sfx.play('bestmove');
    this.slowTimer = 0.55;
    robot.setMood('happy');
    robot.moodTimer = 1.6;
    robot.rig.glow = 0.9;
    this.animator.tween(robot.rig, { glow: 0 }, 0.9, Ease.outQuad);
    const glow = TEAMS[robot.team].glow;
    this.fx.ring({ x: robot.rig.x, y: 0, z: robot.rig.z }, { color: FX_COLORS.target, size: 2.4, life: 0.7 });
    this.fx.burst(_v.set(robot.rig.x, 0.2, robot.rig.z), 26, { color: FX_COLORS.target, color2: glow, speed: 1.1, up: 1.4, life: 1.1, size: 0.06, gravity: -1.2, drag: 1.5, spread: 0.3 });
    choreo.hop(this.ctx, robot, 0.2);
  }

  /**
   * End-of-game scene.
   * @param {{type:'checkmate'|'draw'|'timeout'|'resign', winner:'w'|'b'|null}} result
   */
  async playGameEnd(result) {
    if (!this.preset.effects) return;
    const all = [...this.bySquare.values()];
    this.busy = true;
    this.animator.fast = false;
    try {
      if (result.winner) {
        const winners = all.filter((robot) => robot.team === result.winner);
        const losers = all.filter((robot) => robot.team !== result.winner);
        const loserKing = losers.find((robot) => robot.type === 'k');
        if (loserKing && result.type === 'checkmate') {
          await choreo.checkmate(this.ctx, loserKing, winners, losers);
        } else {
          for (const robot of losers) robot.setMood('sad');
          await choreo.celebrate(this.ctx, winners, true);
        }
      } else {
        for (const robot of all) robot.setMood('neutral');
      }
    } catch (error) {
      console.error('[boardview] game end animation failed', error);
    } finally {
      this.busy = false;
      this.animator.fast = false;
    }
  }

  // --- Coach ghost line -------------------------------------------------------------------------------------

  #endGhost() {
    if (!this.ghost) return;
    for (const robot of this.ghost.ghosts.values()) robot.dispose();
    for (const robot of this.ghost.hidden) robot.group.visible = true;
    this.ghost.cancelled = true;
    this.ghost = null;
    this.arena.setArrows([]);
    this.arena.clearLayer('coach');
  }

  /** Stop a ghost line that is playing and bring the real pieces back. */
  cancelGhostLine() {
    this.#endGhost();
  }

  /**
   * Play a line of moves with see-through hologram pieces: "if you play this, the opponent plays this, then this". The real pieces that take part are hidden while their holograms move, and everything is restored at the end.
   * @param {string} fen Position the line starts from. It must be the position shown on the board.
   * @param {string[]} moves UCI moves.
   * @param {{player:'w'|'b', hold?:number}} options `player` decides arrow colors: the opponent's moves are drawn as danger.
   * @returns {Promise<boolean>} False when the line was cancelled or could not be played.
   */
  async playGhostLine(fen, moves, options) {
    this.#endGhost();
    const state = { ghosts: new Map(), hidden: new Set(), cancelled: false };
    this.ghost = state;
    const A = this.animator;
    const chess = new Chess(fen);
    const arrows = [];
    const marks = [];
    this.sfx.play('coach.ghost');
    try {
      for (const uci of moves) {
        if (state.cancelled) return false;
        let move;
        try {
          move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        } catch {
          break;
        }
        const takeGhost = (square, type, color) => {
          let ghost = state.ghosts.get(square);
          if (ghost) {
            state.ghosts.delete(square);
            return ghost;
          }
          const real = this.bySquare.get(square);
          if (real) {
            real.group.visible = false;
            state.hidden.add(real);
          }
          ghost = new Robot(type, color, this.stage.quality, { ghost: true });
          const p = squareToWorld(square);
          ghost.place(p.x, p.z, choreo.homeYaw(color));
          ghost.update(0, true);
          this.group.add(ghost.group);
          return ghost;
        };
        const removeAt = (square) => {
          const ghost = state.ghosts.get(square);
          if (ghost) {
            state.ghosts.delete(square);
            ghost.dispose();
            return;
          }
          const real = this.bySquare.get(square);
          if (real && !state.hidden.has(real)) {
            real.group.visible = false;
            state.hidden.add(real);
          }
        };

        const mine = move.color === options.player;
        arrows.push({ from: move.from, to: move.to, kind: mine ? 'good' : 'danger' });
        this.arena.setArrows(arrows);
        const ghost = takeGhost(move.from, move.piece, move.color);
        state.ghosts.set(move.to + '#moving', ghost);
        const to = squareToWorld(move.to);
        const from = { x: ghost.rig.x, z: ghost.rig.z };
        await A.run(0.55, (k) => {
          const e = Ease.inOutCubic(k);
          ghost.rig.x = from.x + (to.x - from.x) * e;
          ghost.rig.z = from.z + (to.z - from.z) * e;
          ghost.rig.y = Math.sin(k * Math.PI) * 0.25;
          ghost.update(0.016);
        });
        if (state.cancelled) return false;
        state.ghosts.delete(move.to + '#moving');
        if (move.captured) {
          const square = move.flags.includes('e') ? epSquare(move) : move.to;
          removeAt(square);
          marks.push({ square: move.to, kind: mine ? 'good' : 'danger' });
          this.setCoachMarksKeepArrows(marks);
          const p = squareToWorld(square);
          this.fx.flash(_v.set(p.x, 0.5, p.z), { color: mine ? FX_COLORS.good : FX_COLORS.danger, size: 1.6, life: 0.3, power: 2.2 });
          this.fx.ring({ x: p.x, y: 0, z: p.z }, { color: mine ? FX_COLORS.good : FX_COLORS.danger, size: 2, life: 0.45 });
          this.sfx.play('piece.drop');
        }
        if (move.flags.includes('k') || move.flags.includes('q')) {
          const squares = castleRookSquares(move);
          const rookGhost = takeGhost(squares.from, 'r', move.color);
          const rp = squareToWorld(squares.to);
          rookGhost.rig.x = rp.x;
          rookGhost.rig.z = rp.z;
          rookGhost.update(0.016);
          state.ghosts.set(squares.to, rookGhost);
        }
        if (move.promotion) {
          ghost.dispose();
          const promoted = new Robot(move.promotion, move.color, this.stage.quality, { ghost: true });
          promoted.place(to.x, to.z, choreo.homeYaw(move.color));
          promoted.update(0, true);
          this.group.add(promoted.group);
          state.ghosts.set(move.to, promoted);
        } else {
          state.ghosts.set(move.to, ghost);
        }
        await A.wait(0.4);
      }
      if (state.cancelled) return false;
      await A.wait(options.hold ?? 1.1);
      return !state.cancelled;
    } finally {
      if (this.ghost === state) this.#endGhost();
    }
  }

  /** Update coach tile marks without touching the arrows (used while a ghost line plays). */
  setCoachMarksKeepArrows(highlights) {
    this.arena.setLayer(
      'coach',
      highlights.map((h) => ({ square: h.square, color: FX_COLORS[h.kind] ?? FX_COLORS.info, alpha: 0.95, pulse: h.kind === 'danger' })),
    );
  }

  // --- Frame update -----------------------------------------------------------------------------------------

  /** @param {number} dt Real seconds since the last frame. */
  update(dt) {
    // Best-move slow motion runs on real time, so it always ends.
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      this.animator.timeScale = this.slowTimer > 0 ? 0.35 : 1;
    }
    this.animator.update(dt);
    const animDt = dt * this.animator.timeScale * (this.animator.fast ? 30 : 1);

    if (this.drag) {
      const { robot } = this.drag;
      const rig = robot.rig;
      const k = 1 - Math.exp(-dt * 22);
      const nx = rig.x + (this.drag.x - rig.x) * k;
      const nz = rig.z + (this.drag.z - rig.z) * k;
      this.drag.vx = (nx - rig.x) / Math.max(dt, 0.001);
      this.drag.vz = (nz - rig.z) / Math.max(dt, 0.001);
      rig.x = nx;
      rig.z = nz;
      // The piece swings a little against the direction it is pulled, like something held by the top.
      const cos = Math.cos(rig.yaw);
      const sin = Math.sin(rig.yaw);
      const forward = this.drag.vx * sin + this.drag.vz * cos;
      const sideways = this.drag.vx * cos - this.drag.vz * sin;
      rig.lean += (THREE.MathUtils.clamp(forward * 0.05, -0.4, 0.4) - rig.lean) * k;
      rig.roll += (THREE.MathUtils.clamp(-sideways * 0.05, -0.4, 0.4) - rig.roll) * k;
    }

    // Where the robots look.
    let lookPoint = null;
    if (this.attentionTimer > 0 && this.attention) {
      this.attentionTimer -= dt;
      lookPoint = this.attention.rig ? this.attention.getCenter(_v) : this.attention.point;
      if (this.attentionTimer <= 0) this.attention = null;
    }
    const markerYaw = this.rig.markerYaw;
    // Seen from straight above the robots hide more of their base rings, so the rings (with the chess symbol badge) grow a little in the top view.
    const markerScale = 1 + 0.26 * THREE.MathUtils.smoothstep(this.rig.elevation, 1.15, 1.5);
    const step = Math.min(animDt, 0.1);
    for (const robot of this.active) {
      if (robot.moodTimer > 0) {
        robot.moodTimer -= dt;
        if (robot.moodTimer <= 0 && (robot.face?.mood === 'happy' || robot.face?.mood === 'sad')) robot.setMood('neutral');
      }
      if (robot !== this.attention && robot.face?.mood !== 'dead') {
        if (lookPoint) {
          const near = Math.hypot(lookPoint.x - robot.rig.x, lookPoint.z - robot.rig.z) < 4.5;
          if (near) {
            robot.lookTarget = robot.lookTarget ?? new THREE.Vector3();
            robot.lookTarget.copy(lookPoint);
          } else {
            robot.lookTarget = null;
          }
        } else if (robot.face?.mood !== 'scared') {
          robot.lookTarget = null;
        }
      }
      robot.update(step, false, markerYaw, markerScale);
    }
    if (this.ghost) {
      for (const ghost of this.ghost.ghosts.values()) ghost.update(step);
    }

    this.fx.update(step, this.stage.camera);
    if (this.flashAmount > 0.002) {
      this.stage.setFlash(this.flashColor, this.flashAmount);
      this.flashAmount *= Math.exp(-dt * 9);
    } else if (this.flashAmount !== 0) {
      this.flashAmount = 0;
      this.stage.setFlash(this.flashColor, 0);
    }
  }
}
