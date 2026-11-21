// Runs the interactive tutorial: it walks through the lesson steps, sets up each position on the 3D board, lets the child make the asked move, and reacts to right and wrong tries. The lesson content itself lives in lessons.js.
import { Chess } from 'chess.js';
import { lessons } from './lessons.js';

const DEMO_START_DELAY_MS = 700;
const DEMO_HOLD_MS = 1300;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function kingInCheckSquare(chess) {
  if (!chess.isCheck()) return null;
  const color = chess.turn();
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square;
    }
  }
  return null;
}

export class TutorialRunner {
  /**
   * @param {object} deps
   * @param {import('../gfx/boardview.js').BoardView} deps.view
   * @param {import('../ui/ui.js').AppUI} deps.ui
   * @param {{play:(name:string, opts?:object)=>void}} deps.sfx
   * @param {(key:string, params?:object)=>string} deps.t
   * @param {(finished:boolean)=>void} deps.onExit Called when the tutorial ends; `finished` is false when it was skipped.
   */
  constructor({ view, ui, sfx, t, onExit }) {
    this.view = view;
    this.ui = ui;
    this.sfx = sfx;
    this.t = t;
    this.onExit = onExit;
    this.steps = lessons.flatMap((lesson) => lesson.steps.map((step) => ({ lesson, step })));
    this.index = 0;
    this.chess = new Chess();
    /** 'setup' while scripted moves play, 'waiting' for the child's move, 'done' after a right move, 'info' for reading steps, 'finished' at the end. */
    this.state = 'setup';
    this.note = null;
    this.noteTone = 'ok';
    /** Changes with every step so that late animations of an old step do nothing. */
    this.token = 0;
    this.active = false;
  }

  start() {
    this.active = true;
    this.index = 0;
    this.#showStep();
  }

  stop() {
    this.active = false;
    this.token += 1;
    this.view.clearCoachMarks();
    this.view.setHint([]);
    this.view.setCheck(null);
  }

  // --- Input target (same interface as the game) -------------------------------------------------------------

  canInteract() {
    return this.active && this.state === 'waiting' && !this.view.busy;
  }

  isOwnPiece(square) {
    const piece = this.chess.get(square);
    return Boolean(piece) && piece.color === this.chess.turn();
  }

  targetsFrom(square) {
    return this.chess.moves({ square, verbose: true });
  }

  async attemptMove(from, to, options = {}) {
    if (!this.canInteract()) return false;
    const { step } = this.steps[this.index];
    const token = this.token;
    const legal = this.chess.moves({ square: from, verbose: true }).filter((move) => move.to === to);
    // In the tutorial a pawn that reaches the last row always becomes a queen; the picker comes later, in real games.
    const promotion = legal.some((move) => move.promotion) ? 'q' : undefined;
    const uci = from + to + (promotion ?? '');
    if (legal.length === 0 || !step.accept.includes(uci)) {
      this.sfx.play('illegal');
      this.note = this.t(step.wrong);
      this.noteTone = 'warn';
      this.#render();
      return false;
    }
    this.state = 'setup';
    const move = this.chess.move({ from, to, promotion });
    this.view.setHint([]);
    this.view.clearCoachMarks();
    await this.view.playMove(move, options);
    if (token !== this.token) return true;
    this.view.setLastMove(move.from, move.to);
    this.#showCheck();
    this.sfx.play('tutorial.success');
    this.note = this.t(step.success);
    this.noteTone = 'good';
    this.#render();
    if (step.reply) {
      await wait(500);
      if (token !== this.token) return true;
      await this.#playScripted([step.reply], token);
      if (token !== this.token) return true;
    }
    this.state = 'done';
    this.#render();
    return true;
  }

  // --- Steps ------------------------------------------------------------------------------------------------

  #showCheck() {
    this.view.setCheck(kingInCheckSquare(this.chess), false);
  }

  async #playScripted(moves, token) {
    for (const uci of moves) {
      if (token !== this.token) return;
      let move;
      try {
        move = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      } catch (error) {
        console.error('[tutorial] scripted move is not legal', uci, error);
        return;
      }
      await this.view.playMove(move);
      if (token !== this.token) return;
      this.view.setLastMove(move.from, move.to);
      this.#showCheck();
      await wait(250);
    }
  }

  async #showStep() {
    const token = ++this.token;
    const { step } = this.steps[this.index];
    this.chess = new Chess(step.fen);
    this.note = null;
    this.state = 'setup';
    this.view.sync(step.fen);
    this.view.setLastMove(null, null);
    this.view.setHint([]);
    this.#showCheck();
    this.view.setCoachMarks(step.highlights ?? [], step.arrows ?? []);
    this.#render();

    if (step.kind === 'info') {
      this.state = 'info';
      this.#render();
      if (step.demo?.length) {
        await wait(DEMO_START_DELAY_MS);
        if (token !== this.token) return;
        await this.#playScripted(step.demo, token);
        if (token !== this.token) return;
        await wait(DEMO_HOLD_MS);
        if (token !== this.token) return;
        // Put the position back so the child can study it while reading.
        this.chess = new Chess(step.fen);
        this.view.sync(step.fen);
        this.view.setLastMove(null, null);
        this.#showCheck();
        this.view.setCoachMarks(step.highlights ?? [], step.arrows ?? []);
      }
      return;
    }

    if (step.prelude?.length) {
      await wait(DEMO_START_DELAY_MS);
      if (token !== this.token) return;
      await this.#playScripted(step.prelude, token);
      if (token !== this.token) return;
      this.view.setCoachMarks(step.highlights ?? [], step.arrows ?? []);
    }
    // Show where to go: brackets on the target square and an arrow from the piece.
    this.view.setHint([step.hint.to]);
    this.view.setCoachMarks([...(step.highlights ?? [])], [...(step.arrows ?? []), { from: step.hint.from, to: step.hint.to, kind: 'target' }]);
    this.state = 'waiting';
    this.#render();
  }

  #go(delta) {
    const next = this.index + delta;
    if (next < 0) return;
    if (next >= this.steps.length) {
      this.#finish();
      return;
    }
    this.index = next;
    this.#showStep();
  }

  #finish() {
    this.token += 1;
    this.state = 'finished';
    this.view.clearCoachMarks();
    this.view.setHint([]);
    this.sfx.play('game.win');
    this.#render();
  }

  #render() {
    const t = this.t;
    if (this.state === 'finished') {
      this.ui.renderTutorial({ chapter: t('tutorial.ui.finishedTitle'), text: t('tutorial.ui.finishedText'), progress: '', face: 'wow', buttons: [{ label: t('tutorial.ui.done'), action: () => this.onExit(true), primary: true, icon: 'check' }] });
      return;
    }
    const { lesson, step } = this.steps[this.index];
    const buttons = [];
    if (this.index > 0) buttons.push({ label: t('tutorial.ui.back'), action: () => this.#go(-1), icon: 'back' });
    const canNext = this.state === 'info' || this.state === 'done';
    if (canNext) buttons.push({ label: t('tutorial.ui.next'), action: () => this.#go(1), primary: true, icon: 'forward' });
    buttons.push({ label: t('tutorial.ui.skip'), action: () => this.onExit(false) });
    this.ui.renderTutorial({
      chapter: t(lesson.title),
      text: t(step.text),
      note: this.note,
      noteTone: this.noteTone,
      progress: t('tutorial.ui.progress', { current: this.index + 1, total: this.steps.length }),
      face: this.noteTone === 'warn' && this.note ? 'worried' : this.state === 'done' ? 'wow' : 'happy',
      buttons,
    });
  }
}
