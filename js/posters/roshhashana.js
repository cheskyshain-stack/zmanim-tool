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
import { eiruvMade, eiruvRow, EIRUV_LABEL } from './eiruv.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { formatTime, floorToMinute } from '../format.js';
import { parseTimes } from './slichos.js';
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';
import { twoReckonings, nineHours } from './reckonings.js';
import { zman, fixedTime } from '../zmanim/trace.js';

const RH_MIN = 1 / 1440;
const RH_SHABBOS = 7; // excelWeekday: 1 = Sunday .. 7 = Shabbos
const RH_FRIDAY = 6;

/** ר"ה of a Hebrew year as an Excel serial, the same call the סליחות poster makes. */
const rhSerial = (year) => roshHashana(year - 3761);

/** To the nearest 5 minutes. The דרשה is announced to a round time rather than to the
 *  minute the arithmetic lands on. */
const toNearest5 = (t) => Math.round(t * 288) / 288;
/** Down to the last 5 minutes, which is how the afternoon מנחה is set. */
const downTo5 = (t) => Math.floor(t * 288 + 1e-9) / 288;

/* ט' שעות is in posters/reckonings.js, beside the ס"ז ק"ש it is set the same way as. On this
   sheet it is printed only on a first day that is Shabbos, where it stands in for the שופר
   times; the סוכות sheet prints it on every Shabbos of the festival. */

/** The lines that are wording rather than arithmetic, and the times the shul sets by hand.
 *
 *  Here rather than in settings, the same as the other two posters: these are fixed מנין
 *  slots and announcements. Everything that moves with the year is computed below. */
export const RH_TEXT = {
  title: 'ראש השנה',
  /* Two labels each, and which one is used depends on whether anything above the line has
     already said which day it is. The sheet of its own has no heading over these three, so
     the label carries the day; the sheet that holds the whole yomim noraim puts them under
     ערב ראש השנה, and there the day in the label is the same word twice on two lines
     running. `short` is the one for a block that is already named. */
  slichos: { label: 'סליחות ערב ר"ה', short: 'סליחות', times: '6:30, <u>7:10</u>' },
  chatzos: 'חצות',
  // The three lines above the days, gathered under a heading of their own. The sheet of its
  // own does not need one, since those lines are the first thing under the title; the sheet
  // that holds the whole yomim noraim does, because there every block carries a name.
  erevHeading: 'ערב ראש השנה',
  erevMincha: { label: 'מנחה ערב ראש השנה', short: 'מנחה', times: '<u>1:35</u>, 1:50, 2:15, 3:00' },
  shabbos: 'שבת',
  // Joined to the day with a dot rather than wrapped in brackets: the heading is underlined,
  // and the underline running under a bracket reads as though it is cutting through it.
  daySep: ' · ',
  // The words themselves live in posters/eiruv.js, with the rule that puts them on a sheet.
  eiruv: EIRUV_LABEL,
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
  // Only the name of the זמן. Which reckonings it is given on is carried by the times
  // themselves now, each under its own name: see posters/reckonings.js for why.
  krias: { name: 'ס"ז ק"ש' },
  nineHours: { name: "ט' שעות" },
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
  /* An עירוב תבשילין is made when a day of יום טוב is a Friday, which for ראש השנה is יום ב':
     1 תשרי falls on a Monday, Tuesday, Thursday or Saturday and never on a Friday, so the Friday
     is always the second day. It happens in תשפ"ה, תשפ"ט, תשצ"ב, תשצ"ה, תשצ"ו, תשצ"ח and תשצ"ט.

     **It prints on ערב ראש השנה, the day it is made on**, as a row of that afternoon. It was
     over the Friday itself, the day it is made *for*, and the shul reported that. One rule and
     one shape for all three sheets: see posters/eiruv.js. */
  const eiruv = eiruvMade((n) => excelWeekday(rh + n) === RH_FRIDAY, 0, 1);

  // `calc` names the rule behind the line, for the Calculations page. A label cannot do
  // it: מנחה, שקיעה and מעריב each appear more than once on this sheet with a different
  // rule each time, and the page keys its prose on this instead so it cannot describe the
  // wrong one, or quietly miss a line that was added.
  const line = (label, times, opts = {}) => ({ label, times, ...opts });
  const tm = (t, underlined = false) => ({ text: formatTime(t), underlined, mark: '' });
  const at = (t) => [tm(t)];
  /* The same two, taking a traced value instead of a bare number, so a line can carry the
     working that made it. See zmanim/trace.js. */
  const tmT = (trace, underlined = false) => ({ text: trace.plain(), underlined, mark: '', trace });
  const atT = (trace) => [tmT(trace)];
  /* A time typed into this sheet rather than worked out: the שחרית and המלך it opens on and
     the two שופר times, which are announced "בערך". They do not come through parseTimes, so
     they get the same answer here: set by the shul, not worked out from the sun. */
  const typed = (text, label) => [{
    text, underlined: false, mark: '',
    trace: /^\d{1,2}:\d{2}$/.test(text) ? fixedTime(text, { label }) : null,
  }];
  /** One זמן given both ways: earliest first, each time carrying the name of its own
   *  reckoning so the sheet can set the two under each other. See posters/reckonings.js. */
  const bothWays = (mga, gra) => twoReckonings(mga, gra).map((r) => ({ ...tm(r.at), name: r.name }));
  /* twoReckonings only orders and names the same two numbers, so each can be matched back to
     the trace it came from by value. */
  const bothWaysT = (mgaT, graT) => twoReckonings(mgaT.value, graT.value)
    .map((r) => ({ ...tmT(r.at === mgaT.value ? mgaT : graT), name: r.name }));

  // תשליך wants daylight after מנחה, so one day carries an earlier מנחה למטה as well, 50
  // minutes before the other one. It is the first day, unless that is Shabbos, when תשליך
  // is pushed off and so is this.
  const tashlichDay = shabbosDay === 0 ? 1 : 0;
  const TASHLICH_EARLIER = 50;

  /* The afternoon מנחה is one time across both days, not one worked out per day.
   *
   * It is an hour before שקיעה taken down to the last 5, and the second day's שקיעה is a
   * minute or two earlier than the first's, which is enough to cross a 5 and print two
   * different times: תשפ"ז came out 6:10 on the first day and 6:05 on the second. Two days
   * of one יום טוב with their מנחה five minutes apart is not something a shul davens or a
   * sheet should say, so the two are worked out and the later of them is printed on both.
   *
   * The later rather than the earlier, which is what was asked for and is also the safe
   * direction: the two never differ by more than the one 5 minute step the rounding can
   * put between them, so the day that moves ends up at most five minutes nearer its own
   * שקיעה, still the better part of an hour in front of it.
   *
   * The תשליך מנין follows it. That one is defined as 50 minutes before the main מנחה
   * rather than as a time of its own, so it moves with it and the gap it exists for is
   * unchanged. */
  const dayShkias = days.map((day) => Z.sunsetElev(day, settings));
  const mainMincha = Math.max(...dayShkias.map((shkia) => downTo5(shkia - 60 * RH_MIN)));
  /* Both days worked out and the later kept, which is the rule above said as a comparison so
     the page can show the day that lost as well as the one that won. */
  const minchaPerDay = dayShkias.map((shkia, i) => zman('שקיעה', shkia, `on ${RH_TEXT.day[i]} of ראש השנה, at the shul's elevation`)
    .minus(60, 'the afternoon מנחה is an hour before שקיעה')
    .floorToStep(5, 'down to the last five'));
  const mainMinchaTrace = minchaPerDay.slice(1).reduce(
    (a, b) => a.laterOf(b, 'one מנחה across both days rather than one worked out per day: the later of the two is printed on both, so a יום טוב does not print its two days five minutes apart'),
    minchaPerDay[0]);

  /* The מנינים of these three days, for the congregation's "what is on next". Gathered here
     as the sheet is built, off the same numbers, so the card and the sheet cannot disagree.
     See posters/minyanim.js for why it is done this way round and which lines are left out.

     The three lines above the days are ערב ר"ה's own: its שחרית, which is the סליחות מנין,
     and its מנחה. חצות is a זמן and is not one. */
  const M = minyanList();
  M.list(rh - 1, RH_TEXT.slichos.label, parseTimes(RH_TEXT.slichos.times), MORNING);
  M.list(rh - 1, RH_TEXT.erevMincha.label, parseTimes(RH_TEXT.erevMincha.times), AFTERNOON);

  const blocks = days.map((day, i) => {
    const night = i === 0 ? erev : days[0];
    const shkia = Z.sunsetElev(night, settings);
    const isShabbos = i === shabbosDay;
    const krias = { gra: Z.sofZmanShmaGRA(day, settings), mga: Z.sofZmanShmaMGA72(day, settings) };
    const nine = nineHours(day, settings);
    const dayShkia = dayShkias[i]; // that day's own שקיעה, which מוצאי יום טוב is worked from

    const lines = [];
    // The night that opens the day. הדלקת נרות only on the first, since the second day's
    // candles are lit from an existing flame and the sheets have never printed a time.
    /* Everything on the night that opens a day hangs off that night's own שקיעה, so they all
       start from the one traced value. */
    const nightShkia = () => zman('שקיעה', shkia, `on the evening that opens ${RH_TEXT.day[i]}, at the shul's elevation`);
    if (i === 0) lines.push(line(RH_TEXT.candles, atT(nightShkia().minus(settings.candleLightingMinutes, 'the candle lighting offset in Settings')), { calc: 'candles' }));
    if (i === 0) lines.push(line(RH_TEXT.mincha, atT(nightShkia().minus(15)), { calc: 'nightMincha' }));
    lines.push(line(RH_TEXT.shkia, atT(nightShkia()), { calc: 'nightShkia' }));
    if (i === 0) lines.push(line(RH_TEXT.drasha, atT(nightShkia().plus(30).roundToStep(5, 'said as a round time, the shul being told to come at it')), { calc: 'nightDrasha' }));
    lines.push(line(RH_TEXT.maariv, atT(nightShkia().plus(60)), { calc: 'nightMaariv' }));
    // These two are on the evening that opens the day, which is the day before it: under
    // "יום א'" that is ערב ר"ה, under "יום ב'" the first day. Getting that wrong is the one
    // way this could be a whole day out, so it is taken from the same `night` the שקיעה
    // above is worked out from rather than from the block's own index.
    const nightOn = rh + i - 1;
    // הדלקת נרות is a זמן rather than a מנין, so it goes in the list of its own: see the note
    // on `zman` in posters/minyanim.js. The congregation's home page shows it beside the next
    // מנין on an ערב יום טוב the same way it does on an ערב שבת.
    if (i === 0) M.zman(nightOn, RH_TEXT.candles, shkia - settings.candleLightingMinutes * RH_MIN);
    if (i === 0) M.at(nightOn, RH_TEXT.mincha, shkia - 15 * RH_MIN);
    M.at(nightOn, RH_TEXT.maariv, shkia + 60 * RH_MIN);

    // The morning.
    // המלך rides on the שחרית line as a second label and time, not as one run of text, so
    // it gets the same gap between word and time that every other row has.
    lines.push(line(RH_TEXT.shacharis.label, typed(RH_TEXT.shacharis.times, 'the שחרית this sheet opens on'),
      { calc: 'shacharis',
        extra: { label: RH_TEXT.hamelech.label, times: typed(RH_TEXT.hamelech.times, 'when המלך is said, which rides on the שחרית line') } }));
    lines.push(line(RH_TEXT.krias.name, bothWaysT(
      zman('סוף זמן קריאת שמע מ״א', krias.mga, 'the day measured from עלות 72 to צאת 72'),
      zman('סוף זמן קריאת שמע גר״א', krias.gra, 'the day measured from sunrise to שקיעה'),
    ), { calc: 'krias' }));

    // Shabbos has no שופר: the דרשה moves to before מוסף and ט' שעות is printed instead.
    if (isShabbos) {
      lines.push(line(RH_TEXT.drashaBeforeMusaf, [], { calc: 'drashaBeforeMusaf' }));
      lines.push(line(RH_TEXT.nineHours.name, bothWaysT(
        zman("ט' שעות מ״א", nine.mga, 'nine proportional hours into a day measured from עלות 72 to צאת 72'),
        zman("ט' שעות גר״א", nine.gra, 'nine proportional hours into a day measured from sunrise to שקיעה'),
      ), { calc: 'nineHours' }));
    } else {
      lines.push(line(RH_TEXT.drashaBeforeShofar, [], { calc: 'drashaBeforeShofar' }));
      lines.push(line(RH_TEXT.shofar.label, typed(RH_TEXT.shofar.times, 'announced בערך, so it is said as an approximate time rather than worked out'), { calc: 'shofar' }));
      lines.push(line(RH_TEXT.shofarWomen.label, typed(RH_TEXT.shofarWomen.times, 'announced בערך, so it is said as an approximate time rather than worked out'), { calc: 'shofarWomen' }));
    }

    // The afternoon מנחה, the same on both days (see mainMincha above), with the earlier
    // תשליך one in front of it on the day that has one.
    lines.push(line(RH_TEXT.mincha, i === tashlichDay
      ? [tmT(mainMinchaTrace.minus(TASHLICH_EARLIER, 'the תשליך מנין is defined as this far before the main מנחה rather than as a time of its own, so it moves with it and the daylight it exists for is unchanged').underline(), true), tmT(mainMinchaTrace)]
      : atT(mainMinchaTrace), { calc: 'dayMincha' }));

    // The morning and the afternoon, on the day itself. שחרית is typed rather than computed,
    // so it says which half of the day it is in; המלך rides on that line and is not a מנין of
    // its own. ס"ז ק"ש, ט' שעות, the שופר times and the דרשות are זמנים and announcements.
    const dayOn = rh + i;
    M.list(dayOn, RH_TEXT.shacharis.label, parseTimes(RH_TEXT.shacharis.times), MORNING);
    if (i === tashlichDay) M.at(dayOn, RH_TEXT.mincha, mainMincha - TASHLICH_EARLIER * RH_MIN, { underlined: true });
    M.at(dayOn, RH_TEXT.mincha, mainMincha);

    // מוצאי יו"ט, the only place the 72 minute צאת is printed. The 72 is the underlined one,
    // which is the same way round the boards print a two time מעריב (see calculations-view).
    if (i === 1) {
      const motzei = () => zman('שקיעה', dayShkia, `on ${RH_TEXT.day[i]} itself, at the shul's elevation`);
      lines.push(line(RH_TEXT.maariv, [tmT(motzei().plus(60)), tmT(motzei().plus(72).underline(), true)], { calc: 'motzeiMaariv' }));
      M.at(dayOn, RH_TEXT.maariv, dayShkia + 60 * RH_MIN);
      M.at(dayOn, RH_TEXT.maariv, dayShkia + 72 * RH_MIN, { underlined: true });
    }

    return {
      heading: [RH_TEXT.day[i], ...(isShabbos ? [RH_TEXT.shabbos] : [])].join(RH_TEXT.daySep),
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
    /* The ערב ראש השנה block's own rows, so both sheets that draw them draw the same list and
       the עירוב row cannot be on one and not the other. They were written out in the renderer
       off RH_TEXT, which cannot know the year, and this row does. */
    erevHeading: RH_TEXT.erevHeading,
    erevLines: [
      { label: RH_TEXT.slichos.label, times: parseTimes(RH_TEXT.slichos.times) },
      { label: RH_TEXT.chatzos, times: [{ text: formatTime(floorToMinute(Z.solarNoon(erev, settings))), underlined: false, mark: '' }] },
      { label: RH_TEXT.erevMincha.label, times: parseTimes(RH_TEXT.erevMincha.times) },
      ...eiruvRow(eiruv),
    ],
    // חצות is cut to the minute rather than rounded. Both sheets settle it: 12:52.25 and
    // 12:49.58, printed as 12:52 and 12:49. Rounding the second gives 12:50, which is a
    // minute later than חצות really is, and no printed זמן should say that.
    chatzos: formatTime(floorToMinute(Z.solarNoon(erev, settings))),
    blocks,
    // The three days' מנינים, for the congregation's "what is on next". Nothing on the
    // printed sheet reads this.
    minyanim: M.out,
    zmanim: M.zmanim,
  };
}
