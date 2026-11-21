// Turns mouse wheel, trackpad and pinch input into zoom steps for the camera. A step is a factor for the camera distance: above 1 moves the camera away, below 1 moves it closer. The zoom follows how far the player scrolls or pinches, not how many events the device sends, so a trackpad (many small events) and a mouse wheel (few big events) feel the same.

/** Zoom change per pixel of scroll, as a share of the distance: 100 pixels (one notch of a common mouse wheel) change the distance by about 3.5%, so the whole zoom range takes about 1500 pixels of scrolling. */
export const WHEEL_ZOOM_PER_PIXEL = 0.00035;
/** How fast a two-finger pinch zooms, compared to the fingers. At 0.35 the fingers must double their distance to bring the camera about 22% closer, which is the way from the default zoom to just before the closest zoom. At 1 the picture would follow the fingers, and the small zoom range would be over after a tiny move. */
export const PINCH_SPEED = 0.35;
/** Zoom change per unit of a trackpad pinch. Browsers report a trackpad pinch as wheel events with `ctrlKey` set and small amounts, where 100 units mean "e times bigger". Dividing by 100 gives a trackpad pinch the same speed as a pinch on a touch screen. */
export const TRACKPAD_PINCH_ZOOM_PER_UNIT = PINCH_SPEED / 100;
/** The biggest zoom change one wheel event may make (about 5%), so a device that reports a huge scroll amount cannot jump through the range. */
export const MAX_WHEEL_STEP = 0.05;

/** Pixels for one line and one page, for devices that report the scroll amount in lines or pages (`WheelEvent.deltaMode` 1 and 2). */
const LINE_PIXELS = 40;
const PAGE_PIXELS = 800;

/**
 * Zoom step for one wheel event.
 * @param {{deltaY?:number, deltaMode?:number, ctrlKey?:boolean}} event A `WheelEvent`, or an object with the same fields.
 * @returns {number} Factor for the camera distance. It is 1 (no change) for a sideways scroll or a broken amount.
 */
export function wheelZoomFactor({ deltaY = 0, deltaMode = 0, ctrlKey = false } = {}) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const pixels = deltaMode === 1 ? deltaY * LINE_PIXELS : deltaMode === 2 ? deltaY * PAGE_PIXELS : deltaY;
  const step = pixels * (ctrlKey ? TRACKPAD_PINCH_ZOOM_PER_UNIT : WHEEL_ZOOM_PER_PIXEL);
  return Math.exp(Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, step)));
}

/**
 * Zoom step for a two-finger pinch on a touch screen.
 * @param {number} previousDistance Distance between the two fingers at the last event, in pixels.
 * @param {number} distance Distance between the two fingers now, in pixels.
 * @returns {number} Factor for the camera distance. It is 1 (no change) when a distance is zero or broken.
 */
export function pinchZoomFactor(previousDistance, distance) {
  if (!Number.isFinite(previousDistance) || !Number.isFinite(distance) || previousDistance <= 0 || distance <= 0) return 1;
  return (previousDistance / distance) ** PINCH_SPEED;
}
