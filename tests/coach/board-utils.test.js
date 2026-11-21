import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  attackedSquares,
  attackersOf,
  bestCaptureOn,
  defendersOf,
  evaluateCapture,
  formatNumberedLine,
  isSquare,
  listCaptures,
  materialCount,
  moveRef,
  parseUci,
  piecesOnRay,
  playUciLine,
  seeSquare,
  squaresBetween,
  toUci,
  tryMove,
  uciLineToSan,
  uciToMove,
  uciToSan,
} from '../../src/coach/board-utils.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('squares and lines', () => {
  it('knows what a square name is', () => {
    expect(isSquare('e4')).toBe(true);
    expect(isSquare('i4')).toBe(false);
    expect(isSquare('e9')).toBe(false);
    expect(isSquare(null)).toBe(false);
  });

  it('lists the squares between two squares on one line', () => {
    expect(squaresBetween('a1', 'd4')).toEqual(['b2', 'c3']);
    expect(squaresBetween('e1', 'h1')).toEqual(['f1', 'g1']);
    expect(squaresBetween('h8', 'h5')).toEqual(['h7', 'h6']);
    expect(squaresBetween('e1', 'f1')).toEqual([]);
  });

  it('returns null for squares that are not on one line', () => {
    expect(squaresBetween('a1', 'b3')).toBeNull();
    expect(squaresBetween('a1', 'a1')).toBeNull();
  });

  it('lists the pieces on a ray, nearest first', () => {
    const chess = new Chess('4k3/4r3/8/4n3/8/8/8/4R1K1 w - - 0 1');
    expect(piecesOnRay(chess, 'e1', [0, 1])).toEqual([
      { square: 'e5', type: 'n', color: 'b' },
      { square: 'e7', type: 'r', color: 'b' },
      { square: 'e8', type: 'k', color: 'b' },
    ]);
  });

  it('lists the squares a piece attacks', () => {
    const chess = new Chess(START);
    expect(attackedSquares(chess, 'g1').sort()).toEqual(['e2', 'f3', 'h3']);
    expect(attackedSquares(chess, 'e2').sort()).toEqual(['d3', 'f3']);
    expect(attackedSquares(chess, 'e7').sort()).toEqual(['d6', 'f6']);
    expect(attackedSquares(chess, 'a1').sort()).toEqual(['a2', 'b1']);
    expect(attackedSquares(chess, 'e4')).toEqual([]);
  });
});

describe('attackers and defenders', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

  it('finds the attackers of a square', () => {
    const chess = new Chess(fen);
    expect(attackersOf(chess, 'e5', 'w')).toEqual([{ square: 'f3', type: 'n' }]);
    expect(attackersOf(chess, 'e4', 'b')).toEqual([]);
  });

  it('finds the defenders of a piece, cheapest first', () => {
    const chess = new Chess(fen);
    expect(defendersOf(chess, 'e5')).toEqual([{ square: 'c6', type: 'n' }]);
    expect(defendersOf(chess, 'f3')).toEqual([
      { square: 'g2', type: 'p' },
      { square: 'd1', type: 'q' },
    ]);
    expect(defendersOf(chess, 'e4')).toEqual([]);
    expect(defendersOf(chess, 'e6')).toEqual([]);
  });
});

describe('static exchange evaluation', () => {
  it('wins a piece that nothing defends', () => {
    const chess = new Chess('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1');
    expect(seeSquare(chess, 'd5')).toBe(3);
    const capture = bestCaptureOn(chess, 'd5');
    expect(capture.gain).toBe(3);
    expect(capture.canRecapture).toBe(false);
    expect(capture.move.san).toBe('Rxd5');
  });

  it('does not take a knight with a rook when a pawn takes back', () => {
    const chess = new Chess('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1');
    expect(seeSquare(chess, 'd5')).toBe(0);
    const capture = evaluateCapture(chess, { from: 'd1', to: 'd5' });
    expect(capture.gain).toBe(-2);
    expect(capture.canRecapture).toBe(true);
  });

  it('wins material with a pawn even when the piece is defended', () => {
    const chess = new Chess('4k3/8/4p3/3n4/4P3/8/8/4K3 w - - 0 1');
    expect(seeSquare(chess, 'd5')).toBe(2);
  });

  it('sees through a battery of two rooks', () => {
    const chess = new Chess('3rk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1');
    expect(seeSquare(chess, 'd5')).toBe(3);
  });

  it('counts a second defender that stands behind the first', () => {
    const chess = new Chess('3rk3/3r4/8/3n4/8/8/3R4/3RK3 w - - 0 1');
    // Rxd5 Rxd5 Rxd5 Rxd5: White gives two rooks for a knight and a rook, so White should not start.
    expect(seeSquare(chess, 'd5')).toBe(0);
    expect(evaluateCapture(chess, { from: 'd2', to: 'd5' }).gain).toBe(-2);
  });

  it('does not count a pinned piece as an attacker', () => {
    const chess = new Chess('4k3/8/8/q7/8/4n3/3B4/4K3 w - - 0 1');
    expect(attackersOf(chess, 'e3', 'w')).toEqual([{ square: 'd2', type: 'b' }]);
    expect(seeSquare(chess, 'e3')).toBe(0);
    expect(bestCaptureOn(chess, 'e3')).toBeNull();
  });

  it('does not let the king take a defended piece', () => {
    const chess = new Chess('3rk3/8/8/8/8/8/3n4/4K3 w - - 0 1');
    expect(seeSquare(chess, 'd2')).toBe(0);
    expect(bestCaptureOn(chess, 'd2')).toBeNull();
  });

  it('lets the king take an undefended piece', () => {
    const chess = new Chess('4k3/8/8/8/8/8/3n4/4K3 w - - 0 1');
    expect(seeSquare(chess, 'd2')).toBe(3);
  });

  it('adds the promotion to a capture on the last rank', () => {
    const chess = new Chess('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    const capture = evaluateCapture(chess, { from: 'b7', to: 'a8', promotion: 'q' });
    expect(capture.gain).toBe(13);
    expect(capture.move.san).toContain('bxa8=Q');
  });

  it('returns null for a move that is not a capture or not legal', () => {
    const chess = new Chess(START);
    expect(evaluateCapture(chess, { from: 'e2', to: 'e4' })).toBeNull();
    expect(evaluateCapture(chess, { from: 'e2', to: 'e5' })).toBeNull();
    expect(chess.fen()).toBe(START);
  });

  it('leaves the board unchanged', () => {
    const fen = '3rk3/8/8/3n4/8/8/3R4/3RK3 w - - 0 1';
    const chess = new Chess(fen);
    seeSquare(chess, 'd5');
    listCaptures(chess);
    expect(chess.fen()).toBe(fen);
    expect(chess.history()).toEqual([]);
  });

  it('lists every legal capture, en passant included', () => {
    const chess = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    const captures = listCaptures(chess);
    expect(captures.map((capture) => toUci(capture.move))).toEqual(['e5f6']);
    expect(captures[0].victimSquare).toBe('f5');
    expect(captures[0].victim).toBe('p');
    expect(captures[0].gain).toBe(0);
    expect(captures[0].canRecapture).toBe(true);
  });

  it('lists nothing when there is nothing to take', () => {
    expect(listCaptures(new Chess(START))).toEqual([]);
  });
});

describe('material', () => {
  it('counts the start position', () => {
    const count = materialCount(START);
    expect(count.w).toEqual({ p: 8, n: 2, b: 2, r: 2, q: 1, points: 39 });
    expect(count.b.points).toBe(39);
  });

  it('accepts a chess.js board', () => {
    const count = materialCount(new Chess('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1'));
    expect(count.w.points).toBe(5);
    expect(count.b.points).toBe(3);
  });
});

describe('UCI moves and notation', () => {
  it('parses UCI text', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4' });
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(parseUci(' E7E8Q ')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(parseUci('e2e9')).toBeNull();
    expect(parseUci('e2')).toBeNull();
    expect(parseUci(42)).toBeNull();
    expect(parseUci(undefined)).toBeNull();
  });

  it('builds UCI text', () => {
    expect(toUci({ from: 'e7', to: 'e8', promotion: 'q' })).toBe('e7e8q');
    expect(toUci({ from: 'e2', to: 'e4' })).toBe('e2e4');
    expect(toUci({ from: 'e2', to: 'e4', promotion: null })).toBe('e2e4');
  });

  it('turns UCI into a move and into notation', () => {
    expect(uciToSan(START, 'g1f3')).toBe('Nf3');
    expect(uciToMove(START, 'e2e4').piece).toBe('p');
    expect(uciToSan(START, 'e2e5')).toBeNull();
    expect(uciToSan(START, 'nonsense')).toBeNull();
    expect(uciToSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1')).toBe('O-O');
  });

  it('describes a move as a plain object', () => {
    const chess = new Chess('r3k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    const made = tryMove(chess, { from: 'b7', to: 'a8', promotion: 'q' });
    expect(moveRef(made)).toEqual({ uci: 'b7a8q', san: 'bxa8=Q+', from: 'b7', to: 'a8', piece: 'p', captured: 'r', promotion: 'q' });
  });

  it('does not throw for an illegal move', () => {
    const chess = new Chess(START);
    expect(tryMove(chess, { from: 'e2', to: 'e5' })).toBeNull();
    expect(tryMove(chess, null)).toBeNull();
    expect(chess.fen()).toBe(START);
  });

  it('plays a line and stops at the first illegal move', () => {
    const played = playUciLine(START, ['e2e4', 'e7e5', 'e1e5', 'g1f3']);
    expect(played.moves.map((move) => move.san)).toEqual(['e4', 'e5']);
    expect(played.complete).toBe(false);
    expect(played.fen.startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w')).toBe(true);
  });

  it('plays a full line', () => {
    const played = playUciLine(START, ['e2e4', 'e7e5', 'g1f3']);
    expect(played.complete).toBe(true);
    expect(played.moves).toHaveLength(3);
  });

  it('stops at the ply limit', () => {
    expect(uciLineToSan(START, ['e2e4', 'e7e5', 'g1f3'], 2)).toEqual(['e4', 'e5']);
  });

  it('treats odd input as an empty line', () => {
    expect(playUciLine(START, undefined)).toMatchObject({ moves: [], complete: false });
    expect(playUciLine(START, 'e2e4')).toMatchObject({ moves: [], complete: false });
    expect(uciLineToSan(START, [null, 'e2e4'])).toEqual([]);
  });

  it('writes a line with move numbers', () => {
    expect(formatNumberedLine(['Bxf3', 'gxf3', 'Qd5'], 9, 'b')).toBe('9...Bxf3 10.gxf3 Qd5');
    expect(formatNumberedLine(['Nbd2'], 9, 'w')).toBe('9.Nbd2');
    expect(formatNumberedLine(['e4', 'e5', 'Nf3'], 1, 'w')).toBe('1.e4 e5 2.Nf3');
    expect(formatNumberedLine([], 1, 'w')).toBe('');
  });
});
