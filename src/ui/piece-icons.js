// Classic chess symbols as vector outlines (viewBox 0 0 100 100). Used on the ring under each robot, for captured pieces, in the promotion picker and in the move list, so the robots stay linked to the real pieces. Drawn by hand so they look the same on every device (system chess glyphs differ a lot between phones).
const BASE = 'M22 80h56a4 4 0 0 1 4 4v6H18v-6a4 4 0 0 1 4-4z';

export const PIECE_PATHS = {
  p: `M50 11a15 15 0 1 0 0 30a15 15 0 1 0 0-30z M36 44h28a4 4 0 0 1 0 8h-28a4 4 0 0 1 0-8z M41 54h18c1 11 6 18 13 24H28c7-6 12-13 13-24z ${BASE}`,
  r: `M26 14h12v8h7v-8h10v8h7v-8h12v20l-6 6H32l-6-6z M34 42h32l3 36H31z ${BASE}`,
  n: `M30 78c0-12 4-20 12-27l-10 5c-4 2-9 0-10-4c-1-3 1-6 3-8l14-17l1-11l9 8c14 2 25 14 25 32v22z M41 33a3 3 0 1 0 0 6a3 3 0 1 0 0-6z ${BASE}`,
  b: `M50 6a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M50 18c-11 9-17 19-17 28c0 8 5 13 10 15h14c5-2 10-7 10-15c0-9-6-19-17-28z M56 30l-9 14l4 2.5l9-14z M36 63h28a3.5 3.5 0 0 1 0 7h-28a3.5 3.5 0 0 1 0-7z M40 71h20l8 7H32z ${BASE}`,
  q: `M30 62L20 28L34 44L37 20L46 42L50 16L54 42L63 20L66 44L80 28L70 62z M20 19.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M37 11.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M50 6.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M63 11.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M80 19.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z M30 65h40a3.5 3.5 0 0 1 0 7h-40a3.5 3.5 0 0 1 0-7z M33 73h34l5 5H28z ${BASE}`,
  k: `M46 5h8v7h7v8h-7v9h-8v-9h-7v-8h7z M50 33c-4-4-10-6-16-4c-9 3-12 13-7 22l6 12h34l6-12c5-9 2-19-7-22c-6-2-12 0-16 4z M31 65h38a3.5 3.5 0 0 1 0 7h-38a3.5 3.5 0 0 1 0-7z M33 73h34l5 5H28z ${BASE}`,
};

/**
 * Build an inline SVG element for a piece symbol.
 * @param {'p'|'r'|'n'|'b'|'q'|'k'} type
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function pieceIcon(type, className = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PIECE_PATHS[type]);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

/**
 * Draw a piece symbol into a 2D canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {'p'|'r'|'n'|'b'|'q'|'k'} type
 * @param {number} x Left of the icon box.
 * @param {number} y Top of the icon box.
 * @param {number} size Box size in pixels.
 */
export function drawPieceIcon(ctx, type, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fill(new Path2D(PIECE_PATHS[type]), 'evenodd');
  ctx.restore();
}
