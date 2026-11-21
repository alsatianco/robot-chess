import { describe, it, expect } from 'vitest';
import en from '../../src/i18n/en.js';

// The two sides of a chess game are called White and Black. The robots have cyan and orange lights, but the text must not name a side by the color of its lights.

/** Every text in the table as { key, text }. A value that is a list (varied lines) gives one entry per line. */
function allTexts(node, path = []) {
  if (typeof node === 'string') return [{ key: path.join('.'), text: node }];
  if (Array.isArray(node)) return node.flatMap((item, index) => allTexts(item, [...path, String(index)]));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([name, value]) => allTexts(value, [...path, name]));
  return [];
}

describe('names of the two sides', () => {
  const texts = allTexts(en);

  it('reads the whole text table', () => {
    expect(texts.length).toBeGreaterThan(300);
  });

  it('never names a side by the color of its lights', () => {
    const wrong = texts.filter(({ text }) => /\b(cyan|orange)\b/i.test(text)).map(({ key, text }) => `${key}: ${text}`);
    expect(wrong).toEqual([]);
  });

  it('calls the sides White and Black where the player picks a side', () => {
    expect(en.menu.colorWhite).toBe('White');
    expect(en.menu.colorBlack).toBe('Black');
    expect(en.menu.color).toBe('Play as');
  });

  it('tells the tutorial player that they play White against Black', () => {
    expect(en.tutorial.board.squares.text).toContain('you play White');
    expect(en.tutorial.board.turns.text).toMatch(/^Black starts at the top\. White always moves first\./);
  });
});

// On iPhone and iPad the player installs the game by hand, in the browser's own menu. The steps must use the words Apple shows on the screen, or a child can not find the right entry.
describe('steps to install the game on iPhone and iPad', () => {
  it('names the buttons with the words iOS shows', () => {
    expect(en.install.iosShare).toContain('Share');
    expect(en.install.iosAdd).toContain('“Add to Home Screen”');
    expect(en.install.iosConfirm).toContain('“Add”');
  });

  it('has every text the install offer shows', () => {
    for (const key of ['button', 'buttonTitle', 'title', 'iosIntro', 'iosShare', 'iosAdd', 'iosConfirm', 'iosNote', 'gotIt', 'done', 'failed']) expect(en.install[key], key).toEqual(expect.any(String));
    // The button sits in a corner of the home menu, next to the logo on a small phone, so its word must stay short.
    expect(en.install.button.length).toBeLessThanOrEqual(8);
    expect(en.install.title).toContain(en.app.name);
  });
});
