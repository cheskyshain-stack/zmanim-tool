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

/* The marks on the giving cards, drawn in the same weight as the menu's own and ringed in
   gold, so a card is recognisable before its title is read. */
const GIVE_ICONS = {
  shul: '<path d="M4.4 20.6V11l7.6-4.8 7.6 4.8v9.6"/><path d="M2.8 20.6h18.4"/><path d="M12 6.2V3.1M12 3.1h3l-1 1.2 1 1.2h-3"/><path d="M9.9 20.6v-3.9a2.1 2.1 0 0 1 4.2 0v3.9"/><path d="M7.4 12.6h.01M16.6 12.6h.01"/>',
  crane: '<path d="M6.4 20.6V4.4"/><path d="M4.2 20.6h4.4"/><path d="M6.4 6.6h13.4"/><path d="M6.4 4.4l3.2 2.2M6.4 4.4l-2.6 2.2"/><path d="M17.4 6.6v3.2"/><path d="M15.6 9.8h3.6l-1.8 2.4z"/><path d="M11 13.6h7.8v7h-7.8z" opacity="0.9"/>',
  /* The Donors' Fund's own mark: one unit is a broad crescent with a thin one tucked behind
     it, and the mark is that unit at 0, 120 and 240 degrees. Traced off the artwork the user
     supplied, since the container cannot reach thedonorsfund.org to take the real file: the
     gold was masked out of the picture, the six shapes separated, and the outline of one
     pair followed and simplified to within a pixel. Drawn once and turned, rather than all
     six traced, so the three units are exactly alike where the picture's were a few degrees
     out. If the real SVG turns up, replace these two strings with its paths. */
  swirl: [0, 120, 240].map((a) => [
    'M19.12 9.81L19.68 10.68L20.08 11.64L20.39 12.71L20.59 13.98L20.59 16.42L20.34 17.95L20.08 18.91L19.57 20.24L19.22 20.9L18.71 21.61L17.85 22.42L17.19 22.83L16.42 23.08L15.46 23.13L14.9 23.03L14.14 22.73L13.42 22.22L13.12 21.86L13.88 21.71L14.59 21.46L15.41 21.05L16.07 20.59L16.73 19.98L17.19 19.42L18.1 17.85L18.86 15.81L19.32 13.73L19.42 11.75L19.32 10.73Z',
    'M18.46 9.25L18.66 10.07L18.81 11.54L18.71 13.73L18.3 15.71L17.8 17.13L17.29 18.2L16.58 19.27L15.71 20.08L15.05 20.44L14.29 20.64L13.47 20.64L12.76 20.44L12 20.03L11.49 19.52L11.39 19.27L12.61 19.17L13.47 18.91L14.14 18.61L14.95 18.05L16.42 16.47L17.49 14.69L18.25 12.61L18.51 11.08Z',
  ].map((d) => `<path fill="currentColor" stroke="none" transform="rotate(${a} 12 12)" d="${d}"/>`).join('')).join(''),
  /* Zelle's own Z, the published glyph rather than a drawing of one: the outline from the
     simple-icons set, which takes it from zellepay.com and puts the icons under CC0. The
     name and the mark stay Zelle's; this is here to say which service the card means, which
     is what a payment mark is for. It fills the box top to bottom, so the size that suits
     the line icons leaves it looking shrunken. See .luach-give-mark-svg.is-brand. */
  zelle: '<path fill="currentColor" stroke="none" d="M13.559 24h-2.841a.483.483 0 0 1-.483-.483v-2.765H5.638a.667.667 0 0 1-.666-.666v-2.234a.67.67 0 0 1 .142-.412l8.139-10.382h-7.25a.667.667 0 0 1-.667-.667V3.914c0-.367.299-.666.666-.666h4.23V.483c0-.266.217-.483.483-.483h2.841c.266 0 .483.217.483.483v2.765h4.323c.367 0 .666.299.666.666v2.137a.67.67 0 0 1-.141.41l-8.19 10.481h7.665c.367 0 .666.299.666.666v2.477a.667.667 0 0 1-.666.667h-4.32v2.765a.483.483 0 0 1-.483.483Z"/>',
  heart: '<path d="M12 20.3s-7.6-4.6-7.6-9.7A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.6 3c0 5.1-7.6 9.7-7.6 9.7z"/>',
  building: '<path d="M5 21V5.4A1.4 1.4 0 0 1 6.4 4h11.2A1.4 1.4 0 0 1 19 5.4V21"/><path d="M3.2 21h17.6"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01"/><path d="M10.3 21v-4.2h3.4V21"/>',
  hand: '<path d="M3.4 13.6l3-1.2a3 3 0 0 1 2.2 0l2.6 1a2.4 2.4 0 0 0 .9.2h2.3a1.5 1.5 0 0 1 0 3h-3.6"/><path d="M3.4 13.6V20m0-1.4l4.2 1.6a3 3 0 0 0 1.8.1l8.2-2.2a1.9 1.9 0 0 0 1.4-1.8"/><path d="M14.6 9.6s-2.9-1.7-2.9-3.6a1.7 1.7 0 0 1 2.9-1.1 1.7 1.7 0 0 1 2.9 1.1c0 1.9-2.9 3.6-2.9 3.6z"/>',
  book: '<path d="M12 6.6C10.4 5.3 8.4 4.7 5 4.7A1 1 0 0 0 4 5.7v11.1a1 1 0 0 0 1 1c3.4 0 5.4.6 7 1.9 1.6-1.3 3.6-1.9 7-1.9a1 1 0 0 0 1-1V5.7a1 1 0 0 0-1-1c-3.4 0-5.4.6-7 1.9z"/><path d="M12 6.6V19.7"/>',
  send: '<path d="M20.6 3.4L10.4 13.6"/><path d="M20.6 3.4l-6.5 17.2-3.7-7-7-3.7z"/>',
  people: '<circle cx="9.2" cy="8.4" r="2.9"/><path d="M3.8 18.4a5.4 5.4 0 0 1 10.8 0"/><circle cx="17.4" cy="9.8" r="2.2"/><path d="M15.6 15.2a4 4 0 0 1 4.9 3.2"/>',
  drop: '<path d="M12 3.4s5.4 5.6 5.4 9.2a5.4 5.4 0 0 1-10.8 0C6.6 9 12 3.4 12 3.4z"/>',
  flame: '<path d="M12 21c3.3 0 5.6-2.1 5.6-5 0-4.2-4.4-5.6-3.6-9.6-2.4 1-3.6 3-3.6 5 0 1.4-.7 2-1.4 2s-1.3-.6-1.3-1.8C6.9 13 6.4 14.3 6.4 16c0 2.9 2.3 5 5.6 5z"/>',
  // Beside the host name over an embedded form. A form in a frame has no address bar of its
  // own, so this line is the only place a donor can see whose page they are typing into.
  lock: '<path d="M6.6 10.4h10.8a1.6 1.6 0 0 1 1.6 1.6v6.4a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 18.4V12a1.6 1.6 0 0 1 1.6-1.6Z"/><path d="M8.4 10.4V7.9a3.6 3.6 0 0 1 7.2 0v2.5"/>',
  // A card with its stripe. The one way on this page that is not a named service, so it is
  // drawn as the thing itself rather than as anybody's mark.
  card: '<path d="M4.4 5.6h15.2a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H4.4a2 2 0 0 1-2-2V7.6a2 2 0 0 1 2-2Z"/><path d="M2.4 10.2h19.2"/><path d="M6 14.6h3.4"/>',
  // The chevron on a closed drawer, which turns to point up when it opens.
  chev: '<path d="M6.4 9.6l5.6 5.4 5.6-5.4"/>',
};
const giveIcon = (key, cls) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GIVE_ICONS[key] || ''}</svg>`;

/** The ways to give, and the page that lists them.
 *
 *  Donate used to be one button that left the site for one payment page. There is more
 *  than one way to give and more than one thing to give to, so it opens a page of them
 *  instead, and this list is that page. Adding a way, or filling one in, is a line here.
 *
 *  Three ways to give, each a drawer that opens where it stands. Collapsed, a way is its
 *  mark, its name and a line saying what it is, so the whole page is three lines long and
 *  a donor picks before reading anything else. What is inside differs by way:
 *
 *  `accounts` is one or more payment pages, which is what the card and ACH way holds: the
 *  shul and the building fund bill through two separate merchant pages, so each is named
 *  and gets its own Donate. A `href` opens in a new tab if nothing wires it up, and
 *  wireDonateFrames catches the click and brings the form onto this page instead. The tab
 *  is the floor rather than the intent: this site can be installed to a home screen and run
 *  in a window with no address bar, and a payment page in there would have no URL and no
 *  padlock to check it by, so the frame carries the host name itself.
 *
 *  `funds` are what a payment page carries once it is reached, read off its own menus, so
 *  a donor can see whether what they want is behind a link without opening it and hunting.
 *  All of them are written out on one line and the line scrolls sideways where it does not
 *  fit, so the list is never folded and never has to be asked to open. No count is written
 *  anywhere either: a number saying how many there are would only be one more thing that
 *  could come to disagree with the names beside it.
 *
 *  `copy` is something to be typed into another app rather than somewhere to go, which is
 *  what Zelle and The Donors' Fund are: `label` says what it is and `value` is the thing
 *  itself, which gets a button that puts it on the clipboard, since this is read on a phone
 *  and the other app is a tap away. `how` is the sentence above it, for when handing over
 *  the value is not the whole of what somebody has to do. A way with nothing in it yet says
 *  its details are to follow, so the page says what exists rather than pretending it does
 *  not.
 */
const DONATE = {
  name: 'Donate',
  heading: 'Donation Options',
  thanks: 'Thank you for supporting Bais Medrash of Lakewood Commons.',
  ways: [
    {
      title: 'Credit/Debit Card \u00b7 ACH',
      blurb: 'Give securely online using your credit or debit card, or via ACH.',
      icon: 'card',
      accounts: [
        {
          title: 'Give to the Shul',
          blurb: 'Support the many needs of our shul and community.',
          href: 'https://secure.cardknox.com/bmoflakewoodcommons1',
          funds: [
            { label: 'Aliyos', icon: 'book' },
            { label: 'Membership', icon: 'people' },
            { label: 'Hall', icon: 'building' },
            { label: 'Mikva', icon: 'drop' },
            { label: 'Ner tamid', icon: 'flame' },
            { label: 'Rabbi Fendel\u2019s learning programs' },
            { label: 'Eiruv' },
            { label: 'Tzorchei Yom Tov' },
            { label: 'Ravs Fund' },
            { label: 'Kimcha Dpischa' },
            { label: 'Matanos Le\u2019evyonim' },
          ],
        },
        {
          title: 'Building Fund',
          blurb: 'Help build for the future of our community.',
          href: 'https://secure.cardknox.com/lckerenhabinyan',
          funds: [{ label: 'Eiruv', icon: 'crane' }, { label: 'Building Projects', icon: 'building' }],
        },
      ],
    },
    {
      title: 'Zelle',
      blurb: 'Give quickly and securely with Zelle.',
      icon: 'zelle',
      // Blank until the address is confirmed. One invented to fill the space would send
      // somebody's money somewhere, and that is not a thing to guess at.
      copy: { label: '', value: '' },
    },
    {
      // An outside donor-advised fund, not something the shul holds. Somebody with money
      // already in their own Donors' Fund account gives to the shul out of it, so the
      // words are about spending an account they have rather than opening one here.
      title: 'The Donors\u2019 Fund',
      blurb: 'Donate using funds from your Donors\u2019 Fund account.',
      icon: 'swirl',
      how: 'Search using our Tax ID.',
      copy: { label: 'Tax ID', value: '26-4527675' },
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
    <h1 class="luach-bar-title">${esc(title)}</h1>
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
      <h1 class="luach-masthead-name"><img class="luach-logo" src="/assets/logo-text-navy.png" alt="${esc(s.shulName)}"></h1>
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
/** One payment page inside the card and ACH drawer: its name, the funds it carries, and
 *  the button that opens it. Two of them, because the shul and the building fund bill
 *  through separate merchant pages and a donor has to land on the right one. */
function donateAccountHtml(acc) {
  const funds = acc.funds || [];
  const chip = (f) =>
    `<li class="luach-chip">${f.icon ? giveIcon(f.icon, 'luach-chip-icon') : ''}<span>${esc(f.label)}</span></li>`;
  /* Every fund on one line, and the line scrolls sideways where it does not fit. No fold
     and no More: the list is a glance at what is behind the link, and a glance should not
     need a press. What is cut off at the edge is the cue that there is more of it, which is
     how a row of anything scrollable says so. */
  const chips = funds.length
    ? `<ul class="luach-chips" tabindex="0" role="list" aria-label="${esc(acc.title)} funds">${funds.map(chip).join('')}</ul>`
    : '';
  return `<div class="luach-give-account">
    <h4 class="luach-account-title">${esc(acc.title)}</h4>
    ${acc.blurb ? `<p class="luach-account-blurb">${esc(acc.blurb)}</p>` : ''}
    ${chips}
    <a class="luach-give-go" href="${esc(acc.href)}" target="_blank" rel="noopener noreferrer">
      ${esc(acc.cta || DONATE.name)} <span aria-hidden="true">&rarr;</span>
    </a>
    <div class="luach-give-frame" hidden></div>
  </div>`;
}

/** A way to give, as a drawer.
 *
 *  A native details rather than a div and a click handler: it opens on Enter and Space,
 *  says whether it is open without being told to, and a browser that finds text inside a
 *  closed one opens it by itself. The name attribute is what makes the three exclusive
 *  where it is supported, and where it is not the only cost is two open at once.
 *
 *  Closed, every way is the same three things: mark, name, one line. That is the whole
 *  page, so the choice is made before anything else is read. */
function donateWayHtml(way) {
  const copy = way.copy
    ? (way.copy.value || way.copy.label
        ? `<p class="luach-copy">
            ${way.copy.label ? `<span class="luach-copy-label">${esc(way.copy.label)}:</span>` : ''}
            <span class="luach-copy-value">${esc(way.copy.value)}</span>
            ${way.copy.value ? `<button type="button" class="luach-copy-btn" data-copy="${esc(way.copy.value)}">Copy</button>` : ''}
          </p>`
        : '<p class="luach-copy luach-copy-soon">Details to follow</p>')
    : '';
  const how = way.how ? `<p class="luach-give-how">${esc(way.how)}</p>` : '';
  const accounts = (way.accounts || []).map(donateAccountHtml).join('');
  const soon = !accounts && !way.copy ? '<p class="luach-give-soon">Details to follow</p>' : '';
  /* Zelle and The Donors' Fund carry their own marks rather than a drawing of the idea, so
     a donor recognises the service before reading the title. Zelle keeps its purple, the
     one colour on this page that is not the site's own. Both are set larger than the line
     icons beside them: a logo drawn to fill its roundel looks shrunken at the size that
     suits a line drawing. */
  const brand = way.icon === 'zelle' || way.icon === 'swirl';
  const markClass = `luach-give-mark${way.icon === 'zelle' ? ' is-zelle' : ''}${brand ? ' is-brand' : ''}`;
  const mark = giveIcon(way.icon, `luach-give-mark-svg${brand ? ' is-brand' : ''}`);
  return `<details class="luach-give-card" name="luach-give">
    <summary class="luach-give-head">
      <span class="${markClass}" aria-hidden="true">${mark}</span>
      <div class="luach-give-body">
        <h3 class="luach-give-title">${esc(way.title)}</h3>
        <p class="luach-give-blurb">${esc(way.blurb)}</p>
      </div>
      ${giveIcon('chev', 'luach-give-chev')}
    </summary>
    <div class="luach-give-open">${how}${copy}${soon}${accounts}</div>
  </details>`;
}

/** Put a card's detail on the clipboard, since the app it is wanted in is a tap away.
 *
 *  Asked for twice over, the same as the week card's Copy text button: navigator.clipboard
 *  is refused outside a secure context and on some older phones, so the old hidden textarea
 *  is kept behind it. The result is said on the button rather than in an alert, and the
 *  value stays selectable text either way, so a phone that can do neither is not stuck. */
function wireDonateCopy(root) {
  for (const btn of root.querySelectorAll('.luach-copy-btn')) {
    btn.addEventListener('click', async () => {
      const said = btn.textContent;
      const text = btn.dataset.copy || '';
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const box = document.createElement('textarea');
          box.value = text;
          box.setAttribute('readonly', '');
          box.style.position = 'fixed';
          box.style.opacity = '0';
          document.body.appendChild(box);
          box.select();
          document.execCommand('copy');
          box.remove();
        }
        btn.textContent = 'Copied';
      } catch (err) {
        console.error('copy failed', err);
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => { btn.textContent = said; }, 2000);
    });
  }
}

/** The panel that holds a payment form, built when the button is first pressed.
 *
 *  The bar across the top is not decoration. A form inside a frame has no address bar of its
 *  own, and this site can be run from a home screen in a window that has no address bar
 *  either, so without this a donor has nothing to tell them whose page they are typing a
 *  card into. It names the host, and it keeps a way out to a real tab, which is also the
 *  answer if the form will not frame at all: a payment page is entitled to refuse to be
 *  embedded, and when one does the frame comes up blank with nothing to catch from here. */
function donateFrameHtml(href, label) {
  let host = '';
  try { host = new URL(href, location.href).host; } catch (err) { host = ''; }
  const out = `href="${esc(href)}" target="_blank" rel="noopener noreferrer"`;
  return `<div class="luach-frame-bar">
      <span class="luach-frame-where">${giveIcon('lock', 'luach-frame-lock')}${esc(host)}</span>
      <a class="luach-frame-out" ${out}>New tab <span aria-hidden="true">&#8599;</span></a>
      <button type="button" class="luach-frame-shut" aria-label="Close the donation form">&times;</button>
    </div>
    <iframe class="luach-frame" title="${esc(label)}" src="${esc(href)}" allow="payment"></iframe>
    <p class="luach-frame-help">Nothing showing? <a ${out}>Open the form in a new tab</a>.</p>`;
}

/** Bring the payment page onto this page rather than sending the donor to a tab.
 *
 *  The link is left as a link and its click intercepted, so this is the enhancement and the
 *  tab is the floor. A modified or middle click is left alone: someone asking for a tab
 *  outright should get one. Only one form is ever loaded, and closing empties the panel, so
 *  a card's form is not sitting live behind another card's. */
function wireDonateFrames(root) {
  const panels = [...root.querySelectorAll('.luach-give-frame')];
  const shut = (panel) => {
    panel.hidden = true;
    panel.innerHTML = '';
    const go = panel.closest('.luach-give-card').querySelector('.luach-give-go');
    if (go) go.setAttribute('aria-expanded', 'false');
  };
  for (const go of root.querySelectorAll('.luach-give-go')) {
    const card = go.closest('.luach-give-card');
    const panel = card && card.querySelector('.luach-give-frame');
    if (!panel) continue;
    go.setAttribute('aria-expanded', 'false');
    go.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      const opening = panel.hidden;
      for (const other of panels) if (other !== panel && !other.hidden) shut(other);
      if (!opening) { shut(panel); return; }
      const title = card.querySelector('.luach-give-title');
      panel.innerHTML = donateFrameHtml(go.href, `${title ? title.textContent.trim() : DONATE.name} donation form`);
      panel.hidden = false;
      go.setAttribute('aria-expanded', 'true');
      panel.querySelector('.luach-frame-shut').addEventListener('click', () => { shut(panel); go.focus(); });
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

function renderDonatePage(published) {
  stopNextUp();
  const s = resolveSettings(published.settings);
  // is-give only trims the room under the address, which the page has no use for: it ends
  // at the footer and there is nothing below to scroll to. See app.css.
  main.className = 'is-give';
  /* The shul's own masthead and address, the same two the menu carries, so a donor who
     lands here from a message rather than from the menu is looking at the shul's page and
     not at an anonymous list of payment links. Written out rather than shared with
     homeHtml: the menu's masthead sits under an empty navy cap and this one sits under the
     back bar, and the two want different room above them.

     One rule, in the masthead, exactly as on the menu. The heading below it carried its own
     before, and with the masthead in front that read as two lines ruled off from nothing. */
  main.innerHTML = `${backBar(PAGE_NAMES.donate)}
    <div class="luach-home luach-give-page">
      <header class="luach-masthead luach-give-masthead">
        <!-- The wordmark is not a heading here, the way it is on the menu: the bar above
             already carries this page's h1 and names it "Donate". Two h1s on one page is
             one too many, and the shul's name is the site's mark rather than the title of
             what is on the page. The alt text still says whose site it is. -->
        <img class="luach-logo" src="/assets/logo-text-navy.png" alt="${esc(s.shulName)}">
        ${s.headerSubtitle ? `${rule()}<p class="luach-place">${esc(s.headerSubtitle)}</p>` : ''}
      </header>
      <header class="luach-give-head-block">
        <h2 class="luach-give-heading">${esc(DONATE.heading)}</h2>
        <p class="luach-give-thanks">${esc(DONATE.thanks)}</p>
      </header>
      ${DONATE.ways.map(donateWayHtml).join('')}
      ${rule()}
      <p class="luach-foot">${esc(s.footerAddress)}</p>
    </div>`;
  wireDonateFrames(main);
  wireDonateCopy(main);
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
