// When may the game offer "Install", and what does a tap on it do? Chrome and Edge hand the page an event that opens the browser's own install dialog. iPhone and iPad have no such thing: there the player adds the game to the Home Screen by hand, so the game can only show the steps. These tests run the real logic against a stand-in for the browser window.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InstallPrompt } from '../../src/app/install.js';

const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', platform: 'Linux armv81', maxTouchPoints: 5 };
const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 };
// An iPad says it is a Mac, and only the touch screen gives it away.
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const MAC = { ...IPAD, maxTouchPoints: 0 };

function fakeWindow(navigator = ANDROID, { standalone = false, matchMedia = true } = {}) {
  const listeners = {};
  const media = { matches: standalone, onChange: [], addEventListener: (type, listener) => void media.onChange.push(listener) };
  const win = {
    navigator,
    media,
    addEventListener: (type, listener) => void (listeners[type] ??= []).push(listener),
    fire: (type, event = {}) => (listeners[type] ?? []).forEach((listener) => listener(event)),
  };
  if (matchMedia) win.matchMedia = (query) => (query === '(display-mode: standalone)' ? media : { matches: false, addEventListener() {} });
  return win;
}

/** The event Chrome sends when the game can be installed. `outcome` is what the player picks in the browser's dialog. */
function browserOffer(outcome = 'accepted') {
  const offer = { prevented: 0, shown: 0, preventDefault: () => void offer.prevented++, prompt: async () => void offer.shown++, userChoice: Promise.resolve({ outcome, platform: 'web' }) };
  return offer;
}

afterEach(() => vi.restoreAllMocks());

describe('install offer in Chrome and Edge', () => {
  it('offers nothing until the browser says the game can be installed', () => {
    expect(new InstallPrompt(fakeWindow()).state).toBe('none');
  });

  it('offers the install when the browser says so, and keeps the browser from showing its own banner', () => {
    const win = fakeWindow();
    const install = new InstallPrompt(win);
    const changed = vi.fn();
    install.onChange(changed);
    const offer = browserOffer();
    win.fire('beforeinstallprompt', offer);
    expect(install.state).toBe('prompt');
    expect(offer.prevented).toBe(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('opens the dialog of the browser on a tap and reports that the player said yes', async () => {
    const win = fakeWindow();
    const install = new InstallPrompt(win);
    const offer = browserOffer('accepted');
    win.fire('beforeinstallprompt', offer);
    expect(await install.install()).toBe('accepted');
    expect(offer.shown).toBe(1);
  });

  it('takes the offer away once it was used, because the browser lets it be used only once', async () => {
    const win = fakeWindow();
    const install = new InstallPrompt(win);
    const changed = vi.fn();
    install.onChange(changed);
    const offer = browserOffer('dismissed');
    win.fire('beforeinstallprompt', offer);
    expect(await install.install()).toBe('dismissed');
    expect(install.state).toBe('none');
    expect(await install.install()).toBe('unavailable');
    expect(offer.shown).toBe(1);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('offers again when the browser sends a new offer after a "no"', async () => {
    const win = fakeWindow();
    const install = new InstallPrompt(win);
    win.fire('beforeinstallprompt', browserOffer('dismissed'));
    await install.install();
    const second = browserOffer('accepted');
    win.fire('beforeinstallprompt', second);
    expect(install.state).toBe('prompt');
    expect(await install.install()).toBe('accepted');
    expect(second.shown).toBe(1);
  });

  it('reports a dialog that fails to open and lets the game go on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const win = fakeWindow();
    const install = new InstallPrompt(win);
    const failure = new Error('not allowed');
    win.fire('beforeinstallprompt', { ...browserOffer(), prompt: async () => { throw failure; } });
    expect(await install.install()).toBe('failed');
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/^\[install\] /), failure]]);
  });

  it('says so when there is nothing to install with', async () => {
    expect(await new InstallPrompt(fakeWindow()).install()).toBe('unavailable');
  });
});

describe('install offer on iPhone and iPad', () => {
  it.each([['an iPhone', IPHONE], ['an iPad that says it is a Mac', IPAD]])('shows the steps on %s, because the browser there has no install dialog', (name, navigator) => {
    expect(new InstallPrompt(fakeWindow(navigator)).state).toBe('ios');
  });

  it('offers nothing on a real Mac', () => {
    expect(new InstallPrompt(fakeWindow(MAC)).state).toBe('none');
  });

  it('offers nothing when the game was opened from the Home Screen', () => {
    expect(new InstallPrompt(fakeWindow({ ...IPHONE, standalone: true })).state).toBe('none');
  });
});

describe('a game that is installed already', () => {
  it('offers nothing inside the installed app, even when the browser sends an offer', () => {
    const win = fakeWindow(ANDROID, { standalone: true });
    const install = new InstallPrompt(win);
    win.fire('beforeinstallprompt', browserOffer());
    expect(install.state).toBe('none');
  });

  it('takes the offer away and tells the interface when the install is done', () => {
    const win = fakeWindow();
    const install = new InstallPrompt(win);
    const changed = vi.fn();
    const installed = vi.fn();
    install.onChange(changed);
    install.onInstalled(installed);
    win.fire('beforeinstallprompt', browserOffer());
    win.fire('appinstalled');
    expect(install.state).toBe('none');
    expect(installed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('follows the window when the browser moves the page into the installed app', () => {
    const win = fakeWindow();
    const install = new InstallPrompt(win);
    const changed = vi.fn();
    install.onChange(changed);
    win.fire('beforeinstallprompt', browserOffer());
    win.media.matches = true;
    win.media.onChange.forEach((listener) => listener());
    expect(install.state).toBe('none');
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe('browsers that know none of this', () => {
  it('offers nothing and does not fail in a browser without display modes', () => {
    const install = new InstallPrompt(fakeWindow(ANDROID, { matchMedia: false }));
    expect(install.state).toBe('none');
  });

  it('offers nothing where there is no window at all', () => {
    expect(new InstallPrompt(undefined).state).toBe('none');
  });
});
