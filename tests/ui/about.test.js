import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ABOUT_LINKS, ABOUT_PROFILES, ABOUT_CREDITS, shortAddress, splitAtMarks } from '../../src/ui/about.js';
import en from '../../src/i18n/en.js';

// The About screen says where the game lives, where its source code is and whose free work it is built on. These tests keep those facts true: every address is a safe https link, and the credits follow the real dependencies and the licence that each of them declares.

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

describe('About links', () => {
  it('points to the game page and the source code that the owner chose', () => {
    expect(ABOUT_LINKS.game).toBe('https://play.alsatian.co/games/robot-chess');
    expect(ABOUT_LINKS.source).toBe('https://github.com/alsatianco/robot-chess');
  });

  it('sends bug reports to the issues page of the source code', () => {
    expect(ABOUT_LINKS.issues).toBe(`${ABOUT_LINKS.source}/issues`);
  });

  it('uses only https addresses', () => {
    const protocols = Object.entries(ABOUT_LINKS).map(([name, address]) => `${name}: ${new URL(address).protocol}`);
    expect(protocols).toEqual(Object.keys(ABOUT_LINKS).map((name) => `${name}: https:`));
  });

  it('can not be changed while the game runs', () => {
    expect(Object.isFrozen(ABOUT_LINKS)).toBe(true);
  });

  it('has a label in the text table for each link row', () => {
    expect(isText(en.about.links.game)).toBe(true);
    expect(isText(en.about.links.source)).toBe(true);
  });
});

describe('About profiles', () => {
  it('shows the profiles that the owner chose, in this order', () => {
    expect(ABOUT_PROFILES).toEqual([
      { id: 'github', name: 'GitHub', address: 'https://github.com/scorta' },
      { id: 'x', name: 'X', address: 'https://x.com/AlsatianStudio' },
    ]);
  });

  it('uses only https addresses', () => {
    const protocols = ABOUT_PROFILES.map((profile) => `${profile.id}: ${new URL(profile.address).protocol}`);
    expect(protocols).toEqual(ABOUT_PROFILES.map((profile) => `${profile.id}: https:`));
  });

  it('can not be changed while the game runs', () => {
    expect(Object.isFrozen(ABOUT_PROFILES)).toBe(true);
    expect(ABOUT_PROFILES.every((profile) => Object.isFrozen(profile))).toBe(true);
  });

  it('has one mark in the last sentence for each profile, and no other mark', () => {
    const marks = [...en.about.author.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(marks).toEqual(ABOUT_PROFILES.map((profile) => profile.id).sort());
  });
});

describe('About credits', () => {
  it('credits every package that the game ships with', () => {
    const credited = ABOUT_CREDITS.flatMap((credit) => credit.packages).sort();
    const shipped = Object.keys(readJson('../../package.json').dependencies).sort();
    expect(credited).toEqual(shipped);
  });

  it('shows the licence that each package declares', () => {
    const shown = ABOUT_CREDITS.flatMap((credit) => credit.packages.map((name) => `${name}: ${credit.licence}`));
    const declared = ABOUT_CREDITS.flatMap((credit) => credit.packages.map((name) => `${name}: ${readJson(`../../node_modules/${name}/package.json`).license}`));
    expect(shown).toEqual(declared);
  });

  it('credits the opening names, which are data and not a package', () => {
    const openings = ABOUT_CREDITS.find((credit) => credit.id === 'openings');
    expect(openings).toMatchObject({ name: 'Lichess', licence: 'CC0-1.0', packages: [] });
  });

  it('gives each credit its own id, a name and a licence', () => {
    const ids = ABOUT_CREDITS.map((credit) => credit.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const credit of ABOUT_CREDITS) {
      expect(isText(credit.name), credit.id).toBe(true);
      expect(isText(credit.licence), credit.id).toBe(true);
    }
  });

  it('has a text that says what each credit does', () => {
    const missing = ABOUT_CREDITS.filter((credit) => !isText(en.about.credits[credit.id])).map((credit) => credit.id);
    expect(missing).toEqual([]);
  });
});

describe('shortAddress', () => {
  it('shows an address without the protocol', () => {
    expect(shortAddress('https://play.alsatian.co/games/robot-chess')).toBe('play.alsatian.co/games/robot-chess');
  });

  it('drops the slash at the end', () => {
    expect(shortAddress('https://github.com/scorta/')).toBe('github.com/scorta');
    expect(shortAddress('https://play.alsatian.co/')).toBe('play.alsatian.co');
  });
});

describe('splitAtMarks', () => {
  it('cuts a sentence at one mark', () => {
    expect(splitAtMarks('If you find a bug, {link}.', ['link'])).toEqual([{ text: 'If you find a bug, ' }, { mark: 'link' }, { text: '.' }]);
  });

  it('cuts a sentence at two marks, in the order of the sentence', () => {
    expect(splitAtMarks('Find me on {x} and {github}.', ['github', 'x'])).toEqual([{ text: 'Find me on ' }, { mark: 'x' }, { text: ' and ' }, { mark: 'github' }, { text: '.' }]);
  });

  it('adds no empty text when a mark starts or ends the sentence', () => {
    expect(splitAtMarks('{link}', ['link'])).toEqual([{ mark: 'link' }]);
  });

  it('keeps braces that are not a wanted mark as text', () => {
    expect(splitAtMarks('Level {level}: {link}', ['link'])).toEqual([{ text: 'Level {level}: ' }, { mark: 'link' }]);
  });

  it('uses each mark once, so a repeated mark stays text', () => {
    expect(splitAtMarks('{link} or {link}', ['link'])).toEqual([{ mark: 'link' }, { text: ' or {link}' }]);
  });

  it('puts a link at the end when a translation forgot its mark', () => {
    expect(splitAtMarks('You can find me on {github}.', ['github', 'x'])).toEqual([{ text: 'You can find me on ' }, { mark: 'github' }, { text: '.' }, { text: ' ' }, { mark: 'x' }]);
  });

  it('finds the {link} mark and its words in the sentence about bug reports', () => {
    expect(en.about.feedback).toContain('{link}');
    expect(isText(en.about.feedbackLink)).toBe(true);
  });
});
