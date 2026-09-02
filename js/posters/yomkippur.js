// The יום כיפור poster: ערב יו"כ, the day itself, and the schedule that starts after it.
//
// Three parts. The top two are the seder, worked out from the calendar the same way the
// ראש השנה sheet is. The box at the foot is the ordinary weekday schedule for the days
// between יו"כ and סוכות, and its late מנחה and early מעריב move with how early the sun is
// setting by then, so they are worked out too.
//
// As on the ראש השנה sheet, a heading gathers the night that opens the day: the שקיעה under
// יום כיפור is ערב יו"כ's, and the מעריב at the foot of that block is יו"כ's own, which is
// מוצאי יו"כ.
//
// Verified against two of the sheets the shul hangs, תשפ"ו and תשפ"ד. The rules reproduce
// תשפ"ו to the minute nearly throughout; תשפ"ד, which is older, rounds several lines the
// other way and is not self-consistent with it. See the commit for the line by line.
import { roshHashana, excelWeekday } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime } from '../format.js';
import { parseTimes } from './slichos.js';
import { SLASH, NBSP } from '../util.js';

/** The & that joins the two ways of taking קידוש לבנה, spaced the way SLASH spaces a pair
 *  of times: after מעריב, or at half past ten. */
const YK_AMP = `${NBSP}&${NBSP}`;

const YK_MIN = 1 / 1440;
const at = (h, m) => (h * 60 + m) / 1440;
/** Up to the next 5 minutes, and to the nearest 5. */
const ykUp5 = (t) => Math.ceil(t * 288 - 1e-9) / 288;
const ykNear5 = (t) => Math.round(t * 288) / 288;

/** The Hebrew letter for a weekday, as the sheet names the morning after יו"כ. Shabbos
 *  cannot happen there (10 תשרי is never a Friday), but it is covered anyway. */
const YK_DAY_LETTERS = ['', "א'", "ב'", "ג'", "ד'", "ה'", "ו'", 'שבת'];

/** The wording, and the times the shul sets by hand rather than by the sun. */
export const YK_TEXT = {
  title: 'יום כיפור',
  erevHeading: 'ערב יום כיפור',
  dayHeading: 'יום כיפור',
  erevShacharis: { label: 'שחרית', times: '7:00, 7:20*, <u>7:35</u>, 8:00**, 8:20' },
  erevMincha: { label: 'מנחה', times: '1:30, 2:00, 2:30, 3:00, 3:30, 4:00' },
  candles: 'הדלקת נרות',
  shkia: 'שקיעה',
  kolNidrei: 'כל נדרי',
  drasha: 'דברי התעוררות מאת הרב שליט"א',
  drashaBeforeNeila: 'דברי התעוררות מאת הרב שליט"א קודם נעילה',
  maariv: 'מעריב',
  shacharis: { label: 'שחרית', times: '7:30' },
  hamelech: { label: 'המלך', times: '8:30' },
  krias: { name: 'ס"ז ק"ש', basis: `מ"א${SLASH}גר"א` },
  yizkor: { label: 'יזכור בערך', times: '11:55' },
  mincha: 'מנחה',
  neila: 'נעילה',
  // A third מעריב for anyone who has not davened yet, on every year's sheet. The label says
  // where it is in words and the time is underlined as well, which is how the old sheets
  // marked it: the underline is this system's way of saying the same thing.
  maarivGimmel: { label: "מעריב ג' בבית מדרש למטה", times: '<u>10:00</u>' },
  // The gap goes after the name, and what follows is two ways of taking it rather than one
  // long label: אחר מעריב, or 10:30. So they are set as a pair, joined by the &.
  kiddushLevana: { label: 'קידוש לבנה', times: ['אחר מעריב', '10:30'] },
  nextMorning: 'שחרית יום',
  afterHeading: 'Starting after יום כיפור',
  after: { shacharis: 'שחרית:', mincha: 'מנחה:', maariv: 'מעריב:' },
  // The same three names again, without the colon, for the sheet that gives the schedule a
  // page of its own and sets them as headings.
  afterBig: { shacharis: 'שחרית', mincha: 'מנחה', maariv: 'מעריב' },
};

/** The everyday שחרית as the boards print it, read out of settings so the poster and the
 *  charts cannot drift.
 *
 *  The stored value is rich text: a wrapper span, a line break between the two halves, and
 *  the times separated by spaces rather than commas. All three are flattened to the comma
 *  separated list parseTimes reads, the <u> that marks a למטה מנין left alone. */
function weekdayShacharis(settings) {
  const html = String(settings.weekdayShacharis || '')
    .replace(/<span[^>]*>|<\/span>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(', ');
  return parseTimes(html);
}

/** The same list five minutes earlier, which is what the morning after יו"כ runs on. */
function fiveEarlier(times) {
  return times.map((t) => {
    const [h, m] = t.text.split(':').map(Number);
    const shifted = at(h === 12 ? 0 : h, m) - 5 * YK_MIN;
    return { ...t, text: formatTime(shifted) };
  });
}

/** The days between יו"כ and סוכות: 11 תשרי through ערב סוכות on the 14th.
 *
 *  The late מנחה and the early מעריב have to work on every one of them, so they are set by
 *  the earliest שקיעה in the run. Only Sunday through Thursday count: Friday and Shabbos
 *  keep their own schedule and are not what this box is for. */
export function afterYomKippurDays(rh, settings) {
  const days = [];
  for (let n = 11; n <= 14; n++) {
    const serial = rh + n - 1;
    const dow = excelWeekday(serial);
    if (dow < 1 || dow > 5) continue; // Sunday to Thursday
    days.push({ serial, shkia: Z.sunsetElev(dateFromSerial(serial), settings) });
  }
  return days;
}

/** The מנחה list for the box.
 *
 *  Four fixed ones, then every 20 minutes from 4:40 for as long as a מנין still lands 15
 *  minutes or more before שקיעה. Then one last one squeezed in between 15 and 20 minutes
 *  before שקיעה if there is room for it, which there is only when the 20 minute run stopped
 *  well short: it has to be at least 15 minutes after the one in front of it. That last one
 *  is the 6:15 on the תשפ"ו sheet, 16 minutes before a 6:31 שקיעה. */
export function afterMincha(earliestShkia) {
  const times = [at(13, 15), at(13, 35), at(13, 50), at(16, 15)];
  for (let t = at(16, 40); t <= earliestShkia - 15 * YK_MIN + 1e-9; t += 20 * YK_MIN) times.push(t);
  const last = times[times.length - 1];
  const tail = ykNear5(earliestShkia - 17 * YK_MIN); // the middle of the 15 to 20 window
  if (tail > last + 15 * YK_MIN - 1e-9
      && tail <= earliestShkia - 15 * YK_MIN + 1e-9
      && tail >= earliestShkia - 20 * YK_MIN - 1e-9) times.push(tail);
  return times;
}

/** The first מעריב of the box: 7:30 if that is a full 50 minutes after שקיעה, and otherwise
 *  pushed on in fives until it is, but never past 7:45, which is 15 minutes in front of the
 *  8:00 behind it. */
export function afterEarlyMaariv(earliestShkia) {
  let t = at(19, 30);
  while (t < earliestShkia + 50 * YK_MIN - 1e-9 && t < at(19, 45)) t += 5 * YK_MIN;
  return t;
}

/** The rest of the מעריב list, which does not move. 8:30 is added to the everyday run, and
 *  the marks follow the boards: everything is למטה except 8:45 and 10:30, which are the main
 *  בית מדרש (see calculations-view for where that comes from). */
const AFTER_MAARIV_REST = [
  [20, 0, true], [20, 30, true], [20, 45, false], [21, 0, true], [21, 30, true],
  [22, 0, true], [22, 30, false], [23, 0, true], [23, 30, true],
  // Midnight, written as the 24th hour so it stays in order after 11:30 rather than
  // sorting to the front of the day. formatTime prints it as 12:00.
  [24, 0, true],
];

/** The everyday schedule that runs from after יו"כ until סוכות.
 *
 *  Shared, because it is both the box at the foot of the יום כיפור sheet and a sheet of its
 *  own. The everyday שחרית comes out of settings, so the posters and the boards cannot
 *  drift. */
export function buildAfterYomKippur(year, settings) {
  const rh = roshHashana(year - 3761);
  const tm = (t, underlined = false, mark = '') => ({ text: formatTime(t), underlined, mark });
  const runDays = afterYomKippurDays(rh, settings);
  const earliest = runDays.length
    ? Math.min(...runDays.map((d) => d.shkia))
    : Z.sunsetElev(dateFromSerial(rh + 9), settings);
  return {
    shacharis: weekdayShacharis(settings),
    // Everything is למטה except the 1:50, which is the main בית מדרש, as on the boards.
    mincha: afterMincha(earliest).map((t) => tm(t, Math.abs(t - at(13, 50)) > 1e-9)),
    maariv: [tm(afterEarlyMaariv(earliest), true),
      ...AFTER_MAARIV_REST.map(([h, m, u]) => tm(at(h, m), u))],
    earliestShkia: formatTime(earliest),
  };
}

/** The same schedule as a sheet in its own right, set large with a heading per תפילה. */
export function buildAfterYomKippurPoster(year, settings) {
  if (!year) return null;
  const rh = roshHashana(year - 3761);
  const after = buildAfterYomKippur(year, settings);
  const all = [...after.shacharis, ...after.mincha, ...after.maariv];
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');
  return {
    hebrewYear: year,
    // From the morning after יו"כ through ערב סוכות, which is what it covers.
    span: { from: rh + 10, to: rh + 13 },
    after,
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}

export function buildYomKippurPoster(year, settings) {
  if (!year) return null;
  const rh = roshHashana(year - 3761);
  const erev = dateFromSerial(rh + 8);   // 9 תשרי
  const yk = dateFromSerial(rh + 9);     // 10 תשרי
  const erevShkia = Z.sunsetElev(erev, settings);
  const ykShkia = Z.sunsetElev(yk, settings);

  const tm = (t, underlined = false, mark = '') => ({ text: formatTime(t), underlined, mark });
  const txt = (s, underlined = false, mark = '') => ({ text: s, underlined, mark });
  const line = (label, times, opts = {}) => ({ label, times, ...opts });

  // כל נדרי is the candle lighting taken up to the next 5, and if that leaves less than
  // four minutes to light in, on to the 5 after it. Both sheets turn on this: תשפ"ו lights
  // at 6:21 and davens at 6:25, exactly four; תשפ"ד lights at 6:33, where 6:35 would leave
  // two, so it goes to 6:40.
  const candles = erevShkia - settings.candleLightingMinutes * YK_MIN;
  let kolNidrei = ykUp5(candles);
  if (kolNidrei - candles < 4 * YK_MIN - 1e-9) kolNidrei = ykUp5(kolNidrei + YK_MIN);

  const nightMaariv = erevShkia + 72 * YK_MIN;
  const motzei60 = ykShkia + 60 * YK_MIN;
  const neila = ykNear5(motzei60 - 110 * YK_MIN);   // 1:50 before the 60 minute מעריב

  const dayLines = [
    line(YK_TEXT.candles, [tm(candles)]),
    line(YK_TEXT.shkia, [tm(erevShkia)]),
    line(YK_TEXT.kolNidrei, [tm(kolNidrei)]),
    line(YK_TEXT.drasha, [tm(ykNear5(nightMaariv - 30 * YK_MIN))]),
    line(YK_TEXT.maariv, [tm(nightMaariv)]),
    line(YK_TEXT.shacharis.label, [txt(YK_TEXT.shacharis.times)],
      { extra: { label: YK_TEXT.hamelech.label, times: [txt(YK_TEXT.hamelech.times)] } }),
    line(YK_TEXT.krias.name,
      [tm(Z.sofZmanShmaMGA72(yk, settings)), tm(Z.sofZmanShmaGRA(yk, settings))],
      { sub: YK_TEXT.krias.basis }),
    line(YK_TEXT.yizkor.label, [txt(YK_TEXT.yizkor.times)]),
    line(YK_TEXT.mincha, [tm(neila - 110 * YK_MIN)]),   // 1:50 before נעילה
    line(YK_TEXT.drashaBeforeNeila, []),
    line(YK_TEXT.neila, [tm(neila)]),
    // מוצאי יו"כ. The 72 is the underlined one, the same way round the boards print a two
    // time מעריב.
    line(YK_TEXT.maariv, [tm(motzei60), tm(ykShkia + 72 * YK_MIN, true)]),
    line(YK_TEXT.maarivGimmel.label, parseTimes(YK_TEXT.maarivGimmel.times)),
    line(YK_TEXT.kiddushLevana.label, YK_TEXT.kiddushLevana.times.map((t) => txt(t)),
      { sep: YK_AMP }),
  ];

  // The morning after, which the calendar names and which runs five minutes early.
  const dayAfter = rh + 10;
  const nextMorning = {
    label: `${YK_TEXT.nextMorning} ${YK_DAY_LETTERS[excelWeekday(dayAfter)]}`,
    times: fiveEarlier(weekdayShacharis(settings)),
  };

  // The box: the days between יו"כ and סוכות, the same schedule the sheet of its own gives.
  const after = buildAfterYomKippur(year, settings);

  const all = [...dayLines.flatMap((l) => l.times), ...after.mincha, ...after.maariv,
    ...after.shacharis, ...nextMorning.times, ...parseTimes(YK_TEXT.erevShacharis.times)];
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');

  return {
    hebrewYear: year,
    span: { from: rh + 8, to: rh + 9 },
    // Both are lists of מנינים rather than one זמן given two ways, so they are set with
    // commas; see the renderer.
    erevLines: [
      line(YK_TEXT.erevShacharis.label, parseTimes(YK_TEXT.erevShacharis.times), { list: true }),
      line(YK_TEXT.erevMincha.label, parseTimes(YK_TEXT.erevMincha.times), { list: true }),
    ],
    dayLines,
    nextMorning,
    after,
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}
