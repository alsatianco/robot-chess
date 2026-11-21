// Stockfish in a Web Worker, wrapped in a small promise API. The single-threaded WebAssembly build is used so the game runs on any static host without special headers. One Engine runs one search at a time; extra requests wait in a queue.
import engineFiles from '../../public/engine/engine.json';

const READY_TIMEOUT_MS = 30000;

/**
 * Parse one UCI "info" line into an engine line, or null when the line carries no principal variation.
 * @param {string} text
 * @returns {import('./types.js').EngineLine|null}
 */
export function parseInfoLine(text) {
  if (!text.startsWith('info ') || !text.includes(' pv ')) return null;
  const tokens = text.split(/\s+/);
  const line = { multipv: 1, depth: 0, move: '', pv: [], cp: null, mate: null };
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'depth') line.depth = Number(tokens[++i]);
    else if (token === 'multipv') line.multipv = Number(tokens[++i]);
    else if (token === 'score') {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      if (kind === 'cp') line.cp = value;
      else if (kind === 'mate') line.mate = value;
    } else if (token === 'pv') {
      line.pv = tokens.slice(i + 1);
      break;
    }
  }
  if (line.pv.length === 0 || (line.cp === null && line.mate === null) || !Number.isFinite(line.depth)) return null;
  line.move = line.pv[0];
  return line;
}

export class Engine {
  /**
   * @param {{createWorker?: () => Worker}} [options] `createWorker` lets tests supply a fake worker.
   */
  constructor(options = {}) {
    this.createWorker = options.createWorker ?? (() => new Worker(new URL(`./engine/${engineFiles.js}`, document.baseURI)));
    this.worker = null;
    this.ready = null;
    /** @type {Array<object>} */
    this.queue = [];
    this.current = null;
    this.options = new Map();
    this.failed = null;
  }

  /** Start the worker and wait until the engine answers. Safe to call many times. */
  init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        this.failed = error;
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('The chess engine did not start in time.')), READY_TIMEOUT_MS);
      try {
        this.worker = this.createWorker();
      } catch (error) {
        clearTimeout(timer);
        fail(error);
        return;
      }
      this.worker.onerror = (event) => {
        clearTimeout(timer);
        const error = new Error(`Chess engine error: ${event.message ?? 'worker failed'}`);
        fail(error);
        this.#abortAll(error);
      };
      this.worker.onmessage = (event) => {
        const text = typeof event.data === 'string' ? event.data : '';
        if (!settled && text === 'readyok') {
          settled = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        this.#onLine(text);
      };
      this.worker.postMessage('uci');
      this.worker.postMessage('setoption name Hash value 16');
      this.worker.postMessage('isready');
    });
    return this.ready;
  }

  #send(command) {
    this.worker.postMessage(command);
  }

  #setOption(name, value) {
    if (this.options.get(name) === value) return;
    this.options.set(name, value);
    this.#send(`setoption name ${name} value ${value}`);
  }

  #abortAll(error) {
    const jobs = [...this.queue];
    if (this.current) jobs.unshift(this.current);
    this.queue = [];
    this.current = null;
    for (const job of jobs) job.reject(error);
  }

  #onLine(text) {
    const job = this.current;
    if (!job) return;
    if (text.startsWith('info ')) {
      const line = parseInfoLine(text);
      // Lines marked as bounds are partial results; keep the last exact line per rank.
      if (line && !text.includes(' upperbound') && !text.includes(' lowerbound')) job.lines.set(line.multipv, line);
      return;
    }
    if (text.startsWith('bestmove')) {
      const best = text.split(/\s+/)[1];
      this.current = null;
      const lines = [...job.lines.values()].sort((a, b) => a.multipv - b.multipv);
      job.resolve({ lines, bestmove: best && best !== '(none)' ? best : null, cancelled: job.cancelled });
      this.#next();
    }
  }

  #next() {
    if (this.current || this.queue.length === 0) return;
    const job = this.queue.shift();
    if (job.cancelled) {
      job.resolve({ lines: [], bestmove: null, cancelled: true });
      this.#next();
      return;
    }
    this.current = job;
    const p = job.params;
    this.#setOption('MultiPV', p.multipv ?? 1);
    this.#setOption('Skill Level', p.skill ?? 20);
    this.#send(`position fen ${p.fen}`);
    let go = 'go';
    if (p.depth) go += ` depth ${p.depth}`;
    if (p.movetime) go += ` movetime ${p.movetime}`;
    if (!p.depth && !p.movetime) go += ' depth 10';
    if (p.searchMoves?.length) go += ` searchmoves ${p.searchMoves.join(' ')}`;
    this.#send(go);
  }

  /**
   * Analyze a position.
   * @param {{fen:string, multipv?:number, depth?:number, movetime?:number, searchMoves?:string[], skill?:number}} params
   * @returns {Promise<{lines: import('./types.js').EngineLine[], bestmove: string|null, cancelled: boolean}> & {cancel: () => void}} The promise has a `cancel()` method: a waiting search is dropped, a running search is stopped and returns what it has so far.
   */
  analyze(params) {
    const job = { params, lines: new Map(), cancelled: false, resolve: null, reject: null };
    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    promise.cancel = () => {
      if (job.cancelled) return;
      job.cancelled = true;
      if (this.current === job) this.#send('stop');
    };
    this.init().then(
      () => {
        this.queue.push(job);
        this.#next();
      },
      (error) => job.reject(error),
    );
    return promise;
  }

  /** Tell the engine a new game starts, so it forgets what it learned about the last one. */
  newGame() {
    this.init().then(
      () => this.#send('ucinewgame'),
      () => {},
    );
  }

  terminate() {
    this.#abortAll(new Error('The chess engine was shut down.'));
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
