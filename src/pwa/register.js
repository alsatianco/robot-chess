// Starts the service worker (src/pwa/service-worker.js), which keeps the game's files on the device for play with no internet. The game runs the same without it, so a browser that has no service workers is fine, and a failed start is only reported.

/** The name of the worker file in the built site. The build writes it next to the page (scripts/build-service-worker.mjs). */
export const SERVICE_WORKER_FILE = 'sw.js';

/**
 * @param {{serviceWorker?: {register: (address: string) => Promise<object>}}} [nav] The browser's `navigator`.
 * @param {string} [pageAddress] The address of the page. The worker file sits next to the page, so the game works from any folder.
 * @returns {Promise<object|null>} The registration, or null when the browser has no service workers (an old browser, or a page that is not on https) or when the start failed.
 */
export async function registerServiceWorker(nav = globalThis.navigator, pageAddress = globalThis.document?.baseURI) {
  if (!nav?.serviceWorker) return null;
  try {
    return await nav.serviceWorker.register(new URL(SERVICE_WORKER_FILE, pageAddress).href);
  } catch (error) {
    console.warn('[pwa] The service worker did not start, so the game will not work with no internet.', error);
    return null;
  }
}
