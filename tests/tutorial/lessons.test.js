// Proves that the tutorial data is sound: every position loads, every scripted or accepted move is legal, every text exists and is short, and the steps that teach a rule (check, checkmate, castling, promotion, en passant, stalemate) really show that rule.
import { describe, it, expect } from 'vitest';
import { Chess, validateFen } from 'chess.js';
import { lessons } from '../../src/tutorial/lessons.js';
import en from '../../src/i18n/en.js';

// All text lives in the one language file; the tutorial's part is mounted under `tutorial`.
const strings = en.tutorial;

const SQUARE = /^[a-h][1-8]$/;
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MARK_KINDS = ['info', 'good', 'danger', 'target'];
const LESSON_IDS = ['board', 'pieces', 'capture', 'check', 'special', 'draws'];
const MIN_STEPS = 22;
const MAX_STEPS = 28;
const MAX_TEXT_LENGTH = 160;
const UI_KEYS = ['next', 'back', 'skip', 'done', 'tryAgain', 'welcomeTitle', 'welcomeText', 'finishedTitle', 'finishedText', 'progress'];
const COMMON_FIELDS = ['id', 'kind', 'fen', 'text', 'highlights', 'arrows'];
const INFO_FIELDS = [...COMMON_FIELDS, 'demo'];
const MOVE_FIELDS = [...COMMON_FIELDS, 'accept', 'hint', 'wrong', 'success', 'prelude', 'reply'];
const MOVE_REQUIRED_FIELDS = ['id', 'kind', 'fen', 'text', 'accept', 'hint', 'wrong', 'success'];
const INFO_REQUIRED_FIELDS = ['id', 'kind', 'fen', 'text'];

const allSteps = lessons.flatMap((lesson) => lesson.steps.map((step) => ({ name: `${lesson.id}/${step.id}`, lesson, step })));
const infoSteps = allSteps.filter(({ step }) => step.kind === 'info');
const moveSteps = allSteps.filter(({ step }) => step.kind === 'move');

/** Find one step by lesson id and step id; fails loudly when the data no longer has it, so a renamed step cannot silently skip its rule check. */
function findStep(lessonId, stepId) {
  const found = allSteps.find(({ lesson, step }) => lesson.id === lessonId && step.id === stepId);
  if (!found) throw new Error(`Step "${lessonId}/${stepId}" is missing from the lesson data`);
  return found.step;
}

/** Resolve an i18n key the way the app will: the strings file is mounted under the top-level key "tutorial". */
function resolve(key) {
  if (typeof key !== 'string' || !key.startsWith('tutorial.')) return undefined;
  let node = strings;
  for (const part of key.slice('tutorial.'.length).split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/** Every string in the strings file, as { key, value } with the full i18n key. */
function collectStrings(node = strings, path = 'tutorial') {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    return Object.entries(node).flatMap(([name, child]) => collectStrings(child, `${path}.${name}`));
  }
  return [{ key: path, value: node }];
}

/** Every i18n key that the lesson data refers to. */
function usedKeys() {
  const keys = [];
  for (const lesson of lessons) {
    keys.push(lesson.title);
    for (const step of lesson.steps) {
      keys.push(step.text);
      if (step.kind === 'move') keys.push(step.wrong, step.success);
    }
  }
  return keys;
}

function camelCase(kebab) {
  return kebab.replace(/-([a-z0-9])/g, (match, letter) => letter.toUpperCase());
}

/** Play one UCI move and return the chess.js move. Throws when the text is not UCI or the move is not legal, and never lets chess.js guess a promotion piece. */
function play(chess, uci) {
  const parts = UCI.exec(uci);
  if (!parts) throw new Error(`"${uci}" is not a UCI move`);
  const [, from, to, promotion] = parts;
  const legal = chess.moves({ verbose: true }).some((move) => move.from === from && move.to === to && move.promotion === promotion);
  if (!legal) throw new Error(`"${uci}" is not a legal move in "${chess.fen()}"`);
  return chess.move({ from, to, promotion });
}

/** The position in which the child acts: `fen` with every `prelude` move played. */
function positionForChild(step) {
  const chess = new Chess(step.fen);
  for (const uci of step.prelude ?? []) play(chess, uci);
  return chess;
}

/** Play one accepted move from the child's position. Returns the chess.js move and the position after it (before any `reply`). */
function playAccepted(step, uci) {
  const chess = positionForChild(step);
  const move = play(chess, uci);
  return { chess, move };
}

function legalUciMoves(chess) {
  return chess.moves({ verbose: true }).map((move) => move.from + move.to + (move.promotion ?? ''));
}

/** Only the piece placement and the side to move, to compare two positions without the move counters. */
function placementAndTurn(fen) {
  return fen.split(' ').slice(0, 2).join(' ');
}

describe('tutorial lessons: structure', () => {
  it('has the six chapters of the spec, in order', () => {
    expect(lessons.map((lesson) => lesson.id)).toEqual(LESSON_IDS);
  });

  it('gives every lesson a kebab-case id, a title key and at least one step', () => {
    for (const lesson of lessons) {
      expect(Object.keys(lesson).sort(), lesson.id).toEqual(['id', 'steps', 'title']);
      expect(lesson.id, lesson.id).toMatch(KEBAB);
      expect(lesson.title, lesson.id).toBe(`tutorial.${lesson.id}.title`);
      expect(Array.isArray(lesson.steps), lesson.id).toBe(true);
      expect(lesson.steps.length, lesson.id).toBeGreaterThan(0);
    }
  });

  it('has unique lesson ids', () => {
    const ids = lessons.map((lesson) => lesson.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique kebab-case step ids inside every lesson', () => {
    for (const lesson of lessons) {
      const ids = lesson.steps.map((step) => step.id);
      expect(new Set(ids).size, lesson.id).toBe(ids.length);
      for (const id of ids) expect(id, lesson.id).toMatch(KEBAB);
    }
  });

  it(`has ${MIN_STEPS} to ${MAX_STEPS} steps in total, so the tutorial takes about five minutes`, () => {
    expect(allSteps.length).toBeGreaterThanOrEqual(MIN_STEPS);
    expect(allSteps.length).toBeLessThanOrEqual(MAX_STEPS);
  });
});

describe.each(allSteps)('step $name', ({ lesson, step }) => {
  it('has a known kind, all required fields and no unknown field', () => {
    expect(['info', 'move']).toContain(step.kind);
    const allowed = step.kind === 'move' ? MOVE_FIELDS : INFO_FIELDS;
    const required = step.kind === 'move' ? MOVE_REQUIRED_FIELDS : INFO_REQUIRED_FIELDS;
    for (const field of Object.keys(step)) expect(allowed, `unknown field "${field}"`).toContain(field);
    for (const field of required) expect(step, `missing field "${field}"`).toHaveProperty(field);
  });

  it('has a FEN that chess.js loads', () => {
    expect(validateFen(step.fen)).toEqual({ ok: true });
    expect(() => new Chess(step.fen)).not.toThrow();
  });

  it('shows a legal position: the side that just moved did not leave its own king in check', () => {
    const chess = new Chess(step.fen);
    const waiting = chess.turn() === 'w' ? 'b' : 'w';
    const [kingSquare] = chess.findPiece({ type: 'k', color: waiting });
    expect(chess.isAttacked(kingSquare, chess.turn())).toBe(false);
  });

  it('has texts that exist in the strings file and follow the key pattern', () => {
    const prefix = `tutorial.${lesson.id}.${camelCase(step.id)}`;
    const fields = step.kind === 'move' ? ['text', 'wrong', 'success'] : ['text'];
    for (const field of fields) {
      expect(step[field], field).toBe(`${prefix}.${field}`);
      const value = resolve(step[field]);
      expect(typeof value, step[field]).toBe('string');
      expect(value.trim().length, step[field]).toBeGreaterThan(0);
    }
  });

  it('has valid highlights', () => {
    if (step.highlights === undefined) return;
    expect(Array.isArray(step.highlights)).toBe(true);
    expect(step.highlights.length).toBeGreaterThan(0);
    for (const highlight of step.highlights) {
      expect(Object.keys(highlight).sort()).toEqual(['kind', 'square']);
      expect(highlight.square).toMatch(SQUARE);
      expect(MARK_KINDS).toContain(highlight.kind);
    }
    const squares = step.highlights.map((highlight) => highlight.square);
    expect(new Set(squares).size, 'one highlight per square').toBe(squares.length);
  });

  it('has valid arrows', () => {
    if (step.arrows === undefined) return;
    expect(Array.isArray(step.arrows)).toBe(true);
    expect(step.arrows.length).toBeGreaterThan(0);
    for (const arrow of step.arrows) {
      expect(Object.keys(arrow).sort()).toEqual(['from', 'kind', 'to']);
      expect(arrow.from).toMatch(SQUARE);
      expect(arrow.to).toMatch(SQUARE);
      expect(arrow.from).not.toBe(arrow.to);
      expect(MARK_KINDS).toContain(arrow.kind);
    }
  });
});

describe.each(infoSteps)('info step $name', ({ lesson, step }) => {
  const isStalemateStep = lesson.id === 'draws' && step.id === 'stalemate';

  it('has White to move (only the stalemate picture has Black to move, because Black is the side that cannot move)', () => {
    expect(new Chess(step.fen).turn()).toBe(isStalemateStep ? 'b' : 'w');
  });

  it('has a demo that is a legal sequence from the FEN and does not end the game', () => {
    if (step.demo === undefined) return;
    expect(Array.isArray(step.demo)).toBe(true);
    expect(step.demo.length).toBeGreaterThan(0);
    const chess = new Chess(step.fen);
    for (const uci of step.demo) expect(() => play(chess, uci), uci).not.toThrow();
    expect(chess.isGameOver()).toBe(false);
  });
});

describe.each(moveSteps)('move step $name', ({ step }) => {
  it('plays a legal prelude and then has White to move', () => {
    if (step.prelude !== undefined) {
      expect(Array.isArray(step.prelude)).toBe(true);
      expect(step.prelude.length).toBeGreaterThan(0);
    }
    const chess = new Chess(step.fen);
    for (const uci of step.prelude ?? []) expect(() => play(chess, uci), uci).not.toThrow();
    expect(chess.turn()).toBe('w');
  });

  it('lets the child move: the game is not over before the child acts', () => {
    const chess = positionForChild(step);
    expect(chess.isGameOver()).toBe(false);
  });

  it('accepts at least one move, without repeats, and every accepted move is legal', () => {
    expect(Array.isArray(step.accept)).toBe(true);
    expect(step.accept.length).toBeGreaterThan(0);
    expect(new Set(step.accept).size).toBe(step.accept.length);
    for (const uci of step.accept) expect(() => playAccepted(step, uci), uci).not.toThrow();
  });

  it('has a hint that matches one accepted move', () => {
    expect(Object.keys(step.hint).sort()).toEqual(['from', 'to']);
    expect(step.hint.from).toMatch(SQUARE);
    expect(step.hint.to).toMatch(SQUARE);
    const accepted = step.accept.map((uci) => uci.slice(0, 4));
    expect(accepted).toContain(step.hint.from + step.hint.to);
  });

  it('has a hint on a square the child can see: not the square right behind a king or queen, which the tall robot covers on screen', () => {
    // The tutorial is always seen from White's side, so "right behind" is one row up in the same column. A tap on that square lands on the robot's own head and only puts the robot down.
    const mover = positionForChild(step).get(step.hint.from);
    const from = step.hint.from;
    const squareBehind = from[0] + (Number(from[1]) + 1);
    const hidden = ['k', 'q'].includes(mover.type) && step.hint.to === squareBehind;
    expect(hidden, `${mover.type} on ${from} hides ${squareBehind}`).toBe(false);
  });

  it('has a reply that is legal after every accepted move and does not end the game', () => {
    if (step.reply === undefined) return;
    for (const uci of step.accept) {
      const { chess } = playAccepted(step, uci);
      expect(() => play(chess, step.reply), `${uci} then ${step.reply}`).not.toThrow();
      expect(chess.isGameOver(), `${uci} then ${step.reply}`).toBe(false);
    }
  });

  it('never ends in a draw: after an accepted move the game goes on or it is checkmate', () => {
    for (const uci of step.accept) {
      const { chess } = playAccepted(step, uci);
      expect(chess.isDraw(), uci).toBe(false);
      expect(chess.isGameOver(), uci).toBe(chess.isCheckmate());
    }
  });
});

describe('tutorial strings', () => {
  const all = collectStrings();

  it('has every general string under "ui"', () => {
    for (const name of UI_KEYS) {
      const value = resolve(`tutorial.ui.${name}`);
      expect(typeof value, name).toBe('string');
      expect(value.trim().length, name).toBeGreaterThan(0);
    }
  });

  it('has {current} and {total} in the progress text, and no placeholder anywhere else', () => {
    expect(strings.ui.progress).toContain('{current}');
    expect(strings.ui.progress).toContain('{total}');
    for (const { key, value } of all) {
      if (key === 'tutorial.ui.progress') continue;
      expect(value, key).not.toMatch(/[{}]/);
    }
  });

  it('has every i18n key that the lessons use', () => {
    const missing = usedKeys().filter((key) => typeof resolve(key) !== 'string');
    expect(missing).toEqual([]);
  });

  it('has no lesson string that the lessons do not use', () => {
    const used = new Set(usedKeys());
    const unused = all.map(({ key }) => key).filter((key) => !key.startsWith('tutorial.ui.') && !used.has(key));
    expect(unused).toEqual([]);
  });

  it('holds only plain, non-empty strings on one line', () => {
    for (const { key, value } of all) {
      expect(typeof value, key).toBe('string');
      expect(value.length, key).toBeGreaterThan(0);
      expect(value, key).toBe(value.trim());
      expect(value, key).not.toMatch(/[\r\n\t]/);
      expect(value, key).not.toMatch(/ {2}/);
    }
  });

  it(`has no text longer than ${MAX_TEXT_LENGTH} characters`, () => {
    const tooLong = all.filter(({ value }) => value.length > MAX_TEXT_LENGTH).map(({ key, value }) => `${key} (${value.length})`);
    expect(tooLong).toEqual([]);
  });

  it('shows no chess notation to the child', () => {
    // Square names ("e4"), moves ("Nf3", "exd5", "e7e8q") and castling signs ("O-O") must not appear; the texts say "the glowing square" instead.
    const notation = /(?<![A-Za-z0-9])[KQRBN]?[a-h]?x?[a-h][1-8]|O-O|0-0/;
    const withNotation = all.filter(({ value }) => notation.test(value)).map(({ key }) => key);
    expect(withNotation).toEqual([]);
  });
});

describe('tutorial rules: how the pieces move (chapter 2)', () => {
  const pieceOfStep = { rook: 'r', bishop: 'b', queen: 'q', knight: 'n', king: 'k', 'pawn-step': 'p', 'pawn-double': 'p' };

  it('has one step for each piece, and two for the pawn', () => {
    const lesson = lessons.find((candidate) => candidate.id === 'pieces');
    expect(lesson.steps.map((step) => step.id)).toEqual(Object.keys(pieceOfStep));
    for (const step of lesson.steps) expect(step.kind, step.id).toBe('move');
  });

  it.each(Object.entries(pieceOfStep))('step "%s" is played with the right piece and is a plain move', (stepId, piece) => {
    const step = findStep('pieces', stepId);
    for (const uci of step.accept) {
      const { move } = playAccepted(step, uci);
      expect(move.piece, uci).toBe(piece);
      expect(move.isCapture(), uci).toBe(false);
      expect(move.isPromotion(), uci).toBe(false);
      expect(move.isKingsideCastle() || move.isQueensideCastle(), uci).toBe(false);
    }
  });

  it('accepts every legal move in the king step, so any single step is right', () => {
    const step = findStep('pieces', 'king');
    expect([...step.accept].sort()).toEqual(legalUciMoves(positionForChild(step)).sort());
    expect(step.accept.length).toBe(8);
  });

  it('teaches the single pawn step with a pawn that has no double step', () => {
    const step = findStep('pieces', 'pawn-step');
    expect(step.accept.length).toBe(1);
    const { move } = playAccepted(step, step.accept[0]);
    expect(move.isBigPawn()).toBe(false);
    const pawnMoves = positionForChild(step).moves({ verbose: true, square: move.from });
    expect(pawnMoves.length).toBe(1);
  });

  it('teaches the double step in the second pawn step', () => {
    const step = findStep('pieces', 'pawn-double');
    expect(step.accept.length).toBe(1);
    const { move } = playAccepted(step, step.accept[0]);
    expect(move.isBigPawn()).toBe(true);
  });
});

describe('tutorial rules: no surprise check before check is taught', () => {
  // In the chapters about plain moves, captures and special moves, a check would start the alarm animation and pull attention away from the rule being taught.
  const quiet = moveSteps.filter(({ lesson }) => ['pieces', 'capture', 'special'].includes(lesson.id));

  it.each(quiet)('step $name starts without check and no accepted move gives check', ({ step }) => {
    expect(positionForChild(step).isCheck()).toBe(false);
    for (const uci of step.accept) {
      const { chess } = playAccepted(step, uci);
      expect(chess.isCheck(), uci).toBe(false);
    }
  });
});

describe('tutorial rules: capturing (chapter 3)', () => {
  it('accepts only captures in the capture chapter', () => {
    const lesson = lessons.find((candidate) => candidate.id === 'capture');
    for (const step of lesson.steps) {
      expect(step.kind, step.id).toBe('move');
      for (const uci of step.accept) {
        const { move } = playAccepted(step, uci);
        expect(move.isCapture(), `${step.id} ${uci}`).toBe(true);
        expect(move.isEnPassant(), `${step.id} ${uci}`).toBe(false);
      }
    }
  });

  it('has a normal capture by a piece that is not a pawn', () => {
    const step = findStep('capture', 'rook-capture');
    const { move } = playAccepted(step, step.accept[0]);
    expect(move.piece).toBe('r');
  });

  it("has the pawn's diagonal capture, with the pawn blocked straight ahead", () => {
    const step = findStep('capture', 'pawn-capture');
    expect(step.accept.length).toBe(1);
    const { move } = playAccepted(step, step.accept[0]);
    expect(move.piece).toBe('p');
    expect(move.from[0]).not.toBe(move.to[0]);
    const pawnMoves = positionForChild(step).moves({ verbose: true, square: move.from });
    expect(pawnMoves.map((candidate) => candidate.to)).toEqual([move.to]);
  });
});

describe('tutorial rules: check and checkmate (chapter 4)', () => {
  it('shows White in check in the "in check" picture', () => {
    const step = findStep('check', 'in-check');
    const chess = new Chess(step.fen);
    expect(chess.turn()).toBe('w');
    expect(chess.isCheck()).toBe(true);
    expect(chess.isCheckmate()).toBe(false);
  });

  it('starts the "get out of check" step in check and accepts every legal move, because each one makes the king safe', () => {
    const step = findStep('check', 'escape-check');
    const chess = positionForChild(step);
    expect(chess.isCheck()).toBe(true);
    expect([...step.accept].sort()).toEqual(legalUciMoves(chess).sort());
  });

  it('offers all three ways out of check: step away, block, capture the attacker', () => {
    const step = findStep('check', 'escape-check');
    const moves = step.accept.map((uci) => playAccepted(step, uci).move);
    expect(moves.some((move) => move.piece === 'k')).toBe(true);
    expect(moves.some((move) => move.piece !== 'k' && !move.isCapture())).toBe(true);
    expect(moves.some((move) => move.piece !== 'k' && move.isCapture())).toBe(true);
  });

  it('gives a check that is not checkmate in the "give check" step, and the king then steps away', () => {
    const step = findStep('check', 'give-check');
    expect(typeof step.reply).toBe('string');
    for (const uci of step.accept) {
      const { chess } = playAccepted(step, uci);
      expect(chess.isCheck(), uci).toBe(true);
      expect(chess.isCheckmate(), uci).toBe(false);
      const reply = play(chess, step.reply);
      expect(reply.piece, uci).toBe('k');
    }
  });

  it('gives checkmate with every accepted move of the checkmate step, and accepts every checkmate', () => {
    const step = findStep('check', 'checkmate');
    for (const uci of step.accept) {
      const { chess } = playAccepted(step, uci);
      expect(chess.isCheckmate(), uci).toBe(true);
    }
    const child = positionForChild(step);
    const mates = legalUciMoves(child).filter((uci) => playAccepted(step, uci).chess.isCheckmate());
    expect([...step.accept].sort()).toEqual(mates.sort());
    expect(step.reply).toBeUndefined();
  });
});

describe('tutorial rules: special moves (chapter 5)', () => {
  it('accepts only a castling move in the castling step', () => {
    const step = findStep('special', 'castling');
    for (const uci of step.accept) {
      const { move } = playAccepted(step, uci);
      expect(move.piece, uci).toBe('k');
      expect(move.isKingsideCastle() || move.isQueensideCastle(), uci).toBe(true);
    }
  });

  it('accepts only the queen promotion in the promotion step', () => {
    const step = findStep('special', 'promotion');
    expect(step.accept.length).toBe(1);
    expect(step.accept[0]).toMatch(/^[a-h]7[a-h]8q$/);
    const { move } = playAccepted(step, step.accept[0]);
    expect(move.isPromotion()).toBe(true);
    expect(move.promotion).toBe('q');
  });

  it('makes en passant legal with the prelude and accepts only the en passant capture', () => {
    const step = findStep('special', 'en-passant');
    expect(new Chess(step.fen).turn()).toBe('b');
    expect(step.prelude.length).toBe(1);
    const before = new Chess(step.fen);
    const doubleStep = play(before, step.prelude[0]);
    expect(doubleStep.color).toBe('b');
    expect(doubleStep.isBigPawn()).toBe(true);
    expect(step.accept.length).toBe(1);
    const { move } = playAccepted(step, step.accept[0]);
    expect(move.isEnPassant()).toBe(true);
    // The highlight marks the pawn that gets captured, which stands on the square where the double step ended.
    expect(step.highlights).toContainEqual({ square: doubleStep.to, kind: 'target' });
  });
});

describe('tutorial rules: draws (chapter 6)', () => {
  it('shows a real stalemate: Black is not in check and has no legal move', () => {
    const step = findStep('draws', 'stalemate');
    expect(step.kind).toBe('info');
    const chess = new Chess(step.fen);
    expect(chess.turn()).toBe('b');
    expect(chess.isCheck()).toBe(false);
    expect(chess.moves().length).toBe(0);
    expect(chess.isStalemate()).toBe(true);
    expect(chess.isDraw()).toBe(true);
  });

  it('highlights exactly the squares next to the stalemated king as danger, and each one is guarded by White', () => {
    const step = findStep('draws', 'stalemate');
    const chess = new Chess(step.fen);
    const [kingSquare] = chess.findPiece({ type: 'k', color: 'b' });
    const file = kingSquare.charCodeAt(0);
    const rank = Number(kingSquare[1]);
    const neighbours = [];
    for (let df = -1; df <= 1; df += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const square = String.fromCharCode(file + df) + (rank + dr);
        if ((df !== 0 || dr !== 0) && SQUARE.test(square)) neighbours.push(square);
      }
    }
    const danger = step.highlights.filter((highlight) => highlight.kind === 'danger').map((highlight) => highlight.square);
    expect(danger.sort()).toEqual(neighbours.sort());
    for (const square of neighbours) expect(chess.isAttacked(square, 'w'), square).toBe(true);
    expect(step.highlights).toContainEqual({ square: kingSquare, kind: 'info' });
  });

  it('starts the "avoid stalemate" step one move before the stalemate picture, and does not accept the stalemating move', () => {
    const picture = findStep('draws', 'stalemate');
    const step = findStep('draws', 'avoid-stalemate');
    const stalemating = legalUciMoves(positionForChild(step)).filter((uci) => {
      const { chess } = playAccepted(step, uci);
      return placementAndTurn(chess.fen()) === placementAndTurn(picture.fen);
    });
    expect(stalemating.length).toBe(1);
    expect(step.accept).not.toContain(stalemating[0]);
  });

  it('gives checkmate with every accepted move of the "avoid stalemate" step, and accepts every checkmate', () => {
    const step = findStep('draws', 'avoid-stalemate');
    for (const uci of step.accept) {
      const { chess } = playAccepted(step, uci);
      expect(chess.isCheckmate(), uci).toBe(true);
    }
    const mates = legalUciMoves(positionForChild(step)).filter((uci) => playAccepted(step, uci).chess.isCheckmate());
    expect([...step.accept].sort()).toEqual(mates.sort());
  });

  it('shows a real "not enough pieces" draw in the step about the other draws', () => {
    const step = findStep('draws', 'other-draws');
    expect(step.kind).toBe('info');
    const chess = new Chess(step.fen);
    expect(chess.isInsufficientMaterial()).toBe(true);
    expect(chess.isCheck()).toBe(false);
  });

  it('keeps every other position a live game, so a board that stops on "game over" never blocks a lesson', () => {
    const meantToBeOver = ['draws/stalemate', 'draws/other-draws'];
    for (const { name, step } of allSteps) {
      if (meantToBeOver.includes(name)) continue;
      expect(new Chess(step.fen).isGameOver(), name).toBe(false);
    }
  });
});
