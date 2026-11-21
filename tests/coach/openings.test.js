import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { findOpening, loadOpenings, openingKey, setOpeningsData } from '../../src/coach/openings.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function fenAfter(...moves) {
  const chess = new Chess();
  for (const move of moves) chess.move(move);
  return chess.fen();
}

const SAMPLE = {
  [openingKey(fenAfter('e4'))]: ['B00', 'King\'s Pawn Game'],
  [openingKey(fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bb5'))]: ['C60', 'Ruy Lopez'],
};

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  setOpeningsData(null);
});

afterEach(() => {
  setOpeningsData(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openingKey', () => {
  it('uses the pieces, the side to move and the castling rights', () => {
    expect(openingKey(START)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq');
    expect(openingKey('  rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR   b KQkq e3 0 1 ')).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq');
  });
});

describe('findOpening with injected data', () => {
  it('answers null while no data is loaded', () => {
    expect(findOpening(fenAfter('e4'))).toBeNull();
  });

  it('finds a position by its key', () => {
    setOpeningsData(SAMPLE);
    expect(findOpening(fenAfter('e4'))).toEqual({ eco: 'B00', name: 'King\'s Pawn Game' });
    expect(findOpening(fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bb5'))).toEqual({ eco: 'C60', name: 'Ruy Lopez' });
  });

  it('finds the same opening by another move order', () => {
    setOpeningsData(SAMPLE);
    // The knights come out first here. The position is the same, only the move counters differ.
    const chess = new Chess();
    for (const move of ['Nf3', 'Nc6', 'e4', 'e5', 'Bb5']) chess.move(move);
    expect(findOpening(chess.fen())).toEqual({ eco: 'C60', name: 'Ruy Lopez' });
  });

  it('does not care about the en passant square or the move counters', () => {
    setOpeningsData(SAMPLE);
    expect(findOpening('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 7 42')).toEqual({ eco: 'B00', name: 'King\'s Pawn Game' });
  });

  it('answers null for a position without a name and for odd input', () => {
    setOpeningsData(SAMPLE);
    expect(findOpening(START)).toBeNull();
    expect(findOpening(fenAfter('d4'))).toBeNull();
    expect(findOpening(undefined)).toBeNull();
    expect(findOpening(42)).toBeNull();
  });

  it('accepts a Map and ignores a broken entry', () => {
    setOpeningsData(new Map([[openingKey(fenAfter('d4')), ['A40', 'Queen\'s Pawn Game']], [openingKey(fenAfter('c4')), 'English']]));
    expect(findOpening(fenAfter('d4'))).toEqual({ eco: 'A40', name: 'Queen\'s Pawn Game' });
    expect(findOpening(fenAfter('c4'))).toBeNull();
  });

  it('can be cleared again, and rejects a wrong value', () => {
    setOpeningsData(SAMPLE);
    setOpeningsData(null);
    expect(findOpening(fenAfter('e4'))).toBeNull();
    expect(() => setOpeningsData('nope')).toThrow(TypeError);
    expect(() => setOpeningsData([])).toThrow(TypeError);
  });
});

describe('loadOpenings', () => {
  it('fetches the file once, however often it is called', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SAMPLE));
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.all([loadOpenings(), loadOpenings(), loadOpenings()]);
    expect(results).toEqual([true, true, true]);
    expect(await loadOpenings()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('./data/openings.json');
    expect(findOpening(fenAfter('e4'))).toEqual({ eco: 'B00', name: 'King\'s Pawn Game' });
  });

  it('uses the given address', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SAMPLE));
    vi.stubGlobal('fetch', fetchMock);
    await loadOpenings('/static/openings.json');
    expect(fetchMock).toHaveBeenCalledWith('/static/openings.json');
  });

  it('answers null from findOpening until the file has arrived', async () => {
    let finish;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = () => resolve(jsonResponse(SAMPLE)); })));
    const loading = loadOpenings();
    expect(findOpening(fenAfter('e4'))).toBeNull();
    finish();
    expect(await loading).toBe(true);
    expect(findOpening(fenAfter('e4'))).not.toBeNull();
  });

  it.each([
    ['the server answers with an error', async () => jsonResponse(null, false, 404)],
    ['the network fails', async () => { throw new Error('offline'); }],
    ['the file is not JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })],
    ['the file is not a map', async () => jsonResponse([1, 2, 3])],
  ])('resolves to false and warns once when %s', async (_, fetchImpl) => {
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadOpenings()).toBe(false);
    expect(await loadOpenings()).toBe(false);
    expect(await loadOpenings()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('./data/openings.json');
    expect(findOpening(fenAfter('e4'))).toBeNull();
  });

  it('does not fetch when the data was set by hand', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    setOpeningsData(SAMPLE);
    expect(await loadOpenings()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let a late download overwrite data that was set by hand', async () => {
    let finish;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = () => resolve(jsonResponse({})); })));
    const loading = loadOpenings();
    setOpeningsData(SAMPLE);
    finish();
    await loading;
    expect(findOpening(fenAfter('e4'))).toEqual({ eco: 'B00', name: 'King\'s Pawn Game' });
  });
});

describe('the generated file public/data/openings.json', () => {
  const file = fileURLToPath(new URL('../../public/data/openings.json', import.meta.url));
  const generated = JSON.parse(readFileSync(file, 'utf8'));

  it('is a map from position key to [eco, name]', () => {
    const entries = Object.entries(generated);
    expect(entries.length).toBeGreaterThan(3000);
    for (const [key, value] of entries) {
      expect(key.split(' ')).toHaveLength(3);
      expect(value).toHaveLength(2);
      expect(value[0]).toMatch(/^[A-E]\d\d$/);
      expect(value[1].length).toBeGreaterThan(0);
    }
  });

  it('names well known openings from a chess.js position', () => {
    setOpeningsData(generated);
    expect(findOpening(fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bb5'))).toEqual({ eco: 'C60', name: 'Ruy Lopez' });
    expect(findOpening(fenAfter('e4', 'c5'))).toEqual({ eco: 'B20', name: 'Sicilian Defense' });
    expect(findOpening(fenAfter('d4', 'd5', 'c4'))).toEqual({ eco: 'D06', name: 'Queen\'s Gambit' });
    expect(findOpening(fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bc4'))).toEqual({ eco: 'C50', name: 'Italian Game' });
    expect(findOpening(START)).toBeNull();
  });
});
