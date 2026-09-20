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
import { zman, clockTime, fixedTime } from '../zmanim/trace.js';
import { twoReckonings } from './reckonings.js';
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';
import { openingMincha, openingMinchaTrace } from './early-mincha.js';
import { SLASH, NBSP } from '../util.js';
import { WEEKDAY_SHACHARIS } from '../settings.js';

/** The & that joins the two ways of taking קידוש לבנה, spaced the way SLASH spaces a pair
 *  of times: after מעריב, or at half past ten. */
const YK_AMP = `${NBSP}&${NBSP}`;

const YK_MIN = 1 / 1440;
const at = (h, m) => (h * 60 + m) / 1440;
/** Up to the next 5 minutes, and to the nearest 5. */
const ykUp5 = (t) => Math.ceil(t * 288 - 1e-9) / 288;
const ykNear5 = (t) => Math.round(t * 288) / 288;

const YK_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos

/** The Hebrew letter for a weekday, as the sheet names the morning after יו"כ. Shabbos
 *  cannot happen there (10 תשרי is never a Friday), but it is covered anyway. */
const YK_DAY_LETTERS = ['', "א'", "ב'", "ג'", "ד'", "ה'", "ו'", 'שבת'];

/** The wording, and the times the shul sets by hand rather than by the sun. */
export const YK_TEXT = {
  title: 'יום כיפור',
  erevHeading: 'ערב יום כיפור',
  dayHeading: 'יום כיפור',
  /* What the day's heading adds in a year where 10 תשרי is Shabbos, which is every year
     ר"ה falls on a Thursday. Joined with a dot rather than wrapped in brackets, and both
     the word and the separator are the ראש השנה sheet's (see RH_TEXT.daySep): the heading
     is underlined, and the underline running under a bracket reads as though it is cutting
     through it. The two sheets sit side by side on one page, so they say it the same way.
     ערב יו"כ takes nothing: in such a year it is the Friday. */
  shabbos: 'שבת',
  daySep: ' · ',
  // Called סליחות rather than שחרית for the same reason צום גדליה's morning is: סליחות are
  // said that morning, and that is what the מנינים under the heading are for.
  erevShacharis: { label: 'סליחות', times: '7:00, 7:20*, <u>7:35</u>, 8:00**, 8:20' },
  erevMincha: { label: 'מנחה', times: '1:30, 2:00, 2:30, 3:00, 3:30, 4:00' },
  candles: 'הדלקת נרות',
  shkia: 'שקיעה',
  kolNidrei: 'כל נדרי',
  drasha: 'דברי התעוררות מאת הרב שליט"א',
  drashaBeforeNeila: 'דברי התעוררות מאת הרב שליט"א קודם נעילה',
  maariv: 'מעריב',
  shacharis: { label: 'שחרית', times: '7:30' },
  hamelech: { label: 'המלך', times: '8:30' },
  krias: { name: 'ס"ז ק"ש' },
  yizkor: { label: 'יזכור בערך', times: '11:55' },
  mincha: 'מנחה',
  neila: 'נעילה',
  /* A third מעריב for anyone who has not davened yet, on every year's sheet. The name alone:
     the time is underlined and the key at the foot says an underlined מנין is בבית מדרש למטה,
     so the label read "מעריב ג' בבית מדרש למטה" against an underlined 10:00 and said where
     twice over. The old sheets wrote it in words because they had no such mark; this system
     does. */
  maarivGimmel: { label: "מעריב ג'", times: '<u>10:00</u>' },
  // The gap goes after the name, and what follows is two ways of taking it rather than one
  // long label: אחר מעריב, or 10:30. So they are set as a pair, joined by the &.
  kiddushLevana: { label: 'קידוש לבנה', times: ['אחר מעריב', '10:30'] },
  nextMorning: 'שחרית יום',
  // The one heading on these sheets that used to be English, because that was the wording the
  // shul hung. It is Hebrew now and reads the same way round as the block after סוכות, which
  // runs on the same rules and is named to match.
  afterHeading: 'זמני תפילה אחר יום כיפור',
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
/** The everyday שחרית off the wall chart, as times. See WEEKDAY_SHACHARIS in settings.js.
 *
 *  Exported because the סוכות sheet needs it too: ערב סוכות's own morning is an ordinary one
 *  and is on the box this sheet carries rather than on that one.
 *
 *  Named for what it is rather than "weekday", because upcoming.js has a weekdayShacharis of
 *  its own that answers a different question (one day's schedule, with the ר"ח/בה"ב/תענית
 *  variant picked). Two functions of one name are fine across modules and fatal in the offline
 *  copy, which flattens every module into one scope: whichever is written second wins, and
 *  every call to the other one silently gets it. That is exactly what had happened here. */
export function everydayShacharis() {
  const html = String(WEEKDAY_SHACHARIS)
    .replace(/<span[^>]*>|<\/span>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    /* The slashes between a pair of times, which are separators and not times. The field used
       to be one time to a line and the whitespace split below was the whole of it; it now
       reads "7:00 / 7:20*" two to a line, and every one of those slashes was coming through as
       an item of its own and printing on the שמחת בית השואבה and ערב סוכות sheets as NaN:NaN.
       Matched only with whitespace on both sides, which the pair separator has and the one in
       "</u>" does not: that slash is preceded by a "<" and has to survive, since parseTimes
       reads the tag to know a time is underlined. NBSP counts as whitespace to \s, and the
       separator is NBSP on both sides (see SLASH in util.js). */
    .replace(/(?<=\s)\/(?=\s)/g, ' ')
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
    /* The trace is moved with the text, not carried over with it. Spreading `t` brings the
       trace of the time this one was made from, so without this the sheet printed 6:55 while
       the calculations page explained a 7:00. A wrong explanation is worse than none, and it
       is the one failure a page like this must not have. */
    return {
      ...t,
      text: formatTime(shifted),
      trace: t.trace ? t.trace.minus(5, 'the morning after יום כיפור runs five minutes earlier than the ערב יום כיפור list it is taken from') : null,
    };
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
    days.push({
      serial,
      shkia: Z.sunsetElev(dateFromSerial(serial), settings),
      // The later of מנחה גדולה and half an hour after חצות, which is the one the charts
      // already test their early מנחה against (sheets/common.js, sheets/weekday.js).
      minchaGedola: Z.minchaGedolaLechumra(dateFromSerial(serial), settings),
    });
  }
  return days;
}

/** The מנחה list for the box.
 *
 *  Four fixed ones, then every 20 minutes from 4:40 for as long as a מנין still lands 15
 *  minutes or more before שקיעה. Then one last one squeezed in between 15 and 20 minutes
 *  before שקיעה if there is room for it, which there is only when the 20 minute run stopped
 *  well short: it has to be at least 15 minutes after the one in front of it. That last one
 *  is the 6:15 on the תשפ"ו sheet, 16 minutes before a 6:31 שקיעה.
 *
 *  The 1:15 is not really fixed: on daylight saving time it can land before מנחה גדולה, and
 *  where it does it moves to 1:20, or comes off the sheet where even that is too early. That
 *  is openingMincha in posters/early-mincha.js, which the סוכות sheet asks the same question
 *  of. The binding day is the latest מנחה גדולה of the run, since one printed list has to hold
 *  for all four days, the same way the earliest שקיעה binds the evening ones.
 *
 *  `lastFifteen` closes the list differently, and the schedule that starts after סוכות is the
 *  one that asks for it: a last מנין a quarter of an hour before שקיעה, on a round five, rather
 *  than wherever the twenty minute run happens to stop. The shul asked for that end explicitly
 *  and this is the same rule the חול המועד run above it already prints (sukkosChmMincha in
 *  posters/sukkos.js): the run stops short of it by a quarter of an hour, and where that leaves
 *  more than twenty minutes with nothing in them one מנין goes back in.
 */
export function afterMincha(earliestShkia, latestMinchaGedola = 0, { lastFifteen = false } = {}) {
  const first = openingMincha(latestMinchaGedola, at(13, 35));
  const times = [at(13, 35), at(13, 50), at(16, 15)];
  if (first !== null) times.unshift(first);
  if (lastFifteen) {
    // Down to the last five rather than up: a quarter of an hour before שקיעה is the latest
    // this מנין may be, and rounding up would push it past that.
    const end = Math.floor((earliestShkia - 15 * YK_MIN) * 288 + 1e-9) / 288;
    for (let t = at(16, 40); t <= end + 1e-9; t += 20 * YK_MIN) {
      if (end - t >= 15 * YK_MIN - 1e-9) times.push(t);
    }
    const before = times[times.length - 1];
    if (end - before > 20 * YK_MIN + 1e-9) {
      const fill = [20, 15].map((m) => end - m * YK_MIN)
        .find((t) => t - before >= 15 * YK_MIN - 1e-9);
      if (fill !== undefined) times.push(fill);
    }
    times.push(end);
    return times;
  }
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

/** The three lists themselves, given the two zmanim that bind them: the earliest שקיעה of the
 *  days one printed schedule has to hold for, which sets the end of the afternoon and the head
 *  of the evening, and their latest מנחה גדולה, which decides the מנין the afternoon opens with.
 *
 *  Here rather than inside buildAfterYomKippur because two schedules run on it: this one and
 *  the one that starts after סוכות, which the shul asked to be worked the same way. One rule in
 *  one place is the only way the two can be relied on to stay the same, which is the same
 *  ground the opening מנין itself is shared on (posters/early-mincha.js). What differs between
 *  them is only which days are counted, and each sheet answers that for itself. */
export function afterSchedule(earliestShkia, latestMinchaGedola, settings, { lastFifteen = false } = {}) {
  const tm = (t, underlined = false, mark = '') => ({ text: formatTime(t), underlined, mark });
  /* Each printed time carries the traced value that made it, so this box can say how it was
     arrived at wherever it is hung: at the foot of the יום כיפור sheet and as a sheet of its
     own, and the same helper again on the סוכות one. One working, three places. */
  const shkia = () => zman('שקיעה', earliestShkia, 'the earliest of every day this one printed list has to hold for');
  const minchaTraces = afterMinchaTrace(earliestShkia, latestMinchaGedola, { lastFifteen });
  const early = afterEarlyMaariv(earliestShkia);
  const earlyTrace = clockTime(19, 30, 'the מעריב this box opens with')
    .steppedTo(early, { by: 5, backwards: false, untilAt: formatTime(earliestShkia + 50 * YK_MIN),
      until: 'a full 50 minutes after the earliest שקיעה of the run, but never past 7:45, which leaves a quarter of an hour in front of the 8:00 behind it' })
    .underline();
  return {
    shacharis: everydayShacharis(),
    // Everything is למטה except the 1:50, which is the main בית מדרש, as on the boards.
    mincha: afterMincha(earliestShkia, latestMinchaGedola, { lastFifteen })
      .map((t, i) => {
        const under = Math.abs(t - at(13, 50)) > 1e-9;
        const tr = minchaTraces[i];
        return { ...tm(t, under), trace: tr && under ? tr.underline() : tr };
      }),
    maariv: [{ ...tm(early, true), trace: earlyTrace },
      ...AFTER_MAARIV_REST.map(([h, m, u]) => ({
        ...tm(at(h, m), u),
        trace: (() => { const c = clockTime(h, m, 'one of the standing מעריב times, which do not move with the year'); return u ? c.underline() : c; })(),
      }))],
  };
}

/** The מנחה list as traced values, one for one with afterMincha above.
 *
 *  A parallel walk rather than a rewrite of it: afterMincha stays the single answer for what
 *  the times are, and this says what each of them is. They are built from the same constants
 *  in the same order, and the check in the scratchpad compares every one against the printed
 *  line, so the two cannot quietly come apart. */
export function afterMinchaTrace(earliestShkia, latestMinchaGedola = 0, { lastFifteen = false } = {}) {
  const standing = (h, m, what) => clockTime(h, m, what);
  const shkia = () => zman('שקיעה', earliestShkia, 'the earliest of every day this one printed list has to hold for');
  const out = [];
  const first = openingMincha(latestMinchaGedola, at(13, 35));
  if (first !== null) out.push(openingMinchaTrace(latestMinchaGedola, at(13, 35)));
  out.push(standing(13, 35, 'a standing מנין on this list'));
  out.push(standing(13, 50, 'a standing מנין on this list, and the one in the main בית מדרש'));
  out.push(standing(16, 15, 'a standing מנין on this list'));

  const run = 'one of the run that goes every twenty minutes from 4:40, kept while it stays a quarter of an hour clear of שקיעה';
  const times = afterMincha(earliestShkia, latestMinchaGedola, { lastFifteen });
  for (const t of times.slice(out.length)) {
    /* Whatever is left after the standing four is either a step of the twenty minute run or
       one of the two that close it against שקיעה. A time on the run is on a whole number of
       twenty minute steps from 4:40; anything else was worked out from שקיעה. */
    const steps = (t - at(16, 40)) / (20 * YK_MIN);
    const onRun = Math.abs(steps - Math.round(steps)) < 1e-6 && steps >= 0;
    /* Decomposed from one rounded minute count, not from the float twice over. The run is
       accumulated with += 20/1440, so 5:00 arrives as 1019.9999999999999 minutes: taking the
       hour and then the minute separately rounded that remainder up to 60 and printed the
       מנין an hour late. The check in the scratchpad caught it, which is what it is for. */
    const mins = Math.round(t * 1440);
    out.push(onRun
      ? clockTime(Math.floor(mins / 60), mins % 60, run)
      : shkia().minus(Math.round((earliestShkia - t) * 1440),
          'the last of the afternoon, set against שקיעה so the run ends a clear quarter of an hour in front of it'));
  }
  return out;
}

/** The everyday schedule that runs from after יו"כ until סוכות.
 *
 *  Shared, because it is both the box at the foot of the יום כיפור sheet and a sheet of its
 *  own. The everyday שחרית comes out of settings, so the posters and the boards cannot
 *  drift. */
export function buildAfterYomKippur(year, settings) {
  const rh = roshHashana(year - 3761);
  const runDays = afterYomKippurDays(rh, settings);
  const earliest = runDays.length
    ? Math.min(...runDays.map((d) => d.shkia))
    : Z.sunsetElev(dateFromSerial(rh + 9), settings);
  /* The latest מנחה גדולה of every day this list is offered on, so the opening מנין holds on
     all of them: see afterMincha.

     The morning after יו"כ is counted whether or not it is one of the run's own Sunday to
     Thursday days. The sheet completes that day from this box and so does the card, which
     is deliberate and is written down where it happens; but the box's times are set by the
     Sunday to Thursday days alone, so in a year where the morning after is a Friday the
     opening מנין was being offered on a day nobody had checked it against. Measured: תשפ"ו
     and תת"ה are both such years, and in both the list opened one minute before חצות plus
     half an hour on that Friday. Adding the day here can only push the opening מנין later,
     never earlier, so it cannot take a מנין off a day that had one.

     Which days bind the *evening* times is a separate question and is left alone: those are
     set by the earliest שקיעה of the run and moving that would shift times all down the
     list. */
  const minchaGedolaDays = [...new Set([...runDays.map((d) => d.serial), rh + 10])];
  const latestMinchaGedola = Math.max(
    ...minchaGedolaDays.map((serial) => Z.minchaGedolaLechumra(dateFromSerial(serial), settings))
  );
  return {
    ...afterSchedule(earliest, latestMinchaGedola, settings),
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
  /* The same two taking a traced value, so a line carries the working that made it, and one
     for the times this sheet simply has typed on it. See zmanim/trace.js. */
  const tmT = (trace, underlined = false, mark = '') => ({ text: trace.plain(), underlined, mark, trace });
  const txtT = (str, label) => ({ text: str, underlined: false, mark: '',
    trace: /^\d{1,2}:\d{2}$/.test(str) ? fixedTime(str, { label }) : null });
  const erevShkiaT = () => zman('שקיעה', erevShkia, "on ערב יום כיפור, at the shul's elevation");
  const ykShkiaT = () => zman('שקיעה', ykShkia, "on יום כיפור itself, at the shul's elevation");

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

  // `calc` names the rule behind the line, for the Calculations page: מעריב is on this
  // sheet three times over with a different rule each time, and שחרית twice, so the page
  // keys its prose on this rather than on the label.
  /* נעילה and the מנחה in front of it both hang off the 60 minute מעריב, which is where the
     sheet's afternoon is measured from, so they are built through that rather than beside it. */
  const motzei60T = ykShkiaT().plus(60);
  const neilaT = motzei60T.minus(110, 'נעילה is an hour and fifty before the 60 minute מעריב')
    .roundToStep(5, 'said as a round time, the shul being told to come at it');
  const kolNidreiT = (() => {
    const lit = erevShkiaT().minus(settings.candleLightingMinutes, 'the candle lighting offset in Settings');
    const first = lit.ceilToStep(5, 'up to the next five');
    return kolNidrei === first.value
      ? first
      : first.plus(1).ceilToStep(5, 'on to the five after that, the first one leaving less than four minutes to light in');
  })();

  const dayLines = [
    line(YK_TEXT.candles, [tmT(erevShkiaT().minus(settings.candleLightingMinutes, 'the candle lighting offset in Settings'))], { calc: 'candles' }),
    line(YK_TEXT.shkia, [tmT(erevShkiaT())], { calc: 'erevShkia' }),
    line(YK_TEXT.kolNidrei, [tmT(kolNidreiT)], { calc: 'kolNidrei' }),
    line(YK_TEXT.drasha, [tmT(erevShkiaT().plus(72).minus(30, 'half an hour before מעריב').roundToStep(5, 'said as a round time'))], { calc: 'nightDrasha' }),
    line(YK_TEXT.maariv, [tmT(erevShkiaT().plus(72))], { calc: 'nightMaariv' }),
    line(YK_TEXT.shacharis.label, [txtT(YK_TEXT.shacharis.times, 'the שחרית this sheet opens on')],
      { calc: 'shacharis', extra: { label: YK_TEXT.hamelech.label, times: [txtT(YK_TEXT.hamelech.times, 'when המלך is said, which rides on the שחרית line')] } }),
    // Earliest first, each time under the name of its own reckoning: see reckonings.js.
    line(YK_TEXT.krias.name, (() => {
      const mga = zman('סוף זמן קריאת שמע מ״א', Z.sofZmanShmaMGA72(yk, settings), 'the day measured from עלות 72 to צאת 72');
      const gra = zman('סוף זמן קריאת שמע גר״א', Z.sofZmanShmaGRA(yk, settings), 'the day measured from sunrise to שקיעה');
      return twoReckonings(mga.value, gra.value).map((r) => ({ ...tmT(r.at === mga.value ? mga : gra), name: r.name }));
    })(), { calc: 'krias' }),
    line(YK_TEXT.yizkor.label, [txtT(YK_TEXT.yizkor.times, 'announced at this time on the sheet')], { calc: 'yizkor' }),
    line(YK_TEXT.mincha, [tmT(neilaT.minus(110, 'מנחה is an hour and fifty in front of נעילה'))], { calc: 'dayMincha' }),
    line(YK_TEXT.drashaBeforeNeila, [], { calc: 'drashaBeforeNeila' }),
    line(YK_TEXT.neila, [tmT(neilaT)], { calc: 'neila' }),
    // מוצאי יו"כ. The 72 is the underlined one, the same way round the boards print a two
    // time מעריב.
    line(YK_TEXT.maariv, [tmT(motzei60T), tmT(ykShkiaT().plus(72).underline(), true), ...parseTimes(YK_TEXT.maarivGimmel.times)], { calc: 'motzeiMaariv' }),
    line(YK_TEXT.kiddushLevana.label, YK_TEXT.kiddushLevana.times.map((t) => txtT(t, 'given two ways on the sheet, after מעריב or at this time')),
      { calc: 'kiddushLevana', sep: YK_AMP }),
  ];

  // The morning after, which the calendar names and which runs five minutes early.
  const dayAfter = rh + 10;
  const nextMorning = {
    calc: 'nextMorning',
    label: `${YK_TEXT.nextMorning} ${YK_DAY_LETTERS[excelWeekday(dayAfter)]}`,
    times: fiveEarlier(everydayShacharis()),
  };

  // The box: the days between יו"כ and סוכות, the same schedule the sheet of its own gives.
  const after = buildAfterYomKippur(year, settings);

  /* The מנינים of ערב יו"כ and יו"כ, for the congregation's "what is on next". Gathered off
     the same numbers the lines above are made of, so the card and the sheet cannot disagree.
     See posters/minyanim.js for why it is done this way round.

     Left out on purpose: הדלקת נרות and שקיעה, which are זמנים; ס"ז ק"ש and יזכור, the same;
     the two דברי התעוררות, which are announcements with no time of their own to daven at;
     and קידוש לבנה, which is not a מנין and whose "אחר מעריב" is not a time at all.

     The morning after is left out too, though the sheet prints it. It is the everyday שחרית
     five minutes early, and that day's מנחה and מעריב are on the Weekday chart and nowhere
     else: claiming the day here would take those away and leave the card with a morning and
     nothing after it. The chart already carries the whole of that stretch (see
     afterYomKippurRow in sheets/weekday.js), so the day is left to it. */
  const erevOn = rh + 8;
  const dayOn = rh + 9;
  const afterOn = rh + 10;
  const M = minyanList();
  M.list(erevOn, YK_TEXT.erevShacharis.label, parseTimes(YK_TEXT.erevShacharis.times), MORNING);
  M.list(erevOn, YK_TEXT.erevMincha.label, parseTimes(YK_TEXT.erevMincha.times), AFTERNOON);
  // The night that opens יו"כ, which is ערב יו"כ's evening.
  // A זמן rather than a מנין, so its own list: see `zman` in posters/minyanim.js.
  M.zman(erevOn, YK_TEXT.candles, candles);
  M.at(erevOn, YK_TEXT.kolNidrei, kolNidrei);
  M.at(erevOn, YK_TEXT.maariv, nightMaariv);
  // The day itself, and its מוצאי.
  M.list(dayOn, YK_TEXT.shacharis.label, parseTimes(YK_TEXT.shacharis.times), MORNING);
  M.at(dayOn, YK_TEXT.mincha, neila - 110 * YK_MIN);
  M.at(dayOn, YK_TEXT.neila, neila);
  M.at(dayOn, YK_TEXT.maariv, motzei60);
  M.at(dayOn, YK_TEXT.maariv, ykShkia + 72 * YK_MIN, { underlined: true });
  /* The third מעריב carries its underline over now. It used to lose it here, because the
     label said בבית מדרש למטה in words and the card would have printed the room twice, once
     in the name and once beside it. The label is the name alone now, so the underline is the
     only thing left that knows where it is: the card spells a mark out in words (placeOf in
     posters/minyanim.js), and stripping it would leave the card saying nothing at all. */
  M.list(dayOn, YK_TEXT.maarivGimmel.label, parseTimes(YK_TEXT.maarivGimmel.times), AFTERNOON);
  // קידוש לבנה is given two ways on the sheet, אחר מעריב or a time. The words are not a time
  // and nothing can count down to them, so only the clock one goes over; clockMins reads
  // "אחר מעריב" as no time at all and it is dropped rather than guessed at.
  M.list(dayOn, YK_TEXT.kiddushLevana.label, YK_TEXT.kiddushLevana.times.map((text) => ({ text })), AFTERNOON);
  /* The morning after, and the rest of that day with it.
     The sheet prints only its שחרית, which is the everyday one five minutes early. Left at
     that the card would have had a morning and nothing after it, so the day is completed
     from the box on this very sheet: the schedule that runs from after יו"כ until סוכות,
     which is what that day's מנחה and מעריב actually are. Both come off the one poster, so
     the day cannot be half from here and half from somewhere else.
     Named שחרית rather than "שחרית יום ג'", which is the sheet's own heading: the card
     already says when it is, and the day would be said twice. */
  M.list(afterOn, YK_TEXT.shacharis.label, nextMorning.times, MORNING);
  M.list(afterOn, YK_TEXT.afterBig.mincha, after.mincha, AFTERNOON);
  M.list(afterOn, YK_TEXT.afterBig.maariv, after.maariv, AFTERNOON);

  const all = [...dayLines.flatMap((l) => l.times), ...after.mincha, ...after.maariv,
    ...after.shacharis, ...nextMorning.times, ...parseTimes(YK_TEXT.erevShacharis.times)];
  const stars = [];
  if (all.some((t) => t.mark === '*')) stars.push('*בעזרת נשים');
  if (all.some((t) => t.mark === '**')) stars.push('**באולם השמחות');

  return {
    hebrewYear: year,
    span: { from: rh + 8, to: rh + 9 },
    /* The two headings, carried on the poster rather than read off YK_TEXT by whoever is
       drawing it, because one of them moves with the year and three sheets print it: this
       one, the ראש השנה ויום כיפור pair, and the all-on-one. Worked once here and they
       cannot disagree. */
    erevHeading: YK_TEXT.erevHeading,
    dayHeading: YK_TEXT.dayHeading
      + (excelWeekday(dayOn) === YK_SHABBOS ? YK_TEXT.daySep + YK_TEXT.shabbos : ''),
    // Both are lists of מנינים rather than one זמן given two ways, so they are set with
    // commas; see the renderer.
    erevLines: [
      line(YK_TEXT.erevShacharis.label, parseTimes(YK_TEXT.erevShacharis.times), { calc: 'erevShacharis', list: true }),
      line(YK_TEXT.erevMincha.label, parseTimes(YK_TEXT.erevMincha.times), { calc: 'erevMincha', list: true }),
    ],
    dayLines,
    nextMorning,
    after,
    // ערב יו"כ's and יו"כ's מנינים, for the congregation's "what is on next". Nothing on the
    // printed sheet reads this.
    minyanim: M.out,
    zmanim: M.zmanim,
    legend: [
      all.some((t) => t.underlined)
        ? { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' } : null,
      stars.length ? { dir: 'rtl', text: stars.join(' ') } : null,
    ].filter(Boolean),
  };
}
