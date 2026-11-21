// Builds the coach's report for one move: the rating from the engine scores, the best move and equal moves, the material outcome of the played line, and the findings from the detectors. The report holds facts only. Words and pictures are made later by the presenter.
import { Chess } from 'chess.js';
import { isSquare, materialCount, moveRef, otherColor, parseUci, playUciLine, seeSquare, toUci, tryMove, uciToMove } from './board-utils.js';
import {
  EQUAL_MOVE_WINDOW_CP,
  EXCELLENT_MAX_CP_LOSS,
  LINE_MAX_PLIES,
  MATE_MAX_DISTANCE,
  MATE_SCORE_CP,
  MATE_STEP_CP,
  MATE_SWING_CLEAR_CP,
  MATE_SWING_DECIDED_CP,
  MATERIAL_MAX_REPLY_PLIES,
  MATERIAL_REPLY_PLIES,
  MAX_PLAIN_CP,
  RATING_MAX_WIN_CHANCE_LOSS,
  RATINGS,
  WIN_CHANCE_SLOPE,
} from './constants.js';
import { detectFindings } from './detectors.js';

/**
 * An engine score. Exactly one of the two fields is a number.
 * @typedef {Object} Score
 * @property {number|null} cp Centipawns.
 * @property {number|null} mate Moves until mate. Positive means the side the score belongs to gives mate.
 */

/**
 * The material result of the played line.
 * @typedef {Object} MaterialOutcome
 * @property {number} plies How many plies of the played line were counted, the played move included. At least 1.
 * @property {boolean} settled False when the count stops in the middle of an exchange, so the numbers can not be trusted yet. This happens when the engine line is too short.
 * @property {number} net Change of the material balance in points, from the player's point of view. Negative means the player ends with less than before.
 * @property {'nothing'|'even'|'player-wins'|'player-loses'} outcome `nothing` means no piece changed hands at all, `even` means pieces were traded for the same value.
 * @property {string[]} playerLost Piece types the player lost, most valuable first. A type appears once for each lost piece. A pawn that promotes counts as lost here and the new piece as gained.
 * @property {string[]} opponentLost
 * @property {string[]} playerGained Piece types the player gained by promotion.
 * @property {string[]} opponentGained
 * @property {{ player: number, opponent: number }} before Material totals in points before the move.
 * @property {{ player: number, opponent: number }} after Material totals in points at the end of the counted line.
 */

/**
 * Everything the coach knows about one move.
 * @typedef {Object} MoveReport
 * @property {string} fenBefore
 * @property {string} fenAfter
 * @property {string} moveSan The played move in standard notation.
 * @property {string} moveUci The played move in UCI form.
 * @property {import('./board-utils.js').MoveRef} move The played move with its squares, piece and captured piece.
 * @property {number} moveNumber Full move number of the played move.
 * @property {'w'|'b'} color Side that played the move.
 * @property {boolean} isCheck
 * @property {boolean} isCheckmate
 * @property {boolean} isStalemate
 * @property {'best'|'excellent'|'good'|'inaccuracy'|'mistake'|'blunder'|null} rating null when the engine lines are missing. A move that gives checkmate is always `best`, also without engine lines.
 * @property {boolean} isTopMove True when the move is the engine's first move or scores within the equal window of it.
 * @property {string[]} equalMoves Notation of the other moves that score within the equal window of the engine's first move. The played move and the move in `best` are never in this list.
 * @property {number|null} cpLoss Centipawns lost against the best move, never below 0. Mates count as very large values. null when not known.
 * @property {number|null} winChanceLoss Win chance lost against the best move, in percentage points from 0 to 100. null when not known.
 * @property {Score|null} evalBefore Score of the position before the move (the best line), from White's point of view.
 * @property {Score|null} evalAfter Score after the played move, from White's point of view.
 * @property {import('./board-utils.js').MoveRef|null} best The engine's first move.
 * @property {string[]} bestLineSan The best line in notation, cut at LINE_MAX_PLIES.
 * @property {string[]} bestLineUci The same line in UCI form. Every move in it is legal.
 * @property {string[]} playedLineSan The line that starts with the played move. Without an engine line it holds only the played move.
 * @property {string[]} playedLineUci
 * @property {MaterialOutcome} material
 * @property {import('./detectors.js').Finding[]} findings Most important first.
 */

/**
 * Win chance of the side a score belongs to, in percent. This is the Lichess formula.
 * @param {number} cp Centipawns from that side's point of view.
 * @returns {number} 0 to 100. A score of 0 gives 50.
 */
export function winChance(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_CHANCE_SLOPE * cp)) - 1);
}

/**
 * Turn an engine score into one number. A mate becomes a very large value, and a faster mate is larger than a slower one. `mate: 0` means the side is already checkmated.
 * @param {Score|null|undefined} score
 * @returns {number|null} Centipawns, or null when the score has no usable number.
 */
export function scoreToCp(score) {
  if (!score) return null;
  if (Number.isInteger(score.mate)) {
    const distance = Math.min(Math.abs(score.mate), MATE_MAX_DISTANCE) * MATE_STEP_CP;
    return score.mate > 0 ? MATE_SCORE_CP - distance : -MATE_SCORE_CP + distance;
  }
  if (Number.isFinite(score.cp)) return Math.max(-MAX_PLAIN_CP, Math.min(MAX_PLAIN_CP, score.cp));
  return null;
}

function worseRating(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return RATINGS.indexOf(a) >= RATINGS.indexOf(b) ? a : b;
}

function ratingForSwing(margin) {
  if (margin > MATE_SWING_DECIDED_CP) return 'inaccuracy';
  if (margin > MATE_SWING_CLEAR_CP) return 'mistake';
  return 'blunder';
}

// Mate rules. Win chance alone is blind near the ends of the scale, so a move that gives up a forced mate or walks into one gets a floor: the rating can not be better than the value returned here.
function mateFloor(best, played, bestCp, playedCp) {
  const isMate = (score) => Number.isInteger(score.mate);
  const bestWins = isMate(best) && best.mate > 0;
  const bestLoses = isMate(best) && best.mate <= 0;
  const playedWins = isMate(played) && played.mate > 0;
  const playedLoses = isMate(played) && played.mate <= 0;
  if (playedLoses && !bestLoses) return ratingForSwing(-bestCp);
  if (bestWins && !playedWins) return ratingForSwing(playedCp);
  if (bestWins && playedWins && best.mate === 1 && played.mate > 1) return 'inaccuracy';
  if (bestLoses && playedLoses && played.mate === -1 && best.mate < -1) return 'inaccuracy';
  return null;
}

/**
 * Rate a move by comparing its score with the score of the best move. Both scores are from the point of view of the side that moves.
 *
 * The rating comes from the loss of win chance, so in a position that is already won or lost a big swing in centipawns is not a blunder. A move within the equal window of the best move is a top move and rated `best`. Two extra rules use centipawns and mates: `excellent` also needs a small centipawn loss, and giving up a forced mate or walking into one sets a floor under the rating.
 * @param {Score} best Score of the engine's first move.
 * @param {Score} played Score of the played move.
 * @returns {{ rating: 'best'|'excellent'|'good'|'inaccuracy'|'mistake'|'blunder'|null, isTopMove: boolean, cpLoss: number|null, winChanceLoss: number|null }} All null and false when one of the scores has no number.
 */
export function classifyMove(best, played) {
  const bestCp = scoreToCp(best);
  const playedCp = scoreToCp(played);
  if (bestCp === null || playedCp === null) return { rating: null, isTopMove: false, cpLoss: null, winChanceLoss: null };
  const cpLoss = Math.max(0, bestCp - playedCp);
  const winChanceLoss = Math.max(0, winChance(bestCp) - winChance(playedCp));
  if (cpLoss <= EQUAL_MOVE_WINDOW_CP) return { rating: 'best', isTopMove: true, cpLoss, winChanceLoss };
  let rating;
  if (winChanceLoss <= RATING_MAX_WIN_CHANCE_LOSS.excellent && cpLoss <= EXCELLENT_MAX_CP_LOSS) rating = 'excellent';
  else if (winChanceLoss <= RATING_MAX_WIN_CHANCE_LOSS.good) rating = 'good';
  else if (winChanceLoss <= RATING_MAX_WIN_CHANCE_LOSS.inaccuracy) rating = 'inaccuracy';
  else if (winChanceLoss <= RATING_MAX_WIN_CHANCE_LOSS.mistake) rating = 'mistake';
  else rating = 'blunder';
  return { rating: worseRating(rating, mateFloor(best, played, bestCp, playedCp)), isTopMove: false, cpLoss, winChanceLoss };
}

function readScore(raw) {
  if (Number.isInteger(raw.mate)) return { cp: null, mate: raw.mate };
  if (Number.isFinite(raw.cp)) return { cp: raw.cp, mate: null };
  return null;
}

// Checks one engine line. A line with no score, or whose first move is not legal in the position, is dropped. A principal variation that does not start with the line's move is replaced by the move alone.
function readLine(raw, fenBefore) {
  if (!raw || typeof raw !== 'object') return null;
  const score = readScore(raw);
  if (!score) return null;
  const rawPv = Array.isArray(raw.pv) ? raw.pv : [];
  const pvFirst = parseUci(rawPv[0]);
  const first = parseUci(raw.move) ?? pvFirst;
  if (!first) return null;
  const made = uciToMove(fenBefore, toUci(first));
  if (!made) return null;
  const move = toUci(made);
  const pv = pvFirst && toUci(pvFirst) === move ? rawPv : [move];
  const value = scoreToCp(score);
  return { move, san: made.san, pv, cp: score.cp, mate: score.mate, depth: Number.isFinite(raw.depth) ? raw.depth : null, value, winChance: winChance(value) };
}

// Reads all lines, keeps the first line for each move and puts the best score first. The engine wrapper already sorts them, and sorting again here makes sure that lines[0] is the best even if an update arrived out of order.
function readLines(rawLines, fenBefore) {
  const seen = new Set();
  const lines = [];
  for (const raw of Array.isArray(rawLines) ? rawLines : []) {
    const line = readLine(raw, fenBefore);
    if (!line || seen.has(line.move)) continue;
    seen.add(line.move);
    lines.push(line);
  }
  return lines.sort((a, b) => b.value - a.value);
}

function toWhitePov(score, color) {
  const flip = (value) => (value === null || value === 0 ? value : -value);
  return color === 'w' ? { cp: score.cp, mate: score.mate } : { cp: flip(score.cp), mate: flip(score.mate) };
}

const COUNTED_TYPES = ['q', 'r', 'b', 'n', 'p'];

function countDrop(from, to) {
  const pieces = [];
  for (const type of COUNTED_TYPES) {
    for (let i = to[type]; i < from[type]; i++) pieces.push(type);
  }
  return pieces;
}

// Counts material before the move and at the end of the played line. The count normally stops three plies after the played move. When that point is in the middle of an exchange on one square, it goes on until the exchange ends.
function materialOutcome(fenBefore, lineMoves, color) {
  const limit = Math.min(lineMoves.length, 1 + MATERIAL_MAX_REPLY_PLIES);
  let end = Math.min(lineMoves.length, 1 + MATERIAL_REPLY_PLIES);
  const isRecapture = (index) => Boolean(lineMoves[index].captured) && Boolean(lineMoves[index - 1].captured) && lineMoves[index].to === lineMoves[index - 1].to;
  while (end < limit && isRecapture(end)) end += 1;
  const last = lineMoves[end - 1];
  let settled = true;
  if (last.captured) {
    // The line ends on a capture. It is settled when the next known move is not a capture back on that square, or, when no next move is known, when capturing back would not win anything.
    settled = end < lineMoves.length ? !isRecapture(end) : seeSquare(new Chess(last.after), last.to) === 0;
  }
  const opponent = otherColor(color);
  const before = materialCount(fenBefore);
  const after = materialCount(last.after);
  const net = after[color].points - after[opponent].points - (before[color].points - before[opponent].points);
  const playerLost = countDrop(before[color], after[color]);
  const opponentLost = countDrop(before[opponent], after[opponent]);
  const playerGained = countDrop(after[color], before[color]);
  const opponentGained = countDrop(after[opponent], before[opponent]);
  const changed = playerLost.length + opponentLost.length + playerGained.length + opponentGained.length > 0;
  let outcome = 'nothing';
  if (changed) outcome = net === 0 ? 'even' : net > 0 ? 'player-wins' : 'player-loses';
  return {
    plies: end,
    settled,
    net,
    outcome,
    playerLost,
    opponentLost,
    playerGained,
    opponentGained,
    before: { player: before[color].points, opponent: before[opponent].points },
    after: { player: after[color].points, opponent: after[opponent].points },
  };
}

/**
 * Build the coach's report for one move.
 *
 * Odd engine input never throws: a line with no score or with an illegal first move is dropped, and a principal variation is cut at its first illegal move. When no usable lines are left, or the played move has no line, the report still comes back with `rating: null` and the findings that need no engine (a hanging piece, a free capture, mate in one, stalemate), so beginner feedback works while the engine loads.
 *
 * How the played move gets its score: when one of `lines` starts with the played move, that line is used, because it comes from the same search as the best move and the two scores can be compared fairly. Otherwise `playedLine` is used, when its first move is the played move.
 *
 * @param {Object} input
 * @param {string} input.fenBefore The position before the move.
 * @param {{ from: string, to: string, promotion?: string }} input.move The move that was played. It must be legal, and a pawn that reaches the last rank needs `promotion`.
 * @param {import('../engine/types.js').EngineLine[]} [input.lines] Engine lines for `fenBefore`, best first (MultiPV 3 to 5). Scores are from the point of view of the side to move.
 * @param {import('../engine/types.js').EngineLine|null} [input.playedLine] The engine line whose first move is the played move: one of `lines`, or the result of a search limited to that move, or null.
 * @returns {MoveReport}
 * @throws {Error} When `fenBefore` is not a valid FEN or the move is not legal there. These are mistakes in the calling code and must not be hidden.
 */
export function buildMoveReport(input) {
  if (!input || typeof input !== 'object') throw new TypeError('buildMoveReport: expected an object with fenBefore, move, lines and playedLine.');
  const { fenBefore, move, lines, playedLine } = input;
  if (typeof fenBefore !== 'string') throw new TypeError('buildMoveReport: fenBefore must be a FEN text.');
  if (!move || !isSquare(move.from) || !isSquare(move.to)) throw new TypeError('buildMoveReport: move must have the squares "from" and "to".');

  const chess = new Chess(fenBefore);
  const color = chess.turn();
  const moveNumber = chess.moveNumber();
  const made = tryMove(chess, move.promotion ? { from: move.from, to: move.to, promotion: move.promotion } : { from: move.from, to: move.to });
  if (!made) throw new Error(`buildMoveReport: the move ${JSON.stringify(move)} is not legal in the position "${fenBefore}". A pawn that reaches the last rank needs a promotion piece.`);
  const playedUci = toUci(made);
  const isCheckmate = chess.isCheckmate();

  const scored = readLines(lines, fenBefore);
  const best = scored[0] ?? null;
  const separate = readLine(playedLine, fenBefore);
  const played = scored.find((line) => line.move === playedUci) ?? (separate && separate.move === playedUci ? separate : null);

  let verdict = { rating: null, isTopMove: false, cpLoss: null, winChanceLoss: null };
  if (isCheckmate || (best && best.move === playedUci)) verdict = { rating: 'best', isTopMove: true, cpLoss: 0, winChanceLoss: 0 };
  else if (best && played) verdict = classifyMove(best, played);

  const equalMoves = best ? scored.filter((line) => line.move !== best.move && line.move !== playedUci && best.value - line.value <= EQUAL_MOVE_WINDOW_CP).map((line) => line.san) : [];

  // The lines are replayed once. This cuts them at the first illegal move and gives the notation, the UCI form and the positions needed for the material count.
  const maxPlies = Math.max(LINE_MAX_PLIES, MATERIAL_MAX_REPLY_PLIES + 2);
  const playedMoves = playUciLine(fenBefore, played ? played.pv : [playedUci], maxPlies).moves;
  const bestMoves = !best ? [] : best.move === playedUci ? playedMoves : playUciLine(fenBefore, best.pv, maxPlies).moves;
  const playedLineUci = playedMoves.map(toUci);
  const bestLineUci = bestMoves.map(toUci);

  let evalAfter = null;
  if (played) evalAfter = toWhitePov(played, color);
  else if (isCheckmate) evalAfter = { cp: null, mate: color === 'w' ? 1 : -1 };

  const engine = {
    lines: scored,
    best: best ? { ...best, pv: bestLineUci } : null,
    played: played ? { ...played, pv: playedLineUci } : null,
    rating: verdict.rating,
    isTopMove: verdict.isTopMove,
    equalMoves,
  };
  const findings = detectFindings({ fenBefore, move: { from: made.from, to: made.to, promotion: made.promotion }, engine });

  return {
    fenBefore,
    fenAfter: made.after,
    moveSan: made.san,
    moveUci: playedUci,
    move: moveRef(made),
    moveNumber,
    color,
    isCheck: chess.inCheck(),
    isCheckmate,
    isStalemate: chess.isStalemate(),
    rating: verdict.rating,
    isTopMove: verdict.isTopMove,
    equalMoves,
    cpLoss: verdict.cpLoss,
    winChanceLoss: verdict.winChanceLoss,
    evalBefore: best ? toWhitePov(best, color) : null,
    evalAfter,
    best: bestMoves.length > 0 ? moveRef(bestMoves[0]) : null,
    bestLineSan: bestMoves.map((entry) => entry.san),
    bestLineUci,
    playedLineSan: playedMoves.map((entry) => entry.san),
    playedLineUci,
    material: materialOutcome(fenBefore, playedMoves, color),
    findings,
  };
}
