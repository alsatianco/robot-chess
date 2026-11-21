// Sound effects for Robot Chess. Every sound is made in the browser with the Web Audio API; there are no audio files. Each sound is a small recipe built from a few shared helpers (tone, noise, bell, beep, thud, tap, servo). All sounds go through one soft limiter, one master volume and a soft clipper, so stacked sounds never clip.
//
// The players are children, often on phone speakers. So the recipes follow three rules: sounds are short, low thuds always carry a mid layer (a phone speaker cannot play deep bass), and nothing is bright enough to hurt (oscillators stay under 6 kHz and the whole mix passes a gentle low-pass).

/** Most sounds that may play at the same time. When a new sound would go over this number, the oldest one is faded out. */
const MAX_VOICES = 24;
/** Volume used until the settings screen calls `setVolume`. */
const DEFAULT_VOLUME = 0.8;
/** Each play is tuned up or down by a random amount up to this share (3 percent), so repeated moves do not sound like a machine gun. */
const PITCH_JITTER = 0.03;
const MIN_PITCH = 0.25;
const MAX_PITCH = 4;
/** Sounds start this many seconds after "now". This keeps short attacks exact, because the audio thread may already be a little ahead of `currentTime`. */
const LOOKAHEAD = 0.01;
/** Sources stop this long after their envelope reaches zero. */
const STOP_MARGIN = 0.02;
/** Fade time when a sound is cut short (voice stealing and `stopAll`). */
const FADE_OUT = 0.03;
/** A voice whose end time passed this long ago is cleaned up by hand, in case the browser did not fire its `ended` event. */
const SWEEP_MARGIN = 0.25;
/** After `unlock` asks the browser to start audio, sounds are still scheduled for this long while the context reports "suspended". Firefox and Safari start the context a few milliseconds after the tap, and without this window the first click would be lost. After the window, sounds are dropped so they cannot pile up and burst out later. A sound that has waited longer than this on a suspended context is also thrown away at the next `unlock`. */
const RESUME_GRACE_MS = 500;
/** Final gain after the limiter at volume 1. The limiter adds its own make-up gain (about +4 dB with the settings below), so this trim brings a single sound back close to the level written in its recipe and leaves headroom. */
const OUTPUT_TRIM = 0.7;
/** The last node is a soft clipper. It passes everything under `CLIP_KNEE` unchanged and bends louder peaks smoothly so the output can never go over `CLIP_CEILING`. In normal play the limiter keeps the signal under the knee; the clipper only catches the short peaks that a limiter lets through when many sounds start in the same instant. */
const CLIP_KNEE = 0.6;
const CLIP_CEILING = 0.9;
/** Percussive envelopes fall to this share of their peak (-60 dB) before the last short ramp to zero. An exponential ramp cannot reach zero. */
const DECAY_FLOOR = 0.001;
const MIN_HZ = 20;
const MAX_OSC_HZ = 6000;
const MAX_FILTER_HZ = 12000;
/** Length of the shared white noise buffer. Noise bursts loop over it from a random start point. */
const NOISE_SECONDS = 1;
const MAX_WARNINGS = 100;

/**
 * Options for one `sfx.play` call.
 * @typedef {Object} PlayOptions
 * @property {number} [pitch=1] Frequency multiplier, limited to 0.25..4. A small random variation (about 3 percent) is always added on top.
 * @property {number} [gain=1] Loudness from 0 to 1, on top of the master volume. 0 plays nothing.
 * @property {number} [delay=0] Seconds from now until the sound starts.
 * @property {number} [duration] Length hint in seconds for sounds that can stretch (see `STRETCHABLE_SOUNDS`). One-shot sounds ignore it.
 */

/**
 * A value that may change over the length of a layer: one number (steady), a `[from, to]` pair (a smooth sweep over the whole layer), or a list of `[position, value]` points where position runs from 0 (start) to 1 (end).
 * @typedef {number | [number, number] | Array<[number, number]>} Contour
 */

/**
 * A filter for one layer. For "lowpass" and "highpass" `q` is the resonance peak in dB (Web Audio rule); for "bandpass" it is the plain Q factor.
 * @typedef {Object} FilterSpec
 * @property {'lowpass'|'highpass'|'bandpass'} type
 * @property {Contour} f Cutoff or centre frequency in Hz.
 * @property {number} q
 */

/**
 * One layer of a sound: a source, an optional filter, an optional tremolo and a loudness envelope.
 * @typedef {Object} LayerSpec
 * @property {number} [at=0] Start offset in seconds from the start of the sound.
 * @property {number} dur Length in seconds.
 * @property {number} gain Peak level, 0..1.
 * @property {number} [a] Attack time in seconds. Default 0.005 for tones and 0.002 for noise.
 * @property {number} [d] Decay time in seconds from the peak down to the sustain level. Default: the whole time until the release starts.
 * @property {number} [s] Sustain level as a share of the peak. 1 is a flat note, 0 is a percussive hit that rings out. Tones default to 1 and noise defaults to 0.
 * @property {number} [r] Release time in seconds. Default 0.03, or 0.005 for a percussive layer.
 * @property {FilterSpec} [filter]
 * @property {{rate: number, depth: number, type?: OscillatorType}} [trem] Tremolo: the level wobbles `rate` times per second between 1 and `1 - depth`.
 * @property {'sine'|'triangle'|'square'|'sawtooth'} [type] Tones only. Default "sine".
 * @property {Contour} [f] Tones only. Frequency in Hz.
 * @property {{rate: number, cents: number}} [vib] Tones only. Vibrato: the pitch wobbles `rate` times per second by plus or minus `cents`.
 */

const lp = (f, q = 0) => ({ type: 'lowpass', f, q });
const bp = (f, q = 1) => ({ type: 'bandpass', f, q });

/** Note frequencies in Hz for the natural notes of octaves 3 to 7 (equal temperament, A4 = 440), for example `N.C5`. All tuned cues use the C major scale, so cues that overlap still sound good together. */
const N = (() => {
  const steps = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const table = {};
  for (const [letter, step] of Object.entries(steps)) {
    for (let octave = 3; octave <= 7; octave++) table[letter + octave] = 440 * 2 ** ((step + (octave - 4) * 12) / 12);
  }
  return Object.freeze(table);
})();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** Wall-clock time in milliseconds. The audio clock cannot be used to time a suspended context, because it stands still. */
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();
const finiteOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

// ---------------------------------------------------------------------------------------------------------------------
// Module state. There is one AudioContext for the whole page, created on the first `unlock`.
// ---------------------------------------------------------------------------------------------------------------------

let contextFactory = defaultContextFactory;
/** @type {AudioContext|null} */
let ctx = null;
/** @type {AudioNode|null} Every voice connects here: low-pass -> limiter -> master gain -> soft clipper -> speakers. */
let input = null;
/** @type {GainNode|null} */
let master = null;
/** @type {AudioBuffer|null} */
let noiseBuffer = null;
let volume = DEFAULT_VOLUME;
let resumeRequestedAt = -Infinity;
let resumeInFlight = false;
/** @type {Voice[]} Sounds that are playing or waiting for their delay. */
const voices = [];
/** @type {Voice[]} Sounds that were cut short and are in their last few milliseconds of fade-out. */
const fading = [];
const warned = new Set();

function warnOnce(key, ...message) {
  if (warned.has(key) || warned.size >= MAX_WARNINGS) return;
  warned.add(key);
  console.warn(...message);
}

function defaultContextFactory() {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return new Ctor();
  }
}

/** The slider value is squared so that the volume slider feels even to the ear: half way on the slider sounds about half as loud. */
function volumeToGain(value) {
  return value * value * OUTPUT_TRIM;
}

/** The transfer curve of the soft clipper: a straight line up to the knee, then a smooth bend that reaches the ceiling at full scale. The two parts meet with the same slope, so there is no corner. */
function softClipCurve() {
  const size = 1025; // An odd size puts one point exactly at zero, so silence stays silence.
  const curve = new Float32Array(size);
  const power = (1 - CLIP_KNEE) / (CLIP_CEILING - CLIP_KNEE);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const level = Math.abs(x);
    const bent = level <= CLIP_KNEE ? level : CLIP_CEILING - (CLIP_CEILING - CLIP_KNEE) * ((1 - level) / (1 - CLIP_KNEE)) ** power;
    curve[i] = Math.sign(x) * bent;
  }
  return curve;
}

function buildOutput(context) {
  // A gentle low-pass over the whole mix is a safety net against harsh highs on small speakers. Q is in dB for a low-pass; -3 gives a flat response with no peak.
  const soften = context.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 9000;
  soften.Q.value = -3;
  // The compressor works as a soft limiter. One sound alone stays under the threshold and passes unchanged; many sounds together are squeezed instead of clipping.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  const out = context.createGain();
  out.gain.value = volumeToGain(volume);
  const clipper = context.createWaveShaper();
  clipper.curve = softClipCurve();
  soften.connect(limiter);
  limiter.connect(out);
  out.connect(clipper);
  clipper.connect(context.destination);
  return { input: soften, master: out };
}

function getNoiseBuffer() {
  if (!noiseBuffer) {
    const length = Math.max(1, Math.round(ctx.sampleRate * NOISE_SECONDS));
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function requestResume() {
  if (typeof ctx.resume !== 'function') return;
  const owner = ctx;
  const settle = () => {
    if (ctx === owner) resumeInFlight = false;
  };
  resumeInFlight = true;
  try {
    const promise = ctx.resume();
    if (promise && typeof promise.then === 'function') promise.then(settle, settle);
    else settle();
  } catch {
    settle();
  }
}

/** Close a context we no longer use, so the browser can free the audio device. Errors do not matter here. */
function closeQuietly(context) {
  try {
    const promise = context?.close?.();
    if (promise && typeof promise.catch === 'function') promise.catch(() => {});
  } catch {
    // Nothing to do: the context is gone either way.
  }
}

/** Stop and disconnect every voice at once, with no fade. */
function releaseAllVoices() {
  while (voices.length) releaseVoice(voices[0]);
  while (fading.length) releaseVoice(fading[0]);
}

/** On a context that stands still, throw away the sounds that have waited too long. Without this they would all play in the moment the context starts. A sound from the last half second is kept: on a phone the context often starts on the finger-up event, and the sound of the finger-down event should still be heard. */
function releaseStaleVoices() {
  const cutoff = nowMs() - RESUME_GRACE_MS;
  for (const list of [voices, fading]) for (let i = list.length - 1; i >= 0; i--) if (list[i].createdAt < cutoff) releaseVoice(list[i]);
}

/** Forget the current context and everything that hangs on it. Used when the context is closed or broken and by the test hook. */
function dropContext() {
  releaseAllVoices();
  ctx = null;
  input = null;
  master = null;
  noiseBuffer = null;
  resumeRequestedAt = -Infinity;
  resumeInFlight = false;
}

/** True when a sound scheduled now will be heard at the right time. */
function contextReady() {
  const state = ctx.state;
  if (state === undefined || state === 'running') return true;
  if (state === 'closed') {
    dropContext();
    return false;
  }
  if (nowMs() - resumeRequestedAt <= RESUME_GRACE_MS) return true;
  // The context was paused by the browser (for example a phone call or a hidden tab on iOS). Ask for a restart, but drop this sound: a context that is not running keeps scheduled sounds and would play them all at once later.
  if (!resumeInFlight) requestResume();
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Voices. One `play` call makes one voice: a group of nodes with one output gain. When the last source of a voice ends, all its nodes are disconnected so the browser can free them.
// ---------------------------------------------------------------------------------------------------------------------

function removeFrom(list, item) {
  const index = list.indexOf(item);
  if (index !== -1) list.splice(index, 1);
}

/** Stop and disconnect every node of a voice now. Safe to call more than once. */
function releaseVoice(voice) {
  if (voice.released) return;
  voice.released = true;
  removeFrom(voices, voice);
  removeFrom(fading, voice);
  for (const source of voice.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // The source never started or the browser does not allow a second stop. Either way it makes no more sound.
    }
  }
  for (const node of voice.nodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  voice.sources.length = 0;
  voice.nodes.length = 0;
}

function sourceEnded(voice) {
  voice.pending -= 1;
  if (voice.pending <= 0) releaseVoice(voice);
}

/** Cut a voice short with a quick fade, so the cut does not click. Its nodes are disconnected when the fade is over. */
function fadeOutVoice(voice, now) {
  removeFrom(voices, voice);
  if (ctx.state !== undefined && ctx.state !== 'running') {
    releaseVoice(voice);
    return;
  }
  try {
    const stopAt = now + FADE_OUT + STOP_MARGIN;
    voice.out.gain.cancelScheduledValues(now);
    voice.out.gain.setValueAtTime(voice.level, now);
    voice.out.gain.linearRampToValueAtTime(0, now + FADE_OUT);
    for (const source of voice.sources) source.stop(stopAt);
    voice.end = stopAt;
  } catch {
    releaseVoice(voice);
    return;
  }
  fading.push(voice);
  while (fading.length > MAX_VOICES) releaseVoice(fading[0]);
}

/** Clean up voices whose end time has passed but whose `ended` event never came. */
function sweepFinished(now) {
  for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end + SWEEP_MARGIN < now) releaseVoice(voices[i]);
  for (let i = fading.length - 1; i >= 0; i--) if (fading[i].end + SWEEP_MARGIN < now) releaseVoice(fading[i]);
}

/** The voice that started first. A sound that still waits for its delay counts as newer than one that already plays. */
function oldestVoice() {
  let oldest = voices[0];
  for (const voice of voices) if (voice.t < oldest.t) oldest = voice;
  return oldest;
}

/** Write a contour onto an AudioParam. All values are multiplied by `scale` (the pitch) and kept inside a safe range. */
function applyContour(param, contour, t, dur, scale, max) {
  const points = typeof contour === 'number' ? [[0, contour]] : typeof contour[0] === 'number' ? [[0, contour[0]], [1, contour[1]]] : contour;
  for (let i = 0; i < points.length; i++) {
    const time = t + clamp(points[i][0], 0, 1) * dur;
    const value = clamp(points[i][1] * scale, MIN_HZ, max);
    if (i === 0) {
      param.setValueAtTime(value, t);
      if (time > t) param.setValueAtTime(value, time);
    } else {
      param.exponentialRampToValueAtTime(value, time);
    }
  }
}

/** Write a loudness envelope onto a gain param: silence, a linear attack to `peak`, an exponential decay to `peak * s`, a hold, then a linear release back to silence at `t + dur`. */
function applyEnvelope(param, t, dur, peak, a, d, s, r) {
  const attack = clamp(a, 0.001, dur * 0.9);
  const release = clamp(r, 0.002, dur - attack);
  const attackEnd = t + attack;
  const releaseAt = t + dur - release;
  let level = peak;
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, attackEnd);
  if (s < 1) {
    const decayEnd = d === undefined ? releaseAt : Math.min(attackEnd + d, releaseAt);
    if (decayEnd > attackEnd) {
      level = peak * Math.max(s, DECAY_FLOOR);
      param.exponentialRampToValueAtTime(level, decayEnd);
    }
  }
  param.setValueAtTime(level, releaseAt);
  param.linearRampToValueAtTime(0, t + dur);
}

/** One playing sound. Recipes receive a Voice and call its helpers to add layers. */
class Voice {
  /**
   * @param {number} start Context time when the sound begins.
   * @param {number} pitch Frequency multiplier for every oscillator and filter in this sound.
   * @param {number} level Output gain of the whole sound (the `gain` option).
   * @param {number|undefined} durationHint The `duration` option, if any.
   */
  constructor(start, pitch, level, durationHint) {
    this.t = start;
    this.pitch = pitch;
    this.level = level;
    this.durationHint = durationHint;
    /** @type {AudioNode[]} */
    this.nodes = [];
    /** @type {AudioScheduledSourceNode[]} */
    this.sources = [];
    this.pending = 0;
    this.end = start;
    this.released = false;
    /** Wall-clock time of the `play` call, used to find stale sounds on a suspended context. */
    this.createdAt = nowMs();
    this.out = this.add(ctx.createGain());
    this.out.gain.value = level;
    this.out.connect(input);
  }

  /** Remember a node so it is disconnected when the voice ends. */
  add(node) {
    this.nodes.push(node);
    return node;
  }

  /** Length of a stretchable sound: the caller's `duration` hint if there is one, else `fallback`, kept between `min` and `max`. */
  span(fallback, min, max) {
    return clamp(this.durationHint ?? fallback, min, max);
  }

  /** Start a source at time `t` for `dur` seconds and count it, so the voice knows when its last source has ended. */
  run(source, t, dur, offset) {
    const stopAt = t + dur + STOP_MARGIN;
    source.onended = () => sourceEnded(this);
    if (offset === undefined) source.start(t);
    else source.start(t, offset);
    this.sources.push(source);
    this.pending += 1;
    source.stop(stopAt);
    if (stopAt > this.end) this.end = stopAt;
  }

  /** A low-frequency oscillator that moves `param` up and down by `depth`. */
  lfo(param, rate, depth, t, dur, type = 'sine') {
    const osc = this.add(ctx.createOscillator());
    osc.type = type;
    osc.frequency.value = rate;
    const amount = this.add(ctx.createGain());
    amount.gain.value = depth;
    osc.connect(amount);
    amount.connect(param);
    this.run(osc, t, dur);
  }

  /** Connect a source through the optional filter and tremolo of a layer, then through its envelope, to the voice output. */
  route(source, o, t, dur, defaultSustain, defaultAttack) {
    let node = source;
    if (o.filter) {
      const filter = this.add(ctx.createBiquadFilter());
      filter.type = o.filter.type;
      filter.Q.value = o.filter.q;
      applyContour(filter.frequency, o.filter.f, t, dur, this.pitch, Math.min(MAX_FILTER_HZ, ctx.sampleRate * 0.45));
      node.connect(filter);
      node = filter;
    }
    if (o.trem) {
      const chop = this.add(ctx.createGain());
      chop.gain.value = 1 - o.trem.depth / 2;
      this.lfo(chop.gain, o.trem.rate, o.trem.depth / 2, t, dur, o.trem.type);
      node.connect(chop);
      node = chop;
    }
    const amp = this.add(ctx.createGain());
    amp.gain.value = 0;
    const sustain = o.s ?? defaultSustain;
    applyEnvelope(amp.gain, t, dur, o.gain, o.a ?? defaultAttack, o.d, sustain, o.r ?? (sustain < 0.05 ? 0.005 : 0.03));
    node.connect(amp);
    amp.connect(this.out);
  }

  /**
   * Add one oscillator layer.
   * @param {LayerSpec} o
   */
  tone(o) {
    const t = this.t + (o.at ?? 0);
    const dur = Math.max(o.dur, 0.01);
    const osc = this.add(ctx.createOscillator());
    osc.type = o.type ?? 'sine';
    applyContour(osc.frequency, o.f, t, dur, this.pitch, MAX_OSC_HZ);
    if (o.vib) this.lfo(osc.detune, o.vib.rate, o.vib.cents, t, dur);
    this.route(osc, o, t, dur, 1, 0.005);
    this.run(osc, t, dur);
  }

  /**
   * Add one white noise layer. It rings out like a hit unless `s` says otherwise.
   * @param {LayerSpec} o
   */
  noise(o) {
    const t = this.t + (o.at ?? 0);
    const dur = Math.max(o.dur, 0.01);
    const source = this.add(ctx.createBufferSource());
    source.buffer = getNoiseBuffer();
    source.loop = true;
    this.route(source, o, t, dur, 0, 0.002);
    this.run(source, t, dur, Math.random() * NOISE_SECONDS * 0.9);
  }

  /** A soft bell: a sine with one quieter partial an octave up. Both ring out. */
  bell(at, f, dur, gain) {
    this.tone({ f, at, dur, gain, a: 0.004, s: 0 });
    this.tone({ f: f * 2, at, dur: dur * 0.55, gain: gain * 0.25, a: 0.004, s: 0 });
  }

  /** A robot beep: a steady note with soft edges. Square and saw beeps pass a low-pass so they stay round. */
  beep(at, f, dur, gain, type = 'triangle') {
    const filter = type === 'square' || type === 'sawtooth' ? lp(Math.min(f * 3, 2600)) : undefined;
    this.tone({ type, f, at, dur, gain, a: 0.006, r: Math.min(0.05, dur * 0.4), filter });
  }

  /** A low thump. The sine that drops from `from` to `to` Hz is the body, which only bigger speakers and headphones can play. The short triangle "knock" above it and the low-passed noise burst are what a phone speaker plays. */
  thud(at, from, to, dur, gain) {
    this.tone({ f: [from, to], at, dur, gain: gain * 0.7, a: 0.003, s: 0 });
    this.tone({ type: 'triangle', f: [from * 3, from * 1.4], at, dur: dur * 0.55, gain: gain * 0.6, a: 0.002, s: 0 });
    this.noise({ at, dur: Math.min(dur, 0.08), gain: gain * 0.6, filter: lp(from * 6) });
  }

  /** A small plastic tap: a very short falling blip with a little noise on top. */
  tap(at, f, gain) {
    this.tone({ f: [f, f * 0.7], at, dur: 0.035, gain, a: 0.001, s: 0 });
    this.noise({ at, dur: 0.016, gain: gain * 0.5, filter: bp(f * 2.5, 1.2) });
  }

  /** A servo whir: a saw wave through a ringing low-pass, with a fast small wobble that sounds like gears. */
  servo(at, f, dur, gain, cutoff = 1500) {
    this.tone({ type: 'sawtooth', f, at, dur, gain, a: 0.012, r: 0.035, filter: lp(cutoff, 5), vib: { rate: 31, cents: 16 } });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Recipes. Each one takes a Voice and adds a few layers. Times are in seconds from the start of the sound and gains are peak levels.
// ---------------------------------------------------------------------------------------------------------------------

/** @type {Record<string, (v: Voice) => void>} */
const RECIPES = {
  // --- UI: soft and small. Buttons are pressed all the time, so these stay well under the game sounds. ---

  'ui.click': (v) => v.tap(0, 820, 0.15),

  'ui.hover': (v) => v.tone({ f: 1320, dur: 0.035, gain: 0.03, a: 0.004, s: 0 }),

  // Two soft notes up a fifth.
  'ui.open': (v) => {
    v.tone({ f: N.C5, dur: 0.06, gain: 0.065, a: 0.006, r: 0.03 });
    v.tone({ f: N.G5, at: 0.055, dur: 0.1, gain: 0.065, a: 0.006, r: 0.06 });
  },

  // The same two notes going down.
  'ui.close': (v) => {
    v.tone({ f: N.G5, dur: 0.06, gain: 0.06, a: 0.006, r: 0.03 });
    v.tone({ f: N.C5, at: 0.055, dur: 0.1, gain: 0.06, a: 0.006, r: 0.06 });
  },

  // A quick "tik-tak" like a small switch.
  'ui.toggle': (v) => {
    v.tone({ type: 'triangle', f: N.E5, dur: 0.035, gain: 0.13, a: 0.002, s: 0 });
    v.tone({ type: 'triangle', f: N.B5, at: 0.045, dur: 0.05, gain: 0.13, a: 0.002, s: 0 });
  },

  // A gentle double low beep.
  'ui.error': (v) => {
    for (const at of [0, 0.13]) v.tone({ type: 'triangle', f: N.E4, at, dur: 0.09, gain: 0.2, a: 0.008, r: 0.03, filter: lp(1400) });
  },

  // --- Piece handling ---

  // A short rising chirp.
  'piece.select': (v) => v.tone({ type: 'triangle', f: [620, 1240], dur: 0.09, gain: 0.105, a: 0.004, r: 0.035 }),

  'piece.deselect': (v) => v.tone({ type: 'triangle', f: [880, 520], dur: 0.08, gain: 0.08, a: 0.004, r: 0.035 }),

  // A soft plastic tap on the board.
  'piece.drop': (v) => {
    v.tap(0, 560, 0.3);
    v.tone({ f: [210, 150], dur: 0.05, gain: 0.12, a: 0.002, s: 0 });
  },

  // A soft "uh-uh" buzz: two low rounded notes, the second one lower.
  illegal: (v) => {
    v.tone({ type: 'square', f: N.G3, dur: 0.09, gain: 0.13, a: 0.01, r: 0.03, filter: lp(1000) });
    v.tone({ type: 'square', f: N.E3, at: 0.11, dur: 0.13, gain: 0.13, a: 0.01, r: 0.05, filter: lp(850) });
  },

  // --- Moves: servo whirs, air and thumps. No tuned notes, so a move never sounds like an alert. ---

  // Two tiny servo steps, a waddle. Each step ends with a small footfall.
  'move.pawn': (v) => {
    v.servo(0, [300, 390], 0.06, 0.13);
    v.tap(0.06, 420, 0.08);
    v.servo(0.11, [270, 350], 0.06, 0.13);
    v.tap(0.17, 380, 0.08);
  },

  // A low tread rumble with a motor whine that spins up and down. Stretches with `duration`.
  'move.rook': (v) => {
    const d = v.span(0.45, 0.2, 2);
    const edge = Math.min(0.09, d * 0.25);
    v.noise({ dur: d, gain: 0.34, a: edge * 0.5, s: 1, r: edge, filter: bp(380, 0.7), trem: { rate: 21, depth: 0.8, type: 'triangle' } });
    v.tone({ type: 'sawtooth', f: [[0, 95], [0.25, 140], [0.8, 135], [1, 100]], dur: d, gain: 0.14, a: edge * 0.5, r: edge, filter: lp(850, 5), vib: { rate: 27, cents: 20 } });
  },

  // A spring "boing" going up.
  'move.knight.jump': (v) => {
    v.tone({ type: 'triangle', f: [[0, 240], [0.75, 700], [1, 760]], dur: 0.26, gain: 0.25, a: 0.006, d: 0.2, s: 0.25, r: 0.05, vib: { rate: 23, cents: 110 } });
    v.noise({ dur: 0.05, gain: 0.07, filter: bp(700, 1) });
  },

  // A thump with a small spring rattle after it.
  'move.knight.land': (v) => {
    v.thud(0, 150, 58, 0.16, 0.38);
    v.tone({ type: 'triangle', f: [520, 430], at: 0.03, dur: 0.17, gain: 0.09, a: 0.004, s: 0, vib: { rate: 36, cents: 160 } });
  },

  // A smooth airy hover glide. Stretches with `duration`.
  'move.bishop': (v) => {
    const d = v.span(0.4, 0.2, 2);
    const a = Math.min(0.12, d * 0.3);
    const r = Math.min(0.2, d * 0.4);
    v.noise({ dur: d, gain: 0.19, a, s: 1, r, filter: bp([[0, 900], [0.5, 1500], [1, 1000]], 1.4) });
    v.tone({ f: [[0, N.E4], [0.5, N.G4], [1, N.F4]], dur: d, gain: 0.09, a, r, vib: { rate: 6, cents: 14 } });
  },

  // A fast whoosh with a bright shimmer: three tiny high bells along the dash. Stretches with `duration`.
  'move.queen': (v) => {
    const d = v.span(0.3, 0.15, 1.5);
    v.noise({ dur: d, gain: 0.2, a: d * 0.35, s: 1, r: d * 0.5, filter: bp([[0, 500], [0.4, 2400], [1, 900]], 1.1) });
    [N.C7, N.E7, N.G7].forEach((f, i) => v.tone({ f, at: d * (0.2 + 0.22 * i), dur: 0.14, gain: 0.04 - i * 0.006, a: 0.003, s: 0 }));
  },

  // One heavy step: a slow servo, then a low thud.
  'move.king': (v) => {
    v.servo(0, [[0, 85], [0.6, 125], [1, 100]], 0.3, 0.13, 650);
    v.thud(0.26, 125, 46, 0.22, 0.4);
  },

  // --- Attacks ---

  // The pawn's electric zap: a fast falling saw that crackles, with a little noise.
  'attack.zap': (v) => {
    v.tone({ type: 'sawtooth', f: [1700, 170], dur: 0.2, gain: 0.2, a: 0.002, s: 0.12, r: 0.02, filter: lp([3600, 1100], 3), trem: { rate: 58, depth: 0.7, type: 'square' } });
    v.noise({ dur: 0.13, gain: 0.11, filter: bp([3000, 900], 1.6) });
  },

  // The rook's cannon: a punchy low boom, a blast of noise and a short tail.
  'attack.cannon': (v) => {
    v.thud(0, 170, 44, 0.34, 0.4);
    v.noise({ dur: 0.24, gain: 0.3, filter: lp([2400, 500]) });
    v.noise({ at: 0.05, dur: 0.45, gain: 0.08, a: 0.02, filter: lp(600) });
  },

  // The bishop's beam: a bright steady laser that starts with a quick "pew". Stretches with `duration`.
  'attack.beam': (v) => {
    const d = v.span(0.4, 0.2, 1);
    v.tone({ type: 'sawtooth', f: [[0, 1300], [0.15, 760], [1, 720]], dur: d, gain: 0.1, a: 0.008, r: 0.07, filter: lp([3400, 2400], 6), vib: { rate: 19, cents: 22 } });
    v.tone({ f: [[0, 2600], [0.15, 1520], [1, 1440]], dur: d, gain: 0.037, a: 0.008, r: 0.07 });
    v.noise({ dur: d, gain: 0.03, a: 0.01, s: 1, r: 0.07, filter: bp(2800, 2) });
  },

  // The knight lands on its target: a heavy thump plus a crunch.
  'attack.stomp': (v) => {
    v.thud(0, 150, 42, 0.26, 0.4);
    v.noise({ at: 0.01, dur: 0.14, gain: 0.32, filter: bp(1300, 0.8), trem: { rate: 75, depth: 0.9, type: 'square' } });
  },

  // The queen's strike: a sharp swish that swells and cuts off.
  'attack.slash': (v) => {
    v.noise({ dur: 0.17, gain: 0.42, a: 0.06, d: 0.1, s: 0.05, r: 0.01, filter: bp([[0, 1000], [0.4, 3200], [1, 1700]], 2) });
    v.tone({ type: 'triangle', f: [1500, 2500], at: 0.04, dur: 0.07, gain: 0.05, a: 0.01, s: 0 });
  },

  // The king's slow heavy hit: a servo wind-up, then a big dull impact.
  'attack.smash': (v) => {
    v.servo(0, [70, 125], 0.2, 0.11, 700);
    v.thud(0.2, 130, 36, 0.42, 0.4);
    v.noise({ at: 0.2, dur: 0.3, gain: 0.32, filter: lp([1600, 350]) });
    v.tone({ type: 'triangle', f: N.B3, at: 0.2, dur: 0.3, gain: 0.13, a: 0.003, s: 0 });
  },

  // The rook rams its target: a metal clang. The partials are not in a simple ratio, which is what makes it sound like metal.
  'attack.ram': (v) => {
    v.thud(0, 140, 60, 0.12, 0.26);
    v.noise({ dur: 0.03, gain: 0.18, filter: bp(2200, 1) });
    for (const [f, dur, gain] of [[415, 0.36, 0.15], [992, 0.28, 0.1], [1466, 0.2, 0.06], [2148, 0.13, 0.035]]) v.tone({ f, dur, gain, a: 0.002, s: 0 });
  },

  // --- Robots ---

  // A falling "bwooo" as the lights fade. Stretches with `duration`.
  'robot.powerdown': (v) => {
    const d = v.span(0.5, 0.25, 1.2);
    v.tone({ type: 'sawtooth', f: [310, 62], dur: d, gain: 0.17, a: 0.01, s: 0.4, r: d * 0.3, filter: lp([1900, 320], 4) });
    v.tone({ f: [620, 124], dur: d, gain: 0.07, a: 0.01, s: 0.4, r: d * 0.3 });
  },

  // A cartoon pop (a very fast rising blip), then a few light plastic clicks as the parts land. Not an explosion.
  'robot.popapart': (v) => {
    v.tone({ f: [300, 1000], dur: 0.07, gain: 0.32, a: 0.002, s: 0 });
    v.noise({ dur: 0.02, gain: 0.14, filter: bp(1400, 1) });
    [[0.1, 980], [0.16, 1320], [0.23, 780], [0.32, 1100]].forEach(([at, f], i) => v.tap(at, f, 0.13 - i * 0.02));
  },

  // A short worried warble that sinks a little.
  'robot.scared': (v) => v.tone({ type: 'triangle', f: [780, 610], dur: 0.34, gain: 0.125, a: 0.02, r: 0.08, vib: { rate: 13, cents: 170 } }),

  // A two-note happy chirp. Each note scoops up into place.
  'robot.happy': (v) => {
    v.tone({ type: 'triangle', f: [[0, N.A5], [0.4, N.C6], [1, N.C6]], dur: 0.09, gain: 0.11, a: 0.005, r: 0.03 });
    v.tone({ type: 'triangle', f: [[0, N.E6], [0.4, N.G6], [1, N.G6]], at: 0.1, dur: 0.13, gain: 0.11, a: 0.005, r: 0.05 });
  },

  // --- Special moments ---

  // A two-tone alert going up a fourth. The square layer makes it stand out; the triangle keeps it friendly.
  check: (v) => {
    for (const [at, f, dur] of [[0, N.E5, 0.12], [0.14, N.A5, 0.2]]) {
      v.beep(at, f, dur, 0.05, 'square');
      v.beep(at, f, dur, 0.09);
    }
  },

  // A teleport shimmer: a sparkle of small bells that rises and falls, over a soft swell of air.
  castle: (v) => {
    [N.C6, N.E6, N.G6, N.C7, N.G6, N.E6, N.C6].forEach((f, i) => v.bell(i * 0.045, f, 0.16, 0.1));
    v.noise({ dur: 0.42, gain: 0.06, a: 0.15, s: 1, r: 0.2, filter: bp([[0, 1500], [0.5, 3600], [1, 1500]], 2) });
    v.tone({ f: [[0, N.G4], [0.5, N.D6], [1, N.G4]], dur: 0.42, gain: 0.06, a: 0.1, r: 0.15 });
  },

  // A power-up riser: pitch and brightness climb while the level swells. Stretches with `duration`.
  'promote.start': (v) => {
    const d = v.span(0.8, 0.4, 2);
    v.tone({ type: 'sawtooth', f: [110, 660], dur: d, gain: 0.155, a: d * 0.7, r: 0.06, filter: lp([500, 3000], 4), trem: { rate: 14, depth: 0.4 } });
    v.tone({ f: [220, 1320], dur: d, gain: 0.095, a: d * 0.7, r: 0.06 });
    v.noise({ dur: d, gain: 0.07, a: d * 0.8, s: 1, r: 0.06, filter: bp([600, 3200], 1.5) });
  },

  // One short mechanical click-clack. It is played many times in a row while parts attach, so it is tiny and follows `pitch` closely.
  'promote.build': (v) => {
    v.tap(0, 640, 0.2);
    v.tap(0.055, 430, 0.24);
  },

  // A bright triumphant C major chord: four bells strummed upward over a warm body.
  'promote.done': (v) => {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => {
      v.bell(i * 0.03, f, 0.9, 0.11);
      v.tone({ type: 'triangle', f, at: i * 0.03, dur: 0.5, gain: 0.05, a: 0.008, d: 0.3, s: 0.4, r: 0.15 });
    });
    v.tone({ type: 'triangle', f: N.C4, dur: 0.6, gain: 0.11, a: 0.01, d: 0.4, s: 0.3, r: 0.15 });
  },

  // A soft magical chime: three bells that ring for a while.
  bestmove: (v) => {
    [[N.A5, 0.1], [N.E6, 0.085], [N.A6, 0.06]].forEach(([f, gain], i) => v.bell(i * 0.075, f, 0.7, gain));
  },

  // --- Game ---

  // A short boot-up jingle: a motor spins up under four rising beeps.
  'game.start': (v) => {
    v.servo(0, [110, 260], 0.34, 0.06, 1200);
    [N.C5, N.E5, N.G5].forEach((f, i) => v.beep(0.04 + i * 0.085, f, 0.07, 0.06, 'square'));
    v.beep(0.3, N.C6, 0.2, 0.055, 'square');
    v.bell(0.3, N.C6, 0.4, 0.08);
  },

  // A happy fanfare: a rising call that lands on a held chord.
  'game.win': (v) => {
    for (const [f, at, dur] of [[N.G4, 0, 0.1], [N.C5, 0.12, 0.1], [N.E5, 0.24, 0.1], [N.G5, 0.36, 0.2], [N.E5, 0.6, 0.1], [N.C6, 0.72, 0.5]]) {
      v.beep(at, f, dur, 0.065, 'square');
      v.beep(at, f, dur, 0.105);
    }
    for (const f of [N.C5, N.E5, N.G5]) v.tone({ type: 'triangle', f, at: 0.72, dur: 0.5, gain: 0.055, a: 0.01, d: 0.3, s: 0.5, r: 0.15 });
    v.bell(0.72, N.C7, 0.45, 0.04);
  },

  // A gentle falling phrase with soft edges. It ends on a calm note, so it says "good try" and not "you failed".
  'game.lose': (v) => {
    for (const [f, at, dur] of [[N.E5, 0, 0.3], [N.D5, 0.24, 0.3], [N.C5, 0.48, 0.3], [N.A4, 0.72, 0.55]]) {
      v.tone({ type: 'triangle', f, at, dur, gain: 0.14, a: 0.02, d: dur * 0.7, s: 0.45, r: dur * 0.3, vib: { rate: 5, cents: 8 } });
      v.tone({ f: f / 2, at, dur, gain: 0.06, a: 0.02, r: dur * 0.3 });
    }
  },

  // A neutral two-note phrase: one note, then an open fifth, which is neither happy nor sad.
  'game.draw': (v) => {
    v.beep(0, N.E5, 0.18, 0.14);
    v.beep(0.2, N.E5, 0.36, 0.11);
    v.beep(0.2, N.A4, 0.36, 0.11);
  },

  // --- Coach: four small cues from bright to concerned. None of them punishes the player. ---

  // Three quick bright bells going up.
  'coach.great': (v) => [N.G5, N.C6, N.E6].forEach((f, i) => v.bell(i * 0.06, f, 0.4, 0.12)),

  // Two soft bells going up a third.
  'coach.good': (v) => {
    v.bell(0, N.C5, 0.22, 0.13);
    v.bell(0.09, N.E5, 0.3, 0.13);
  },

  // One note that bends up at the end, like a quiet "hmm?".
  'coach.warn': (v) => v.tone({ type: 'triangle', f: [[0, N.A4], [0.5, N.A4], [1, N.B4]], dur: 0.24, gain: 0.15, a: 0.012, r: 0.07 }),

  // A soft "uh-oh": two round notes falling a third.
  'coach.bad': (v) => {
    v.beep(0, N.G4, 0.13, 0.15);
    v.beep(0.15, N.E4, 0.2, 0.15);
  },

  // A soft holographic shimmer: two high notes that flutter, with a breath of air.
  'coach.ghost': (v) => {
    v.tone({ f: [N.A5, N.A5 * 1.02], dur: 0.5, gain: 0.05, a: 0.12, r: 0.25, trem: { rate: 11, depth: 0.5 } });
    v.tone({ f: [N.E6, N.E6 * 1.02], dur: 0.5, gain: 0.035, a: 0.15, r: 0.25, trem: { rate: 13, depth: 0.5 } });
    v.noise({ dur: 0.5, gain: 0.03, a: 0.15, s: 1, r: 0.25, filter: bp([2000, 3200], 3) });
  },

  // --- Clock and tutorial ---

  // A tiny tick for low time.
  'clock.tick': (v) => {
    v.tone({ f: [1800, 1350], dur: 0.025, gain: 0.11, a: 0.001, s: 0 });
    v.noise({ dur: 0.01, gain: 0.05, filter: bp(3400, 2) });
  },

  // One short warning beep.
  'clock.low': (v) => {
    v.beep(0, N.G5, 0.11, 0.04, 'square');
    v.beep(0, N.G5, 0.11, 0.075);
  },

  // A cheerful three-note rise. The last note rings.
  'tutorial.success': (v) => {
    [N.C5, N.E5, N.G5].forEach((f, i) => {
      v.beep(i * 0.11, f, i === 2 ? 0.26 : 0.1, 0.13);
      v.bell(i * 0.11, f * 2, 0.3, 0.045);
    });
  },
};

const RECIPE_BY_NAME = new Map(Object.entries(RECIPES));

/**
 * Every valid sound name, in the order of the recipe list.
 * @type {readonly string[]}
 */
export const SOUND_NAMES = Object.freeze([...RECIPE_BY_NAME.keys()]);

/**
 * The sounds that follow the `duration` option. All other sounds are one-shots and ignore it.
 * @type {readonly string[]}
 */
export const STRETCHABLE_SOUNDS = Object.freeze(['move.rook', 'move.bishop', 'move.queen', 'attack.beam', 'robot.powerdown', 'promote.start']);

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Create the AudioContext, or wake it up if the browser paused it. Browsers only allow audio to start from a user gesture, so call this from a click, tap or key handler. It is cheap and safe to call on every gesture. Without Web Audio (old browsers, Node) it does nothing.
 * @returns {void}
 */
function unlock() {
  try {
    if (ctx && ctx.state === 'closed') dropContext();
    if (!ctx) {
      const created = contextFactory();
      if (!created) return;
      ctx = created;
      ({ input, master } = buildOutput(created));
    }
    if (ctx.state !== undefined && ctx.state !== 'running') {
      releaseStaleVoices();
      resumeRequestedAt = nowMs();
      requestResume();
    }
  } catch (error) {
    const broken = ctx;
    dropContext();
    closeQuietly(broken);
    warnOnce('unlock', '[sfx] Could not start audio:', error);
  }
}

/**
 * Set the master volume for all effects.
 * @param {number} value 0 (silent) to 1 (full). Values outside this range are clamped; anything that is not a finite number is ignored.
 * @returns {void}
 */
function setVolume(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  volume = clamp(value, 0, 1);
  if (!ctx || !master) return;
  const gain = volumeToGain(volume);
  try {
    // A very short glide instead of a jump, so dragging the volume slider does not crackle.
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(gain, ctx.currentTime, 0.015);
  } catch {
    master.gain.value = gain;
  }
}

/**
 * The master volume as last set, from 0 to 1.
 * @returns {number}
 */
function getVolume() {
  return volume;
}

/**
 * Play one sound. This never throws. It does nothing before `unlock`, without Web Audio, at volume 0, or while the browser has audio paused. An unknown name logs one warning per name.
 * @param {string} name One of `SOUND_NAMES`.
 * @param {PlayOptions} [opts]
 * @returns {void}
 */
function play(name, opts) {
  let voice = null;
  try {
    const recipe = RECIPE_BY_NAME.get(name);
    if (!recipe) {
      warnOnce(`unknown:${String(name)}`, `[sfx] Unknown sound name "${String(name)}".`);
      return;
    }
    if (!ctx || volume <= 0) return;
    const level = clamp(finiteOr(opts?.gain, 1), 0, 1);
    if (level <= 0) return;
    if (!contextReady()) return;

    const requestedPitch = finiteOr(opts?.pitch, 1);
    const pitch = clamp(requestedPitch > 0 ? requestedPitch : 1, MIN_PITCH, MAX_PITCH) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
    const delay = Math.max(0, finiteOr(opts?.delay, 0));
    const requestedDuration = finiteOr(opts?.duration, undefined);
    const durationHint = requestedDuration !== undefined && requestedDuration > 0 ? requestedDuration : undefined;

    const now = ctx.currentTime;
    sweepFinished(now);
    while (voices.length >= MAX_VOICES) fadeOutVoice(oldestVoice(), now);

    voice = new Voice(now + LOOKAHEAD + delay, pitch, level, durationHint);
    voices.push(voice);
    recipe(voice);
    if (voice.pending === 0) releaseVoice(voice);
  } catch (error) {
    if (voice) releaseVoice(voice);
    warnOnce(`failed:${String(name)}`, `[sfx] Could not play "${String(name)}":`, error);
  }
}

/**
 * Fade out every sound that is playing and cancel every sound that still waits for its `delay`. Use it when the player skips an animation, so the sounds that were lined up for it do not play late.
 * @returns {void}
 */
function stopAll() {
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    while (voices.length) fadeOutVoice(voices[0], now);
  } catch (error) {
    warnOnce('stopAll', '[sfx] Could not stop sounds:', error);
  }
}

/**
 * The sound effects player. One shared instance for the whole page. The object is not frozen, so tests of other modules can spy on its methods (for example `vi.spyOn(sfx, 'play')`).
 *
 * @example
 * sfx.unlock();                                  // from a click or tap
 * sfx.setVolume(0.8);
 * sfx.play('attack.zap');
 * sfx.play('move.rook', { pitch: 1.1, gain: 0.7, delay: 0.15, duration: 0.6 });
 */
export const sfx = { unlock, setVolume, getVolume, play, stopAll };

/**
 * Test hook. Replace the function that creates the AudioContext and reset the module to its starting state (no context, no voices, default volume, no remembered warnings). Pass `null` to go back to the real browser AudioContext.
 * @param {(() => (AudioContext|null)) | null} factory
 * @returns {void}
 */
export function __setAudioContextFactory(factory) {
  const old = ctx;
  dropContext();
  closeQuietly(old);
  contextFactory = factory ?? defaultContextFactory;
  volume = DEFAULT_VOLUME;
  warned.clear();
}
