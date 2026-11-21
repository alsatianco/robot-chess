// A game in progress is kept in the browser's storage, so a reload, or a phone that drops the page while it is in the background, does not lose it. These tests cover the three parts: what the game hands over to be saved and how it goes on from that, the check that every stored value passes before it is trusted, and the rule for when storage is written and cleared.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Chess } from 'chess.js';
import { makeGame, untilPlayersTurn } from '../helpers/game-fakes.js';
import { checkSavedGame, GameSaver, SAVED_GAME_KEY } from '../../src/core/saved-game.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

/** A saved game written by hand: 1. e4 e5 in a game without a clock, the player is White and it is the player's turn. */
const savedFree = () => ({ v: 1, mode: 'free', level: 4, color: 'w', colorChoice: 'w', timeControl: null, startFen: START, plies: [{ uci: 'e2e4', clock: null }, { uci: 'e7e5', clock: null }], clock: null, savedAt: 1 });
/** The same two moves in a 5 minute game, with the clocks as they stood after each move and at the time of saving. */
const savedTimed = () => ({ v: 1, mode: 'timed', level: 4, color: 'w', colorChoice: 'w', timeControl: '5+0', startFen: START, plies: [{ uci: 'e2e4', clock: { w: 290000, b: 300000 } }, { uci: 'e7e5', clock: { w: 290000, b: 280000 } }], clock: { w: 250000, b: 280000 }, savedAt: 1 });

/** What storage does to a value: it comes back as new objects made from text. */
const throughStorage = (value) => JSON.parse(JSON.stringify(value));

/** A stand-in for localStorage that keeps its values in memory. */
function fakeStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe('what a game hands over to be saved', () => {
  it('has nothing to save before the first move', () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    game.newGame({ mode: 'free', level: 4, color: 'w' });
    expect(game.snapshot()).toBe(null);
  });

  it('holds the setup, every move and the start position after a move', async () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    game.newGame({ mode: 'free', level: 4, color: 'w' });
    await game.attemptMove('e2', 'e4');
    await untilPlayersTurn(game);

    expect(game.snapshot()).toMatchObject({ v: 1, mode: 'free', level: 4, color: 'w', colorChoice: 'w', timeControl: null, startFen: START, plies: [{ uci: 'e2e4', clock: null }, { uci: 'e7e5', clock: null }], clock: null });
  });

  it('holds the clocks of a timed game', async () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    game.newGame({ mode: 'timed', level: 4, color: 'w', timeControl: '5+0' });
    await game.attemptMove('e2', 'e4');
    await untilPlayersTurn(game);

    const saved = game.snapshot();
    expect(saved.timeControl).toBe('5+0');
    expect(saved.clock.w).toBeGreaterThan(299000);
    expect(saved.clock.w).toBeLessThanOrEqual(300000);
    expect(saved.plies[0].clock).toEqual({ w: expect.any(Number), b: expect.any(Number) });
  });

  it('has nothing to save when the game is over', async () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    game.newGame({ mode: 'free', level: 4, color: 'w' });
    await game.attemptMove('e2', 'e4');
    await untilPlayersTurn(game);
    game.resign();

    expect(game.snapshot()).toBe(null);
  });

  it('passes the check for stored games after a trip through storage', async () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    game.newGame({ mode: 'coach', level: 4, color: 'b' });
    await untilPlayersTurn(game);

    expect(checkSavedGame(throughStorage(game.snapshot()))).not.toBe(null);
  });
});

describe('going on with a saved game', () => {
  it('brings back the position, the moves, the mode, the level and the color', () => {
    const { game } = makeGame();
    game.resume(savedFree());

    expect(game.status).toBe('playing');
    expect(game.fen()).toBe(AFTER_E4_E5);
    expect(game.plies.map((ply) => ply.san)).toEqual(['e4', 'e5']);
    expect(game.modeName).toBe('free');
    expect(game.botLevel).toBe(4);
    expect(game.playerColor).toBe('w');
    expect(game.canInteract()).toBe(true);
  });

  it('shows the saved position and its last move on the board', () => {
    const { game, view } = makeGame();
    game.resume(savedFree());

    expect(view.calls.filter((call) => call.name === 'sync').at(-1).args).toEqual([AFTER_E4_E5]);
    expect(view.calls.filter((call) => call.name === 'setLastMove').at(-1).args).toEqual(['e7', 'e5']);
  });

  it('lets the player make the next move', async () => {
    const { game } = makeGame({ botMoves: ['b8c6'] });
    game.resume(savedFree());

    expect(await game.attemptMove('g1', 'f3')).toBe(true);
    await untilPlayersTurn(game);
    expect(game.plies.map((ply) => ply.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('lets the bot move first when the game was saved on its turn', async () => {
    const { game } = makeGame({ botMoves: ['e7e5'] });
    game.resume({ ...savedFree(), plies: [{ uci: 'e2e4', clock: null }] });

    await untilPlayersTurn(game);
    expect(game.plies.map((ply) => ply.san)).toEqual(['e4', 'e5']);
  });

  it('brings back the clocks of a timed game and runs the clock of the side to move', () => {
    const { game } = makeGame();
    game.resume(savedTimed());

    expect(game.clock.timeLeft('b')).toBe(280000);
    expect(game.clock.running).toBe('w');
    expect(game.clock.timeLeft('w')).toBeGreaterThan(249000);
    expect(game.clock.timeLeft('w')).toBeLessThanOrEqual(250000);
  });

  it('takes a move back to the clock of the move before it, not to a full clock', async () => {
    const { game } = makeGame();
    const saved = savedTimed();
    saved.plies.push({ uci: 'g1f3', clock: { w: 270000, b: 280000 } }, { uci: 'b8c6', clock: { w: 270000, b: 260000 } });
    saved.clock = { w: 240000, b: 260000 };
    game.resume(saved);

    game.undo();

    expect(game.plies.map((ply) => ply.san)).toEqual(['e4', 'e5']);
    expect(game.clock.timeLeft('b')).toBe(280000);
    expect(game.clock.timeLeft('w')).toBeLessThanOrEqual(290000);
    expect(game.clock.timeLeft('w')).toBeGreaterThan(289000);
  });

  it('keeps a "Surprise me" color choice for the next game, and the color that was drawn for this one', () => {
    const { game } = makeGame();
    game.resume({ ...savedFree(), color: 'w', colorChoice: 'random' });

    expect(game.playerColor).toBe('w');
    expect(game.config.color).toBe('random');
  });

  it('gives the coach a fresh start: nothing is flagged and no card is shown', () => {
    const { game } = makeGame();
    game.resume({ ...savedFree(), mode: 'coach' });

    expect(game.mode.coach).toBe(true);
    expect(game.coachHold).toBe(false);
    expect(game.coachView).toBe(null);
  });
});

describe('the check of a stored game', () => {
  it('accepts a game without a clock and one with a clock', () => {
    expect(checkSavedGame(throughStorage(savedFree()))).toMatchObject({ mode: 'free', level: 4, color: 'w', startFen: START });
    expect(checkSavedGame(throughStorage(savedTimed()))).toMatchObject({ mode: 'timed', timeControl: '5+0', clock: { w: 250000, b: 280000 } });
  });

  it('accepts a game that started from another position', () => {
    const custom = '6k1/p6p/2n5/4P3/8/8/P6P/6K1 w - - 0 1';
    expect(checkSavedGame({ ...savedFree(), startFen: custom, plies: [{ uci: 'h2h3', clock: null }] })).toMatchObject({ startFen: custom });
  });

  it.each([
    ['nothing', null],
    ['a text', 'e2e4'],
    ['a list', []],
    ['another version', { ...savedFree(), v: 2 }],
    ['an unknown mode', { ...savedFree(), mode: 'blitz' }],
    ['a level that does not exist', { ...savedFree(), level: 9 }],
    ['a level that is not a whole number', { ...savedFree(), level: 2.5 }],
    ['an unknown color', { ...savedFree(), color: 'green' }],
    ['an unknown color choice', { ...savedFree(), colorChoice: 'purple' }],
    ['a start position that is not chess', { ...savedFree(), startFen: 'not a position' }],
    ['moves that are not a list', { ...savedFree(), plies: 'e2e4' }],
    ['no move at all', { ...savedFree(), plies: [] }],
    ['a move that is not legal', { ...savedFree(), plies: [{ uci: 'e2e5', clock: null }] }],
    ['a move that is not a move', { ...savedFree(), plies: [{ uci: 'hello', clock: null }] }],
    ['a move without its text', { ...savedFree(), plies: [{ clock: null }] }],
    ['a timed game without clocks', { ...savedTimed(), clock: null }],
    ['a timed game with an unknown time control', { ...savedTimed(), timeControl: '1+0' }],
    ['a clock below zero', { ...savedTimed(), clock: { w: -5, b: 280000 } }],
    ['a clock that is not a number', { ...savedTimed(), clock: { w: 'much', b: 280000 } }],
    ['a clock after a move that is not a number', { ...savedTimed(), plies: [{ uci: 'e2e4', clock: { w: null, b: 300000 } }] }],
  ])('refuses %s', (name, value) => {
    expect(checkSavedGame(value)).toBe(null);
  });

  it('refuses a game that is already over, because there is nothing to go on with', () => {
    const mate = { ...savedFree(), plies: ['f2f3', 'e7e5', 'g2g4', 'd8h4'].map((uci) => ({ uci, clock: null })) };
    expect(new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3').isCheckmate()).toBe(true);
    expect(checkSavedGame(mate)).toBe(null);
  });

  it('refuses a game with far more moves than a real game has', () => {
    const plies = [];
    for (let i = 0; i < 2100; i++) plies.push({ uci: ['g1f3', 'g8f6', 'f3g1', 'f6g8'][i % 4], clock: null });
    expect(checkSavedGame({ ...savedFree(), plies })).toBe(null);
  });

  it('hands back only the values it knows', () => {
    expect(Object.keys(checkSavedGame({ ...savedFree(), extra: 'x' })).sort()).toEqual(['clock', 'color', 'colorChoice', 'level', 'mode', 'plies', 'savedAt', 'startFen', 'timeControl', 'v']);
  });
});

describe('when the game is written to storage', () => {
  async function gameAfterOneMove() {
    const made = makeGame({ botMoves: ['e7e5', 'b8c6'] });
    made.game.newGame({ mode: 'free', level: 4, color: 'w' });
    await made.game.attemptMove('e2', 'e4');
    await untilPlayersTurn(made.game);
    return made.game;
  }

  it('keeps the running game in storage', async () => {
    const store = fakeStore();
    const saver = new GameSaver(store);
    const game = await gameAfterOneMove();

    saver.sync(game);

    expect(JSON.parse(store.getItem(SAVED_GAME_KEY)).plies.map((ply) => ply.uci)).toEqual(['e2e4', 'e7e5']);
    expect(saver.saved.plies.map((ply) => ply.uci)).toEqual(['e2e4', 'e7e5']);
  });

  it('finds the game again on the next visit', async () => {
    const store = fakeStore();
    new GameSaver(store).sync(await gameAfterOneMove());

    const nextVisit = new GameSaver(store);
    const { game } = makeGame();
    game.resume(nextVisit.saved);

    expect(game.fen()).toBe(AFTER_E4_E5);
  });

  it('removes the game from storage when it is over', async () => {
    const store = fakeStore();
    const saver = new GameSaver(store);
    const game = await gameAfterOneMove();
    saver.sync(game);

    game.resign();
    saver.sync(game);

    expect(store.getItem(SAVED_GAME_KEY)).toBe(null);
    expect(saver.saved).toBe(null);
  });

  it('removes the game from storage when the player took back every move', async () => {
    const store = fakeStore();
    const saver = new GameSaver(store);
    const game = await gameAfterOneMove();
    saver.sync(game);

    game.undo();
    saver.sync(game);

    expect(game.plies).toEqual([]);
    expect(store.getItem(SAVED_GAME_KEY)).toBe(null);
  });

  it('leaves a stored game alone while no game is on the board, so a visit to the menu or the tutorial does not lose it', () => {
    const store = fakeStore({ [SAVED_GAME_KEY]: JSON.stringify(savedFree()) });
    const saver = new GameSaver(store);
    const { game } = makeGame();

    game.stop();
    saver.sync(game);

    expect(saver.saved).toMatchObject({ mode: 'free' });
    expect(store.getItem(SAVED_GAME_KEY)).not.toBe(null);
  });

  it('forgets the game when asked to', () => {
    const store = fakeStore({ [SAVED_GAME_KEY]: JSON.stringify(savedFree()) });
    const saver = new GameSaver(store);

    saver.clear();

    expect(saver.saved).toBe(null);
    expect(store.getItem(SAVED_GAME_KEY)).toBe(null);
  });

  it('drops a stored value that is not a game, and says so', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore({ [SAVED_GAME_KEY]: '{"v":1,"mode":"free"' });

    const saver = new GameSaver(store);

    expect(saver.saved).toBe(null);
    expect(store.getItem(SAVED_GAME_KEY)).toBe(null);
    expect(warned.mock.calls.map(([prefix]) => String(prefix).slice(0, 12))).toEqual(['[saved-game]']);
  });

  it('drops a stored game that does not pass the check, and says so', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore({ [SAVED_GAME_KEY]: JSON.stringify({ ...savedFree(), plies: [{ uci: 'e2e5', clock: null }] }) });

    const saver = new GameSaver(store);

    expect(saver.saved).toBe(null);
    expect(store.getItem(SAVED_GAME_KEY)).toBe(null);
    expect(warned).toHaveBeenCalledTimes(1);
  });

  it('works without storage: nothing is kept and nothing breaks', async () => {
    const saver = new GameSaver(null);
    const game = await gameAfterOneMove();

    expect(() => saver.sync(game)).not.toThrow();
    expect(() => saver.clear()).not.toThrow();
    expect(saver.saved).toBe(null);
  });

  it('goes on when storage refuses to write, and says so only once', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = fakeStore();
    store.setItem = () => {
      throw new Error('The quota has been exceeded.');
    };
    const saver = new GameSaver(store);
    const game = await gameAfterOneMove();

    saver.sync(game);
    saver.sync(game);

    expect(saver.saved).toBe(null);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(String(warned.mock.calls[0][0]).startsWith('[saved-game]')).toBe(true);
  });

  it('does not write again when nothing but the time of saving changed', async () => {
    const store = fakeStore();
    let writes = 0;
    const write = store.setItem;
    store.setItem = (key, value) => {
      writes += 1;
      write(key, value);
    };
    const saver = new GameSaver(store);
    const game = await gameAfterOneMove();

    saver.sync(game);
    saver.sync(game);

    expect(writes).toBe(1);
  });
});

/** A saved two-player game: 1. e4, no clock, Black is to move. There is no bot, so it has no level. */
const savedTwo = () => ({ v: 1, mode: 'two', level: null, color: 'w', colorChoice: 'w', timeControl: null, startFen: START, plies: [{ uci: 'e2e4', clock: null }], clock: null, savedAt: 1 });
/** The same game with the 3 minute clock that the players picked. */
const savedTwoTimed = () => ({ ...savedTwo(), timeControl: '3+2', plies: [{ uci: 'e2e4', clock: { w: 178000, b: 180000 } }], clock: { w: 178000, b: 150000 } });

describe('a saved two-player game', () => {
  it('is handed over without a bot level and without a clock', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two' });
    await game.attemptMove('e2', 'e4');

    const saved = game.snapshot();
    expect(saved).toMatchObject({ v: 1, mode: 'two', level: null, timeControl: null, startFen: START, plies: [{ uci: 'e2e4', clock: null }], clock: null });
    expect(checkSavedGame(throughStorage(saved))).toMatchObject({ mode: 'two', level: null, timeControl: null });
  });

  it('is handed over with the clock that the players picked', async () => {
    const { game } = makeGame();
    game.newGame({ mode: 'two', timeControl: '3+2' });
    await game.attemptMove('e2', 'e4');

    const saved = game.snapshot();
    expect(saved.timeControl).toBe('3+2');
    expect(saved.clock).toEqual({ w: expect.any(Number), b: expect.any(Number) });
    expect(checkSavedGame(throughStorage(saved))).toMatchObject({ mode: 'two', timeControl: '3+2' });
  });

  it('passes the check with and without a clock', () => {
    expect(checkSavedGame(savedTwo())).toMatchObject({ mode: 'two', level: null, timeControl: null, clock: null, plies: [{ uci: 'e2e4', clock: null }] });
    expect(checkSavedGame(savedTwoTimed())).toMatchObject({ mode: 'two', timeControl: '3+2', clock: { w: 178000, b: 150000 }, plies: [{ uci: 'e2e4', clock: { w: 178000, b: 180000 } }] });
  });

  it('is not asked for a bot level or a player color, because it has neither', () => {
    const { level, color, colorChoice, ...rest } = savedTwo();
    expect(checkSavedGame(rest)).toMatchObject({ mode: 'two', level: null, color: 'w', colorChoice: 'w' });
    expect(checkSavedGame({ ...rest, level: 99, color: 'x', colorChoice: 'y' })).toMatchObject({ mode: 'two', level: null, color: 'w', colorChoice: 'w' });
  });

  it('is refused with a time control that the game does not know', () => {
    expect(checkSavedGame({ ...savedTwoTimed(), timeControl: '7+7' })).toBe(null);
    expect(checkSavedGame({ ...savedTwoTimed(), timeControl: 5 })).toBe(null);
  });

  it('is refused when it has a clock but the clock times are missing', () => {
    expect(checkSavedGame({ ...savedTwoTimed(), clock: null })).toBe(null);
    expect(checkSavedGame({ ...savedTwoTimed(), plies: [{ uci: 'e2e4', clock: null }] })).toBe(null);
  });

  it('still asks a game against the bot for its level and color', () => {
    expect(checkSavedGame({ ...savedFree(), level: null })).toBe(null);
    expect(checkSavedGame({ ...savedFree(), color: null })).toBe(null);
  });

  it('goes on with the side that was to move, and that side may pick up its pieces', () => {
    const { game, engines } = makeGame();
    game.resume(checkSavedGame(savedTwo()));

    expect(game.modeName).toBe('two');
    expect(game.turn).toBe('b');
    expect(game.canInteract()).toBe(true);
    expect(game.isOwnPiece('e7')).toBe(true);
    expect(game.clock).toBe(null);
    expect(engines).toEqual([]);
  });

  it('goes on with the clocks as they were, and runs the clock of the side to move', () => {
    const { game } = makeGame();
    game.resume(checkSavedGame(savedTwoTimed()));

    expect(game.clock.control).toBe('3+2');
    expect(game.clock.running).toBe('b');
    expect(game.clock.remaining.w).toBe(178000);
    expect(game.clock.timeLeft('b')).toBeLessThanOrEqual(150000);
  });

  it('starts "Play again" with the same clock choice', async () => {
    const { game } = makeGame();
    game.resume(checkSavedGame(savedTwoTimed()));

    game.rematch();

    expect(game.modeName).toBe('two');
    expect(game.clock.control).toBe('3+2');
    expect(game.plies).toEqual([]);
  });
});
