import { describe, expect, it } from 'vitest';
import { Chess, SQUARES } from 'chess.js';
import { castlingTarget, explainIllegalMove } from '../../src/coach/illegal.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const CASTLE = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

const KNOWN_CODES = [
  'game-over',
  'no-piece',
  'not-your-piece',
  'not-your-turn',
  'same-square',
  'own-piece',
  'wrong-shape',
  'blocked',
  'pawn-blocked',
  'pawn-capture-empty',
  'pawn-straight-capture',
  'leaves-king-in-check',
  'must-answer-check',
  'castle-king-moved',
  'castle-rook-moved',
  'castle-blocked',
  'castle-in-check',
  'castle-through-check',
  'castle-into-check',
];

describe('explainIllegalMove: basic reasons', () => {
  it('returns null for a legal move', () => {
    expect(explainIllegalMove(START, 'e2', 'e4')).toBeNull();
    expect(explainIllegalMove(START, 'g1', 'f3')).toBeNull();
  });

  it('no-piece: the start square is empty', () => {
    expect(explainIllegalMove(START, 'e4', 'e5')).toEqual({ code: 'no-piece', params: { from: 'e4', to: 'e5' } });
  });

  it('not-your-piece: the piece belongs to the other side', () => {
    expect(explainIllegalMove(START, 'e7', 'e5')).toEqual({ code: 'not-your-piece', params: { from: 'e7', to: 'e5', piece: 'p' } });
  });

  it('not-your-turn: the player moves an own piece while the other side is to move', () => {
    const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(explainIllegalMove(blackToMove, 'd2', 'd4', { playerColor: 'w' }).code).toBe('not-your-turn');
    expect(explainIllegalMove(blackToMove, 'e7', 'e5', { playerColor: 'w' }).code).toBe('not-your-piece');
    expect(explainIllegalMove(blackToMove, 'e7', 'e5', { playerColor: 'b' })).toBeNull();
  });

  it('same-square: the piece was put back', () => {
    expect(explainIllegalMove(START, 'e2', 'e2').code).toBe('same-square');
  });

  it('own-piece: the target holds one of the player\'s own pieces', () => {
    expect(explainIllegalMove(START, 'a1', 'a2')).toEqual({ code: 'own-piece', params: { from: 'a1', to: 'a2', piece: 'r', targetPiece: 'p' } });
    expect(explainIllegalMove(START, 'g1', 'e2').code).toBe('own-piece');
  });

  it('game-over: checkmate and stalemate', () => {
    const foolsMate = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
    expect(explainIllegalMove(foolsMate, 'e1', 'f2')).toMatchObject({ code: 'game-over', params: { reason: 'checkmate' } });
    const stalemate = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    expect(explainIllegalMove(stalemate, 'h8', 'g8')).toMatchObject({ code: 'game-over', params: { reason: 'stalemate' } });
  });
});

describe('explainIllegalMove: the way pieces move', () => {
  const open = '4k3/8/8/8/3QK3/8/8/R1B3N1 w - - 0 1';

  it('wrong-shape: names the piece', () => {
    expect(explainIllegalMove(START, 'g1', 'g3')).toEqual({ code: 'wrong-shape', params: { from: 'g1', to: 'g3', piece: 'n', detail: null } });
    expect(explainIllegalMove(open, 'c1', 'c3')).toMatchObject({ code: 'wrong-shape', params: { piece: 'b' } });
    expect(explainIllegalMove(open, 'a1', 'b2')).toMatchObject({ code: 'wrong-shape', params: { piece: 'r' } });
    expect(explainIllegalMove(open, 'd4', 'e6')).toMatchObject({ code: 'wrong-shape', params: { piece: 'q' } });
    expect(explainIllegalMove(open, 'e4', 'e6')).toMatchObject({ code: 'wrong-shape', params: { piece: 'k' } });
  });

  it('wrong-shape: says what the pawn did wrong', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 0 3';
    expect(explainIllegalMove(fen, 'e4', 'e3')).toMatchObject({ code: 'wrong-shape', params: { piece: 'p', detail: 'pawn-backward' } });
    expect(explainIllegalMove(fen, 'd3', 'c3')).toMatchObject({ code: 'wrong-shape', params: { piece: 'p', detail: 'pawn-backward' } });
    expect(explainIllegalMove(fen, 'd3', 'd5')).toMatchObject({ code: 'wrong-shape', params: { piece: 'p', detail: 'pawn-two-steps-late' } });
    expect(explainIllegalMove(fen, 'a2', 'a5')).toMatchObject({ code: 'wrong-shape', params: { piece: 'p', detail: 'pawn-too-far' } });
    expect(explainIllegalMove(fen, 'a2', 'c4')).toMatchObject({ code: 'wrong-shape', params: { piece: 'p', detail: null } });
  });

  it('blocked: names the square of the piece in the way', () => {
    expect(explainIllegalMove(START, 'c1', 'e3')).toEqual({
      code: 'blocked',
      params: { from: 'c1', to: 'e3', piece: 'b', blocker: 'd2', blockerPiece: 'p', blockerColor: 'w', blockerIsOwn: true },
    });
    expect(explainIllegalMove(START, 'a1', 'a4')).toMatchObject({ code: 'blocked', params: { blocker: 'a2' } });
    expect(explainIllegalMove(START, 'd1', 'd3')).toMatchObject({ code: 'blocked', params: { blocker: 'd2' } });
  });

  it('blocked: also by a piece of the other side', () => {
    const fen = '4k3/8/8/8/8/8/n7/R3K3 w - - 0 1';
    expect(explainIllegalMove(fen, 'a1', 'a5')).toMatchObject({ code: 'blocked', params: { blocker: 'a2', blockerPiece: 'n', blockerColor: 'b', blockerIsOwn: false } });
  });

  it('pawn-blocked: a piece stands right in front of a pawn that wants to go two squares', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/8/8/4p3/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(explainIllegalMove(fen, 'e2', 'e4')).toEqual({
      code: 'pawn-blocked',
      params: { from: 'e2', to: 'e4', piece: 'p', blocker: 'e3', blockerPiece: 'p', blockerColor: 'b', blockerIsOwn: false },
    });
  });

  it('pawn-capture-empty: a diagonal step with nothing to capture', () => {
    expect(explainIllegalMove(START, 'e2', 'd3')).toEqual({ code: 'pawn-capture-empty', params: { from: 'e2', to: 'd3', piece: 'p' } });
  });

  it('pawn-straight-capture: a pawn can not capture straight ahead', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    expect(explainIllegalMove(fen, 'e4', 'e5')).toEqual({ code: 'pawn-straight-capture', params: { from: 'e4', to: 'e5', piece: 'p', targetPiece: 'p' } });
    const twoSteps = 'rnbqkbnr/pppp1ppp/8/8/4p3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(explainIllegalMove(twoSteps, 'e2', 'e4').code).toBe('pawn-straight-capture');
  });

  it('accepts en passant and a promotion without a piece choice', () => {
    const enPassant = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';
    expect(explainIllegalMove(enPassant, 'e5', 'f6')).toBeNull();
    expect(explainIllegalMove(enPassant, 'e5', 'd6').code).toBe('pawn-capture-empty');
    expect(explainIllegalMove('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7', 'e8')).toBeNull();
  });
});

describe('explainIllegalMove: king safety', () => {
  it('leaves-king-in-check: a pinned piece, with the square of the attacker', () => {
    const fen = '4k3/8/8/q7/8/4n3/3B4/4K3 w - - 0 1';
    expect(explainIllegalMove(fen, 'd2', 'e3')).toEqual({
      code: 'leaves-king-in-check',
      params: { from: 'd2', to: 'e3', piece: 'b', kind: 'pinned', attacker: 'a5', attackerPiece: 'q', king: 'e1' },
    });
  });

  it('leaves-king-in-check: the king steps onto an attacked square', () => {
    const fen = '4k3/8/8/8/8/8/r7/4K3 w - - 0 1';
    expect(explainIllegalMove(fen, 'e1', 'e2')).toEqual({
      code: 'leaves-king-in-check',
      params: { from: 'e1', to: 'e2', piece: 'k', kind: 'king-into-attack', attacker: 'a2', attackerPiece: 'r', king: 'e2' },
    });
  });

  it('leaves-king-in-check: a king in check that stays on the line of the checking piece', () => {
    const fen = '4k3/8/8/8/8/8/8/r3K3 w - - 0 1';
    expect(explainIllegalMove(fen, 'e1', 'f1')).toMatchObject({ code: 'leaves-king-in-check', params: { kind: 'king-into-attack', attacker: 'a1' } });
    expect(explainIllegalMove(fen, 'e1', 'e2')).toBeNull();
  });

  it('leaves-king-in-check: an en passant capture that opens the rank to the king', () => {
    const fen = '4k3/8/8/KPp4r/8/8/8/8 w - c6 0 1';
    expect(explainIllegalMove(fen, 'b5', 'c6')).toMatchObject({ code: 'leaves-king-in-check', params: { kind: 'pinned', attacker: 'h5', attackerPiece: 'r' } });
  });

  it('must-answer-check: the move does not deal with the check, with the square of the checking piece', () => {
    const fen = '4k3/8/8/8/8/8/3P4/r3K3 w - - 0 1';
    expect(explainIllegalMove(fen, 'd2', 'd3')).toEqual({
      code: 'must-answer-check',
      params: { from: 'd2', to: 'd3', piece: 'p', checker: 'a1', checkerPiece: 'r', king: 'e1' },
    });
  });

  it('must-answer-check is not used when the move blocks the check but opens another line', () => {
    // The bishop on d2 blocks the queen on a5. Rook e8 gives check. Blocking on e3 with that bishop stops the rook but lets the queen in.
    const fen = '3kr3/8/8/q7/8/8/3B4/4K3 w - - 0 1';
    expect(explainIllegalMove(fen, 'd2', 'e3')).toMatchObject({ code: 'leaves-king-in-check', params: { kind: 'pinned', attacker: 'a5' } });
    expect(explainIllegalMove(fen, 'd2', 'c3')).toMatchObject({ code: 'must-answer-check', params: { checker: 'e8' } });
  });
});

describe('explainIllegalMove: castling', () => {
  it('accepts legal castling, by two squares or by dropping the king on the rook', () => {
    expect(explainIllegalMove(CASTLE, 'e1', 'g1')).toBeNull();
    expect(explainIllegalMove(CASTLE, 'e1', 'c1')).toBeNull();
    expect(explainIllegalMove(CASTLE, 'e1', 'h1')).toBeNull();
    expect(explainIllegalMove(CASTLE, 'e1', 'a1')).toBeNull();
    expect(explainIllegalMove('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8', 'g8')).toBeNull();
    expect(explainIllegalMove('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8', 'a8')).toBeNull();
  });

  it('castlingTarget turns king-on-rook into the real target', () => {
    expect(castlingTarget(CASTLE, 'e1', 'h1')).toBe('g1');
    expect(castlingTarget(CASTLE, 'e1', 'a1')).toBe('c1');
    expect(castlingTarget('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', 'e8', 'h8')).toBe('g8');
    expect(castlingTarget(CASTLE, 'e1', 'g1')).toBe('g1');
    expect(castlingTarget(CASTLE, 'a1', 'a5')).toBe('a5');
    expect(castlingTarget(START, 'e2', 'e4')).toBe('e4');
  });

  it('castle-king-moved: no castling right on either side', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1';
    expect(explainIllegalMove(fen, 'e1', 'g1')).toEqual({ code: 'castle-king-moved', params: { from: 'e1', to: 'g1', piece: 'k', side: 'k', rook: 'h1' } });
    expect(explainIllegalMove(fen, 'e1', 'a1')).toMatchObject({ code: 'castle-king-moved', params: { side: 'q', rook: 'a1' } });
  });

  it('castle-king-moved: the king is not on its first square and is dropped on its rook', () => {
    expect(explainIllegalMove('r3k2r/8/8/8/8/8/8/R4K1R w kq - 0 1', 'f1', 'h1').code).toBe('castle-king-moved');
  });

  it('castle-rook-moved: no castling right on that side', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1';
    expect(explainIllegalMove(fen, 'e1', 'g1')).toMatchObject({ code: 'castle-rook-moved', params: { side: 'k', rook: 'h1', rookMissing: false } });
    expect(explainIllegalMove(fen, 'e1', 'c1')).toBeNull();
  });

  it('castle-rook-moved: no rook in the corner', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K3 w Qkq - 0 1';
    expect(explainIllegalMove(fen, 'e1', 'g1')).toMatchObject({ code: 'castle-rook-moved', params: { rookMissing: true } });
  });

  it('castle-blocked: a piece stands between king and rook', () => {
    expect(explainIllegalMove('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1', 'e1', 'g1')).toMatchObject({
      code: 'castle-blocked',
      params: { side: 'k', blocker: 'f1', blockerPiece: 'b', blockerIsOwn: true },
    });
    expect(explainIllegalMove('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1', 'e1', 'c1')).toMatchObject({ code: 'castle-blocked', params: { side: 'q', blocker: 'b1' } });
    expect(explainIllegalMove(START, 'e1', 'g1')).toMatchObject({ code: 'castle-blocked', params: { blocker: 'f1' } });
  });

  it('castle-in-check: the king is in check now', () => {
    expect(explainIllegalMove('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1', 'e1', 'g1')).toMatchObject({
      code: 'castle-in-check',
      params: { checker: 'e2', checkerPiece: 'r', king: 'e1' },
    });
  });

  it('castle-through-check: the king would pass an attacked square', () => {
    expect(explainIllegalMove('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1', 'e1', 'g1')).toMatchObject({
      code: 'castle-through-check',
      params: { square: 'f1', attacker: 'f2', attackerPiece: 'r' },
    });
  });

  it('castle-into-check: the king would land on an attacked square', () => {
    expect(explainIllegalMove('4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1', 'e1', 'g1')).toMatchObject({
      code: 'castle-into-check',
      params: { square: 'g1', attacker: 'g2', attackerPiece: 'r' },
    });
  });

  it('allows queenside castling when only the b-file square is attacked', () => {
    expect(explainIllegalMove('4k3/8/8/8/8/8/1r6/R3K2R w KQ - 0 1', 'e1', 'c1')).toBeNull();
  });

  it('treats a king two squares away from its first square as a normal king move', () => {
    expect(explainIllegalMove('r3k2r/8/8/8/8/8/4K3/R6R w kq - 0 1', 'e2', 'g2')).toMatchObject({ code: 'wrong-shape', params: { piece: 'k' } });
  });

  it('treats the king dropped on a rook that is not in the corner as own-piece', () => {
    expect(explainIllegalMove('4k3/8/8/8/8/8/8/4KR2 w - - 0 1', 'e1', 'f1').code).toBe('own-piece');
  });
});

describe('explainIllegalMove: wrong input fails loudly', () => {
  it('throws for a bad square, a bad FEN or a bad player color', () => {
    expect(() => explainIllegalMove(START, 'e2', 'z9')).toThrow(TypeError);
    expect(() => explainIllegalMove(START, null, 'e4')).toThrow(TypeError);
    expect(() => explainIllegalMove('not a fen', 'e2', 'e4')).toThrow();
    expect(() => explainIllegalMove(START, 'e2', 'e4', { playerColor: 'x' })).toThrow(TypeError);
    expect(() => castlingTarget(START, 'e2', 'e99')).toThrow(TypeError);
  });
});

// A small fixed random number generator, so that the same games are played on every run.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

describe('explainIllegalMove: agrees with chess.js', () => {
  it('says "legal" exactly when chess.js does, and always finds a real reason, over random games', () => {
    const random = seededRandom(20261113);
    const seenCodes = new Set();
    let checked = 0;
    for (let game = 0; game < 5; game++) {
      const chess = new Chess();
      for (let ply = 0; ply < 60 && !chess.isGameOver(); ply++) {
        const moves = chess.moves();
        chess.move(moves[Math.floor(random() * moves.length)]);
        // Check every fifteenth position fully: each own piece to each square of the board.
        if (ply % 15 !== 14 || chess.isGameOver()) continue;
        const fen = chess.fen();
        const turn = chess.turn();
        const legal = new Set(chess.moves({ verbose: true }).map((move) => move.from + move.to));
        for (const from of SQUARES) {
          const piece = chess.get(from);
          if (!piece || piece.color !== turn) continue;
          for (const to of SQUARES) {
            if (from === to) continue;
            const result = explainIllegalMove(fen, from, to);
            const expectedLegal = legal.has(from + castlingTarget(fen, from, to));
            checked += 1;
            if (expectedLegal) {
              expect(result, `${fen} ${from}${to} should be legal`).toBeNull();
            } else {
              expect(result, `${fen} ${from}${to} should be illegal`).not.toBeNull();
              expect(KNOWN_CODES, `${fen} ${from}${to} gave ${result.code}`).toContain(result.code);
              seenCodes.add(result.code);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
    // The random games must reach the common reasons, or the test proves little.
    for (const code of ['own-piece', 'wrong-shape', 'blocked', 'pawn-capture-empty', 'leaves-king-in-check']) {
      expect(seenCodes, `random games never produced ${code}`).toContain(code);
    }
  }, 60000);
});
