import { describe, it, expect } from 'vitest';
import { BOARD_THEMES, BOARD_COLORS, DEFAULT_BOARD_COLORS, DEFAULT_THEME, TEAMS, SLOT, tileColors } from '../../src/gfx/palette.js';

const hex = (color) => color.getHexString();

/** Lightness of a color from 0 (black) to 100 (white), the CIE L* value. Worked out here from the hex text, without help from the game code. */
function lightness(color) {
  const text = hex(color);
  const linear = [0, 2, 4].map((at) => {
    const value = parseInt(text.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const y = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

const worlds = Object.keys(BOARD_THEMES);

describe('board lights', () => {
  // The arena multiplies the theme's grid color by this number, so a missing value would turn the seams between the tiles into a broken color.
  it('sets the strength of the light under the tiles for every world, 0 meaning off', () => {
    for (const world of worlds) {
      const seam = BOARD_THEMES[world].lights.seam;
      expect(Number.isFinite(seam), world).toBe(true);
      expect(seam, world).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('board colors', () => {
  it('keeps the tile colors the game had before under "classic" in every world', () => {
    const classic = Object.fromEntries(worlds.map((world) => [world, [hex(tileColors(world, 'classic').light), hex(tileColors(world, 'classic').dark)]]));
    expect(classic).toEqual({
      meadow: ['e6dcc3', '44679c'],
      twilight: ['d6cfe6', '3b3f80'],
      nebula: ['c9d6ea', '27345e'],
    });
  });

  it('defines a light and a dark tile for every choice in every world', () => {
    const missing = [];
    for (const world of worlds) {
      for (const name of BOARD_COLORS) {
        const entry = BOARD_THEMES[world].tiles?.[name];
        if (!entry?.light?.isColor || !entry?.dark?.isColor) missing.push(`${world}/${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives the tiles of the asked world and choice', () => {
    for (const world of worlds) {
      for (const name of BOARD_COLORS) {
        expect(tileColors(world, name)).toBe(BOARD_THEMES[world].tiles[name]);
      }
    }
  });

  it('falls back to the default choice for a board color it does not know', () => {
    expect(tileColors('twilight', 'pink')).toBe(BOARD_THEMES.twilight.tiles[DEFAULT_BOARD_COLORS]);
    expect(tileColors('twilight', undefined)).toBe(BOARD_THEMES.twilight.tiles[DEFAULT_BOARD_COLORS]);
    // A name that exists on every object ("toString") must not be taken for a choice.
    expect(tileColors('twilight', 'toString')).toBe(BOARD_THEMES.twilight.tiles[DEFAULT_BOARD_COLORS]);
  });

  it('falls back to the default world for a theme it does not know', () => {
    expect(tileColors('lava', 'sand')).toBe(BOARD_THEMES[DEFAULT_THEME].tiles.sand);
    expect(tileColors('constructor', 'sand')).toBe(BOARD_THEMES[DEFAULT_THEME].tiles.sand);
  });

  // The reason these choices exist: white robots were lost on near-white tiles. "classic" is the old look and is left out on purpose.
  it('keeps the light tile clearly darker than the white robots for the blue and sand choices', () => {
    const shell = lightness(TEAMS.w.colors[SLOT.SHELL]);
    const tooClose = [];
    for (const world of worlds) {
      for (const name of ['blue', 'sand']) {
        const gap = shell - lightness(tileColors(world, name).light);
        if (gap < 12) tooClose.push(`${world}/${name}: ${gap.toFixed(1)}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('keeps the light and dark tiles clearly apart for every choice', () => {
    const tooClose = [];
    for (const world of worlds) {
      for (const name of BOARD_COLORS) {
        const { light, dark } = tileColors(world, name);
        const gap = lightness(light) - lightness(dark);
        if (gap < 20) tooClose.push(`${world}/${name}: ${gap.toFixed(1)}`);
      }
    }
    expect(tooClose).toEqual([]);
  });
});
