import { describe, it, expect } from 'vitest';
import { Engine, parseInfoLine } from '../../src/engine/engine.js';
import { pickWeighted, chooseBotMove, BOT_LEVELS } from '../../src/engine/bot.js';
import { Chess } from 'chess.js';

// A tiny stand-in for the Stockfish worker: answers the UCI handshake and replies to "go" with scripted lines.
class FakeWorker {
  constructor(script) {
    this.script = script;
    this.sent = [];
    this.onmessage = null;
  }
  postMessage(text) {
    this.sent.push(text);
    const reply = (line) => queueMicrotask(() => this.onmessage?.({ data: line }));
    if (text === 'isready') reply('readyok');
    if (text.startsWith('go')) for (const line of this.script(text, this.sent)) reply(line);
  }
  terminate() {}
}

describe('parseInfoLine', () => {
  it('reads depth, rank, score and the line', () => {
    expect(parseInfoLine('info depth 12 seldepth 18 multipv 2 score cp -34 nodes 1000 nps 5 time 3 pv e7e5 g1f3 b8c6')).toEqual({ multipv: 2, depth: 12, move: 'e7e5', pv: ['e7e5', 'g1f3', 'b8c6'], cp: -34, mate: null });
  });
  it('reads mate scores', () => {
    const line = parseInfoLine('info depth 5 multipv 1 score mate 2 pv h5f7 e8e7 f7e6');
    expect(line.mate).toBe(2);
    expect(line.cp).toBe(null);
  });
  it('ignores lines without a principal variation', () => {
    expect(parseInfoLine('info depth 3 currmove e2e4 currmovenumber 1')).toBe(null);
    expect(parseInfoLine('info string NNUE evaluation')).toBe(null);
    expect(parseInfoLine('bestmove e2e4')).toBe(null);
  });
});

describe('Engine', () => {
  const START = new Chess().fen();

  it('returns the last line per rank, best first', async () => {
    const worker = new FakeWorker(() => ['info depth 1 multipv 1 score cp 10 pv e2e4', 'info depth 2 multipv 2 score cp 5 pv d2d4 d7d5', 'info depth 2 multipv 1 score cp 22 pv g1f3 d7d5', 'bestmove g1f3 ponder d7d5']);
    const engine = new Engine({ createWorker: () => worker });
    const result = await engine.analyze({ fen: START, multipv: 2, depth: 2 });
    expect(result.bestmove).toBe('g1f3');
    expect(result.lines.map((line) => line.move)).toEqual(['g1f3', 'd2d4']);
    expect(result.lines[0].cp).toBe(22);
    expect(worker.sent).toContain('setoption name MultiPV value 2');
    expect(worker.sent).toContain(`position fen ${START}`);
    expect(worker.sent.some((text) => text === 'go depth 2')).toBe(true);
  });

  it('runs searches one at a time, in order', async () => {
    const worker = new FakeWorker((go) => [`info depth 1 multipv 1 score cp 1 pv ${go.includes('searchmoves') ? 'a2a3' : 'e2e4'}`, 'bestmove x']);
    const engine = new Engine({ createWorker: () => worker });
    const [first, second] = await Promise.all([engine.analyze({ fen: START, depth: 1 }), engine.analyze({ fen: START, depth: 1, searchMoves: ['a2a3'] })]);
    expect(first.lines[0].move).toBe('e2e4');
    expect(second.lines[0].move).toBe('a2a3');
    expect(worker.sent.filter((text) => text.startsWith('go')).length).toBe(2);
  });

  it('a search cancelled while waiting never reaches the engine', async () => {
    const worker = new FakeWorker(() => ['info depth 1 multipv 1 score cp 1 pv e2e4', 'bestmove e2e4']);
    const engine = new Engine({ createWorker: () => worker });
    const first = engine.analyze({ fen: START, depth: 1 });
    const second = engine.analyze({ fen: START, depth: 1 });
    second.cancel();
    const [a, b] = await Promise.all([first, second]);
    expect(a.cancelled).toBe(false);
    expect(b.cancelled).toBe(true);
    expect(b.lines).toEqual([]);
    expect(worker.sent.filter((text) => text.startsWith('go')).length).toBe(1);
  });

  it('rejects when the worker cannot be created', async () => {
    const engine = new Engine({
      createWorker: () => {
        throw new Error('no workers here');
      },
    });
    await expect(engine.analyze({ fen: START, depth: 1 })).rejects.toThrow('no workers here');
  });
});

describe('bot', () => {
  const line = (move, cp, mate = null) => ({ multipv: 1, depth: 5, move, pv: [move], cp, mate });

  it('has eight levels', () => {
    expect(Object.keys(BOT_LEVELS).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('gets harder with each level, and gives every skill level the depth that its Stockfish rating needs', () => {
    const levels = Object.values(BOT_LEVELS);
    const ranked = levels.filter((level) => level.kind === 'ranked');
    const skill = levels.filter((level) => level.kind === 'skill');
    // The levels that pick with randomness come first, and each one is less random than the one before.
    expect(levels.map((level) => level.kind)).toEqual([...ranked.map(() => 'ranked'), ...skill.map(() => 'skill')]);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].temperature).toBeLessThan(ranked[i - 1].temperature);
      expect(ranked[i].randomMove).toBeLessThanOrEqual(ranked[i - 1].randomMove);
    }
    for (let i = 1; i < skill.length; i++) expect(skill[i].skill).toBeGreaterThan(skill[i - 1].skill);
    // Stockfish picks its weakened move at depth "skill + 1". A level with a lower depth limit plays weaker than the rating that Stockfish gives for that skill.
    for (const level of skill.filter((entry) => entry.skill < 20)) expect(level.depth).toBeGreaterThanOrEqual(level.skill + 1);
  });

  it('a low temperature picks the best move almost always, a high one spreads out', () => {
    const lines = [line('a', 100), line('b', 0), line('c', -300)];
    let seed = 7;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const count = (temperature) => {
      const picks = { a: 0, b: 0, c: 0 };
      for (let i = 0; i < 4000; i++) picks[pickWeighted(lines, temperature, rng)] += 1;
      return picks;
    };
    const sharp = count(5);
    expect(sharp.a).toBeGreaterThan(3990);
    const loose = count(520);
    expect(loose.a).toBeGreaterThan(loose.b);
    expect(loose.b).toBeGreaterThan(loose.c);
    expect(loose.c).toBeGreaterThan(400);
  });

  it('returns null for an empty list and survives mate scores', () => {
    expect(pickWeighted([], 100)).toBe(null);
    expect(pickWeighted([line('m', null, 1), line('x', 20)], 1, () => 0)).toBe('m');
  });

  it('always answers with a legal move, even when the engine says nonsense', async () => {
    const worker = new FakeWorker(() => ['info depth 1 multipv 1 score cp 1 pv z9z9', 'bestmove z9z9']);
    const engine = new Engine({ createWorker: () => worker });
    const fen = new Chess().fen();
    const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion ?? ''));
    for (const level of [1, 3, 5, 8]) {
      const move = await chooseBotMove(engine, fen, level, () => 0.99).promise;
      expect(legal).toContain(move);
    }
  });

  it('plays a random legal move when the engine fails', async () => {
    const engine = new Engine({
      createWorker: () => {
        throw new Error('broken');
      },
    });
    const fen = new Chess().fen();
    const move = await chooseBotMove(engine, fen, 6, () => 0.5).promise;
    expect(new Chess(fen).moves({ verbose: true }).some((m) => m.from + m.to === move)).toBe(true);
  });

  it('returns null when there is no legal move', async () => {
    const mate = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
    const engine = new Engine({ createWorker: () => new FakeWorker(() => []) });
    expect(await chooseBotMove(engine, mate, 4).promise).toBe(null);
  });
});
