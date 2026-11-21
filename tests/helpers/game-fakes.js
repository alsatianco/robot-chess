// Test stand-ins for the two parts of a game that need a browser: the 3D board view and the Stockfish worker. Everything else in the game tests is the real code: the real Game, the real Engine wrapper, the real coach and the real Settings.
import { Chess } from 'chess.js';
import { Engine } from '../../src/engine/engine.js';
import { Game } from '../../src/core/game.js';
import { Settings } from '../../src/core/settings.js';

/** A board view that draws nothing. Every animation ends at once, and each call is kept in `calls` so a test can read what the player would have seen. */
export function fakeView() {
  const calls = [];
  const view = { calls };
  for (const name of ['sync', 'setLastMove', 'setCheck', 'clearCoachMarks', 'clearLegalTargets', 'cancelGhostLine', 'setCoachMarks', 'celebrateBestMove']) {
    view[name] = (...args) => {
      calls.push({ name, args });
    };
  }
  for (const name of ['playMove', 'playGhostLine', 'playGameEnd']) {
    view[name] = async (...args) => {
      calls.push({ name, args });
    };
  }
  return view;
}

/** A stand-in for the Stockfish worker. It answers the UCI handshake, and for each search it asks `chooseMove(fen)` which move to report: a UCI move, or null for "no move". */
class FakeWorker {
  constructor(chooseMove) {
    this.chooseMove = chooseMove;
    this.fen = null;
    this.onmessage = null;
    this.onerror = null;
  }
  postMessage(text) {
    const reply = (line) => queueMicrotask(() => this.onmessage?.({ data: line }));
    if (text === 'isready') reply('readyok');
    if (text.startsWith('position fen ')) this.fen = text.slice('position fen '.length);
    if (text.startsWith('go')) {
      const move = this.chooseMove(this.fen);
      if (move) reply(`info depth 1 multipv 1 score cp 0 pv ${move}`);
      reply(`bestmove ${move ?? '(none)'}`);
    }
  }
  terminate() {}
}

/** An engine that plays the first move of `wanted` that is legal in the position. With an empty list it finds no move at all, like an engine that has nothing to say. */
export function scriptedEngine(wanted = []) {
  const chooseMove = (fen) => {
    const legal = new Chess(fen).moves({ verbose: true }).map((move) => move.from + move.to + (move.promotion ?? ''));
    return wanted.find((uci) => legal.includes(uci)) ?? null;
  };
  return new Engine({ createWorker: () => new FakeWorker(chooseMove) });
}

/** An engine in a browser that refuses to start a worker. */
export function brokenEngine() {
  return new Engine({
    createWorker: () => {
      throw new Error('Workers are blocked in this test');
    },
  });
}

/**
 * A real Game with the fakes above. The first engine the game asks for is the bot's, the second is the coach's. In a two-player game there is no bot, so the first engine is the coach's.
 * @param {{botMoves?: string[], createEngine?: () => Engine, turnBoard?: (color: 'w'|'b') => Promise<void>}} [options] `botMoves` are the bot's wishes, in order of preference. Use bot level 4 or higher in `newGame`: those levels play the engine's move as it is, so the game is the same on every run. `turnBoard` stands in for the camera that turns the board in a two-player game; without it the turn ends at once. Each color the game asks the board to turn to is kept in `turns`, and each engine the game asks for in `engines`.
 */
export function makeGame({ botMoves = [], createEngine = null, turnBoard = null } = {}) {
  const view = fakeView();
  const settings = new Settings();
  const sounds = [];
  const toasts = [];
  const engines = [];
  const turns = [];
  const game = new Game({
    view,
    settings,
    sfx: { play: (name) => sounds.push(name) },
    t: (key) => key,
    prompts: { promotion: async () => 'q', confirm: async () => true },
    turnBoard: (color) => {
      turns.push(color);
      return turnBoard ? turnBoard(color) : Promise.resolve();
    },
    createEngine: () => {
      const engine = createEngine ? createEngine() : scriptedEngine(engines.length === 0 ? botMoves : []);
      engines.push(engine);
      return engine;
    },
  });
  game.on('toast', (toast) => toasts.push(toast));
  return { game, view, settings, sounds, toasts, turns, engines };
}

/** Wait until it is the player's turn again: the bot's reply has been found and "animated". */
export async function untilPlayersTurn(game) {
  for (let i = 0; i < 200; i++) {
    if (game.canInteract()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`The player never got the turn back (status ${game.status}, turn ${game.turn}, hold ${game.coachHold}, busy ${game.busy})`);
}
