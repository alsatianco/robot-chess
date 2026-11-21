import { describe, expect, it } from 'vitest';
import { buildMoveReport, classifyMove, scoreToCp, winChance } from '../../src/coach/report.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// White to play move 9. The knight on f3 is attacked by the bishop on g4 and defended only by the queen on d1.
const SPEC = 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/4PNP1/PPP2P1P/RNBQKB1R w KQkq - 0 9';

// An engine line in the shape of src/engine/types.js. `score` is centipawns, or { mate: n }.
function line(pv, score, multipv = 1) {
  const moves = Array.isArray(pv) ? pv : [pv];
  const parts = typeof score === 'number' ? { cp: score, mate: null } : { cp: null, mate: score.mate };
  return { multipv, depth: 14, move: moves[0], pv: moves, ...parts };
}

const cp = (value) => ({ cp: value, mate: null });
const mate = (value) => ({ cp: null, mate: value });

describe('winChance and scoreToCp', () => {
  it('follows the Lichess curve', () => {
    expect(winChance(0)).toBe(50);
    expect(winChance(100)).toBeCloseTo(59.1, 1);
    expect(winChance(-100)).toBeCloseTo(40.9, 1);
    expect(winChance(100) + winChance(-100)).toBeCloseTo(100, 10);
    expect(winChance(1500)).toBeGreaterThan(99);
    expect(winChance(300)).toBeGreaterThan(winChance(200));
  });

  it('maps mates to very large values and keeps their order', () => {
    expect(scoreToCp(mate(1))).toBeGreaterThan(scoreToCp(mate(2)));
    expect(scoreToCp(mate(40))).toBeGreaterThan(scoreToCp(cp(9000)));
    expect(scoreToCp(mate(-1))).toBeLessThan(scoreToCp(mate(-3)));
    expect(scoreToCp(mate(-40))).toBeLessThan(scoreToCp(cp(-9000)));
    expect(scoreToCp(mate(0))).toBe(-100000);
    expect(scoreToCp(mate(5000))).toBeGreaterThan(scoreToCp(cp(999999)));
    expect(winChance(scoreToCp(mate(7)))).toBeCloseTo(100, 6);
    expect(winChance(scoreToCp(mate(-7)))).toBeCloseTo(0, 6);
  });

  it('keeps a plain score as it is and returns null without a number', () => {
    expect(scoreToCp(cp(35))).toBe(35);
    expect(scoreToCp(cp(-35))).toBe(-35);
    expect(scoreToCp({ cp: null, mate: null })).toBeNull();
    expect(scoreToCp({ cp: Number.NaN, mate: null })).toBeNull();
    expect(scoreToCp(null)).toBeNull();
    expect(scoreToCp(undefined)).toBeNull();
  });
});

describe('classifyMove', () => {
  const rating = (best, played) => classifyMove(best, played).rating;

  it('counts a move inside the equal window as a top move', () => {
    expect(classifyMove(cp(30), cp(15))).toMatchObject({ rating: 'best', isTopMove: true, cpLoss: 15 });
    expect(classifyMove(cp(30), cp(30))).toMatchObject({ rating: 'best', isTopMove: true, cpLoss: 0, winChanceLoss: 0 });
    expect(classifyMove(cp(30), cp(14))).toMatchObject({ rating: 'excellent', isTopMove: false, cpLoss: 16 });
  });

  it('never gives a negative loss when the played move scores higher than the best line', () => {
    expect(classifyMove(cp(10), cp(60))).toMatchObject({ rating: 'best', isTopMove: true, cpLoss: 0, winChanceLoss: 0 });
  });

  it('rates by loss of win chance from an equal position', () => {
    expect(rating(cp(0), cp(-20))).toBe('excellent');
    expect(rating(cp(0), cp(-40))).toBe('good');
    expect(rating(cp(0), cp(-100))).toBe('inaccuracy');
    expect(rating(cp(0), cp(-200))).toBe('mistake');
    expect(rating(cp(0), cp(-300))).toBe('blunder');
  });

  it('does not call every move a blunder in a position that is already won or lost', () => {
    expect(classifyMove(cp(2500), cp(1200))).toMatchObject({ rating: 'good', cpLoss: 1300 });
    expect(rating(cp(-1200), cp(-2500))).toBe('good');
    expect(rating(cp(900), cp(700))).toBe('good');
    // The same 300 centipawns are a blunder when the game was still open.
    expect(rating(cp(150), cp(-150))).toBe('blunder');
  });

  it('needs a small centipawn loss for excellent', () => {
    expect(rating(cp(1500), cp(1460))).toBe('excellent');
    expect(rating(cp(1500), cp(1400))).toBe('good');
  });

  it('mate scores: keeping the mate', () => {
    expect(classifyMove(mate(3), mate(3))).toMatchObject({ rating: 'best', isTopMove: true });
    expect(classifyMove(mate(3), mate(2))).toMatchObject({ rating: 'best', isTopMove: true });
    expect(classifyMove(mate(2), mate(4))).toMatchObject({ rating: 'excellent', isTopMove: false });
    expect(rating(mate(2), mate(9))).toBe('good');
    expect(rating(mate(1), mate(2))).toBe('inaccuracy');
  });

  it('mate scores: giving up a forced mate', () => {
    expect(rating(mate(3), cp(1200))).toBe('inaccuracy');
    expect(rating(mate(3), cp(800))).toBe('mistake');
    expect(rating(mate(3), cp(300))).toBe('blunder');
    expect(rating(mate(3), cp(-50))).toBe('blunder');
  });

  it('mate scores: walking into a forced mate', () => {
    expect(rating(cp(50), mate(-3))).toBe('blunder');
    expect(rating(cp(-800), mate(-2))).toBe('mistake');
    expect(rating(cp(-1200), mate(-2))).toBe('inaccuracy');
    expect(rating(mate(4), mate(-1))).toBe('blunder');
  });

  it('mate scores: already lost', () => {
    expect(classifyMove(mate(-3), mate(-3))).toMatchObject({ rating: 'best', isTopMove: true });
    expect(rating(mate(-5), mate(-3))).toBe('excellent');
    expect(rating(mate(-5), mate(-1))).toBe('inaccuracy');
  });

  it('gives no rating when a score has no number', () => {
    expect(classifyMove(cp(10), { cp: null, mate: null })).toEqual({ rating: null, isTopMove: false, cpLoss: null, winChanceLoss: null });
    expect(classifyMove({ cp: null, mate: null }, cp(10)).rating).toBeNull();
  });
});

describe('buildMoveReport: the spec example', () => {
  const lines = [line(['b1d2', 'f8e7', 'f1g2'], -100, 1), line(['f1e2', 'f8d6'], -110, 2), line(['f1g2', 'f8d6'], -140, 3)];
  const playedLine = line(['d1d2', 'g4f3', 'h1g1', 'f6e4'], -180);
  const report = buildMoveReport({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, lines, playedLine });

  it('describes the move', () => {
    expect(report).toMatchObject({
      fenBefore: SPEC,
      fenAfter: 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/4PNP1/PPPQ1P1P/RNB1KB1R b KQkq - 1 9',
      moveSan: 'Qd2',
      moveUci: 'd1d2',
      moveNumber: 9,
      color: 'w',
      isCheck: false,
      isCheckmate: false,
      isStalemate: false,
    });
    expect(report.move).toEqual({ uci: 'd1d2', san: 'Qd2', from: 'd1', to: 'd2', piece: 'q', captured: null, promotion: null });
  });

  it('rates the move', () => {
    expect(report.rating).toBe('inaccuracy');
    expect(report.isTopMove).toBe(false);
    expect(report.cpLoss).toBe(80);
    expect(report.winChanceLoss).toBeCloseTo(6.89, 1);
    expect(report.evalBefore).toEqual({ cp: -100, mate: null });
    expect(report.evalAfter).toEqual({ cp: -180, mate: null });
  });

  it('gives the best move, the equal moves and both lines', () => {
    expect(report.best).toMatchObject({ uci: 'b1d2', san: 'Nbd2', from: 'b1', to: 'd2' });
    expect(report.equalMoves).toEqual(['Be2']);
    expect(report.bestLineSan).toEqual(['Nbd2', 'Be7', 'Bg2']);
    expect(report.bestLineUci).toEqual(['b1d2', 'f8e7', 'f1g2']);
    expect(report.playedLineSan).toEqual(['Qd2', 'Bxf3', 'Rg1', 'Ne4']);
    expect(report.playedLineUci).toEqual(['d1d2', 'g4f3', 'h1g1', 'f6e4']);
  });

  it('counts the material outcome of the played line', () => {
    expect(report.material).toEqual({
      plies: 4,
      settled: true,
      net: -3,
      outcome: 'player-loses',
      playerLost: ['n'],
      opponentLost: [],
      playerGained: [],
      opponentGained: [],
      before: { player: 39, opponent: 39 },
      after: { player: 36, opponent: 39 },
    });
  });

  it('carries the findings', () => {
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ type: 'hanging-piece', tier: 1, square: 'f3', piece: 'n', points: 3, confirmed: true, remedy: null });
  });
});

describe('buildMoveReport: equal moves in the opening', () => {
  const lines = [line('e2e4', 30, 1), line('d2d4', 28, 2), line('g1f3', 25, 3), line('c2c4', 20, 4), line('b1c3', 5, 5)];

  it('treats a move within the window as a top move and lists the other equal moves', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'd2', to: 'd4' }, lines, playedLine: lines[1] });
    expect(report).toMatchObject({ rating: 'best', isTopMove: true, cpLoss: 2 });
    expect(report.best.san).toBe('e4');
    expect(report.equalMoves).toEqual(['Nf3', 'c4']);
    expect(report.findings.map((finding) => finding.type)).toEqual(['top-move']);
  });

  it('lists the equal moves for the engine\'s first move too', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines, playedLine: lines[0] });
    expect(report).toMatchObject({ rating: 'best', isTopMove: true, cpLoss: 0, winChanceLoss: 0 });
    expect(report.equalMoves).toEqual(['d4', 'Nf3', 'c4']);
  });

  it('rates a move outside the window', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'b1', to: 'c3' }, lines, playedLine: lines[4] });
    expect(report).toMatchObject({ rating: 'good', isTopMove: false, cpLoss: 25 });
    expect(report.winChanceLoss).toBeCloseTo(2.3, 1);
    expect(report.equalMoves).toEqual(['d4', 'Nf3', 'c4']);
  });

  it('finds the played move in the lines when playedLine is null', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'd2', to: 'd4' }, lines, playedLine: null });
    expect(report).toMatchObject({ rating: 'best', isTopMove: true });
    expect(report.evalAfter).toEqual({ cp: 28, mate: null });
  });

  it('prefers the line from the main search over a separate search of the same move', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'd2', to: 'd4' }, lines, playedLine: line('d2d4', -90) });
    expect(report).toMatchObject({ rating: 'best', cpLoss: 2 });
  });

  it('sorts lines that arrive out of order', () => {
    const shuffled = [lines[3], lines[0], lines[4], lines[1], lines[2]];
    const report = buildMoveReport({ fenBefore: START, move: { from: 'b1', to: 'c3' }, lines: shuffled, playedLine: null });
    expect(report.best.san).toBe('e4');
    expect(report.rating).toBe('good');
    expect(report.cpLoss).toBe(25);
  });
});

describe('buildMoveReport: a separate line for the played move', () => {
  const lines = [line('e2e4', 30, 1), line('d2d4', 28, 2), line('g1f3', 25, 3)];

  it('uses playedLine when the move is not in the lines', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'a2', to: 'a4' }, lines, playedLine: line(['a2a4', 'e7e5'], -40) });
    expect(report).toMatchObject({ rating: 'inaccuracy', isTopMove: false, cpLoss: 70 });
    expect(report.playedLineSan).toEqual(['a4', 'e5']);
    expect(report.findings).toEqual([expect.objectContaining({ type: 'opening-principle', principle: 'edge-pawn' })]);
  });

  it('counts a played move that scores higher than the best line as a top move', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'c2', to: 'c4' }, lines, playedLine: line('c2c4', 45) });
    expect(report).toMatchObject({ rating: 'best', isTopMove: true, cpLoss: 0 });
  });

  it('ignores a playedLine that belongs to another move', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'a2', to: 'a4' }, lines, playedLine: line('h2h4', -40) });
    expect(report.rating).toBeNull();
    expect(report.evalAfter).toBeNull();
    expect(report.best.san).toBe('e4');
    expect(report.playedLineSan).toEqual(['a4']);
  });
});

describe('buildMoveReport: missing engine lines', () => {
  it('still returns a report with the static findings', () => {
    for (const input of [{ lines: [], playedLine: null }, {}, { lines: undefined, playedLine: undefined }, { lines: 'oops', playedLine: 'oops' }]) {
      const report = buildMoveReport({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, ...input });
      expect(report).toMatchObject({
        rating: null,
        isTopMove: false,
        equalMoves: [],
        cpLoss: null,
        winChanceLoss: null,
        evalBefore: null,
        evalAfter: null,
        best: null,
        bestLineSan: [],
        bestLineUci: [],
        playedLineSan: ['Qd2'],
        playedLineUci: ['d1d2'],
        moveSan: 'Qd2',
      });
      expect(report.material).toMatchObject({ plies: 1, outcome: 'nothing', net: 0, settled: true });
      expect(report.findings).toEqual([expect.objectContaining({ type: 'hanging-piece', square: 'f3', tier: 1, confirmed: null })]);
    }
  });

  it('gives the best move but no rating when only the played line is missing', () => {
    const report = buildMoveReport({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, lines: [line('b1d2', -100)], playedLine: null });
    expect(report.rating).toBeNull();
    expect(report.best.san).toBe('Nbd2');
    expect(report.evalBefore).toEqual({ cp: -100, mate: null });
    expect(report.evalAfter).toBeNull();
    expect(report.findings.map((finding) => finding.type)).toEqual(['hanging-piece']);
  });

  it('gives the evaluation but no rating when only the lines are missing', () => {
    const report = buildMoveReport({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, lines: [], playedLine: line(['d1d2', 'g4f3'], -180) });
    expect(report.rating).toBeNull();
    expect(report.best).toBeNull();
    expect(report.evalAfter).toEqual({ cp: -180, mate: null });
    expect(report.playedLineSan).toEqual(['Qd2', 'Bxf3']);
  });
});

describe('buildMoveReport: odd engine input never throws', () => {
  it('drops lines with no score, with an illegal move or with a wrong shape', () => {
    const lines = [
      null,
      42,
      'e2e4',
      { move: 'e2e5', pv: ['e2e5'], cp: 500, mate: null },
      { move: 'e2e4', pv: ['e2e4'], cp: null, mate: null },
      { move: 'zzzz', pv: [], cp: 10, mate: null },
      { pv: [], cp: 10, mate: null },
      { move: 'g1f3', pv: ['g1f3'], cp: 20, mate: null },
    ];
    const report = buildMoveReport({ fenBefore: START, move: { from: 'g1', to: 'f3' }, lines, playedLine: { cp: 'x' } });
    expect(report.best.san).toBe('Nf3');
    expect(report.rating).toBe('best');
  });

  it('cuts a line at its first illegal move', () => {
    const lines = [line(['e2e4', 'e7e5', 'e1e5', 'g1f3'], 30)];
    const report = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines, playedLine: lines[0] });
    expect(report.bestLineSan).toEqual(['e4', 'e5']);
    expect(report.playedLineUci).toEqual(['e2e4', 'e7e5']);
  });

  it('uses the move alone when the line does not start with it, and takes the move from the line when `move` is missing', () => {
    const wrongStart = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines: [{ move: 'e2e4', pv: ['d2d4', 'd7d5'], cp: 30, mate: null }] });
    expect(wrongStart.bestLineSan).toEqual(['e4']);
    const noMove = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines: [{ pv: ['e2e4', 'e7e5'], cp: 30, mate: null }] });
    expect(noMove.bestLineSan).toEqual(['e4', 'e5']);
    const noPv = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines: [{ move: 'e2e4', cp: 30, mate: null }] });
    expect(noPv.bestLineSan).toEqual(['e4']);
    expect(noPv.rating).toBe('best');
  });

  it('keeps the first of two lines for the same move', () => {
    const lines = [line('e2e4', 30), line('e2e4', -500), line('d2d4', 10)];
    const report = buildMoveReport({ fenBefore: START, move: { from: 'd2', to: 'd4' }, lines });
    expect(report.cpLoss).toBe(20);
  });

  it('cuts very long lines', () => {
    const knightDance = [];
    for (let i = 0; i < 10; i++) knightDance.push('g1f3', 'g8f6', 'f3g1', 'f6g8');
    const report = buildMoveReport({ fenBefore: START, move: { from: 'g1', to: 'f3' }, lines: [line(knightDance, 0)] });
    expect(report.bestLineSan).toHaveLength(12);
  });
});

describe('buildMoveReport: scores from White\'s point of view', () => {
  const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

  it('flips the sign for Black', () => {
    const lines = [line('e7e5', -25, 1), line('a7a5', -90, 2)];
    const report = buildMoveReport({ fenBefore: blackToMove, move: { from: 'a7', to: 'a5' }, lines });
    expect(report.color).toBe('b');
    expect(report.moveNumber).toBe(1);
    expect(report.evalBefore).toEqual({ cp: 25, mate: null });
    expect(report.evalAfter).toEqual({ cp: 90, mate: null });
    expect(report.cpLoss).toBe(65);
  });

  it('flips mates for Black and keeps zero as zero', () => {
    const lines = [line('e7e5', 0, 1), line('a7a5', { mate: -4 }, 2)];
    const report = buildMoveReport({ fenBefore: blackToMove, move: { from: 'a7', to: 'a5' }, lines });
    expect(report.evalBefore).toEqual({ cp: 0, mate: null });
    expect(Object.is(report.evalBefore.cp, -0)).toBe(false);
    expect(report.evalAfter).toEqual({ cp: null, mate: 4 });
    expect(report.rating).toBe('blunder');
  });
});

describe('buildMoveReport: checkmate and stalemate', () => {
  const backRank = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';

  it('a move that gives checkmate is always best, also without engine lines', () => {
    const report = buildMoveReport({ fenBefore: backRank, move: { from: 'a1', to: 'a8' } });
    expect(report).toMatchObject({ rating: 'best', isTopMove: true, isCheckmate: true, isCheck: true, cpLoss: 0, winChanceLoss: 0, moveSan: 'Ra8#' });
    expect(report.evalAfter).toEqual({ cp: null, mate: 1 });
    expect(report.findings.map((finding) => finding.type)).toEqual(['delivered-checkmate']);
  });

  it('a checkmate stays best when the engine lines say something else', () => {
    const lines = [line('e1e2', 900, 1), line('a1a8', 100, 2)];
    const report = buildMoveReport({ fenBefore: backRank, move: { from: 'a1', to: 'a8' }, lines });
    expect(report).toMatchObject({ rating: 'best', isTopMove: true });
  });

  it('a checkmate by Black is a mate for Black', () => {
    const report = buildMoveReport({ fenBefore: 'r3k3/8/8/8/8/8/5PPP/6K1 b - - 0 1', move: { from: 'a8', to: 'a1' } });
    expect(report.rating).toBe('best');
    expect(report.evalAfter).toEqual({ cp: null, mate: -1 });
  });

  it('reports a missed mate in one with the engine and without it', () => {
    const withEngine = buildMoveReport({ fenBefore: backRank, move: { from: 'e1', to: 'e2' }, lines: [line('a1a8', { mate: 1 }, 1), line('e1e2', { mate: 2 }, 2)] });
    expect(withEngine.rating).toBe('inaccuracy');
    expect(withEngine.findings[0]).toMatchObject({ type: 'missed-mate-in-1', move: { san: 'Ra8#' } });
    const without = buildMoveReport({ fenBefore: backRank, move: { from: 'e1', to: 'e2' } });
    expect(without.rating).toBeNull();
    expect(without.findings[0].type).toBe('missed-mate-in-1');
  });

  it('marks a stalemate', () => {
    const report = buildMoveReport({ fenBefore: '7k/8/5QK1/8/8/8/8/8 w - - 0 1', move: { from: 'f6', to: 'f7' }, lines: [line('f6f8', { mate: 1 }, 1), line('f6f7', 0, 2)] });
    expect(report.isStalemate).toBe(true);
    expect(report.rating).toBe('blunder');
    expect(report.findings.map((finding) => finding.type)).toEqual(['missed-mate-in-1', 'caused-stalemate']);
  });
});

describe('buildMoveReport: material outcome', () => {
  it('says so when nothing changes hands', () => {
    const report = buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e4' }, lines: [line(['e2e4', 'e7e5', 'g1f3', 'b8c6'], 30)] });
    expect(report.material).toMatchObject({ plies: 4, outcome: 'nothing', net: 0, playerLost: [], opponentLost: [], settled: true });
  });

  it('sees an even trade', () => {
    const fen = '4k3/8/4p3/3n4/8/2N5/8/4K3 w - - 0 1';
    const report = buildMoveReport({ fenBefore: fen, move: { from: 'c3', to: 'd5' }, lines: [line(['c3d5', 'e6d5', 'e1e2'], 0)] });
    expect(report.material).toMatchObject({ outcome: 'even', net: 0, playerLost: ['n'], opponentLost: ['n'], settled: true });
  });

  it('follows an exchange on one square to its end', () => {
    // Rook takes knight, rook takes rook, rook takes rook, rook takes rook: four captures on d5, counted to the end even though it is more than three plies after the first move.
    const fen = '3rk3/3r4/8/3n4/8/8/3R4/3RK3 w - - 0 1';
    const report = buildMoveReport({ fenBefore: fen, move: { from: 'e1', to: 'e2' }, lines: [line(['e1e2', 'e8e7', 'd2d5', 'd7d5', 'd1d5', 'd8d5'], -500)] });
    expect(report.material).toMatchObject({ plies: 6, settled: true, net: -2, playerLost: ['r', 'r'], opponentLost: ['r', 'n'], outcome: 'player-loses' });
  });

  it('marks the count as not settled when the line stops in the middle of an exchange', () => {
    // Queen takes a knight that a pawn defends, and the engine line ends there.
    const fen = '4k3/8/4p3/3n4/8/8/8/3QK3 w - - 0 1';
    const short = buildMoveReport({ fenBefore: fen, move: { from: 'd1', to: 'd5' }, lines: [line('e1e2', 0)], playedLine: line('d1d5', -500) });
    expect(short.material).toMatchObject({ plies: 1, settled: false, net: 3 });
    const full = buildMoveReport({ fenBefore: fen, move: { from: 'd1', to: 'd5' }, lines: [line('e1e2', 0)], playedLine: line(['d1d5', 'e6d5'], -500) });
    expect(full.material).toMatchObject({ plies: 2, settled: true, net: -6, playerLost: ['q'], opponentLost: ['n'], outcome: 'player-loses' });
  });

  it('counts a promotion', () => {
    const report = buildMoveReport({ fenBefore: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1', move: { from: 'e7', to: 'e8', promotion: 'q' } });
    expect(report.moveSan).toBe('e8=Q');
    expect(report.moveUci).toBe('e7e8q');
    expect(report.material).toMatchObject({ net: 8, outcome: 'player-wins', playerLost: ['p'], playerGained: ['q'] });
  });
});

describe('buildMoveReport: wrong input fails loudly', () => {
  it('throws for a missing or broken position or move', () => {
    expect(() => buildMoveReport()).toThrow(TypeError);
    expect(() => buildMoveReport({ fenBefore: 42, move: { from: 'e2', to: 'e4' } })).toThrow(TypeError);
    expect(() => buildMoveReport({ fenBefore: START })).toThrow(TypeError);
    expect(() => buildMoveReport({ fenBefore: START, move: { from: 'e2' } })).toThrow(TypeError);
    expect(() => buildMoveReport({ fenBefore: 'not a fen', move: { from: 'e2', to: 'e4' } })).toThrow();
  });

  it('throws for a move that is not legal, and says so', () => {
    expect(() => buildMoveReport({ fenBefore: START, move: { from: 'e2', to: 'e5' } })).toThrow(/not legal/);
    expect(() => buildMoveReport({ fenBefore: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1', move: { from: 'e7', to: 'e8' } })).toThrow(/promotion/);
  });
});
