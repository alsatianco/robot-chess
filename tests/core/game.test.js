// Tests of the game controller with a real coach and a real engine wrapper. Only the 3D board and the Stockfish worker are stand-ins (see tests/helpers/game-fakes.js).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeGame, brokenEngine, untilPlayersTurn } from '../helpers/game-fakes.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// White has a pawn on e5 that the black knight on c6 can take for free. White has no capture of its own, and quiet pawn moves on both wings.
const PAWN_IN_DANGER = '6k1/p6p/2n5/4P3/8/8/P6P/6K1 w - - 0 1';
/** The bot never takes the pawn here: it only makes quiet moves, so the danger stays on the board. */
const QUIET_BOT = ['h7h6', 'g8h8', 'h8g8', 'h6h5'];

describe('coach: a piece left in danger', () => {
  it('stops the game when a move leaves a piece that can be taken for free', async () => {
    const { game } = makeGame({ botMoves: QUIET_BOT });
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });

    await game.attemptMove('h2', 'h3');

    expect(game.coachHold).toBe(true);
    expect(game.coachView.primaryFinding).toMatchObject({ type: 'hanging-piece', square: 'e5' });
    expect(game.plies.map((ply) => ply.uci)).toEqual(['h2h3']);
  });

  it('does not stop the game a second time for the same piece after the player chose to keep going', async () => {
    const { game } = makeGame({ botMoves: QUIET_BOT });
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    await untilPlayersTurn(game);

    await game.attemptMove('h3', 'h4');
    await untilPlayersTurn(game);

    expect(game.coachHold).toBe(false);
    expect(game.plies.map((ply) => ply.uci)).toEqual(['h2h3', 'h7h6', 'h3h4', 'g8h8']);
  });

  it('still tells the player about the piece on the second move, without the stop', async () => {
    const { game } = makeGame({ botMoves: QUIET_BOT });
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    await untilPlayersTurn(game);

    await game.attemptMove('h3', 'h4');

    expect(game.coachHold).toBe(false);
    expect(game.coachView.primaryFinding).toMatchObject({ type: 'hanging-piece', square: 'e5' });
  });

  it('plays no warning sound for a danger the player already accepted', async () => {
    const { game, sounds } = makeGame({ botMoves: QUIET_BOT });
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    await untilPlayersTurn(game);
    sounds.length = 0;

    await game.attemptMove('h3', 'h4');

    expect(sounds.filter((name) => name.startsWith('coach.'))).toEqual([]);
  });

  it('shows nothing for an accepted danger when the coach only speaks after mistakes', async () => {
    const { game, settings } = makeGame({ botMoves: QUIET_BOT });
    settings.set('coachWhen', 'mistakes');
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    await untilPlayersTurn(game);

    await game.attemptMove('h3', 'h4');

    expect(game.coachView).toBe(null);
  });

  it('stops the game again when another piece gets into danger', async () => {
    const { game } = makeGame({ botMoves: QUIET_BOT });
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    await untilPlayersTurn(game);
    await game.attemptMove('a2', 'a4');
    await untilPlayersTurn(game);

    // The a-pawn steps next to the knight, where it can be taken for free too.
    await game.attemptMove('a4', 'a5');

    expect(game.coachHold).toBe(true);
  });

  it('stops the game again for the same piece after it was saved and then left in danger once more', async () => {
    const { game } = makeGame({ botMoves: ['c6b8', 'b8c6', 'h7h6', 'g8h8'] });
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    // The knight goes away, so the pawn is safe for one move, and then it comes back.
    await untilPlayersTurn(game);
    await game.attemptMove('h3', 'h4');
    await untilPlayersTurn(game);

    await game.attemptMove('a2', 'a3');

    expect(game.plies.map((ply) => ply.uci)).toEqual(['h2h3', 'c6b8', 'h3h4', 'b8c6', 'a2a3']);
    expect(game.coachHold).toBe(true);
  });

  it('forgets what the player accepted when a new game starts', async () => {
    const { game } = makeGame({ botMoves: QUIET_BOT });
    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    await untilPlayersTurn(game);

    game.newGame({ mode: 'coach', level: 4, color: 'w', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');

    expect(game.coachHold).toBe(true);
  });
});

describe('a chess engine that can not start', () => {
  it('tells the player once and leaves no error without a handler', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { game, toasts } = makeGame({ createEngine: brokenEngine });

      game.newGame({ mode: 'coach', level: 4, color: 'w' });
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(toasts).toEqual([{ text: 'errors.engine', tone: 'bad', sticky: true }]);
      expect(logged.mock.calls.every(([prefix]) => String(prefix).startsWith('[game]'))).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

/** Let the steps that are already waiting run: the fake board ends every animation at once, so a few turns of the event loop are enough. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

// The same danger for the other side: Black has a pawn on e4 that the white knight on c3 can take for free.
const BLACK_PAWN_IN_DANGER = '6k1/p6p/8/8/4p3/2N5/P6P/6K1 b - - 0 1';

describe('a two-player game', () => {
  it('lets both sides move, one after the other', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two' });

    expect(game.canInteract()).toBe(true);
    expect(await game.attemptMove('e2', 'e4')).toBe(true);
    expect(game.turn).toBe('b');
    expect(game.canInteract()).toBe(true);
    expect(await game.attemptMove('e7', 'e5')).toBe(true);

    expect(game.plies.map((ply) => ply.uci)).toEqual(['e2e4', 'e7e5']);
    expect(game.canInteract()).toBe(true);
  });

  it('counts the pieces of the side to move as the ones a player may pick up', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two' });
    expect(game.isOwnPiece('e2')).toBe(true);
    expect(game.isOwnPiece('e7')).toBe(false);

    await game.attemptMove('e2', 'e4');

    expect(game.isOwnPiece('e7')).toBe(true);
    expect(game.isOwnPiece('e4')).toBe(false);
  });

  it('needs no chess engine at all', async () => {
    const { game, engines, toasts } = makeGame({ createEngine: brokenEngine });
    game.newGame({ mode: 'two' });
    await game.attemptMove('e2', 'e4');
    await game.attemptMove('e7', 'e5');

    expect(engines).toEqual([]);
    expect(toasts).toEqual([]);
    expect(game.plies).toHaveLength(2);
  });

  it('has no coach, because the coach of a two-player game is off until it is switched on in the settings', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });
    expect(game.coachOn).toBe(false);

    await game.attemptMove('h2', 'h3');

    expect(game.coachView).toBe(null);
    expect(game.coachHold).toBe(false);
  });

  it('takes back one move at a time, so the player who made it moves again', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two' });
    await game.attemptMove('e2', 'e4');
    await game.attemptMove('e7', 'e5');

    game.undo();
    await settle();
    expect(game.plies.map((ply) => ply.uci)).toEqual(['e2e4']);
    expect(game.turn).toBe('b');
    expect(game.canInteract()).toBe(true);

    game.undo();
    await settle();
    expect(game.plies).toEqual([]);
    expect(game.turn).toBe('w');
    expect(game.canUndo).toBe(false);
  });

  it('lets either side give up, and the other side wins', async () => {
    const first = makeGame();
    first.game.newGame({ mode: 'two' });
    first.game.resign('b');
    await settle();
    expect(first.game.result).toEqual({ type: 'resign', winner: 'w' });

    const second = makeGame();
    second.game.newGame({ mode: 'two' });
    second.game.resign('w');
    await settle();
    expect(second.game.result).toEqual({ type: 'resign', winner: 'b' });
  });

  it('plays the winning sound when either side wins, because one of the two players at the device won', async () => {
    const { game, sounds } = makeGame();
    game.newGame({ mode: 'two' });
    // The shortest checkmate: Black wins.
    await game.attemptMove('f2', 'f3');
    await game.attemptMove('e7', 'e5');
    await game.attemptMove('g2', 'g4');
    await game.attemptMove('d8', 'h4');
    await settle();

    expect(game.result).toEqual({ type: 'checkmate', winner: 'b' });
    expect(sounds).toContain('game.win');
    expect(sounds).not.toContain('game.lose');
  });

  it('names the two players in the game file', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two' });
    await game.attemptMove('e2', 'e4');

    expect(game.pgn()).toContain('[White "export.white"]');
    expect(game.pgn()).toContain('[Black "export.black"]');
  });

  it('has no clock unless a time control was picked', () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two' });
    expect(game.clock).toBe(null);

    game.newGame({ mode: 'two', timeControl: null });
    expect(game.clock).toBe(null);
  });

  it('runs the clock of the side to move when a time control was picked', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two', timeControl: '5+0' });
    expect(game.clock.control).toBe('5+0');
    expect(game.clock.running).toBe('w');

    await game.attemptMove('e2', 'e4');
    expect(game.clock.running).toBe('b');

    await game.attemptMove('e7', 'e5');
    expect(game.clock.running).toBe('w');
  });

  it('puts the clock back to the move before when a move is taken back', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two', timeControl: '3+2' });
    await game.attemptMove('e2', 'e4');
    const afterFirst = { ...game.plies[0].clock };
    await game.attemptMove('e7', 'e5');

    game.undo();
    await settle();

    expect(game.clock.running).toBe('b');
    expect(game.clock.remaining.w).toBe(afterFirst.w);
  });
});

describe('a two-player game: the board turns to the side that moves', () => {
  it('asks the board to turn to the next side after each move', async () => {
    const { game, turns } = makeGame();
    game.newGame({ mode: 'two' });
    expect(turns).toEqual([]);

    await game.attemptMove('e2', 'e4');
    await game.attemptMove('e7', 'e5');

    expect(turns).toEqual(['b', 'w']);
  });

  it('asks the board to turn back when a move is taken back', async () => {
    const { game, turns } = makeGame();
    game.newGame({ mode: 'two' });
    await game.attemptMove('e2', 'e4');

    game.undo();
    await settle();

    expect(turns).toEqual(['b', 'w']);
  });

  it('holds the next move and the clock until the board has turned, so the turn costs no clock time', async () => {
    let turned;
    const { game } = makeGame({ turnBoard: () => new Promise((resolve) => (turned = resolve)) });
    game.newGame({ mode: 'two', timeControl: '5+0' });

    const moving = game.attemptMove('e2', 'e4');
    await settle();
    expect(game.clock.running).toBe(null);
    expect(game.canInteract()).toBe(false);
    expect(game.canUndo).toBe(false);

    turned();
    await moving;
    expect(game.clock.running).toBe('b');
    expect(game.canInteract()).toBe(true);
  });

  it('goes on when the board can not turn', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { game } = makeGame({ turnBoard: () => Promise.reject(new Error('The camera is broken in this test')) });
    game.newGame({ mode: 'two' });

    await game.attemptMove('e2', 'e4');

    expect(game.canInteract()).toBe(true);
    expect(logged.mock.calls.every(([prefix]) => String(prefix).startsWith('[game]'))).toBe(true);
  });

  it('never asks the board to turn in a game against the bot', async () => {
    const { game, turns } = makeGame({ botMoves: ['e7e5'] });
    game.newGame({ mode: 'free', level: 4, color: 'w' });
    await game.attemptMove('e2', 'e4');
    await untilPlayersTurn(game);
    game.undo();

    expect(turns).toEqual([]);
  });
});

describe('the start of a game', () => {
  it('is announced for a new game, for "Play again" and for a game that goes on, so the board can be shown from the right side', async () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    let starts = 0;
    game.on('start', () => (starts += 1));

    game.newGame({ mode: 'free', level: 4, color: 'b' });
    expect(starts).toBe(1);
    game.rematch();
    expect(starts).toBe(2);
    game.resume({ v: 1, mode: 'two', level: null, color: 'w', colorChoice: 'w', timeControl: null, startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', plies: [{ uci: 'e2e4', clock: null }], clock: null, savedAt: 1 });
    expect(starts).toBe(3);
  });

  it('still lets the player give up a game against the bot, and the bot wins', async () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    game.newGame({ mode: 'free', level: 4, color: 'b' });

    game.resign();
    await settle();

    expect(game.result).toEqual({ type: 'resign', winner: 'w' });
  });
});

describe('a two-player game with the coach switched on', () => {
  const withCoach = (options) => {
    const made = makeGame(options);
    made.settings.set('twoPlayerCoach', true);
    return made;
  };

  it('speaks about the moves of both players', async () => {
    const { game } = withCoach();
    game.newGame({ mode: 'two' });
    expect(game.coachOn).toBe(true);

    await game.attemptMove('e2', 'e4');
    expect(game.coachView).toMatchObject({ color: 'w' });

    await game.attemptMove('e7', 'e5');
    expect(game.coachView).toMatchObject({ color: 'b' });
  });

  it('stops the game for a piece left in danger, and the other player can not move until the first one has chosen', async () => {
    const { game, turns } = withCoach();
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });

    await game.attemptMove('h2', 'h3');

    expect(game.coachHold).toBe(true);
    expect(game.coachView.primaryFinding).toMatchObject({ type: 'hanging-piece', square: 'e5' });
    expect(game.turn).toBe('b');
    expect(game.canInteract()).toBe(false);
    // The board stays with the player who is asked.
    expect(turns).toEqual([]);
  });

  it('hands the game to the other player after "Keep going"', async () => {
    const { game, turns } = withCoach();
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');

    game.coachContinue();
    await settle();

    expect(game.coachHold).toBe(false);
    expect(game.canInteract()).toBe(true);
    expect(game.isOwnPiece('c6')).toBe(true);
    expect(turns).toEqual(['b']);
  });

  it('takes back only the flagged move on "Try again", and the same player moves again', async () => {
    const { game, turns } = withCoach();
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');

    game.coachTryAgain();
    await settle();

    expect(game.plies).toEqual([]);
    expect(game.turn).toBe('w');
    expect(game.coachHold).toBe(false);
    expect(game.canInteract()).toBe(true);
    expect(turns).toEqual(['w']);
  });

  it('stops the game for the second player too', async () => {
    const { game } = withCoach();
    game.newGame({ mode: 'two', fen: BLACK_PAWN_IN_DANGER });

    await game.attemptMove('h7', 'h6');

    expect(game.coachHold).toBe(true);
    expect(game.coachView).toMatchObject({ color: 'b' });
    expect(game.coachView.primaryFinding).toMatchObject({ type: 'hanging-piece', square: 'e4' });
  });

  it('remembers for each player apart which danger that player accepted', async () => {
    const { game } = withCoach();
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    game.coachContinue();
    await settle();
    // Black does not take the pawn, so the coach stops the game for Black too, to show the free pawn. Black has no piece in danger, and that must not make the coach forget what White accepted.
    await game.attemptMove('h7', 'h6');
    expect(game.coachView).toMatchObject({ color: 'b' });
    expect(game.coachHold).toBe(true);
    game.coachContinue();
    await settle();

    await game.attemptMove('h3', 'h4');

    expect(game.coachHold).toBe(false);
    expect(game.coachView.primaryFinding).toMatchObject({ type: 'hanging-piece', square: 'e5' });
    expect(game.plies.map((ply) => ply.uci)).toEqual(['h2h3', 'h7h6', 'h3h4']);
  });

  it('keeps the clocks stopped while the coach waits for an answer', async () => {
    const { game } = withCoach();
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER, timeControl: '5+0' });

    await game.attemptMove('h2', 'h3');
    expect(game.coachHold).toBe(true);
    expect(game.clock.running).toBe(null);

    game.coachContinue();
    await settle();
    expect(game.clock.running).toBe('b');
  });

  it('lets the game go on when the coach is switched off while it waits for an answer', async () => {
    const { game, settings } = withCoach();
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    expect(game.coachHold).toBe(true);

    settings.set('twoPlayerCoach', false);
    game.applyCoachSetting();
    await settle();

    expect(game.coachOn).toBe(false);
    expect(game.coachHold).toBe(false);
    expect(game.coachView).toBe(null);
    expect(game.canInteract()).toBe(true);
    expect(game.plies.map((ply) => ply.uci)).toEqual(['h2h3']);
  });

  it('draws a line of hologram pieces for the side whose move the card is about', async () => {
    const { game, view } = withCoach();
    game.newGame({ mode: 'two', fen: BLACK_PAWN_IN_DANGER });
    await game.attemptMove('h7', 'h6');

    await game.coachShowLine('problem');

    const played = view.calls.filter((call) => call.name === 'playGhostLine');
    expect(played).toHaveLength(1);
    expect(played[0].args[2]).toMatchObject({ player: 'b' });
  });

  it('does not hand the game on while a line of hologram pieces still plays', async () => {
    const { game, view, turns } = withCoach();
    let endLine;
    view.playGhostLine = () => new Promise((resolve) => (endLine = resolve));
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    const showing = game.coachShowLine('problem');

    game.coachContinue();
    await settle();
    expect(game.coachHold).toBe(true);
    expect(turns).toEqual([]);

    endLine();
    await showing;
    game.coachContinue();
    await settle();
    expect(game.coachHold).toBe(false);
    expect(turns).toEqual(['b']);
    expect(game.canInteract()).toBe(true);
  });

  it('waits for a line of hologram pieces to end before it lets the game go on, when the coach is switched off meanwhile', async () => {
    const { game, view, settings, turns } = withCoach();
    let endLine;
    view.playGhostLine = () => new Promise((resolve) => (endLine = resolve));
    game.newGame({ mode: 'two', fen: PAWN_IN_DANGER });
    await game.attemptMove('h2', 'h3');
    const showing = game.coachShowLine('problem');

    settings.set('twoPlayerCoach', false);
    game.applyCoachSetting();
    await settle();
    expect(turns).toEqual([]);
    expect(game.canInteract()).toBe(false);

    endLine();
    await showing;
    await settle();
    expect(game.coachHold).toBe(false);
    expect(game.coachView).toBe(null);
    expect(turns).toEqual(['b']);
    expect(game.canInteract()).toBe(true);
    // The marks of the coach are not drawn again after the line.
    const lastMarks = view.calls.filter((call) => call.name === 'setCoachMarks' || call.name === 'clearCoachMarks').at(-1);
    expect(lastMarks.name).toBe('clearCoachMarks');
  });

  it('starts to speak from the next move when it is switched on in the middle of a game', async () => {
    const { game, settings } = makeGame();
    game.newGame({ mode: 'two' });
    await game.attemptMove('e2', 'e4');
    expect(game.coachView).toBe(null);

    settings.set('twoPlayerCoach', true);
    game.applyCoachSetting();
    await game.attemptMove('e7', 'e5');

    expect(game.coachView).toMatchObject({ color: 'b' });
  });

  it('does not change a game against the bot', async () => {
    const { game, settings } = makeGame({ botMoves: ['e7e5'] });
    settings.set('twoPlayerCoach', true);
    game.newGame({ mode: 'free', level: 4, color: 'w' });
    game.applyCoachSetting();

    await game.attemptMove('e2', 'e4');
    await untilPlayersTurn(game);

    expect(game.coachOn).toBe(false);
    expect(game.coachView).toBe(null);
  });
});
