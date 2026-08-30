// Small pieces of navigation that more than one view needs.
//
// Their own module because they are all the two views share: with them inside week-view
// the chart view had to import it, and week-view imports the chart view to put the chart
// under the cards - a cycle, which ES modules tolerate but build-offline.py cannot order
// into one flat script.
import { dateFromSerial, shulNow } from '../zmanim/solar.js';


/** The week the congregation should be looking at: the first one not yet finished.
 *
 *  A week is finished five minutes after the last מנין printed on it, which on a שבת card
 *  is the last מעריב of מוצאי שבת. That is the moment nothing on the card is still to
 *  happen, and from then on what somebody opening the page wants is the week ahead. It is a
 *  few hours earlier than the midnight this used to wait for, and those few hours are the
 *  emptiest on the board.
 *
 *  `endsAt(serial)` gives that moment as minutes after midnight on the week's own Shabbos,
 *  and is passed in rather than worked out here: it has to read the week's printed times,
 *  which means the sheets, the rules and the overrides, and nothing else this module does
 *  needs any of that. Without it there is nothing to read, so it falls back to the calendar
 *  day and rolls at midnight, which is what it always did. */
export function currentSerial(serials, settings = null, endsAt = null) {
  const now = new Date();
  if (settings && endsAt) {
    const { serial: today, mins } = shulNow(now, settings);
    const over = (s) => s < today || (s === today && mins >= endsAt(s));
    const ahead = serials.filter((s) => !over(s));
    return ahead.length ? Math.min(...ahead) : Math.max(...serials);
  }
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
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

/** The way between the congregation's site and the admin app: three taps, in the navy at
 *  the top, and nothing on the screen to say so.
 *
 *  There is no link between the two anywhere, on purpose. The congregation's page should
 *  not offer a door into the generator, and the generator has no reason to advertise the
 *  page it publishes to. But whoever runs both needs to get from one to the other on a
 *  phone without typing a URL, so the navy carries a gesture nobody arrives at by
 *  accident: three taps inside three quarters of a second.
 *
 *  A tap that lands on something that already does something, the way back to the menu or
 *  a button, belongs to that thing and resets the count. And the run has to be unbroken:
 *  a pause longer than the window starts again from one, so three taps spread over a
 *  minute of ordinary use never add up to a door opening.
 *
 *  Off under file://, where the offline copy runs: there is no site root there to go to,
 *  and an absolute path would resolve against the root of the disk. */
export function wireSecretDoor(el, href, taps = 3, withinMs = 750) {
  if (!el || !/^https?:$/.test(location.protocol)) return;
  wireSecretTaps(el, () => { location.href = href; }, taps, withinMs);
}

/** The counting behind the door above, on its own so the same gesture can open something
 *  other than a URL. Same rules, and they are the rules that make it safe to hide a thing
 *  behind: a tap on something that already does something belongs to that thing and resets
 *  the count, and the run has to be unbroken, so three taps spread over a minute of
 *  ordinary reading never add up to anything. */
export function wireSecretTaps(el, onOpen, taps = 3, withinMs = 750) {
  if (!el) return;
  let run = 0;
  let last = 0;
  el.addEventListener('click', (event) => {
    if (event.target.closest('a, button, input, select, textarea, summary, label')) {
      run = 0;
      return;
    }
    const now = Date.now();
    run = now - last > withinMs ? 1 : run + 1;
    last = now;
    if (run < taps) return;
    run = 0;
    onOpen();
  });
}

/* Whether the congregation's page has been let out of the week it is showing.
 *
 * The published charts hold a season at a time, but the congregation is being shown the
 * sheet that is on the wall, and paging off it to a chart from two months ago or two
 * months ahead is not what that page is for. So on that site the views are held to the
 * chart covering now: the week view can move between the weeks printed on it and stops at
 * its first and last, and the chart view has nowhere to go at all, there being one chart.
 *
 * Whoever runs the place still needs the rest of it on a phone, so three taps on the chart
 * opens it, the same gesture and for the same reason as the door into the admin app above.
 *
 * In memory only, and deliberately: it lasts as long as the page is open and no longer, so
 * nothing is written to anybody's phone and a congregant who stumbles on it has an
 * ordinary page again the moment they come back. */
let navIsUnlocked = false;
export function navUnlocked() {
  return navIsUnlocked;
}
export function unlockNav() {
  navIsUnlocked = true;
}
