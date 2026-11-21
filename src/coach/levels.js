// The three feedback levels as data. A level is only a set of limits and switches: which findings it may show, what makes it stop the game, and which parts of the feedback are on. The detectors and the report do not know about levels at all.
import { BETTER_LINE_MAX_PLIES, GHOST_LINE_MAX_PLIES } from './constants.js';

/**
 * One feedback level.
 * @typedef {Object} FeedbackLevel
 * @property {1|2|3} id
 * @property {1|2|3} maxTier The highest concept tier this level shows. A finding with a higher tier is hidden.
 * @property {string[]} flagRatings Ratings that make the coach stop the game and ask the player to look. Level 1 has none: it never stops for a rating alone.
 * @property {Record<number, 'minor'|'major'|'critical'>} flagSeverityByTier For each concept tier, the mildest finding that makes the coach stop the game. A tier that is not listed never stops the game.
 * @property {'kid'|'standard'|'expert'} style Which set of texts is used.
 * @property {boolean} kidNames True to use the kid names for pieces, such as "horse" for the knight.
 * @property {boolean} explainByEngineLine True when a weak move with no named cause is explained with the engine's line and the material outcome.
 * @property {number} ghostPlies Longest ghost line after the played move.
 * @property {number} betterPlies Longest line shown for the better move.
 * @property {Object} view Which parts of the feedback are on.
 * @property {boolean} view.ratingLabel The rating word, such as "Mistake".
 * @property {boolean} view.stars One to three stars in place of a rating word.
 * @property {boolean} view.evaluation The evaluation number, such as "+0.8".
 * @property {boolean} view.notation Chess notation in the text, such as "Bxf3".
 * @property {boolean} view.moveNumbers Move numbers in front of the notation, such as "9...Bxf3".
 * @property {boolean} view.engineLine The full engine lines.
 * @property {boolean} view.ghostLine The ghost line animation.
 * @property {boolean} view.betterMoveText The better move named in the text under the main sentence.
 * @property {boolean} view.moveList The move list next to the board. The brief hides it at level 1.
 * @property {Record<'great'|'good'|'ok'|'warn'|'bad', number>|null} starsByTone Stars for each tone, or null when the level shows no stars.
 */

/** @type {Readonly<Record<1|2|3, FeedbackLevel>>} */
export const LEVELS = Object.freeze({
  // Beginner: only what can happen on the next move. Glowing pieces, arrows, faces and stars, one short sentence.
  1: Object.freeze({
    id: 1,
    maxTier: 1,
    flagRatings: Object.freeze([]),
    flagSeverityByTier: Object.freeze({ 1: 'minor' }),
    style: 'kid',
    kidNames: true,
    explainByEngineLine: false,
    ghostPlies: 1,
    betterPlies: 1,
    view: Object.freeze({ ratingLabel: false, stars: true, evaluation: false, notation: false, moveNumbers: false, engineLine: false, ghostLine: true, betterMoveText: false, moveList: false }),
    starsByTone: Object.freeze({ great: 3, good: 3, ok: 2, warn: 1, bad: 1 }),
  }),
  // Intermediate: level 1 plus mistakes, blunders and missed tactics. A rating label, a short explanation and the ghost line.
  2: Object.freeze({
    id: 2,
    maxTier: 2,
    flagRatings: Object.freeze(['mistake', 'blunder']),
    flagSeverityByTier: Object.freeze({ 1: 'minor', 2: 'major' }),
    style: 'standard',
    kidNames: false,
    explainByEngineLine: true,
    ghostPlies: GHOST_LINE_MAX_PLIES,
    betterPlies: BETTER_LINE_MAX_PLIES,
    view: Object.freeze({ ratingLabel: true, stars: false, evaluation: false, notation: true, moveNumbers: false, engineLine: false, ghostLine: true, betterMoveText: true, moveList: true }),
    starsByTone: null,
  }),
  // Advanced: level 2 plus inaccuracies. Rating, evaluation number, notation with move numbers and the engine lines.
  3: Object.freeze({
    id: 3,
    maxTier: 3,
    flagRatings: Object.freeze(['inaccuracy', 'mistake', 'blunder']),
    flagSeverityByTier: Object.freeze({ 1: 'minor', 2: 'major', 3: 'major' }),
    style: 'expert',
    kidNames: false,
    explainByEngineLine: true,
    ghostPlies: GHOST_LINE_MAX_PLIES,
    betterPlies: BETTER_LINE_MAX_PLIES,
    view: Object.freeze({ ratingLabel: true, stars: false, evaluation: true, notation: true, moveNumbers: true, engineLine: true, ghostLine: true, betterMoveText: true, moveList: true }),
    starsByTone: null,
  }),
});

/** The level used when nothing else is known, and the starting value of the "Coach level" setting. It is Middle on purpose: the Beginner coach says too little to be helpful, so no player starts on it. A player can still pick Beginner in the settings. */
export const DEFAULT_LEVEL = 2;

/**
 * Look up a feedback level.
 * @param {1|2|3|FeedbackLevel} level A level number, or a level object, which is returned as it is.
 * @returns {FeedbackLevel}
 * @throws {RangeError} When the number is not 1, 2 or 3. A wrong level is a mistake in the calling code, for example a broken saved setting, and must not be hidden.
 */
export function getLevel(level) {
  if (level && typeof level === 'object' && level.view) return level;
  if (!Object.hasOwn(LEVELS, String(level))) throw new RangeError(`Coach: unknown feedback level "${level}". Use 1, 2 or 3.`);
  return LEVELS[level];
}
