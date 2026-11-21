import { describe, it, expect } from 'vitest';
import { ChessClock, formatClock, TIME_CONTROLS } from '../../src/core/clock.js';

function makeClock(control) {
  let now = 0;
  const clock = new ChessClock(control, () => now);
  return { clock, advance: (ms) => (now += ms) };
}

describe('ChessClock', () => {
  it('starts both sides with the preset time', () => {
    const { clock } = makeClock('3+2');
    expect(clock.timeLeft('w')).toBe(180000);
    expect(clock.timeLeft('b')).toBe(180000);
  });

  it('falls back to the default preset for an unknown control', () => {
    const { clock } = makeClock('nonsense');
    expect(clock.control).toBe('5+0');
    expect(clock.timeLeft('w')).toBe(TIME_CONTROLS['5+0'].minutes * 60000);
  });

  it('only the running side loses time', () => {
    const { clock, advance } = makeClock('5+0');
    clock.start('w');
    advance(4000);
    expect(clock.timeLeft('w')).toBe(296000);
    expect(clock.timeLeft('b')).toBe(300000);
  });

  it('time that passes while no clock runs is free (animations cost nothing)', () => {
    const { clock, advance } = makeClock('5+0');
    clock.start('w');
    advance(1000);
    clock.completeMove('w');
    advance(60000);
    clock.start('b');
    advance(500);
    expect(clock.timeLeft('w')).toBe(299000);
    expect(clock.timeLeft('b')).toBe(299500);
  });

  it('adds the increment when a move is completed', () => {
    const { clock, advance } = makeClock('3+2');
    clock.start('w');
    advance(5000);
    clock.completeMove('w');
    expect(clock.timeLeft('w')).toBe(177000);
    expect(clock.running).toBe(null);
  });

  it('reports a timeout once and stops', () => {
    const { clock, advance } = makeClock('3+2');
    clock.start('b');
    advance(179999);
    expect(clock.tick()).toBe(null);
    advance(2);
    expect(clock.tick()).toBe('b');
    expect(clock.tick()).toBe(null);
    expect(clock.timeLeft('b')).toBe(0);
    clock.start('w');
    expect(clock.running).toBe(null);
  });

  it('restores a snapshot for undo', () => {
    const { clock, advance } = makeClock('5+0');
    clock.start('w');
    advance(10000);
    const snap = clock.snapshot();
    advance(20000);
    clock.restore(snap);
    expect(clock.timeLeft('w')).toBe(290000);
    expect(clock.running).toBe(null);
  });
});

describe('formatClock', () => {
  it('shows minutes and seconds', () => {
    expect(formatClock(300000)).toBe('5:00');
    expect(formatClock(61000)).toBe('1:01');
    expect(formatClock(59001)).toBe('1:00');
  });
  it('shows tenths under ten seconds and never goes below zero', () => {
    expect(formatClock(9400)).toBe('0:09.4');
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(-50)).toBe('0:00.0');
  });
});
