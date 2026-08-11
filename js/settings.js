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
  { id: 'Asia/Jerusalem', label: 'Asia/Jerusalem (DST not modeled — matches source workbook)', utcOffset: 2, dstOffset: 0, rule: 'none' },
  { id: 'Europe/London', label: 'Europe/London (DST not modeled — matches source workbook)', utcOffset: 0, dstOffset: 0, rule: 'none' },
  { id: 'UTC', label: 'UTC', utcOffset: 0, dstOffset: 0, rule: 'none' },
];

export const DEFAULT_SETTINGS = {
  shulName: 'קהל לב מנחם',
  // Printed header: assets/logo-building-icon.png + assets/logo-text.png (the shul's
  // actual logo, pulled straight from the workbook) plus this editable text —
  // headerSubtitle under the logo, headerRabbiLine on the opposite side.
  headerSubtitle: 'ליקוואוד קאמענס',
  headerRabbiLine: 'הרב אריה שרבינטר שליט"א\nמרא דאתרא',
  // Custom header photo (top-left of the printed page), as a cropped data: URL saved
  // via the image-crop tool in Settings — null means "use the bundled default",
  // assets/logo-building-icon.png (see sheet-view.js).
  headerIconImage: null,
  // Printed footer: a note line (as in the workbook — underlined-minyan location,
  // rounding disclaimer, etc.) plus the shul's address.
  footerNote: 'All underlined מנינים will be בבית מדרש למטה\nAll zmanim are rounded off. Please be מחמיר two minutes.',
  footerAddress: 'Bais Medrash Lakewood Commons 44 Coles Way Lakewood, NJ 08701',
  // Weekday chart defaults — Mincha/Maariv are plain editable text per week (these
  // values just pre-fill every week's cell when a Weekday chart is generated;
  // individual weeks are then adjusted the same way any Shabbos-sheet cell is).
  // Shacharis is one fixed schedule printed identically on every week's row.
  weekdayDefaultMincha: '',
  weekdayDefaultMaariv: '',
  weekdayShacharis: '7:00, 7:20*, 7:35\n8:00, 8:20*, 8:40\n\nר"ח בה"ב ותעני"צ\n6:40, 7:00*, 7:15,7:35**\n8:00, 8:20*, 8:40',
  weekdayFooterNote: 'All underlined מנינים will be בבית מדרש למטה\nבעזרת נשים*\nבאולם השמחות**',
  locationName: 'Lakewood',
  latitude: 40.067,
  longitude: -74.202,
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
  // Last-used sheet display style (font/size/logo scale) — new sheets start with
  // whatever was last set, instead of resetting to a hardcoded default every time.
  sheetStyle: { fontFamily: 'Times New Roman', fontSizePt: 10, headerScale: 1, accentColor: '#54595f' },
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
