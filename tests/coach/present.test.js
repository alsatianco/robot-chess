import { afterEach, describe, expect, it, vi } from 'vitest';
import { explainIllegalMove } from '../../src/coach/illegal.js';
import { DEFAULT_LEVEL, LEVELS, getLevel } from '../../src/coach/levels.js';
import { presentFeedback, presentIllegal } from '../../src/coach/present.js';
import { buildMoveReport } from '../../src/coach/report.js';
import en from '../../src/i18n/en.js';

// All text lives in the one language file; the coach's part is mounted under `coach`.
const strings = en.coach;
import { createTranslator } from '../../src/i18n/index.js';

const t = createTranslator({ coach: strings });

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// The example from the brief. White is to play move 9. The bishop on g4 attacks the knight on f3 and nothing defends it. White plays a3 and leaves the knight alone. Nbd2 would have protected it.
const SPEC = 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/4PNP1/PPQ2P1P/RNB1KB1R w KQkq - 0 9';
const SPEC_AFTER = 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/P3PNP1/1PQ2P1P/RNB1KB1R b KQkq - 0 9';

const NOTATION = /\b[a-h][1-8]\b|[KQRBN]x?[a-h][1-8]|O-O|\d\./;
const RATING_WORDS = /blunder|mistake|inaccuracy|excellent|best move/i;

function line(pv, score, multipv = 1) {
  const moves = Array.isArray(pv) ? pv : [pv];
  const parts = typeof score === 'number' ? { cp: score, mate: null } : { cp: null, mate: score.mate };
  return { multipv, depth: 14, move: moves[0], pv: moves, ...parts };
}

function specReport() {
  const lines = [line(['b1d2', 'f8e7', 'f1g2'], -100, 1), line(['f1e2', 'f8d6'], -110, 2), line(['f1g2', 'f8d6'], -140, 3)];
  return buildMoveReport({ fenBefore: SPEC, move: { from: 'a2', to: 'a3' }, lines, playedLine: line(['a2a3', 'g4f3', 'h1g1', 'f6e4'], -180) });
}

// Every text of a list, so that a random pick can be checked.
const anyOf = (list) => expect.toBeOneOf(list);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the same mistake at the three levels (example from the brief)', () => {
  const report = specReport();

  it('level 1: one short sentence, kid words, no notation, no rating word, "can" for the threat', () => {
    const view = presentFeedback(report, 1, t);
    expect(view.text).toBe('Oh no! Your horse is all alone. The bishop can capture it!');
    expect(view.text).not.toMatch(NOTATION);
    expect(view.text).not.toMatch(RATING_WORDS);
    expect(view).toMatchObject({ level: 1, rating: 'inaccuracy', label: null, detail: null, evalText: null, stars: 1, tone: 'warn', face: 'worried', flagged: true, opening: null });
    expect(view.primaryFinding).toMatchObject({ type: 'hanging-piece', square: 'f3' });
    expect(view.highlights).toEqual([
      { square: 'f3', kind: 'danger' },
      { square: 'g4', kind: 'info' },
    ]);
    expect(view.arrows).toEqual([{ from: 'g4', to: 'f3', kind: 'danger' }]);
    // Level 1 shows only what can happen on the next move.
    expect(view.ghostLine).toEqual({ fen: SPEC_AFTER, moves: ['g4f3'] });
    expect(view.betterLine).toEqual({ fen: SPEC, moves: ['b1d2'] });
    expect(view.betterMove).toEqual({ from: 'b1', to: 'd2', san: 'Nbd2', uci: 'b1d2', promotion: null });
  });

  it('level 2: a rating label, the square and the capturing move, and the better move', () => {
    const view = presentFeedback(report, 2, t);
    expect(view.text).toBe('Your knight on f3 is undefended, so Bxf3 wins 3 points.');
    expect(view.detail).toBe('Nbd2 would have protected it. Also good: Be2.');
    expect(view).toMatchObject({ level: 2, label: 'Inaccuracy', stars: null, evalText: null, tone: 'warn', face: 'worried', flagged: true });
    expect(view.ghostLine).toEqual({ fen: SPEC_AFTER, moves: ['g4f3', 'h1g1', 'f6e4'] });
    expect(view.betterLine).toEqual({ fen: SPEC, moves: ['b1d2', 'f8e7', 'f1g2'] });
  });

  it('level 3: rating with the evaluation number, numbered notation and the engine lines', () => {
    const view = presentFeedback(report, 3, t);
    expect(view.text).toBe('Inaccuracy (-1.8). Your knight on f3 is undefended, so 9...Bxf3 wins 3 points.');
    expect(view.detail).toBe('Better was 9.Nbd2. Also good: 9.Be2. Your line: 9.a3 Bxf3 10.Rg1 Ne4. Best line: 9.Nbd2 Be7 10.Bg2.');
    expect(view).toMatchObject({ level: 3, label: 'Inaccuracy', evalText: '-1.8', stars: null, flagged: true });
  });

  it('works the same without the engine at level 1', () => {
    const view = presentFeedback(buildMoveReport({ fenBefore: SPEC, move: { from: 'a2', to: 'a3' } }), 1, t);
    expect(view.text).toBe('Oh no! Your horse is all alone. The bishop can capture it!');
    expect(view).toMatchObject({ rating: null, flagged: true, stars: 1, betterMove: null, betterLine: null });
    expect(view.ghostLine).toEqual({ fen: SPEC_AFTER, moves: ['g4f3'] });
  });
});

describe('good moves', () => {
  const lines = [line(['e2e4', 'e7e5', 'g1f3'], 30, 1), line('d2d4', 28, 2), line('g1f3', 25, 3), line('c2c4', 20, 4), line('b1c3', 5, 5)];
  const best = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines });
  const equal = buildMoveReport({ fenBefore: START, move: { from: 'd2', to: 'd4' }, lines });
  const good = buildMoveReport({ fenBefore: START, move: { from: 'b1', to: 'c3' }, lines });

  it('level 1: a short happy line, three stars, nothing to stop for', () => {
    const view = presentFeedback(best, 1, t);
    expect(view.text).toEqual(anyOf(strings.kid.great));
    expect(view).toMatchObject({ tone: 'great', face: 'wow', stars: 3, flagged: false, label: null, detail: null, ghostLine: null, betterMove: null, betterLine: null });
    expect(view.highlights).toEqual([{ square: 'e4', kind: 'good' }]);
    expect(view.primaryFinding).toMatchObject({ type: 'top-move' });
  });

  it('level 1: praise has some variety', () => {
    const seen = new Set();
    for (const pick of [0, 0.3, 0.6, 0.99]) {
      vi.spyOn(Math, 'random').mockReturnValue(pick);
      seen.add(presentFeedback(best, 1, t).text);
    }
    expect(seen.size).toBeGreaterThan(2);
    for (const text of seen) expect(text).not.toMatch(NOTATION);
  });

  it('level 1: a good move that is not the top move', () => {
    const view = presentFeedback(good, 1, t);
    expect(view.text).toEqual(anyOf(strings.kid.good));
    expect(view).toMatchObject({ tone: 'good', face: 'happy', stars: 3, flagged: false });
  });

  it('level 2: a rating label and the moves that are just as good', () => {
    const view = presentFeedback(best, 2, t);
    expect(view.label).toBe('Best move');
    expect(view.text).toEqual(anyOf(strings.explain.good.best));
    expect(view.detail).toBe('d4, Nf3 and c4 are just as good.');
    expect(view).toMatchObject({ tone: 'great', face: 'wow', flagged: false, stars: null });
  });

  it('level 2: an equal move is a top move, and the engine\'s first move is listed with the others', () => {
    const view = presentFeedback(equal, 2, t);
    expect(view.label).toBe('Best move');
    expect(view.detail).toBe('e4, Nf3 and c4 are just as good.');
    expect(view.betterMove).toBeNull();
  });

  it('level 2: a good move names the top move without stopping the game', () => {
    const view = presentFeedback(good, 2, t);
    expect(view.label).toBe('Good');
    expect(view.text).toEqual(anyOf(strings.explain.good.good));
    expect(view.detail).toBe('The top move was e4. Also good: d4, Nf3, c4.');
    expect(view).toMatchObject({ tone: 'good', flagged: false });
    expect(view.betterMove).toMatchObject({ san: 'e4' });
    expect(view.ghostLine).toBeNull();
  });

  it('level 3: the rating with the number, and the line', () => {
    const view = presentFeedback(best, 3, t);
    expect(view.text).toBe('Best move (+0.3).');
    expect(view.evalText).toBe('+0.3');
    expect(view.detail).toBe('1.d4, 1.Nf3 and 1.c4 are just as good. Your line: 1.e4 e5 2.Nf3.');
  });

  it('says what a capture wins', () => {
    const fen = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';
    const withEngine = buildMoveReport({ fenBefore: fen, move: { from: 'd1', to: 'd5' }, lines: [line(['d1d5', 'e8e7'], 500, 1), line('e1e2', 0, 2)] });
    expect(presentFeedback(withEngine, 1, t).text).toEqual(anyOf(strings.kid.captured.map((text) => text.replace('{target}', 'horse'))));
    expect(presentFeedback(withEngine, 2, t).text).toMatch(/ This wins the knight\.$/);
    expect(presentFeedback(withEngine, 3, t).text).toBe('Best move (+5.0). This wins the knight.');
    const withoutEngine = buildMoveReport({ fenBefore: fen, move: { from: 'd1', to: 'd5' } });
    expect(presentFeedback(withoutEngine, 1, t)).toMatchObject({ tone: 'good', stars: 3, flagged: false });
    expect(presentFeedback(withoutEngine, 2, t)).toMatchObject({ text: 'This wins the knight.', label: null });
  });
});

describe('what each level flags', () => {
  it('a named tactic is hidden at level 1 and shown from level 2', () => {
    const fen = 'r3k3/7p/8/1N6/8/8/8/4K3 b - - 0 1';
    const report = buildMoveReport({ fenBefore: fen, move: { from: 'h7', to: 'h6' }, lines: [line('a8d8', 0)], playedLine: line(['h7h6', 'b5c7', 'e8d7', 'c7a8'], -400) });
    expect(report.rating).toBe('blunder');

    const kid = presentFeedback(report, 1, t);
    // Level 1 never stops for a rating alone, and it does not know the word "fork". The face and the stars still show that the move was not good.
    expect(kid).toMatchObject({ flagged: false, primaryFinding: null, stars: 1, face: 'worried', tone: 'warn', ghostLine: null, label: null });
    expect(kid.text).toEqual(anyOf(strings.kid.soft));
    expect(kid.text).not.toMatch(RATING_WORDS);

    const standard = presentFeedback(report, 2, t);
    expect(standard).toMatchObject({ flagged: true, label: 'Blunder', tone: 'bad', face: 'sad' });
    expect(standard.text).toBe('This allows a fork. Nc7+ attacks your king and rook at the same time.');
    expect(standard.detail).toBe('Better was Rd8.');
    expect(standard.primaryFinding.type).toBe('allowed-fork');
    expect(standard.ghostLine).toEqual({ fen: report.fenAfter, moves: ['b5c7', 'e8d7', 'c7a8'] });
    expect(standard.arrows).toEqual([
      { from: 'b5', to: 'c7', kind: 'danger' },
      { from: 'c7', to: 'e8', kind: 'danger' },
      { from: 'c7', to: 'a8', kind: 'danger' },
    ]);
    expect(standard.highlights).toEqual([
      { square: 'e8', kind: 'danger' },
      { square: 'a8', kind: 'danger' },
    ]);

    const expert = presentFeedback(report, 3, t);
    expect(expert.text).toBe('Blunder (+4.0). This allows a fork. 2.Nc7+ attacks your king and rook at the same time.');
    expect(expert.detail).toBe('Better was 1...Rd8. Your line: 1...h6 2.Nc7+ Kd7 3.Nxa8.');
  });

  it('an inaccuracy stops the game only at level 3', () => {
    const lines = [line('e2e4', 30, 1), line('d2d4', 28, 2)];
    const report = buildMoveReport({ fenBefore: START, move: { from: 'a2', to: 'a4' }, lines, playedLine: line(['a2a4', 'e7e5'], -40) });
    expect(report.rating).toBe('inaccuracy');

    const kid = presentFeedback(report, 1, t);
    expect(kid).toMatchObject({ flagged: false, tone: 'ok', face: 'neutral', stars: 2, primaryFinding: null });
    expect(kid.text).toEqual(anyOf(strings.kid.ok));

    const standard = presentFeedback(report, 2, t);
    expect(standard).toMatchObject({ flagged: false, tone: 'ok', face: 'neutral', label: 'Inaccuracy' });
    expect(standard.text).toBe(strings.explain.opening['edge-pawn']);
    expect(standard.detail).toBe('Better was e4. Also good: d4.');
    expect(standard.primaryFinding).toMatchObject({ type: 'opening-principle' });

    const expert = presentFeedback(report, 3, t);
    expect(expert).toMatchObject({ flagged: true, tone: 'warn', face: 'worried', label: 'Inaccuracy', evalText: '-0.4' });
  });

  it('a mistake with no named cause is explained with the engine line from level 2', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'g1', to: 'h3' }, lines: [line('e2e4', 30)], playedLine: line(['g1h3', 'd7d5', 'e2e3'], -90) });
    expect(report.rating).toBe('mistake');
    expect(report.findings).toEqual([]);

    expect(presentFeedback(report, 1, t)).toMatchObject({ flagged: false, stars: 1, ghostLine: null });
    const standard = presentFeedback(report, 2, t);
    expect(standard).toMatchObject({ flagged: true, label: 'Mistake', tone: 'warn', primaryFinding: null });
    expect(standard.text).toBe('After d5 e3, your position gets worse.');
    expect(standard.ghostLine).toEqual({ fen: report.fenAfter, moves: ['d7d5', 'e2e3'] });
    expect(presentFeedback(report, 3, t).text).toBe('Mistake (-0.9). After 1...d5 2.e3, your position gets worse.');
  });

  it('states the material outcome when no finding names the cause', () => {
    const report = { ...specReport(), findings: [] };
    expect(presentFeedback(report, 2, t).text).toBe('After Bxf3 Rg1 Ne4, you lose your knight.');
    expect(presentFeedback(report, 3, t).text).toBe('Inaccuracy (-1.8). After 9...Bxf3 10.Rg1 Ne4, you lose your knight.');
    const trade = { ...report, material: { ...report.material, opponentLost: ['p'], net: -2 } };
    expect(presentFeedback(trade, 2, t).text).toBe('After Bxf3 Rg1 Ne4, you lose your knight for a pawn.');
    const many = { ...report, material: { ...report.material, playerLost: ['n', 'p'], net: -4 } };
    expect(presentFeedback(many, 2, t).text).toBe('After Bxf3 Rg1 Ne4, you lose 4 points.');
    const unsettled = { ...report, material: { ...report.material, settled: false } };
    expect(presentFeedback(unsettled, 2, t).text).toBe('After Bxf3 Rg1 Ne4, your position gets a little worse.');
    const noLine = { ...report, playedLineSan: ['a3'], playedLineUci: ['a2a3'], rating: 'blunder' };
    expect(presentFeedback(noLine, 2, t).text).toBe('Your position gets much worse.');
    expect(presentFeedback(noLine, 2, t).ghostLine).toBeNull();
  });

  it('level 2 does not say "would have protected it" when the played move itself took the protection away', () => {
    // Here the queen on d1 defended the knight, and Qd2 leaves it alone.
    const fen = 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/4PNP1/PPP2P1P/RNBQKB1R w KQkq - 0 9';
    const report = buildMoveReport({ fenBefore: fen, move: { from: 'd1', to: 'd2' }, lines: [line('b1d2', -100)], playedLine: line(['d1d2', 'g4f3'], -180) });
    const view = presentFeedback(report, 2, t);
    expect(view.text).toBe('Your knight on f3 is undefended, so Bxf3 wins 3 points.');
    expect(view.detail).toBe('Better was Nbd2.');
  });

  it('level 2 says when the better move would have moved the piece away or taken the attacker', () => {
    const retreat = buildMoveReport({ fenBefore: '4k3/8/4p3/3N4/8/8/8/4K3 w - - 0 1', move: { from: 'e1', to: 'e2' }, lines: [line('d5f4', 300)], playedLine: line(['e1e2', 'e6d5'], -50) });
    expect(presentFeedback(retreat, 2, t).detail).toBe('Nf4 would have moved it to safety.');
    const takeAttacker = buildMoveReport({ fenBefore: '6k1/8/4p3/3N4/8/8/8/K3R3 w - - 0 1', move: { from: 'a1', to: 'b1' }, lines: [line('e1e6', 500)], playedLine: line(['a1b1', 'e6d5'], 0) });
    expect(presentFeedback(takeAttacker, 2, t).detail).toBe('Rxe6 would have removed the attacker.');
    expect(presentFeedback(takeAttacker, 3, t).detail).toMatch(/^Better was 1\.Rxe6\./);
  });

  it('a defended piece that still loses material is a level 2 idea', () => {
    // The queen goes to d4, where a pawn can take it. The pawn on c3 defends d4, so the queen is not "all alone".
    const fen = '4k3/8/8/4p3/8/2P5/8/3QK3 w - - 0 1';
    const report = buildMoveReport({ fenBefore: fen, move: { from: 'd1', to: 'd4' } });
    expect(report.findings[0]).toMatchObject({ type: 'hanging-piece', tier: 2, defended: true, points: 8 });
    expect(presentFeedback(report, 1, t)).toMatchObject({ flagged: false, primaryFinding: null });
    const standard = presentFeedback(report, 2, t);
    expect(standard.flagged).toBe(true);
    expect(standard.text).toBe('Your queen on d4 does not have enough defenders, so exd4 wins 8 points.');
  });
});

describe('mates and draws', () => {
  const backRank = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';

  it('checkmate is celebrated at every level', () => {
    const report = buildMoveReport({ fenBefore: backRank, move: { from: 'a1', to: 'a8' } });
    const kid = presentFeedback(report, 1, t);
    expect(kid.text).toEqual(anyOf(strings.kid.checkmate));
    expect(kid).toMatchObject({ tone: 'great', face: 'wow', stars: 3, flagged: false, ghostLine: null, betterMove: null });
    expect(presentFeedback(report, 2, t)).toMatchObject({ label: 'Best move', tone: 'great', detail: null });
    const expert = presentFeedback(report, 3, t);
    expect(expert.evalText).toBe('#');
    expect(expert.text).toMatch(/^Best move \(#\)\. /);
  });

  it('a missed mate in one is shown at level 1 with the mating move as the better move', () => {
    const report = buildMoveReport({ fenBefore: backRank, move: { from: 'e1', to: 'e2' } });
    const kid = presentFeedback(report, 1, t);
    expect(kid.text).toBe('So close! Your rook can give checkmate right now.');
    expect(kid).toMatchObject({ flagged: true, tone: 'bad', face: 'sad', stars: 1, ghostLine: null });
    expect(kid.betterMove).toMatchObject({ from: 'a1', to: 'a8', san: 'Ra8#' });
    expect(kid.betterLine).toEqual({ fen: backRank, moves: ['a1a8'] });
    expect(kid.arrows).toEqual([{ from: 'a1', to: 'a8', kind: 'good' }]);
    expect(kid.highlights).toEqual([{ square: 'g8', kind: 'target' }]);
    expect(presentFeedback(report, 2, t).text).toBe('Ra8# was checkmate.');
  });

  it('an allowed mate in one says "can"', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K3 b - - 0 1';
    const report = buildMoveReport({ fenBefore: fen, move: { from: 'g8', to: 'h8' } });
    const kid = presentFeedback(report, 1, t);
    expect(kid.text).toBe('Watch out! The rook can checkmate your king.');
    expect(kid).toMatchObject({ flagged: true, tone: 'bad' });
    expect(kid.ghostLine).toEqual({ fen: report.fenAfter, moves: ['a1a8'] });
    expect(kid.arrows).toEqual([{ from: 'a1', to: 'a8', kind: 'danger' }]);
    expect(kid.highlights).toEqual([{ square: 'h8', kind: 'danger' }]);
    expect(presentFeedback(report, 2, t).text).toBe('This allows Ra8#, which is checkmate.');
    expect(presentFeedback(report, 3, t).text).toBe('This allows 2.Ra8#, which is checkmate.');
  });

  it('longer mates are a level 2 idea', () => {
    // The pawn on h6 gives the king a way out, so there is no mate in one here. The mate in three is the engine's word.
    const lines = [line(['a1a7', 'g8f8'], { mate: 3 }, 1), line(['e1e2', 'h6h5'], 200, 2)];
    const report = buildMoveReport({ fenBefore: '6k1/5pp1/7p/8/8/8/8/R3K3 w - - 0 1', move: { from: 'e1', to: 'e2' }, lines });
    expect(report.findings[0]).toMatchObject({ type: 'missed-mate', mateIn: 3 });
    expect(presentFeedback(report, 1, t).primaryFinding).toBeNull();
    expect(presentFeedback(report, 2, t).text).toBe('You had a forced checkmate in 3 moves. It starts with Ra7.');
    const allowed = buildMoveReport({ fenBefore: START, move: { from: 'f2', to: 'f3' }, lines: [line('e2e4', 30, 1)], playedLine: line(['f2f3', 'e7e5'], { mate: -2 }) });
    const view = presentFeedback(allowed, 3, t);
    expect(view.text).toBe('Blunder (-M2). This allows a forced checkmate in 2 moves. It starts with 1...e5.');
    expect(view.evalText).toBe('-M2');
    expect(view.tone).toBe('bad');
  });

  it('stalemate is explained', () => {
    const report = buildMoveReport({ fenBefore: '8/8/8/8/8/4k3/5p2/5K2 b - - 0 1', move: { from: 'e3', to: 'f3' } });
    const kid = presentFeedback(report, 1, t);
    expect(kid.text).toBe(strings.kid.stalemate);
    expect(kid).toMatchObject({ flagged: false, tone: 'ok', stars: 2 });
    expect(presentFeedback(report, 2, t).text).toBe(strings.explain.stalemate);
    const thrownAway = buildMoveReport({ fenBefore: '7k/8/5QK1/8/8/8/8/8 w - - 0 1', move: { from: 'f6', to: 'f7' } });
    expect(presentFeedback(thrownAway, 1, t)).toMatchObject({ flagged: true, text: 'So close! Your queen can give checkmate right now.' });
  });
});

describe('missed chances', () => {
  const freeKnight = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';

  it('level 1 shows a missed free capture', () => {
    const report = buildMoveReport({ fenBefore: freeKnight, move: { from: 'e1', to: 'e2' } });
    const view = presentFeedback(report, 1, t);
    expect(view.text).toBe('Look! Your rook can capture the horse for free.');
    expect(view.text).not.toMatch(NOTATION);
    expect(view).toMatchObject({ flagged: true, tone: 'warn', stars: 1, ghostLine: null });
    expect(view.betterMove).toMatchObject({ from: 'd1', to: 'd5', san: 'Rxd5' });
    expect(view.betterLine).toEqual({ fen: freeKnight, moves: ['d1d5'] });
    expect(view.highlights).toEqual([{ square: 'd5', kind: 'target' }]);
    expect(view.arrows).toEqual([{ from: 'd1', to: 'd5', kind: 'good' }]);
  });

  it('level 2 names the square and the move, and does not repeat the move as "better"', () => {
    const lines = [line(['d1d5', 'e8e7'], 500, 1), line('e1e2', 0, 2)];
    const report = buildMoveReport({ fenBefore: freeKnight, move: { from: 'e1', to: 'e2' }, lines });
    const view = presentFeedback(report, 2, t);
    expect(view.text).toBe('The knight on d5 was undefended. Rxd5 wins 3 points.');
    expect(view.detail).toBeNull();
    expect(view.betterLine).toEqual({ fen: freeKnight, moves: ['d1d5', 'e8e7'] });
  });

  it('level 2 names a missed fork, pin and skewer', () => {
    const fork = buildMoveReport({ fenBefore: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', move: { from: 'e1', to: 'e2' }, lines: [line('b5c7', 500, 1), line('e1e2', 0, 2)] });
    expect(presentFeedback(fork, 2, t).text).toBe('You missed a fork. Nc7+ attacks the king and rook at the same time.');
    const pin = buildMoveReport({ fenBefore: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', move: { from: 'e1', to: 'e2' }, lines: [line('f1b5', 200, 1), line('e1e2', 0, 2)] });
    expect(presentFeedback(pin, 2, t).text).toBe('You missed a pin. After Bb5, the knight on c6 can not move, because the king stands behind it.');
    const skewer = buildMoveReport({ fenBefore: '4q3/8/8/8/4k3/8/8/K6R w - - 0 1', move: { from: 'a1', to: 'b1' }, lines: [line('h1e1', 600, 1), line('a1b1', 0, 2)] });
    expect(presentFeedback(skewer, 2, t).text).toBe('You missed a skewer. Re1+ attacks the king, and when it moves away, you can capture the queen behind it.');
    expect(presentFeedback(skewer, 2, t).arrows).toEqual([
      { from: 'h1', to: 'e1', kind: 'good' },
      { from: 'e1', to: 'e8', kind: 'good' },
    ]);
  });

  it('tells two targets of the same kind apart by their squares', () => {
    const report = buildMoveReport({ fenBefore: 'r3k2r/8/8/8/8/8/8/3QK3 w - - 0 1', move: { from: 'e1', to: 'e2' }, lines: [line('d1d5', 500, 1), line('e1e2', 0, 2)] });
    const fork = report.findings.find((finding) => finding.type === 'missed-fork');
    if (fork) expect(presentFeedback(report, 2, t).text).toContain(' on ');
    const twins = { ...report, findings: [{ type: 'missed-fork', severity: 'major', tier: 2, piece: 'n', square: 'c7', move: { uci: 'b5c7', san: 'Nc7', from: 'b5', to: 'c7' }, targets: [{ square: 'a8', piece: 'r' }, { square: 'e8', piece: 'r' }] }] };
    expect(presentFeedback(twins, 2, t).text).toBe('You missed a fork. Nc7 attacks the rook on a8 and rook on e8 at the same time.');
  });
});

describe('no rating yet', () => {
  it('stays neutral when the engine has not answered and nothing is wrong', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' } });
    const kid = presentFeedback(report, 1, t);
    expect(kid.text).toEqual(anyOf(strings.kid.ok));
    expect(kid).toMatchObject({ rating: null, tone: 'ok', face: 'neutral', stars: 2, flagged: false, label: null });
    expect(kid.highlights).toEqual([{ square: 'e4', kind: 'info' }]);
    expect(presentFeedback(report, 2, t)).toMatchObject({ text: strings.explain.unrated, label: null, detail: null, evalText: null });
    expect(presentFeedback(report, 3, t)).toMatchObject({ text: strings.explain.unrated, label: null, evalText: null });
  });
});

describe('evaluation text', () => {
  const evalText = (score, fen = START, move = { from: 'e2', to: 'e4' }) => presentFeedback(buildMoveReport({ fenBefore: fen, move, lines: [line('e2e4', score)] }), 3, t).evalText;
  const blackEval = (score) => presentFeedback(buildMoveReport({ fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', move: { from: 'e7', to: 'e5' }, lines: [line('e7e5', score)] }), 3, t).evalText;

  it('writes the number from White\'s point of view', () => {
    expect(evalText(80)).toBe('+0.8');
    expect(evalText(-180)).toBe('-1.8');
    expect(evalText(0)).toBe('0.0');
    expect(evalText(4)).toBe('0.0');
    expect(evalText(-4)).toBe('0.0');
    expect(evalText(1234)).toBe('+12.3');
    expect(blackEval(80)).toBe('-0.8');
    expect(blackEval(-180)).toBe('+1.8');
  });

  it('writes mates', () => {
    expect(evalText({ mate: 3 })).toBe('M3');
    expect(evalText({ mate: -2 })).toBe('-M2');
    expect(blackEval({ mate: 3 })).toBe('-M3');
  });

  it('is shown at level 3 only', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines: [line('e2e4', 80)] });
    expect(presentFeedback(report, 1, t).evalText).toBeNull();
    expect(presentFeedback(report, 2, t).evalText).toBeNull();
  });
});

describe('every finding type has words', () => {
  const ref = (san, from, to, piece = 'n') => ({ uci: from + to, san, from, to, piece, captured: null, promotion: null });
  const spot = (square, piece) => ({ square, piece });
  const findings = [
    { type: 'hanging-piece', severity: 'major', tier: 1, square: 'f3', piece: 'n', color: 'w', points: 3, defended: false, capture: ref('Bxf3', 'g4', 'f3', 'b'), attackers: [spot('g4', 'b')], moved: false, confirmed: null, remedy: null },
    { type: 'hanging-piece', severity: 'minor', tier: 2, square: 'f3', piece: 'n', color: 'w', points: 1, defended: true, capture: ref('Bxf3', 'g4', 'f3', 'b'), attackers: [spot('g4', 'b')], moved: false, confirmed: null, remedy: null },
    { type: 'missed-capture', severity: 'major', tier: 1, move: ref('Rxd5', 'd1', 'd5', 'r'), piece: 'r', square: 'd5', targetPiece: 'n', points: 3, free: true },
    { type: 'missed-capture', severity: 'major', tier: 2, move: ref('exd5', 'e4', 'd5', 'p'), piece: 'p', square: 'd5', targetPiece: 'n', points: 2, free: false },
    { type: 'missed-mate-in-1', severity: 'critical', tier: 1, move: ref('Ra8#', 'a1', 'a8', 'r'), piece: 'r', kingSquare: 'g8' },
    { type: 'allowed-mate-in-1', severity: 'critical', tier: 1, move: ref('Ra8#', 'a1', 'a8', 'r'), piece: 'r', kingSquare: 'g8' },
    { type: 'missed-mate', severity: 'major', tier: 2, mateIn: 3, move: ref('Ra7', 'a1', 'a7', 'r') },
    { type: 'allowed-mate', severity: 'critical', tier: 2, mateIn: 3, move: ref('Qh4', 'd8', 'h4', 'q') },
    { type: 'allowed-mate', severity: 'critical', tier: 2, mateIn: 3, move: null },
    { type: 'allowed-fork', severity: 'major', tier: 2, move: ref('Nc7+', 'b5', 'c7'), piece: 'n', square: 'c7', targets: [spot('e8', 'k'), spot('a8', 'r'), spot('d5', 'q')] },
    { type: 'missed-fork', severity: 'major', tier: 2, move: ref('Nc7+', 'b5', 'c7'), piece: 'n', square: 'c7', targets: [spot('e8', 'k'), spot('a8', 'r')] },
    { type: 'allowed-pin', severity: 'major', tier: 2, move: ref('Bb5', 'f1', 'b5', 'b'), attacker: spot('b5', 'b'), pinned: spot('c6', 'n'), behind: spot('e8', 'k'), absolute: true },
    { type: 'allowed-pin', severity: 'major', tier: 2, move: ref('Bg5', 'c1', 'g5', 'b'), attacker: spot('g5', 'b'), pinned: spot('f6', 'n'), behind: spot('d8', 'q'), absolute: false },
    { type: 'missed-pin', severity: 'major', tier: 2, move: ref('Bb5', 'f1', 'b5', 'b'), attacker: spot('b5', 'b'), pinned: spot('c6', 'n'), behind: spot('e8', 'k'), absolute: true },
    { type: 'missed-pin', severity: 'major', tier: 2, move: ref('Bg5', 'c1', 'g5', 'b'), attacker: spot('g5', 'b'), pinned: spot('f6', 'n'), behind: spot('d8', 'q'), absolute: false },
    { type: 'allowed-skewer', severity: 'major', tier: 2, move: ref('Re1+', 'h1', 'e1', 'r'), attacker: spot('e1', 'r'), front: spot('e4', 'k'), behind: spot('e8', 'q') },
    { type: 'missed-skewer', severity: 'major', tier: 2, move: ref('Re1+', 'h1', 'e1', 'r'), attacker: spot('e1', 'r'), front: spot('e4', 'k'), behind: spot('e8', 'q') },
    ...['king-move', 'early-queen', 'same-piece-twice', 'edge-pawn', 'no-development'].map((principle) => ({ type: 'opening-principle', severity: 'minor', tier: 2, principle, piece: 'p', square: 'a4', move: ref('a4', 'a2', 'a4', 'p') })),
    { type: 'caused-stalemate', severity: 'major', tier: 1, materialLead: 9 },
  ];
  const base = { ...specReport(), rating: 'blunder' };

  it('at levels 2 and 3, with no missing text and no empty placeholder', () => {
    for (const finding of findings) {
      for (const level of [2, 3]) {
        const view = presentFeedback({ ...base, findings: [finding] }, level, t);
        const where = `${finding.type} at level ${level}: ${view.text}`;
        expect(view.text, where).not.toContain('coach.');
        expect(view.text, where).not.toMatch(/[{}]|undefined|null/);
        expect(view.primaryFinding, where).toBe(finding);
        for (const mark of view.highlights) expect(mark.square, where).toMatch(/^[a-h][1-8]$/);
        for (const arrow of view.arrows) expect(arrow.from + arrow.to, where).toMatch(/^[a-h][1-8][a-h][1-8]$/);
      }
    }
  });

  it('at level 1 for every tier 1 finding, in kid words and with no notation or rating word', () => {
    const tierOne = findings.filter((finding) => finding.tier === 1);
    expect(tierOne.map((finding) => finding.type)).toEqual(['hanging-piece', 'missed-capture', 'missed-mate-in-1', 'allowed-mate-in-1', 'caused-stalemate']);
    for (const finding of tierOne) {
      const view = presentFeedback({ ...base, findings: [finding] }, 1, t);
      expect(view.text, finding.type).not.toContain('coach.');
      expect(view.text, finding.type).not.toMatch(/[{}]|undefined|null/);
      expect(view.text, finding.type).not.toMatch(NOTATION);
      expect(view.text, finding.type).not.toMatch(RATING_WORDS);
      expect(view.text, finding.type).not.toMatch(/knight/);
      expect(view.flagged, finding.type).toBe(true);
      expect(view.label).toBeNull();
    }
  });

  it('names three fork targets with commas', () => {
    const view = presentFeedback({ ...base, findings: [findings[9]] }, 2, t);
    expect(view.text).toBe('This allows a fork. Nc7+ attacks your king, rook and queen at the same time.');
  });
});

describe('levels as data', () => {
  it('level 1 never flags by rating and shows only tier 1', () => {
    expect(LEVELS[1]).toMatchObject({ maxTier: 1, flagRatings: [], kidNames: true, ghostPlies: 1 });
    expect(LEVELS[1].view).toMatchObject({ ratingLabel: false, stars: true, evaluation: false, notation: false, engineLine: false, moveList: false });
  });

  it('level 2 flags mistakes and blunders, level 3 also inaccuracies', () => {
    expect(LEVELS[2]).toMatchObject({ maxTier: 2, flagRatings: ['mistake', 'blunder'] });
    expect(LEVELS[2].view).toMatchObject({ ratingLabel: true, stars: false, evaluation: false, notation: true, engineLine: false, ghostLine: true });
    expect(LEVELS[3]).toMatchObject({ maxTier: 3, flagRatings: ['inaccuracy', 'mistake', 'blunder'] });
    expect(LEVELS[3].view).toMatchObject({ ratingLabel: true, evaluation: true, notation: true, engineLine: true, ghostLine: true });
  });

  it('looks a level up and fails loudly for a wrong one', () => {
    expect(getLevel(1)).toBe(LEVELS[1]);
    expect(getLevel('2')).toBe(LEVELS[2]);
    expect(getLevel(LEVELS[3])).toBe(LEVELS[3]);
    expect(DEFAULT_LEVEL).toBe(2);
    for (const wrong of [0, 4, 'toString', null, undefined]) expect(() => getLevel(wrong)).toThrow(RangeError);
    expect(() => presentFeedback(specReport(), 9, t)).toThrow(RangeError);
    expect(() => presentFeedback(null, 1, t)).toThrow(TypeError);
    expect(() => presentFeedback(specReport(), 1, null)).toThrow(TypeError);
  });
});

describe('presentIllegal', () => {
  const cases = [
    ['no-piece', START, 'e4', 'e5'],
    ['not-your-piece', START, 'e7', 'e5'],
    ['not-your-turn', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'd2', 'd4', { playerColor: 'w' }],
    ['same-square', START, 'e2', 'e2'],
    ['own-piece', START, 'a1', 'a2'],
    ['wrong-shape', START, 'g1', 'g3'],
    ['wrong-shape', START, 'e2', 'e5'],
    ['wrong-shape', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 0 3', 'e4', 'e3'],
    ['wrong-shape', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 0 3', 'd3', 'd5'],
    ['wrong-shape', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 0 3', 'a2', 'c4'],
    ['wrong-shape', '4k3/8/8/8/3QK3/8/8/R1B3N1 w - - 0 1', 'c1', 'c3'],
    ['wrong-shape', '4k3/8/8/8/3QK3/8/8/R1B3N1 w - - 0 1', 'a1', 'b2'],
    ['wrong-shape', '4k3/8/8/8/3QK3/8/8/R1B3N1 w - - 0 1', 'd4', 'e6'],
    ['wrong-shape', '4k3/8/8/8/3QK3/8/8/R1B3N1 w - - 0 1', 'e4', 'e6'],
    ['blocked', START, 'c1', 'e3'],
    ['blocked', '4k3/8/8/8/8/8/n7/R3K3 w - - 0 1', 'a1', 'a5'],
    ['pawn-blocked', 'rnbqkbnr/pppp1ppp/8/8/8/4p3/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2', 'e4'],
    ['pawn-blocked', 'rnbqkbnr/pppppppp/8/8/8/4N3/PPPPPPPP/RNBQKB1R w KQkq - 0 1', 'e2', 'e4'],
    ['pawn-capture-empty', START, 'e2', 'd3'],
    ['pawn-straight-capture', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'e4', 'e5'],
    ['leaves-king-in-check', '4k3/8/8/q7/8/4n3/3B4/4K3 w - - 0 1', 'd2', 'e3'],
    ['leaves-king-in-check', '4k3/8/8/8/8/8/r7/4K3 w - - 0 1', 'e1', 'e2'],
    ['must-answer-check', '4k3/8/8/8/8/8/3P4/r3K3 w - - 0 1', 'd2', 'd3'],
    ['castle-king-moved', 'r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1', 'e1', 'g1'],
    ['castle-rook-moved', 'r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1', 'e1', 'g1'],
    ['castle-rook-moved', 'r3k2r/8/8/8/8/8/8/R3K3 w Qkq - 0 1', 'e1', 'g1'],
    ['castle-blocked', 'r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1', 'e1', 'g1'],
    ['castle-blocked', 'r3k2r/8/8/8/8/8/8/R3Kb1R w KQkq - 0 1', 'e1', 'g1'],
    ['castle-in-check', '4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1', 'e1', 'g1'],
    ['castle-through-check', '4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1', 'e1', 'g1'],
    ['castle-into-check', '4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1', 'e1', 'g1'],
    ['game-over', 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 'e1', 'f2'],
    ['game-over', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'h8', 'g8'],
  ];

  it('has a sentence for every reason at every level, with no missing text', () => {
    const seen = new Set();
    for (const [code, fen, from, to, options] of cases) {
      const reason = explainIllegalMove(fen, from, to, options);
      expect(reason.code, `${fen} ${from}${to}`).toBe(code);
      seen.add(code);
      for (const level of [1, 2, 3]) {
        const view = presentIllegal(reason, level, t);
        const where = `${code} at level ${level}: ${view.text}`;
        expect(view.text, where).not.toContain('coach.');
        expect(view.text, where).not.toMatch(/[{}]|undefined|null/);
        expect(view.text.length, where).toBeGreaterThan(10);
        for (const mark of view.highlights) expect(mark.square, where).toMatch(/^[a-h][1-8]$/);
        for (const arrow of view.arrows) expect(arrow.from + arrow.to, where).toMatch(/^[a-h][1-8][a-h][1-8]$/);
        if (level === 1) expect(view.text, where).not.toMatch(NOTATION);
      }
      expect(presentIllegal(reason, 2, t)).toEqual(presentIllegal(reason, 3, t));
    }
    expect(seen.size).toBe(19);
  });

  it('level 1 uses kid words and level 2 names the squares', () => {
    const shape = explainIllegalMove(START, 'g1', 'g3');
    expect(presentIllegal(shape, 1, t).text).toBe('The horse jumps in an L shape: two squares one way, then one square to the side.');
    expect(presentIllegal(shape, 2, t).text).toBe('A knight moves in an L shape: two squares one way, then one square to the side.');
    const blocked = explainIllegalMove(START, 'c1', 'e3');
    expect(presentIllegal(blocked, 1, t).text).toBe('Your pawn is in the way.');
    expect(presentIllegal(blocked, 2, t).text).toBe('Your pawn on d2 is in the way.');
    expect(presentIllegal(blocked, 2, t).highlights).toEqual([
      { square: 'c1', kind: 'info' },
      { square: 'd2', kind: 'info' },
    ]);
    const enemyBlock = explainIllegalMove('4k3/8/8/8/8/8/n7/R3K3 w - - 0 1', 'a1', 'a5');
    expect(presentIllegal(enemyBlock, 1, t).text).toBe('The other team\'s horse is in the way.');
  });

  it('shows who attacks the king', () => {
    const pinned = presentIllegal(explainIllegalMove('4k3/8/8/q7/8/4n3/3B4/4K3 w - - 0 1', 'd2', 'e3'), 2, t);
    expect(pinned.text).toBe('Your bishop is pinned. If it moves, the queen on a5 attacks your king.');
    expect(pinned.highlights).toEqual([
      { square: 'd2', kind: 'info' },
      { square: 'a5', kind: 'danger' },
      { square: 'e1', kind: 'danger' },
    ]);
    expect(pinned.arrows).toEqual([{ from: 'a5', to: 'e1', kind: 'danger' }]);

    const check = presentIllegal(explainIllegalMove('4k3/8/8/8/8/8/3P4/r3K3 w - - 0 1', 'd2', 'd3'), 1, t);
    expect(check.text).toBe('Your king is in check from the rook! Make your king safe first.');
    expect(check.arrows).toEqual([{ from: 'a1', to: 'e1', kind: 'danger' }]);

    const castle = presentIllegal(explainIllegalMove('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1', 'e1', 'g1'), 2, t);
    expect(castle.text).toBe('You can not castle now. Your king would pass f1, and the rook on f2 attacks it.');
    expect(castle.arrows).toEqual([{ from: 'f2', to: 'f1', kind: 'danger' }]);

    const inCheck = presentIllegal(explainIllegalMove('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1', 'e1', 'g1'), 2, t);
    expect(inCheck.highlights).toEqual([
      { square: 'e1', kind: 'danger' },
      { square: 'e2', kind: 'danger' },
    ]);
  });

  it('returns null for a legal move and has a safe text for an unknown code', () => {
    expect(presentIllegal(null, 1, t)).toBeNull();
    expect(presentIllegal(explainIllegalMove(START, 'e2', 'e4'), 1, t)).toBeNull();
    expect(presentIllegal({ code: 'something-new', params: { from: 'e2', to: 'e4' } }, 1, t).text).toBe('That move is not allowed.');
    expect(presentIllegal({ code: 'not-allowed', params: { from: 'e2', to: 'e4' } }, 2, t).text).toBe('That move is not allowed.');
    expect(() => presentIllegal(null, 7, t)).toThrow(RangeError);
  });
});

describe('the text file', () => {
  it('has no empty text and no empty list', () => {
    const problems = [];
    const walk = (node, path) => {
      if (typeof node === 'string') {
        if (node.trim() === '') problems.push(path);
      } else if (Array.isArray(node)) {
        if (node.length === 0) problems.push(path);
        node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
      } else {
        problems.push(path);
      }
    };
    walk(strings, '');
    expect(problems).toEqual([]);
  });

  it('keeps level 1 texts free of notation and rating words', () => {
    const texts = [];
    const collect = (node) => {
      if (typeof node === 'string') texts.push(node);
      else if (Array.isArray(node)) node.forEach(collect);
      else Object.values(node).forEach(collect);
    };
    collect(strings.kid);
    collect(strings.illegal.kid);
    expect(texts.length).toBeGreaterThan(40);
    for (const text of texts) {
      expect(text).not.toMatch(NOTATION);
      expect(text).not.toMatch(RATING_WORDS);
      expect(text).not.toMatch(/\{(from|to|square|blockerSquare|attackerSquare|rook|move|capture)\}/);
    }
  });
});
