// Detectors look at one move and return findings: small facts such as "this piece can be taken for free" or "the best reply is a fork". They only detect. Which findings a player sees, and in which words, is decided later by the feedback level and the presenter.
import { Chess } from 'chess.js';
import {
  ALL_STEPS,
  DIAGONAL_STEPS,
  STRAIGHT_STEPS,
  attackedSquares,
  bestCaptureOn,
  evaluateCapture,
  exchangeValue,
  listCaptures,
  materialCount,
  moveRef,
  otherColor,
  parseUci,
  piecesOnRay,
  pieceValue,
  toUci,
  tryMove,
} from './board-utils.js';
import {
  EARLY_QUEEN_MAX_MOVE,
  EQUAL_MOVE_WINDOW_CP,
  FINDING_PRIORITY,
  MATERIAL_SEVERITY_CRITICAL,
  MATERIAL_SEVERITY_MAJOR,
  MISSED_CAPTURE_MAX_WIN_CHANCE_LOSS,
  OPENING_MAX_MOVE,
  OPENING_MIN_UNDEVELOPED,
  SEVERITIES,
  STILL_WINNING_CP,
  TACTIC_MIN_TARGET_VALUE,
  WEAK_RATINGS,
} from './constants.js';

/**
 * One fact about a move. Every finding has these three fields, plus the data that its type needs (squares, piece types, moves, points).
 *
 * Types and their extra fields. `MoveRef` is described in board-utils.js. A "piece" is a type letter: p, n, b, r, q or k.
 * - `hanging-piece`: `square`, `piece`, `color`, `points` (what the capture wins), `defended`, `capture` (MoveRef of the best capture), `attackers` ({ square, piece }[]), `moved` (true when it is the piece that just moved), `confirmed` (true when the engine's reply takes it, false when the engine replies with another move, null when the reply is unknown), `remedy` ("protect", "retreat", "capture-attacker" or null: what the engine's best move would have done for this piece, set only when the piece could already be taken before the move). Tier 1 when nothing defends the piece, tier 2 when it is defended but the exchange still loses material.
 * - `missed-capture`: `move` (MoveRef of the capture), `piece`, `square` and `targetPiece` (the piece that could be taken), `points`, `free`. Tier 1 when the capture is free, tier 2 when it wins an exchange.
 * - `won-material`: same fields as `missed-capture`, for the capture the player did make.
 * - `missed-mate-in-1`, `allowed-mate-in-1`: `move` (MoveRef of the mating move), `piece`, `kingSquare` (the king that gets mated).
 * - `missed-mate`, `allowed-mate`: `mateIn` (number of moves), `move` (MoveRef of the first move of the mate, can be null for `allowed-mate`).
 * - `allowed-fork`, `missed-fork`: `move` (MoveRef of the forking move), `piece`, `square` (where the forking piece lands), `targets` ({ square, piece }[]).
 * - `allowed-pin`, `missed-pin`: `move`, `attacker`, `pinned`, `behind` (each { square, piece }), `absolute` (true when the piece behind is the king).
 * - `allowed-skewer`, `missed-skewer`: `move`, `attacker`, `front`, `behind` (each { square, piece }).
 * - `opening-principle`: `principle` ("king-move", "early-queen", "same-piece-twice", "edge-pawn" or "no-development"), `piece`, `square`, `move`.
 * - `caused-stalemate`: `materialLead` (the player's material minus the opponent's, in points).
 * - `delivered-checkmate`: `move`.
 * - `top-move`: `equalMoves` (notation of the other moves that are just as good).
 * @typedef {Object} Finding
 * @property {string} type
 * @property {'good'|'info'|'minor'|'major'|'critical'} severity `good` is praise, `info` is neutral, the other three are problems of growing size.
 * @property {1|2|3} tier Concept tier: 1 is only what can happen on the next move, 2 is named tactics, piece values, opening principles and short lines, 3 is engine-only material.
 */

/**
 * An engine line after the report has checked it.
 * @typedef {Object} ScoredLine
 * @property {string} move First move in UCI form.
 * @property {string[]} pv The line in UCI form. The report only passes moves that are legal.
 * @property {number|null} cp
 * @property {number|null} mate
 * @property {number} value The score as one number in centipawns from the mover's point of view, with mates turned into very large values.
 * @property {number} winChance Win chance of the mover in percent, 0 to 100.
 */

/**
 * What the engine knows about the move. The report builds this object. Every field can be missing, which means "not known".
 * @typedef {Object} EngineContext
 * @property {ScoredLine[]} [lines] Lines for the position before the move, best first.
 * @property {ScoredLine|null} [best] The first of `lines`.
 * @property {ScoredLine|null} [played] The line that starts with the played move.
 * @property {string|null} [rating]
 * @property {boolean} [isTopMove]
 * @property {string[]} [equalMoves]
 */

const NEGATIVE_SEVERITIES = new Set(['minor', 'major', 'critical']);
const NO_ENGINE = Object.freeze({ lines: [], best: null, played: null, rating: null, isTopMove: false, equalMoves: [] });
const MINOR_HOME_SQUARES = Object.freeze({ w: { n: ['b1', 'g1'], b: ['c1', 'f1'] }, b: { n: ['b8', 'g8'], b: ['c8', 'f8'] } });

/**
 * True when a finding is a problem, not praise and not neutral information.
 * @param {Finding} finding
 * @returns {boolean}
 */
export function isNegativeFinding(finding) {
  return NEGATIVE_SEVERITIES.has(finding.severity);
}

function materialSeverity(points) {
  if (points >= MATERIAL_SEVERITY_CRITICAL) return 'critical';
  if (points >= MATERIAL_SEVERITY_MAJOR) return 'major';
  return 'minor';
}

// Plays the move and returns the chess.js move, which also carries the positions before and after. A move that is not legal is a mistake in the calling code, so it fails loudly.
function playMove(fenBefore, move) {
  const chess = new Chess(fenBefore);
  const input = move && typeof move === 'object' ? { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) } : null;
  const made = tryMove(chess, input);
  if (!made) throw new Error(`Coach: the move ${JSON.stringify(move)} is not legal in the position "${fenBefore}". A pawn that reaches the last rank needs a promotion piece.`);
  return made;
}

function kingSquare(fen, color) {
  return new Chess(fen).findPiece({ type: 'k', color })[0] ?? null;
}

// Sort order for captures: the one that wins more comes first, and with the same gain the cheaper capturing piece comes first.
function compareCaptures(a, b) {
  return b.gain - a.gain || exchangeValue(a.move.piece) - exchangeValue(b.move.piece);
}

function isBetterCapture(candidate, current) {
  return compareCaptures(candidate, current) < 0;
}

/**
 * Find the pieces that the side to move can win: a capture exists that comes out ahead after the whole exchange on that square.
 * @param {string} fenAfter The position after the player's move, with the opponent to move.
 * @param {{ movedTo?: string|null, capturedValue?: number }} [options] `movedTo` is the square the player's piece just moved to and `capturedValue` the value of what it captured there. A piece that took something and can be taken back is only reported when the player loses more than was won, so an even trade is not a hanging piece.
 * @returns {Finding[]} `hanging-piece` findings, biggest loss first.
 */
export function detectHangingPieces(fenAfter, { movedTo = null, capturedValue = 0 } = {}) {
  const chess = new Chess(fenAfter);
  const owner = otherColor(chess.turn());
  const bySquare = new Map();
  for (const capture of listCaptures(chess)) {
    if (capture.gain <= 0) continue;
    if (capture.victimSquare === movedTo && capture.gain <= capturedValue) continue;
    const entry = bySquare.get(capture.victimSquare) ?? { best: capture, attackers: [] };
    entry.attackers.push({ square: capture.move.from, piece: capture.move.piece });
    if (isBetterCapture(capture, entry.best)) entry.best = capture;
    bySquare.set(capture.victimSquare, entry);
  }
  const findings = [];
  for (const [square, { best, attackers }] of bySquare) {
    findings.push({
      type: 'hanging-piece',
      severity: materialSeverity(best.gain),
      tier: best.canRecapture ? 2 : 1,
      square,
      piece: best.victim,
      color: owner,
      points: best.gain,
      defended: best.canRecapture,
      capture: moveRef(best.move),
      attackers,
      moved: square === movedTo,
      confirmed: null,
      remedy: null,
    });
  }
  return findings.sort((a, b) => b.points - a.points);
}

function captureFinding(type, capture) {
  return {
    type,
    severity: type === 'won-material' ? 'good' : materialSeverity(capture.gain),
    tier: capture.canRecapture ? 2 : 1,
    move: moveRef(capture.move),
    piece: capture.move.piece,
    square: capture.victimSquare,
    targetPiece: capture.victim,
    points: capture.gain,
    free: !capture.canRecapture,
  };
}

/**
 * Find a capture that wins material and that the player did not play.
 *
 * Without engine lines the check is static: a capture is reported when it wins more than the played move won. With engine lines the engine has the last word: the capture must be one of the engine's lines, must not lose much win chance against the best move, and must score better than the played move. A capture that the engine does not list among its top moves is not reported, because a "free" piece that the engine will not take is usually a trap.
 * @param {string} fenBefore
 * @param {{ from: string, to: string, promotion?: string }} move The played move.
 * @param {EngineContext|null} [engine]
 * @returns {Finding|null} One `missed-capture` finding, or null.
 * @throws {Error} When the move is not legal in the position.
 */
export function detectMissedCapture(fenBefore, move, engine = null) {
  const played = playMove(fenBefore, move);
  const chess = new Chess(fenBefore);
  const candidates = listCaptures(chess)
    .filter((capture) => capture.gain > 0 && !(capture.move.from === played.from && capture.move.to === played.to))
    .sort(compareCaptures);
  if (candidates.length === 0) return null;

  const lines = engine?.lines ?? [];
  if (lines.length === 0) {
    const playedGain = Math.max(0, evaluateCapture(chess, { from: played.from, to: played.to, promotion: played.promotion })?.gain ?? 0);
    const chosen = candidates.find((capture) => capture.gain > playedGain);
    return chosen ? captureFinding('missed-capture', chosen) : null;
  }

  if (engine.rating === 'best' || engine.rating === 'excellent') return null;
  const best = engine.best ?? lines[0];
  let chosen = null;
  let chosenLine = null;
  for (const capture of candidates) {
    const line = lines.find((entry) => entry.move === toUci(capture.move));
    if (!line) continue;
    if (best.winChance - line.winChance >= MISSED_CAPTURE_MAX_WIN_CHANCE_LOSS) continue;
    if (engine.played && line.value - engine.played.value <= EQUAL_MOVE_WINDOW_CP) continue;
    if (!chosenLine || line.value > chosenLine.value) {
      chosen = capture;
      chosenLine = line;
    }
  }
  return chosen ? captureFinding('missed-capture', chosen) : null;
}

/**
 * Check if the played move is a capture that wins material after the whole exchange.
 * @param {string} fenBefore
 * @param {{ from: string, to: string, promotion?: string }} move The played move.
 * @returns {Finding|null} One `won-material` finding, or null.
 */
export function detectWonMaterial(fenBefore, move) {
  const chess = new Chess(fenBefore);
  const input = move.promotion ? { from: move.from, to: move.to, promotion: move.promotion } : { from: move.from, to: move.to };
  const capture = evaluateCapture(chess, input);
  return capture && capture.gain > 0 ? captureFinding('won-material', capture) : null;
}

/**
 * Find a move that gives checkmate at once.
 * @param {string} fen
 * @returns {import('./board-utils.js').MoveRef|null} The mating move for the side to move, or null.
 */
export function findMateInOne(fen) {
  const chess = new Chess(fen);
  const san = chess.moves().find((text) => text.endsWith('#'));
  if (!san) return null;
  const made = tryMove(chess, san);
  return made ? moveRef(made) : null;
}

/**
 * Check if the player could give checkmate in one move and played something else.
 * @param {string} fenBefore
 * @param {{ from: string, to: string, promotion?: string }} move The played move.
 * @returns {Finding|null} One `missed-mate-in-1` finding, or null.
 * @throws {Error} When the move is not legal in the position.
 */
export function detectMissedMateInOne(fenBefore, move) {
  const played = playMove(fenBefore, move);
  if (played.san.endsWith('#')) return null;
  const mate = findMateInOne(fenBefore);
  if (!mate) return null;
  return { type: 'missed-mate-in-1', severity: 'critical', tier: 1, move: mate, piece: mate.piece, kingSquare: kingSquare(fenBefore, otherColor(played.color)) };
}

// True when at least one legal move does not allow a mate in one. Used only when no engine line can answer the question.
function canAvoidMateInOne(fenBefore) {
  const chess = new Chess(fenBefore);
  for (const san of chess.moves()) {
    chess.move(san);
    const mated = chess.moves().some((text) => text.endsWith('#'));
    chess.undo();
    if (!mated) return true;
  }
  return false;
}

/**
 * Check if the opponent can give checkmate in one move after the played move. Nothing is reported when every legal move allowed a mate in one, because the player could not do better.
 * @param {string} fenBefore
 * @param {{ from: string, to: string, promotion?: string }} move The played move.
 * @param {EngineContext|null} [engine] When the engine's best line is known it answers "could the player avoid it". Without it the answer is found by trying every legal move.
 * @returns {Finding|null} One `allowed-mate-in-1` finding, or null.
 * @throws {Error} When the move is not legal in the position.
 */
export function detectAllowedMateInOne(fenBefore, move, engine = null) {
  const played = playMove(fenBefore, move);
  const mate = findMateInOne(played.after);
  if (!mate) return null;
  const avoidable = engine?.best ? engine.best.mate !== -1 : canAvoidMateInOne(fenBefore);
  if (!avoidable) return null;
  return { type: 'allowed-mate-in-1', severity: 'critical', tier: 1, move: mate, piece: mate.piece, kingSquare: kingSquare(played.after, played.color) };
}

/**
 * Longer forced mates, taken from the engine scores: the player had a forced mate and the played move gives it up, or the played move allows a forced mate that the best move did not allow. Mates in one are left to the two detectors above.
 * @param {string} fenBefore
 * @param {{ from: string, to: string, promotion?: string }} move The played move.
 * @param {EngineContext|null} engine
 * @returns {Finding[]} Zero, one or two findings of type `missed-mate` and `allowed-mate`.
 * @throws {Error} When the move is not legal in the position.
 */
export function detectEngineMates(fenBefore, move, engine) {
  const best = engine?.best ?? null;
  const played = engine?.played ?? null;
  if (!best || !played) return [];
  const findings = [];
  const playedStillMates = played.mate !== null && played.mate > 0;
  if (best.mate !== null && best.mate >= 2 && !playedStillMates) {
    const first = tryMove(new Chess(fenBefore), parseUci(best.move));
    if (first) {
      findings.push({ type: 'missed-mate', severity: played.value >= STILL_WINNING_CP ? 'minor' : 'major', tier: 2, mateIn: best.mate, move: moveRef(first) });
    }
  }
  const bestAlreadyLost = best.mate !== null && best.mate <= 0;
  if (played.mate !== null && played.mate <= -2 && !bestAlreadyLost) {
    const reply = tryMove(new Chess(playMove(fenBefore, move).after), parseUci(played.pv?.[1]));
    findings.push({ type: 'allowed-mate', severity: 'critical', tier: 2, mateIn: -played.mate, move: reply ? moveRef(reply) : null });
  }
  return findings;
}

// A sliding piece of `side` looks along one ray at two enemy pieces in a row. Depending on which one is worth more this is a pin (the front piece shields the back one) or a skewer (the front piece must move and the back one is lost).
function classifyLine(chess, attacker, front, behind, diagonal) {
  const enemy = front.color;
  const attackerValue = pieceValue(attacker.type);
  const frontValue = pieceValue(front.type);
  const behindValue = pieceValue(behind.type);
  const frontCanCaptureBack = front.type === 'q' || (diagonal ? front.type === 'b' : front.type === 'r');
  const behindDefended = chess.attackers(behind.square, enemy).length > 0;
  const names = { attacker: { square: attacker.square, piece: attacker.type }, front: { square: front.square, piece: front.type }, behind: { square: behind.square, piece: behind.type } };

  if (behind.type === 'k') {
    // A pinned pawn is seldom the reason for anything, and a piece that can simply take the attacker back is not really pinned, unless it is worth more than the attacker.
    if (front.type === 'p') return null;
    if (frontCanCaptureBack && frontValue <= attackerValue) return null;
    return { kind: 'pin', absolute: true, attacker: names.attacker, pinned: names.front, behind: names.behind };
  }
  if (front.type === 'k' || frontValue > behindValue) {
    if (behindValue < TACTIC_MIN_TARGET_VALUE) return null;
    if (front.type !== 'k' && frontValue <= attackerValue) return null;
    if (behindValue <= attackerValue && behindDefended) return null;
    return { kind: 'skewer', attacker: names.attacker, front: names.front, behind: names.behind };
  }
  if (behindValue > frontValue) {
    if (front.type === 'p' || frontCanCaptureBack) return null;
    if (behindValue <= attackerValue && behindDefended) return null;
    return { kind: 'pin', absolute: false, attacker: names.attacker, pinned: names.front, behind: names.behind };
  }
  return null;
}

function findLineTactics(chess, side) {
  const found = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== side) continue;
      const steps = cell.type === 'b' ? DIAGONAL_STEPS : cell.type === 'r' ? STRAIGHT_STEPS : cell.type === 'q' ? ALL_STEPS : null;
      if (!steps) continue;
      for (const step of steps) {
        const [front, behind] = piecesOnRay(chess, cell.square, step);
        if (!front || !behind || front.color === side || behind.color === side) continue;
        const tactic = classifyLine(chess, cell, front, behind, step[0] !== 0 && step[1] !== 0);
        if (tactic) found.push(tactic);
      }
    }
  }
  return found;
}

function lineTacticKey(tactic) {
  const front = tactic.kind === 'pin' ? tactic.pinned : tactic.front;
  return `${tactic.kind}:${tactic.attacker.square}:${front.square}:${tactic.behind.square}`;
}

function findFork(chess, square) {
  const forker = chess.get(square);
  if (!forker || forker.type === 'k') return null;
  const enemy = otherColor(forker.color);
  const forkerValue = pieceValue(forker.type);
  const targets = [];
  for (const attacked of attackedSquares(chess, square)) {
    const piece = chess.get(attacked);
    if (!piece || piece.color !== enemy) continue;
    const value = pieceValue(piece.type);
    // A target is a piece the opponent must save: the king, a piece worth more than the forking piece, or a piece of at least knight value that nothing defends.
    const isTarget = piece.type === 'k' || value > forkerValue || (value >= TACTIC_MIN_TARGET_VALUE && chess.attackers(attacked, enemy).length === 0);
    if (isTarget) targets.push({ square: attacked, piece: piece.type });
  }
  if (targets.length < 2) return null;
  targets.sort((a, b) => exchangeValue(b.piece) - exchangeValue(a.piece));
  return { kind: 'fork', piece: forker.type, square, targets };
}

// A tactic only works when the piece that makes it can not simply be taken. "Safe" means the side to move has no capture of it that breaks even or better.
function isSafeFromCapture(chess, square) {
  const capture = bestCaptureOn(chess, square);
  return !capture || capture.gain < 0;
}

/**
 * Name the tactic that a move creates: a fork, a skewer or a pin. Only tactics that are new after the move count, and only when the piece that makes the tactic can not be taken for free or traded off.
 * @param {string} fen The position before the move.
 * @param {string} uci The move in UCI form.
 * @returns {({ kind: 'fork'|'pin'|'skewer', move: import('./board-utils.js').MoveRef } & Record<string, unknown>)|null} The tactic with the fields listed under `Finding`, or null when the move is not legal or creates no tactic.
 */
export function detectTactic(fen, uci) {
  const chess = new Chess(fen);
  const side = chess.turn();
  const before = new Set(findLineTactics(chess, side).map(lineTacticKey));
  const made = tryMove(chess, parseUci(uci));
  if (!made || chess.isCheckmate() || chess.isStalemate()) return null;
  const move = moveRef(made);
  const fork = findFork(chess, made.to);
  if (fork && isSafeFromCapture(chess, made.to)) return { ...fork, move };
  const lineTactics = findLineTactics(chess, side).filter((tactic) => !before.has(lineTacticKey(tactic)) && isSafeFromCapture(chess, tactic.attacker.square));
  const chosen = lineTactics.find((tactic) => tactic.kind === 'skewer') ?? lineTactics.find((tactic) => tactic.kind === 'pin');
  return chosen ? { ...chosen, move } : null;
}

/**
 * Check a move against a few simple opening principles. This is advice, not a tactic, so the report only uses it when the engine calls the move weak and no tactical finding explains why.
 * @param {string} fenBefore
 * @param {{ from: string, to: string, promotion?: string }} move The played move.
 * @returns {Finding|null} One `opening-principle` finding, or null when the opening is over or the move breaks no principle.
 * @throws {Error} When the move is not legal in the position.
 */
export function detectOpeningPrinciple(fenBefore, move) {
  const before = new Chess(fenBefore);
  const moveNumber = before.moveNumber();
  if (moveNumber > OPENING_MAX_MOVE) return null;
  const made = playMove(fenBefore, move);
  // A capture, castling and a move made while in check all have a reason of their own.
  if (before.inCheck() || made.captured || made.isKingsideCastle() || made.isQueensideCastle()) return null;
  const color = made.color;
  const home = MINOR_HOME_SQUARES[color];
  const undeveloped = ['n', 'b'].reduce((count, type) => count + home[type].filter((square) => before.get(square)?.type === type && before.get(square).color === color).length, 0);
  const finding = (principle) => ({ type: 'opening-principle', severity: 'minor', tier: 2, principle, piece: made.piece, square: made.to, move: moveRef(made) });

  const rights = before.getCastlingRights(color);
  if (made.piece === 'k' && (rights.k || rights.q)) return finding('king-move');
  const stillDeveloping = undeveloped >= OPENING_MIN_UNDEVELOPED;
  if (made.piece === 'q' && moveNumber <= EARLY_QUEEN_MAX_MOVE && stillDeveloping) return finding('early-queen');
  const isMinor = made.piece === 'n' || made.piece === 'b';
  const leavesHome = isMinor && home[made.piece].includes(made.from);
  if (isMinor && !leavesHome && stillDeveloping) return finding('same-piece-twice');
  if (made.piece === 'p' && (made.from[0] === 'a' || made.from[0] === 'h')) return finding('edge-pawn');
  const centerPawn = made.piece === 'p' && (made.from[0] === 'd' || made.from[0] === 'e');
  if (!leavesHome && !centerPawn && stillDeveloping) return finding('no-development');
  return null;
}

/**
 * Check if the played move ends the game in stalemate.
 * @param {string} fenBefore
 * @param {{ from: string, to: string, promotion?: string }} move The played move.
 * @returns {Finding|null} One `caused-stalemate` finding, or null. It is a problem (`major`) when the player was at least a knight ahead, and neutral (`info`) otherwise.
 * @throws {Error} When the move is not legal in the position.
 */
export function detectStalemate(fenBefore, move) {
  const made = playMove(fenBefore, move);
  const after = new Chess(made.after);
  if (!after.isStalemate()) return null;
  const material = materialCount(after);
  const materialLead = material[made.color].points - material[otherColor(made.color)].points;
  return { type: 'caused-stalemate', severity: materialLead >= TACTIC_MIN_TARGET_VALUE ? 'major' : 'info', tier: 1, materialLead };
}

function tacticFinding(prefix, tactic) {
  const { kind, ...data } = tactic;
  return { type: `${prefix}-${kind}`, severity: 'major', tier: 2, ...data };
}

// Could the piece on this square already be taken with profit before the player moved? The question is asked on the same position with the other side to move. When the player is in check that position would not be legal, so the answer is "no".
function wasHangingBefore(fenBefore, square) {
  const before = new Chess(fenBefore);
  if (before.inCheck()) return false;
  const parts = fenBefore.trim().split(/\s+/);
  parts[1] = otherColor(before.turn());
  parts[3] = '-';
  const capture = bestCaptureOn(new Chess(parts.join(' '), { skipValidation: true }), square);
  return Boolean(capture) && capture.gain > 0;
}

// What the engine's best move would have done for a piece that is now hanging: keep it where it is and make it safe, move it away, or take the attacker. This is only said about a piece that was in danger before the move too. When the played move itself put the piece in danger, for example by moving its defender away, the best move did not "protect" anything and the answer is null.
function findRemedy(fenBefore, bestUci, finding) {
  if (!wasHangingBefore(fenBefore, finding.square)) return null;
  const chess = new Chess(fenBefore);
  const made = tryMove(chess, parseUci(bestUci));
  if (!made) return null;
  const square = made.from === finding.square ? made.to : finding.square;
  const piece = chess.get(square);
  if (!piece || piece.color !== finding.color) return null;
  const capture = bestCaptureOn(chess, square);
  if (capture && capture.gain > 0) return null;
  if (made.from === finding.square) return 'retreat';
  if (made.captured && made.to === finding.capture.from) return 'capture-attacker';
  return 'protect';
}

function replyTakes(reply, finding) {
  if (!reply || reply.to !== finding.capture.to) return false;
  // For en passant the landing square is empty, so only a move by one of the listed attackers is a capture of that pawn.
  return finding.capture.to === finding.square || finding.attackers.some((attacker) => attacker.square === reply.from);
}

/**
 * Put findings in order of importance: problems first, then praise, then neutral notes. Among problems, a hanging piece that the engine does not take comes after the others, then the more serious finding comes first, then the order in FINDING_PRIORITY decides, then the bigger material value.
 * @param {Finding[]} findings
 * @returns {Finding[]} A new sorted array.
 */
export function sortFindings(findings) {
  const group = (finding) => (isNegativeFinding(finding) ? 0 : finding.severity === 'good' ? 1 : 2);
  const priority = (finding) => {
    const index = FINDING_PRIORITY.indexOf(finding.type);
    return index === -1 ? FINDING_PRIORITY.length : index;
  };
  return [...findings].sort(
    (a, b) =>
      group(a) - group(b) ||
      Number(a.confirmed === false) - Number(b.confirmed === false) ||
      SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) ||
      priority(a) - priority(b) ||
      (b.points ?? 0) - (a.points ?? 0),
  );
}

/**
 * Run every detector for one move and return the findings in order of importance. Static detectors (hanging piece, free capture, mate in one, stalemate) always run. When the engine context is given, it removes findings that the engine shows to be wrong, such as a "hanging" piece that is really a good sacrifice, and it adds the findings that need the engine: longer mates, forks, pins, skewers, opening advice and the top move.
 * @param {{ fenBefore: string, move: { from: string, to: string, promotion?: string }, engine?: EngineContext|null }} input
 * @returns {Finding[]}
 * @throws {Error} When the move is not legal in the position.
 */
export function detectFindings({ fenBefore, move, engine = null }) {
  const played = playMove(fenBefore, move);
  const fenAfter = played.after;
  if (played.san.endsWith('#')) return [{ type: 'delivered-checkmate', severity: 'good', tier: 1, move: moveRef(played) }];

  const context = { ...NO_ENGINE, ...(engine ?? {}) };
  const rating = context.rating ?? null;
  const weak = WEAK_RATINGS.includes(rating);
  const engineLikesMove = rating === 'best' || rating === 'excellent';
  const findings = [];

  const missedMateInOne = detectMissedMateInOne(fenBefore, move);
  if (missedMateInOne) findings.push(missedMateInOne);

  const stalemate = detectStalemate(fenBefore, move);
  if (stalemate) return sortFindings([...findings, stalemate]);

  const allowedMateInOne = detectAllowedMateInOne(fenBefore, move, context);
  if (allowedMateInOne) findings.push(allowedMateInOne);

  for (const finding of detectEngineMates(fenBefore, move, context)) {
    const shadowed = finding.type === 'missed-mate' ? missedMateInOne : allowedMateInOne;
    if (!shadowed) findings.push(finding);
  }

  // A piece that looks hanging after a move the engine likes is a sacrifice, a gambit or a trap, so it is not reported.
  if (!engineLikesMove) {
    const reply = parseUci(context.played?.pv?.[1]);
    const capturedValue = played.captured ? pieceValue(played.captured) : 0;
    for (const finding of detectHangingPieces(fenAfter, { movedTo: played.to, capturedValue })) {
      finding.confirmed = reply ? replyTakes(reply, finding) : null;
      if (rating === 'good' && finding.confirmed === false) continue;
      if (context.best && !context.isTopMove && !finding.moved) finding.remedy = findRemedy(fenBefore, context.best.move, finding);
      findings.push(finding);
    }
  }

  const missedCapture = detectMissedCapture(fenBefore, move, context);
  if (missedCapture) findings.push(missedCapture);

  if (!weak) {
    const wonMaterial = detectWonMaterial(fenBefore, move);
    if (wonMaterial) findings.push(wonMaterial);
  }

  if (weak) {
    const reply = context.played?.pv?.[1];
    if (reply && !allowedMateInOne) {
      const tactic = detectTactic(fenAfter, reply);
      if (tactic) findings.push(tacticFinding('allowed', tactic));
    }
    if (context.best && !context.isTopMove && !missedMateInOne) {
      const tactic = detectTactic(fenBefore, context.best.move);
      if (tactic) findings.push(tacticFinding('missed', tactic));
    }
    if (!findings.some(isNegativeFinding)) {
      const principle = detectOpeningPrinciple(fenBefore, move);
      if (principle) findings.push(principle);
    }
  }

  if (context.isTopMove) findings.push({ type: 'top-move', severity: 'good', tier: 1, equalMoves: [...(context.equalMoves ?? [])] });

  return sortFindings(findings);
}
