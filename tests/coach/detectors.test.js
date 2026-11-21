import { describe, expect, it } from 'vitest';
import {
  detectAllowedMateInOne,
  detectEngineMates,
  detectFindings,
  detectHangingPieces,
  detectMissedCapture,
  detectMissedMateInOne,
  detectOpeningPrinciple,
  detectStalemate,
  detectTactic,
  detectWonMaterial,
  findMateInOne,
  isNegativeFinding,
  sortFindings,
} from '../../src/coach/detectors.js';
import { scoreToCp, winChance } from '../../src/coach/report.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// White to play move 9. The knight on f3 is attacked by the bishop on g4 and defended only by the queen on d1.
const SPEC = 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/4PNP1/PPP2P1P/RNBQKB1R w KQkq - 0 9';
const SPEC_AFTER_QD2 = 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/4PNP1/PPPQ1P1P/RNB1KB1R b KQkq - 1 9';
// The same position with the queen on c2, where it does not defend f3. The knight can already be taken before White moves.
const LOOSE_KNIGHT = 'r2qkb1r/ppp2ppp/2n1pn2/3p4/3P2b1/4PNP1/PPQ2P1P/RNB1KB1R w KQkq - 0 9';

// Builds a line the way the report hands it to the detectors. `score` is centipawns, or { mate: n }.
function line(move, score, pv = [move]) {
  const parts = typeof score === 'number' ? { cp: score, mate: null } : { cp: null, mate: score.mate };
  const value = scoreToCp(parts);
  return { move, pv, ...parts, value, winChance: winChance(value) };
}

function engine({ lines = [], played = null, rating = null, isTopMove = false, equalMoves = [] }) {
  return { lines, best: lines[0] ?? null, played, rating, isTopMove, equalMoves };
}

describe('hanging-piece', () => {
  it('tier 1: a piece that is attacked and not defended at all', () => {
    const findings = detectHangingPieces(SPEC_AFTER_QD2);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'hanging-piece',
      severity: 'major',
      tier: 1,
      square: 'f3',
      piece: 'n',
      color: 'w',
      points: 3,
      defended: false,
      attackers: [{ square: 'g4', piece: 'b' }],
      confirmed: null,
      remedy: null,
    });
    expect(findings[0].capture).toMatchObject({ uci: 'g4f3', san: 'Bxf3', from: 'g4', to: 'f3', piece: 'b', captured: 'n' });
  });

  it('tier 2: a defended piece that still loses material in the exchange', () => {
    const findings = detectHangingPieces('4k3/8/8/4p3/3N4/2P5/8/4K3 b - - 0 1');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ tier: 2, square: 'd4', piece: 'n', points: 2, defended: true, severity: 'major' });
    expect(findings[0].capture.san).toBe('exd4');
  });

  it('rates the size of the loss', () => {
    expect(detectHangingPieces('4k3/8/8/3r4/8/8/8/3QK3 w - - 0 1')[0]).toMatchObject({ piece: 'r', points: 5, severity: 'critical' });
    expect(detectHangingPieces('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1')[0]).toMatchObject({ piece: 'p', points: 1, severity: 'minor' });
  });

  it('does not report an even trade', () => {
    expect(detectHangingPieces('4k3/8/2n5/8/3N4/2P5/8/4K3 b - - 0 1')).toEqual([]);
  });

  it('does not report a piece that took something of the same value and can be taken back', () => {
    const afterNxd5 = '4k3/8/4p3/3N4/8/8/8/4K3 b - - 0 1';
    expect(detectHangingPieces(afterNxd5, { movedTo: 'd5', capturedValue: 3 })).toEqual([]);
    expect(detectHangingPieces(afterNxd5, { movedTo: 'd5', capturedValue: 1 })).toHaveLength(1);
    expect(detectHangingPieces(afterNxd5)).toHaveLength(1);
  });

  it('does not count an attacker that is pinned to its king', () => {
    expect(detectHangingPieces('3k4/3b4/8/1N6/8/8/8/3RK3 b - - 0 1')).toEqual([]);
  });

  it('sees a pawn that can be taken en passant', () => {
    const findings = detectHangingPieces('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ square: 'e4', piece: 'p', points: 1, tier: 1 });
    expect(findings[0].capture).toMatchObject({ from: 'd4', to: 'e3' });
  });

  it('lists the biggest loss first', () => {
    const findings = detectHangingPieces('4k3/8/8/r6N/8/8/8/Q3K3 b - - 0 1');
    expect(findings.map((finding) => finding.piece)).toEqual(['q', 'n']);
  });

  it('finds nothing in a quiet position', () => {
    expect(detectHangingPieces('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toEqual([]);
  });
});

describe('missed-capture', () => {
  const freeKnight = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';
  const queenAndPawn = '4k3/8/8/3q4/8/8/p7/R2RK3 w - - 0 1';

  it('tier 1: a free capture that was not played', () => {
    expect(detectMissedCapture(freeKnight, { from: 'e1', to: 'e2' })).toMatchObject({
      type: 'missed-capture',
      severity: 'major',
      tier: 1,
      piece: 'r',
      square: 'd5',
      targetPiece: 'n',
      points: 3,
      free: true,
      move: { uci: 'd1d5', san: 'Rxd5' },
    });
  });

  it('tier 2: a capture that wins the exchange', () => {
    expect(detectMissedCapture('4k3/8/4p3/3n4/4P3/8/8/4K3 w - - 0 1', { from: 'e1', to: 'e2' })).toMatchObject({ tier: 2, points: 2, free: false, move: { san: 'exd5' } });
  });

  it('reports nothing when the capture was played or a better one was played', () => {
    expect(detectMissedCapture(freeKnight, { from: 'd1', to: 'd5' })).toBeNull();
    expect(detectMissedCapture(queenAndPawn, { from: 'd1', to: 'd5' })).toBeNull();
  });

  it('reports the bigger capture when a smaller one was played', () => {
    expect(detectMissedCapture(queenAndPawn, { from: 'a1', to: 'a2' })).toMatchObject({ points: 9, severity: 'critical', move: { san: 'Rxd5' } });
  });

  it('reports nothing when there is no winning capture', () => {
    expect(detectMissedCapture(START, { from: 'e2', to: 'e4' })).toBeNull();
    expect(detectMissedCapture('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', { from: 'e1', to: 'e2' })).toBeNull();
  });

  it('with engine lines: reports a capture that the engine also likes', () => {
    const context = engine({ lines: [line('d1d5', 400), line('e1e2', 0)], played: line('e1e2', 0), rating: 'blunder' });
    expect(detectMissedCapture(freeKnight, { from: 'e1', to: 'e2' }, context)).toMatchObject({ move: { san: 'Rxd5' } });
  });

  it('with engine lines: stays silent when the engine does not list the capture', () => {
    const context = engine({ lines: [line('e1f2', 50), line('e1e2', 0)], played: line('e1e2', 0), rating: 'inaccuracy' });
    expect(detectMissedCapture(freeKnight, { from: 'e1', to: 'e2' }, context)).toBeNull();
  });

  it('with engine lines: stays silent when the engine shows the capture as clearly bad', () => {
    const context = engine({ lines: [line('e1f2', 50), line('d1d5', -300), line('e1e2', -400)], played: line('e1e2', -400), rating: 'blunder' });
    expect(detectMissedCapture(freeKnight, { from: 'e1', to: 'e2' }, context)).toBeNull();
  });

  it('with engine lines: stays silent when the played move is just as good', () => {
    const top = engine({ lines: [line('e1e2', 410), line('d1d5', 400)], played: line('e1e2', 410), rating: 'best', isTopMove: true });
    expect(detectMissedCapture(freeKnight, { from: 'e1', to: 'e2' }, top)).toBeNull();
    const close = engine({ lines: [line('e1f2', 450), line('d1d5', 400), line('e1e2', 390)], played: line('e1e2', 390), rating: 'good' });
    expect(detectMissedCapture(freeKnight, { from: 'e1', to: 'e2' }, close)).toBeNull();
  });

  it('throws for a played move that is not legal', () => {
    expect(() => detectMissedCapture(freeKnight, { from: 'e1', to: 'e5' })).toThrow(/not legal/);
  });
});

describe('won-material', () => {
  it('tier 1: the player took a free piece', () => {
    expect(detectWonMaterial('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', { from: 'd1', to: 'd5' })).toMatchObject({
      type: 'won-material',
      severity: 'good',
      tier: 1,
      square: 'd5',
      targetPiece: 'n',
      points: 3,
      free: true,
    });
  });

  it('tier 2: the player won an exchange', () => {
    expect(detectWonMaterial('4k3/8/4p3/3n4/4P3/8/8/4K3 w - - 0 1', { from: 'e4', to: 'd5' })).toMatchObject({ tier: 2, points: 2, free: false });
  });

  it('reports nothing for a losing capture, an even trade or a quiet move', () => {
    expect(detectWonMaterial('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1', { from: 'd1', to: 'd5' })).toBeNull();
    expect(detectWonMaterial('4k3/8/4p3/3n4/8/2N5/8/4K3 w - - 0 1', { from: 'c3', to: 'd5' })).toBeNull();
    expect(detectWonMaterial(START, { from: 'e2', to: 'e4' })).toBeNull();
  });
});

describe('mate in one', () => {
  const backRank = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
  const backRankBlack = '6k1/5ppp/8/8/8/8/8/R3K3 b - - 0 1';
  const forced = '7k/8/6K1/8/8/8/8/R7 b - - 0 1';

  it('finds the mating move', () => {
    expect(findMateInOne(backRank)).toMatchObject({ uci: 'a1a8', san: 'Ra8#', piece: 'r' });
    expect(findMateInOne(START)).toBeNull();
  });

  it('missed-mate-in-1: tier 1', () => {
    expect(detectMissedMateInOne(backRank, { from: 'e1', to: 'e2' })).toMatchObject({
      type: 'missed-mate-in-1',
      severity: 'critical',
      tier: 1,
      piece: 'r',
      kingSquare: 'g8',
      move: { san: 'Ra8#' },
    });
    expect(detectMissedMateInOne(backRank, { from: 'a1', to: 'a8' })).toBeNull();
    expect(detectMissedMateInOne(START, { from: 'e2', to: 'e4' })).toBeNull();
  });

  it('allowed-mate-in-1: tier 1', () => {
    expect(detectAllowedMateInOne(backRankBlack, { from: 'g8', to: 'h8' })).toMatchObject({
      type: 'allowed-mate-in-1',
      severity: 'critical',
      tier: 1,
      piece: 'r',
      kingSquare: 'h8',
      move: { san: 'Ra8#' },
    });
    expect(detectAllowedMateInOne(backRankBlack, { from: 'h7', to: 'h6' })).toBeNull();
  });

  it('allowed-mate-in-1 is not reported when every move allows it', () => {
    expect(detectAllowedMateInOne(forced, { from: 'h8', to: 'g8' })).toBeNull();
    expect(detectAllowedMateInOne(forced, { from: 'h8', to: 'g8' }, engine({ lines: [line('h8g8', { mate: -1 })] }))).toBeNull();
  });

  it('allowed-mate-in-1 trusts the engine about a way out', () => {
    const context = engine({ lines: [line('h7h6', -50)] });
    expect(detectAllowedMateInOne(backRankBlack, { from: 'g8', to: 'h8' }, context)).not.toBeNull();
  });
});

describe('longer mates from the engine', () => {
  const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
  const move = { from: 'e1', to: 'e2' };

  it('missed-mate: tier 2, with the number of moves', () => {
    const context = engine({ lines: [line('a1a7', { mate: 3 })], played: line('e1e2', 200) });
    expect(detectEngineMates(fen, move, context)).toEqual([expect.objectContaining({ type: 'missed-mate', severity: 'major', tier: 2, mateIn: 3, move: expect.objectContaining({ san: 'Ra7' }) })]);
  });

  it('missed-mate is minor when the player is still winning easily', () => {
    const context = engine({ lines: [line('a1a7', { mate: 3 })], played: line('e1e2', 900) });
    expect(detectEngineMates(fen, move, context)[0].severity).toBe('minor');
  });

  it('a slower mate is not a missed mate', () => {
    const context = engine({ lines: [line('a1a7', { mate: 3 })], played: line('e1e2', { mate: 5 }) });
    expect(detectEngineMates(fen, move, context)).toEqual([]);
  });

  it('allowed-mate: tier 2, with the opponent\'s first move', () => {
    const context = engine({ lines: [line('a1a7', 30)], played: line('e1e2', { mate: -3 }, ['e1e2', 'g8f8']) });
    expect(detectEngineMates(fen, move, context)).toEqual([expect.objectContaining({ type: 'allowed-mate', severity: 'critical', tier: 2, mateIn: 3, move: expect.objectContaining({ san: 'Kf8' }) })]);
  });

  it('allowed-mate keeps working when the engine line has no reply', () => {
    const context = engine({ lines: [line('a1a7', 30)], played: line('e1e2', { mate: -3 }) });
    expect(detectEngineMates(fen, move, context)).toEqual([expect.objectContaining({ type: 'allowed-mate', mateIn: 3, move: null })]);
  });

  it('no allowed-mate when the best move was also mated', () => {
    const context = engine({ lines: [line('a1a7', { mate: -5 })], played: line('e1e2', { mate: -3 }) });
    expect(detectEngineMates(fen, move, context)).toEqual([]);
  });

  it('leaves mates in one to the static detectors and needs both lines', () => {
    expect(detectEngineMates(fen, move, engine({ lines: [line('a1a8', { mate: 1 })], played: line('e1e2', 200) }))).toEqual([]);
    expect(detectEngineMates(fen, move, engine({ lines: [line('a1a7', 30)], played: line('e1e2', { mate: -1 }) }))).toEqual([]);
    expect(detectEngineMates(fen, move, engine({ lines: [line('a1a7', { mate: 3 })] }))).toEqual([]);
    expect(detectEngineMates(fen, move, null)).toEqual([]);
  });
});

describe('forks, pins and skewers', () => {
  it('fork: a knight attacks king and rook', () => {
    expect(detectTactic('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7')).toMatchObject({
      kind: 'fork',
      piece: 'n',
      square: 'c7',
      targets: [
        { square: 'e8', piece: 'k' },
        { square: 'a8', piece: 'r' },
      ],
      move: { san: 'Nc7+', from: 'b5', to: 'c7' },
    });
  });

  it('no fork when the forking piece can simply be taken', () => {
    expect(detectTactic('r2qk3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'b5c7')).toBeNull();
  });

  it('fork: a defended pawn attacks two pieces', () => {
    expect(detectTactic('4k3/8/3b1n2/8/3PP3/8/8/4K3 w - - 0 1', 'e4e5')).toMatchObject({ kind: 'fork', piece: 'p', square: 'e5' });
    // Without the pawn on d4 the bishop just takes the pawn.
    expect(detectTactic('4k3/8/3b1n2/8/4P3/8/8/4K3 w - - 0 1', 'e4e5')).toBeNull();
  });

  it('no fork when the second piece is defended and not worth more', () => {
    expect(detectTactic('4k3/3p4/2b5/8/3N4/8/8/4K3 w - - 0 1', 'd4e6')).toBeNull();
  });

  it('pin to the king', () => {
    expect(detectTactic('4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', 'f1b5')).toMatchObject({
      kind: 'pin',
      absolute: true,
      attacker: { square: 'b5', piece: 'b' },
      pinned: { square: 'c6', piece: 'n' },
      behind: { square: 'e8', piece: 'k' },
    });
  });

  it('pin to a more valuable piece', () => {
    expect(detectTactic('3qk3/8/5n2/8/8/8/8/2B1K3 w - - 0 1', 'c1g5')).toMatchObject({
      kind: 'pin',
      absolute: false,
      pinned: { square: 'f6', piece: 'n' },
      behind: { square: 'd8', piece: 'q' },
    });
  });

  it('pin that appears when another piece moves off the line', () => {
    expect(detectTactic('4k3/8/4n3/8/8/4N3/8/4R1K1 w - - 0 1', 'e3c4')).toMatchObject({ kind: 'pin', attacker: { square: 'e1', piece: 'r' }, pinned: { square: 'e6' }, move: { uci: 'e3c4' } });
  });

  it('no pin when the "pinned" piece can take the attacker', () => {
    expect(detectTactic('4k3/3b4/8/8/8/8/8/4KB2 w - - 0 1', 'f1b5')).toBeNull();
  });

  it('a pin that was already there is not new', () => {
    expect(detectTactic('4k3/8/2n5/1B6/8/8/8/4K3 w - - 0 1', 'e1e2')).toBeNull();
  });

  it('skewer: a check with a queen behind the king', () => {
    expect(detectTactic('4q3/8/8/8/4k3/8/8/K6R w - - 0 1', 'h1e1')).toMatchObject({
      kind: 'skewer',
      attacker: { square: 'e1', piece: 'r' },
      front: { square: 'e4', piece: 'k' },
      behind: { square: 'e8', piece: 'q' },
    });
  });

  it('skewer: a bishop attacks a queen with a rook behind it', () => {
    expect(detectTactic('7k/6r1/8/4q3/8/8/8/K1B5 w - - 0 1', 'c1b2')).toMatchObject({
      kind: 'skewer',
      attacker: { square: 'b2', piece: 'b' },
      front: { square: 'e5', piece: 'q' },
      behind: { square: 'g7', piece: 'r' },
    });
  });

  it('returns null for a quiet move, an illegal move and a mating move', () => {
    expect(detectTactic(START, 'e2e4')).toBeNull();
    expect(detectTactic(START, 'e2e5')).toBeNull();
    expect(detectTactic(START, 'junk')).toBeNull();
    expect(detectTactic('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8')).toBeNull();
  });
});

describe('opening-principle', () => {
  it('moving the queen out very early', () => {
    expect(detectOpeningPrinciple('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', { from: 'd1', to: 'h5' })).toMatchObject({
      type: 'opening-principle',
      severity: 'minor',
      tier: 2,
      principle: 'early-queen',
      piece: 'q',
      square: 'h5',
    });
  });

  it('moving the same piece twice', () => {
    expect(detectOpeningPrinciple('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', { from: 'f3', to: 'g5' })).toMatchObject({ principle: 'same-piece-twice' });
  });

  it('an edge pawn move', () => {
    expect(detectOpeningPrinciple(START, { from: 'a2', to: 'a4' })).toMatchObject({ principle: 'edge-pawn' });
    expect(detectOpeningPrinciple(START, { from: 'h2', to: 'h3' })).toMatchObject({ principle: 'edge-pawn' });
  });

  it('a king move that gives up castling', () => {
    expect(detectOpeningPrinciple('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', { from: 'e1', to: 'e2' })).toMatchObject({ principle: 'king-move' });
  });

  it('a move that does not develop', () => {
    expect(detectOpeningPrinciple(START, { from: 'g2', to: 'g4' })).toMatchObject({ principle: 'no-development' });
    expect(detectOpeningPrinciple('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', { from: 'f2', to: 'f3' })).toMatchObject({ principle: 'no-development' });
  });

  it('says nothing about normal opening moves', () => {
    expect(detectOpeningPrinciple(START, { from: 'e2', to: 'e4' })).toBeNull();
    expect(detectOpeningPrinciple(START, { from: 'g1', to: 'f3' })).toBeNull();
    expect(detectOpeningPrinciple('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', { from: 'e1', to: 'g1' })).toBeNull();
    expect(detectOpeningPrinciple('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', { from: 'e4', to: 'd5' })).toBeNull();
  });

  it('says nothing after the opening', () => {
    expect(detectOpeningPrinciple('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 13', { from: 'a2', to: 'a4' })).toBeNull();
  });

  it('says nothing about a move made in check', () => {
    expect(detectOpeningPrinciple('rnb1kbnr/pppp1ppp/8/4p3/4P2q/5P2/PPPP2PP/RNBQKBNR w KQkq - 1 3', { from: 'e1', to: 'e2' })).toBeNull();
  });
});

describe('caused-stalemate', () => {
  it('is a problem when the player was far ahead', () => {
    expect(detectStalemate('7k/8/5QK1/8/8/8/8/8 w - - 0 1', { from: 'f6', to: 'f7' })).toEqual({ type: 'caused-stalemate', severity: 'major', tier: 1, materialLead: 9 });
  });

  it('is only a note when the player was not ahead', () => {
    expect(detectStalemate('8/8/8/8/8/4k3/5p2/5K2 b - - 0 1', { from: 'e3', to: 'f3' })).toMatchObject({ severity: 'info', materialLead: 1 });
  });

  it('reports nothing when the game goes on', () => {
    expect(detectStalemate(START, { from: 'e2', to: 'e4' })).toBeNull();
  });
});

describe('detectFindings: the full pipeline', () => {
  it('a checkmate is the only finding', () => {
    const findings = detectFindings({ fenBefore: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', move: { from: 'a1', to: 'a8' } });
    expect(findings).toEqual([expect.objectContaining({ type: 'delivered-checkmate', severity: 'good', tier: 1 })]);
  });

  it('works without any engine input', () => {
    const findings = detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' } });
    expect(findings.map((finding) => finding.type)).toEqual(['hanging-piece']);
    expect(findings[0].confirmed).toBeNull();
  });

  it('marks a hanging piece as confirmed when the engine takes it', () => {
    const context = engine({ lines: [line('b1d2', -100)], played: line('d1d2', -180, ['d1d2', 'g4f3']), rating: 'inaccuracy' });
    const [finding] = detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, engine: context });
    expect(finding).toMatchObject({ type: 'hanging-piece', confirmed: true, moved: false });
  });

  it('remedy: the best move would have protected a piece that was already in danger', () => {
    const context = engine({ lines: [line('b1d2', -100)], played: line('a2a3', -180, ['a2a3', 'g4f3']), rating: 'inaccuracy' });
    const [finding] = detectFindings({ fenBefore: LOOSE_KNIGHT, move: { from: 'a2', to: 'a3' }, engine: context });
    expect(finding).toMatchObject({ type: 'hanging-piece', square: 'f3', confirmed: true, remedy: 'protect' });
  });

  it('remedy: nothing is said when the played move itself took the protection away', () => {
    // The queen on d1 defended the knight. Qd2 leaves it alone. The best move did not "protect" the knight, it only did not harm it.
    const context = engine({ lines: [line('b1d2', -100)], played: line('d1d2', -180, ['d1d2', 'g4f3']), rating: 'inaccuracy' });
    const [finding] = detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, engine: context });
    expect(finding).toMatchObject({ type: 'hanging-piece', square: 'f3', remedy: null });
  });

  it('remedy: the best move would have taken the attacker', () => {
    // The pawn on e6 attacks the knight on d5, and the rook on e1 can take that pawn.
    const fen = '6k1/8/4p3/3N4/8/8/8/K3R3 w - - 0 1';
    const context = engine({ lines: [line('e1e6', 500)], played: line('a1b1', 0, ['a1b1', 'e6d5']), rating: 'blunder' });
    const findings = detectFindings({ fenBefore: fen, move: { from: 'a1', to: 'b1' }, engine: context });
    expect(findings.map((finding) => finding.type)).toEqual(['hanging-piece', 'missed-capture']);
    expect(findings[0]).toMatchObject({ square: 'd5', remedy: 'capture-attacker', confirmed: true });
  });

  it('a pawn that is pinned to its king does not attack anything', () => {
    // The same position with the black king on e8. Now the rook pins the pawn on e6, so the knight on d5 is safe.
    const fen = '4k3/8/4p3/3N4/8/8/8/K3R3 w - - 0 1';
    const findings = detectFindings({ fenBefore: fen, move: { from: 'a1', to: 'b1' } });
    expect(findings.map((finding) => finding.type)).toEqual(['missed-capture']);
  });

  it('marks a hanging piece as not confirmed when the engine replies with another move', () => {
    const context = engine({ lines: [line('b1d2', -100)], played: line('d1d2', -180, ['d1d2', 'f8e7']), rating: 'inaccuracy' });
    const [finding] = detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, engine: context });
    expect(finding).toMatchObject({ type: 'hanging-piece', confirmed: false });
  });

  it('puts a tactic from the engine reply before a hanging piece that the engine does not take', () => {
    // After Qd2 the engine does not take on f3. It plays Bb4, which pins the queen to the king.
    const context = engine({ lines: [line('b1d2', -100)], played: line('d1d2', -400, ['d1d2', 'f8b4']), rating: 'blunder' });
    const findings = detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, engine: context });
    expect(findings.map((finding) => finding.type)).toEqual(['allowed-pin', 'hanging-piece']);
    expect(findings[0]).toMatchObject({ absolute: true, pinned: { square: 'd2', piece: 'q' }, behind: { square: 'e1', piece: 'k' } });
    expect(findings[1].confirmed).toBe(false);
  });

  it('drops a hanging piece when the engine likes the move', () => {
    const context = engine({ lines: [line('d1d2', 30)], played: line('d1d2', 30, ['d1d2', 'g4f3']), rating: 'best', isTopMove: true });
    const findings = detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, engine: context });
    expect(findings.map((finding) => finding.type)).toEqual(['top-move']);
  });

  it('drops an unconfirmed hanging piece when the move is rated good', () => {
    const unconfirmed = engine({ lines: [line('b1d2', 1200)], played: line('d1d2', 900, ['d1d2', 'f8b4']), rating: 'good' });
    expect(detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, engine: unconfirmed })).toEqual([]);
    const confirmed = engine({ lines: [line('b1d2', 1200)], played: line('d1d2', 900, ['d1d2', 'g4f3']), rating: 'good' });
    expect(detectFindings({ fenBefore: SPEC, move: { from: 'd1', to: 'd2' }, engine: confirmed }).map((finding) => finding.type)).toEqual(['hanging-piece']);
  });

  it('remedy: the best move would have moved the piece away', () => {
    // The knight on d5 is attacked by the pawn on e6 and nothing defends it. The best move takes it out of danger.
    const fen = '4k3/8/4p3/3N4/8/8/8/4K3 w - - 0 1';
    const context = engine({ lines: [line('d5f4', 300)], played: line('e1e2', -50, ['e1e2', 'e6d5']), rating: 'blunder' });
    const [finding] = detectFindings({ fenBefore: fen, move: { from: 'e1', to: 'e2' }, engine: context });
    expect(finding).toMatchObject({ type: 'hanging-piece', square: 'd5', remedy: 'retreat', confirmed: true });
  });

  it('allowed-fork: the opponent\'s best reply is a fork', () => {
    const fen = 'r3k3/7p/8/1N6/8/8/8/4K3 b - - 0 1';
    const context = engine({ lines: [line('a8d8', 0)], played: line('h7h6', -400, ['h7h6', 'b5c7', 'e8d7', 'c7a8']), rating: 'blunder' });
    const findings = detectFindings({ fenBefore: fen, move: { from: 'h7', to: 'h6' }, engine: context });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'allowed-fork', severity: 'major', tier: 2, piece: 'n', square: 'c7', move: { san: 'Nc7+' } });
    expect(findings[0].targets.map((target) => target.piece)).toEqual(['k', 'r']);
  });

  it('missed-fork: the engine\'s best move is a fork', () => {
    const fen = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
    const context = engine({ lines: [line('b5c7', 500, ['b5c7', 'e8d7', 'c7a8'])], played: line('e1e2', 0), rating: 'blunder' });
    const findings = detectFindings({ fenBefore: fen, move: { from: 'e1', to: 'e2' }, engine: context });
    expect(findings.map((finding) => finding.type)).toEqual(['missed-fork']);
    expect(findings[0]).toMatchObject({ tier: 2, move: { san: 'Nc7+' } });
  });

  it('allowed-pin and allowed-skewer come from the opponent\'s best reply', () => {
    const pinFen = '4k3/7p/2n5/8/8/8/8/4KB2 b - - 0 1';
    const pin = engine({ lines: [line('c6e5', 0)], played: line('h7h6', -150, ['h7h6', 'f1b5']), rating: 'mistake' });
    expect(detectFindings({ fenBefore: pinFen, move: { from: 'h7', to: 'h6' }, engine: pin }).map((finding) => finding.type)).toEqual(['allowed-pin']);
    const skewerFen = '4q3/p7/8/8/4k3/8/8/K6R b - - 0 1';
    const skewer = engine({ lines: [line('e4d5', 0)], played: line('a7a6', -600, ['a7a6', 'h1e1']), rating: 'blunder' });
    expect(detectFindings({ fenBefore: skewerFen, move: { from: 'a7', to: 'a6' }, engine: skewer }).map((finding) => finding.type)).toEqual(['allowed-skewer']);
  });

  it('missed-pin and missed-skewer come from the engine\'s best move', () => {
    const pin = engine({ lines: [line('f1b5', 200)], played: line('e1e2', 0), rating: 'mistake' });
    expect(detectFindings({ fenBefore: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', move: { from: 'e1', to: 'e2' }, engine: pin }).map((finding) => finding.type)).toEqual(['missed-pin']);
    const skewer = engine({ lines: [line('h1e1', 600)], played: line('a1b1', 0), rating: 'blunder' });
    expect(detectFindings({ fenBefore: '4q3/8/8/8/4k3/8/8/K6R w - - 0 1', move: { from: 'a1', to: 'b1' }, engine: skewer }).map((finding) => finding.type)).toEqual(['missed-skewer']);
  });

  it('does not name tactics for a move that is not weak', () => {
    const fen = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
    const context = engine({ lines: [line('b5c7', 500)], played: line('e1e2', 480), rating: 'good' });
    expect(detectFindings({ fenBefore: fen, move: { from: 'e1', to: 'e2' }, engine: context })).toEqual([]);
  });

  it('opening-principle: only for a weak move that nothing else explains', () => {
    const weak = engine({ lines: [line('e2e4', 30)], played: line('a2a4', -40), rating: 'inaccuracy' });
    expect(detectFindings({ fenBefore: START, move: { from: 'a2', to: 'a4' }, engine: weak })).toEqual([expect.objectContaining({ type: 'opening-principle', principle: 'edge-pawn', tier: 2 })]);
    const fine = engine({ lines: [line('e2e4', 30)], played: line('a2a4', 0), rating: 'good' });
    expect(detectFindings({ fenBefore: START, move: { from: 'a2', to: 'a4' }, engine: fine })).toEqual([]);
    expect(detectFindings({ fenBefore: START, move: { from: 'a2', to: 'a4' } })).toEqual([]);
  });

  it('opening-principle gives way to a tactical finding', () => {
    // Qh5 is early, and here it also leaves the queen where the knight can take it.
    const fen = 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 2 3';
    const context = engine({ lines: [line('b1c3', 20)], played: line('d1h5', -800, ['d1h5', 'f6h5']), rating: 'blunder' });
    const findings = detectFindings({ fenBefore: fen, move: { from: 'd1', to: 'h5' }, engine: context });
    expect(findings[0]).toMatchObject({ type: 'hanging-piece', piece: 'q', square: 'h5', confirmed: true, moved: true });
    expect(findings.map((finding) => finding.type)).not.toContain('opening-principle');
  });

  it('top-move and won-material are positive findings', () => {
    const context = engine({ lines: [line('d1d5', 400), line('e1e2', 0)], played: line('d1d5', 400), rating: 'best', isTopMove: true, equalMoves: ['Kf2'] });
    const findings = detectFindings({ fenBefore: '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', move: { from: 'd1', to: 'd5' }, engine: context });
    expect(findings.map((finding) => finding.type)).toEqual(['won-material', 'top-move']);
    expect(findings[1]).toMatchObject({ severity: 'good', tier: 1, equalMoves: ['Kf2'] });
    expect(findings.some(isNegativeFinding)).toBe(false);
  });

  it('does not praise a capture that the engine calls weak', () => {
    const context = engine({ lines: [line('e1e2', 100)], played: line('d1d5', -300), rating: 'blunder' });
    const findings = detectFindings({ fenBefore: '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', move: { from: 'd1', to: 'd5' }, engine: context });
    expect(findings.map((finding) => finding.type)).not.toContain('won-material');
  });

  it('stalemate ends the search, but a missed mate in one is still told', () => {
    // Qf7 is stalemate. Qf8 was checkmate.
    const findings = detectFindings({ fenBefore: '7k/8/5QK1/8/8/8/8/8 w - - 0 1', move: { from: 'f6', to: 'f7' } });
    expect(findings.map((finding) => finding.type)).toEqual(['missed-mate-in-1', 'caused-stalemate']);
  });

  it('a mate in one hides the longer mate finding of the same kind', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K3 b - - 0 1';
    const context = engine({ lines: [line('h7h6', -50)], played: line('g8h8', { mate: -1 }, ['g8h8', 'a1a8']), rating: 'blunder' });
    const findings = detectFindings({ fenBefore: fen, move: { from: 'g8', to: 'h8' }, engine: context });
    expect(findings.map((finding) => finding.type)).toEqual(['allowed-mate-in-1']);
  });

  it('throws for a played move that is not legal', () => {
    expect(() => detectFindings({ fenBefore: START, move: { from: 'e2', to: 'e5' } })).toThrow(/not legal/);
    expect(() => detectFindings({ fenBefore: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1', move: { from: 'e7', to: 'e8' } })).toThrow(/promotion/);
  });
});

describe('sortFindings', () => {
  it('puts problems first, the engine-confirmed and the more serious ones before the rest', () => {
    const sorted = sortFindings([
      { type: 'top-move', severity: 'good', tier: 1 },
      { type: 'hanging-piece', severity: 'critical', tier: 1, confirmed: false, points: 9 },
      { type: 'caused-stalemate', severity: 'info', tier: 1 },
      { type: 'allowed-fork', severity: 'major', tier: 2 },
      { type: 'hanging-piece', severity: 'major', tier: 1, confirmed: true, points: 3 },
      { type: 'missed-capture', severity: 'major', tier: 1, points: 3 },
      { type: 'allowed-mate-in-1', severity: 'critical', tier: 1 },
      { type: 'won-material', severity: 'good', tier: 1, points: 1 },
    ]);
    expect(sorted.map((finding) => `${finding.type}${finding.confirmed === false ? '?' : ''}`)).toEqual([
      'allowed-mate-in-1',
      'hanging-piece',
      'allowed-fork',
      'missed-capture',
      'hanging-piece?',
      'won-material',
      'top-move',
      'caused-stalemate',
    ]);
  });
});
