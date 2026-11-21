// App start-up. Builds the 3D scene, the game, the interface and the input, connects the settings to all of them and runs the frame loop. The board is shown first; the chess engine loads in the background.
import '@fontsource-variable/unbounded';
import '@fontsource-variable/lexend';
import './styles.css';
import { Chess } from 'chess.js';
import { t } from './i18n/index.js';
import { Settings, onboardingDefaults } from './core/settings.js';
import { Game, MODES } from './core/game.js';
import { GameSaver } from './core/saved-game.js';
import { Stage } from './gfx/stage.js';
import { Environment } from './gfx/environment.js';
import { Arena } from './gfx/arena.js';
import { Effects } from './gfx/fx/effects.js';
import { CameraRig } from './gfx/camera-rig.js';
import { BoardView } from './gfx/boardview.js';
import { InputController } from './app/input.js';
import { AppUI } from './ui/ui.js';
import { TutorialRunner } from './tutorial/runner.js';
import { FrameLimiter, slowFrameRate } from './app/frame-limiter.js';
import { guessQuality, measureFrameMs, pickQuality, QualityMemory, KEEP_FRAME_MS } from './app/auto-quality.js';
import { sfx } from './audio/sfx.js';
import { registerServiceWorker } from './pwa/register.js';
import { InstallPrompt } from './app/install.js';

/** Frame-rate watchdog for the "auto" graphics quality: it averages over this window, and below `slowFrameRate` the quality goes down one step. */
const FPS_WINDOW_SECONDS = 4;
/** Two-player games: how long the game waits while the camera turns the board to the other player. The camera slows down as it arrives, so after this time the board is almost at rest. A tap skips the wait. */
const BOARD_TURN_SECONDS = 0.7;
/** How long after the first picture the service worker is started. It then downloads every file of the game once, and that must not slow down the start of the game and of the engine. */
const SERVICE_WORKER_DELAY_MS = 2000;
const START_FEN = new Chess().fen();

// Made before anything else starts: the browser sends its install offer once, soon after the page has loaded, and an offer that nobody listens for is lost.
const install = new InstallPrompt();

const boot = document.getElementById('boot');
const bootText = document.getElementById('boot-text');
bootText.textContent = t('app.loading');

function fail(messageKey, error) {
  console.error('[app] start-up failed', error);
  boot.classList.remove('done');
  boot.classList.add('failed');
  bootText.textContent = t(messageKey);
}

function start() {
  const settings = new Settings();
  const canvas = document.getElementById('stage');

  // The quality level that "auto" found on this device at an earlier visit.
  const qualityMemory = new QualityMemory();
  // "Auto" starts with the remembered level, or with a guess from what the browser tells about the device. The first frame then measures the device when nothing fitting is remembered (see `measureQuality`).
  const startQuality = () => (settings.get('quality') === 'auto' ? (qualityMemory.level ?? guessQuality()) : settings.get('quality'));

  let stage;
  try {
    stage = new Stage(canvas, startQuality());
  } catch (error) {
    fail('errors.webgl', error);
    return;
  }
  const environment = new Environment(stage);
  const arena = new Arena(stage);
  const effects = new Effects(stage);
  const rig = new CameraRig(stage);
  const view = new BoardView({ stage, arena, effects, rig, sfx });
  const limiter = new FrameLimiter(settings.get('frameRate'));

  let ui = null;
  let tutorial = null;
  /** Which color sits at the bottom of the screen right now. */
  let orientation = 'w';
  let lastVolume = settings.get('volume') > 0 ? settings.get('volume') : 0.8;

  const game = new Game({
    view,
    settings,
    sfx,
    t,
    prompts: {
      promotion: (color, square) => ui.askPromotion(color, square),
      confirm: (move) => ui.askConfirm(move),
    },
    turnBoard: (color) => turnBoard(color),
  });

  const setOrientation = (color, animate = true) => {
    orientation = color;
    rig.setOrientation(color, animate);
    arena.setOrientation(color);
    ui?.setOrientation(color);
  };

  // Two-player games: after each move the board is shown from the side that moves next, while that setting is on. The game waits for the promise before the next move and the next clock, so the turn costs no clock time. The camera flies around the board only with the presets that have effects; with Minimal and Instant the board turns at once.
  const turnBoard = (color) => {
    if (!settings.get('twoPlayerFlip') || color === orientation) return Promise.resolve();
    const fly = view.preset.effects;
    setOrientation(color, fly);
    return fly ? view.pause(BOARD_TURN_SECONDS) : Promise.resolve();
  };

  // The side the board is shown from when a game starts: the player's own side against the bot. A two-player game starts on the side that moves first when the board flips after each move, and on White's side when it does not.
  const startSide = () => (game.mode.bot ? game.playerColor : settings.get('twoPlayerFlip') ? game.turn : 'w');

  // Timed and Ranked games always use a fast preset; Cinematic is kept for games without a clock.
  const applyPreset = () => {
    const chosen = settings.get('animation');
    const timed = game.status === 'playing' && Boolean(game.clock);
    view.setPreset(timed && chosen === 'cinematic' ? 'standard' : chosen);
  };

  // The game in progress is kept in the browser's storage, so a reload or a dropped page does not lose it. The home menu offers to go on with it.
  const saver = new GameSaver();

  /** True while a game is opened from the menu. The board is then shown from its side at once; inside a game ("Play again") the camera flies there. */
  let openingGame = false;
  // Leave the menu and put a game on the board: `begin` starts a new one or goes on with a saved one. The game's "start" event (below) sets the animation preset and the side of the board.
  const openGame = (begin) => {
    tutorial?.stop();
    rig.attract = false;
    ui.showGame(game);
    openingGame = true;
    try {
      begin();
    } finally {
      openingGame = false;
    }
    updateViewport();
  };

  const actions = {
    startGame(config) {
      // A new game takes the place of a saved one.
      saver.clear();
      openGame(() => game.newGame(config));
    },
    /** The game of an earlier visit that can go on, or null. */
    savedGame() {
      return saver.saved;
    },
    continueGame() {
      const saved = saver.saved;
      if (!saved) return;
      openGame(() => game.resume(saved));
    },
    startTutorial() {
      game.stop();
      rig.attract = false;
      setOrientation('w', false);
      ui.showTutorial();
      updateViewport();
      view.setPreset(settings.get('animation') === 'instant' ? 'minimal' : settings.get('animation'));
      tutorial.start();
    },
    quitToMenu() {
      // Leaving a running game gives it up: the player was asked first and told that it is lost.
      if (game.status === 'playing') saver.clear();
      game.stop();
      tutorial?.stop();
      input.clearSelection();
      view.sync(START_FEN);
      view.setLastMove(null, null);
      view.setCheck(null);
      view.clearCoachMarks();
      view.clearLegalTargets();
      setOrientation('w', true);
      rig.resetView();
      rig.attract = true;
      ui.showMenu();
      updateViewport();
    },
    flipBoard() {
      setOrientation(orientation === 'w' ? 'b' : 'w');
    },
    toggleCamera() {
      settings.set('camera', settings.get('camera') === 'top' ? 'angled' : 'top');
    },
    resetView() {
      rig.resetView();
    },
    toggleSound() {
      if (settings.get('volume') > 0) {
        lastVolume = settings.get('volume');
        settings.set('volume', 0);
      } else {
        settings.set('volume', lastVolume);
      }
    },
    /** The quality level that is drawn now: the picked one, or the one that "auto" uses. */
    qualityInUse() {
      return stage.qualityName;
    },
    resetData() {
      saver.clear();
      qualityMemory.clear();
      settings.reset();
      location.reload();
    },
  };

  ui = new AppUI({ root: document.getElementById('ui'), settings, t, sfx, actions, install });
  tutorial = new TutorialRunner({
    view,
    ui,
    sfx,
    t,
    onExit: (finished) => {
      if (finished) settings.set('tutorialDone', true);
      actions.quitToMenu();
    },
  });
  const input = new InputController({
    canvas,
    stage,
    rig,
    view,
    settings,
    sfx,
    getTarget: () => (ui.screen === 'game' ? game : ui.screen === 'tutorial' ? tutorial : null),
  });

  // --- Settings to systems ---------------------------------------------------------------------------------
  const applySetting = (key) => {
    const all = key === '*';
    if (all || key === 'boardTheme') {
      environment.setTheme(settings.get('boardTheme'));
      arena.setTheme(settings.get('boardTheme'));
    }
    if (all || key === 'boardColors') arena.setBoardColors(settings.get('boardColors'));
    if (all || key === 'coordinates') arena.setCoordinates(settings.get('coordinates'));
    if (all || key === 'camera') {
      rig.setTopDown(settings.get('camera') === 'top');
    }
    if (all || key === 'animation') applyPreset();
    if (all || key === 'shake') {
      rig.shakeEnabled = settings.get('shake');
      view.flashesEnabled = settings.get('shake');
    }
    // A player who picks "Auto" has the device measured again, from the level that is drawn now. This is also the way back to a higher level after the watchdog lowered it.
    if (key === 'quality' && settings.get('quality') === 'auto') measureQuality();
    else if (all || key === 'quality') stage.setQuality(startQuality());
    if (all || key === 'frameRate') limiter.setLimit(settings.get('frameRate'));
    if (all || key === 'volume') sfx.setVolume(settings.get('volume'));
    if (key === 'twoPlayerCoach') game.applyCoachSetting();
    // Switched on in the middle of a two-player game: show the board from the side that moves now. While a move is on its way, or the coach asks the player who just moved, the board stays where it is and turns with the next move.
    if (key === 'twoPlayerFlip' && settings.get('twoPlayerFlip') && !game.mode.bot && game.status === 'playing' && !game.busy && !game.coachHold && !game.coachPending) setOrientation(game.turn);
    if (ui.screen === 'game') ui.renderGame();
  };
  settings.subscribe(applySetting);
  applySetting('*');

  // --- Game events to interface ----------------------------------------------------------------------------
  // Every game that is set up comes through here: a new one, "Play again" and a saved one that goes on. So the board is always shown from the right side, also when "Play again" draws a new random color.
  game.on('start', () => {
    applyPreset();
    setOrientation(startSide(), !openingGame);
  });
  game.on('change', () => {
    ui.renderGame();
    input.validate();
    saver.sync(game);
  });
  // Save once more when the page goes to the background or closes, so a timed game comes back with the clocks of that moment, not of the last move.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saver.sync(game);
  });
  window.addEventListener('pagehide', () => saver.sync(game));
  game.on('gameover', (result) => ui.showGameOver(result));
  game.on('toast', ({ text, tone, sticky }) => ui.toast(text, tone, sticky));

  // Browsers only allow sound after a user action; unlock on every gesture (needed on iPhone).
  for (const type of ['pointerdown', 'pointerup', 'keydown', 'click']) window.addEventListener(type, () => sfx.unlock(), { passive: true });

  // --- Layout ----------------------------------------------------------------------------------------------
  function updateViewport() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    rig.setViewport(width, height, ui.boardRect());
  }
  function resize() {
    stage.resize(window.innerWidth, window.innerHeight);
    updateViewport();
  }
  // Development only: a check of the rule that the board area keeps its place while a game runs. The area may change with the window, with the screen (menu, game, tutorial) and when the coach is switched on or off, but never because a panel shows another text: on upright phones that made the camera zoom out and back after every move. A change with none of these reasons is reported in the console.
  let lastBoardArea = null;
  function checkBoardArea() {
    const rect = ui.boardArea.getBoundingClientRect();
    const reason = [window.innerWidth, window.innerHeight, ui.screen, ui.hudEl.classList.contains('has-coach'), ui.hudEl.classList.contains('is-tutorial'), document.fonts?.status].join('|');
    const box = [rect.left, rect.top, rect.width, rect.height].map((value) => value.toFixed(1)).join(' ');
    if (lastBoardArea && lastBoardArea.reason === reason && lastBoardArea.box !== box) console.warn(`[layout] The board area changed (${lastBoardArea.box} -> ${box}) without a change of the window or the screen. A panel must not push the board: see "An upright screen" in styles.css.`);
    lastBoardArea = { reason, box };
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (import.meta.env.DEV) checkBoardArea();
      updateViewport();
    }).observe(ui.boardArea);
  }

  // --- First screen ----------------------------------------------------------------------------------------
  view.sync(START_FEN);
  rig.attract = true;
  ui.showMenu();
  resize();
  if (!settings.get('onboarded')) {
    // The answer is used here once, to set the starting values. It is not kept: the player changes those values in the menu and the settings.
    ui.askOnboarding().then(({ experience, tutorial: wantsTutorial }) => {
      for (const [key, value] of Object.entries(onboardingDefaults(experience))) settings.set(key, value);
      settings.set('onboarded', true);
      if (wantsTutorial) actions.startTutorial();
      else ui.showMenu();
    });
  }

  // --- Frame loop ------------------------------------------------------------------------------------------
  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;
  let warmup = 3;
  let firstFrame = true;

  /** The number of screen pixels of the picture at its full sharpness. The time of a frame follows this number, so a measured level is remembered together with it. */
  const picturePixels = () => stage.cssWidth * stage.cssHeight * (window.devicePixelRatio || 1) ** 2;
  // One frame as the frame loop draws it, for the measuring.
  const drawMeasuredFrame = () => {
    const dt = 1 / 60;
    view.update(dt);
    environment.update(dt, stage.time);
    arena.update(dt, stage.time);
    stage.render(dt);
  };
  /** Find the quality level for "auto" by measuring real frames, starting at the level that is drawn now, and remember it. The page stands still while it measures (about a third of a second for each level it tries), so it runs under the loading screen, and when the player picks "Auto" in the settings. */
  function measureQuality() {
    const hooks = { drawFrame: drawMeasuredFrame, waitForGpu: () => stage.waitForGpu(), now: () => performance.now() };
    try {
      const result = pickQuality({
        start: stage.qualityName,
        measure: (level) => {
          stage.setQuality(level);
          return measureFrameMs(hooks);
        },
      });
      stage.setQuality(result.level);
      const times = Object.entries(result.times).map(([level, ms]) => `${level} ${ms.toFixed(1)} ms`).join(', ');
      if (result.measured) {
        qualityMemory.save(result.level, picturePixels());
        console.info(`[quality] auto measured this device (${times} per frame, a level is kept up to ${KEEP_FRAME_MS.toFixed(1)} ms) and uses ${result.level}`);
      } else {
        // Nothing is remembered, so the next start tries again.
        console.warn(`[quality] the clock of this browser does not move, so the device can not be measured${times ? ` (${times} per frame so far)` : ''}; auto uses ${result.level}`);
      }
    } catch (error) {
      // The game goes on with the level that is set now. The watchdog below still lowers it when the game runs slowly.
      console.error(`[quality] measuring the device failed, auto stays on ${stage.qualityName}`, error);
    }
    // The time spent here says nothing about the speed of the game.
    warmup = 3;
    fpsFrames = 0;
    fpsTime = 0;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    // The player's frame-rate limit: on a fast screen some refreshes are skipped. The next frame's time step then covers the skipped time, so motion keeps its speed.
    if (!limiter.shouldDraw(now)) return;
    const real = (now - last) / 1000;
    last = now;
    // After a pause (hidden tab, slow frame) do not let the world jump.
    const dt = Math.min(0.05, Math.max(0, real));

    game.tick();
    ui.tickClocks();
    rig.update(dt);
    ui.setViewChanged(!rig.isDefaultView);
    effects.pixelScale = (rig.viewport.h * stage.renderer.getPixelRatio()) / (2 * Math.tan((rig.fov * Math.PI) / 360));
    view.update(dt);
    environment.update(dt, stage.time);
    arena.update(dt, stage.time);
    stage.render(dt);

    if (firstFrame) {
      firstFrame = false;
      // Still under the loading screen: measure the device when "auto" has no level for a picture of this size yet.
      if (settings.get('quality') === 'auto' && !qualityMemory.fits(picturePixels())) measureQuality();
      boot.classList.add('done');
      // Load the engine only after the board is on screen.
      setTimeout(() => game.preloadEngine(), 300);
      // Then keep the game's files on the device, for play with no internet. Only the built site has the worker: the dev server must always serve fresh files.
      if (import.meta.env.PROD) setTimeout(() => registerServiceWorker(), SERVICE_WORKER_DELAY_MS);
    }

    // Lower the graphics quality by itself when the device cannot keep up (only in "auto").
    if (warmup > 0) {
      warmup -= real;
    } else if (settings.get('quality') === 'auto' && !document.hidden && real < 0.5) {
      fpsFrames += 1;
      fpsTime += real;
      if (fpsTime >= FPS_WINDOW_SECONDS) {
        const fps = fpsFrames / fpsTime;
        fpsFrames = 0;
        fpsTime = 0;
        if (fps < slowFrameRate(limiter.limit) && stage.qualityName !== 'low') {
          stage.setQuality(stage.qualityName === 'high' ? 'medium' : 'low');
          // Remembered, so the next start does not begin with the slow level again. Picking "Auto" in the settings measures the device anew.
          qualityMemory.save(stage.qualityName, picturePixels());
          warmup = 3;
          ui.toast(t('errors.lowQuality'), 'ok');
        }
      }
    }
  }
  requestAnimationFrame(frame);

  // Handy for debugging in the browser console; not used by the game itself.
  if (import.meta.env.DEV) window.__app = { game, view, rig, stage, settings, ui, tutorial, environment, arena, effects, input, install, qualityMemory, measureQuality, MODES };
}

try {
  start();
} catch (error) {
  fail('errors.start', error);
}
