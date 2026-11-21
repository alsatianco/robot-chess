// Mapping between chess squares ("e4") and world positions. One tile is one world unit. Files a to h run along +x, ranks 1 to 8 run along -z, the board center is the origin and the top of the tiles is y = 0.
export const FILES = 'abcdefgh';

/** @returns {{x:number, z:number}} World position of the center of a square. */
export function squareToWorld(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return { x: file - 3.5, z: 3.5 - rank };
}

/** @returns {string|null} The square under a world position, or null when the point is off the board. */
export function worldToSquare(x, z) {
  const file = Math.floor(x + 4);
  const rank = Math.floor(4 - z);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return FILES[file] + (rank + 1);
}

/** Index 0..63 of a square (a1 = 0, h1 = 7, a8 = 56). */
export function squareIndex(square) {
  return FILES.indexOf(square[0]) + (Number(square[1]) - 1) * 8;
}

export function indexToSquare(index) {
  return FILES[index % 8] + (Math.floor(index / 8) + 1);
}

/** True for the dark squares (a1 is dark). */
export function isDarkSquare(square) {
  return (FILES.indexOf(square[0]) + Number(square[1]) - 1) % 2 === 0;
}
