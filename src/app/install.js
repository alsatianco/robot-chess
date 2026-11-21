// Decides when the game may offer "Install" and what a tap on it does. Chrome and Edge send the page an offer that opens the browser's own install dialog. iPhone and iPad have no such offer: there the player adds the game to the Home Screen by hand, so the game can only show the steps. No DOM is touched here; the button and the steps are drawn in src/ui/ui.js.

/** The game runs as an installed app: in its own window, with no browser bars. */
const STANDALONE = '(display-mode: standalone)';

/** iPhone, iPod and iPad. An iPad says it is a Mac, and only its touch screen gives it away. */
function isIos(navigator) {
  if (!navigator) return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent ?? '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export class InstallPrompt {
  /** The offer of the browser, kept until the player taps the button. @type {{prompt: () => Promise<unknown>, userChoice: Promise<{outcome: string}>}|null} */
  #offer = null;
  #installed = false;
  #window;
  #display = null;
  #changeListeners = [];
  #installedListeners = [];

  /**
   * @param {Window} [win] The browser window. Tests pass a stand-in.
   */
  constructor(win = globalThis.window) {
    this.#window = win;
    if (!win) return;
    this.#display = win.matchMedia?.(STANDALONE) ?? null;
    // The browser moves a page into the app window right after an install on a desktop, so the display mode can change while the game runs.
    this.#display?.addEventListener?.('change', () => this.#changed());
    win.addEventListener('beforeinstallprompt', (offer) => {
      // Without this, Chrome on Android shows a banner of its own at a moment it picks. The game shows a quiet button on the home menu and the player decides when.
      offer.preventDefault();
      this.#offer = offer;
      this.#changed();
    });
    win.addEventListener('appinstalled', () => {
      this.#offer = null;
      this.#installed = true;
      this.#changed();
      for (const listener of this.#installedListeners) listener();
    });
  }

  /**
   * What the interface should offer: `prompt` is a button that opens the browser's install dialog, `ios` is a button that shows the steps for iPhone and iPad, `none` is no button (installed already, or a browser that can not install).
   * @returns {'none'|'prompt'|'ios'}
   */
  get state() {
    const navigator = this.#window?.navigator;
    if (this.#installed || this.#display?.matches === true || navigator?.standalone === true) return 'none';
    if (this.#offer) return 'prompt';
    return isIos(navigator) ? 'ios' : 'none';
  }

  /** Call `listener` whenever `state` may have changed. */
  onChange(listener) {
    this.#changeListeners.push(listener);
  }

  /** Call `listener` once the browser reports that the game was installed. */
  onInstalled(listener) {
    this.#installedListeners.push(listener);
  }

  #changed() {
    for (const listener of this.#changeListeners) listener();
  }

  /**
   * Open the browser's install dialog. It must be called from a tap or a click, or the browser refuses.
   * @returns {Promise<'accepted'|'dismissed'|'unavailable'|'failed'>} `unavailable` when the browser has made no offer.
   */
  async install() {
    const offer = this.#offer;
    if (!offer) return 'unavailable';
    // The browser lets an offer be used once. After a "no" it sends a new one, and the button comes back with it.
    this.#offer = null;
    this.#changed();
    try {
      await offer.prompt();
      const choice = await offer.userChoice;
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch (error) {
      console.warn('[install] The install dialog of the browser did not open.', error);
      return 'failed';
    }
  }
}
