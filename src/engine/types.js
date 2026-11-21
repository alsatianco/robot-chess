// Shared data shapes between the engine wrapper, the bot and the coach. This file has no runtime code.

/**
 * One principal variation reported by Stockfish for an analyzed position.
 * @typedef {Object} EngineLine
 * @property {number} multipv 1-based rank; 1 is the engine's best move.
 * @property {number} depth Search depth reached for this line.
 * @property {string} move First move of the line in UCI form, for example "e2e4" or "e7e8q".
 * @property {string[]} pv The whole line as UCI moves. pv[0] === move.
 * @property {number|null} cp Score in centipawns from the point of view of the side to move in the analyzed position. null when `mate` is set.
 * @property {number|null} mate Moves until mate. Positive: the side to move gives mate. Negative: the side to move gets mated. null when `cp` is set.
 */

export {};
