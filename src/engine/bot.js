// The bot opponent: eight levels. Levels 1 to 3 let the engine rank every legal move and then pick from that list with randomness (Stockfish's weakest built-in setting is still far too strong for a beginner). Levels 4 to 8 use Stockfish's own skill setting with limited depth and time. All numbers here are tuning constants meant to be adjusted by playtesting.
import { Chess } from 'chess.js';

/**
 * @typedef {Object} BotLevel
 * @property {'ranked'|'skill'} kind
 * @property {number} depth Search depth limit.
 * @property {number} movetime Time limit in milliseconds.
 * @property {number} [temperature] Ranked levels: how random the pick is, in centipawns. Larger is weaker.
 * @property {number} [randomMove] Ranked levels: chance to play any legal move at all.
 * @property {number} [skill] Skill levels: Stockfish "Skill Level" 0..20.
 */

// How the eight levels are set. The ladder follows the eight Stockfish levels on Lichess, which rise in steps of about 300 rating points, moved one step down: level 1 here is an extra, very easy level for a child who has just finished the tutorial (like the easiest computer levels on Chess.com), and level 8 is the engine at full skill, like level 8 on Lichess. The targets are about 400, 700, 1000, 1300, 1600, 1900, 2200 and "as strong as it gets".
// Levels 4 to 7 use Stockfish Skill Level 0, 2, 4 and 5. The Stockfish team measured these at about 1320, 1608, 1923 and 2204 Elo against engines from the CCRL Blitz list, give or take 100 (commit a08b8d4 in the Stockfish repository, "Update UCI_Elo parameterization"). These are engine ratings, not FIDE or online ratings, and they were measured with the full engine, while the game ships the smaller "lite" build.
// Stockfish picks its weakened move at depth "skill + 1" and ignores any deeper search (Stockfish FAQ, "How do Skill Level and UCI_Elo work"). So a skill level needs a depth limit of at least skill + 1 to play at its rating, and a test checks this. The time limit is only a safety net for very slow devices.
// Levels 1 to 3 are below the weakest setting that Stockfish has, so no published rating exists for them. Their numbers are our own and must be checked by playing: level 3 has to stay clearly weaker than level 4.
/** @type {Record<number, BotLevel>} */
export const BOT_LEVELS = {
  1: { kind: 'ranked', depth: 5, movetime: 500, temperature: 520, randomMove: 0.22 },
  2: { kind: 'ranked', depth: 6, movetime: 600, temperature: 240, randomMove: 0.08 },
  3: { kind: 'ranked', depth: 8, movetime: 700, temperature: 150, randomMove: 0 },
  4: { kind: 'skill', depth: 4, movetime: 200, skill: 0 },
  5: { kind: 'skill', depth: 5, movetime: 300, skill: 2 },
  6: { kind: 'skill', depth: 6, movetime: 400, skill: 4 },
  7: { kind: 'skill', depth: 7, movetime: 500, skill: 5 },
  8: { kind: 'skill', depth: 13, movetime: 900, skill: 20 },
};
export const BOT_LEVEL_MIN = 1;
export const BOT_LEVEL_MAX = 8;

/** Scores are clamped to this range before the random pick, so even a forced mate is not always found by a weak level. */
const SCORE_CLAMP = 1200;
/** Never rank more moves than this in one search; positions with more legal moves are rare. */
const MAX_RANKED_MOVES = 60;

function lineScore(line) {
  if (line.mate !== null) return line.mate > 0 ? SCORE_CLAMP : -SCORE_CLAMP;
  return Math.max(-SCORE_CLAMP, Math.min(SCORE_CLAMP, line.cp ?? 0));
}

/**
 * Pick a move from ranked engine lines with a "softmax" weight: moves close to the best score are likely, weak moves are possible. A higher temperature flattens the odds.
 * @param {import('./types.js').EngineLine[]} lines Best first.
 * @param {number} temperature Centipawns.
 * @param {() => number} [rng] Returns 0..1.
 * @returns {string|null} UCI move.
 */
export function pickWeighted(lines, temperature, rng = Math.random) {
  if (!lines || lines.length === 0) return null;
  const best = Math.max(...lines.map(lineScore));
  const weights = lines.map((line) => Math.exp((lineScore(line) - best) / Math.max(1, temperature)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < lines.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return lines[i].move;
  }
  return lines[lines.length - 1].move;
}

function toUci(move) {
  return move.from + move.to + (move.promotion ?? '');
}

/**
 * Choose the bot's move for a position.
 * @param {import('./engine.js').Engine} engine
 * @param {string} fen
 * @param {number} level 1..8
 * @param {() => number} [rng]
 * @returns {{promise: Promise<string|null>, cancel: () => void}} The promise resolves to a legal UCI move, or null when there is none or the search was cancelled.
 */
export function chooseBotMove(engine, fen, level, rng = Math.random) {
  const config = BOT_LEVELS[Math.max(BOT_LEVEL_MIN, Math.min(BOT_LEVEL_MAX, Math.round(level)))];
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).map(toUci);
  if (legal.length === 0) return { promise: Promise.resolve(null), cancel() {} };
  const randomLegal = () => legal[Math.floor(rng() * legal.length)];

  let search = null;
  let cancelled = false;
  const promise = (async () => {
    if (legal.length === 1) return legal[0];
    if (config.kind === 'ranked' && rng() < (config.randomMove ?? 0)) return randomLegal();
    search = engine.analyze(config.kind === 'ranked' ? { fen, multipv: Math.min(legal.length, MAX_RANKED_MOVES), depth: config.depth, movetime: config.movetime, skill: 20 } : { fen, multipv: 1, depth: config.depth, movetime: config.movetime, skill: config.skill });
    let result;
    try {
      result = await search;
    } catch (error) {
      // The game must go on even if the engine breaks: fall back to a random legal move and report the problem.
      console.error('[bot] engine search failed, playing a random legal move', error);
      return cancelled ? null : randomLegal();
    }
    if (cancelled || result.cancelled) return null;
    const choice = config.kind === 'ranked' ? pickWeighted(result.lines, config.temperature, rng) : result.bestmove;
    // Only ever return a move that is legal in this position.
    return choice && legal.includes(choice) ? choice : randomLegal();
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      search?.cancel();
    },
  };
}
