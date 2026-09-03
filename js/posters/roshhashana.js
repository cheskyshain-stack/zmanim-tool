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
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';
import { SLASH } from '../util.js';

const RH_MIN = 1 / 1440;
const RH_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos

/** ר"ה of a Hebrew year as an Excel serial, the same call the סליחות poster makes. */
const rhSerial = (year) => roshHashana(year - 3761);

/** To the nearest 5 minutes. The דרשה is announced to a round time rather than to the
 *  minute the arithmetic lands on. */
const toNearest5 = (t) => Math.round(t * 288) / 288;
/** Down to the last 5 minutes, which is how the afternoon מנחה is set. */
const downTo5 = (t) => Math.floor(t * 288 + 1e-9) / 288;

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
  // The three lines above the days, gathered under a heading of their own. The sheet of its
  // own does not need one, since those lines are the first thing under the title; the sheet
  // that holds the whole yomim noraim does, because there every block carries a name.
  erevHeading: 'ערב ראש השנה',
  erevMincha: { label: 'מנחה ערב ראש השנה', times: '<u>1:35</u>, 1:50, 2:15, 3:00' },
  shabbos: 'שבת',
  // Joined to the day with a dot rather than wrapped in brackets: the heading is underlined,
  // and the underline running under a bracket reads as though it is cutting through it.
  daySep: ' · ',
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
  // Split into the name of the זמן and the two reckonings it is given on, so the row can
  // put the same gap between them that it puts between any name and its time. The two
  // reckonings are joined with the charts' own SLASH, a slash with a non breaking space
  // each side, so that breathes as well.
  krias: { name: 'ס"ז ק"ש', basis: `מ"א${SLASH}גר"א` },
  nineHours: { name: "ט' שעות", basis: `מ"א${SLASH}גר"א` },
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
  const tm = (t, underlined = false) => ({ text: formatTime(t), underlined, mark: '' });
  const at = (t) => [tm(t)];
  const pair = (a, b) => [tm(a), tm(b)];

  // תשליך wants daylight after מנחה, so one day carries an earlier מנחה למטה as well, 50
  // minutes before the other one. It is the first day, unless that is Shabbos, when תשליך
  // is pushed off and so is this.
  const tashlichDay = shabbosDay === 0 ? 1 : 0;
  const TASHLICH_EARLIER = 50;

  /* The מנינים of these three days, for the congregation's "what is on next". Gathered here
     as the sheet is built, off the same numbers, so the card and the sheet cannot disagree.
     See posters/minyanim.js for why it is done this way round and which lines are left out.

     The three lines above the days are ערב ר"ה's own: its שחרית, which is the סליחות מנין,
     and its מנחה. חצות is a זמן and is not one. */
  const M = minyanList();
  for (const t of parseTimes(RH_TEXT.slichos.times)) M.typed(rh - 1, RH_TEXT.slichos.label, t, MORNING);
  for (const t of parseTimes(RH_TEXT.erevMincha.times)) M.typed(rh - 1, RH_TEXT.erevMincha.label, t, AFTERNOON);

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
    // These two are on the evening that opens the day, which is the day before it: under
    // "יום א'" that is ערב ר"ה, under "יום ב'" the first day. Getting that wrong is the one
    // way this could be a whole day out, so it is taken from the same `night` the שקיעה
    // above is worked out from rather than from the block's own index.
    const nightOn = rh + i - 1;
    if (i === 0) M.at(nightOn, RH_TEXT.mincha, shkia - 15 * RH_MIN);
    M.at(nightOn, RH_TEXT.maariv, shkia + 60 * RH_MIN);

    // The morning.
    // המלך rides on the שחרית line as a second label and time, not as one run of text, so
    // it gets the same gap between word and time that every other row has.
    lines.push(line(RH_TEXT.shacharis.label, [{ text: RH_TEXT.shacharis.times, underlined: false, mark: '' }],
      { extra: { label: RH_TEXT.hamelech.label, times: [{ text: RH_TEXT.hamelech.times, underlined: false, mark: '' }] } }));
    lines.push(line(RH_TEXT.krias.name, pair(krias.mga, krias.gra), { sub: RH_TEXT.krias.basis }));

    // Shabbos has no שופר: the דרשה moves to before מוסף and ט' שעות is printed instead.
    if (isShabbos) {
      lines.push(line(RH_TEXT.drashaBeforeMusaf, []));
      lines.push(line(RH_TEXT.nineHours.name, pair(nine.mga, nine.gra), { sub: RH_TEXT.nineHours.basis }));
    } else {
      lines.push(line(RH_TEXT.drashaBeforeShofar, []));
      lines.push(line(RH_TEXT.shofar.label, [{ text: RH_TEXT.shofar.times, underlined: false, mark: '' }]));
      lines.push(line(RH_TEXT.shofarWomen.label, [{ text: RH_TEXT.shofarWomen.times, underlined: false, mark: '' }]));
    }

    // The afternoon מנחה, an hour before that day's own שקיעה taken down to the last 5, on
    // both days, with the earlier תשליך one in front of it on the day that has one.
    const mainMincha = downTo5(dayShkia - 60 * RH_MIN);
    lines.push(line(RH_TEXT.mincha, i === tashlichDay
      ? [tm(mainMincha - TASHLICH_EARLIER * RH_MIN, true), tm(mainMincha)]
      : at(mainMincha)));

    // The morning and the afternoon, on the day itself. שחרית is typed rather than computed,
    // so it says which half of the day it is in; המלך rides on that line and is not a מנין of
    // its own. ס"ז ק"ש, ט' שעות, the שופר times and the דרשות are זמנים and announcements.
    const dayOn = rh + i;
    for (const t of parseTimes(RH_TEXT.shacharis.times)) M.typed(dayOn, RH_TEXT.shacharis.label, t, MORNING);
    if (i === tashlichDay) M.at(dayOn, RH_TEXT.mincha, mainMincha - TASHLICH_EARLIER * RH_MIN, { underlined: true });
    M.at(dayOn, RH_TEXT.mincha, mainMincha);

    // מוצאי יו"ט, the only place the 72 minute צאת is printed. The 72 is the underlined one,
    // which is the same way round the boards print a two time מעריב (see calculations-view).
    if (i === 1) {
      lines.push(line(RH_TEXT.maariv, [tm(dayShkia + 60 * RH_MIN), tm(dayShkia + 72 * RH_MIN, true)]));
      M.at(dayOn, RH_TEXT.maariv, dayShkia + 60 * RH_MIN);
      M.at(dayOn, RH_TEXT.maariv, dayShkia + 72 * RH_MIN, { underlined: true });
    }

    return {
      heading: RH_TEXT.day[i] + (isShabbos ? RH_TEXT.daySep + RH_TEXT.shabbos : ''),
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
    // The three days' מנינים, for the congregation's "what is on next". Nothing on the
    // printed sheet reads this.
    minyanim: M.out,
  };
}
