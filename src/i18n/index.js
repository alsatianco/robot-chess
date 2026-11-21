// Tiny translation layer. All user-facing text lives in one file per language (en.js). To add a language, copy en.js, translate the values and register it in LANGUAGES.
import en from './en.js';

const LANGUAGES = { en };
let current = en;

/** Switch the active language. Unknown codes fall back to English. */
export function setLanguage(code) {
  current = LANGUAGES[code] ?? en;
}

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

function format(value, key, params) {
  if (Array.isArray(value)) value = value[Math.floor(Math.random() * value.length)];
  if (typeof value !== 'string') return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/**
 * Build a translate function over one dictionary, with an optional fallback dictionary. Used by the app (see `t`) and by tests that want to check a module's strings on their own.
 * @param {object} dict
 * @param {object} [fallback]
 * @returns {(key: string, params?: Record<string, string|number>) => string}
 */
export function createTranslator(dict, fallback) {
  return (key, params) => {
    let value = lookup(dict, key);
    if (value === undefined && fallback) value = lookup(fallback, key);
    // A missing key returns the key itself, so a gap is visible on screen and in tests instead of failing silently.
    if (value === undefined) return key;
    return format(value, key, params);
  };
}

/**
 * Translate a key such as "menu.play". `{name}` placeholders are replaced from params. When a value is an array, one entry is picked at random (used for varied coach lines).
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  return createTranslator(current, en)(key, params);
}

/** True when the key exists in the active language or in English. */
export function hasKey(key) {
  return lookup(current, key) !== undefined || lookup(en, key) !== undefined;
}
