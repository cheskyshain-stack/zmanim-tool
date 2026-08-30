// The congregation's site, which is the front door: lczmanim.cjaffa.com. The admin app
// lives at /admin and none of it is loaded here.
//
// Everything shown comes from /data/published.json, because a visitor's browser has none
// of the admin app's saved sheets. Until a season is published there is nothing to show,
// which the page says plainly rather than looking broken.
//
// Where it goes is in the URL hash (#week, #chart), so the browser's back button works
// and a page can be linked to directly, with no server configuration to arrange.
import { loadPublished } from './publish.js';
import { resolveSettings } from './settings.js';
import { nextMinyan, todaysCandleLighting, clock, meridiem, howFar } from './upcoming.js';
import { wireSecretDoor } from './ui/nav-helpers.js';
import { renderWeek } from './ui/week-view.js';
import { renderChartBrowser } from './ui/chart-view.js';

const main = document.getElementById('main');


/* The two marks on the menu, and the chevron on the end of each. The clock goes on the
   week, which is a list of times, and the calendar on the chart, which is the whole
   season laid out by date. Inline rather than image files: they are three small shapes,
   they take their colour from the text beside them, and a file each would be three more
   things to fetch on a page whose whole point is opening fast on a phone. aria-hidden
   because the words beside them already say it. */
const ICON_CALENDAR = `<svg class="luach-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
  <rect x="3" y="5" width="18" height="16" rx="2.6"/><path d="M8 2.6v4M16 2.6v4M3 10h18"/>
  <path d="M7.6 13.6h.01M12 13.6h.01M16.4 13.6h.01M7.6 17.4h.01M12 17.4h.01M16.4 17.4h.01" stroke-width="2.3"/>
</svg>`;
const ICON_CLOCK = `<svg class="luach-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12" r="9.1"/><path d="M12 6.6v5.7l3.6 2.1"/>
</svg>`;
const ICON_HEART = `<svg class="luach-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 20.3s-7.6-4.6-7.6-9.7A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.6 3c0 5.1-7.6 9.7-7.6 9.7z"/>
</svg>`;
const CHEVRON = `<svg class="luach-item-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5l7.5 7.5L9 19.5"/></svg>`;
/* An arrow leaving a box rather than the chevron the other two carry. A chevron says the
   site goes on somewhere; this one leaves the site altogether, and the mark should say so
   before it is pressed rather than after. */
const OUTWARD = `<svg class="luach-item-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M14 4.5h5.5V10M19.5 4.5l-8 8M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>
</svg>`;

/** The two things this site offers, named once.
 *
 *  The button on the menu and the bar at the top of the page it opens say the same words,
 *  so pressing one lands somewhere that confirms what you pressed. They used to disagree:
 *  Weekly Zmanim opened a page headed "This week's schedule" and Zmanim chart opened one
 *  headed "The chart", which is two names for each of two things on a site that only has
 *  two things. Written here rather than in both places, so they cannot drift apart again. */
const PAGE_NAMES = { week: 'Weekly Zmanim', chart: 'Zmanim chart', donate: 'Donate' };

/** The ways to give, and the page that lists them.
 *
 *  Donate used to be one button that left the site for one payment page. There is more
 *  than one way to give and more than one thing to give to, so it opens a page of them
 *  instead, and this list is that page. Adding a way, or filling one in, is a line here
 *  and nothing else.
 *
 *  Two kinds of entry:
 *
 *  A `href` is somewhere to go, and it opens in a new tab on purpose. Someone reading the
 *  zmanim keeps the page they were on, and, more to the point, this site can be installed
 *  to a home screen and run in a window with no address bar: sent to a payment page inside
 *  that window there would be no URL and no padlock to check it by. A new tab is a real
 *  browser, with both.
 *
 *  A `detail` is something to copy rather than somewhere to go, which is what Zelle and
 *  the rest are: an address or a number typed into another app. Left empty until the
 *  details arrive, and an empty one still lists its name, so the page says what exists
 *  rather than pretending it does not.
 *
 *  `note` is the smaller line under a title, for what a link covers once it is reached. */
/* The marks on the giving cards, drawn in the same weight as the menu's own and ringed in
   gold, so a card is recognisable before its title is read. */
const GIVE_ICONS = {
  shul: '<path d="M4.4 20.6V11l7.6-4.8 7.6 4.8v9.6"/><path d="M2.8 20.6h18.4"/><path d="M12 6.2V3.1M12 3.1h3l-1 1.2 1 1.2h-3"/><path d="M9.9 20.6v-3.9a2.1 2.1 0 0 1 4.2 0v3.9"/><path d="M7.4 12.6h.01M16.6 12.6h.01"/>',
  crane: '<path d="M6.4 20.6V4.4"/><path d="M4.2 20.6h4.4"/><path d="M6.4 6.6h13.4"/><path d="M6.4 4.4l3.2 2.2M6.4 4.4l-2.6 2.2"/><path d="M17.4 6.6v3.2"/><path d="M15.6 9.8h3.6l-1.8 2.4z"/><path d="M11 13.6h7.8v7h-7.8z" opacity="0.9"/>',
  swirl: '<path d="M12 4.2a7.8 7.8 0 0 1 5.7 13.1c-1.4 1.4-3.6.4-3.1-1.5"/><path d="M19.2 14.7A7.8 7.8 0 0 1 6.2 18c-1.3-1.5-.1-3.6 1.7-2.9"/><path d="M6.9 18.6A7.8 7.8 0 0 1 8.4 5.4c1.8-.7 3.4 1 2.3 2.5"/>',
  heart: '<path d="M12 20.3s-7.6-4.6-7.6-9.7A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.6 3c0 5.1-7.6 9.7-7.6 9.7z"/>',
  building: '<path d="M5 21V5.4A1.4 1.4 0 0 1 6.4 4h11.2A1.4 1.4 0 0 1 19 5.4V21"/><path d="M3.2 21h17.6"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01"/><path d="M10.3 21v-4.2h3.4V21"/>',
  hand: '<path d="M3.4 13.6l3-1.2a3 3 0 0 1 2.2 0l2.6 1a2.4 2.4 0 0 0 .9.2h2.3a1.5 1.5 0 0 1 0 3h-3.6"/><path d="M3.4 13.6V20m0-1.4l4.2 1.6a3 3 0 0 0 1.8.1l8.2-2.2a1.9 1.9 0 0 0 1.4-1.8"/><path d="M14.6 9.6s-2.9-1.7-2.9-3.6a1.7 1.7 0 0 1 2.9-1.1 1.7 1.7 0 0 1 2.9 1.1c0 1.9-2.9 3.6-2.9 3.6z"/>',
  book: '<path d="M12 6.6C10.4 5.3 8.4 4.7 5 4.7A1 1 0 0 0 4 5.7v11.1a1 1 0 0 0 1 1c3.4 0 5.4.6 7 1.9 1.6-1.3 3.6-1.9 7-1.9a1 1 0 0 0 1-1V5.7a1 1 0 0 0-1-1c-3.4 0-5.4.6-7 1.9z"/><path d="M12 6.6V19.7"/>',
  send: '<path d="M20.6 3.4L10.4 13.6"/><path d="M20.6 3.4l-6.5 17.2-3.7-7-7-3.7z"/>',
  people: '<circle cx="9.2" cy="8.4" r="2.9"/><path d="M3.8 18.4a5.4 5.4 0 0 1 10.8 0"/><circle cx="17.4" cy="9.8" r="2.2"/><path d="M15.6 15.2a4 4 0 0 1 4.9 3.2"/>',
  drop: '<path d="M12 3.4s5.4 5.6 5.4 9.2a5.4 5.4 0 0 1-10.8 0C6.6 9 12 3.4 12 3.4z"/>',
  flame: '<path d="M12 21c3.3 0 5.6-2.1 5.6-5 0-4.2-4.4-5.6-3.6-9.6-2.4 1-3.6 3-3.6 5 0 1.4-.7 2-1.4 2s-1.3-.6-1.3-1.8C6.9 13 6.4 14.3 6.4 16c0 2.9 2.3 5 5.6 5z"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
};
const giveIcon = (key, cls) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GIVE_ICONS[key] || ''}</svg>`;

/** The ways to give, and the page that lists them.
 *
 *  Donate used to be one button that left the site for one payment page. There is more
 *  than one way to give and more than one thing to give to, so it opens a page of them
 *  instead, and this list is that page. Adding a way, or filling one in, is a line here.
 *
 *  `href` is somewhere to go, and it opens in a new tab on purpose. Someone reading the
 *  zmanim keeps the page they were on, and, more to the point, this site can be installed
 *  to a home screen and run in a window with no address bar: sent to a payment page inside
 *  that window there would be no URL and no padlock to check it by. A new tab is a real
 *  browser, with both.
 *
 *  `funds` are what that page carries once it is reached, read off its own two menus, so a
 *  donor can see whether what they want is behind a link without opening it and hunting.
 *  `show` is how many are named on the card before the rest become "More"; the count in
 *  "View all N options" is the length of the list rather than a number typed here, so it
 *  cannot come to disagree with the chips beside it.
 *
 *  `copy` is something to be typed into another app rather than somewhere to go, which is
 *  what Zelle is. A way with neither href nor copy still lists its name and says its
 *  details are to follow, so the page says what exists rather than pretending it does not.
 */
const DONATE = {
  name: 'Donate',
  heading: 'Ways to Give',
  thanks: 'Thank you for supporting Bais Medrash Lakewood Commons.',
  ways: [
    {
      title: 'Give to the Shul',
      blurb: 'Support the many needs of our shul and community.',
      icon: 'shul',
      href: 'https://secure.cardknox.com/bmoflakewoodcommons1',
      show: 5,
      funds: [
        { label: 'Aliyos', icon: 'book' },
        { label: 'Membership', icon: 'people' },
        { label: 'Hall', icon: 'building' },
        { label: 'Mikva', icon: 'drop' },
        { label: 'Ner tamid', icon: 'flame' },
        { label: 'Rabbi Fendel’s learning programs' },
        { label: 'Eiruv' },
        { label: 'Tzorchei Yom Tov' },
        { label: 'Ravs Fund' },
        { label: 'Kimcha Dpischa' },
        { label: 'Matanos Le’evyonim' },
      ],
    },
    {
      title: 'Building Fund',
      blurb: 'Help build for the future of our community.',
      icon: 'crane',
      href: 'https://secure.cardknox.com/lckerenhabinyan',
      funds: [{ label: 'Eiruv' }, { label: 'Building Projects' }, { label: 'Other' }],
    },
    {
      title: 'Give with Zelle',
      blurb: 'Give quickly and securely with Zelle.',
      icon: 'zelle',
      cta: 'Give with Zelle',
      // Blank until the address is confirmed. One invented to fill the space would send
      // somebody's money somewhere, and that is not a thing to guess at.
      copy: { address: '', name: '' },
    },
    {
      title: 'The Donors’ Fund',
      blurb: 'Donate using funds from your Donors’ Fund account.',
      icon: 'swirl',
      cta: 'Give through Donors’ Fund',
    },
    {
      title: 'Daf Yomi Initiative',
      blurb: 'Support the daily learning of Daf Yomi and the growth of Torah in our community.',
      icon: 'book',
    },
  ],
};

/** A gold hairline with a diamond in the middle. Decoration, so it says nothing to a
 *  screen reader. */
const rule = () => '<div class="luach-rule" aria-hidden="true"><i></i></div>';

/* The two marks on the "what is on next" boxes. A minyan is people, and הדלקת נרות is
   candles: both are drawn in the same line weight as the menu's own marks and take their
   colour from the box they sit in. */
const ICON_MINYAN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="8.4" r="2.9"/><path d="M6.6 18.4a5.4 5.4 0 0 1 10.8 0"/>
  <circle cx="4.4" cy="10.6" r="2"/><path d="M1.6 17.4a3 3 0 0 1 3.4-2.9"/>
  <circle cx="19.6" cy="10.6" r="2"/><path d="M22.4 17.4a3 3 0 0 0-3.4-2.9"/>
</svg>`;
const ICON_CANDLES = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 6.2c0-1.6 1.4-2.4 1.4-3.9 1.3 1 1.9 2.3 1.9 3.9a1.65 1.65 0 0 1-3.3 0z" fill="currentColor" stroke="none"/>
  <path d="M15.4 8.1c0-1.3 1.1-2 1.1-3.2 1.1.8 1.6 1.9 1.6 3.2a1.35 1.35 0 0 1-2.7 0z" fill="currentColor" stroke="none"/>
  <path d="M8.6 9.4h3.4v10.2H8.6zM15.1 11.3h3.3v8.3h-3.3z"/>
  <path d="M5.4 19.6h13.6"/>
</svg>`;
/* The little hourglass before "in 27 minutes". */
const ICON_WAIT = `<svg class="luach-next-wait" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M7 3h10M7 21h10M7 3c0 4.5 5 5.6 5 9 0-3.4 5-4.5 5-9M7 21c0-4.5 5-5.6 5-9 0 3.4 5 4.5 5 9"/>
</svg>`;

/** What is on next: the next מנין, and on an Erev Shabbos הדלקת נרות beside it.
 *
 *  The first thing on the page, because it is the one question the site is opened to
 *  answer most of the time. Everything it says comes out of upcoming.js, which reads the
 *  published charts rather than working the times out again, so this can never quote a
 *  time the week's own page disagrees with.
 *
 *  One box on most days and two on a Friday, which is why they are a wrapping row rather
 *  than a fixed pair: alone, a box takes the whole width; together they share it, and on a
 *  narrow enough phone they stack instead of being squeezed.
 *
 *  Either box can be missing. Past the end of what has been published there is no מנין
 *  left to name, and הדלקת נרות only ever appears on a Friday. Nothing is drawn at all
 *  rather than a box with a dash in it.
 *
 *  aria-live, so that when the card redraws itself on the timer a screen reader is told
 *  what changed instead of the page silently becoming something else. */
function nextUpState(published, settings) {
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  const now = new Date();
  // A chart that cannot be read must not take the page down with it: the menu below is
  // the point of this screen and it works whether or not this card has anything to say.
  const safely = (fn) => { try { return fn(); } catch { return null; } };
  return [
    safely(() => nextMinyan(now, state, settings)),
    safely(() => todaysCandleLighting(now, state, settings)),
  ];
}

function nextUpHtml([minyan, candles]) {
  if (!minyan && !candles) return '';

  // The name, the room and the time are three siblings rather than the name and the room
  // being one lump, because the row they sit in runs right to left and each of them has to
  // take its own place in that order: שחרית, then למטה, then the time. The mark is outside
  // that row, so it keeps the left-hand end whichever way the words run.
  const box = (kind, icon, item, tone) => {
    if (!item) return '';
    const when = howFar(item);
    return `<div class="luach-next-box ${tone}">
      <p class="luach-next-head">${esc(kind)}</p>
      <div class="luach-next-body">
        <span class="luach-next-mark" aria-hidden="true">${icon}</span>
        <div class="luach-next-main">
          <bdi class="luach-next-what">${esc(item.name)}</bdi>
          ${item.place ? `<bdi class="luach-next-where">${esc(item.place)}</bdi>` : ''}
          <span class="luach-next-time">${esc(clock(item.mins))}<small>${esc(meridiem(item.mins))}</small></span>
        </div>
      </div>
      ${when ? `<p class="luach-next-when">${ICON_WAIT}${esc(when)}</p>` : ''}
    </div>`;
  };
  return `<div class="luach-next" aria-live="polite">
    ${box('Next minyan', ICON_MINYAN, minyan, 'is-minyan')}${box('Candle lighting', ICON_CANDLES, candles, 'is-candles')}
  </div>`;
}

/** The navy cap at the top of every screen here, curved and edged in gold. It carries
 *  nothing on the menu and the way back on the pages behind it, so that going in and
 *  coming out look like one site. */
function backBar(title) {
  return `<div class="luach-bar no-print">
    <a class="luach-back" href="#">&larr; Menu</a>
    <span class="luach-bar-title">${esc(title)}</span>
  </div>`;
}

/** The masthead is a sibling of the menu rather than sitting inside it, so that its navy
 *  band reaches both edges of the window the way the band on the pages behind it does. In
 *  the middle of the centred column it stopped at the column's own 34rem and read as a
 *  navy card floating in the page: measured at 1280px, it ran 352 to 928 instead of 0 to
 *  1280. On a phone the two are the same thing, which is how it went unnoticed. */
function homeHtml(published) {
  const s = published.settings;
  return `<div class="luach-bar luach-bar-plain no-print" aria-hidden="true"></div>
    <header class="luach-masthead">
      <img class="luach-logo" src="/assets/logo-text-navy.png" alt="${esc(s.shulName)}">
      ${s.headerSubtitle ? `${rule()}<p class="luach-place">${esc(s.headerSubtitle)}</p>` : ''}
    </header>
    <div class="luach-home">
    ${nextUpHtml(nextUpState(published, resolveSettings(published.settings)))}
    <nav class="luach-menu">
      <a class="luach-item" href="#week">
        ${ICON_CLOCK}<span class="luach-item-title">${esc(PAGE_NAMES.week)}</span>${CHEVRON}
      </a>
      <a class="luach-item" href="#chart">
        ${ICON_CALENDAR}<span class="luach-item-title">${esc(PAGE_NAMES.chart)}</span>${CHEVRON}
      </a>
      <a class="luach-item" href="#donate">
        ${ICON_HEART}<span class="luach-item-title">${esc(DONATE.name)}</span>${CHEVRON}
      </a>
    </nav>
    ${rule()}
    <p class="luach-foot">${esc(s.footerAddress)}</p>
  </div>`;
}

/** When the card next needs redrawing: the moment the number on it changes.
 *
 *  howFar rounds the minutes up, so a מנין 25 minutes and 7 seconds off reads "in 26
 *  minutes" and becomes "in 25" in 7 seconds' time, not in 30. Waiting a fixed half minute
 *  meant the change landed up to half a minute late and never twice in the same place;
 *  waiting exactly the remainder puts every change on the second it is true, and every one
 *  after it a minute apart.
 *
 *  The fraction of a minute still to run is the wait, except when there is none left,
 *  which is the boundary itself and means a whole minute to the next one. Where the card
 *  shows two boxes it is the earlier of the two that decides. It can never be more than a
 *  minute, so nothing here needs a ceiling, and the floor is for a timer that fires a
 *  hair early: rather than redraw in three milliseconds and again straight after, it
 *  waits a moment and lands the far side of the boundary. */
function untilNextChange(items) {
  const waits = items.filter(Boolean).map((item) => {
    const left = item.in - Math.floor(item.in);
    return (left === 0 ? 1 : left) * 60000;
  });
  return waits.length ? Math.max(250, Math.min(...waits)) : 60000;
}

/** Keeps the "what is on next" card honest on a page nobody has closed.
 *
 *  Two things drive it, and the second is the one that matters on a phone.
 *
 *  A timer that is re-set after every redraw for exactly as long as the number showing has
 *  left to live (see untilNextChange), for a page somebody is looking at. It is also less
 *  work than the fixed half minute it replaced: at most one redraw a minute instead of two,
 *  and each one actually changes something.
 *
 *  And the moment the page comes back, because a phone stops running timers for a page
 *  that is not on the screen. Lock the phone or switch apps and the timer stops; come back
 *  and the card is still showing the count from whenever you left, which is exactly what
 *  was reported: it said "in 25 minutes" long after those minutes had gone, and only a
 *  refresh put it right. visibilitychange covers the screen going off and the app being
 *  switched away from, pageshow covers coming back through the browser's back button, when
 *  the whole page is restored from a cache rather than run again, and focus covers a
 *  desktop window being clicked back into. All three can fire for one return, which is
 *  harmless: drawing the same card twice looks like drawing it once.
 *
 *  Only the card is redrawn, never the menu, so a finger already on its way to Weekly
 *  Zmanim does not have the button rebuilt underneath it. */
let nextUpTimer = null;
let nextUpWake = null;
function stopNextUp() {
  clearTimeout(nextUpTimer);
  nextUpTimer = null;
  if (nextUpWake) {
    document.removeEventListener('visibilitychange', nextUpWake);
    window.removeEventListener('pageshow', nextUpWake);
    window.removeEventListener('focus', nextUpWake);
    nextUpWake = null;
  }
}

function startNextUp(published) {
  stopNextUp();
  const settings = resolveSettings(published.settings);
  const draw = () => {
    // The menu, not the card, is what says we are still on this page. Watching for the
    // card instead meant a day with no schedule stopped the clock for good: there is no
    // card to find on such a day, the first tick took that for having left the page, and
    // the card could not come back when midnight rolled into a day that has one.
    const home = main.querySelector('.luach-home');
    if (!home) return stopNextUp(); // the page moved on
    const items = nextUpState(published, settings);
    const html = nextUpHtml(items);
    const card = home.querySelector('.luach-next');
    // Replaced rather than written into, so a card that has just become empty (or has
    // just gained a box it did not have) comes out right either way, and put back at the
    // top of the menu when there was none at all.
    if (card) card.outerHTML = html || '';
    else if (html) home.insertAdjacentHTML('afterbegin', html);
    clearTimeout(nextUpTimer);
    nextUpTimer = setTimeout(draw, untilNextChange(items));
  };
  nextUpTimer = setTimeout(draw, untilNextChange(nextUpState(published, settings)));
  nextUpWake = () => {
    // visibilitychange fires on the way out as well as on the way back.
    if (document.visibilityState === 'hidden') return;
    draw();
  };
  document.addEventListener('visibilitychange', nextUpWake);
  window.addEventListener('pageshow', nextUpWake);
  window.addEventListener('focus', nextUpWake);
}

function renderHome(published) {
  // The menu, and only the menu, is laid out to fill the screen (see is-home in app.css).
  // The pages behind it are as tall as the board on them and must not be stretched.
  main.className = 'is-home';
  main.innerHTML = homeHtml(published);
  openTheDoor();
  startNextUp(published);
}

/** Three taps in the navy cap go to the generator. Wired after every render, since each
 *  one builds a new cap. */
function openTheDoor() {
  wireSecretDoor(main.querySelector('.luach-bar'), '/admin/');
}

function renderWeekPage(published) {
  stopNextUp();
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  let serial = null;
  const draw = () => {
    main.className = '';
    main.innerHTML = backBar(PAGE_NAMES.week) + '<div id="week-host"></div>';
    openTheDoor();
    renderWeek(
      main.querySelector('#week-host'),
      state,
      (next) => {
        serial = next;
        draw();
      },
      serial,
      { luach: true }
    );
  };
  draw();
}

function renderChartPage(published) {
  stopNextUp();
  const state = { settings: published.settings, sheets: published.sheets, rules: published.rules || [] };
  main.className = '';
  main.innerHTML = backBar(PAGE_NAMES.chart) + '<div id="chart-host"></div>';
  openTheDoor();
  // confine: the congregation is shown the chart that is up now and no other. Three taps
  // on the chart itself opens the rest, which is also what lets the week view out of the
  // weeks printed on this one. See navUnlocked in ui/nav-helpers.js.
  renderChartBrowser(main.querySelector('#chart-host'), state, { confine: true });
}

/** The ways to give, one card each.
 *
 *  The same card the menu uses, so the page reads as part of the site rather than as a
 *  form bolted to it: a link carries the outward arrow the menu's own outward link used
 *  to, and something to copy carries no arrow at all, because nothing happens when it is
 *  pressed. A way whose details have not arrived yet says so in the smaller type, which is
 *  the honest thing to put there and disappears the moment the line above it is filled in.
 *
 *  Nothing is rendered from published data here, so this page works whatever is or is not
 *  on the site, which is the point: giving should not depend on there being a chart up. */
/** One way to give.
 *
 *  The card is a card rather than a link, because more than one thing on it can be
 *  pressed: the funds it covers, the whole list of them, and Donate itself. A card that
 *  was one big link could hold only one of those.
 *
 *  The chips are the funds, named. They are not links and not buttons: the page they lead
 *  to asks which fund in a menu of its own, so a chip that looked pressable would promise
 *  to choose for you and then not. They are there to answer "is the thing I want in here",
 *  which is the question somebody has before they press Donate.
 *
 *  A way with nowhere to go yet carries no Donate button. A button that did nothing would
 *  be worse than the line saying its details are still to come. */
function donateWayHtml(way) {
  const shown = way.funds ? way.funds.slice(0, way.show || way.funds.length) : [];
  const rest = way.funds ? way.funds.length - shown.length : 0;
  const chip = (f) =>
    `<li class="luach-chip">${f.icon ? giveIcon(f.icon, 'luach-chip-icon') : ''}<span>${esc(f.label)}</span></li>`;
  const chips = shown.length
    ? `<ul class="luach-chips${shown.some((f) => f.icon) ? ' is-tall' : ''}">
        ${shown.map(chip).join('')}
        ${rest ? `<li class="luach-chip">${giveIcon('more', 'luach-chip-icon')}<span>More</span></li>` : ''}
      </ul>`
    : '';
  // Only where some are hidden: with every fund already named, "View all" would lead to
  // exactly what is on the screen.
  const all = rest && way.href
    ? `<a class="luach-give-all" href="${esc(way.href)}" target="_blank" rel="noopener noreferrer">View all ${way.funds.length} options <span aria-hidden="true">&rarr;</span></a>`
    : '';
  const copy = way.copy
    ? (way.copy.address || way.copy.name
        ? `<p class="luach-copy"><span class="luach-copy-address">${esc(way.copy.address)}</span><span class="luach-copy-name">${esc(way.copy.name)}</span></p>`
        : '<p class="luach-copy luach-copy-soon">Details to follow</p>')
    : '';
  const soon = !way.href && !way.copy ? '<p class="luach-give-soon">Details to follow</p>' : '';
  const button = way.href
    ? `<a class="luach-give-go" href="${esc(way.href)}" target="_blank" rel="noopener noreferrer">
        ${esc(way.cta || DONATE.name)} <span aria-hidden="true">&rarr;</span>
      </a>`
    : '';
  // Zelle's mark is its own, in its own colour, because that is what makes it recognisable
  // as Zelle at a glance. Every other mark is the site's gold.
  const markClass = way.icon === 'zelle' ? 'luach-give-mark is-zelle' : 'luach-give-mark';
  const mark = way.icon === 'zelle' ? '<span class="luach-zelle-z">Z</span>' : giveIcon(way.icon, 'luach-give-mark-svg');
  return `<section class="luach-give-card">
    <span class="${markClass}" aria-hidden="true">${mark}</span>
    <div class="luach-give-body">
      <h2 class="luach-give-title">${esc(way.title)}</h2>
      <p class="luach-give-blurb">${esc(way.blurb)}</p>
      ${chips}${copy}${soon}${all}
    </div>
    ${button}
  </section>`;
}

function renderDonatePage(published) {
  stopNextUp();
  const s = resolveSettings(published.settings);
  main.className = '';
  main.innerHTML = `${backBar(PAGE_NAMES.donate)}
    <div class="luach-home luach-give-page">
      <header class="luach-give-head">
        ${rule()}
        <h1 class="luach-give-heading">${esc(DONATE.heading)}</h1>
        <p class="luach-give-thanks">${esc(DONATE.thanks)}</p>
      </header>
      ${DONATE.ways.map(donateWayHtml).join('')}
      ${rule()}
      <p class="luach-foot">
        <span class="luach-foot-mark" aria-hidden="true">${giveIcon('shul', 'luach-foot-svg')}</span>
        ${esc(s.footerAddress)}
      </p>
    </div>`;
  openTheDoor();
}

function route(published) {
  const where = location.hash.replace('#', '');
  if (where === 'week') return renderWeekPage(published);
  if (where === 'chart') return renderChartPage(published);
  if (where === 'donate') return renderDonatePage(published);
  return renderHome(published);
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

(async () => {
  const published = await loadPublished();
  if (!published) {
    main.innerHTML = '<div class="luach-home"><p class="hint">Nothing has been published yet.</p></div>';
    return;
  }
  route(published);
  window.addEventListener('hashchange', () => route(published));
})();
