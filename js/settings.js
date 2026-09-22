// Settings model, mirroring the workbook's SETTINGS sheet. Stored in a clean,
// serializable "raw" shape; resolveSettings() expands it into the shape the
// zmanim/hebrew-calendar engine expects (timezone object, english/inIsrael flags).

export const TIMEZONES = [
  { id: 'America/New_York', label: 'America/New_York (Eastern)', utcOffset: -5, dstOffset: 1, rule: 'us' },
  { id: 'America/Chicago', label: 'America/Chicago (Central)', utcOffset: -6, dstOffset: 1, rule: 'us' },
  { id: 'America/Denver', label: 'America/Denver (Mountain)', utcOffset: -7, dstOffset: 1, rule: 'us' },
  { id: 'America/Los_Angeles', label: 'America/Los_Angeles (Pacific)', utcOffset: -8, dstOffset: 1, rule: 'us' },
  { id: 'America/Anchorage', label: 'America/Anchorage', utcOffset: -9, dstOffset: 1, rule: 'us' },
  { id: 'Pacific/Honolulu', label: 'Pacific/Honolulu (no DST)', utcOffset: -10, dstOffset: 0, rule: 'none' },
  { id: 'Asia/Jerusalem', label: 'Asia/Jerusalem (DST not modeled, matches source workbook)', utcOffset: 2, dstOffset: 0, rule: 'none' },
  { id: 'Europe/London', label: 'Europe/London (DST not modeled, matches source workbook)', utcOffset: 0, dstOffset: 0, rule: 'none' },
  { id: 'UTC', label: 'UTC', utcOffset: 0, dstOffset: 0, rule: 'none' },
];

/* The Weekday chart's שחרית schedules and its footer note are **the program's, not a setting**.
   They were three fields in a "Weekday chart defaults" panel in Settings, and the shul asked for
   that panel gone and these made part of the system. They are one fixed thing the shul davens,
   not a preference: the same two schedules are printed on the wall chart, named on the week card
   and the One sheet, read into the ROSH CHODESH and fast messages, and picked apart for "what is
   on next". Every one of those has to be saying the same times, and a field that can be typed
   over in one browser is a way for them to come apart.

   They are read straight from here rather than out of state.settings, which matters twice over:
   the congregation's site takes its settings from data/published.json, a snapshot of whatever was
   in the admin the day it was written, so a value read from there could be years old; and a
   browser holding an old hand-typed copy in localStorage cannot outvote the program. The three
   keys are taken back out of saved settings as they load (see normalizeSettings in storage.js),
   so nothing carries a stale copy forward in a backup either. */

/** The everyday שחרית schedule as it appears on the shul's printed board, with the
 *  alternate times underlined. Written as HTML because that is what the chart prints.
 *
 *  **Three to a line, separated by a plain space**, which is what the shul settled on after
 *  looking at the alternatives on a printed page. It was two to a line and slash separated for a
 *  while, to read the way the מנחה and מעריב columns beside it do. Three to a line is narrower
 *  (127.7px against 146.1px, measured) and the slashes were what made a three time line too wide
 *  for the panel at all. The panel sets these in columns and **draws the separator the schedule
 *  uses**, so with no slashes typed there are none printed: see ui/shacharis-grid.js. */
export const WEEKDAY_SHACHARIS = '<span class="big">7:00 7:20* <u>7:35</u>\n8:00 8:20* <u>8:40</u></span>';

/** The second schedule, for ר"ח / בה"ב / תענית. Kept apart from the everyday one so the
 *  week card can show it only on weeks that actually have one of those days and name
 *  which it is (see ui/week-view.js). The printed chart still shows both together,
 *  since it covers a whole season at once.
 *
 *  **Three then four**, asked for. The two orders take exactly the same room, measured: both print
 *  the same seven times and the same marks, so the four time line is the same length wherever it
 *  sits and the panel is as wide as that line either way (127.73px against 127.72px, and the same
 *  height to the hundredth). The shul picked it on how it looks, the block finishing square with
 *  the everyday one above it rather than on a short line. */
export const WEEKDAY_SHACHARIS_SPECIAL = '6:40 7:00* <u>7:15</u>\n7:35** 8:00 8:20* <u>8:40</u>';

/** The note at the foot of the Weekday chart, which replaces the regular footer note there.
 *
 *  It says what the marks on the times above it mean, so it belongs with the schedules and not
 *  with the shul's own footer: the stars are written by the schedules and read by every screen
 *  that names a room off one (erevWhereMark in erev-text.js), and a footer that stopped listing
 *  one of them would be the board explaining its own marks wrongly. */
export const WEEKDAY_FOOTER_NOTE = 'All underlined מנינים will be בבית מדרש למטה\nבעזרת נשים **באולם השמחות*';

/** The heading printed above the second schedule on the wall chart, and the three pieces it
 *  is built out of.
 *
 *  All three of them where all three are on the chart, and only the ones that are otherwise:
 *  the shul asked for that, and it is the honest thing to print. בה"ב is two weeks of the year
 *  and a whole season can pass with no weekday תענית, so a heading naming all three was
 *  naming days that are not on the paper. Which of them a chart holds is
 *  specialShacharisKinds in hebrew-calendar.js.
 *
 *  Joined with a ו on the last, the way the full heading has always read: "ר"ח בה"ב ותענ"צ",
 *  "ר"ח ותענ"צ", "בה"ב". */
export const SPECIAL_SHACHARIS_PARTS = [
  ['roshChodesh', 'ר"ח'],
  ['behab', 'בה"ב'],
  ['taanis', 'תענ"צ'],
];

/** ראש חודש written out, rather than the ר"ח used everywhere else in this heading. Asked for
 *  on a page whose only reason for the heading is ר"ח: the abbreviation is what keeps a joined
 *  heading ("ר"ח ותענ"צ") from crowding the box under it, and standing alone it has nothing to
 *  be joined to, and the room to be spelled out the way ראש חודש is elsewhere on the boards
 *  (see OWN_HEADINGS). */
const ROSH_CHODESH_ALONE = 'ראש חודש';

export function specialShacharisHeading(kinds) {
  const parts = SPECIAL_SHACHARIS_PARTS.filter(([key]) => kinds?.[key]).map(([, word]) => word);
  if (!parts.length) return '';
  if (parts.length === 1) return kinds.roshChodesh ? ROSH_CHODESH_ALONE : parts[0];
  return `${parts.slice(0, -1).join(' ')} ו${parts[parts.length - 1]}`;
}


/* The three LEGACY_WEEKDAY_ lists are gone, and splitCombinedShacharis with them. They carried a
   never-edited old schedule in somebody's browser forward to the current one, and there is nothing
   left in a browser to carry: the program's copy is the only copy. */

/** The footer address without the "of". A saved value still matching one of these verbatim was
 *  never actually edited by hand, it is just an old default sitting in localStorage, so storage.js
 *  quietly carries it forward rather than leaving the line reading the way it did two versions ago.
 *  Anything else is left strictly alone.
 *
 *  The shul's name was written both ways across the site: the footer said "Bais Medrash
 *  Lakewood Commons" while the donation page, the page title and the domain all say "Bais
 *  Medrash of Lakewood Commons". One name, one spelling, and the one with the "of" is the
 *  one the shul goes by. An install that never edited this line is moved onto it; anything
 *  typed by hand stays exactly as typed. */
export const LEGACY_FOOTER_ADDRESS = [
  'Bais Medrash Lakewood Commons 44 Coles Way Lakewood, NJ 08701',
];

/** The chart's header colour, which the parsha column is painted in too. Light gray with
 *  dark ink, rather than the dark gray it shipped with: a full column of solid dark on
 *  every page is a lot of toner, and the user asked for the light one. */
export const DEFAULT_ACCENT_COLOR = '#c9ced5';

/** How each season is named in the interface. Defined once and imported, rather than
 *  written out in each screen that needs it: build-offline.py flattens every module into
 *  one plain script sharing a single scope, so two modules declaring the same top-level
 *  name is a SyntaxError there while being perfectly legal under ES modules - it breaks
 *  the USB copy while the site itself carries on working. */
export const SEASON_LABELS = { kayitz: 'שבת קיץ', choref: 'שבת חורף', weekday: 'Weekday' };

/** Accent colours that were once the shipped default. Same carry-forward treatment as
 *  LEGACY_FOOTER_ADDRESS: a sheet still holding one of these was never given a colour
 *  by hand, so it follows the default instead of staying on the old one for ever. */
export const LEGACY_ACCENT_COLORS = ['#54595f'];

export const DEFAULT_SETTINGS = {
  shulName: 'קהל לב מנחם',
  // Printed header: assets/logo-building-icon.png + assets/logo-text.png (the shul's
  // actual logo, pulled straight from the workbook) plus this editable text -
  // headerSubtitle under the logo, headerRabbiLine on the opposite side.
  headerSubtitle: 'ליקוואוד קאמענס',
  headerRabbiLine: 'הרב אריה שרבינטר שליט"א\nמרא דאתרא',
  // Custom header photo (top-left of the printed page), as a cropped data: URL saved
  // via the image-crop tool in Settings - null means "use the bundled default",
  // assets/logo-building-icon.png (see sheet-view.js).
  headerIconImage: null,
  // Printed footer: a note line (as in the workbook - underlined-minyan location,
  // rounding disclaimer, etc.) plus the shul's address.
  footerNote: 'All underlined מנינים will be בבית מדרש למטה\nAll zmanim are rounded off. Please be מחמיר two minutes.',
  footerAddress: 'Bais Medrash of Lakewood Commons 44 Coles Way Lakewood, NJ 08701',
  /* No Weekday chart entries. The two שחרית schedules and the chart's footer note are
     WEEKDAY_SHACHARIS, WEEKDAY_SHACHARIS_SPECIAL and WEEKDAY_FOOTER_NOTE above, read straight
     from the program by everything that prints them. מנחה and מעריב were never settings either:
     those times differ every week, so every cell starts empty and is typed in on the sheet. */
  locationName: 'Lakewood',
  latitude: 40.068,
  longitude: -74.205,
  elevation: 0,
  timezoneId: 'America/New_York',
  language: 'he', // 'he' | 'en'
  horizon: 5 / 6,
  candleLightingMinutes: 18,
  ateretTorahTzaisOffset: 40,
  useAstronomicalChatzos: true,
  useElevation: false,
  inIsrael: false,
  useGregorianBefore1582: false,
  // Last-used sheet display style (font/size/logo scale) - new sheets start with
  // whatever was last set, instead of resetting to a hardcoded default every time.
  sheetStyle: { fontFamily: 'Times New Roman', fontSizePt: 10, headerScale: 1, accentColor: DEFAULT_ACCENT_COLOR },
};

/** Expands stored settings into the shape zmanim.js / hebrew-calendar.js expect. */
export function resolveSettings(raw) {
  const tz = TIMEZONES.find((z) => z.id === raw.timezoneId) || TIMEZONES[0];
  return {
    ...raw,
    timezone: tz,
    english: raw.language === 'en',
  };
}
