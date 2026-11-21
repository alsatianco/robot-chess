// The interface drawn over the 3D scene: home menu, in-game panels (player bars, clocks, coach card, move list, actions), dialogs (settings, about, install steps, promotion, game end, export, onboarding) and the tutorial card. It follows the conventions players know from Lichess and Chess.com. All text comes from the translation file.
import { h, replace, icon, coachFace } from './dom.js';
import { pieceIcon } from './piece-icons.js';
import { ABOUT_LINKS, ABOUT_PROFILES, ABOUT_CREDITS, LICENCES_FILE, shortAddress, splitAtMarks } from './about.js';
import { formatClock, LOW_TIME_MS, TIME_CONTROLS } from '../core/clock.js';
import { MODES } from '../core/game.js';
import { BOARD_THEMES, BOARD_COLORS, tileColors } from '../gfx/palette.js';
import { BOT_LEVEL_MAX, BOT_LEVEL_MIN } from '../engine/bot.js';
import { FRAME_RATES } from '../app/frame-limiter.js';

const PIECE_ORDER = ['q', 'r', 'b', 'n', 'p'];
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const TOAST_MS = 3600;

/** Pieces each side has lost and the material balance, read from a FEN. */
function materialFromFen(fen) {
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const ch of fen.split(' ')[0]) {
    const lower = ch.toLowerCase();
    if (lower in PIECE_VALUE) counts[ch === lower ? 'b' : 'w'][lower] += 1;
  }
  const lost = { w: [], b: [] };
  const total = { w: 0, b: 0 };
  for (const color of ['w', 'b']) {
    for (const type of PIECE_ORDER) {
      total[color] += counts[color][type] * PIECE_VALUE[type];
      for (let i = counts[color][type]; i < START_COUNT[type]; i++) lost[color].push(type);
    }
  }
  return { lost, balance: total.w - total.b };
}

/** White's share of the evaluation bar, 0..100. */
function whiteShare(evaluation) {
  if (!evaluation) return 50;
  if (evaluation.mate !== null && evaluation.mate !== undefined) return evaluation.mate > 0 ? 100 : 0;
  const cp = evaluation.cp ?? 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function evalText(evaluation) {
  if (!evaluation) return '';
  if (evaluation.mate !== null && evaluation.mate !== undefined) return `M${Math.abs(evaluation.mate)}`;
  const pawns = (evaluation.cp ?? 0) / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

export class AppUI {
  /**
   * @param {object} deps
   * @param {HTMLElement} deps.root
   * @param {import('../core/settings.js').Settings} deps.settings
   * @param {(key:string, params?:object)=>string} deps.t
   * @param {{play:(name:string, opts?:object)=>void}} deps.sfx
   * @param {object} deps.actions Callbacks into the app: startGame, savedGame, continueGame, startTutorial, quitToMenu, flipBoard, toggleCamera, resetView, toggleSound, qualityInUse, resetData.
   * @param {import('../app/install.js').InstallPrompt} [deps.install] Says when the game can be installed as an app. Without it the menu shows no install offer.
   */
  constructor({ root, settings, t, sfx, actions, install = null }) {
    this.root = root;
    this.settings = settings;
    this.t = t;
    this.sfx = sfx;
    this.actions = actions;
    this.install = install;
    /** @type {import('../core/game.js').Game|null} */
    this.game = null;
    this.screen = 'none';
    this.clockNodes = { w: null, b: null };
    this.dialogStack = [];
    /** True while the player's zoom, turn or tilt differs from the default view. */
    this.viewChanged = false;
    /** The color at the bottom of the board right now. A two-player game puts that side's bar at the bottom. */
    this.bottomColor = 'w';

    this.menuEl = h('section.menu', { hidden: true });
    /** The corner of the home menu that holds the install offer. It stays one element, so the offer can come and go without the menu being drawn again. */
    this.installSlot = h('div.install-slot');
    this.hudEl = h('div.hud', { hidden: true });
    this.boardArea = h('div.board-area', { id: 'board-area' });
    this.topbar = h('header.topbar');
    this.botBar = h('div.playerbar.bar-top');
    this.youBar = h('div.playerbar.bar-bottom');
    this.coachEl = h('section.coach', { 'aria-live': 'polite' });
    this.movesEl = h('section.moves');
    this.actionsEl = h('div.actions');
    this.tutorialEl = h('section.tutorial-card', { hidden: true, 'aria-live': 'polite' });
    this.confirmEl = h('div.confirm-bar', { hidden: true });
    /** The panels whose size changes while a game runs: the coach card or the lesson card, the move list and the action buttons. On an upright screen the dock is a box with a height of its own, so a card that grows can never push the board. In the wide layouts it has no box and the grid of the screen places its panels one by one (see `.dock` and "An upright screen" in styles.css). */
    this.dockEl = h('div.dock', null, this.coachEl, this.tutorialEl, this.movesEl, this.actionsEl);
    this.hudEl.append(this.topbar, this.boardArea, this.botBar, this.dockEl, this.youBar, this.confirmEl);
    this.modalRoot = h('div.modal-root');
    this.toastRoot = h('div.toasts', { 'aria-live': 'polite' });
    root.append(this.menuEl, this.hudEl, this.modalRoot, this.toastRoot);

    // Keep the "more text below" mark of the two cards right (see #markOverflow) while the player scrolls the text, and when a card gets another size without a new text: the window changed, or the action buttons made room. A scroll event does not bubble, so the card listens for it in the capture phase.
    const cardSizes = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => entries.forEach((entry) => this.#markOverflow(entry.target))) : null;
    for (const card of [this.coachEl, this.tutorialEl]) {
      card.addEventListener('scroll', () => this.#markOverflow(card), { capture: true, passive: true });
      cardSizes?.observe(card);
    }

    install?.onChange(() => this.#renderInstall());
    install?.onInstalled(() => this.toast(this.t('install.done'), 'good'));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.dialogStack.length > 0) this.dialogStack[this.dialogStack.length - 1].dismiss?.();
      else if (this.screen === 'game' && this.game && this.dialogStack.length === 0) {
        if (event.key === 'ArrowLeft') this.game.stepView(-1);
        if (event.key === 'ArrowRight') this.game.stepView(1);
      }
    });
  }

  #button(label, onClick, { variant = 'ghost', iconName = null, disabled = false, title = null, small = false, hideLabel = false } = {}) {
    return h(
      `button.btn.${variant}${small ? '.small' : ''}${hideLabel ? '.icon-only' : ''}`,
      {
        type: 'button',
        disabled,
        title: title ?? (hideLabel ? label : null),
        'aria-label': hideLabel ? label : null,
        onClick: () => {
          this.sfx.play('ui.click');
          onClick();
        },
      },
      iconName ? icon(iconName) : null,
      hideLabel ? null : h('span', { text: label }),
    );
  }

  // The button that puts the camera back to the default zoom, turn and tilt. It is only active while the view differs from the default (see setViewChanged).
  #resetViewButton(options = {}) {
    const button = this.#button(this.t('hud.resetView'), () => this.actions.resetView(), { iconName: 'recenter', disabled: !this.viewChanged, ...options });
    button.classList.add('reset-view');
    return button;
  }

  /** Tell the interface which color is at the bottom of the board. In a two-player game the bar of that side sits at the bottom, so the bars follow the board when it flips. */
  setOrientation(color) {
    if (color === this.bottomColor) return;
    this.bottomColor = color;
    if (this.screen === 'game' && this.game && !this.game.mode.bot) this.renderGame();
  }

  /** Tell the interface whether the player changed the camera (zoom, turn or tilt). Called every frame, so it only touches the page when the answer changes. */
  setViewChanged(changed) {
    if (changed === this.viewChanged) return;
    this.viewChanged = changed;
    for (const button of this.hudEl.querySelectorAll('.reset-view')) button.disabled = !changed;
  }

  // Row of choices where exactly one is active (used instead of drop-downs: easier for kids and for touch).
  #choices(options, current, onPick, { className = '' } = {}) {
    return h(
      `div.choices${className ? '.' + className : ''}`,
      { role: 'radiogroup' },
      options.map((option) =>
        h(
          'button.choice',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(option.value === current),
            class: option.value === current ? 'active' : '',
            onClick: () => {
              this.sfx.play('ui.toggle');
              onPick(option.value);
            },
          },
          option.icon ?? null,
          h('span', { text: option.label }),
        ),
      ),
    );
  }

  #toggle(on, onChange, label) {
    return h(
      'button.switch',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': String(on),
        'aria-label': label,
        class: on ? 'on' : '',
        onClick: () => {
          this.sfx.play('ui.toggle');
          onChange(!on);
        },
      },
      h('span.knob'),
    );
  }

  // --- Screens ----------------------------------------------------------------------------------------------

  /** The rectangle of the screen that is free for the board, in CSS pixels. */
  boardRect() {
    const source = this.screen === 'menu' ? this.menuStage : this.boardArea;
    const rect = source?.getBoundingClientRect();
    if (!rect || rect.width < 40 || rect.height < 40) return null;
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }

  showMenu() {
    this.screen = 'menu';
    this.game = null;
    this.hudEl.hidden = true;
    this.menuEl.hidden = false;
    this.#renderMenu();
  }

  #renderMenu() {
    const s = this.settings;
    const t = this.t;
    const mode = s.get('mode');
    const level = s.get('botLevel');
    const modeCards = Object.keys(MODES).map((key) =>
      h(
        'button.mode-card',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(key === mode),
          class: key === mode ? 'active' : '',
          onClick: () => {
            this.sfx.play('ui.toggle');
            s.set('mode', key);
            this.#renderMenu();
          },
        },
        h('strong', { text: t(`modes.${key}.name`) }),
        h('span', { text: t(`modes.${key}.about`) }),
      ),
    );
    const levelRow = h(
      'div.level-row',
      null,
      this.#button(t('menu.easier'), () => { s.set('botLevel', Math.max(BOT_LEVEL_MIN, level - 1)); this.#renderMenu(); }, { iconName: 'back', hideLabel: true, disabled: level <= BOT_LEVEL_MIN }),
      h('div.level-value', null, h('strong', { text: t('menu.level', { level }) }), h('span', { text: t(`levels.${level}`) })),
      this.#button(t('menu.harder'), () => { s.set('botLevel', Math.min(BOT_LEVEL_MAX, level + 1)); this.#renderMenu(); }, { iconName: 'forward', hideLabel: true, disabled: level >= BOT_LEVEL_MAX }),
    );
    const colorRow = this.#choices(
      [
        { value: 'w', label: t('menu.colorWhite'), icon: h('span.team-dot.team-w') },
        { value: 'b', label: t('menu.colorBlack'), icon: h('span.team-dot.team-b') },
        { value: 'random', label: t('menu.colorRandom') },
      ],
      s.get('playerColor'),
      (value) => { s.set('playerColor', value); this.#renderMenu(); },
    );
    // A two-player game has no bot to set up. Its clock is a choice of its own, and "No clock" comes first.
    const bot = MODES[mode].bot;
    const clockChoices = Object.keys(TIME_CONTROLS).map((key) => ({ value: key, label: key }));
    const clockRow = (choices, key) => h('div.field', null, h('label', { text: t('menu.time') }), this.#choices(choices, s.get(key), (value) => { s.set(key, value); this.#renderMenu(); }));
    const timeRow = !bot ? clockRow([{ value: 'none', label: t('menu.noClock') }, ...clockChoices], 'twoPlayerClock') : MODES[mode].clock ? clockRow(clockChoices, 'timeControl') : null;
    const config = bot
      ? { mode, level, color: s.get('playerColor'), timeControl: s.get('timeControl') }
      : { mode, timeControl: s.get('twoPlayerClock') === 'none' ? null : s.get('twoPlayerClock') };

    // A game that was left unfinished (the page was reloaded or closed) can go on. The button says which game it is.
    const saved = this.actions.savedGame();
    const continueButton = saved
      ? h(
          'button.btn.continue-game',
          {
            type: 'button',
            onClick: () => {
              this.sfx.play('ui.click');
              this.actions.continueGame();
            },
          },
          icon('forward'),
          h('span.continue-text', null, h('strong', { text: t('menu.continue') }), h('span', { text: MODES[saved.mode].bot ? t('menu.continueDetail', { mode: t(`modes.${saved.mode}.name`), level: saved.level }) : t(`modes.${saved.mode}.name`) })),
        )
      : null;

    this.menuStage = h('div.menu-stage');
    replace(
      this.menuEl,
      h(
        'div.menu-panel',
        null,
        h('h1.logo', null, h('span.logo-a', { text: t('app.logoA') }), h('span.logo-b', { text: t('app.logoB') })),
        h('p.tagline', { text: t('app.tagline') }),
        continueButton,
        h('div.mode-grid', { role: 'radiogroup', 'aria-label': t('menu.mode') }, modeCards),
        bot ? h('div.field', null, h('label', { text: t('menu.opponent') }), levelRow) : null,
        bot ? h('div.field', null, h('label', { text: t('menu.color') }), colorRow) : null,
        timeRow,
        this.#button(t('menu.play'), () => this.actions.startGame(config), { variant: 'primary', iconName: 'play' }),
        h('div.menu-links', null, this.#button(t('menu.tutorial'), () => this.actions.startTutorial(), { iconName: 'school' }), this.#button(t('menu.settings'), () => this.openSettings(), { iconName: 'settings' }), this.#button(t('menu.about'), () => this.openAbout(), { iconName: 'info' })),
        // Last in the panel, so the keyboard reaches it after the menu itself. On the screen it sits in the top corner (see the styles).
        this.installSlot,
      ),
      this.menuStage,
    );
    this.#renderInstall();
  }

  // The quiet offer to install the game as an app. It shows only when an install is possible right now: the browser has made its offer (Chrome and Edge), or the device is an iPhone or iPad, where the player adds the game by hand. It never opens by itself, and it is gone once the game is installed.
  #renderInstall() {
    const state = this.install?.state ?? 'none';
    if (state === 'none') {
      replace(this.installSlot);
      return;
    }
    const onTap =
      state === 'ios'
        ? () => this.openInstallHelp()
        : async () => {
            if ((await this.install.install()) === 'failed') this.toast(this.t('install.failed'), 'bad');
          };
    replace(this.installSlot, this.#button(this.t('install.button'), onTap, { iconName: 'install', small: true, title: this.t('install.buttonTitle') }));
  }

  /** Show the in-game interface for a game. */
  showGame(game) {
    this.screen = 'game';
    this.game = game;
    this.menuEl.hidden = true;
    this.hudEl.hidden = false;
    this.hudEl.classList.remove('is-tutorial');
    this.tutorialEl.hidden = true;
    this.renderGame();
  }

  /** Re-draw everything that depends on the game state. Cheap enough to call on every change. */
  renderGame() {
    const game = this.game;
    if (!game || this.screen !== 'game') return;
    const t = this.t;
    const level1 = this.settings.get('coachLevel') === 1;
    this.hudEl.classList.toggle('no-moves', level1 && game.status !== 'over');
    this.hudEl.classList.toggle('has-coach', game.coachOn);
    // On a short screen the move list makes room for the coach card while a game runs, and comes back when the game is over. On a phone on its side the action buttons make room too while the coach waits for an answer (see "Short screens" in styles.css).
    this.hudEl.classList.toggle('is-over', game.status === 'over');
    this.hudEl.classList.toggle('is-hold', game.coachHold);

    // Top bar.
    const muted = this.settings.get('volume') === 0;
    replace(
      this.topbar,
      this.#button(t('hud.menu'), () => this.#leaveGame(), { iconName: 'home', hideLabel: true }),
      h('div.chip', null, h('strong', { text: t(`modes.${game.modeName}.name`) }), game.mode.bot ? h('span', { text: t('menu.level', { level: game.botLevel }) }) : null),
      game.opening && !level1 ? h('div.opening', { text: game.opening.name, title: game.opening.name }) : h('div.opening'),
      this.#button(muted ? t('hud.soundOn') : t('hud.soundOff'), () => this.actions.toggleSound(), { iconName: muted ? 'soundOff' : 'soundOn', hideLabel: true }),
      this.#button(t('menu.settings'), () => this.openSettings(), { iconName: 'settings', hideLabel: true }),
    );

    // Player bars: against the bot, the player's bar is always the bottom one. In a two-player game the bottom bar belongs to the side at the bottom of the board, so the bars follow the board when it flips.
    const material = materialFromFen(game.shownFen);
    if (game.mode.bot) {
      const botColor = game.playerColor === 'w' ? 'b' : 'w';
      this.#renderBar(this.botBar, botColor, t('hud.bot', { level: game.botLevel }), material, game);
      this.#renderBar(this.youBar, game.playerColor, t('hud.you'), material, game);
    } else {
      const top = this.bottomColor === 'w' ? 'b' : 'w';
      this.#renderBar(this.botBar, top, t(`teams.${top}`), material, game);
      this.#renderBar(this.youBar, this.bottomColor, t(`teams.${this.bottomColor}`), material, game);
    }

    this.#renderCoach(game);
    this.#renderMoves(game);

    // Actions.
    const live = game.status === 'playing';
    replace(
      this.actionsEl,
      game.mode.undo ? this.#button(t('hud.undo'), () => game.undo(), { iconName: 'undo', disabled: !game.canUndo }) : null,
      this.#button(t('hud.flip'), () => this.actions.flipBoard(), { iconName: 'flip' }),
      this.#button(this.settings.get('camera') === 'top' ? t('hud.viewAngled') : t('hud.viewTop'), () => this.actions.toggleCamera(), { iconName: 'camera' }),
      this.#resetViewButton(),
      this.#button(t('hud.export'), () => this.openExport(), { iconName: 'export' }),
      live ? this.#button(t('hud.resign'), () => this.#confirmResign(), { iconName: 'flag' }) : this.#button(t('hud.newGame'), () => game.rematch(), { iconName: 'retry', variant: 'primary' }),
    );
  }

  #renderBar(el, color, name, material, game) {
    const enemy = color === 'w' ? 'b' : 'w';
    const balance = color === 'w' ? material.balance : -material.balance;
    const active = game.status === 'playing' && game.turn === color && game.isLive;
    el.classList.toggle('active', active);
    el.dataset.team = color;
    const clock = game.clock ? h('div.clock', { text: formatClock(game.clock.timeLeft(color)) }) : null;
    this.clockNodes[color] = clock;
    replace(
      el,
      h('span.team-dot', { class: `team-${color}` }),
      h('strong.name', { text: name }),
      h('div.captured', { 'aria-label': this.t('hud.captured') }, material.lost[enemy].map((type) => pieceIcon(type, `cap team-${enemy}`)), balance > 0 ? h('span.balance', { text: `+${balance}` }) : null),
      clock,
    );
  }

  /** Update the clock numbers. Called every frame while a timed game runs. */
  tickClocks() {
    const game = this.game;
    if (!game?.clock || this.screen !== 'game') return;
    for (const color of ['w', 'b']) {
      const node = this.clockNodes[color];
      if (!node) continue;
      const left = game.clock.timeLeft(color);
      const text = formatClock(left);
      if (node.textContent !== text) node.textContent = text;
      node.classList.toggle('low', left < LOW_TIME_MS);
      node.classList.toggle('running', game.clock.running === color);
    }
  }

  #ratingBadge(shown) {
    const glyph = { inaccuracy: '?!', mistake: '?', blunder: '??' }[shown.rating];
    const iconEl = glyph ? h('span.glyph', { text: glyph }) : shown.rating === 'excellent' ? h('span.double', null, icon('check'), icon('check')) : icon(shown.rating === 'best' ? 'star' : 'check');
    return h('div.rating', { class: `tone-${shown.tone}` }, iconEl, shown.label ? h('strong', { text: shown.label }) : null, shown.evalText ? h('span.eval', { text: shown.evalText }) : null);
  }

  #renderCoach(game) {
    if (!game.coachOn) {
      replace(this.coachEl);
      this.coachEl.hidden = true;
      return;
    }
    this.coachEl.hidden = false;
    const t = this.t;
    const shown = game.coachView;
    const parts = [];
    if (this.settings.get('evalBar') && game.evaluation) {
      parts.push(h('div.evalbar', { title: evalText(game.evaluation) }, h('div.evalbar-white', { style: `width:${whiteShare(game.evaluation).toFixed(1)}%` }), h('span', { text: evalText(game.evaluation) })));
    }
    if (!shown) {
      const waiting = game.coachPending;
      const turnText = !game.mode.bot ? t('coachUi.teamTurn', { team: t(`teams.${game.turn}`) }) : game.turn === game.playerColor ? t('coachUi.yourTurn') : t('coachUi.botTurn');
      parts.push(h('div.coach-row', null, coachFace('neutral'), h('p.coach-text.idle', { text: waiting ? t('coachUi.thinking') : game.status === 'over' ? t('coachUi.over') : turnText })));
      replace(this.coachEl, parts);
      return;
    }
    const head = [];
    // In a two-player game the card stays on screen while the other player thinks, so it says whose move it is about.
    if (!game.mode.bot && shown.color) head.push(h('div.coach-who', null, h('span.team-dot', { class: `team-${shown.color}` }), h('span', { text: t('coachUi.teamMove', { team: t(`teams.${shown.color}`) }) })));
    if (shown.stars) head.push(h('div.stars', { 'aria-label': t('coachUi.stars', { count: shown.stars }) }, [1, 2, 3].map((n) => icon('star', n <= shown.stars ? 'icon star on' : 'icon star'))));
    else if (shown.rating) head.push(this.#ratingBadge(shown));
    parts.push(h('div.coach-row', null, coachFace(shown.face ?? 'neutral'), h('div.coach-body', null, head, h('p.coach-text', { text: shown.text }), shown.detail ? h('p.coach-detail', { text: shown.detail }) : null)));
    const buttons = [];
    if (shown.kind !== 'illegal') {
      if (shown.ghostLine?.moves?.length) buttons.push(this.#button(t('coachUi.showMe'), () => game.coachShowLine('problem'), { iconName: 'eye', small: true, disabled: game.busy }));
      if (shown.betterLine?.moves?.length) buttons.push(this.#button(t('coachUi.better'), () => game.coachShowLine('better'), { iconName: 'bulb', small: true, disabled: game.busy }));
      if (game.coachHold) {
        buttons.push(this.#button(t('coachUi.tryAgain'), () => game.coachTryAgain(), { iconName: 'retry', small: true, variant: 'primary', disabled: game.busy }));
        buttons.push(this.#button(t('coachUi.keepGoing'), () => game.coachContinue(), { iconName: 'forward', small: true, disabled: game.busy }));
      }
    }
    if (buttons.length) parts.push(h('div.coach-actions', null, buttons));
    replace(this.coachEl, parts);
    this.#markOverflow(this.coachEl);
  }

  // On a small screen a card has a fixed room, and a text that is longer scrolls inside it. Mark the text while more of it is below, so the styles can fade its last line as a sign to scroll. A card whose text fits gets no mark. Called for every new text, and by the listeners in the constructor when the text is scrolled or the card gets another size.
  #markOverflow(card) {
    const row = card.querySelector(':scope > .coach-row');
    if (row) row.classList.toggle('more-below', row.scrollHeight - row.clientHeight - row.scrollTop > 4);
  }

  #renderMoves(game) {
    const t = this.t;
    const current = game.viewIndex === null ? game.plies.length : game.viewIndex;
    const rows = [];
    for (let i = 0; i < game.plies.length; i += 2) {
      const cell = (index) => {
        const ply = game.plies[index];
        if (!ply) return h('span.move.empty');
        return h('button.move', { type: 'button', class: current === index + 1 ? 'current' : '', onClick: () => game.viewPly(index + 1), text: ply.san });
      };
      rows.push(h('div.move-row', null, h('span.move-no', { text: `${i / 2 + 1}.` }), cell(i), cell(i + 1)));
    }
    const list = h('div.move-list', null, rows.length ? rows : h('p.empty-note', { text: t('hud.noMoves') }));
    const nav = h(
      'div.move-nav',
      null,
      this.#button(t('hud.first'), () => game.viewPly(0), { iconName: 'first', hideLabel: true, small: true, disabled: current === 0 || game.busy }),
      this.#button(t('hud.previous'), () => game.stepView(-1), { iconName: 'back', hideLabel: true, small: true, disabled: current === 0 || game.busy }),
      this.#button(t('hud.next'), () => game.stepView(1), { iconName: 'forward', hideLabel: true, small: true, disabled: game.isLive || game.busy }),
      this.#button(t('hud.live'), () => game.viewPly(null), { iconName: 'last', hideLabel: true, small: true, disabled: game.isLive || game.busy }),
    );
    replace(this.movesEl, list, nav);
    // Keep the newest (or the viewed) move in sight.
    const target = list.querySelector('.move.current');
    if (target) target.scrollIntoView({ block: 'nearest' });
    else list.scrollTop = list.scrollHeight;
  }

  // --- Dialogs ----------------------------------------------------------------------------------------------

  /**
   * Open a dialog.
   * @param {{title:string, body:any[], buttons?:Node[], dismissable?:boolean, className?:string, onClose?:()=>void}} spec
   * @returns {{close:()=>void}}
   */
  #dialog({ title, body, buttons = [], dismissable = true, className = '', onClose = null }) {
    const entry = {};
    const close = () => {
      const index = this.dialogStack.indexOf(entry);
      if (index < 0) return;
      this.dialogStack.splice(index, 1);
      backdrop.remove();
      onClose?.();
    };
    entry.dismiss = dismissable ? close : null;
    entry.close = close;
    const panel = h(
      `div.dialog${className ? '.' + className : ''}`,
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header.dialog-head', null, h('h2', { text: title }), dismissable ? this.#button(this.t('common.close'), close, { iconName: 'close', hideLabel: true }) : null),
      h('div.dialog-body', null, body),
      buttons.length ? h('footer.dialog-foot', null, buttons) : null,
    );
    const backdrop = h('div.backdrop', { onPointerdown: (event) => { if (event.target === backdrop && dismissable) close(); } }, panel);
    this.modalRoot.append(backdrop);
    this.dialogStack.push(entry);
    this.sfx.play('ui.open');
    panel.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
    return entry;
  }

  #row(label, control, note = null) {
    return h('div.setting', null, h('div.setting-text', null, h('strong', { text: label }), note ? h('span', { text: note }) : null), control);
  }

  /** The settings screen. Every change applies at once. */
  openSettings() {
    const s = this.settings;
    const t = this.t;
    const body = h('div.settings');
    const render = () => {
      const set = (key) => (value) => { s.set(key, value); render(); };
      const opts = (key, values) => values.map((value) => ({ value, label: t(`settings.${key}.${value}`) }));
      // A small two-by-two board in the real tile colors of the current theme, so a choice can be picked by eye.
      const swatch = (name) => {
        const { light, dark } = tileColors(s.get('boardTheme'), name);
        return h('span.swatch', { 'aria-hidden': 'true', style: `--light: #${light.getHexString()}; --dark: #${dark.getHexString()}` });
      };
      replace(
        body,
        h('h3', { text: t('settings.groups.gameplay') }),
        this.#row(t('settings.moveInput.label'), this.#choices(opts('moveInput', ['both', 'drag', 'tap']), s.get('moveInput'), set('moveInput'))),
        this.#row(t('settings.legalHints'), this.#toggle(s.get('legalHints'), set('legalHints'), t('settings.legalHints'))),
        this.#row(t('settings.moveConfirm'), this.#toggle(s.get('moveConfirm'), set('moveConfirm'), t('settings.moveConfirm')), t('settings.moveConfirmNote')),
        this.#row(t('settings.autoQueen'), this.#toggle(s.get('autoQueen'), set('autoQueen'), t('settings.autoQueen'))),
        h('h3', { text: t('settings.groups.coach') }),
        this.#row(t('settings.coachLevel.label'), this.#choices(opts('coachLevel', [1, 2, 3]), s.get('coachLevel'), set('coachLevel')), t(`settings.coachLevel.note${s.get('coachLevel')}`)),
        this.#row(t('settings.coachWhen.label'), this.#choices(opts('coachWhen', ['every', 'mistakes']), s.get('coachWhen'), set('coachWhen'))),
        this.#row(t('settings.evalBar'), this.#toggle(s.get('evalBar'), set('evalBar'), t('settings.evalBar'))),
        h('h3', { text: t('settings.groups.two') }),
        this.#row(t('settings.twoPlayerFlip'), this.#toggle(s.get('twoPlayerFlip'), set('twoPlayerFlip'), t('settings.twoPlayerFlip')), t('settings.twoPlayerFlipNote')),
        this.#row(t('settings.twoPlayerCoach'), this.#toggle(s.get('twoPlayerCoach'), set('twoPlayerCoach'), t('settings.twoPlayerCoach')), t('settings.twoPlayerCoachNote')),
        h('h3', { text: t('settings.groups.board') }),
        this.#row(t('settings.boardTheme.label'), this.#choices(opts('boardTheme', Object.keys(BOARD_THEMES)), s.get('boardTheme'), set('boardTheme'))),
        this.#row(t('settings.boardColors.label'), this.#choices(opts('boardColors', BOARD_COLORS).map((option) => ({ ...option, icon: swatch(option.value) })), s.get('boardColors'), set('boardColors')), t('settings.boardColors.note')),
        this.#row(t('settings.coordinates'), this.#toggle(s.get('coordinates'), set('coordinates'), t('settings.coordinates'))),
        this.#row(t('settings.camera.label'), this.#choices(opts('camera', ['angled', 'top']), s.get('camera'), set('camera'))),
        h('h3', { text: t('settings.groups.animation') }),
        this.#row(t('settings.animation.label'), this.#choices(opts('animation', ['cinematic', 'standard', 'minimal', 'instant']), s.get('animation'), set('animation')), t(`settings.animation.note_${s.get('animation')}`)),
        this.#row(t('settings.shake'), this.#toggle(s.get('shake'), set('shake'), t('settings.shake')), t('settings.shakeNote')),
        this.#row(t('settings.quality.label'), this.#choices(opts('quality', ['auto', 'low', 'medium', 'high']), s.get('quality'), set('quality')), s.get('quality') === 'auto' ? t('settings.quality.autoNote', { level: t(`settings.quality.${this.actions.qualityInUse()}`) }) : null),
        this.#row(t('settings.frameRate.label'), this.#choices(opts('frameRate', FRAME_RATES), s.get('frameRate'), set('frameRate')), t(`settings.frameRate.note_${s.get('frameRate')}`)),
        h('h3', { text: t('settings.groups.sound') }),
        this.#row(
          t('settings.volume'),
          h('input.slider', {
            type: 'range',
            min: 0,
            max: 100,
            step: 5,
            value: Math.round(s.get('volume') * 100),
            'aria-label': t('settings.volume'),
            onInput: (event) => s.set('volume', Number(event.target.value) / 100),
            onChange: () => this.sfx.play('coach.good'),
          }),
        ),
        h('h3', { text: t('settings.groups.general') }),
        this.#row(t('settings.reset'), this.#button(t('settings.resetButton'), () => this.#confirmReset(), { small: true, variant: 'danger' }), s.persistent ? t('settings.resetNote') : t('settings.noStorage')),
      );
    };
    render();
    this.#dialog({ title: t('menu.settings'), body: [body], className: 'wide' });
  }

  // A link that leaves the game. It opens in a new tab, so the game in this tab keeps running, and it tells screen readers so.
  #externalLink(tag, href, label, ...children) {
    return h(tag, { href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${label} ${this.t('about.newTab')}`, onClick: () => this.sfx.play('ui.click') }, children);
  }

  // The parts of a sentence from the text table, with a real link at each of its marks, such as {link}. `links` gives the address and the words of the link for each mark name.
  #textWithLinks(key, links) {
    return splitAtMarks(this.t(key), Object.keys(links)).map((piece) => {
      if (!piece.mark) return piece.text;
      const { href, label } = links[piece.mark];
      return this.#externalLink('a', href, label, label);
    });
  }

  /** The steps that put the game on the Home Screen of an iPhone or iPad. Apple gives a web page no way to start an install, so the game can only show where the button is. */
  openInstallHelp() {
    const t = this.t;
    const step = (iconName, key) => h('li', null, icon(iconName), h('span', { text: t(key) }));
    const entry = this.#dialog({
      title: t('install.title'),
      className: 'install-dialog',
      body: [h('p', { text: t('install.iosIntro') }), h('ol.install-steps', null, step('share', 'install.iosShare'), step('addBox', 'install.iosAdd'), step('check', 'install.iosConfirm')), h('p.install-note', { text: t('install.iosNote') })],
      buttons: [this.#button(t('install.gotIt'), () => entry.close(), { variant: 'primary' })],
    });
  }

  /** The About screen: what the game is, where it lives and whose work it is built on. The addresses and the credits come from about.js. */
  openAbout() {
    const t = this.t;
    const linkRow = (name) => {
      const label = t(`about.links.${name}`);
      const address = shortAddress(ABOUT_LINKS[name]);
      return this.#externalLink('a.about-link', ABOUT_LINKS[name], `${label}: ${address}`, h('span.about-link-text', null, h('strong', { text: label }), h('span', { text: address })), icon('external'));
    };
    const credit = ({ id, name, licence }) => h('li.credit', null, h('span.credit-name', null, h('strong', { text: name }), h('span', { text: t(`about.credits.${id}`) })), h('span.credit-licence', { text: licence }));
    const profiles = Object.fromEntries(ABOUT_PROFILES.map(({ id, name, address }) => [id, { href: address, label: name }]));
    // The licence file sits next to the game, so its address is built from the page's own address and works in any folder.
    const licences = { href: new URL(LICENCES_FILE, document.baseURI).href, label: t('about.licencesLink') };
    this.#dialog({
      title: t('menu.about'),
      className: 'about-dialog',
      body: [
        h('p', { text: t('about.intro') }),
        h('p', null, this.#textWithLinks('about.feedback', { link: { href: ABOUT_LINKS.issues, label: t('about.feedbackLink') } })),
        h('div.about-links', null, linkRow('game'), linkRow('source')),
        // The link to the licence texts ends the line above the list, right over the column of licence names.
        h('div.about-thanks', null, h('p', { text: t('about.thanks') }), this.#externalLink('a', licences.href, licences.label, licences.label)),
        h('ul.credits', null, ABOUT_CREDITS.map(credit)),
        h('p.about-note', null, `${t('about.ai')} `, this.#textWithLinks('about.author', profiles)),
      ],
    });
  }

  #confirmReset() {
    const t = this.t;
    const entry = this.#dialog({
      title: t('settings.reset'),
      body: [h('p', { text: t('settings.resetAsk') })],
      buttons: [this.#button(t('common.cancel'), () => entry.close()), this.#button(t('settings.resetButton'), () => { entry.close(); this.actions.resetData(); }, { variant: 'danger' })],
    });
  }

  #confirmResign() {
    const t = this.t;
    const game = this.game;
    if (!game) return;
    if (game.mode.bot) {
      const entry = this.#dialog({
        title: t('hud.resign'),
        body: [h('p', { text: t('hud.resignAsk') })],
        buttons: [this.#button(t('common.cancel'), () => entry.close()), this.#button(t('hud.resign'), () => { entry.close(); game.resign(); }, { variant: 'danger', iconName: 'flag' })],
      });
      return;
    }
    // Two players share the device, so the dialog asks which of them gives up.
    const giveUp = (color) => this.#button(t('hud.resignTeam', { team: t(`teams.${color}`) }), () => { entry.close(); game.resign(color); }, { variant: 'danger', iconName: 'flag' });
    const entry = this.#dialog({
      title: t('hud.resign'),
      className: 'resign-two',
      body: [h('p', { text: t('hud.resignWho') }), h('div.stack-buttons', null, giveUp('w'), giveUp('b'))],
      buttons: [this.#button(t('common.cancel'), () => entry.close())],
    });
  }

  #leaveGame() {
    const game = this.game;
    const t = this.t;
    if (!game || game.status !== 'playing' || game.plies.length === 0) {
      this.actions.quitToMenu();
      return;
    }
    const entry = this.#dialog({
      title: t('hud.leaveTitle'),
      body: [h('p', { text: t('hud.leaveAsk') })],
      buttons: [this.#button(t('hud.stay'), () => entry.close(), { variant: 'primary' }), this.#button(t('hud.leave'), () => { entry.close(); this.actions.quitToMenu(); })],
    });
  }

  /** Ask which piece a pawn becomes. Resolves to q, r, b or n, or null when the player backs out. */
  askPromotion(color) {
    const t = this.t;
    return new Promise((resolve) => {
      let answered = false;
      const answer = (value) => {
        if (answered) return;
        answered = true;
        entry.close();
        resolve(value);
      };
      const entry = this.#dialog({
        title: t('promotion.title'),
        className: 'promotion',
        body: [h('div.promo-grid', null, ['q', 'r', 'b', 'n'].map((type) => h('button.promo', { type: 'button', onClick: () => { this.sfx.play('ui.click'); answer(type); } }, pieceIcon(type, `promo-icon team-${color}`), h('span', { text: t(`pieces.${type}`) }))))],
        onClose: () => {
          if (!answered) {
            answered = true;
            resolve(null);
          }
        },
      });
    });
  }

  /** Optional confirm step before a move is played. Resolves to true or false. */
  askConfirm(move) {
    const t = this.t;
    return new Promise((resolve) => {
      const done = (value) => {
        this.confirmEl.hidden = true;
        replace(this.confirmEl);
        resolve(value);
      };
      const text = this.settings.get('coachLevel') === 1 ? t('confirm.ask') : t('confirm.askMove', { move: move.san });
      replace(this.confirmEl, h('span', { text }), this.#button(t('confirm.yes'), () => done(true), { variant: 'primary', iconName: 'check', small: true }), this.#button(t('confirm.no'), () => done(false), { iconName: 'close', small: true }));
      this.confirmEl.hidden = false;
    });
  }

  /** The end-of-game dialog: the result, the reason, and what to do next. */
  showGameOver(result) {
    const game = this.game;
    if (!game) return;
    const t = this.t;
    const two = !game.mode.bot;
    // In a two-player game nobody at the device "lost to the game": the dialog names the side that won, and its words are for both players.
    const outcome = result.winner === null ? 'draw' : two || result.winner === game.playerColor ? 'win' : 'lose';
    const team = (color) => t(`teams.${color}`);
    const title = two && result.winner ? t('gameover.teamWon', { team: team(result.winner) }) : t(`gameover.${outcome}`);
    const reason = two && result.type === 'resign' ? t('gameover.reasons.resignTeam', { team: team(result.winner === 'w' ? 'b' : 'w') }) : t(`gameover.reasons.${result.type}`);
    const cheer = two && result.winner ? t('gameover.cheer.two') : t(`gameover.cheer.${outcome}`);
    const entry = this.#dialog({
      title,
      className: `gameover outcome-${outcome}`,
      body: [h('div.gameover-face', null, coachFace(outcome === 'win' ? 'happy' : outcome === 'lose' ? 'sad' : 'neutral')), h('p.reason', { text: reason }), h('p.cheer', { text: cheer })],
      buttons: [
        this.#button(t('gameover.rematch'), () => { entry.close(); game.rematch(); }, { variant: 'primary', iconName: 'retry' }),
        this.#button(t('gameover.review'), () => { entry.close(); game.viewPly(0); }, { iconName: 'eye' }),
        this.#button(t('hud.menu'), () => { entry.close(); this.actions.quitToMenu(); }, { iconName: 'home' }),
      ],
    });
  }

  /** Export dialog: copy the position (FEN) or the whole game (PGN), or save the game as a file. */
  openExport() {
    const game = this.game;
    if (!game) return;
    const t = this.t;
    const copy = async (text, doneKey) => {
      try {
        await navigator.clipboard.writeText(text);
        this.toast(t(doneKey), 'good');
      } catch (error) {
        console.warn('[ui] clipboard is not available', error);
        this.toast(t('export.copyFailed'), 'bad');
      }
    };
    const download = () => {
      const blob = new Blob([game.pgn()], { type: 'application/x-chess-pgn' });
      const url = URL.createObjectURL(blob);
      const link = h('a', { href: url, download: 'robot-chess-game.pgn' });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    this.#dialog({
      title: t('hud.export'),
      className: 'wide',
      body: [
        h('p', { text: t('export.about') }),
        h('label.export-label', { text: t('export.fen') }),
        h('textarea.export-text', { readonly: true, rows: 2, text: game.fen() }),
        h('label.export-label', { text: t('export.pgn') }),
        h('textarea.export-text', { readonly: true, rows: 6, text: game.pgn() }),
      ],
      buttons: [this.#button(t('export.copyFen'), () => copy(game.fen(), 'export.copiedFen'), { iconName: 'copy' }), this.#button(t('export.copyPgn'), () => copy(game.pgn(), 'export.copiedPgn'), { iconName: 'copy' }), this.#button(t('export.download'), download, { iconName: 'export', variant: 'primary' })],
    });
  }

  /**
   * First-launch questions: how well the player knows chess, then the offer of the tutorial. The answer only sets starting values; everything can be changed later.
   * @returns {Promise<{experience:string, tutorial:boolean}>}
   */
  askOnboarding() {
    const t = this.t;
    return new Promise((resolve) => {
      let experience = null;
      const body = h('div.onboarding');
      const entry = this.#dialog({ title: t('onboarding.title'), body: [body], dismissable: false, className: 'onboarding-dialog' });
      const step = () => {
        if (!experience) {
          replace(body, h('p.question', { text: t('onboarding.experienceAsk') }), this.#choices(['new', 'rules', 'player'].map((value) => ({ value, label: t(`onboarding.experience.${value}`) })), null, (value) => { experience = value; step(); }, { className: 'stack' }));
        } else {
          const finish = (tutorial) => {
            entry.close();
            resolve({ experience, tutorial });
          };
          replace(body, h('div.gameover-face', null, coachFace('happy')), h('p.question', { text: t('onboarding.tutorialAsk') }), h('div.stack-buttons', null, this.#button(t('onboarding.tutorialYes'), () => finish(true), { variant: 'primary', iconName: 'school' }), this.#button(t('onboarding.tutorialNo'), () => finish(false))));
        }
      };
      step();
    });
  }

  // --- Tutorial card ----------------------------------------------------------------------------------------

  /** Switch the in-game layout to the tutorial: only the board and the lesson card. */
  showTutorial() {
    this.screen = 'tutorial';
    this.game = null;
    this.menuEl.hidden = true;
    this.hudEl.hidden = false;
    this.hudEl.classList.add('is-tutorial');
    this.hudEl.classList.remove('has-coach', 'no-moves', 'is-over', 'is-hold');
    this.tutorialEl.hidden = false;
    replace(this.topbar, this.#button(this.t('hud.menu'), () => this.actions.quitToMenu(), { iconName: 'home', hideLabel: true }), h('div.chip', null, h('strong', { text: this.t('menu.tutorial') })), h('div.opening'), this.#resetViewButton({ hideLabel: true }), this.#button(this.t('menu.settings'), () => this.openSettings(), { iconName: 'settings', hideLabel: true }));
    replace(this.botBar);
    replace(this.youBar);
    replace(this.coachEl);
    replace(this.movesEl);
    replace(this.actionsEl);
  }

  /**
   * Draw the lesson card.
   * @param {{chapter:string, text:string, note?:string|null, noteTone?:string, progress:string, face?:string, buttons:Array<{label:string, action:()=>void, primary?:boolean, icon?:string}>}} card
   */
  renderTutorial(card) {
    replace(
      this.tutorialEl,
      h('div.tutorial-head', null, h('strong', { text: card.chapter }), h('span', { text: card.progress })),
      h('div.coach-row', null, coachFace(card.face ?? 'happy'), h('div.coach-body', null, h('p.coach-text', { text: card.text }), card.note ? h('p.tutorial-note', { class: `tone-${card.noteTone ?? 'ok'}`, text: card.note }) : null)),
      h('div.coach-actions', null, card.buttons.map((button) => this.#button(button.label, button.action, { variant: button.primary ? 'primary' : 'ghost', iconName: button.icon ?? null, small: true }))),
    );
    this.#markOverflow(this.tutorialEl);
  }

  // --- Toasts -----------------------------------------------------------------------------------------------

  /** Short message at the bottom of the screen. Sticky toasts stay until tapped. */
  toast(text, tone = 'ok', sticky = false) {
    const el = h('div.toast', { class: `tone-${tone}`, role: 'status', onClick: () => el.remove() }, h('span', { text }));
    this.toastRoot.append(el);
    if (!sticky) setTimeout(() => el.remove(), TOAST_MS);
  }
}
