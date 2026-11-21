// Works out why a move is illegal. chess.js only says that a move is illegal, so this file checks the move step by step, the way a teacher would: is there a piece, is it yours, does the piece move like that, is something in the way, and is your king safe afterwards.
import { Chess } from 'chess.js';
import { attackersOf, coordsToSquare, isSquare, otherColor, squareToCoords, squaresBetween } from './board-utils.js';

/**
 * The reason why a move is illegal. `params` always holds `from` and `to`. The other fields depend on the code:
 * - `game-over`: `reason` is "checkmate" or "stalemate". No move is legal any more.
 * - `no-piece`: the start square is empty.
 * - `not-your-piece`: `piece`. The piece belongs to the other side.
 * - `not-your-turn`: `piece`. Only possible when `options.playerColor` is given: the piece is the player's, but the other side is to move.
 * - `same-square`: `piece`. The piece was put back on its own square.
 * - `own-piece`: `piece`, `targetPiece`. The target square holds one of the player's own pieces.
 * - `wrong-shape`: `piece`, `detail`. The piece does not move that way. `detail` is null, or for a pawn one of "pawn-backward", "pawn-two-steps-late", "pawn-too-far".
 * - `blocked`: `piece`, `blocker`, `blockerPiece`, `blockerColor`, `blockerIsOwn`. Another piece stands on the path, on the square `blocker`. `blockerIsOwn` is true when that piece belongs to the player.
 * - `pawn-blocked`: `blocker`, `blockerPiece`, `blockerColor`, `blockerIsOwn`. A pawn wants to go two squares but the square in front of it is taken.
 * - `pawn-capture-empty`: a pawn tried a diagonal step with nothing to capture there.
 * - `pawn-straight-capture`: `targetPiece`. A pawn tried to capture straight ahead.
 * - `leaves-king-in-check`: `piece`, `kind`, `attacker`, `attackerPiece`, `king`. `kind` is "pinned" (the piece shields the king from the piece on `attacker`) or "king-into-attack" (the king steps onto a square that the piece on `attacker` attacks). `king` is the king's square after the move.
 * - `must-answer-check`: `piece`, `checker`, `checkerPiece`, `king`. The king is in check from the piece on `checker` and the move does not stop that check.
 * - `castle-king-moved`, `castle-rook-moved`: `side` ("k" or "q"), `rook` (the rook's corner square). The right to castle is gone. For `castle-rook-moved`, `rookMissing` is true when no rook stands on the corner.
 * - `castle-blocked`: `side`, `rook`, `blocker`, `blockerPiece`, `blockerColor`, `blockerIsOwn`.
 * - `castle-in-check`: `side`, `rook`, `checker`, `checkerPiece`, `king`.
 * - `castle-through-check`, `castle-into-check`: `side`, `rook`, `square` (the attacked square), `attacker`, `attackerPiece`.
 * - `not-allowed`: a safety net that should never be seen. It is returned when chess.js rejects a move and none of the checks above found the cause, so that the screen still has something to say.
 * @typedef {Object} IllegalReason
 * @property {string} code
 * @property {Record<string, string|boolean|null>} params
 */

function reason(code, params) {
  return { code, params };
}

function blockerParams(chess, square, moverColor) {
  const piece = chess.get(square);
  return { blocker: square, blockerPiece: piece.type, blockerColor: piece.color, blockerIsOwn: piece.color === moverColor };
}

function rawEnPassantSquare(fen) {
  const field = fen.trim().split(/\s+/)[3];
  return isSquare(field) ? field : null;
}

// When the player drops the king on its own corner rook from the king's first square, the player means castling. The real target is then the square where the king lands.
function resolveCastlingTarget(chess, from, to) {
  const piece = chess.get(from);
  if (!piece || piece.type !== 'k') return to;
  const rank = piece.color === 'w' ? '1' : '8';
  if (from !== 'e' + rank || to[1] !== rank) return to;
  const target = chess.get(to);
  if (!target || target.type !== 'r' || target.color !== piece.color) return to;
  if (to[0] === 'h') return 'g' + rank;
  if (to[0] === 'a') return 'c' + rank;
  return to;
}

/**
 * Turn "king dropped on its own corner rook" into the normal castling target. Use it before giving a move to chess.js, so that both ways of castling work: king two squares sideways, or king onto the rook.
 * @param {string} fen
 * @param {string} from
 * @param {string} to
 * @returns {string} The king's landing square (g1, c1, g8 or c8) when the move is the king going from its first square onto its own corner rook. In every other case `to` is returned unchanged.
 * @throws {Error} When the FEN is not valid or a square name is wrong.
 */
export function castlingTarget(fen, from, to) {
  if (!isSquare(from) || !isSquare(to)) throw new TypeError(`castlingTarget: "${from}" and "${to}" must be squares such as "e1".`);
  return resolveCastlingTarget(new Chess(fen), from, to);
}

// A castling try is the king going two squares sideways from its first square, or the king dropped on its own corner rook from anywhere.
function castlingAttempt(chess, piece, from, to) {
  if (piece.type !== 'k') return null;
  const rank = piece.color === 'w' ? '1' : '8';
  const home = 'e' + rank;
  if (to[1] !== rank) return null;
  const target = chess.get(to);
  const ontoOwnCornerRook = Boolean(target) && target.type === 'r' && target.color === piece.color && (to[0] === 'a' || to[0] === 'h');
  if (ontoOwnCornerRook) return { side: to[0] === 'h' ? 'k' : 'q', home, rank };
  if (from === home && (to[0] === 'g' || to[0] === 'c')) return { side: to[0] === 'g' ? 'k' : 'q', home, rank };
  return null;
}

function explainCastling(chess, color, attempt, moveParams) {
  const { side, home, rank } = attempt;
  const enemy = otherColor(color);
  const rookSquare = (side === 'k' ? 'h' : 'a') + rank;
  const passSquare = (side === 'k' ? 'f' : 'd') + rank;
  const landSquare = (side === 'k' ? 'g' : 'c') + rank;
  const params = { ...moveParams, side, rook: rookSquare };
  if (moveParams.from !== home) return reason('castle-king-moved', params);
  const rook = chess.get(rookSquare);
  if (!rook || rook.type !== 'r' || rook.color !== color) return reason('castle-rook-moved', { ...params, rookMissing: true });
  const rights = chess.getCastlingRights(color);
  // With no right on either side the king has moved before. With a right only on the other side the king has not moved, so this rook has.
  if (!rights.k && !rights.q) return reason('castle-king-moved', params);
  if (!rights[side]) return reason('castle-rook-moved', { ...params, rookMissing: false });
  const blocker = squaresBetween(home, rookSquare).find((square) => chess.get(square));
  if (blocker) return reason('castle-blocked', { ...params, ...blockerParams(chess, blocker, color) });
  const checker = attackersOf(chess, home, enemy)[0];
  if (checker) return reason('castle-in-check', { ...params, checker: checker.square, checkerPiece: checker.type, king: home });
  const passAttacker = attackersOf(chess, passSquare, enemy)[0];
  if (passAttacker) return reason('castle-through-check', { ...params, square: passSquare, attacker: passAttacker.square, attackerPiece: passAttacker.type });
  const landAttacker = attackersOf(chess, landSquare, enemy)[0];
  if (landAttacker) return reason('castle-into-check', { ...params, square: landSquare, attacker: landAttacker.square, attackerPiece: landAttacker.type });
  return reason('not-allowed', params);
}

function explainPawnShape(chess, piece, params, enPassant) {
  const { from, to } = params;
  const a = squareToCoords(from);
  const b = squareToCoords(to);
  const forward = piece.color === 'w' ? 1 : -1;
  const steps = (b.rank - a.rank) * forward;
  const sideways = Math.abs(b.file - a.file);
  const target = chess.get(to);
  if (steps <= 0) return reason('wrong-shape', { ...params, detail: 'pawn-backward' });
  if (sideways === 0) {
    if (steps > 2) return reason('wrong-shape', { ...params, detail: 'pawn-too-far' });
    if (steps === 2) {
      const startRank = piece.color === 'w' ? 1 : 6;
      if (a.rank !== startRank) return reason('wrong-shape', { ...params, detail: 'pawn-two-steps-late' });
      const middle = coordsToSquare(a.file, a.rank + forward);
      if (chess.get(middle)) return reason('pawn-blocked', { ...params, ...blockerParams(chess, middle, piece.color) });
    }
    return target ? reason('pawn-straight-capture', { ...params, targetPiece: target.type }) : null;
  }
  if (sideways === 1 && steps === 1) {
    if (target || to === enPassant) return null;
    return reason('pawn-capture-empty', params);
  }
  return reason('wrong-shape', { ...params, detail: null });
}

// Checks the way the piece moves and the squares on its path. Returns a reason, or null when the move would be fine if the king's safety did not matter.
function explainShape(chess, piece, params, enPassant) {
  const { from, to } = params;
  if (piece.type === 'p') return explainPawnShape(chess, piece, params, enPassant);
  const a = squareToCoords(from);
  const b = squareToCoords(to);
  const files = Math.abs(b.file - a.file);
  const ranks = Math.abs(b.rank - a.rank);
  const straight = files === 0 || ranks === 0;
  const diagonal = files === ranks;
  const wrongShape = () => reason('wrong-shape', { ...params, detail: null });
  if (piece.type === 'n') return (files === 1 && ranks === 2) || (files === 2 && ranks === 1) ? null : wrongShape();
  if (piece.type === 'k') return Math.max(files, ranks) === 1 ? null : wrongShape();
  if (piece.type === 'b' && !diagonal) return wrongShape();
  if (piece.type === 'r' && !straight) return wrongShape();
  if (piece.type === 'q' && !straight && !diagonal) return wrongShape();
  const blocker = squaresBetween(from, to).find((square) => chess.get(square));
  return blocker ? reason('blocked', { ...params, ...blockerParams(chess, blocker, piece.color) }) : null;
}

// The move has the right shape and a free path, so the only thing left is the king. chess.js will not play an illegal move, so the position after the move is built by hand and then asked who attacks the king.
function explainKingSafety(chess, piece, params) {
  const { from, to } = params;
  const enemy = otherColor(piece.color);
  const kingBefore = chess.findPiece({ type: 'k', color: piece.color })[0];
  const target = chess.get(to);
  if (!kingBefore || (target && target.type === 'k')) return reason('not-allowed', params);
  const checkersBefore = chess.attackers(kingBefore, enemy);
  const isEnPassant = piece.type === 'p' && from[0] !== to[0] && !target;
  chess.remove(from);
  if (isEnPassant) chess.remove(to[0] + from[1]);
  if (target) chess.remove(to);
  chess.put(piece, to);
  const kingAfter = piece.type === 'k' ? to : kingBefore;
  const attackers = attackersOf(chess, kingAfter, enemy);
  if (attackers.length === 0) return reason('not-allowed', params);
  if (piece.type === 'k') {
    return reason('leaves-king-in-check', { ...params, kind: 'king-into-attack', attacker: attackers[0].square, attackerPiece: attackers[0].type, king: kingAfter });
  }
  const stillChecking = attackers.find((attacker) => checkersBefore.includes(attacker.square));
  if (stillChecking) {
    return reason('must-answer-check', { ...params, checker: stillChecking.square, checkerPiece: stillChecking.type, king: kingAfter });
  }
  return reason('leaves-king-in-check', { ...params, kind: 'pinned', attacker: attackers[0].square, attackerPiece: attackers[0].type, king: kingAfter });
}

/**
 * Explain why a move is not legal.
 *
 * A try to castle is seen as the king going two squares sideways from its first square, or the king dropped on its own corner rook. Dropping the king on the rook counts as castling, so when that castling is legal the result is null: play it with the square from `castlingTarget`.
 *
 * A pawn that reaches the last rank needs no promotion piece here: the move counts as legal when any promotion is legal.
 *
 * @param {string} fen The position before the move.
 * @param {string} from Square the player picked the piece up from.
 * @param {string} to Square the player dropped it on.
 * @param {{ playerColor?: 'w'|'b' }} [options] `playerColor` is the side the human plays. When it is given, a piece of the other color gives `not-your-piece` and a move made while the other side is to move gives `not-your-turn`. When it is left out, the player is taken to be the side to move, so a piece of the other color gives `not-your-piece` and `not-your-turn` can not happen.
 * @returns {IllegalReason|null} The reason, or null when the move is legal.
 * @throws {Error} When the FEN is not valid, a square name is wrong, or `playerColor` is not "w" or "b". These are mistakes in the calling code, not player mistakes.
 */
export function explainIllegalMove(fen, from, to, options = {}) {
  if (!isSquare(from) || !isSquare(to)) throw new TypeError(`explainIllegalMove: "${from}" and "${to}" must be squares such as "e2".`);
  const chess = new Chess(fen);
  const turn = chess.turn();
  const player = options.playerColor ?? turn;
  if (player !== 'w' && player !== 'b') throw new TypeError(`explainIllegalMove: playerColor must be "w" or "b", got "${player}".`);
  const base = { from, to };
  const piece = chess.get(from);
  if (!piece) return reason('no-piece', base);
  const params = { ...base, piece: piece.type };
  if (piece.color !== player) return reason('not-your-piece', params);
  if (player !== turn) return reason('not-your-turn', params);
  if (from === to) return reason('same-square', params);

  const realTarget = resolveCastlingTarget(chess, from, to);
  if (chess.moves({ square: from, verbose: true }).some((move) => move.to === realTarget)) return null;

  if (chess.isCheckmate()) return reason('game-over', { ...params, reason: 'checkmate' });
  if (chess.isStalemate()) return reason('game-over', { ...params, reason: 'stalemate' });

  const attempt = castlingAttempt(chess, piece, from, to);
  if (attempt) return explainCastling(chess, piece.color, attempt, params);

  const target = chess.get(to);
  if (target && target.color === piece.color) return reason('own-piece', { ...params, targetPiece: target.type });

  return explainShape(chess, piece, params, rawEnPassantSquare(fen)) ?? explainKingSafety(chess, piece, params);
}
