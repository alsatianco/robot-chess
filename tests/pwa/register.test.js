// Starting the service worker is an extra: the game must run the same without it. These tests check that it is started from the right address, and that a browser without service workers, or a failed start, never stops the game.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerServiceWorker, SERVICE_WORKER_FILE } from '../../src/pwa/register.js';
import * as build from '../../scripts/build-service-worker.mjs';

afterEach(() => vi.restoreAllMocks());

describe('starting the service worker', () => {
  it('uses the file that the build writes', () => {
    expect(build.SERVICE_WORKER_FILE).toBe(SERVICE_WORKER_FILE);
  });

  it.each(['https://play.example/robot-chess/', 'https://play.example/robot-chess/index.html?from=menu#top'])('starts the worker that sits next to the page at %s', async (page) => {
    const registration = { scope: 'https://play.example/robot-chess/' };
    const register = vi.fn(async () => registration);
    expect(await registerServiceWorker({ serviceWorker: { register } }, page)).toBe(registration);
    expect(register.mock.calls).toEqual([[`https://play.example/robot-chess/${SERVICE_WORKER_FILE}`]]);
  });

  it('does nothing in a browser that has no service workers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await registerServiceWorker({}, 'https://play.example/')).toBe(null);
    expect(await registerServiceWorker(undefined, 'https://play.example/')).toBe(null);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports a failed start and lets the game go on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('blocked');
    const register = vi.fn(async () => {
      throw failure;
    });
    expect(await registerServiceWorker({ serviceWorker: { register } }, 'https://play.example/')).toBe(null);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^\[pwa\] /);
    expect(warn.mock.calls[0][1]).toBe(failure);
  });
});
