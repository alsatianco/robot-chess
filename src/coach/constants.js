// Every number the coach uses to judge a move lives in this file, so that play testing can tune the coach in one place. Nothing here has logic.

/** Point value of each piece type, the way kids learn it: pawn 1, knight 3, bishop 3, rook 5, queen 9. The king is never traded, so its value is 0. */
export const PIECE_VALUES = Object.freeze({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 });

/** Value given to the king only inside exchange math, so that the king is always the last piece chosen to capture. */
export const KING_EXCHANGE_VALUE = 100;

/** All ratings, from the best to the worst. The order matters: a higher index is a worse move. */
export const RATINGS = Object.freeze(['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']);

/** Ratings that count as a weak move. Only a weak move gets named tactics and opening advice. */
export const WEAK_RATINGS = Object.freeze(['inaccuracy', 'mistake', 'blunder']);

/** Severity levels of a finding, from the mildest to the worst. `good` is praise, `info` is neutral, the other three are problems. */
export const SEVERITIES = Object.freeze(['good', 'info', 'minor', 'major', 'critical']);

/** A move that scores within this many centipawns of the engine's first move counts as a top move. The brief asks for 10 to 20. */
export const EQUAL_MOVE_WINDOW_CP = 15;

/** Slope of the win chance curve. This is the constant from the Lichess formula: winChance = 50 + 50 * (2 / (1 + exp(-slope * cp)) - 1). */
export const WIN_CHANCE_SLOPE = 0.00368208;

/** Centipawn value that stands for "mate now". A mate in N moves is worth MATE_SCORE_CP minus N times MATE_STEP_CP, so a faster mate is always better than a slower one. */
export const MATE_SCORE_CP = 100000;

/** Centipawns taken off MATE_SCORE_CP for each move until mate. It is bigger than EQUAL_MOVE_WINDOW_CP on purpose, so that a slower mate is never called equal to a faster one. */
export const MATE_STEP_CP = 20;

/** Mate distances longer than this are treated as this distance, so that a mate score always stays far above any normal score. */
export const MATE_MAX_DISTANCE = 100;

/** Normal (non-mate) scores are limited to this size, so that they can never look like a mate score. */
export const MAX_PLAIN_CP = 50000;

/** Upper limits of win chance loss, in percentage points from the mover's point of view, for each rating. A loss above the `mistake` limit is a blunder. */
export const RATING_MAX_WIN_CHANCE_LOSS = Object.freeze({ excellent: 2, good: 5, inaccuracy: 10, mistake: 20 });

/** A move can be `excellent` only when it also loses no more than this many centipawns. In a position that is already won the win chance hardly moves, and this keeps a move that gives away material from being called excellent. */
export const EXCELLENT_MAX_CP_LOSS = 50;

/** Mate rules, the same idea as on Lichess. When a move throws away a forced mate, or walks into one, the rating can not be better than `inaccuracy` if the other score is still beyond this value, because the game was decided anyway. */
export const MATE_SWING_DECIDED_CP = 999;

/** Second step of the mate rules: the rating can not be better than `mistake` if the other score is beyond this value. Below it, giving up a forced mate or walking into one is a `blunder`. */
export const MATE_SWING_CLEAR_CP = 700;

/** After a missed forced mate the player is still "winning anyway" when the played move keeps at least this score. The finding is then only a minor one. */
export const STILL_WINNING_CP = 700;

/** A hanging piece or a missed capture worth at least this many points is `critical`. 5 is a rook. */
export const MATERIAL_SEVERITY_CRITICAL = 5;

/** A hanging piece or a missed capture worth at least this many points is `major`. Anything smaller, which means a single pawn, is `minor`. */
export const MATERIAL_SEVERITY_MAJOR = 2;

/** A missed capture is reported only when the engine line for that capture loses less win chance than this, compared with the best move. A capture that loses more is "clearly bad". */
export const MISSED_CAPTURE_MAX_WIN_CHANCE_LOSS = 5;

/** The smallest piece value that counts as a target in a fork or as the piece won by a skewer. 3 means knights and bishops and up, so pawns are not counted. */
export const TACTIC_MIN_TARGET_VALUE = 3;

/** Longest ghost line the coach shows after the played move: the opponent's reply and what follows. */
export const GHOST_LINE_MAX_PLIES = 3;

/** Longest "better move" line the coach shows from the position before the played move. */
export const BETTER_LINE_MAX_PLIES = 3;

/** Engine lines are turned into notation up to this many plies. Longer lines are cut, which also keeps the work per move small. */
export const LINE_MAX_PLIES = 12;

/** The material outcome is counted after the played move plus this many reply plies. */
export const MATERIAL_REPLY_PLIES = 3;

/** When the line is in the middle of an exchange on one square, the count goes on until the exchange ends, but never past this many reply plies. */
export const MATERIAL_MAX_REPLY_PLIES = 5;

/** Opening advice is given only up to this move number. */
export const OPENING_MAX_MOVE = 12;

/** Moving the queen out counts as "very early" up to this move number. */
export const EARLY_QUEEN_MAX_MOVE = 6;

/** Opening advice about development is given only while at least this many of the player's knights and bishops still stand on their first squares. */
export const OPENING_MIN_UNDEVELOPED = 2;

/** Order of importance of the finding types. When two findings are equally serious, the type that comes first in this list is shown first. */
export const FINDING_PRIORITY = Object.freeze([
  'delivered-checkmate',
  'allowed-mate-in-1',
  'missed-mate-in-1',
  'caused-stalemate',
  'allowed-mate',
  'missed-mate',
  'hanging-piece',
  'allowed-fork',
  'allowed-skewer',
  'allowed-pin',
  'missed-capture',
  'missed-fork',
  'missed-skewer',
  'missed-pin',
  'opening-principle',
  'won-material',
  'top-move',
]);
