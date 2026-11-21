// Tests for the sound module. Node has no Web Audio, so a small fake AudioContext is injected through the test hook. The fake records every node, connection and scheduled value. It is strict: it throws where a real browser throws (an exponential ramp to zero, a source started twice, a value that is not a finite number), and it also throws on things that are legal but always a mistake in this module (automation written out of time order, an exponential ramp that starts from zero). So the tests catch errors that would otherwise only show up in a browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sfx, SOUND_NAMES, STRETCHABLE_SOUNDS, __setAudioContextFactory } from '../../src/audio/sfx.js';

// ---------------------------------------------------------------------------------------------------------------------
// Fake Web Audio
// ---------------------------------------------------------------------------------------------------------------------

function checkNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${what} is not a finite number: ${String(value)}`);
}

function checkTime(time, what) {
  checkNumber(time, what);
  if (time < 0) throw new RangeError(`${what} is negative: ${time}`);
}

class FakeParam {
  constructor(ctx, value) {
    this.ctx = ctx;
    this._value = value;
    /** @type {{type: string, value: number, time: number}[]} */
    this.events = [];
    this.inputs = new Set();
  }

  get value() {
    return this._value;
  }

  set value(v) {
    checkNumber(v, 'AudioParam.value');
    this._value = v;
  }

  /** The value this param ends on: the last scheduled value, or the plain value when nothing is scheduled. */
  get finalValue() {
    return this.events.length ? this.events[this.events.length - 1].value : this._value;
  }

  _add(type, value, time) {
    checkNumber(value, `${type} value`);
    checkTime(time, `${type} time`);
    const last = this.events[this.events.length - 1];
    if (last && time < last.time) throw new Error(`fake: ${type} at ${time} is scheduled before the previous event at ${last.time}`);
    this.events.push({ type, value, time });
    return this;
  }

  setValueAtTime(value, time) {
    return this._add('set', value, time);
  }

  linearRampToValueAtTime(value, time) {
    return this._add('linear', value, time);
  }

  exponentialRampToValueAtTime(value, time) {
    if (value === 0) throw new RangeError('exponentialRampToValueAtTime: the target value cannot be 0');
    const from = this.finalValue;
    if (from === 0 || Math.sign(from) !== Math.sign(value)) throw new Error(`fake: an exponential ramp from ${from} to ${value} does not ramp in a browser`);
    return this._add('exponential', value, time);
  }

  setTargetAtTime(value, time, timeConstant) {
    checkNumber(timeConstant, 'timeConstant');
    if (timeConstant < 0) throw new RangeError('setTargetAtTime: negative time constant');
    return this._add('target', value, time);
  }

  cancelScheduledValues(time) {
    checkTime(time, 'cancel time');
    this.events = this.events.filter((event) => event.time < time);
    return this;
  }
}

class FakeNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.inputs = new Set();
    this.outputs = new Set();
    this.disconnectCalls = 0;
    ctx.nodes.push(this);
  }

  connect(target) {
    if (!(target instanceof FakeNode) && !(target instanceof FakeParam)) throw new TypeError('connect: the target is not an AudioNode or AudioParam');
    if (target.ctx !== this.ctx) throw new DOMException('connect: the target belongs to another context', 'InvalidAccessError');
    if (target instanceof FakeSource) throw new DOMException('connect: a source node has no inputs', 'IndexSizeError');
    this.outputs.add(target);
    target.inputs.add(this);
    return target instanceof FakeNode ? target : undefined;
  }

  disconnect() {
    this.disconnectCalls += 1;
    for (const target of this.outputs) target.inputs.delete(this);
    this.outputs.clear();
  }
}

class FakeDestination extends FakeNode {}

class FakeGain extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.gain = new FakeParam(ctx, 1);
  }
}

class FakeSource extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.startTime = null;
    this.stopTime = null;
    this.ended = false;
    this.onended = null;
    ctx.sources.push(this);
  }

  start(when = 0, offset = 0) {
    checkTime(when, 'start time');
    checkTime(offset, 'start offset');
    if (this.startTime !== null) throw new DOMException('start: cannot call start more than once', 'InvalidStateError');
    this.startTime = Math.max(when, this.ctx.currentTime);
    this.offset = offset;
  }

  stop(when = 0) {
    checkTime(when, 'stop time');
    if (this.startTime === null) throw new DOMException('stop: cannot call stop without calling start first', 'InvalidStateError');
    if (this.ended) return;
    this.stopTime = Math.max(when, this.ctx.currentTime);
  }
}

const OSCILLATOR_TYPES = ['sine', 'square', 'sawtooth', 'triangle'];

class FakeOscillator extends FakeSource {
  constructor(ctx) {
    super(ctx);
    this._type = 'sine';
    this.frequency = new FakeParam(ctx, 440);
    this.detune = new FakeParam(ctx, 0);
  }

  get type() {
    return this._type;
  }

  set type(value) {
    if (!OSCILLATOR_TYPES.includes(value)) throw new TypeError(`fake: unknown oscillator type "${value}"`);
    this._type = value;
  }
}

class FakeBufferSource extends FakeSource {
  constructor(ctx) {
    super(ctx);
    this._buffer = null;
    this.loop = false;
    this.playbackRate = new FakeParam(ctx, 1);
    this.detune = new FakeParam(ctx, 0);
  }

  get buffer() {
    return this._buffer;
  }

  set buffer(value) {
    if (value !== null && !(value instanceof FakeBuffer)) throw new TypeError('buffer: not an AudioBuffer');
    if (value !== null && this._buffer !== null) throw new DOMException('buffer: cannot set the buffer more than once', 'InvalidStateError');
    this._buffer = value;
  }
}

const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];

class FakeBiquad extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this._type = 'lowpass';
    this.frequency = new FakeParam(ctx, 350);
    this.Q = new FakeParam(ctx, 1);
    this.gain = new FakeParam(ctx, 0);
    this.detune = new FakeParam(ctx, 0);
  }

  get type() {
    return this._type;
  }

  set type(value) {
    if (!FILTER_TYPES.includes(value)) throw new TypeError(`fake: unknown filter type "${value}"`);
    this._type = value;
  }
}

class FakeCompressor extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.threshold = new FakeParam(ctx, -24);
    this.knee = new FakeParam(ctx, 30);
    this.ratio = new FakeParam(ctx, 12);
    this.attack = new FakeParam(ctx, 0.003);
    this.release = new FakeParam(ctx, 0.25);
  }
}

class FakeWaveShaper extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this._curve = null;
    this.oversample = 'none';
  }

  get curve() {
    return this._curve;
  }

  set curve(value) {
    if (value !== null && !(value instanceof Float32Array)) throw new TypeError('curve: not a Float32Array');
    if (value !== null && value.length < 2) throw new DOMException('curve: needs at least two points', 'InvalidStateError');
    this._curve = value;
  }
}

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    if (!(channels >= 1) || !(length >= 1) || !(sampleRate >= 8000 && sampleRate <= 96000)) throw new DOMException('createBuffer: bad arguments', 'NotSupportedError');
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }

  getChannelData(channel) {
    if (!(channel >= 0 && channel < this.numberOfChannels)) throw new DOMException('getChannelData: bad channel', 'IndexSizeError');
    return this.data[channel];
  }
}

class FakeAudioContext {
  /**
   * @param {{autoStart?: boolean, initialState?: string, fireEnded?: boolean}} [options] `autoStart: false` keeps the context suspended after `resume()` until `start()` is called, like a browser that is slow or not allowed to start audio. `fireEnded: false` models a browser that drops `ended` events.
   */
  constructor({ autoStart = true, initialState = 'suspended', fireEnded = true } = {}) {
    this.autoStart = autoStart;
    this.fireEnded = fireEnded;
    this.state = initialState;
    this.currentTime = 0;
    this.sampleRate = 48000;
    /** @type {FakeNode[]} */
    this.nodes = [];
    /** @type {FakeSource[]} */
    this.sources = [];
    this.buffers = [];
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.pendingResumes = [];
    /** Name of a create method that must throw, to test error handling. */
    this.failOn = null;
    this.destination = new FakeDestination(this);
    this.nodes.length = 0; // The destination is not a node that the module created.
  }

  _create(method, Node) {
    if (this.failOn === method) throw new Error(`fake: ${method} failed`);
    return new Node(this);
  }

  createGain() {
    return this._create('createGain', FakeGain);
  }

  createOscillator() {
    return this._create('createOscillator', FakeOscillator);
  }

  createBufferSource() {
    return this._create('createBufferSource', FakeBufferSource);
  }

  createBiquadFilter() {
    return this._create('createBiquadFilter', FakeBiquad);
  }

  createDynamicsCompressor() {
    return this._create('createDynamicsCompressor', FakeCompressor);
  }

  createWaveShaper() {
    return this._create('createWaveShaper', FakeWaveShaper);
  }

  createBuffer(channels, length, sampleRate) {
    const buffer = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  resume() {
    this.resumeCalls += 1;
    if (this.state === 'closed') return Promise.reject(new DOMException('resume: the context is closed', 'InvalidStateError'));
    if (this.autoStart) {
      this.state = 'running';
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => this.pendingResumes.push({ resolve, reject }));
  }

  /** The browser starts (or restarts) audio: the state becomes "running" and every waiting `resume()` promise resolves. */
  start() {
    this.state = 'running';
    for (const { resolve } of this.pendingResumes.splice(0)) resolve();
  }

  /** The browser refuses to start audio: every waiting `resume()` promise rejects. */
  refuse() {
    for (const { reject } of this.pendingResumes.splice(0)) reject(new DOMException('resume: not allowed', 'NotAllowedError'));
  }

  close() {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Move the clock forward and fire `ended` on every source whose stop time has passed, in stop-time order. A suspended context does not move. */
  advance(seconds) {
    if (this.state !== 'running') return;
    this.currentTime += seconds;
    const due = this.sources.filter((source) => !source.ended && source.startTime !== null && source.stopTime !== null && source.stopTime <= this.currentTime);
    due.sort((a, b) => a.stopTime - b.stopTime);
    for (const source of due) {
      source.ended = true;
      if (this.fireEnded && typeof source.onended === 'function') source.onended({ type: 'ended', target: source });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------------------------------------------------

/** Install a factory that makes fake contexts. Returns the factory spy and the list of contexts it made. */
function install(options) {
  const contexts = [];
  const factory = vi.fn(() => {
    const ctx = new FakeAudioContext(options);
    contexts.push(ctx);
    return ctx;
  });
  __setAudioContextFactory(factory);
  return { factory, contexts };
}

/** Install a fake context and unlock audio. Returns the context with its output chain (`chain`) and the node that all voices connect to (`bus`). */
function unlocked(options) {
  const { contexts } = install(options);
  sfx.unlock();
  const ctx = contexts[0];
  ctx.chain = new Set(ctx.nodes);
  ctx.bus = ctx.nodes.find((node) => node instanceof FakeBiquad);
  return ctx;
}

/** Nodes that belong to sounds, not to the fixed output chain. */
const voiceNodes = (ctx) => ctx.nodes.filter((node) => !ctx.chain.has(node));
/** Number of sounds whose output is connected to the mix right now. */
const connectedVoices = (ctx) => ctx.bus.inputs.size;
const isConnected = (node) => node.outputs.size > 0 || node.inputs.size > 0;
/** Oscillators that make sound. An oscillator that feeds a gain whose only target is an AudioParam is a vibrato or tremolo helper. */
const audibleOscillators = (ctx) => ctx.sources.filter((source) => source instanceof FakeOscillator && [...source.outputs].every((gain) => [...gain.outputs].every((target) => target instanceof FakeNode)));
const lastStop = (ctx) => Math.max(...ctx.sources.map((source) => source.stopTime));
const firstStart = (ctx) => Math.min(...ctx.sources.map((source) => source.startTime));

/** Play one sound on a fresh context and return the context. */
function playFresh(name, opts) {
  const ctx = unlocked();
  sfx.play(name, opts);
  return ctx;
}

/** A text that describes what a sound schedules: every source with its wave type, frequency curve and timing. Two sounds with the same text would sound the same. */
function signature(ctx) {
  const t0 = firstStart(ctx);
  return ctx.sources
    .map((source) => {
      const kind = source instanceof FakeOscillator ? `${source.type}[${source.frequency.events.map((event) => event.value.toFixed(1)).join('>') || source.frequency.value}]` : 'noise';
      return `${kind}@${(source.startTime - t0).toFixed(3)}-${(source.stopTime - t0).toFixed(3)}`;
    })
    .sort()
    .join(' ');
}

const EXPECTED_NAMES = [
  'ui.click', 'ui.hover', 'ui.open', 'ui.close', 'ui.toggle', 'ui.error',
  'piece.select', 'piece.deselect', 'piece.drop', 'illegal',
  'move.pawn', 'move.rook', 'move.knight.jump', 'move.knight.land', 'move.bishop', 'move.queen', 'move.king',
  'attack.zap', 'attack.cannon', 'attack.beam', 'attack.stomp', 'attack.slash', 'attack.smash', 'attack.ram',
  'robot.powerdown', 'robot.popapart', 'robot.scared', 'robot.happy',
  'check', 'castle', 'promote.start', 'promote.build', 'promote.done', 'bestmove',
  'game.start', 'game.win', 'game.lose', 'game.draw',
  'coach.great', 'coach.good', 'coach.warn', 'coach.bad', 'coach.ghost',
  'clock.tick', 'clock.low', 'tutorial.success',
];

const MAX_VOICES = 24;
const LONG_SOUND = 'game.win';

const realRandom = Math.random;
let warn;
let clock;
let randomValue;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // 0.5 is the middle of the random range, so the random pitch variation is exactly zero unless a test changes `randomValue`. This is a plain function and not a spy, because the module calls it once per sample when it fills the noise buffer.
  randomValue = 0.5;
  Math.random = () => randomValue;
  clock = 1_000_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  __setAudioContextFactory(null);
  Math.random = realRandom;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------------

describe('SOUND_NAMES', () => {
  it('lists exactly the sounds from the brief', () => {
    expect([...SOUND_NAMES].sort()).toEqual([...EXPECTED_NAMES].sort());
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_NAMES.length);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SOUND_NAMES)).toBe(true);
    expect(Object.isFrozen(STRETCHABLE_SOUNDS)).toBe(true);
    expect(() => SOUND_NAMES.push('extra')).toThrow(TypeError);
  });

  it('exposes the fixed API, and other tests can spy on it', () => {
    for (const method of ['unlock', 'setVolume', 'getVolume', 'play']) expect(typeof sfx[method]).toBe('function');
    const spy = vi.spyOn(sfx, 'play').mockImplementation(() => {});
    sfx.play('attack.zap', { pitch: 1.1 });
    expect(spy).toHaveBeenCalledWith('attack.zap', { pitch: 1.1 });
  });

  it('marks the travel sounds as stretchable', () => {
    expect(STRETCHABLE_SOUNDS).toEqual(expect.arrayContaining(['move.rook', 'move.bishop', 'move.queen']));
    for (const name of STRETCHABLE_SOUNDS) expect(SOUND_NAMES).toContain(name);
  });
});

describe('before unlock and without Web Audio', () => {
  it('does nothing when play is called before unlock', () => {
    const { factory } = install();
    for (const name of SOUND_NAMES) expect(sfx.play(name)).toBeUndefined();
    sfx.stopAll();
    expect(factory).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not create the context when the module is loaded or the volume is set', () => {
    const { factory } = install();
    sfx.setVolume(0.5);
    expect(sfx.getVolume()).toBe(0.5);
    expect(factory).not.toHaveBeenCalled();
  });

  it('is a silent no-op in Node, where there is no AudioContext', () => {
    __setAudioContextFactory(null);
    expect(globalThis.AudioContext).toBeUndefined();
    sfx.unlock();
    sfx.unlock();
    for (const name of SOUND_NAMES) sfx.play(name, { pitch: 1.2, gain: 0.5, delay: 0.1, duration: 0.5 });
    sfx.setVolume(0.3);
    sfx.stopAll();
    expect(sfx.getVolume()).toBe(0.3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('survives a browser that fails to create the context', () => {
    const factory = vi.fn(() => {
      throw new Error('no audio device');
    });
    __setAudioContextFactory(factory);
    expect(() => sfx.unlock()).not.toThrow();
    expect(() => sfx.unlock()).not.toThrow();
    expect(() => sfx.play('ui.click')).not.toThrow();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('closes a context whose output chain cannot be built', () => {
    const { contexts, factory } = install();
    factory.mockImplementationOnce(() => {
      const ctx = new FakeAudioContext();
      ctx.failOn = 'createDynamicsCompressor';
      contexts.push(ctx);
      return ctx;
    });
    expect(() => sfx.unlock()).not.toThrow();
    expect(contexts[0].closeCalls).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    sfx.play('ui.click');
    expect(contexts[0].sources).toHaveLength(0);
    // The next gesture tries again and works.
    sfx.unlock();
    sfx.play('ui.click');
    expect(contexts[1].sources.length).toBeGreaterThan(0);
  });
});

describe('the browser AudioContext', () => {
  /** Load a fresh copy of the module, the way a page load does, with `globals` set on the global object first. */
  async function loadFresh(globals) {
    for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value);
    vi.resetModules();
    const fresh = await import('../../src/audio/sfx.js');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return fresh;
  }

  it('is created lazily: not on import, not on play, only on unlock', async () => {
    const made = [];
    const AudioContext = vi.fn(function () {
      made.push(new FakeAudioContext());
      return made[made.length - 1];
    });
    const fresh = await loadFresh({ AudioContext });
    fresh.sfx.setVolume(0.9);
    fresh.sfx.play('ui.click');
    expect(AudioContext).not.toHaveBeenCalled();

    fresh.sfx.unlock();
    fresh.sfx.unlock();
    expect(AudioContext).toHaveBeenCalledTimes(1);
    expect(AudioContext).toHaveBeenCalledWith({ latencyHint: 'interactive' });
    fresh.sfx.play('ui.click');
    expect(made[0].sources.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
    fresh.__setAudioContextFactory(null);
  });

  it('falls back to webkitAudioContext, and to a constructor that takes no options', async () => {
    const made = [];
    const webkitAudioContext = vi.fn(function (options) {
      if (options) throw new TypeError('no options, please');
      made.push(new FakeAudioContext());
      return made[made.length - 1];
    });
    const fresh = await loadFresh({ AudioContext: undefined, webkitAudioContext });
    fresh.sfx.unlock();
    expect(webkitAudioContext).toHaveBeenCalledTimes(2);
    fresh.sfx.play('check');
    expect(made).toHaveLength(1);
    expect(made[0].sources.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
    fresh.__setAudioContextFactory(null);
  });
});

describe('unlock', () => {
  it('creates one context, however often it is called', () => {
    const { factory, contexts } = install();
    sfx.unlock();
    sfx.unlock();
    sfx.unlock();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(contexts[0].state).toBe('running');
    expect(contexts[0].resumeCalls).toBe(1);
  });

  it('does not call resume on a context that already runs', () => {
    const { contexts } = install({ initialState: 'running' });
    sfx.unlock();
    sfx.unlock();
    expect(contexts[0].resumeCalls).toBe(0);
  });

  it('resumes a context that the browser paused later', () => {
    const ctx = unlocked();
    ctx.state = 'suspended';
    sfx.unlock();
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.state).toBe('running');
  });

  it('routes everything through a limiter, one master gain and a soft clipper', () => {
    const ctx = unlocked();
    const [clipper] = ctx.destination.inputs;
    expect(ctx.destination.inputs.size).toBe(1);
    expect(clipper).toBeInstanceOf(FakeWaveShaper);
    const [master] = clipper.inputs;
    expect(master).toBeInstanceOf(FakeGain);
    const [limiter] = master.inputs;
    expect(limiter).toBeInstanceOf(FakeCompressor);
    expect(limiter.ratio.value).toBeGreaterThanOrEqual(8);
    expect(limiter.threshold.value).toBeLessThan(0);
    expect(limiter.attack.value).toBeLessThanOrEqual(0.005);
    const [bus] = limiter.inputs;
    expect(bus).toBe(ctx.bus);
    expect(bus.type).toBe('lowpass');
    expect(ctx.nodes).toHaveLength(4);

    sfx.play('attack.zap');
    sfx.play('check');
    // Nothing but the clipper reaches the speakers, and every sound enters the chain at its start.
    expect([...ctx.destination.inputs]).toEqual([clipper]);
    expect(connectedVoices(ctx)).toBe(2);
    for (const node of voiceNodes(ctx)) for (const target of node.outputs) if (ctx.chain.has(target)) expect(target).toBe(bus);
  });

  it('uses a clip curve that leaves normal levels alone and can never reach full scale', () => {
    const ctx = unlocked();
    const [clipper] = ctx.destination.inputs;
    const curve = clipper.curve;
    const middle = (curve.length - 1) / 2;
    const at = (x) => curve[Math.round(middle + x * middle)];
    expect(curve.length % 2).toBe(1);
    expect(curve[middle]).toBe(0);
    for (let i = 0; i < curve.length; i++) {
      expect(curve[i]).toBeCloseTo(-curve[curve.length - 1 - i], 6);
      if (i > 0) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
    expect(at(0.25)).toBeCloseTo(0.25, 5);
    expect(at(0.5)).toBeCloseTo(0.5, 5);
    expect(at(-0.5)).toBeCloseTo(-0.5, 5);
    expect(curve[curve.length - 1]).toBeLessThan(0.95);
    expect(curve[curve.length - 1]).toBeGreaterThan(0.8);
  });

  it('makes a new context after the old one was closed', () => {
    const { contexts } = install();
    sfx.unlock();
    sfx.play(LONG_SOUND);
    contexts[0].state = 'closed';
    expect(() => sfx.play('ui.click')).not.toThrow();
    expect(contexts).toHaveLength(1);
    sfx.unlock();
    expect(contexts).toHaveLength(2);
    sfx.play('ui.click');
    expect(contexts[1].sources.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe.each(SOUND_NAMES)('sound "%s"', (name) => {
  it('plays without an error and schedules at least one source', () => {
    const ctx = unlocked();
    expect(() => sfx.play(name)).not.toThrow();
    expect(sfx.play(name)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(ctx.sources.length).toBeGreaterThanOrEqual(2);
    for (const source of ctx.sources) {
      expect(source.startTime).toBeGreaterThanOrEqual(ctx.currentTime);
      expect(source.stopTime).toBeGreaterThan(source.startTime);
      expect(source.outputs.size).toBeGreaterThan(0);
      expect(typeof source.onended).toBe('function');
    }
    expect(connectedVoices(ctx)).toBe(2);
  });

  it('is short and small', () => {
    const ctx = playFresh(name);
    expect(lastStop(ctx) - firstStart(ctx)).toBeLessThanOrEqual(1.5);
    expect(lastStop(ctx) - firstStart(ctx)).toBeGreaterThan(0.02);
    // A sound is built from a handful of nodes, so a phone can play many of them.
    expect(voiceNodes(ctx).length).toBeLessThanOrEqual(48);
  });

  it('keeps every frequency and level in a safe range at any pitch', () => {
    for (const pitch of [0.25, 1, 4]) {
      const ctx = playFresh(name, { pitch });
      for (const osc of audibleOscillators(ctx)) {
        expect(osc.frequency.events.length).toBeGreaterThan(0);
        for (const event of osc.frequency.events) {
          expect(event.value).toBeGreaterThanOrEqual(20);
          expect(event.value).toBeLessThanOrEqual(6000);
        }
      }
      for (const node of voiceNodes(ctx)) {
        if (node instanceof FakeBiquad) {
          for (const event of node.frequency.events) {
            expect(event.value).toBeGreaterThanOrEqual(20);
            expect(event.value).toBeLessThanOrEqual(12000);
          }
        }
        // Gains in the signal path never boost. (A gain that feeds an AudioParam is a vibrato or tremolo depth and has its own unit.)
        if (node instanceof FakeGain && [...node.outputs].every((target) => target instanceof FakeNode)) {
          expect(node.gain.value).toBeLessThanOrEqual(1);
          for (const event of node.gain.events) {
            expect(event.value).toBeGreaterThanOrEqual(0);
            expect(event.value).toBeLessThanOrEqual(1);
          }
        }
      }
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it('starts and ends every layer in silence', () => {
    const ctx = playFresh(name);
    for (const source of ctx.sources) {
      const envelopes = [...source.outputs].filter((node) => node instanceof FakeGain && node.gain.events.length > 0);
      // Follow the chain from the source to its envelope gain (through a filter and a tremolo gain if there are any).
      let node = source;
      let envelope = null;
      for (let hops = 0; hops < 4 && !envelope; hops++) {
        const [next] = [...node.outputs].filter((target) => target instanceof FakeNode);
        if (!next) break;
        if (next instanceof FakeGain && next.gain.events.length > 0) envelope = next;
        node = next;
      }
      if (!envelope) {
        // Vibrato and tremolo helpers have no envelope: they feed a param.
        expect(envelopes).toHaveLength(0);
        continue;
      }
      const events = envelope.gain.events;
      expect(events[0]).toMatchObject({ type: 'set', value: 0 });
      expect(events[0].time).toBeCloseTo(source.startTime, 6);
      expect(events[events.length - 1]).toMatchObject({ type: 'linear', value: 0 });
      expect(events[events.length - 1].time).toBeLessThanOrEqual(source.stopTime);
    }
  });

  it('disconnects all its nodes when its sources have ended', () => {
    const ctx = playFresh(name);
    const nodes = voiceNodes(ctx);
    expect(nodes.length).toBeGreaterThan(0);
    expect(connectedVoices(ctx)).toBe(1);
    ctx.advance(lastStop(ctx) - ctx.currentTime - 0.001);
    expect(connectedVoices(ctx)).toBe(1);
    ctx.advance(0.002);
    expect(connectedVoices(ctx)).toBe(0);
    for (const node of nodes) {
      expect(node.disconnectCalls).toBe(1);
      expect(isConnected(node)).toBe(false);
    }
    for (const source of ctx.sources) expect(source.onended).toBeNull();
    for (const node of ctx.chain) expect(node.disconnectCalls).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('creates nothing at volume 0', () => {
    const ctx = unlocked();
    sfx.setVolume(0);
    sfx.play(name);
    sfx.play(name, { gain: 1, pitch: 2, delay: 0.1, duration: 1 });
    expect(ctx.nodes).toHaveLength(ctx.chain.size);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.buffers).toHaveLength(0);
  });
});

describe('distinct sounds', () => {
  it('gives every name its own sound', () => {
    const seen = new Map();
    for (const name of SOUND_NAMES) {
      const text = signature(playFresh(name));
      expect(seen.has(text), `${name} sounds the same as ${seen.get(text)}`).toBe(false);
      seen.set(text, name);
    }
  });

  it('keeps move, capture, check, castle and game end clearly apart', () => {
    const length = (name) => {
      const ctx = playFresh(name);
      return lastStop(ctx) - firstStart(ctx);
    };
    const tunedNotes = (name) => audibleOscillators(playFresh(name)).filter((osc) => osc.frequency.events.length === 1).length;
    // Moves and attacks are made of sweeps and noise. Check is two steady notes, castle is a run of many notes, and the game end phrases are the longest sounds.
    for (const name of SOUND_NAMES.filter((n) => n.startsWith('move.') || n.startsWith('attack.'))) expect(length(name)).toBeLessThan(0.7);
    expect(tunedNotes('check')).toBe(4);
    expect(tunedNotes('castle')).toBeGreaterThanOrEqual(14);
    expect(length('check')).toBeLessThan(0.45);
    for (const name of ['game.win', 'game.lose']) expect(length(name)).toBeGreaterThan(1);
    expect(length('game.win')).toBeGreaterThan(length('castle') * 2);
    for (const name of ['move.pawn', 'move.rook', 'move.bishop', 'move.queen', 'move.king', 'attack.zap', 'attack.cannon', 'attack.stomp', 'attack.slash']) expect(tunedNotes(name), name).toBeLessThanOrEqual(3);
  });
});

describe('volume', () => {
  it('starts at 0.8 and clamps to 0..1', () => {
    expect(sfx.getVolume()).toBe(0.8);
    sfx.setVolume(2);
    expect(sfx.getVolume()).toBe(1);
    sfx.setVolume(-1);
    expect(sfx.getVolume()).toBe(0);
    sfx.setVolume(0.25);
    expect(sfx.getVolume()).toBe(0.25);
  });

  it('ignores values that are not finite numbers', () => {
    sfx.setVolume(0.6);
    for (const bad of [NaN, Infinity, -Infinity, '0.2', null, undefined, {}]) sfx.setVolume(bad);
    expect(sfx.getVolume()).toBe(0.6);
  });

  it('moves the master gain, on a curve that is silent at 0', () => {
    const ctx = unlocked();
    const [clipper] = ctx.destination.inputs;
    const [master] = clipper.inputs;
    sfx.setVolume(1);
    const full = master.gain.finalValue;
    expect(full).toBeGreaterThan(0.3);
    expect(full).toBeLessThanOrEqual(1);
    sfx.setVolume(0.5);
    expect(master.gain.finalValue).toBeCloseTo(full * 0.25, 6);
    sfx.setVolume(0);
    expect(master.gain.finalValue).toBe(0);
    // Each change replaces the one before, so a dragged slider cannot build up a long list of events.
    for (let i = 0; i < 50; i++) sfx.setVolume(i / 50);
    expect(master.gain.events.length).toBeLessThanOrEqual(2);
  });

  it('uses a volume that was set before unlock', () => {
    const masterGainAfterUnlock = (volume) => {
      const { contexts } = install();
      sfx.setVolume(volume);
      sfx.unlock();
      const [clipper] = contexts[0].destination.inputs;
      const [master] = clipper.inputs;
      expect(master.gain.events).toHaveLength(0);
      return master.gain.value;
    };
    const loud = masterGainAfterUnlock(1);
    expect(masterGainAfterUnlock(0.5)).toBeCloseTo(loud * 0.25, 6);
    expect(masterGainAfterUnlock(0)).toBe(0);
  });

  it('plays again after the volume comes back up from 0', () => {
    const ctx = unlocked();
    sfx.setVolume(0);
    sfx.play('ui.click');
    expect(ctx.sources).toHaveLength(0);
    sfx.setVolume(0.4);
    sfx.play('ui.click');
    expect(ctx.sources.length).toBeGreaterThan(0);
  });
});

describe('unknown names', () => {
  it('warns once per name and plays nothing', () => {
    const ctx = unlocked();
    sfx.play('move.dragon');
    sfx.play('move.dragon');
    sfx.play('move.dragon', { gain: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/unknown sound/i);
    expect(warn.mock.calls[0][0]).toContain('move.dragon');
    sfx.play('attack.laser');
    sfx.play('attack.laser');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(ctx.nodes).toHaveLength(ctx.chain.size);
  });

  it('warns even before unlock, so a typo shows up early', () => {
    install();
    sfx.play('ui.clik');
    sfx.play('ui.clik');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws on odd input', () => {
    const ctx = unlocked();
    const odd = [undefined, null, 42, '', {}, [1, 2], Symbol('x'), 'constructor', '__proto__', 'toString', 'UI.CLICK', ' ui.click'];
    for (const name of odd) {
      expect(() => sfx.play(name)).not.toThrow();
      expect(() => sfx.play(name, { pitch: 2 })).not.toThrow();
    }
    expect(warn).toHaveBeenCalledTimes(odd.length);
    expect(ctx.nodes).toHaveLength(ctx.chain.size);
  });

  it('stops warning after many different bad names', () => {
    unlocked();
    for (let i = 0; i < 500; i++) sfx.play(`bad.${i}`);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(100);
  });
});

describe('options', () => {
  const firstFrequency = (ctx) => audibleOscillators(ctx)[0].frequency.events[0].value;

  it('multiplies every frequency by pitch', () => {
    const base = playFresh('piece.select');
    const high = playFresh('piece.select', { pitch: 2 });
    const baseOsc = audibleOscillators(base)[0];
    const highOsc = audibleOscillators(high)[0];
    expect(baseOsc.frequency.events.map((event) => event.value)).toEqual([620, 1240]);
    expect(highOsc.frequency.events.map((event) => event.value)).toEqual([1240, 2480]);
  });

  it('honours pitch for promote.build, including its noise filters', () => {
    const filterFrequencies = (ctx) => voiceNodes(ctx).filter((node) => node instanceof FakeBiquad).map((node) => node.frequency.events[0].value);
    const low = playFresh('promote.build', { pitch: 1 });
    const high = playFresh('promote.build', { pitch: 1.5 });
    expect(filterFrequencies(low).length).toBeGreaterThan(0);
    filterFrequencies(low).forEach((f, i) => expect(filterFrequencies(high)[i]).toBeCloseTo(f * 1.5, 6));
    audibleOscillators(low).forEach((osc, i) => expect(audibleOscillators(high)[i].frequency.events[0].value).toBeCloseTo(osc.frequency.events[0].value * 1.5, 6));
  });

  it('adds a random pitch variation of at most 3 percent', () => {
    randomValue = 0;
    expect(firstFrequency(playFresh('piece.select'))).toBeCloseTo(620 * 0.97, 6);
    randomValue = 0.999999;
    expect(firstFrequency(playFresh('piece.select'))).toBeCloseTo(620 * 1.03, 3);

    Math.random = realRandom;
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const ratio = firstFrequency(playFresh('piece.select')) / 620;
      expect(ratio).toBeGreaterThanOrEqual(0.97);
      expect(ratio).toBeLessThanOrEqual(1.03);
      seen.add(ratio.toFixed(6));
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('keeps one variation for the whole sound, so a tune stays in tune', () => {
    randomValue = 0.9;
    const ctx = playFresh('tutorial.success');
    const notes = audibleOscillators(ctx).map((osc) => osc.frequency.events[0].value).sort((a, b) => a - b);
    // C5, E5 and G5 keep their ratios (a major third and a fifth above C).
    expect(notes[1] / notes[0]).toBeCloseTo(2 ** (4 / 12), 6);
    expect(notes[2] / notes[0]).toBeCloseTo(2 ** (7 / 12), 6);
  });

  it('falls back to pitch 1 for bad values and limits extreme ones', () => {
    for (const bad of [0, -2, NaN, Infinity, '2', null]) expect(firstFrequency(playFresh('piece.select', { pitch: bad }))).toBe(620);
    expect(firstFrequency(playFresh('piece.select', { pitch: 1000 }))).toBe(620 * 4);
    expect(firstFrequency(playFresh('piece.select', { pitch: 0.0001 }))).toBe(620 * 0.25);
  });

  it('applies gain to the output of the sound', () => {
    const outGain = (ctx) => [...ctx.bus.inputs][0].gain.value;
    expect(outGain(playFresh('check'))).toBe(1);
    expect(outGain(playFresh('check', { gain: 0.7 }))).toBe(0.7);
    expect(outGain(playFresh('check', { gain: 5 }))).toBe(1);
    for (const bad of [NaN, '0.5', null, undefined]) expect(outGain(playFresh('check', { gain: bad }))).toBe(1);
  });

  it('creates nothing when gain is 0 or negative', () => {
    const ctx = unlocked();
    sfx.play('check', { gain: 0 });
    sfx.play('check', { gain: -1 });
    expect(ctx.nodes).toHaveLength(ctx.chain.size);
  });

  it('starts later by delay', () => {
    // Read the times at once: making the next fresh context resets the module, which stops the sources of the one before.
    const timing = (opts) => {
      const ctx = playFresh('check', opts);
      return { start: firstStart(ctx), stop: lastStop(ctx) };
    };
    const now = timing();
    const later = timing({ delay: 0.15 });
    expect(later.start - now.start).toBeCloseTo(0.15, 6);
    expect(later.stop - now.stop).toBeCloseTo(0.15, 6);
    expect(now.start).toBeLessThan(0.05);
    for (const bad of [-1, NaN, Infinity, '1', null]) expect(timing({ delay: bad }).start).toBe(now.start);
  });

  it('schedules from the current time of the context', () => {
    const ctx = unlocked();
    ctx.advance(12.5);
    sfx.play('check', { delay: 0.2 });
    expect(firstStart(ctx)).toBeGreaterThanOrEqual(12.7);
    expect(firstStart(ctx)).toBeLessThan(12.75);
  });

  it('accepts a missing or odd options value', () => {
    const ctx = unlocked();
    for (const opts of [undefined, null, {}, 5, 'loud', []]) expect(() => sfx.play('ui.click', opts)).not.toThrow();
    expect(connectedVoices(ctx)).toBe(6);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(SOUND_NAMES)('duration stretches "%s" only if it is a stretchable sound', (name) => {
    const length = (opts) => {
      const ctx = playFresh(name, opts);
      return lastStop(ctx) - firstStart(ctx);
    };
    const normal = length();
    if (STRETCHABLE_SOUNDS.includes(name)) {
      expect(length({ duration: normal + 0.2 })).toBeGreaterThan(normal + 0.1);
      expect(length({ duration: 0.3 })).toBeLessThan(length({ duration: 0.6 }));
      // Extreme hints are limited, so a sound is never endless and never shorter than it can be played.
      expect(length({ duration: 600 })).toBeLessThanOrEqual(2.1);
      expect(length({ duration: 0.0001 })).toBeGreaterThanOrEqual(0.1);
      for (const bad of [0, -1, NaN, Infinity, '1', null]) expect(length({ duration: bad })).toBeCloseTo(normal, 6);
    } else {
      for (const duration of [0.05, 0.6, 3]) expect(length({ duration })).toBeCloseTo(normal, 6);
    }
  });

  it('gives the travel sounds the length that was asked for', () => {
    for (const name of ['move.rook', 'move.bishop', 'move.queen']) {
      const ctx = playFresh(name, { duration: 0.6 });
      expect(lastStop(ctx) - firstStart(ctx)).toBeGreaterThanOrEqual(0.6);
      expect(lastStop(ctx) - firstStart(ctx)).toBeLessThan(0.7);
    }
  });
});

describe('polyphony', () => {
  it('never keeps more than 24 sounds playing and drops the oldest first', () => {
    const ctx = unlocked();
    const outputs = [];
    for (let i = 0; i < 40; i++) {
      sfx.play(LONG_SOUND);
      outputs.push([...ctx.bus.inputs].find((node) => !outputs.includes(node)));
      ctx.advance(0.001);
    }
    // The dropped sounds get a few milliseconds to fade out, then they are gone.
    ctx.advance(0.1);
    expect(connectedVoices(ctx)).toBe(MAX_VOICES);
    outputs.slice(0, 16).forEach((node) => expect(isConnected(node)).toBe(false));
    outputs.slice(16).forEach((node) => expect(node.outputs.has(ctx.bus)).toBe(true));
    expect(warn).not.toHaveBeenCalled();
  });

  it('fades a dropped sound out instead of cutting it', () => {
    const ctx = unlocked();
    sfx.play(LONG_SOUND);
    const [first] = ctx.bus.inputs;
    const firstSources = [...ctx.sources];
    for (let i = 0; i < MAX_VOICES; i++) sfx.play(LONG_SOUND);
    const events = first.gain.events;
    expect(events[events.length - 1]).toMatchObject({ type: 'linear', value: 0 });
    expect(events[events.length - 1].time).toBeLessThan(0.05);
    for (const source of firstSources) expect(source.stopTime).toBeLessThan(0.1);
    ctx.advance(0.1);
    expect(isConnected(first)).toBe(false);
    for (const source of firstSources) expect(isConnected(source)).toBe(false);
  });

  it('stays bounded even when no sound ever ends', () => {
    const ctx = unlocked();
    for (let i = 0; i < 300; i++) sfx.play(LONG_SOUND);
    // At most 24 playing plus 24 in their fade-out.
    expect(connectedVoices(ctx)).toBeLessThanOrEqual(MAX_VOICES * 2);
    const connected = voiceNodes(ctx).filter(isConnected).length;
    expect(connected).toBeLessThanOrEqual(MAX_VOICES * 2 * 48);
    ctx.advance(0.1);
    expect(connectedVoices(ctx)).toBe(MAX_VOICES);
  });

  it('drops a playing sound before one that still waits for its delay', () => {
    const ctx = unlocked();
    sfx.play(LONG_SOUND, { delay: 1 });
    const [delayed] = ctx.bus.inputs;
    sfx.play(LONG_SOUND);
    const playing = [...ctx.bus.inputs].find((node) => node !== delayed);
    for (let i = 0; i < MAX_VOICES - 1; i++) sfx.play(LONG_SOUND);
    ctx.advance(0.1);
    expect(isConnected(delayed)).toBe(true);
    expect(isConnected(playing)).toBe(false);
    expect(connectedVoices(ctx)).toBe(MAX_VOICES);
  });

  it('has room again after sounds have ended', () => {
    const ctx = unlocked();
    for (let i = 0; i < MAX_VOICES; i++) sfx.play('ui.click');
    ctx.advance(1);
    expect(connectedVoices(ctx)).toBe(0);
    for (let i = 0; i < MAX_VOICES; i++) sfx.play(LONG_SOUND);
    expect(connectedVoices(ctx)).toBe(MAX_VOICES);
    // No sound of the second round was dropped: none of them has a fade-out.
    for (const out of ctx.bus.inputs) expect(out.gain.events).toHaveLength(0);
  });

  it('cuts at once when the context is not running, because a fade would never finish', () => {
    const ctx = unlocked({ autoStart: false });
    for (let i = 0; i < 60; i++) sfx.play(LONG_SOUND);
    expect(connectedVoices(ctx)).toBe(MAX_VOICES);
    expect(voiceNodes(ctx).filter(isConnected).length).toBeLessThanOrEqual(MAX_VOICES * 48);
  });
});

describe('cleanup over a long game', () => {
  it('does not leak nodes', () => {
    const ctx = unlocked();
    for (let i = 0; i < 400; i++) {
      sfx.play(SOUND_NAMES[i % SOUND_NAMES.length], { delay: (i % 3) * 0.05 });
      ctx.advance(0.3);
    }
    ctx.advance(5);
    expect(connectedVoices(ctx)).toBe(0);
    expect(voiceNodes(ctx).filter(isConnected)).toHaveLength(0);
    expect(ctx.sources.filter((source) => source.onended !== null)).toHaveLength(0);
    // One shared noise buffer for the whole game.
    expect(ctx.buffers).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps a sound alive until its last source has ended', () => {
    const ctx = playFresh('game.win');
    const stops = [...new Set(ctx.sources.map((source) => source.stopTime))].sort((a, b) => a - b);
    expect(stops.length).toBeGreaterThan(2);
    ctx.advance(stops[0] - ctx.currentTime + 0.001);
    expect(connectedVoices(ctx)).toBe(1);
    expect(voiceNodes(ctx).every((node) => node.disconnectCalls === 0)).toBe(true);
    ctx.advance(stops[stops.length - 1] - ctx.currentTime + 0.001);
    expect(connectedVoices(ctx)).toBe(0);
  });

  it('cleans up by the clock when the browser drops ended events', () => {
    const ctx = unlocked({ fireEnded: false });
    for (let i = 0; i < 10; i++) sfx.play('check');
    ctx.advance(3);
    expect(connectedVoices(ctx)).toBe(10);
    sfx.play('ui.click');
    expect(connectedVoices(ctx)).toBe(1);
    expect(voiceNodes(ctx).filter(isConnected).length).toBeLessThanOrEqual(48);
  });

  it('leaves nothing behind when a recipe fails half way', () => {
    const ctx = unlocked();
    ctx.failOn = 'createBiquadFilter';
    expect(() => sfx.play('attack.cannon')).not.toThrow();
    expect(() => sfx.play('attack.cannon')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('attack.cannon');
    expect(connectedVoices(ctx)).toBe(0);
    expect(voiceNodes(ctx).filter(isConnected)).toHaveLength(0);
    expect(ctx.sources.filter((source) => source.onended !== null)).toHaveLength(0);
    // Sources that had started are stopped right away, so no half-built sound keeps ringing.
    for (const source of ctx.sources) if (source.startTime !== null) expect(source.stopTime).toBeLessThanOrEqual(ctx.currentTime);

    ctx.failOn = null;
    sfx.play('attack.cannon');
    expect(connectedVoices(ctx)).toBe(1);
  });

  it('survives a context that cannot even make a gain node', () => {
    const ctx = unlocked();
    ctx.failOn = 'createGain';
    expect(() => sfx.play('ui.click')).not.toThrow();
    expect(connectedVoices(ctx)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('a context that is not running', () => {
  it('still schedules sounds right after unlock, so the first tap is heard', () => {
    const ctx = unlocked({ autoStart: false });
    expect(ctx.state).toBe('suspended');
    sfx.play('ui.click');
    expect(connectedVoices(ctx)).toBe(1);
    clock += 400;
    sfx.play('ui.click');
    expect(connectedVoices(ctx)).toBe(2);
  });

  it('drops sounds once the context has stayed suspended, so they cannot burst out later', () => {
    const ctx = unlocked({ autoStart: false });
    clock += 501;
    const before = ctx.nodes.length;
    for (let i = 0; i < 50; i++) sfx.play(LONG_SOUND);
    expect(ctx.nodes).toHaveLength(before);
    expect(warn).not.toHaveBeenCalled();

    ctx.start();
    sfx.play('ui.click');
    expect(connectedVoices(ctx)).toBe(1);
  });

  it('drops old sounds at the next gesture, so they do not all play when audio starts', () => {
    const ctx = unlocked({ autoStart: false });
    sfx.play('ui.click');
    sfx.play('move.pawn');
    expect(connectedVoices(ctx)).toBe(2);
    // The second tap comes two seconds later, while the context is still suspended.
    clock += 2000;
    sfx.unlock();
    expect(connectedVoices(ctx)).toBe(0);
    expect(voiceNodes(ctx).filter(isConnected)).toHaveLength(0);
    sfx.play('ui.click');
    ctx.start();
    expect(connectedVoices(ctx)).toBe(1);
  });

  it('keeps the sound of a finger-down when audio starts on the finger-up', () => {
    const ctx = unlocked({ autoStart: false });
    sfx.play('piece.select');
    clock += 120;
    sfx.unlock();
    expect(connectedVoices(ctx)).toBe(1);
    ctx.start();
    ctx.advance(1);
    expect(connectedVoices(ctx)).toBe(0);
    expect(ctx.sources.every((source) => source.ended)).toBe(true);
  });

  it('drops a sound that was cut off by an interruption', () => {
    const ctx = unlocked();
    sfx.play(LONG_SOUND);
    ctx.advance(0.2);
    ctx.state = 'interrupted';
    ctx.autoStart = false;
    clock += 30000;
    sfx.unlock();
    expect(connectedVoices(ctx)).toBe(0);
  });

  it('keeps playing sounds when unlock is called on a running context', () => {
    const ctx = unlocked();
    sfx.play(LONG_SOUND);
    sfx.unlock();
    sfx.unlock();
    expect(connectedVoices(ctx)).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
  });

  it('asks the browser to resume, but only one request at a time', async () => {
    const ctx = unlocked({ autoStart: false });
    clock += 1000;
    sfx.play('ui.click');
    sfx.play('ui.click');
    expect(ctx.resumeCalls).toBe(1);
    ctx.refuse();
    await Promise.resolve();
    await Promise.resolve();
    sfx.play('ui.click');
    sfx.play('ui.click');
    expect(ctx.resumeCalls).toBe(2);
    expect(ctx.nodes).toHaveLength(ctx.chain.size);
    expect(warn).not.toHaveBeenCalled();
  });

  it('plays again after a new gesture on an interrupted context', () => {
    const ctx = unlocked();
    ctx.state = 'interrupted';
    ctx.autoStart = false;
    clock += 5000;
    sfx.play('check');
    expect(connectedVoices(ctx)).toBe(0);
    sfx.unlock();
    sfx.play('check');
    expect(connectedVoices(ctx)).toBe(1);
    ctx.start();
    sfx.play('check');
    expect(connectedVoices(ctx)).toBe(2);
  });

  it('works with an old context that has no state and no resume', () => {
    const { contexts, factory } = install();
    factory.mockImplementationOnce(() => {
      const ctx = new FakeAudioContext();
      ctx.state = undefined;
      ctx.resume = undefined;
      contexts.push(ctx);
      return ctx;
    });
    expect(() => sfx.unlock()).not.toThrow();
    sfx.play('ui.click');
    expect(contexts[0].sources.length).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('stopAll', () => {
  it('fades out playing sounds and cancels delayed ones', () => {
    const ctx = unlocked();
    sfx.play(LONG_SOUND);
    sfx.play('attack.cannon', { delay: 0.5 });
    const delayedSources = ctx.sources.filter((source) => source.startTime >= 0.5);
    expect(delayedSources.length).toBeGreaterThan(0);
    ctx.advance(0.1);
    sfx.stopAll();
    for (const out of ctx.bus.inputs) {
      const events = out.gain.events;
      expect(events[events.length - 1]).toMatchObject({ type: 'linear', value: 0 });
    }
    // A delayed source is stopped before its start time, so it never makes a sound.
    for (const source of delayedSources) expect(source.stopTime).toBeLessThan(source.startTime);
    ctx.advance(0.1);
    expect(connectedVoices(ctx)).toBe(0);
    expect(voiceNodes(ctx).filter(isConnected)).toHaveLength(0);

    sfx.play('ui.click');
    expect(connectedVoices(ctx)).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('is safe to call at any time', () => {
    install();
    expect(() => sfx.stopAll()).not.toThrow();
    const ctx = unlocked();
    expect(() => sfx.stopAll()).not.toThrow();
    sfx.play('check');
    sfx.stopAll();
    sfx.stopAll();
    ctx.advance(1);
    expect(connectedVoices(ctx)).toBe(0);
  });
});

describe('test hook', () => {
  it('resets the module and closes the old context', () => {
    const ctx = unlocked();
    sfx.setVolume(0.2);
    sfx.play(LONG_SOUND);
    sfx.play('nope');
    expect(warn).toHaveBeenCalledTimes(1);

    const { contexts } = install();
    expect(ctx.closeCalls).toBe(1);
    expect(voiceNodes(ctx).filter(isConnected)).toHaveLength(0);
    expect(sfx.getVolume()).toBe(0.8);
    sfx.play('ui.click');
    expect(contexts).toHaveLength(0);
    sfx.play('nope');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
