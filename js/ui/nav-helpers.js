// Two small pieces the week view and the chart view both need.
//
// Their own module because they are all the two views share: with them inside week-view
// the chart view had to import it, and week-view imports the chart view to put the chart
// under the cards - a cycle, which ES modules tolerate but build-offline.py cannot order
// into one flat script.
import { dateFromSerial } from '../zmanim/solar.js';

/** The week the congregation should be looking at: the next Shabbos still to come.
 *
 *  It rolls over once Shabbos is behind us, so Sunday morning already shows the coming
 *  week. Compared as a date rather than a moment, so the switch happens at midnight on
 *  Motzei Shabbos rather than at an exact tzais. */
export function currentSerial(serials) {
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const upcoming = serials.filter((s) => dateFromSerial(s).getTime() >= todayUtc);
  return upcoming.length ? Math.min(...upcoming) : Math.max(...serials);
}

/** Swipe across the week to page through it, the way a photo album works: drag left to
 *  bring the next week in, right for the previous one.
 *
 *  Read on touchend rather than followed on touchmove, because the page has to keep
 *  scrolling normally: the listeners are passive and nothing is prevented, so a vertical
 *  drag is an ordinary scroll and only a clearly sideways one counts. "Clearly" is 60px
 *  across and half again as far across as down, which leaves the diagonal drags that end
 *  a scroll alone.
 *
 *  The handlers hang off the container, which in the admin is the same element every
 *  render, so an old pair is taken off before a new one goes on. Left to stack, every
 *  swipe after the first would fire a whole history of stale handlers, each still holding
 *  the week it was rendered for. */
export function wireSwipe(container, onPrev, onNext) {
  container._weekSwipeOff?.();
  let startX = null;
  let startY = null;
  const start = (e) => {
    if (e.touches.length !== 1) return (startX = null);
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  };
  const end = (e) => {
    if (startX === null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    startX = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    (dx < 0 ? onNext : onPrev)();
  };
  container.addEventListener('touchstart', start, { passive: true });
  container.addEventListener('touchend', end, { passive: true });
  container._weekSwipeOff = () => {
    container.removeEventListener('touchstart', start);
    container.removeEventListener('touchend', end);
  };
}
