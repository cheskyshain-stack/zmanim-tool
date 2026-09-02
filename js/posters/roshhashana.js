// The ראש השנה poster: the two days' seder, worked out from the calendar.
//
// The most calculated of the posters. Almost every time on it moves with the year, and the
// shape of the sheet moves too: when the first day is Shabbos there is no שופר, so those
// lines come off and a ט' שעות line and a דרשה קודם מוסף go on instead.
//
// A day's heading gathers the night that opens it. Under "יום א'" the שקיעה and מעריב are
// ערב ר"ה's, under "יום ב'" they are the first day's, and the מעריב at the very bottom is
// the second day's, which is מוצאי יו"ט. That is how the sheets the shul hangs are laid
// out, and reading them any other way made the numbers look a day out.
//
// Verified against two of those sheets, תשפ"ד (first day Shabbos) and תשפ"ו (neither day),
// which between them cover both shapes. See the test notes in the commit.
import { roshHashana, excelWeekday } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, floorToMinute } from '../format.js';
import { parseTimes } from './slichos.js';

const RH_MIN = 1 / 1440;
const RH_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos

/** ר"ה of a Hebrew year as an Excel serial, the same call the סליחות poster makes. */
const rhSerial = (year) => roshHashana(year - 3761);

/** To the nearest 5 minutes. The דרשה is announced to a round time rather than to the
 *  minute the arithmetic lands on. */
const toNearest5 = (t) => Math.round(t * 288) / 288;
/** Up to the next 5 minutes, which is how the afternoon מנחה is set. */
const upTo5 = (t) => Math.ceil(t * 288 - 1e-9) / 288;

/** Nine seasonal hours into the day, on each of the two reckonings the boards use: the
 *  גר"א day runs sunrise to sunset, the מ"א day עלות 72 to צאת 72. Only printed on a first
 *  day that is Shabbos, where it stands in for the שופר times. */
function nineHours(date, settings) {
  const gra = Z.sunriseElev(date, settings);
  const graEnd = Z.sunsetElev(date, settings);
  const mga = Z.alos72(date, settings);
  const mgaEnd = Z.tzais72(date, settings);
  return {
    gra: gra + 9 * (graEnd - gra) / 12,
    mga: mga + 9 * (mgaEnd - mga) / 12,
  };
}

/** The lines that are wording rather than arithmetic, and the times the shul sets by hand.
 *
 *  Here rather than in settings, the same as the other two posters: these are fixed מנין
 *  slots and announcements. Everything that moves with the year is computed below. */
export const RH_TEXT = {
  title: 'ראש השנה',
  slichos: { label: 'סליחות ערב ר"ה', times: '6:30, <u>7:10</u>' },
  chatzos: 'חצות',
  erevMincha: { label: 'מנחה ערב ראש השנה', times: '<u>1:35</u>, 1:50, 2:15, 3:00' },
  shabbos: 'שבת',
  day: ["יום א'", "יום ב'"],
  candles: 'הדלקת נרות',
  shkia: 'שקיעה',
  mincha: 'מנחה',
  maariv: 'מעריב',
  drasha: 'דרשה מאת הרב שליט"א',
  drashaBeforeShofar: 'דרשה מאת הרב שליט"א קודם תקיעת',
  drashaBeforeMusaf: 'דרשה מאת הרב שליט"א קודם מוסף',
  shacharis: { label: 'שחרית', times: '7:30' },
  hamelech: { label: 'המלך', times: '8:30' },
  krias: 'ס"ז ק"ש מ"א/ גר"א',
  nineHours: 'ט\' שעות מ"א/ גר"א',
  shofar: { label: 'תקיעת שופר בערך', times: '11:40' },
  shofarWomen: { label: 'תקיעת שופר לנשים בערך', times: '3:05' },
};

/** The finished poster for one Hebrew year. */
export function buildRoshHashanaPoster(year, settings) {
  if (!year) return null;
  const rh = rhSerial(year);
  const erev = dateFromSerial(rh - 1);
  const days = [dateFromSerial(rh), dateFromSerial(rh + 1)];
  const shabbosDay = days.findIndex((d, i) => excelWeekday(rh + i) === RH_SHABBOS);

  const line = (label, times, opts = {}) => ({ label, times, ...opts });
  const at = (t) => [{ text: formatTime(t), underlined: false, mark: '' }];
  const pair = (a, b) => [
    { text: formatTime(a), underlined: false, mark: '' },
    { text: formatTime(b), underlined: false, mark: '' },
  ];

  const blocks = days.map((day, i) => {
    const night = i === 0 ? erev : days[0];
    const shkia = Z.sunsetElev(night, settings);
    const isShabbos = i === shabbosDay;
    const krias = { gra: Z.sofZmanShmaGRA(day, settings), mga: Z.sofZmanShmaMGA72(day, settings) };
    const nine = nineHours(day, settings);
    const dayShkia = Z.sunsetElev(day, settings);

    const lines = [];
    // The night that opens the day. הדלקת נרות only on the first, since the second day's
    // candles are lit from an existing flame and the sheets have never printed a time.
    if (i === 0) lines.push(line(RH_TEXT.candles, at(shkia - settings.candleLightingMinutes * RH_MIN)));
    if (i === 0) lines.push(line(RH_TEXT.mincha, at(shkia - 15 * RH_MIN)));
    lines.push(line(RH_TEXT.shkia, at(shkia)));
    if (i === 0) lines.push(line(RH_TEXT.drasha, at(toNearest5(shkia + 30 * RH_MIN))));
    lines.push(line(RH_TEXT.maariv, at(shkia + 60 * RH_MIN)));

    // The morning.
    lines.push(line(RH_TEXT.shacharis.label, [{ text: RH_TEXT.shacharis.times, underlined: false, mark: '' }],
      { extra: `${RH_TEXT.hamelech.label} ${RH_TEXT.hamelech.times}` }));
    lines.push(line(RH_TEXT.krias, pair(krias.mga, krias.gra)));

    // Shabbos has no שופר: the דרשה moves to before מוסף and ט' שעות is printed instead.
    if (isShabbos) {
      lines.push(line(RH_TEXT.drashaBeforeMusaf, []));
      lines.push(line(RH_TEXT.nineHours, pair(nine.mga, nine.gra)));
    } else {
      lines.push(line(RH_TEXT.drashaBeforeShofar, []));
      lines.push(line(RH_TEXT.shofar.label, [{ text: RH_TEXT.shofar.times, underlined: false, mark: '' }]));
      lines.push(line(RH_TEXT.shofarWomen.label, [{ text: RH_TEXT.shofarWomen.times, underlined: false, mark: '' }]));
    }

    // The afternoon מנחה, an hour before that day's own שקיעה, taken up to the next 5.
    lines.push(line(RH_TEXT.mincha, at(upTo5(dayShkia - 60 * RH_MIN))));

    // מוצאי יו"ט, the only place the 72 minute צאת is printed.
    if (i === 1) lines.push(line(RH_TEXT.maariv, pair(dayShkia + 60 * RH_MIN, dayShkia + 72 * RH_MIN)));

    return {
      heading: RH_TEXT.day[i] + (isShabbos ? ` (${RH_TEXT.shabbos})` : ''),
      isShabbos,
      lines,
    };
  });

  // Only the marks the sheet actually carries get explained, and each line carries the
  // direction it has to be set in. Same as the other two posters.
  const marks = [
    ...parseTimes(RH_TEXT.slichos.times),
    ...parseTimes(RH_TEXT.erevMincha.times),
    ...blocks.flatMap((b) => b.lines.flatMap((l) => l.times)),
  ];
  const stars = [];
  if (marks.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (marks.some((t) => t.mark === '**')) stars.push('**באולם השמחות');

  return {
    hebrewYear: year,
    legend: [
      marks.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
    span: { from: rh - 1, to: rh + 1 },
    // חצות is cut to the minute rather than rounded. Both sheets settle it: 12:52.25 and
    // 12:49.58, printed as 12:52 and 12:49. Rounding the second gives 12:50, which is a
    // minute later than חצות really is, and no printed זמן should say that.
    chatzos: formatTime(floorToMinute(Z.solarNoon(erev, settings))),
    blocks,
  };
}
