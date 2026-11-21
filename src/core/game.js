// The game controller. It owns the real chess state (through chess.js) and runs one game, against the bot or between two people at one device: turns, the modes, clocks, undo, the coach, move-list navigation and the end of the game. The 3D board view only shows what this class decides; a move is committed here the moment it is made, and its animation is visual only.
import { Chess } from 'chess.js';
import { chooseBotMove } from '../engine/bot.js';
import { Engine } from '../engine/engine.js';
import { ChessClock } from './clock.js';
import { explainIllegalMove, castlingTarget } from '../coach/illegal.js';
import { buildMoveReport } from '../coach/report.js';
import { presentFeedback, presentIllegal } from '../coach/present.js';

/**
 * The modes: which are played against the bot, and which have a clock, undo and the coach. In the two-player mode two people share one device and there is no bot. Its clock and its coach are the players' own choice, so both say "choice" here: the clock is picked in the menu, and the coach is switched on in the settings. Because "choice" is not a plain yes or no, ask `modeHasClock` for a setup, and `game.clock` and `game.coachOn` for a running game.
 */
export const MODES = {
  free: { bot: true, clock: false, undo: true, coach: false },
  timed: { bot: true, clock: true, undo: true, coach: false },
  ranked: { bot: true, clock: true, undo: false, coach: false },
  coach: { bot: true, clock: false, undo: true, coach: true },
  two: { bot: false, clock: 'choice', undo: true, coach: 'choice' },
};

/**
 * Does a game with this setup have a clock? A two-player game has one when a time control was picked for it.
 * @param {string} modeName Key of MODES.
 * @param {string|null|undefined} timeControl Key of TIME_CONTROLS, or nothing for "no clock".
 */
export function modeHasClock(modeName, timeControl) {
  const clock = MODES[modeName].clock;
  return clock === 'choice' ? timeControl !== null && timeControl !== undefined : clock;
}

/** Coach analysis settings. The position before the player's move is searched while the bot's move animates and while the player thinks. */
const COACH_MULTIPV = 4;
const COACH_DEPTH = 12;
const COACH_MOVETIME_MS = 1600;
/** Longest wait for coach feedback after a move before the game goes on without it. */
const COACH_WAIT_MS = 5000;
/** How long an illegal-move explanation stays on the board. */
const ILLEGAL_MARK_MS = 3500;

const other = (color) => (color === 'w' ? 'b' : 'w');
const toUci = (move) => move.from + move.to + (move.promotion ?? '');

/** The findings of a report that say "this piece of yours can be taken for free", and the name under which the game remembers one of them: the piece and the square it stands on. The game keeps these names apart for each color, because in a two-player game the coach speaks to both sides. */
const dangers = (report) => report.findings.filter((finding) => finding.type === 'hanging-piece');
const dangerKey = (finding) => `${finding.piece}@${finding.square}`;
const noDangers = () => ({ w: new Set(), b: new Set() });

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export class Game {
  /**
   * @param {object} deps
   * @param {import('../gfx/boardview.js').BoardView} deps.view
   * @param {import('./settings.js').Settings} deps.settings
   * @param {{play:(name:string, opts?:object)=>void}} deps.sfx
   * @param {(key:string, params?:object)=>string} deps.t
   * @param {{promotion:(color:string, square:string)=>Promise<string|null>, confirm:(move:{from:string,to:string,san:string})=>Promise<boolean>}} deps.prompts
   * @param {(color:'w'|'b') => Promise<void>} [deps.turnBoard] Two-player games: show the board from the side that moves next. The promise ends when the board has turned; the game waits for it before the next move and the next clock.
   * @param {() => Engine} [deps.createEngine]
   */
  constructor({ view, settings, sfx, t, prompts, turnBoard = () => Promise.resolve(), createEngine = () => new Engine() }) {
    this.view = view;
    this.settings = settings;
    this.sfx = sfx;
    this.t = t;
    this.prompts = prompts;
    this.turnBoard = turnBoard;
    this.createEngine = createEngine;
    this.listeners = new Map();

    this.chess = new Chess();
    this.modeName = 'free';
    this.mode = MODES.free;
    this.playerColor = 'w';
    this.botLevel = 1;
    /** 'idle' before the first game, then 'playing' or 'over'. */
    this.status = 'idle';
    /** @type {Array<{san:string, uci:string, from:string, to:string, color:string, fenAfter:string, clock:object|null}>} */
    this.plies = [];
    this.startFen = this.chess.fen();
    /** Ply shown on the board when looking back through the game; null means the live position. */
    this.viewIndex = null;
    this.result = null;
    this.clock = null;
    this.busy = false;
    /** Changes whenever the game is replaced or rewound; async steps compare it to know they are out of date. */
    this.epoch = 0;

    this.botEngine = null;
    this.coachEngine = null;
    this.botJob = null;
    this.pre = null;
    /** The coach card now on screen, or null. */
    this.coachView = null;
    /** True while the coach flagged a move and waits for the player to choose. The bot holds its reply. */
    this.coachHold = false;
    /** True while coach feedback for the last move is still being computed. */
    this.coachPending = false;
    this.coachReport = null;
    /** True while a line of hologram pieces plays (see `coachShowLine`). */
    this.showingLine = false;
    /** Pieces in danger that the coach already stopped the game for, and that the player chose to leave there with "Keep going" (see `dangerKey`), for each color. The coach does not stop the game for the same one again while it stays in danger. @type {{w: Set<string>, b: Set<string>}} */
    this.acceptedDangers = noDangers();
    /** Evaluation from White's point of view for the evaluation bar: { cp, mate } or null. */
    this.evaluation = null;
    this.opening = null;
    this.findOpening = null;
    this.illegalTimer = null;
    this.engineError = null;
  }

  // --- Events -----------------------------------------------------------------------------------------------

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.listeners.get(event).delete(listener);
  }

  emit(event, data) {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        listener(data);
      } catch (error) {
        console.error(`[game] listener for "${event}" failed`, error);
      }
    }
  }

  // --- Engines ----------------------------------------------------------------------------------------------

  /** Start loading the bot's engine in the background. The board is usable before this finishes. */
  preloadEngine() {
    if (!this.botEngine) this.botEngine = this.createEngine();
    this.botEngine.init().catch((error) => this.#engineFailed(error));
    this.#loadOpenings();
  }

  #engineFailed(error) {
    console.error('[game] chess engine failed to start', error);
    if (this.engineError) return;
    this.engineError = error;
    this.emit('toast', { text: this.t('errors.engine'), tone: 'bad', sticky: true });
  }

  async #loadOpenings() {
    try {
      const openings = await import('../coach/openings.js');
      const loaded = await openings.loadOpenings();
      if (loaded !== false) this.findOpening = openings.findOpening;
    } catch (error) {
      // Opening names are an extra; the game is complete without them.
      console.warn('[game] opening names are not available', error);
    }
  }

  // --- New game ---------------------------------------------------------------------------------------------

  /**
   * Start a new game: against the bot, or between two players at this device (mode "two").
   * @param {{mode:'free'|'timed'|'ranked'|'coach'|'two', level?:number|null, color?:'w'|'b'|'random', timeControl?:string|null, fen?:string}} config Against the bot, `level` and `color` are needed. A two-player game has neither, and it has a clock only when `timeControl` is given.
   */
  newGame(config) {
    this.#begin(config, config.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : config.color, [], null);
  }

  /**
   * What must be kept to go on with this game later: the setup, the start position, every move with the clocks after it, and the clocks now. See `resume` and src/core/saved-game.js.
   * @returns {object|null} A plain object that can be stored as JSON, or null when there is nothing to go on with: no game is running, or no move has been made yet.
   */
  snapshot() {
    if (this.status !== 'playing' || this.plies.length === 0) return null;
    return {
      v: 1,
      mode: this.modeName,
      level: this.botLevel,
      color: this.playerColor,
      // The choice in the menu, which can be "random". It is kept apart from the color that was drawn, so "Play again" draws a new one. A two-player game has no such choice.
      colorChoice: this.mode.bot ? this.config.color : 'w',
      timeControl: this.clock ? this.clock.control : null,
      startFen: this.startFen,
      plies: this.plies.map((ply) => ({ uci: ply.uci, clock: ply.clock })),
      clock: this.clock ? this.clock.snapshot() : null,
      savedAt: Date.now(),
    };
  }

  /**
   * Go on with a game that was saved by `snapshot`. The data must have passed `checkSavedGame`, which proves that every move in it is legal. The coach starts fresh: nothing of its last card is kept.
   * @param {NonNullable<ReturnType<typeof import('./saved-game.js').checkSavedGame>>} saved
   */
  resume(saved) {
    const config = { mode: saved.mode, level: saved.level, color: saved.colorChoice, timeControl: saved.timeControl ?? undefined, fen: saved.startFen };
    this.#begin(config, saved.color, saved.plies, saved.clock);
  }

  /**
   * Set up a game: a new one, or a saved one with the moves that were already made.
   * @param {object} config The setup, as in `newGame`.
   * @param {'w'|'b'} playerColor The player's color against the bot. A two-player game has no such color.
   * @param {Array<{uci: string, clock: {w: number, b: number}|null}>} madePlies Moves to play before the game goes on, each with the clocks as they stood after it.
   * @param {{w: number, b: number}|null} clockNow The clocks at the time of saving, for a game with a clock.
   */
  #begin(config, playerColor, madePlies, clockNow) {
    this.#abortRunning();
    this.epoch += 1;
    this.config = { ...config };
    this.modeName = MODES[config.mode] ? config.mode : 'free';
    this.mode = MODES[this.modeName];
    // Without a bot there is no level, and no color that belongs to "the player": both are people. White is kept as the color, which only says from which side the board is shown first.
    this.botLevel = this.mode.bot ? config.level : null;
    this.playerColor = this.mode.bot ? playerColor : 'w';
    this.chess = config.fen ? new Chess(config.fen) : new Chess();
    this.startFen = this.chess.fen();
    this.plies = [];
    this.viewIndex = null;
    this.result = null;
    this.status = 'playing';
    this.busy = false;
    this.coachView = null;
    this.coachHold = false;
    this.coachPending = false;
    this.coachReport = null;
    this.showingLine = false;
    this.acceptedDangers = noDangers();
    this.evaluation = null;
    this.opening = null;
    this.clock = modeHasClock(this.modeName, config.timeControl) ? new ChessClock(config.timeControl) : null;
    for (const made of madePlies) {
      const move = this.chess.move({ from: made.uci.slice(0, 2), to: made.uci.slice(2, 4), promotion: made.uci[4] });
      this.plies.push({ san: move.san, uci: toUci(move), from: move.from, to: move.to, color: move.color, fenAfter: move.after, clock: made.clock });
      const found = this.findOpening?.(move.after);
      if (found) this.opening = found;
    }
    if (this.clock && clockNow) this.clock.restore(clockNow);

    // A two-player game without the coach needs no engine at all, so it also works where the engine can not start.
    if (this.mode.bot) {
      if (!this.botEngine) this.botEngine = this.createEngine();
      this.botEngine.newGame();
    }
    if (this.coachOn) this.#readyCoachEngine();

    const last = this.plies[this.plies.length - 1];
    this.view.sync(this.chess.fen());
    this.view.setLastMove(last?.from ?? null, last?.to ?? null);
    this.#showCheck(false);
    this.view.clearCoachMarks();
    this.view.clearLegalTargets();
    this.sfx.play('game.start');
    // "start" tells the app that a game was set up, so it can show the board from the right side. It comes before "change", which draws the interface.
    this.emit('start');
    this.emit('change');

    if (this.#isHuman(this.chess.turn())) {
      this.clock?.start(this.chess.turn());
      if (this.coachOn) this.#startPreAnalysis();
    } else {
      this.#startBot();
    }
  }

  #readyCoachEngine() {
    if (!this.coachEngine) this.coachEngine = this.createEngine();
    this.coachEngine.init().catch((error) => this.#engineFailed(error));
    this.coachEngine.newGame();
  }

  /** Start again with the same setup. */
  rematch() {
    if (this.config) this.newGame(this.config);
  }

  #abortRunning() {
    this.botJob?.job.cancel();
    this.botJob = null;
    this.pre?.promise.cancel();
    this.pre = null;
    this.clock?.pause();
    clearTimeout(this.illegalTimer);
    this.view.cancelGhostLine();
  }

  /** Leave the game and free the board for the menu or the tutorial. */
  stop() {
    this.#abortRunning();
    this.epoch += 1;
    this.status = 'idle';
    this.busy = false;
    this.showingLine = false;
    this.coachHold = false;
    this.coachView = null;
    this.emit('change');
  }

  // --- State questions used by the input and the interface ---------------------------------------------------

  get isLive() {
    return this.viewIndex === null;
  }

  get turn() {
    return this.chess.turn();
  }

  /** True when a person plays this color: both colors in a two-player game, and the player's color against the bot. */
  #isHuman(color) {
    return !this.mode.bot || color === this.playerColor;
  }

  /** True when the coach speaks in this game: always in Coach mode, and in a two-player game while its switch in the settings is on. The switch is read each time, so it applies at once (see `applyCoachSetting`). */
  get coachOn() {
    return this.mode.coach === 'choice' ? this.settings.get('twoPlayerCoach') : this.mode.coach;
  }

  /** True when a player may pick up and move a piece right now. In a two-player game the next player waits while the coach still looks at the last move or asks about it. */
  canInteract() {
    return this.status === 'playing' && this.isLive && !this.busy && !this.coachHold && !this.coachPending && this.#isHuman(this.chess.turn());
  }

  /** Is this a piece that a player may pick up? Against the bot these are the player's pieces, and in a two-player game the pieces of the side to move. */
  isOwnPiece(square) {
    const piece = this.chess.get(square);
    return Boolean(piece) && piece.color === (this.mode.bot ? this.playerColor : this.chess.turn());
  }

  /** Legal moves of the piece on a square (chess.js verbose moves). */
  targetsFrom(square) {
    return this.chess.moves({ square, verbose: true });
  }

  get canUndo() {
    if (!this.mode.undo || this.status !== 'playing' || this.busy) return false;
    return this.plies.some((ply) => this.#isHuman(ply.color));
  }

  /** FEN of the position shown on the board. */
  get shownFen() {
    if (this.viewIndex === null) return this.chess.fen();
    return this.viewIndex === 0 ? this.startFen : this.plies[this.viewIndex - 1].fenAfter;
  }

  // --- Player moves -----------------------------------------------------------------------------------------

  /**
   * The player tries a move (by tap or by drag).
   * @returns {Promise<boolean>} True when the move was played.
   */
  async attemptMove(from, to, options = {}) {
    if (!this.canInteract()) return false;
    const epoch = this.epoch;
    // Dropping the king on its own rook is a common way to castle; turn it into the real king target square.
    to = castlingTarget(this.chess.fen(), from, to);
    const candidates = this.chess.moves({ square: from, verbose: true }).filter((move) => move.to === to);
    if (candidates.length === 0) {
      this.#illegalMove(from, to);
      return false;
    }
    let promotion;
    if (candidates.some((move) => move.promotion)) {
      promotion = this.settings.get('autoQueen') ? 'q' : await this.prompts.promotion(this.chess.turn(), to);
      if (!promotion) return false;
    }
    const chosen = candidates.find((move) => (move.promotion ?? undefined) === promotion) ?? candidates[0];
    if (this.settings.get('moveConfirm')) {
      const confirmed = await this.prompts.confirm({ from, to, san: chosen.san });
      if (!confirmed) return false;
    }
    if (epoch !== this.epoch || !this.canInteract()) return false;
    await this.#commitPlayerMove({ from, to, promotion }, options);
    return true;
  }

  #illegalMove(from, to) {
    this.sfx.play('illegal');
    if (!this.coachOn) return;
    let reason = null;
    try {
      reason = explainIllegalMove(this.chess.fen(), from, to);
    } catch (error) {
      console.error('[game] could not explain the illegal move', error);
    }
    if (!reason) return;
    const shown = presentIllegal(reason, this.settings.get('coachLevel'), this.t);
    this.view.setCoachMarks(shown.highlights ?? [], shown.arrows ?? []);
    this.coachView = { kind: 'illegal', tone: 'warn', face: 'worried', text: shown.text, flagged: false, color: this.chess.turn() };
    this.emit('change');
    clearTimeout(this.illegalTimer);
    this.illegalTimer = setTimeout(() => {
      if (this.coachView?.kind === 'illegal') {
        this.view.clearCoachMarks();
        this.coachView = null;
        this.emit('change');
      }
    }, ILLEGAL_MARK_MS);
  }

  #record(move) {
    this.plies.push({ san: move.san, uci: toUci(move), from: move.from, to: move.to, color: move.color, fenAfter: move.after, clock: this.clock ? this.clock.snapshot() : null });
    const found = this.findOpening?.(move.after);
    if (found) this.opening = found;
  }

  // If the player is looking at an older position, jump back to the live one before a new move is shown.
  #ensureLive(fenBefore) {
    if (this.viewIndex !== null) {
      this.viewIndex = null;
      this.view.sync(fenBefore);
    }
  }

  async #commitPlayerMove(input, { fromDrag = false } = {}) {
    const epoch = this.epoch;
    this.busy = true;
    clearTimeout(this.illegalTimer);
    const fenBefore = this.chess.fen();
    const move = this.chess.move(input);
    this.clock?.completeMove(move.color);
    this.#record(move);
    const ending = this.#detectEnd();
    // The bot starts thinking now, while the player's move animates. Its reply is shown only after that animation.
    if (!ending && this.mode.bot) this.#startBot();
    const reporting = this.coachOn ? this.#buildCoachReport(fenBefore, move) : null;
    this.view.clearCoachMarks();
    this.coachView = null;
    this.emit('change');

    await this.view.playMove(move, { fromDrag });
    if (epoch !== this.epoch) return;
    this.view.setLastMove(move.from, move.to);
    this.#showCheck();
    this.busy = false;
    if (ending) {
      await this.#finish(ending);
      return;
    }
    if (reporting) {
      // The bot, or the other player, waits until the coach has spoken, so a flagged move can still be taken back.
      this.coachPending = true;
      const report = await withTimeout(reporting, COACH_WAIT_MS, null);
      if (epoch !== this.epoch) return;
      this.coachPending = false;
      // The coach of a two-player game can be switched off while it still looks at the move.
      if (report && this.coachOn) this.#showCoach(report, move);
    }
    if (this.mode.bot) {
      this.emit('change');
      this.#maybePlayBot();
    } else if (this.coachHold) {
      // The coach asks the player who just moved. The other player gets the game after the answer (see `coachContinue`).
      this.emit('change');
    } else {
      await this.#passTurn();
    }
  }

  // --- Two players --------------------------------------------------------------------------------------------

  /**
   * Two-player game: hand the game to the side that moves now. The board first turns to that side, and only then may that side move and does its clock start, so the turn of the board costs no clock time. While the board turns the game counts as busy, like during any other animation.
   */
  async #passTurn() {
    const epoch = this.epoch;
    const color = this.chess.turn();
    this.busy = true;
    this.emit('change');
    try {
      await this.turnBoard(color);
    } catch (error) {
      console.error('[game] the board could not turn to the side that moves; the game goes on without it', error);
    }
    if (epoch !== this.epoch) return;
    this.busy = false;
    this.clock?.start(color);
    if (this.coachOn) this.#startPreAnalysis();
    this.emit('change');
  }

  /**
   * The switch "coach in two-player games" was changed in the settings. Like every setting it applies at once, also in the middle of a game. Switched on, the coach gets its engine and speaks from the next move. Switched off, everything of the coach leaves the board, and a game that was stopped for the coach's question goes on.
   */
  applyCoachSetting() {
    if (this.status !== 'playing' || this.mode.coach !== 'choice') return;
    if (this.coachOn) {
      this.#readyCoachEngine();
      // Look at the position now, unless a move or a turn of the board is on its way: that one starts the search itself when it ends.
      if (!this.busy && !this.coachPending) this.#startPreAnalysis();
      this.emit('change');
      return;
    }
    this.pre?.promise.cancel();
    this.pre = null;
    clearTimeout(this.illegalTimer);
    this.view.cancelGhostLine();
    // A line of hologram pieces needs a moment to end. `coachShowLine` calls this method again when it has, so the game is never handed on in the middle of it.
    if (this.showingLine) return;
    this.view.clearCoachMarks();
    this.coachView = null;
    this.coachReport = null;
    this.evaluation = null;
    this.acceptedDangers = noDangers();
    if (this.coachHold) {
      this.coachHold = false;
      this.#passTurn();
    } else {
      this.emit('change');
    }
  }

  // --- Bot ---------------------------------------------------------------------------------------------------

  #startBot() {
    const botColor = other(this.playerColor);
    this.clock?.start(botColor);
    const job = chooseBotMove(this.botEngine, this.chess.fen(), this.botLevel);
    const entry = { job, move: undefined };
    this.botJob = entry;
    job.promise.then((uci) => {
      if (this.botJob !== entry) return;
      entry.move = uci;
      // The bot's clock only pays for real thinking time, not for waiting on the player's animation.
      this.clock?.pause();
      this.#maybePlayBot();
    });
  }

  #maybePlayBot() {
    const entry = this.botJob;
    if (!entry || entry.move === undefined) return;
    if (this.busy || this.coachHold || this.coachPending || this.status !== 'playing') return;
    this.botJob = null;
    if (entry.move === null) {
      // No move came back (cancelled search or no legal move). Re-check the position rather than freezing.
      const ending = this.#detectEnd();
      if (ending) this.#finish(ending);
      else this.#startBot();
      return;
    }
    this.#commitBotMove(entry.move);
  }

  async #commitBotMove(uci) {
    const epoch = this.epoch;
    this.busy = true;
    const fenBefore = this.chess.fen();
    let move;
    try {
      move = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch (error) {
      console.error('[game] the bot returned a move that is not legal here; asking again', uci, error);
      this.busy = false;
      this.#startBot();
      return;
    }
    this.#ensureLive(fenBefore);
    this.clock?.completeMove(move.color);
    this.#record(move);
    const ending = this.#detectEnd();
    // Analyze the player's new position while the bot's move animates, so coach feedback adds no waiting later.
    if (!ending && this.coachOn) this.#startPreAnalysis();
    if (this.coachView?.kind === 'illegal') this.coachView = null;
    this.view.clearCoachMarks();
    this.emit('change');

    await this.view.playMove(move);
    if (epoch !== this.epoch) return;
    this.view.setLastMove(move.from, move.to);
    this.#showCheck();
    this.busy = false;
    if (ending) {
      await this.#finish(ending);
      return;
    }
    this.clock?.start(this.playerColor);
    this.emit('change');
  }

  // --- Coach -------------------------------------------------------------------------------------------------

  #startPreAnalysis() {
    const fen = this.chess.fen();
    // After "Try again" the position is the one already analyzed: keep that result.
    if (this.pre?.fen === fen) return;
    this.pre?.promise.cancel();
    const promise = this.coachEngine.analyze({ fen, multipv: COACH_MULTIPV, depth: COACH_DEPTH, movetime: COACH_MOVETIME_MS });
    this.pre = { fen, promise };
    // A failed search is handled where the result is used (`#buildCoachReport`). The empty second handler here only keeps this chain from ending in a rejection that nobody handles, which the browser would report as an error.
    promise.then(
      (result) => {
        if (this.pre?.promise !== promise || result.lines.length === 0) return;
        const best = result.lines[0];
        const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
        this.evaluation = { cp: best.cp === null ? null : best.cp * sign, mate: best.mate === null ? null : best.mate * sign };
        this.emit('change');
      },
      () => {},
    );
  }

  async #buildCoachReport(fenBefore, move) {
    const input = { from: move.from, to: move.to, promotion: move.promotion };
    try {
      const source = this.pre?.fen === fenBefore ? this.pre.promise : this.coachEngine.analyze({ fen: fenBefore, multipv: COACH_MULTIPV, depth: COACH_DEPTH - 1, movetime: 900 });
      const { lines } = await source;
      const uci = toUci(move);
      let playedLine = lines.find((line) => line.move === uci) ?? null;
      if (!playedLine && lines.length > 0) {
        // The played move is not among the engine's top moves: search it alone, at the same depth, so the two scores can be compared fairly.
        const result = await this.coachEngine.analyze({ fen: fenBefore, multipv: 1, depth: lines[0].depth, movetime: 900, searchMoves: [uci] });
        playedLine = result.lines[0] ?? null;
      }
      return buildMoveReport({ fenBefore, move: input, lines, playedLine });
    } catch (error) {
      console.error('[game] coach analysis failed; falling back to feedback without the engine', error);
      try {
        return buildMoveReport({ fenBefore, move: input, lines: [], playedLine: null });
      } catch (inner) {
        console.error('[game] coach feedback is not available for this move', inner);
        return null;
      }
    }
  }

  #showCoach(report, move) {
    let shown;
    try {
      shown = presentFeedback(report, this.settings.get('coachLevel'), this.t);
    } catch (error) {
      console.error('[game] coach feedback could not be shown', error);
      return;
    }
    this.coachReport = report;
    shown.opening = this.opening?.name ?? null;
    // Whose move the card is about. A two-player game shows it, because the card stays on screen while the other player thinks.
    shown.color = move.color;
    if (report.evalAfter) this.evaluation = report.evalAfter;
    // Ask on every move, not only on flagged ones: the question also clears the accepted dangers that are over.
    const news = this.#isNews(report);
    const stop = shown.flagged && news;
    const onlyMistakes = this.settings.get('coachWhen') === 'mistakes';
    if (onlyMistakes && !stop) {
      this.coachView = null;
      return;
    }
    this.coachView = shown;
    this.view.setCoachMarks(shown.highlights ?? [], shown.arrows ?? []);
    if (stop) {
      this.coachHold = true;
      this.sfx.play(shown.tone === 'bad' ? 'coach.bad' : 'coach.warn');
    } else if (shown.flagged) {
      // A reminder of a danger the player already accepted: the card says it again, but the game goes on and no warning sounds.
    } else {
      this.sfx.play(shown.tone === 'great' ? 'coach.great' : 'coach.good');
      // The "best move" moment is kept for real finds: the single best move, not one of several equal opening moves.
      if (shown.rating === 'best' && (report.equalMoves?.length ?? 0) === 0 && this.plies.length > 6) this.view.celebrateBestMove(move.to);
    }
  }

  /**
   * Is a flagged report worth stopping the game for? It is not when the only reason is a piece in danger that the player already chose to leave there. This also forgets every accepted danger that is over (the piece moved away, was taken or is safe again), so the same piece stops the game again if it gets into danger later.
   * @param {import('../coach/report.js').MoveReport} report
   */
  #isNews(report) {
    // A report is about the pieces of the side that moved, so only that side's accepted dangers are looked at and cleaned up.
    const standing = new Set(dangers(report).map(dangerKey));
    const accepted = new Set([...this.acceptedDangers[report.color]].filter((key) => standing.has(key)));
    this.acceptedDangers[report.color] = accepted;
    if (accepted.size === 0) return true;
    const isAccepted = (finding) => finding.type === 'hanging-piece' && accepted.has(dangerKey(finding));
    try {
      return presentFeedback({ ...report, findings: report.findings.filter((finding) => !isAccepted(finding)) }, this.settings.get('coachLevel'), this.t).flagged;
    } catch (error) {
      console.error('[game] could not check whether the coach already said this; stopping the game to be safe', error);
      return true;
    }
  }

  /** Coach card button: go on with the game after a flagged move. It waits, like "Try again", while a line of hologram pieces plays: the game is not handed on in the middle of an animation. */
  coachContinue() {
    if (!this.coachHold || this.busy) return;
    // The player has seen the warning and leaves the piece where it is.
    for (const finding of this.coachReport ? dangers(this.coachReport) : []) this.acceptedDangers[this.coachReport.color].add(dangerKey(finding));
    this.coachHold = false;
    this.view.cancelGhostLine();
    this.view.clearCoachMarks();
    if (this.mode.bot) {
      this.emit('change');
      this.#maybePlayBot();
    } else {
      this.#passTurn();
    }
  }

  /** Coach card button: take the flagged move back and try another one. */
  coachTryAgain() {
    if (!this.coachHold || this.busy) return;
    this.#takeBack();
  }

  /**
   * Coach card buttons: play a line with hologram pieces.
   * @param {'problem'|'better'} which "problem" shows what goes wrong after the played move; "better" shows the stronger move.
   */
  async coachShowLine(which) {
    const shown = this.coachView;
    if (!shown || this.busy) return;
    const line = which === 'better' ? shown.betterLine : shown.ghostLine;
    if (!line || !line.moves?.length) return;
    const epoch = this.epoch;
    const current = this.chess.fen();
    this.busy = true;
    this.showingLine = true;
    this.emit('change');
    try {
      // The "better" line starts one move earlier, so the board first goes back to that position.
      if (line.fen !== current) this.view.sync(line.fen);
      // The line is drawn for the side whose move the card is about: the other side's moves in it are the danger.
      await this.view.playGhostLine(line.fen, line.moves, { player: shown.color ?? this.playerColor });
    } finally {
      if (epoch === this.epoch) {
        this.showingLine = false;
        if (line.fen !== current) {
          this.view.sync(current);
          const last = this.plies[this.plies.length - 1];
          if (last) this.view.setLastMove(last.from, last.to);
          this.#showCheck(false);
        }
        this.busy = false;
        if (this.coachOn) {
          this.view.setCoachMarks(shown.highlights ?? [], shown.arrows ?? []);
          this.emit('change');
        } else {
          // The coach of a two-player game was switched off while the line played: finish that now.
          this.applyCoachSetting();
        }
      }
    }
  }

  // --- Undo and history --------------------------------------------------------------------------------------

  /** Take back the player's last move (and the bot's reply to it, when there is one). In a two-player game this is the last move of either side, so the player who made it moves again. */
  undo() {
    if (!this.canUndo) return;
    this.#takeBack();
  }

  #takeBack() {
    this.epoch += 1;
    this.botJob?.job.cancel();
    this.botJob = null;
    this.view.cancelGhostLine();
    // Remove plies until a person's last move is gone and it is that person's turn again: the player's move and the bot's reply to it, or the one last move of a two-player game.
    let removedPlayerMove = false;
    while (this.plies.length > 0 && !removedPlayerMove) {
      const ply = this.plies.pop();
      this.chess.undo();
      if (this.#isHuman(ply.color)) removedPlayerMove = true;
    }
    const last = this.plies[this.plies.length - 1];
    if (this.clock) {
      // The clock goes back to how it stood after the last remaining move.
      if (last?.clock) this.clock.restore(last.clock);
      else this.clock = new ChessClock(this.config.timeControl);
    }
    this.viewIndex = null;
    this.busy = false;
    this.showingLine = false;
    this.coachHold = false;
    this.coachPending = false;
    this.coachView = null;
    this.coachReport = null;
    this.view.sync(this.chess.fen());
    this.view.setLastMove(last?.from ?? null, last?.to ?? null);
    this.view.clearCoachMarks();
    this.#showCheck(false);
    this.sfx.play('piece.deselect');
    if (!this.mode.bot) {
      // The board turns back to the player whose move was taken back.
      this.#passTurn();
    } else if (this.chess.turn() === this.playerColor) {
      this.clock?.start(this.playerColor);
      if (this.coachOn) this.#startPreAnalysis();
      this.emit('change');
    } else {
      this.#startBot();
      this.emit('change');
    }
  }

  /**
   * Look at an earlier position. Index 0 is the start, index n is the position after n half-moves, null goes back to the live game.
   * @param {number|null} index
   */
  viewPly(index) {
    if (this.busy) return;
    const next = index === null || index >= this.plies.length ? null : Math.max(0, index);
    if (next === this.viewIndex) return;
    this.viewIndex = next;
    this.view.sync(this.shownFen);
    const shownPly = next === null ? this.plies[this.plies.length - 1] : next > 0 ? this.plies[next - 1] : null;
    this.view.setLastMove(shownPly?.from ?? null, shownPly?.to ?? null);
    this.view.clearCoachMarks();
    this.#showCheck(false);
    this.emit('change');
  }

  /** Step through the move list. */
  stepView(delta) {
    const current = this.viewIndex === null ? this.plies.length : this.viewIndex;
    this.viewPly(current + delta);
  }

  // --- Check and game end -----------------------------------------------------------------------------------

  #showCheck(alarm = true) {
    const chess = new Chess(this.shownFen);
    if (!chess.isCheck()) {
      this.view.setCheck(null);
      return;
    }
    const color = chess.turn();
    let kingSquare = null;
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === color) kingSquare = cell.square;
      }
    }
    this.view.setCheck(kingSquare, alarm && !chess.isCheckmate());
  }

  #detectEnd() {
    const chess = this.chess;
    if (chess.isCheckmate()) return { type: 'checkmate', winner: other(chess.turn()) };
    if (chess.isStalemate()) return { type: 'stalemate', winner: null };
    if (chess.isInsufficientMaterial()) return { type: 'insufficient', winner: null };
    if (chess.isThreefoldRepetition()) return { type: 'repetition', winner: null };
    if (chess.isDrawByFiftyMoves()) return { type: 'fifty', winner: null };
    return null;
  }

  async #finish(result) {
    if (this.status === 'over') return;
    const epoch = this.epoch;
    this.status = 'over';
    this.result = result;
    this.clock?.pause();
    this.botJob?.job.cancel();
    this.botJob = null;
    this.pre?.promise.cancel();
    this.pre = null;
    this.showingLine = false;
    this.coachHold = false;
    this.coachPending = false;
    this.#ensureLive(this.chess.fen());
    this.emit('change');
    // In a two-player game every win is the win of a person at the device, so nobody hears the losing sound.
    this.sfx.play(result.winner === null ? 'game.draw' : this.#isHuman(result.winner) ? 'game.win' : 'game.lose');
    await this.view.playGameEnd({ type: result.type, winner: result.winner });
    if (epoch !== this.epoch) return;
    this.emit('gameover', result);
  }

  /**
   * A player gives up.
   * @param {'w'|'b'} [color] The side that gives up. Against the bot this is always the player, so it can be left out; a two-player game must say which of the two it is.
   */
  resign(color = this.playerColor) {
    if (this.status !== 'playing') return;
    this.epoch += 1;
    this.busy = false;
    this.#finish({ type: 'resign', winner: other(color) });
  }

  /** Call every frame: detects a clock running out. */
  tick() {
    if (!this.clock || this.status !== 'playing') return;
    const flagged = this.clock.tick();
    if (!flagged) return;
    // Running out of time loses, unless the other side has no way to give mate, which is a draw.
    const winner = other(flagged);
    const pieces = this.chess.board().flat().filter((cell) => cell && cell.color === winner);
    const canMate = pieces.some((cell) => cell.type !== 'k');
    this.epoch += 1;
    this.busy = false;
    this.#finish({ type: 'timeout', winner: canMate ? winner : null });
  }

  // --- Export ------------------------------------------------------------------------------------------------

  /** The game as PGN text. */
  pgn() {
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    // The names of the two sides: the player and the bot, or the two players of a two-player game.
    const you = this.t('export.player');
    const bot = this.t('export.bot', { level: this.botLevel });
    const names = this.mode.bot ? { [this.playerColor]: you, [other(this.playerColor)]: bot } : { w: this.t('export.white'), b: this.t('export.black') };
    const result = this.result ? (this.result.winner === 'w' ? '1-0' : this.result.winner === 'b' ? '0-1' : '1/2-1/2') : '*';
    this.chess.setHeader('Event', this.t('app.name'));
    this.chess.setHeader('Site', '?');
    this.chess.setHeader('Date', `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`);
    this.chess.setHeader('Round', '?');
    this.chess.setHeader('White', names.w);
    this.chess.setHeader('Black', names.b);
    this.chess.setHeader('Result', result);
    return this.chess.pgn();
  }

  /** The live position as FEN text. */
  fen() {
    return this.chess.fen();
  }
}
