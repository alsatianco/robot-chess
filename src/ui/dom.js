// Small DOM helpers and the icon set for the interface. Icons are inline vector shapes so they load with the page and take the text color.

/**
 * Create an element.
 * @param {string} tag Tag name with optional classes, for example "button.btn.primary".
 * @param {Record<string, any>|null} [props] Attributes. `on*` keys add listeners, `class` adds classes, `text` sets text, `hidden` and other booleans toggle the attribute.
 * @param {...(Node|string|null|undefined|false)} children
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'class') el.classList.add(...String(value).split(/\s+/).filter(Boolean));
      else if (key === 'text') el.textContent = value;
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Remove all children of an element and add new ones. */
export function replace(el, ...children) {
  el.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
}

const ICONS = {
  menu: 'M4 6.5h16v2.2H4zm0 4.4h16v2.2H4zm0 4.4h16v2.2H4z',
  settings: 'M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.6 2 3.4 2.4-1c.8.6 1.6 1.2 2.6 1.5l.4 2.5h4l.4-2.5c1-.3 1.8-.9 2.6-1.5l2.4 1 2-3.4zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
  soundOn: 'M4 9.5v5h3.5L12 19V5L7.5 9.5zm11.5 2.5a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5zm-2-7.7v2.2a6 6 0 0 1 0 11v2.2a8.2 8.2 0 0 0 0-15.4z',
  soundOff: 'M4 9.5v5h3.5L12 19V5L7.5 9.5zm16.6-.4-1.5-1.5L17 9.7l-2.1-2.1-1.5 1.5 2.1 2.1-2.1 2.1 1.5 1.5 2.1-2.1 2.1 2.1 1.5-1.5-2.1-2.1z',
  undo: 'M12.5 7.5H8V4L2.5 9 8 14v-3.6h4.5a4.3 4.3 0 0 1 0 8.6H8v2.4h4.5a6.7 6.7 0 0 0 0-13.4z',
  flip: 'M7 3 2.5 7.5 7 12V8.8h10V6.2H7zm10 9v3.2H7v2.6h10V21l4.5-4.5z',
  camera: 'M12 5c-5 0-8.7 3.6-10 7 1.3 3.4 5 7 10 7s8.7-3.6 10-7c-1.3-3.4-5-7-10-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-2.3a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z',
  recenter: 'M11 2h2v3.1a7 7 0 0 1 5.9 5.9H22v2h-3.1a7 7 0 0 1-5.9 5.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1zm1 5.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6zm0 2.6a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z',
  export: 'M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM4 18h16v2.5H4z',
  flag: 'M5 3h2v1h11l-2.2 4L18 12H7v9H5z',
  play: 'M7 4.5v15l12.5-7.5z',
  back: 'M15.5 5 8.5 12l7 7 1.6-1.6L11.7 12l5.4-5.4z',
  forward: 'M8.5 5 7 6.6l5.3 5.4L7 17.4 8.5 19l7-7z',
  first: 'M6 5h2.2v14H6zm12.5 0L10 12l8.5 7z',
  last: 'M15.8 5H18v14h-2.2zM5.5 5 14 12l-8.5 7z',
  close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z',
  check: 'M9.5 16.2 5.3 12l-1.6 1.6 5.8 5.8L20.8 8.1 19.2 6.5z',
  star: 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z',
  home: 'M12 3.5 2.5 12H5v8.5h5.2v-5.5h3.6v5.5H19V12h2.5z',
  school: 'M12 3 1.5 8.5 12 14l8.3-4.3V16H22V8.5zM5.5 12.6v4.2c1.6 1.8 4 2.7 6.5 2.7s4.9-.9 6.5-2.7v-4.2L12 16z',
  copy: 'M8 3h11v13h-2.2V5.2H8zM5 7h10v14H5zm2.2 2.2v9.6h5.6V9.2z',
  eye: 'M12 6C7.5 6 3.7 8.7 2 12c1.7 3.3 5.5 6 10 6s8.3-2.7 10-6c-1.7-3.3-5.5-6-10-6zm0 9.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  retry: 'M12 5a7 7 0 1 0 6.7 9h-2.4A4.8 4.8 0 1 1 12 7.2c1.3 0 2.5.5 3.4 1.4L13 11h6.5V4.5l-2.5 2.5A7 7 0 0 0 12 5z',
  info: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm-1.2 4.2h2.4v2.4h-2.4zm0 4.1h2.4v6.5h-2.4z',
  install: 'M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM4 18h16v2.5H4z',
  share: 'M12 2.5 7.5 7l1.6 1.6 1.8-1.8V15h2.2V6.8l1.8 1.8L16.5 7zM5 10h4v2.2H7.2v7.6h9.6v-7.6H15V10h4v12H5z',
  addBox: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm.2 2.2v13.6h13.6V5.2zM10.9 7.5h2.2v3.4h3.4v2.2h-3.4v3.4h-2.2v-3.4H7.5v-2.2h3.4z',
  external: 'M14 4h6v6h-2.2V7.8l-7.3 7.3-1.6-1.6 7.3-7.3H14zM5 7h6v2.2H7.2v9.6h9.6V15H19v6H5z',
  bulb: 'M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.6v.6h6v-.6c0-.6.3-1.2.8-1.6A6.5 6.5 0 0 0 12 2.5zM9.2 18h5.6v1.6H9.2zm.8 2.6h4V22h-4z',
};

/**
 * Inline icon.
 * @param {keyof typeof ICONS} name
 */
export function icon(name, className = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] ?? '');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/**
 * The coach's robot face: a small screen with LED eyes that show a mood. It uses the same visual language as the robots on the board.
 * @param {'wow'|'happy'|'neutral'|'worried'|'sad'} mood
 */
export function coachFace(mood) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `coach-face mood-${mood}`);
  const add = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    svg.append(el);
  };
  add('rect', { x: 2, y: 2, width: 60, height: 44, rx: 13, class: 'screen' });
  const eyes = {
    happy: ['M13 26q7-13 14 0', 'M37 26q7-13 14 0'],
    wow: null,
    neutral: null,
    worried: ['M14 17l11 4v9a5.5 5.5 0 0 1-11 0z', 'M50 17l-11 4v9a5.5 5.5 0 0 0 11 0z'],
    sad: ['M14 24l11-5v9a5.5 5.5 0 0 1-11 0z', 'M50 24l-11-5v9a5.5 5.5 0 0 0 11 0z'],
  }[mood];
  if (mood === 'happy') {
    for (const d of eyes) add('path', { d, class: 'led stroke' });
    add('path', { d: 'M25 34q7 6 14 0', class: 'led stroke thin' });
  } else if (mood === 'wow') {
    add('circle', { cx: 20, cy: 21, r: 7.5, class: 'led' });
    add('circle', { cx: 44, cy: 21, r: 7.5, class: 'led' });
    add('ellipse', { cx: 32, cy: 36, rx: 3.6, ry: 4.2, class: 'led' });
  } else if (mood === 'neutral') {
    add('rect', { x: 14, y: 14, width: 11, height: 15, rx: 5, class: 'led' });
    add('rect', { x: 39, y: 14, width: 11, height: 15, rx: 5, class: 'led' });
    add('path', { d: 'M26 36h12', class: 'led stroke thin' });
  } else {
    for (const d of eyes) add('path', { d, class: 'led' });
    add('path', { d: mood === 'sad' ? 'M25 38q7-5 14 0' : 'M27 37h10', class: 'led stroke thin' });
  }
  return svg;
}
