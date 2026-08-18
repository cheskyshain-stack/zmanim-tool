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

/** The everyday שחרית schedule as it appears on the shul's printed board, with the
 *  alternate times underlined. Plain HTML because it's edited through a rich-text box
 *  (see ui/settings-view.js) and printed as-is. */
export const DEFAULT_WEEKDAY_SHACHARIS = '<span class="big">7:00, 7:20*, <u>7:35</u>\n8:00, 8:20*, <u>8:40</u></span>';

/** The second schedule, for ר"ח / בה"ב / תענית. Kept apart from the everyday one so the
 *  week card can show it only on weeks that actually have one of those days and name
 *  which it is (see ui/week-view.js). The printed chart still shows both together,
 *  since it covers a whole season at once. */
export const DEFAULT_WEEKDAY_SHACHARIS_SPECIAL = '6:40, 7:00*, <u>7:15</u>, 7:35**\n8:00, 8:20*, <u>8:40</u>';

/** The heading printed above the second schedule on the wall chart. */
export const SPECIAL_SHACHARIS_HEADING = 'ר"ח בה"ב ותענ"צ';

/** Cuts a saved value that still holds both schedules in one field into the two the
 *  app now keeps separately, splitting at the ר"ח heading. Returns null when there is
 *  no heading to split at, in which case the whole value stays as the everyday one. */
export function splitCombinedShacharis(html) {
  const text = String(html ?? '');
  const at = text.search(/<u>\s*ר["״]ח/);
  if (at < 0) return null;
  // The heading itself is generated now, not stored, so it is dropped here.
  const special = text.slice(at).replace(/^<u>[^<]*<\/u>/, '');
  const trim = (s) => s.replace(/^(?:\s|<br>)+/, '').replace(/(?:\s|<br>)+$/, '');
  return { regular: trim(text.slice(0, at)), special: trim(special) };
}

/** Earlier shipped versions of the above, before the everyday times were set bigger (and
 *  before the field became rich text at all). A saved value still matching one of these
 *  verbatim was never actually edited by hand - it's just an old default sitting in
 *  localStorage - so storage.js quietly upgrades it rather than leaving the schedule
 *  stuck looking the way it did two versions ago. Anything else is left strictly alone. */
export const LEGACY_WEEKDAY_SHACHARIS = [
  '7:00, 7:20*, 7:35\n8:00, 8:20*, 8:40\n\nר"ח בה"ב ותעני"צ\n6:40, 7:00*, 7:15,7:35**\n8:00, 8:20*, 8:40',
  '7:00, 7:20*, <u>7:35</u><br>8:00, 8:20*, <u>8:40</u><br><br><u>ר"ח בה"ב ותעני"צ</u><br>6:40, 7:00*, <u>7:15,7:35</u>**<br>8:00, 8:20*, <u>8:40</u>',
  '<span style="font-size:1.3em">7:00, 7:20*, <u>7:35</u><br>8:00, 8:20*, <u>8:40</u></span><br><br><u>ר"ח בה"ב ותעני"צ</u><br>6:40, 7:00*, <u>7:15,7:35</u>**<br>8:00, 8:20*, <u>8:40</u>',
  '<span class="big">7:00, 7:20*, <u>7:35</u><br>8:00, 8:20*, <u>8:40</u></span><br><br><u>ר"ח בה"ב ותעני"צ</u><br>6:40, 7:00*, <u>7:15,7:35</u>**<br>8:00, 8:20*, <u>8:40</u>',
];

/** The three-line version of the Weekday footer, carried forward to the two-line one the
 *  same way as LEGACY_WEEKDAY_SHACHARIS: an install that never edited it should not stay
 *  on wording that has since changed. Anything typed by hand is left alone. */
export const LEGACY_WEEKDAY_FOOTER = [
  'All underlined מנינים will be בבית מדרש למטה\nבעזרת נשים*\nבאולם השמחות**',
  'All underlined מנינים will be בבית מדרש למטה\n*בעזרת נשים\n**באולם השמחות',
  'All underlined מנינים will be בבית מדרש למטה\n*בעזרת נשים **באולם השמחות',
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
 *  LEGACY_WEEKDAY_SHACHARIS: a sheet still holding one of these was never given a colour
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
  footerAddress: 'Bais Medrash Lakewood Commons 44 Coles Way Lakewood, NJ 08701',
  // Weekday chart defaults. מנחה/מעריב are intentionally blank and have no Settings
  // field: those times differ every week, so every cell starts empty and is typed in on
  // the sheet. The keys are kept so older saved backups still load cleanly.
  // Shacharis is one fixed schedule printed identically on every week's row -
  // stored as real HTML (not plain text) since it's edited via a rich-text box in
  // Settings that supports the same Ctrl/Cmd+U underlining as sheet cells.
  weekdayDefaultMincha: '',
  weekdayDefaultMaariv: '',
  weekdayShacharis: DEFAULT_WEEKDAY_SHACHARIS,
  weekdayShacharisSpecial: DEFAULT_WEEKDAY_SHACHARIS_SPECIAL,
  weekdayFooterNote: 'All underlined מנינים will be בבית מדרש למטה\nבעזרת נשים **באולם השמחות*',
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
