// Board helpers for the coach, built on chess.js: squares and UCI moves, attackers and defenders, exchange math (SEE) and material counts. Pure logic, no DOM.
import { Chess } from 'chess.js';
import { KING_EXCHANGE_VALUE, PIECE_VALUES } from './constants.js';

const FILES = 'abcdefgh';
const SQUARE_PATTERN = /^[a-h][1-8]$/;
const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

/** Steps of a knight as [file, rank] offsets. */
export const KNIGHT_STEPS = Object.freeze([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]);
/** The four diagonal directions as [file, rank] offsets. */
export const DIAGONAL_STEPS = Object.freeze([[1, 1], [1, -1], [-1, -1], [-1, 1]]);
/** The four straight directions as [file, rank] offsets. */
export const STRAIGHT_STEPS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
/** All eight directions as [file, rank] offsets. */
export const ALL_STEPS = Object.freeze([...STRAIGHT_STEPS, ...DIAGONAL_STEPS]);

/**
 * A short, plain description of a move. Findings and reports use this shape so that the presenter never needs chess.js.
 * @typedef {Object} MoveRef
 * @property {string} uci The move in UCI form, for example "g4f3" or "e7e8q".
 * @property {string} san The move in standard notation, for example "Bxf3".
 * @property {string} from
 * @property {string} to
 * @property {string} piece Type of the moving piece: p, n, b, r, q or k.
 * @property {string|null} captured Type of the captured piece, or null.
 * @property {string|null} promotion Type of the new piece when a pawn promotes, or null.
 */

/**
 * The result of looking at one capture.
 * @typedef {Object} CaptureResult
 * @property {import('chess.js').Move} move The capture as a chess.js move.
 * @property {number} gain Points the capturing side wins after the whole exchange on that square. It can be negative.
 * @property {boolean} canRecapture True when the other side has a legal capture back on the same square.
 * @property {string} victimSquare Square of the captured piece. It differs from `move.to` only for en passant.
 * @property {string} victim Type of the captured piece.
 */

/**
 * True when the value is a square name such as "e4".
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSquare(value) {
  return typeof value === 'string' && SQUARE_PATTERN.test(value);
}

/**
 * The other side.
 * @param {'w'|'b'} color
 * @returns {'w'|'b'}
 */
export function otherColor(color) {
  return color === 'w' ? 'b' : 'w';
}

/**
 * Point value of a piece type. The king and unknown types are worth 0.
 * @param {string} type
 * @returns {number}
 */
export function pieceValue(type) {
  return PIECE_VALUES[type] ?? 0;
}

/**
 * Turn a square name into numbers. File a is 0 and rank 1 is 0.
 * @param {string} square
 * @returns {{ file: number, rank: number }}
 */
export function squareToCoords(square) {
  return { file: FILES.indexOf(square[0]), rank: Number(square[1]) - 1 };
}

/**
 * Turn numbers back into a square name.
 * @param {number} file 0 to 7.
 * @param {number} rank 0 to 7.
 * @returns {string|null} null when the place is off the board.
 */
export function coordsToSquare(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return FILES[file] + String(rank + 1);
}

/**
 * The squares strictly between two squares that share a rank, a file or a diagonal.
 * @param {string} a
 * @param {string} b
 * @returns {string[]|null} The squares in order from `a` to `b`, or null when the two squares are not on one line.
 */
export function squaresBetween(a, b) {
  const from = squareToCoords(a);
  const to = squareToCoords(b);
  const df = to.file - from.file;
  const dr = to.rank - from.rank;
  if (df === 0 && dr === 0) return null;
  if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return null;
  const stepFile = Math.sign(df);
  const stepRank = Math.sign(dr);
  const squares = [];
  let file = from.file + stepFile;
  let rank = from.rank + stepRank;
  while (file !== to.file || rank !== to.rank) {
    squares.push(coordsToSquare(file, rank));
    file += stepFile;
    rank += stepRank;
  }
  return squares;
}

/**
 * All pieces that stand on one ray from a square, nearest first. The piece on the start square is not part of the result.
 * @param {Chess} chess
 * @param {string} square
 * @param {readonly number[]} step One direction as [file, rank].
 * @returns {{ square: string, type: string, color: 'w'|'b' }[]}
 */
export function piecesOnRay(chess, square, step) {
  const start = squareToCoords(square);
  const found = [];
  for (let i = 1; i < 8; i++) {
    const next = coordsToSquare(start.file + step[0] * i, start.rank + step[1] * i);
    if (!next) break;
    const piece = chess.get(next);
    if (piece) found.push({ square: next, type: piece.type, color: piece.color });
  }
  return found;
}

/**
 * The squares that the piece on a square attacks. A sliding piece attacks up to and including the first piece in its way. A pawn attacks its two diagonal squares, also when they are empty.
 * @param {Chess} chess
 * @param {string} square
 * @returns {string[]} Empty when the square has no piece.
 */
export function attackedSquares(chess, square) {
  const piece = chess.get(square);
  if (!piece) return [];
  const { file, rank } = squareToCoords(square);
  const out = [];
  const leap = (steps) => {
    for (const [df, dr] of steps) {
      const target = coordsToSquare(file + df, rank + dr);
      if (target) out.push(target);
    }
  };
  const slide = (steps) => {
    for (const [df, dr] of steps) {
      for (let i = 1; i < 8; i++) {
        const target = coordsToSquare(file + df * i, rank + dr * i);
        if (!target) break;
        out.push(target);
        if (chess.get(target)) break;
      }
    }
  };
  if (piece.type === 'p') leap(piece.color === 'w' ? [[-1, 1], [1, 1]] : [[-1, -1], [1, -1]]);
  else if (piece.type === 'n') leap(KNIGHT_STEPS);
  else if (piece.type === 'k') leap(ALL_STEPS);
  else if (piece.type === 'b') slide(DIAGONAL_STEPS);
  else if (piece.type === 'r') slide(STRAIGHT_STEPS);
  else if (piece.type === 'q') slide(ALL_STEPS);
  return out;
}

/**
 * The pieces of one side that attack a square. A pinned piece still counts, because it still controls the square. When the square holds a piece of that same side, the result is the defenders of that piece.
 * @param {Chess} chess
 * @param {string} square
 * @param {'w'|'b'} color The side whose pieces are counted.
 * @returns {{ square: string, type: string }[]} Cheapest piece first, the king last.
 */
export function attackersOf(chess, square, color) {
  return chess
    .attackers(square, color)
    .map((from) => ({ square: from, type: chess.get(from).type }))
    .sort((a, b) => exchangeValue(a.type) - exchangeValue(b.type));
}

/**
 * The pieces that defend the piece on a square, which means the pieces of its own side that could capture back there.
 * @param {Chess} chess
 * @param {string} square
 * @returns {{ square: string, type: string }[]} Empty when the square is empty or nothing defends it.
 */
export function defendersOf(chess, square) {
  const piece = chess.get(square);
  if (!piece) return [];
  return attackersOf(chess, square, piece.color);
}

/**
 * Split a UCI move such as "e2e4" or "e7e8q" into its parts.
 * @param {unknown} uci
 * @returns {{ from: string, to: string, promotion?: string }|null} null when the text is not a UCI move.
 */
export function parseUci(uci) {
  if (typeof uci !== 'string') return null;
  const match = UCI_PATTERN.exec(uci.trim().toLowerCase());
  if (!match) return null;
  const parsed = { from: match[1], to: match[2] };
  if (match[3]) parsed.promotion = match[3];
  return parsed;
}

/**
 * Build the UCI text of a move.
 * @param {{ from: string, to: string, promotion?: string|null }} move
 * @returns {string}
 */
export function toUci(move) {
  return move.from + move.to + (move.promotion ?? '');
}

/**
 * Describe a chess.js move as a plain object.
 * @param {import('chess.js').Move} move
 * @returns {MoveRef}
 */
export function moveRef(move) {
  return {
    uci: toUci(move),
    san: move.san,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured ?? null,
    promotion: move.promotion ?? null,
  };
}

/**
 * Play a move on the board without throwing. The caller must call `chess.undo()` to take it back.
 * @param {Chess} chess
 * @param {string|{ from: string, to: string, promotion?: string }|null} move A SAN text or a move object.
 * @returns {import('chess.js').Move|null} null when the move is not legal. The board is unchanged in that case.
 */
export function tryMove(chess, move) {
  if (move == null) return null;
  try {
    return chess.move(move);
  } catch {
    // chess.js throws for an illegal move. For the coach an illegal move is a normal answer, not an error.
    return null;
  }
}

/**
 * Look up a UCI move in a position.
 * @param {string} fen
 * @param {string} uci
 * @returns {import('chess.js').Move|null} The full chess.js move, or null when the text is not a legal move there.
 */
export function uciToMove(fen, uci) {
  const chess = new Chess(fen);
  return tryMove(chess, parseUci(uci));
}

/**
 * Turn a UCI move into standard notation.
 * @param {string} fen
 * @param {string} uci
 * @returns {string|null} For example "Nbd2", or null when the move is not legal there.
 */
export function uciToSan(fen, uci) {
  return uciToMove(fen, uci)?.san ?? null;
}

/**
 * Play a line of UCI moves from a position. It stops at the first move that is not legal, so a broken or cut engine line gives a shorter result and never an error.
 * @param {string} fen
 * @param {unknown} uciMoves The line. Anything that is not an array counts as an empty line.
 * @param {number} [maxPlies] Stop after this many moves.
 * @returns {{ moves: import('chess.js').Move[], fen: string, complete: boolean }} The moves that were played, the position after them, and `complete: false` when the line was cut at an illegal move.
 */
export function playUciLine(fen, uciMoves, maxPlies = Infinity) {
  const chess = new Chess(fen);
  const moves = [];
  let complete = Array.isArray(uciMoves);
  for (const uci of Array.isArray(uciMoves) ? uciMoves : []) {
    if (moves.length >= maxPlies) break;
    const made = tryMove(chess, parseUci(uci));
    if (!made) {
      complete = false;
      break;
    }
    moves.push(made);
  }
  return { moves, fen: chess.fen(), complete };
}

/**
 * Turn a line of UCI moves into standard notation. An illegal move ends the line.
 * @param {string} fen
 * @param {unknown} uciMoves
 * @param {number} [maxPlies]
 * @returns {string[]}
 */
export function uciLineToSan(fen, uciMoves, maxPlies = Infinity) {
  return playUciLine(fen, uciMoves, maxPlies).moves.map((move) => move.san);
}

/**
 * Write a line with move numbers, the way chess books do: "9...Bxf3 10.gxf3 Qd5".
 * @param {string[]} sanMoves
 * @param {number} moveNumber Move number of the first move.
 * @param {'w'|'b'} color Side that plays the first move.
 * @returns {string}
 */
export function formatNumberedLine(sanMoves, moveNumber, color) {
  const parts = [];
  let number = moveNumber;
  let side = color;
  sanMoves.forEach((san, index) => {
    if (side === 'w') parts.push(`${number}.${san}`);
    else parts.push(index === 0 ? `${number}...${san}` : san);
    if (side === 'b') number += 1;
    side = otherColor(side);
  });
  return parts.join(' ');
}

/**
 * Value of a piece type for choosing who captures first in an exchange. It is the point value, but the king gets a very high value so that it always captures last.
 * @param {string} type
 * @returns {number}
 */
export function exchangeValue(type) {
  return type === 'k' ? KING_EXCHANGE_VALUE : pieceValue(type);
}

function captureInput(chess, from, to) {
  const piece = chess.get(from);
  const lastRank = to[1] === '8' || to[1] === '1';
  // A pawn that captures onto the last rank must promote. The queen is the only choice that matters for exchange math.
  return piece && piece.type === 'p' && lastRank ? { from, to, promotion: 'q' } : { from, to };
}

function captureValue(move) {
  const promotionBonus = move.promotion ? pieceValue(move.promotion) - pieceValue('p') : 0;
  return pieceValue(move.captured) + promotionBonus;
}

function victimSquareOf(move) {
  return move.isEnPassant() ? move.to[0] + move.from[1] : move.to;
}

// The exchange on one square for the side to move. Every capture is a real legal move, so pinned pieces and a king that can not capture a defended piece are handled by the rules themselves. The cheapest legal attacker captures first, which is the usual SEE order.
function exchange(chess, square) {
  const target = chess.get(square);
  const mover = chess.turn();
  if (!target || target.color === mover || target.type === 'k') return { gain: 0, canCapture: false };
  for (const attacker of attackersOf(chess, square, mover)) {
    const made = tryMove(chess, captureInput(chess, attacker.square, square));
    if (!made) continue;
    const gain = captureValue(made) - exchange(chess, square).gain;
    chess.undo();
    // The side to move may also choose not to capture, so the result is never below 0.
    return { gain: Math.max(0, gain), canCapture: true };
  }
  return { gain: 0, canCapture: false };
}

/**
 * Static exchange evaluation (SEE) of one square: the points the side to move wins by starting a series of captures there, when both sides always capture with their cheapest piece and stop when capturing would lose material.
 * @param {Chess} chess The position. It is the same again when the function returns.
 * @param {string} square A square that holds a piece of the side that is not to move.
 * @returns {number} Points won, never below 0, because the side to move can also choose not to capture.
 */
export function seeSquare(chess, square) {
  return exchange(chess, square).gain;
}

/**
 * Look at one given capture: the points it wins after the whole exchange on that square, and whether the other side can capture back.
 * @param {Chess} chess The position. It is the same again when the function returns.
 * @param {{ from: string, to: string, promotion?: string }} move
 * @returns {CaptureResult|null} null when the move is not legal or is not a capture.
 */
export function evaluateCapture(chess, move) {
  const made = tryMove(chess, move);
  if (!made) return null;
  if (!made.captured) {
    chess.undo();
    return null;
  }
  const reply = exchange(chess, made.to);
  chess.undo();
  return {
    move: made,
    gain: captureValue(made) - reply.gain,
    canRecapture: reply.canCapture,
    victimSquare: victimSquareOf(made),
    victim: made.captured,
  };
}

/**
 * The best legal capture that the side to move can make on one square.
 * @param {Chess} chess
 * @param {string} square
 * @returns {CaptureResult|null} The capture that wins the most points, with the cheapest piece when two captures win the same. null when no legal capture lands there.
 */
export function bestCaptureOn(chess, square) {
  const target = chess.get(square);
  const mover = chess.turn();
  if (!target || target.color === mover || target.type === 'k') return null;
  let best = null;
  // attackersOf lists the cheapest piece first, so a later capture replaces the best one only when it wins more.
  for (const attacker of attackersOf(chess, square, mover)) {
    const result = evaluateCapture(chess, captureInput(chess, attacker.square, square));
    if (result && (!best || result.gain > best.gain)) best = result;
  }
  return best;
}

/**
 * Every legal capture of the side to move, each with its exchange result. En passant is included. A pawn that captures onto the last rank is listed once, as a queen promotion.
 * @param {Chess} chess
 * @returns {CaptureResult[]}
 */
export function listCaptures(chess) {
  const mover = chess.turn();
  const captures = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color === mover || cell.type === 'k') continue;
      for (const from of chess.attackers(cell.square, mover)) {
        const result = evaluateCapture(chess, captureInput(chess, from, cell.square));
        if (result) captures.push(result);
      }
    }
  }
  const enPassant = chess.fen().split(' ')[3];
  if (isSquare(enPassant)) {
    for (const from of chess.attackers(enPassant, mover)) {
      if (chess.get(from).type !== 'p') continue;
      const result = evaluateCapture(chess, { from, to: enPassant });
      if (result) captures.push(result);
    }
  }
  return captures;
}

/**
 * Count the material of both sides.
 * @param {string|Chess} source A FEN text or a chess.js board.
 * @returns {{ w: { p: number, n: number, b: number, r: number, q: number, points: number }, b: { p: number, n: number, b: number, r: number, q: number, points: number } }} Piece counts per side, and `points` as the sum of their values. Kings are not counted.
 */
export function materialCount(source) {
  const chess = typeof source === 'string' ? new Chess(source) : source;
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, points: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, points: 0 } };
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.type === 'k') continue;
      count[cell.color][cell.type] += 1;
      count[cell.color].points += pieceValue(cell.type);
    }
  }
  return count;
}
