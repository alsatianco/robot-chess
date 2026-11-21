import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Settings, onboardingDefaults } from '../../src/core/settings.js';
import { MODES } from '../../src/core/game.js';
import en from '../../src/i18n/en.js';
import { createTranslator } from '../../src/i18n/index.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    data,
  };
}

describe('Settings', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.localStorage;
  });

  it('uses defaults when nothing is saved', () => {
    globalThis.localStorage = fakeStorage();
    const settings = new Settings();
    expect(settings.get('coachLevel')).toBe(2);
    expect(settings.get('moveConfirm')).toBe(false);
    expect(settings.get('boardTheme')).toBe('meadow');
    expect(settings.get('animation')).toBe('standard');
    expect(settings.get('onboarded')).toBe(false);
  });

  it('keeps a saved Beginner coach level and a saved confirm step, because the new defaults must not undo a choice', () => {
    globalThis.localStorage = fakeStorage({ 'robot-chess.settings.v1': JSON.stringify({ onboarded: true, age: 'young', experience: 'new', coachLevel: 1, moveConfirm: true }) });
    const settings = new Settings();
    expect(settings.get('coachLevel')).toBe(1);
    expect(settings.get('moveConfirm')).toBe(true);
  });

  it('saves a change and loads it again', () => {
    const storage = fakeStorage();
    globalThis.localStorage = storage;
    const first = new Settings();
    first.set('botLevel', 5);
    first.set('boardTheme', 'nebula');
    const second = new Settings();
    expect(second.get('botLevel')).toBe(5);
    expect(second.get('boardTheme')).toBe('nebula');
  });

  it('drops saved values that are not allowed and keeps the good ones', () => {
    globalThis.localStorage = fakeStorage({ 'robot-chess.settings.v1': JSON.stringify({ botLevel: 99, coachLevel: 3, boardTheme: 'lava', volume: 'loud', unknownKey: true }) });
    const settings = new Settings();
    expect(settings.get('botLevel')).toBe(1);
    expect(settings.get('coachLevel')).toBe(3);
    expect(settings.get('boardTheme')).toBe('meadow');
    expect(settings.get('volume')).toBe(0.8);
  });

  it('gives the blue board colors to a save made before the choice existed and keeps the rest of that save', () => {
    globalThis.localStorage = fakeStorage({ 'robot-chess.settings.v1': JSON.stringify({ boardTheme: 'nebula', coachLevel: 1 }) });
    const settings = new Settings();
    expect(settings.get('boardColors')).toBe('blue');
    expect(settings.get('boardTheme')).toBe('nebula');
    expect(settings.get('coachLevel')).toBe(1);
  });

  it('saves the picked board colors and loads them again', () => {
    globalThis.localStorage = fakeStorage();
    new Settings().set('boardColors', 'sand');
    expect(new Settings().get('boardColors')).toBe('sand');
    new Settings().set('boardColors', 'classic');
    expect(new Settings().get('boardColors')).toBe('classic');
  });

  it('never accepts board colors it does not know, saved or set', () => {
    globalThis.localStorage = fakeStorage({ 'robot-chess.settings.v1': JSON.stringify({ boardColors: 'pink' }) });
    const settings = new Settings();
    expect(settings.get('boardColors')).toBe('blue');
    expect(() => settings.set('boardColors', 'pink')).toThrow();
    expect(() => settings.set('boardColors', 'toString')).toThrow();
    expect(settings.get('boardColors')).toBe('blue');
  });

  it('gives a 60 frames per second limit to a save made before the choice existed and keeps the rest of that save', () => {
    globalThis.localStorage = fakeStorage({ 'robot-chess.settings.v1': JSON.stringify({ quality: 'medium', boardColors: 'sand' }) });
    const settings = new Settings();
    expect(settings.get('frameRate')).toBe(60);
    expect(settings.get('quality')).toBe('medium');
    expect(settings.get('boardColors')).toBe('sand');
  });

  it('saves the picked frame rate and accepts only 30, 60 and max', () => {
    globalThis.localStorage = fakeStorage();
    new Settings().set('frameRate', 30);
    expect(new Settings().get('frameRate')).toBe(30);
    new Settings().set('frameRate', 'max');
    expect(new Settings().get('frameRate')).toBe('max');
    const settings = new Settings();
    for (const bad of [45, 120, '60', 0, null]) expect(() => settings.set('frameRate', bad)).toThrow();
    globalThis.localStorage = fakeStorage({ 'robot-chess.settings.v1': JSON.stringify({ frameRate: 1000 }) });
    expect(new Settings().get('frameRate')).toBe(60);
  });

  it('survives damaged saved data', () => {
    globalThis.localStorage = fakeStorage({ 'robot-chess.settings.v1': '{not json' });
    const settings = new Settings();
    expect(settings.get('mode')).toBe('coach');
  });

  it('refuses unknown keys and bad values', () => {
    globalThis.localStorage = fakeStorage();
    const settings = new Settings();
    expect(() => settings.set('nope', 1)).toThrow();
    expect(() => settings.set('coachLevel', 4)).toThrow();
    expect(() => settings.set('volume', 2)).toThrow();
    expect(settings.get('coachLevel')).toBe(2);
  });

  it('works without storage and says so', () => {
    const settings = new Settings();
    expect(settings.persistent).toBe(false);
    settings.set('coordinates', false);
    expect(settings.get('coordinates')).toBe(false);
  });

  it('tells listeners about changes and resets', () => {
    const storage = fakeStorage();
    globalThis.localStorage = storage;
    const settings = new Settings();
    const seen = [];
    settings.subscribe((key, value) => seen.push([key, value]));
    settings.set('shake', false);
    settings.set('shake', false);
    settings.reset();
    expect(seen).toEqual([['shake', false], ['*', null]]);
    expect(settings.get('shake')).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('starts two-player games with the board flipping after each move, without the coach and without a clock', () => {
    globalThis.localStorage = fakeStorage();
    const settings = new Settings();
    expect(settings.get('twoPlayerFlip')).toBe(true);
    expect(settings.get('twoPlayerCoach')).toBe(false);
    expect(settings.get('twoPlayerClock')).toBe('none');
  });

  it('takes "no clock" or one of the time controls for a two-player game, and nothing else', () => {
    globalThis.localStorage = fakeStorage();
    const settings = new Settings();
    settings.set('twoPlayerClock', '15+10');
    expect(settings.get('twoPlayerClock')).toBe('15+10');
    settings.set('twoPlayerClock', 'none');
    expect(settings.get('twoPlayerClock')).toBe('none');
    expect(() => settings.set('twoPlayerClock', '7+7')).toThrow(/not allowed/);
    expect(() => settings.set('twoPlayerClock', null)).toThrow(/not allowed/);
  });

  it('remembers the two-player mode as the last game setup', () => {
    globalThis.localStorage = fakeStorage();
    new Settings().set('mode', 'two');
    expect(new Settings().get('mode')).toBe('two');
  });

  it('maps the onboarding answer to starting values', () => {
    expect(onboardingDefaults('new')).toMatchObject({ coachLevel: 2, botLevel: 1, legalHints: true, evalBar: false, mode: 'coach' });
    expect(onboardingDefaults('rules')).toMatchObject({ coachLevel: 2, botLevel: 2, evalBar: false });
    expect(onboardingDefaults('player')).toMatchObject({ coachLevel: 3, botLevel: 4, evalBar: true });
  });

  it('starts a player who plays often on the Advanced coach, and every other player on Middle', () => {
    expect(onboardingDefaults('new').coachLevel).toBe(2);
    expect(onboardingDefaults('rules').coachLevel).toBe(2);
    expect(onboardingDefaults('player').coachLevel).toBe(3);
  });

  it('leaves the confirm step before each move off for every answer', () => {
    for (const experience of ['new', 'rules', 'player']) {
      expect(onboardingDefaults(experience).moveConfirm, experience).toBe(false);
    }
  });

  it('no longer has an age setting, because the game does not ask for the age any more', () => {
    globalThis.localStorage = fakeStorage();
    const settings = new Settings();
    expect(settings.get('age')).toBe(undefined);
    expect(() => settings.set('age', 'teen')).toThrow(/Unknown setting/);
  });

  it('does not keep the answer to the first-start question, because the answer only sets starting values and nothing reads it later', () => {
    globalThis.localStorage = fakeStorage();
    const settings = new Settings();
    expect(settings.get('experience')).toBe(undefined);
    expect(() => settings.set('experience', 'player')).toThrow(/Unknown setting/);
  });

  it('loads a save from the time when the age and the answer were kept, and drops both from storage with the next change', () => {
    const storage = fakeStorage({ 'robot-chess.settings.v1': JSON.stringify({ onboarded: true, age: 'teen', experience: 'player', coachLevel: 3, evalBar: true, botLevel: 4 }) });
    globalThis.localStorage = storage;
    const settings = new Settings();
    expect(settings.get('onboarded')).toBe(true);
    expect(settings.get('coachLevel')).toBe(3);
    expect(settings.get('evalBar')).toBe(true);
    expect(settings.get('botLevel')).toBe(4);

    settings.set('botLevel', 5);

    const stored = JSON.parse(storage.data.get('robot-chess.settings.v1'));
    expect(stored).not.toHaveProperty('age');
    expect(stored).not.toHaveProperty('experience');
    expect(stored).toMatchObject({ onboarded: true, coachLevel: 3, evalBar: true, botLevel: 5 });
  });
});

describe('language file', () => {
  const t = createTranslator(en);
  const sourceFiles = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.js') && !path.includes('/i18n/') && !path.includes('/dev/')) sourceFiles.push(path);
    }
  };
  walk(join(process.cwd(), 'src'));

  it('has every plain key the code asks for', () => {
    const missing = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) {
        if (t(match[1]) === match[1]) missing.push(`${match[1]} (${file.split('/src/')[1]})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has every key that the code builds from a value', () => {
    const keys = [];
    for (const mode of Object.keys(MODES)) keys.push(`modes.${mode}.name`, `modes.${mode}.about`);
    for (const color of ['w', 'b']) keys.push(`teams.${color}`);
    for (let level = 1; level <= 8; level++) keys.push(`levels.${level}`);
    for (const type of ['q', 'r', 'b', 'n', 'p', 'k']) keys.push(`pieces.${type}`);
    for (const outcome of ['win', 'lose', 'draw']) keys.push(`gameover.${outcome}`, `gameover.cheer.${outcome}`);
    for (const reason of ['checkmate', 'stalemate', 'insufficient', 'repetition', 'fifty', 'timeout', 'resign']) keys.push(`gameover.reasons.${reason}`);
    for (const value of ['new', 'rules', 'player']) keys.push(`onboarding.experience.${value}`);
    for (const value of ['both', 'drag', 'tap']) keys.push(`settings.moveInput.${value}`);
    for (const value of [1, 2, 3]) keys.push(`settings.coachLevel.${value}`, `settings.coachLevel.note${value}`);
    for (const value of ['every', 'mistakes']) keys.push(`settings.coachWhen.${value}`);
    for (const value of ['meadow', 'twilight', 'nebula']) keys.push(`settings.boardTheme.${value}`);
    for (const value of ['blue', 'sand', 'classic']) keys.push(`settings.boardColors.${value}`);
    for (const value of ['angled', 'top']) keys.push(`settings.camera.${value}`);
    for (const value of ['cinematic', 'standard', 'minimal', 'instant']) keys.push(`settings.animation.${value}`, `settings.animation.note_${value}`);
    for (const value of ['auto', 'low', 'medium', 'high']) keys.push(`settings.quality.${value}`);
    for (const value of [30, 60, 'max']) keys.push(`settings.frameRate.${value}`, `settings.frameRate.note_${value}`);
    for (const value of ['gameplay', 'coach', 'two', 'board', 'animation', 'sound', 'general']) keys.push(`settings.groups.${value}`);
    expect(keys.filter((key) => t(key) === key)).toEqual([]);
  });

  it('knows the two-player mode', () => {
    expect(Object.keys(MODES)).toContain('two');
    expect(t('modes.two.name')).toBe('Two players');
  });
});
