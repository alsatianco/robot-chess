// Turns a move report into what the player sees: one or two sentences, a face, stars or a rating label, squares to light up, arrows and the lines to animate. All words come from the translator, so this file holds no user-facing text.
import { formatNumberedLine, otherColor } from './board-utils.js';
import { SEVERITIES, WEAK_RATINGS } from './constants.js';
import { isNegativeFinding } from './detectors.js';
import { getLevel } from './levels.js';

/**
 * What the screen shows for one move.
 * @typedef {Object} FeedbackView
 * @property {1|2|3} level The feedback level this view was made for.
 * @property {'best'|'excellent'|'good'|'inaccuracy'|'mistake'|'blunder'|null} rating The raw rating from the report, at every level. Level 1 must not show it as a word.
 * @property {'great'|'good'|'ok'|'warn'|'bad'} tone
 * @property {'wow'|'happy'|'neutral'|'worried'|'sad'} face
 * @property {number|null} stars 1 to 3 at level 1, null at the other levels.
 * @property {string|null} label The rating word at levels 2 and 3, null at level 1 or when there is no rating.
 * @property {string} text The main sentence or two.
 * @property {string|null} detail The better move, equal moves and, at level 3, the engine lines. null at level 1.
 * @property {string|null} evalText The evaluation after the move from White's point of view, such as "+0.8", "-1.8", "M3" or "-M2". Level 3 only.
 * @property {{ square: string, kind: 'danger'|'target'|'good'|'info' }[]} highlights
 * @property {{ from: string, to: string, kind: 'danger'|'good'|'info' }[]} arrows
 * @property {{ fen: string, moves: string[] }|null} ghostLine "What goes wrong": starts from the position after the played move and shows the opponent's reply and what follows, 1 to 3 plies.
 * @property {{ fen: string, moves: string[] }|null} betterLine Starts from the position before the played move and shows the better move and what follows, 1 to 3 plies.
 * @property {{ from: string, to: string, san: string, uci: string, promotion: string|null }|null} betterMove
 * @property {boolean} flagged True when this level wants the player to stop and look.
 * @property {import('./detectors.js').Finding|null} primaryFinding The finding the text is about.
 * @property {null} opening Always null here. The game fills in the opening name.
 */

const FACE_BY_TONE = Object.freeze({ great: 'wow', good: 'happy', ok: 'neutral', warn: 'worried', bad: 'sad' });
const SHAPE_DETAIL_KEYS = Object.freeze({ 'pawn-backward': 'pawnBackward', 'pawn-two-steps-late': 'pawnTwoStepsLate', 'pawn-too-far': 'pawnTooFar' });
const OWN_MOVE_TYPES = new Set(['missed-capture', 'missed-mate-in-1', 'missed-mate', 'missed-fork', 'missed-pin', 'missed-skewer']);
const THREAT_TYPES = new Set(['allowed-mate-in-1', 'allowed-mate', 'allowed-fork', 'allowed-pin', 'allowed-skewer']);

function severityAtLeast(severity, floor) {
  return floor !== undefined && SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(floor);
}

function pointsText(t, points) {
  return points === 1 ? t('coach.points.one') : t('coach.points.many', { n: points });
}

function joinNames(t, names) {
  if (names.length <= 1) return names[0] ?? '';
  const head = names.slice(0, -1).reduce((a, b) => t('coach.list.comma', { a, b }));
  return t('coach.list.and', { a: head, b: names[names.length - 1] });
}

function formatEval(score) {
  if (!score) return null;
  if (Number.isInteger(score.mate)) return score.mate < 0 ? `-M${-score.mate}` : `M${score.mate}`;
  if (!Number.isFinite(score.cp)) return null;
  const pawns = Math.abs(score.cp / 100).toFixed(1);
  if (pawns === '0.0') return pawns;
  return (score.cp > 0 ? '+' : '-') + pawns;
}

// Notation helpers. Level 3 puts the move number in front, the way chess books do. A move "of the player" starts from the position before the played move, a "reply" starts from the position after it.
function createNotation(report, cfg) {
  const numbered = cfg.view.moveNumbers;
  const replyNumber = report.color === 'w' ? report.moveNumber : report.moveNumber + 1;
  const replyColor = otherColor(report.color);
  const write = (sans, number, color) => (numbered ? formatNumberedLine(sans, number, color) : sans.join(' '));
  return {
    own: (san) => write([san], report.moveNumber, report.color),
    ownLine: (sans) => write(sans, report.moveNumber, report.color),
    reply: (san) => write([san], replyNumber, replyColor),
    replyLine: (sans) => write(sans, replyNumber, replyColor),
  };
}

function targetNames(finding, ctx) {
  const types = finding.targets.map((target) => target.piece);
  const hasTwins = new Set(types).size !== types.length;
  // "your rook and rook" reads badly, so twins are told apart by their squares.
  return joinNames(ctx.t, finding.targets.map((target) => (hasTwins ? ctx.t('coach.explain.pieceOn', { piece: ctx.name(target.piece), square: target.square }) : ctx.name(target.piece))));
}

function kidFindingText(finding, ctx) {
  const { t, name } = ctx;
  switch (finding.type) {
    case 'hanging-piece':
      return t('coach.kid.hanging', { piece: name(finding.piece), attacker: name(finding.capture.piece) });
    case 'missed-capture':
      return t('coach.kid.missedCapture', { piece: name(finding.piece), target: name(finding.targetPiece) });
    case 'missed-mate-in-1':
      return t('coach.kid.missedMate', { piece: name(finding.piece) });
    case 'allowed-mate-in-1':
      return t('coach.kid.allowedMate', { attacker: name(finding.piece) });
    case 'caused-stalemate':
      return t('coach.kid.stalemate');
    default:
      return null;
  }
}

function standardFindingText(finding, ctx) {
  const { t, name, notation } = ctx;
  const explain = (key, params) => t(`coach.explain.${key}`, params);
  switch (finding.type) {
    case 'hanging-piece':
      return explain(finding.defended ? 'hangingExchange' : 'hangingFree', { piece: name(finding.piece), square: finding.square, capture: notation.reply(finding.capture.san), points: pointsText(t, finding.points) });
    case 'missed-capture':
      return explain(finding.free ? 'missedCaptureFree' : 'missedCaptureExchange', { target: name(finding.targetPiece), square: finding.square, move: notation.own(finding.move.san), points: pointsText(t, finding.points) });
    case 'missed-mate-in-1':
      return explain('missedMateInOne', { move: notation.own(finding.move.san) });
    case 'allowed-mate-in-1':
      return explain('allowedMateInOne', { move: notation.reply(finding.move.san) });
    case 'missed-mate':
      return explain('missedMate', { n: finding.mateIn, move: notation.own(finding.move.san) });
    case 'allowed-mate':
      return finding.move ? explain('allowedMate', { n: finding.mateIn, move: notation.reply(finding.move.san) }) : explain('allowedMateNoMove', { n: finding.mateIn });
    case 'allowed-fork':
      return explain('allowedFork', { move: notation.reply(finding.move.san), targets: targetNames(finding, ctx) });
    case 'missed-fork':
      return explain('missedFork', { move: notation.own(finding.move.san), targets: targetNames(finding, ctx) });
    case 'allowed-pin':
      return explain(finding.absolute ? 'allowedPinAbsolute' : 'allowedPin', { move: notation.reply(finding.move.san), pinned: name(finding.pinned.piece), square: finding.pinned.square, behind: name(finding.behind.piece) });
    case 'missed-pin':
      return explain(finding.absolute ? 'missedPinAbsolute' : 'missedPin', { move: notation.own(finding.move.san), pinned: name(finding.pinned.piece), square: finding.pinned.square, behind: name(finding.behind.piece) });
    case 'allowed-skewer':
      return explain('allowedSkewer', { move: notation.reply(finding.move.san), front: name(finding.front.piece), behind: name(finding.behind.piece) });
    case 'missed-skewer':
      return explain('missedSkewer', { move: notation.own(finding.move.san), front: name(finding.front.piece), behind: name(finding.behind.piece) });
    case 'opening-principle':
      return explain(`opening.${finding.principle}`);
    case 'caused-stalemate':
      return explain('stalemate');
    default:
      return null;
  }
}

// A weak move with no named cause: show the engine's reply line and say what it costs. When no material changes hands, say that the position gets worse, in three sizes.
function outcomeText(report, ctx) {
  const { t, name, notation } = ctx;
  const material = report.material;
  const replies = report.playedLineSan.slice(1, material.plies);
  const line = notation.replyLine(replies);
  const noPromotion = material.playerGained.length === 0 && material.opponentGained.length === 0;
  if (replies.length > 0 && material.settled && material.net < 0) {
    if (noPromotion && material.playerLost.length === 1 && material.opponentLost.length === 0) return t('coach.explain.outcome.loseOne', { line, piece: name(material.playerLost[0]) });
    if (noPromotion && material.playerLost.length === 1 && material.opponentLost.length === 1) return t('coach.explain.outcome.loseForOne', { line, piece: name(material.playerLost[0]), other: name(material.opponentLost[0]) });
    return t('coach.explain.outcome.losePoints', { line, points: pointsText(t, -material.net) });
  }
  const size = report.rating === 'blunder' ? 'worseBig' : report.rating === 'mistake' ? 'worse' : 'worseSmall';
  return replies.length > 0 ? t(`coach.explain.outcome.${size}`, { line }) : t(`coach.explain.outcome.${size}NoLine`);
}

// What a good move wins. The engine line is trusted first, because it also sees wins that take two or three moves. Without it, the static finding for a winning capture is used.
function winText(report, visible, ctx) {
  const { t, name } = ctx;
  const material = report.material;
  const noPromotion = material.playerGained.length === 0 && material.opponentGained.length === 0;
  if (report.playedLineUci.length > 1 && material.settled && material.net > 0) {
    if (noPromotion && material.opponentLost.length === 1 && material.playerLost.length === 0) return t('coach.explain.win.one', { piece: name(material.opponentLost[0]) });
    if (noPromotion && material.opponentLost.length === 1 && material.playerLost.length === 1) return t('coach.explain.win.forOne', { piece: name(material.opponentLost[0]), other: name(material.playerLost[0]) });
    return t('coach.explain.win.points', { points: pointsText(t, material.net) });
  }
  const won = visible.find((finding) => finding.type === 'won-material');
  if (!won) return null;
  return won.free ? t('coach.explain.win.one', { piece: name(won.targetPiece) }) : t('coach.explain.win.points', { points: pointsText(t, won.points) });
}

function kidText(report, state, ctx) {
  const { t, name } = ctx;
  if (report.isCheckmate) return t('coach.kid.checkmate');
  const about = state.primaryNegative ?? state.stalemate;
  if (about) return kidFindingText(about, ctx) ?? standardFindingText(about, ctx) ?? t('coach.kid.soft');
  const won = state.visible.find((finding) => finding.type === 'won-material');
  if (won) return t('coach.kid.captured', { target: name(won.targetPiece) });
  if (report.rating === 'best') return t('coach.kid.great');
  if (report.rating === 'excellent' || report.rating === 'good') return t('coach.kid.good');
  if (report.rating === 'mistake' || report.rating === 'blunder') return t('coach.kid.soft');
  return t('coach.kid.ok');
}

function standardText(report, state, ctx) {
  const { t } = ctx;
  if (report.isCheckmate) return t('coach.explain.checkmate');
  const about = state.primaryNegative ?? state.stalemate;
  if (about) return standardFindingText(about, ctx) ?? outcomeText(report, ctx);
  if (state.weak) return outcomeText(report, ctx);
  const win = winText(report, state.visible, ctx);
  if (report.rating === null) return win ?? t('coach.explain.unrated');
  // The expert style opens with the rating and the number, so it needs no praise sentence.
  const praise = ctx.cfg.style === 'expert' ? null : t(`coach.explain.good.${report.rating}`);
  return [praise, win].filter(Boolean).join(' ');
}

function mainText(report, state, ctx, label, evalText) {
  if (ctx.cfg.style === 'kid') return kidText(report, state, ctx);
  const body = standardText(report, state, ctx);
  if (ctx.cfg.style !== 'expert' || !label) return body;
  const prefix = evalText ? ctx.t('coach.expert.prefix', { label, eval: evalText }) : ctx.t('coach.expert.prefixNoEval', { label });
  return [prefix, body].filter(Boolean).join(' ');
}

function detailText(report, state, ctx) {
  const { t, notation, cfg } = ctx;
  if (!cfg.view.betterMoveText) return null;
  const parts = [];
  const best = report.best;
  const about = state.primaryNegative;
  if (best && !report.isTopMove) {
    const bestText = notation.own(best.san);
    if (about && OWN_MOVE_TYPES.has(about.type)) {
      // The main text already names a move for the player. The engine's first move is added only when it is a different one.
      if (about.move.uci !== best.uci) parts.push(t('coach.better.top', { move: bestText }));
    } else if (state.weak || state.flagged) {
      // Level 2 says what the better move would have done for the piece. Level 3 keeps the short engine style.
      const remedy = cfg.style === 'standard' && about && about.type === 'hanging-piece' ? about.remedy : null;
      const key = remedy === 'protect' ? 'protect' : remedy === 'retreat' ? 'retreat' : remedy === 'capture-attacker' ? 'captureAttacker' : 'plain';
      parts.push(t(`coach.better.${key}`, { move: bestText }));
    } else {
      parts.push(t('coach.better.top', { move: bestText }));
    }
    if (report.equalMoves.length > 0) parts.push(t('coach.better.alsoGood', { moves: report.equalMoves.map(notation.own).join(', ') }));
  } else if (report.isTopMove && !report.isCheckmate) {
    const others = [...(best && best.uci !== report.moveUci ? [best.san] : []), ...report.equalMoves].map(notation.own);
    if (others.length === 1) parts.push(t('coach.better.equalOne', { moves: others[0] }));
    else if (others.length > 1) parts.push(t('coach.better.equalMany', { moves: joinNames(t, others) }));
  }
  if (cfg.view.engineLine) {
    if (report.playedLineSan.length > 1) parts.push(t('coach.expert.yourLine', { line: notation.ownLine(report.playedLineSan) }));
    // A best line of one move would only repeat the better move that was just named.
    if (best && best.uci !== report.moveUci && report.bestLineSan.length > 1) parts.push(t('coach.expert.bestLine', { line: notation.ownLine(report.bestLineSan) }));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function toneOf(report, state) {
  if (report.isCheckmate) return 'great';
  if (state.flagged) {
    const critical = state.flagging.some((finding) => finding.severity === 'critical') || (state.flaggedByRating && report.rating === 'blunder');
    return critical ? 'bad' : 'warn';
  }
  if (state.negatives.length > 0 || state.stalemate) return 'ok';
  if (report.rating === 'best') return 'great';
  if (report.rating === 'excellent' || report.rating === 'good') return 'good';
  if (report.rating === 'mistake' || report.rating === 'blunder') return 'warn';
  if (report.rating === 'inaccuracy') return 'ok';
  return state.visible.some((finding) => finding.severity === 'good') ? 'good' : 'ok';
}

function uniqueHighlights(highlights) {
  const seen = new Set();
  return highlights.filter((entry) => {
    if (!entry.square || seen.has(entry.square)) return false;
    seen.add(entry.square);
    return true;
  });
}

function moveArrow(move, kind) {
  return { from: move.from, to: move.to, kind };
}

// Squares and arrows for the finding the text is about. A threat is drawn in the danger color, a chance for the player in the good color.
function visualsFor(report, about) {
  const highlights = [];
  const arrows = [];
  if (!about) {
    highlights.push({ square: report.move.to, kind: 'info' });
    return { highlights, arrows };
  }
  const allowed = about.type.startsWith('allowed-');
  const arrowKind = allowed ? 'danger' : 'good';
  const squareKind = allowed ? 'danger' : 'target';
  switch (about.type) {
    case 'hanging-piece':
      highlights.push({ square: about.square, kind: 'danger' }, { square: about.capture.from, kind: 'info' });
      arrows.push(moveArrow(about.capture, 'danger'));
      break;
    case 'missed-capture':
      highlights.push({ square: about.square, kind: 'target' });
      arrows.push(moveArrow(about.move, 'good'));
      break;
    case 'missed-mate-in-1':
    case 'allowed-mate-in-1':
      highlights.push({ square: about.kingSquare, kind: squareKind });
      arrows.push(moveArrow(about.move, arrowKind));
      break;
    case 'missed-mate':
    case 'allowed-mate':
      if (about.move) arrows.push(moveArrow(about.move, arrowKind));
      break;
    case 'missed-fork':
    case 'allowed-fork':
      arrows.push(moveArrow(about.move, arrowKind));
      for (const target of about.targets) {
        highlights.push({ square: target.square, kind: squareKind });
        arrows.push({ from: about.square, to: target.square, kind: arrowKind });
      }
      break;
    case 'missed-pin':
    case 'allowed-pin':
      highlights.push({ square: about.pinned.square, kind: squareKind }, { square: about.behind.square, kind: squareKind });
      arrows.push(moveArrow(about.move, arrowKind), { from: about.attacker.square, to: about.behind.square, kind: arrowKind });
      break;
    case 'missed-skewer':
    case 'allowed-skewer':
      highlights.push({ square: about.front.square, kind: squareKind }, { square: about.behind.square, kind: squareKind });
      arrows.push(moveArrow(about.move, arrowKind), { from: about.attacker.square, to: about.behind.square, kind: arrowKind });
      break;
    case 'won-material':
    case 'top-move':
    case 'delivered-checkmate':
      highlights.push({ square: report.move.to, kind: 'good' });
      break;
    default:
      highlights.push({ square: report.move.to, kind: 'info' });
  }
  return { highlights: uniqueHighlights(highlights), arrows };
}

function threatUci(about) {
  if (!about) return null;
  if (about.type === 'hanging-piece') return about.capture.uci;
  if (THREAT_TYPES.has(about.type)) return about.move ? about.move.uci : null;
  return null;
}

// The ghost line must start with the move the text talks about. When the engine's reply is that same move, the line goes on with the engine's moves. When it is a different move, only the move from the text is shown.
function ghostLineFor(report, state, cfg) {
  if (!cfg.view.ghostLine || report.isCheckmate) return null;
  const replies = report.playedLineUci.slice(1);
  const threat = threatUci(state.primaryNegative);
  let moves = [];
  if (threat) moves = replies[0] === threat ? replies.slice(0, cfg.ghostPlies) : [threat];
  else if (!state.primaryNegative && state.weak && cfg.explainByEngineLine) moves = replies.slice(0, cfg.ghostPlies);
  return moves.length > 0 ? { fen: report.fenAfter, moves } : null;
}

function betterFor(report, state, cfg) {
  const about = state.primaryNegative;
  let move = null;
  if (about && OWN_MOVE_TYPES.has(about.type)) move = about.move;
  else if (report.best && !report.isTopMove) move = report.best;
  if (!move) return { betterMove: null, betterLine: null };
  const fromEngine = report.best && report.best.uci === move.uci;
  const moves = fromEngine ? report.bestLineUci.slice(0, cfg.betterPlies) : [move.uci];
  return {
    betterMove: { from: move.from, to: move.to, san: move.san, uci: move.uci, promotion: move.promotion ?? null },
    betterLine: { fen: report.fenBefore, moves },
  };
}

/**
 * Turn a move report into the view model for one feedback level.
 * @param {import('./report.js').MoveReport} report The result of `buildMoveReport`.
 * @param {1|2|3|import('./levels.js').FeedbackLevel} level
 * @param {(key: string, params?: Record<string, string|number>) => string} t The translator. The coach's texts must be mounted under the key `coach`.
 * @returns {FeedbackView}
 * @throws {Error} When the report, the level or the translator is not valid. These are mistakes in the calling code.
 */
export function presentFeedback(report, level, t) {
  const cfg = getLevel(level);
  if (!report || typeof report !== 'object' || !Array.isArray(report.findings)) throw new TypeError('presentFeedback: expected a report from buildMoveReport.');
  if (typeof t !== 'function') throw new TypeError('presentFeedback: expected a translate function.');

  const visible = report.findings.filter((finding) => finding.tier <= cfg.maxTier);
  const negatives = visible.filter(isNegativeFinding);
  const flagging = negatives.filter((finding) => severityAtLeast(finding.severity, cfg.flagSeverityByTier[finding.tier]));
  const flaggedByRating = cfg.flagRatings.includes(report.rating);
  const state = {
    visible,
    negatives,
    flagging,
    flaggedByRating,
    flagged: !report.isCheckmate && (flagging.length > 0 || flaggedByRating),
    primaryNegative: report.isCheckmate ? null : (flagging[0] ?? negatives[0] ?? null),
    stalemate: visible.find((finding) => finding.type === 'caused-stalemate') ?? null,
    weak: WEAK_RATINGS.includes(report.rating),
  };
  const primaryFinding = state.primaryNegative ?? state.stalemate ?? visible.find((finding) => finding.severity === 'good') ?? null;

  const ctx = {
    t,
    cfg,
    name: (type) => t(`coach.${cfg.kidNames ? 'pieceKid' : 'piece'}.${type}`),
    notation: createNotation(report, cfg),
  };
  const tone = toneOf(report, state);
  const label = cfg.view.ratingLabel && report.rating ? t(`coach.rating.${report.rating}`) : null;
  let evalText = null;
  if (cfg.view.evaluation) evalText = report.isCheckmate ? '#' : formatEval(report.evalAfter);
  const { highlights, arrows } = visualsFor(report, primaryFinding);
  const { betterMove, betterLine } = betterFor(report, state, cfg);

  return {
    level: cfg.id,
    rating: report.rating,
    tone,
    face: FACE_BY_TONE[tone],
    stars: cfg.view.stars && cfg.starsByTone ? cfg.starsByTone[tone] : null,
    label,
    text: mainText(report, state, ctx, label, evalText),
    detail: detailText(report, state, ctx),
    evalText,
    highlights,
    arrows,
    ghostLine: ghostLineFor(report, state, cfg),
    betterLine,
    betterMove,
    flagged: state.flagged,
    primaryFinding,
    opening: null,
  };
}

function illegalKey(reason) {
  const params = reason.params ?? {};
  switch (reason.code) {
    case 'game-over':
      return params.reason === 'stalemate' ? 'gameOverStalemate' : 'gameOverCheckmate';
    case 'no-piece':
      return 'noPiece';
    case 'not-your-turn':
      return 'notYourTurn';
    case 'not-your-piece':
      return 'notYourPiece';
    case 'same-square':
      return 'sameSquare';
    case 'own-piece':
      return 'ownPiece';
    case 'wrong-shape':
      return `shape.${SHAPE_DETAIL_KEYS[params.detail] ?? params.piece}`;
    case 'blocked':
      return params.blockerIsOwn ? 'blockedOwn' : 'blockedOther';
    case 'pawn-blocked':
      return params.blockerIsOwn ? 'pawnBlockedOwn' : 'pawnBlockedOther';
    case 'pawn-capture-empty':
      return 'pawnCaptureEmpty';
    case 'pawn-straight-capture':
      return 'pawnStraightCapture';
    case 'leaves-king-in-check':
      return params.kind === 'king-into-attack' ? 'kingIntoAttack' : 'pinned';
    case 'must-answer-check':
      return 'mustAnswerCheck';
    case 'castle-king-moved':
      return 'castleKingMoved';
    case 'castle-rook-moved':
      return params.rookMissing ? 'castleRookMissing' : 'castleRookMoved';
    case 'castle-blocked':
      return params.blockerIsOwn ? 'castleBlockedOwn' : 'castleBlockedOther';
    case 'castle-in-check':
      return 'castleInCheck';
    case 'castle-through-check':
      return 'castleThroughCheck';
    case 'castle-into-check':
      return 'castleIntoCheck';
    default:
      return 'notAllowed';
  }
}

/**
 * Turn the result of `explainIllegalMove` into a sentence and the squares and arrows that show the reason.
 * @param {import('./illegal.js').IllegalReason|null} reason
 * @param {1|2|3|import('./levels.js').FeedbackLevel} level Level 1 gets kid words and no square names. Levels 2 and 3 share the same text.
 * @param {(key: string, params?: Record<string, string|number>) => string} t The translator.
 * @returns {{ text: string, highlights: { square: string, kind: 'danger'|'target'|'good'|'info' }[], arrows: { from: string, to: string, kind: 'danger'|'good'|'info' }[] }|null} null when `reason` is null, which means the move was legal.
 * @throws {Error} When the level or the translator is not valid.
 */
export function presentIllegal(reason, level, t) {
  const cfg = getLevel(level);
  if (typeof t !== 'function') throw new TypeError('presentIllegal: expected a translate function.');
  if (!reason) return null;
  const params = reason.params ?? {};
  const name = (type) => (type ? t(`coach.${cfg.kidNames ? 'pieceKid' : 'piece'}.${type}`) : '');
  const attackerSquare = params.attacker ?? params.checker ?? null;
  const style = cfg.kidNames ? 'kid' : 'standard';
  const text = t(`coach.illegal.${style}.${illegalKey(reason)}`, {
    from: params.from ?? '',
    to: params.to ?? '',
    piece: name(params.piece),
    target: name(params.targetPiece),
    blocker: name(params.blockerPiece),
    blockerSquare: params.blocker ?? '',
    attacker: name(params.attackerPiece ?? params.checkerPiece),
    attackerSquare: attackerSquare ?? '',
    square: params.square ?? '',
    rook: params.rook ?? '',
  });

  const highlights = [];
  const arrows = [];
  if (reason.code !== 'no-piece') highlights.push({ square: params.from, kind: 'info' });
  if (params.blocker) highlights.push({ square: params.blocker, kind: 'info' });
  if (reason.code === 'own-piece' || reason.code === 'pawn-straight-capture') highlights.push({ square: params.to, kind: 'info' });
  if (reason.code === 'castle-rook-moved' && !params.rookMissing) highlights.push({ square: params.rook, kind: 'info' });
  if (attackerSquare) {
    const attacked = params.square ?? params.king ?? null;
    highlights.push({ square: attackerSquare, kind: 'danger' });
    if (attacked) {
      highlights.push({ square: attacked, kind: 'danger' });
      arrows.push({ from: attackerSquare, to: attacked, kind: 'danger' });
    }
  }
  // A square can be named twice, for example the king's start square and the attacked square. The more serious mark wins.
  const danger = new Set(highlights.filter((entry) => entry.kind === 'danger').map((entry) => entry.square));
  return { text, highlights: uniqueHighlights(highlights.map((entry) => (danger.has(entry.square) ? { ...entry, kind: 'danger' } : entry))), arrows };
}
