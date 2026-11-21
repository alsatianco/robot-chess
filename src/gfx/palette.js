// Colors and surface settings for the two robot teams and the board themes. Robot geometry stores only a "slot" number per vertex; the real color and finish come from these tables, so both teams share the same models.
import * as THREE from 'three';

/** Material slots used by every robot part. */
export const SLOT = {
  SHELL: 0, // main body shell
  SHELL2: 1, // second shell tone for panels
  METAL: 2, // joints and trim
  DARK: 3, // rubber, soles, vents
  GLOW: 4, // team light, strong
  GLOW2: 5, // team light, soft
  GLASS: 6, // black glass around the face screen
};
export const SLOT_COUNT = 7;

const c = (hex) => new THREE.Color(hex);

/**
 * Per team: `colors[slot]` is the base color and `pbr[slot]` is (roughness, metalness, glow strength, clearcoat).
 * White team: glossy ivory ceramic (a warm cream, like the white pieces of a classic chess set) with cyan lights. Black team: graphite with copper joints and orange lights.
 */
export const TEAMS = {
  w: {
    glow: c('#16d9ff'),
    glowSoft: c('#9cefff'),
    rim: c('#5fe6ff'),
    colors: [c('#f2dea0'), c('#c9b07a'), c('#77828f'), c('#181c24'), c('#16d9ff'), c('#8beaff'), c('#04060a')],
    pbr: [
      [0.2, 0.0, 0.0, 1.0],
      [0.34, 0.1, 0.0, 0.6],
      [0.3, 1.0, 0.0, 0.0],
      [0.6, 0.1, 0.0, 0.0],
      [0.4, 0.0, 2.6, 0.0],
      [0.4, 0.0, 1.3, 0.0],
      [0.06, 0.0, 0.0, 1.0],
    ],
  },
  b: {
    glow: c('#ff7a14'),
    glowSoft: c('#ffbf7a'),
    rim: c('#ff9a4d'),
    colors: [c('#2a2e38'), c('#3d4350'), c('#b07a45'), c('#0c0e12'), c('#ff7a14'), c('#ffb066'), c('#04060a')],
    pbr: [
      [0.26, 0.55, 0.0, 1.0],
      [0.4, 0.6, 0.0, 0.5],
      [0.28, 1.0, 0.0, 0.0],
      [0.6, 0.1, 0.0, 0.0],
      [0.4, 0.0, 2.8, 0.0],
      [0.4, 0.0, 1.4, 0.0],
      [0.06, 0.0, 0.0, 1.0],
    ],
  },
};

/** Colors shared by highlights, coach arrows and effects. */
export const FX_COLORS = {
  legal: c('#12c8f0'),
  capture: c('#ff4560'),
  lastMove: c('#ffcf3d'),
  selected: c('#2fd8ff'),
  check: c('#ff2d4a'),
  good: c('#5dff9a'),
  danger: c('#ff4d5e'),
  info: c('#8fb8ff'),
  target: c('#ffe066'),
  white: c('#ffffff'),
};

/**
 * Tile color choices the player can pick in the settings, in menu order. Every theme below defines all of them under `tiles`, tuned for that world's light.
 * "blue" and "sand" keep the light tile clearly darker than the white robots and the dark tile clearly lighter than the dark robots, so both teams stay easy to see on both tile colors. "classic" is the first look of the game, with near-white light tiles.
 */
export const BOARD_COLORS = ['blue', 'sand', 'classic'];
export const DEFAULT_BOARD_COLORS = 'blue';

const tiles = (light, dark) => ({ light: c(light), dark: c(dark) });

/**
 * Board themes. A theme is a whole look: the world around the board ("garden" is the floating meadow island, "space" is the galaxy arena), the sky, the light and the tile colors for each board color choice.
 * `lights.grass`, `lights.tip` and `lights.cloud` tint the garden's grass and clouds to match the time of day.
 * `lights.seam` is the strength of the light under the tiles, which shines up through the thin gaps between them in the `grid` color. 0 turns it off: the gaps are then dark, and the border strips and the four corner lamps are the only lights of the board.
 */
export const BOARD_THEMES = {
  meadow: {
    world: 'garden',
    tiles: { blue: tiles('#8fb2d8', '#3a5d99'), sand: tiles('#c2a976', '#44679c'), classic: tiles('#e6dcc3', '#44679c') },
    frame: c('#27303c'),
    grid: c('#bfeaff'),
    sky: { zenith: c('#2a78d2'), horizon: c('#f6e2c0'), haze: c('#a9cdea'), sun: c('#fff0d2'), cloudLight: c('#ffffff'), cloudShade: c('#c4d0e6'), stars: 0, sunDir: [-0.395, 0.791, 0.467] },
    lights: { hemiSky: c('#d6eaff'), hemiGround: c('#6f8f4a'), hemi: 0.75, key: c('#fff2dc'), keyPower: 2.0, rim: 0.4, env: 0.6, background: 1, bloom: 0.38, trim: 1.5, seam: 0, grass: new THREE.Color(1, 1, 0.95), tip: new THREE.Color(1, 0.95, 0.55), cloud: new THREE.Color(1, 1, 1), motes: 0.5 },
  },
  twilight: {
    world: 'garden',
    tiles: { blue: tiles('#a9bce8', '#6176c6'), sand: tiles('#d2b48c', '#666cb8'), classic: tiles('#d6cfe6', '#3b3f80') },
    frame: c('#1a1c2c'),
    grid: c('#8f9cff'),
    sky: { zenith: c('#0f1440'), horizon: c('#ff8f5e'), haze: c('#3a2a5e'), sun: c('#ffae6a'), cloudLight: c('#ffb08c'), cloudShade: c('#4a3a6e'), stars: 1, sunDir: [-0.62, 0.06, -0.78] },
    lights: { hemiSky: c('#6f7fd0'), hemiGround: c('#2a2f3a'), hemi: 0.42, key: c('#ffd0b0'), keyPower: 1.05, rim: 1.1, env: 0.4, background: 0.95, bloom: 0.55, trim: 1.4, seam: 1.5, grass: new THREE.Color(0.36, 0.38, 0.6), tip: new THREE.Color(0.9, 0.5, 0.4), cloud: new THREE.Color(0.8, 0.52, 0.6), motes: 1.6 },
  },
  nebula: {
    world: 'space',
    tiles: { blue: tiles('#9bb3dc', '#4a66ad'), sand: tiles('#c0aa82', '#4a62a4'), classic: tiles('#c9d6ea', '#27345e') },
    frame: c('#161b2c'),
    grid: c('#6f8cff'),
    sky: { top: c('#050818'), mid: c('#1a1247'), core: c('#ff7ad9'), arm: c('#5a3df0'), far: c('#0b2a55') },
    lights: { hemiSky: c('#a8c4ff'), hemiGround: c('#2a1840'), hemi: 0.3, key: c('#fff4e6'), keyPower: 1.75, rim: 1.2, env: 0.42, background: 0.9, bloom: 0.5, trim: 1.35, seam: 1.5, motes: 1 },
  },
};
export const DEFAULT_THEME = 'meadow';

/**
 * The light and dark tile colors for a theme and a board color choice. A name that is not known falls back to the default, so a bad value can never leave the board without colors.
 * @param {string} themeName
 * @param {string} colorsName
 * @returns {{light: THREE.Color, dark: THREE.Color}}
 */
export function tileColors(themeName, colorsName) {
  const theme = Object.hasOwn(BOARD_THEMES, themeName) ? BOARD_THEMES[themeName] : BOARD_THEMES[DEFAULT_THEME];
  return theme.tiles[BOARD_COLORS.includes(colorsName) ? colorsName : DEFAULT_BOARD_COLORS];
}
