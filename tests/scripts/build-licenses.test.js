// The game ships one text file with every licence it must pass on: its own, and the licence of each package and data set it is built on. These tests keep that file complete: a package with no licence text in it, or a build that goes on without one, would break the terms under which the game may use that work.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLicensesText } from '../../scripts/build-licenses.mjs';
import { ABOUT_CREDITS, LICENCES_FILE } from '../../src/ui/about.js';
import en from '../../src/i18n/en.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...path) => readFileSync(join(ROOT, ...path), 'utf8');
const readJson = (...path) => JSON.parse(read(...path));

// Written by hand, not read from the script: the licence file and the source address of each package the game ships with. A new package in `dependencies` must be added here, with its real licence file.
const SHIPPED = {
  stockfish: { file: 'Copying.txt', source: 'https://github.com/nmrugg/stockfish.js' },
  three: { file: 'LICENSE', source: 'https://github.com/mrdoob/three.js' },
  'chess.js': { file: 'LICENSE', source: 'https://github.com/jhlywa/chess.js' },
  '@fontsource-variable/lexend': { file: 'LICENSE', source: 'https://github.com/fontsource/font-files' },
  '@fontsource-variable/unbounded': { file: 'LICENSE', source: 'https://github.com/fontsource/font-files' },
};

describe('the licence file of the real game', () => {
  const text = buildLicensesText({ root: ROOT, credits: ABOUT_CREDITS });

  it('knows the licence file of every package the game ships with', () => {
    expect(Object.keys(SHIPPED).sort()).toEqual(Object.keys(readJson('package.json').dependencies).sort());
  });

  it("starts with the game's own licence, before any other licence", () => {
    const own = text.indexOf(read('LICENSE').trim());
    const firstOther = Math.min(...Object.entries(SHIPPED).map(([name, { file }]) => text.indexOf(read('node_modules', name, file).trim())));
    expect(own).toBeGreaterThanOrEqual(0);
    expect(own).toBeLessThan(firstOther);
  });

  it.each(Object.entries(SHIPPED))('holds the whole licence text of %s', (name, { file }) => {
    expect(text).toContain(read('node_modules', name, file).trim());
  });

  it.each(Object.keys(SHIPPED))('names %s with the version that is installed', (name) => {
    expect(text).toContain(`${name} ${readJson('node_modules', name, 'package.json').version}`);
  });

  it.each(Object.entries(SHIPPED))('says where the source code of %s is', (name, { source }) => {
    expect(text).toContain(source);
  });

  it('holds the GNU General Public License for the chess engine', () => {
    expect(text).toContain('GNU GENERAL PUBLIC LICENSE');
    expect(text).toContain('Version 3, 29 June 2007');
  });

  it('credits the opening names, which are data and not a package, with their licence and address', () => {
    expect(text).toContain('Lichess');
    expect(text).toContain('CC0-1.0');
    expect(text).toContain('https://github.com/lichess-org/chess-openings');
  });

  it('has a section for each credit of the About screen, in the same order', () => {
    const places = ABOUT_CREDITS.map((credit) => text.indexOf(`\n${credit.name}\n`));
    expect(places.every((place) => place >= 0)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
  });
});

describe('the licence of the game itself', () => {
  it('is the MIT licence, as package.json says', () => {
    expect(readJson('package.json').license).toBe('MIT');
    expect(read('LICENSE').startsWith('MIT License\n')).toBe(true);
  });
});

describe('a licence that is missing', () => {
  const made = [];
  /** A small project folder on disk: a LICENSE (unless left out) and one package with or without a licence file. */
  function project({ ownLicence = true, packageLicence = true } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'robot-chess-licences-'));
    made.push(root);
    if (ownLicence) writeFileSync(join(root, 'LICENSE'), 'MIT License\n\nCopyright (c) test\n');
    mkdirSync(join(root, 'node_modules', 'some-package'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'some-package', 'package.json'), JSON.stringify({ name: 'some-package', version: '1.2.3', license: 'MIT', repository: { type: 'git', url: 'git+https://example.org/some-package.git' } }));
    if (packageLicence) writeFileSync(join(root, 'node_modules', 'some-package', 'LICENSE'), 'The licence text of some-package.\n');
    return root;
  }
  const credits = [{ id: 'some', name: 'Some Package', licence: 'MIT', packages: ['some-package'] }];

  afterEach(() => {
    for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('builds the file for a project where nothing is missing', () => {
    const text = buildLicensesText({ root: project(), credits });
    expect(text).toContain('The licence text of some-package.');
    expect(text).toContain('some-package 1.2.3');
    expect(text).toContain('https://example.org/some-package');
  });

  it('stops with an error when a package has no licence file, so a build never ships without that text', () => {
    expect(() => buildLicensesText({ root: project({ packageLicence: false }), credits })).toThrow(/some-package.*licence file/);
  });

  it('stops with an error when the game has no LICENSE file', () => {
    expect(() => buildLicensesText({ root: project({ ownLicence: false }), credits })).toThrow(/LICENSE/);
  });

  it('stops with an error when a credit has neither a package nor an address of its own', () => {
    expect(() => buildLicensesText({ root: project(), credits: [{ id: 'data', name: 'Some Data', licence: 'CC0-1.0', packages: [] }] })).toThrow(/Some Data/);
  });
});

describe('the link to the licence file on the About screen', () => {
  it('opens the file next to the game, in whatever folder the game is served from', () => {
    expect(new URL(LICENCES_FILE, 'https://example.org/games/robot-chess/').href).toBe('https://example.org/games/robot-chess/licenses.txt');
  });

  it('has words for the link in the text table', () => {
    expect(typeof en.about.licencesLink === 'string' && en.about.licencesLink.trim().length > 0).toBe(true);
  });
});
