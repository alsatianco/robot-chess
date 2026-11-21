// The facts shown on the About screen: where the game lives, where its source code is, where to find its maker, and the free projects it is built on. Only data and two small text helpers, with no DOM, so tests can check that the credits match the real dependencies.

const SOURCE = 'https://github.com/alsatianco/robot-chess';

/** The addresses of the game on the About screen. The issues page is built from the source address, so the two can not drift apart. */
export const ABOUT_LINKS = Object.freeze({
  game: 'https://play.alsatian.co/games/robot-chess',
  source: SOURCE,
  issues: `${SOURCE}/issues`,
});

/**
 * Where to find the maker, for the last sentence of the About screen. That sentence is the text `about.author`, and it holds one {id} mark for each profile here; a test checks that the two match. The owner picks these profiles, so ask before you add or remove one.
 * @type {ReadonlyArray<Readonly<{id: string, name: string, address: string}>>}
 */
export const ABOUT_PROFILES = Object.freeze([
  Object.freeze({ id: 'github', name: 'GitHub', address: 'https://github.com/scorta' }),
  Object.freeze({ id: 'x', name: 'X', address: 'https://x.com/AlsatianStudio' }),
]);

/** The text file with every licence the game must pass on, its own included. `scripts/build-licenses.mjs` writes it and the About screen links to it. The path has no slash in front, so it means "next to the game" in whatever folder the game is served from. */
export const LICENCES_FILE = 'licenses.txt';

/**
 * The free work the game is built on, in the order shown. `packages` lists the npm packages that a credit covers: a test checks that every package the game ships with has a credit and that `licence` is what the package declares. A credit for data that is not a package has a `source` address instead. The licence file is built from this list too, so a credit here is also a section there. What each one does is text, under `about.credits.<id>`.
 * @type {ReadonlyArray<Readonly<{id: string, name: string, licence: string, packages: ReadonlyArray<string>, source?: string}>>}
 */
export const ABOUT_CREDITS = Object.freeze(
  [
    { id: 'stockfish', name: 'Stockfish', licence: 'GPL-3.0', packages: ['stockfish'] },
    { id: 'three', name: 'three.js', licence: 'MIT', packages: ['three'] },
    { id: 'chess', name: 'chess.js', licence: 'BSD-2-Clause', packages: ['chess.js'] },
    { id: 'openings', name: 'Lichess', licence: 'CC0-1.0', packages: [], source: 'https://github.com/lichess-org/chess-openings' },
    { id: 'fonts', name: 'Unbounded and Lexend', licence: 'OFL-1.1', packages: ['@fontsource-variable/unbounded', '@fontsource-variable/lexend'] },
  ].map((credit) => Object.freeze({ ...credit, packages: Object.freeze(credit.packages) })),
);

/** An address as people read it: no protocol and no slash at the end, for example "github.com/alsatianco/robot-chess". */
export function shortAddress(address) {
  const url = new URL(address);
  return `${url.host}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Cut a sentence at its marks, such as {link} or {github}, so the screen can put a real link at each one. The pieces come back in the order of the sentence, so a translation is free to move the marks. Only the names in `marks` count and each counts once: any other text in braces stays text, so a mistake is easy to see on screen. A mark that the sentence does not hold is added at the end, so a translation that forgot it still gets its link.
 * @param {string} text
 * @param {ReadonlyArray<string>} marks
 * @returns {Array<{text: string} | {mark: string}>}
 */
export function splitAtMarks(text, marks) {
  const pieces = [];
  const missing = new Set(marks);
  let from = 0;
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    if (!missing.delete(match[1])) continue;
    if (match.index > from) pieces.push({ text: text.slice(from, match.index) });
    pieces.push({ mark: match[1] });
    from = match.index + match[0].length;
  }
  if (from < text.length) pieces.push({ text: text.slice(from) });
  for (const mark of missing) pieces.push({ text: ' ' }, { mark });
  return pieces;
}
