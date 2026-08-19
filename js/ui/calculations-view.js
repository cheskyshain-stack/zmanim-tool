// Every column on every chart, and how its times are worked out.
//
// Two readers at once. The plain rule is in the shul's own terms, for checking that the
// board says what it should. The exact rule under it is the formula as the code has it,
// for checking the port against the workbook. Neither has to read the other's half.
//
// The columns themselves are not listed here. They come from the same KAYITZ_COLUMNS,
// CHOREF_COLUMNS and WEEKDAY_COLUMNS the charts are built from, so this page cannot
// describe a column that no longer exists or quietly miss one that was added: a column
// with no prose still gets a card, saying in as many words that it has not been written
// up. That is deliberate rather than a gap. A page that silently omitted it would look
// complete while being wrong, and the test watches for that sentence.
//
// The worked examples are not written down either: they are produced by calling the real
// build functions for a real week, so a number on this page is the number on that board.

import { KAYITZ_COLUMNS, buildKayitzRow } from '../sheets/kayitz.js';
import { CHOREF_COLUMNS, buildChorefRow } from '../sheets/choref.js';
import { WEEKDAY_COLUMNS, buildWeekdayRow } from '../sheets/weekday.js';
import { currentSerial } from './nav-helpers.js';
import { resolveSettings } from '../settings.js';
import { UL_START, UL_END } from '../format.js';

const calcEsc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A built cell as readable text: the underline sentinels become an <u>, the line breaks
 *  become real ones. Same content the chart prints, without the chart. */
function cellHtml(text) {
  if (!text) return '<span class="calc-blank">(blank that week)</span>';
  // Escaped first. The underline sentinels are private use characters, so escaping cannot
  // touch them, and swapping them for tags afterwards cannot let anything else through.
  return calcEsc(text)
    .split(UL_START)
    .join('<u>')
    .split(UL_END)
    .join('</u>')
    .split('\n')
    .join('<br>');
}

/** A rule is either the words themselves or a function of the settings, for the few that
 *  quote a number a person can change. */
const text = (rule, settings) => (typeof rule === 'function' ? rule(settings) : rule);

/** Every Hebrew run in an English sentence, isolated.
 *
 *  Done here rather than by hand because these rules are nearly all English sentences with
 *  Hebrew words in them, and every one of those words is a chance to get it wrong. Left
 *  plain, a neutral character next to the Hebrew is absorbed into it and moves: "worked
 *  from שקיעה: 45 minutes" rendered as "worked from 45 :שקיעה minutes", with the colon
 *  jumping the number. Measured before and after, not guessed.
 *
 *  Runs of Hebrew letters are taken whole, along with the geresh and gershayim inside
 *  abbreviations like גר״א and the spaces between words of one phrase, so הדלקת נרות is
 *  one isolated run rather than two. */
const HEBREW_RUN = /[\u0590-\u05FF]+(?:[ \u0590-\u05FF\u05F3\u05F4"']*[\u0590-\u05FF]+)*/g;
const isolateHebrew = (html) => html.replace(HEBREW_RUN, (run) => `<bdi>${run}</bdi>`);

// --- what each column is ---------------------------------------------------------------
// Keyed by the column key the chart uses. `plain` is the rule in words; `exact` is the
// formula. Both are prose: the numbers in them are the fixed times written into the
// formulas, and anything a person can change in Settings is filled in from Settings at
// render time rather than written down here.

const SHARED = {
  B: {
    plain: 'Motzei Shabbos מעריב. Two times: 60 minutes after שקיעה, then 72 minutes after it. The 72 is underlined, so it davens למטה.',
    exact: 'צאת 60 and צאת 72, both measured from שקיעה at the shul\'s elevation, each rounded up to the whole minute, printed with a slash between them. The second is underlined.',
  },
  C: {
    plain:
      'Shabbos afternoon מנחה. It starts at 1:40 on daylight saving time and 1:20 on standard time. Then 5:30, 6:00 and 6:30, each printed only once שקיעה is late enough for it. Then two more worked from שקיעה: 45 minutes before it, and 30 minutes before it. Printed over two lines.',
    exact:
      'First 1:40 when DST is in force, otherwise 1:20. Then each of 5:30, 6:00 and 6:30 is kept only if 5:30pm, 6:00pm or 6:30pm respectively is at or before שקיעה minus one hour; the kept ones are underlined. Then the earlier of (שקיעה minus 45 minutes, rounded up) and 7:00, and the earlier of (שקיעה minus 30 minutes, rounded up) and 7:30, the second underlined. Rounded up rather than down, which is what the workbook does here and nowhere else. The list is split across two lines, the longer half second.',
  },
  D: {
    plain:
      'סוף זמן קריאת שמע, both opinions. The earlier of the two is the מגן אברהם, whose day runs from עלות; the later is the גר״א, whose day runs from sunrise.',
    exact:
      'סוף זמן שמע מ״א with the day measured from עלות 72 minutes to צאת 72 minutes, then סוף זמן שמע גר״א from sunrise to שקיעה, printed with a slash between them in that order.',
  },
  E: {
    plain: 'שחרית. The same two times every week, 7:30 and 8:15, with 7:30 underlined for למטה. Nothing about it is worked out from the date.',
    exact: 'The literal string 7:30 / 8:15, the 7:30 underlined, with no-break spaces around the slash so it can never wrap.',
  },
  H: {
    plain: (settings) =>
      `הדלקת נרות, with שקיעה printed underneath it. Candle lighting is ${settings.candleLightingMinutes} minutes before שקיעה, which is the offset set in Settings: change it there and every Friday on every chart moves with it.`,
    exact:
      'שקיעה at the shul\'s elevation, rounded down to the whole minute, is the second line. The first line is that time less the candle lighting offset from Settings.',
  },
};

const KAYITZ_RULES = {
  ...SHARED,
  F: {
    plain: 'Friday מעריב, 50 minutes after שקיעה. Between Pesach and Shavuos it is 55 minutes instead.',
    exact:
      'שקיעה on the Friday plus 50 minutes, rounded down, underlined. Inside the Sefirah window the offset is 55 rather than 50. That window is Hebrew day-of-year above 16 and below 65, measured on the Friday.',
  },
  G: {
    plain:
      'The מנחה that runs straight into מעריב, 15 minutes before שקיעה. Between Pesach and Shavuos a second מעריב is printed under it, half an hour after שקיעה.',
    exact:
      'שקיעה on the Friday less 15 minutes, rounded down. In the same Sefirah window as column מעריב, a second line reading מעריב followed by שקיעה plus 30 minutes, rounded down.',
  },
  I: {
    plain:
      'The פלג מנחה that davens בעזרת נשים, on the מגן אברהם\'s פלג with the day ending at צאת 72. Printed 15 minutes before the פלג, with the פלג itself under it. Only in the season when the early minyanim run.',
    exact:
      'פלג המנחה with the day running from עלות 16.1 degrees to צאת 72 minutes. The first line is that less 15 minutes, rounded up; the second is the word פלג and the פלג itself, rounded up. Blank outside the פלג window.',
  },
  J: {
    plain: 'The same thing למטה, but on the פלג with the day ending at צאת 50 rather than 72, so it is a little earlier.',
    exact:
      'פלג המנחה with the day running from עלות 16.1 degrees to צאת 50 minutes. First line that less 15 minutes, rounded up and underlined; second line the פלג itself. Blank outside the פלג window.',
  },
  K: {
    plain: 'The same again on the גר״א\'s פלג, which measures the day from sunrise to שקיעה.',
    exact:
      'פלג המנחה גר״א for the Friday. First line that less 15 minutes, rounded up; second line the פלג itself. Blank outside the פלג window.',
  },
  L: {
    plain:
      'The main ערב שבת מנחה. On standard time it opens with 12:30 and 1:00. Then an early one around 1:15, then 1:35, then 1:50, 2:15 and 3:00. The early ones never come out before מנחה גדולה: where the clock time would be too early, מנחה גדולה is printed instead.',
    exact:
      'Built from מנחה גדולה לחומרא, which is the later of מנחה גדולה and half an hour after חצות. On standard time only: the later of 12:30 and מנחה גדולה לחומרא, then 1:00. Then, only when מנחה גדולה לחומרא is before 1:20, the later of it and 1:15. Then מנחה גדולה לחומרא if it is after 1:35, otherwise 1:35. Then the fixed 1:50, 2:15 and 3:00. Everything except the last three is underlined. Split across two lines, the longer half second.',
  },
};

const CHOREF_RULES = {
  ...SHARED,
  F: {
    plain: 'Friday מעריב, 50 minutes after שקיעה. No Sefirah exception here: in the winter season that stretch does not arise.',
    exact: 'שקיעה on the Friday plus 50 minutes, rounded down, underlined.',
  },
  G: {
    plain:
      'The Friday מנחה. Through most of the winter it is the single time 15 minutes before שקיעה. Once the early minyanim start running, three פלג times are printed before it on the same line: the גר״א\'s פלג, then the מגן אברהם\'s to צאת 50, then to צאת 72, each 15 minutes early.',
    exact:
      'Outside the פלג window: שקיעה less 15 minutes, rounded down. Inside it, four times joined by slashes: פלג גר״א less 15, פלג with the day ending at צאת 50 less 15, פלג with the day ending at צאת 72 less 15, and שקיעה less 15 rounded down. The three פלג values are not rounded to the minute before the 15 is taken off.',
  },
  I: KAYITZ_RULES.L,
};

const WEEKDAY_RULES = {
  B: {
    plain:
      'The weekday מעריב times, one row for the whole week. The regular list is 6:35, 7:00, 7:30, 8:00, 8:45, 9:30, 10:00, 10:30, 11:00, and 11:30 and 12:00 while BMG is out of session. Every one of them has to be at least 50 minutes after שקיעה on all five days, so as the days lengthen each is pushed later in 5 minute steps until it clears. A time pushed up to within a quarter of an hour of the next one stops being printed. All of them are למטה except 10:30, which is the main בית מדרש, and the 8:45.',
    exact:
      'Sunday through Thursday of the week ending on this Shabbos. The binding שקיעה is the latest of the five, rounded up; a time must be at or after that plus 50 minutes. Each time steps forward by 5 minutes until it does. Then, walking from the last time backwards, a time that moved and now sits within 14 minutes of the next one still being kept is dropped. The 8:45 is exempt from that, being its own מנין rather than a duplicate; it is in the main בית מדרש up to 8:45, למטה from 8:50 to 9:15, and בעזרת נשים from 9:20.',
  },
  C: {
    plain:
      'The weekday מנחה times. The regular list is 12:45 and 1:15 on standard time only, then an early afternoon one, then 1:50, then 4:15 while BMG is in session, then 6:35, 7:30 and 8:00. The evening ones have to be at least 15 minutes before שקיעה on all five days, so they are pulled earlier in 5 minute steps as the days shorten, and one that lands within a quarter of an hour of the one before it stops being printed. Everything is למטה except 1:50, the main בית מדרש.',
    exact:
      'Sunday through Thursday of the week ending on this Shabbos. 12:45 and 1:15 only when none of the five days is on DST. The early afternoon time is 1:35, or 1:40 if מנחה גדולה לחומרא is after 1:35 on any of the five days. 4:15 only in a BMG week. The binding שקיעה is the earliest of the five, rounded down; an evening time must be at or before that less 15 minutes, and steps back by 5 minutes until it is. A time that moved and sits within 14 minutes of the one before it is dropped.',
  },
  E: {
    plain:
      'שחרית on the weekday chart is not worked out at all. It is one merged cell down the whole chart, holding whatever is typed into Settings, so the daily schedule is written once rather than computed.',
    exact:
      'Taken from the שחרית field in Settings, rendered as the small markup subset that field stores. A week carrying a fast or a Rosh Chodesh uses the second field instead.',
  },
};

const CHARTS = [
  { key: 'kayitz', name: 'שבת קיץ', columns: KAYITZ_COLUMNS, rules: KAYITZ_RULES, build: buildKayitzRow,
    note: 'Pesach to Sukkos. The early פלג minyanim run for part of it, which is why it has four מנחה columns the winter chart does not.' },
  { key: 'choref', name: 'שבת חורף', columns: CHOREF_COLUMNS, rules: CHOREF_RULES, build: buildChorefRow,
    note: 'Sukkos to Pesach. A page holding a week past the spring clock change prints as a full שבת קיץ chart instead, so the last page of a winter season can be a summer one.' },
  { key: 'weekday', name: 'Weekday', columns: WEEKDAY_COLUMNS, rules: WEEKDAY_RULES, build: buildWeekdayRow,
    note: 'One row per week, covering Sunday through Thursday. Every time on it has to work for all five days at once, which is what makes it the only chart whose times move themselves.' },
];

/** Printed order, left to right. The chart reverses the workbook's B..L so that reading
 *  right to left after the parsha follows the week forward; this lists them the way they
 *  appear across the page. */
const printedOrder = (columns) => [...columns].reverse();

/** A week to work the examples on: whichever the rest of the app is showing, if this
 *  chart covers it, and otherwise the nearest one that chart has. */
function exampleWeek(state, season) {
  const sheets = (state.sheets || []).filter((s) => (season === 'weekday' ? s.season === 'weekday' : s.season === season));
  const weeks = sheets.flatMap((s) => s.weeks || []);
  if (!weeks.length) return null;
  const serial = currentSerial(weeks.map((w) => w.serial));
  const found = weeks.find((w) => w.serial === serial) || weeks[0];
  return { ...found, date: new Date(found.date) };
}

const fmtWeek = (week) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(week.date);

function chartHtml(chart, state, settings) {
  const week = exampleWeek(state, chart.key);
  let row = {};
  if (week) {
    try {
      row = chart.build(week, settings) || {};
    } catch {
      row = {};
    }
  }

  const entries = printedOrder(chart.columns)
    .map(({ key, header }) => {
      const rule = chart.rules[key];
      const worked = week && key in row
        ? `<div class="calc-worked"><span class="calc-worked-label">That week it comes out</span><span class="calc-worked-value">${cellHtml(row[key])}</span></div>`
        : '';
      return `
        <div class="calc-col">
          <div class="calc-col-head">
            <bdi class="calc-col-name">${calcEsc(String(header).replace(/\n/g, ' '))}</bdi>
            <span class="calc-col-key">column ${calcEsc(key)}</span>
          </div>
          <p class="calc-plain">${rule ? isolateHebrew(text(rule.plain, settings)) : 'Not written up yet.'}</p>
          ${worked}
          ${rule ? `<details class="calc-exact"><summary>The exact rule</summary><p>${isolateHebrew(text(rule.exact, settings))}</p></details>` : ''}
        </div>`;
    })
    .join('');

  const which = week
    ? `<p class="hint">Worked through on <strong>${calcEsc(fmtWeek(week))}</strong>, the week this chart is on now.</p>`
    : '<p class="hint">Generate a season and each column will show what it comes out to that week.</p>';

  return `
    <details class="panel calc-chart" data-chart="${chart.key}">
      <summary><bdi>${calcEsc(chart.name)}</bdi></summary>
      <div class="panel-body">
        <p class="hint">${isolateHebrew(chart.note)}</p>
        ${which}
        <div class="calc-cols">${entries}</div>
      </div>
    </details>`;
}

export function renderCalculations(container, state, onOpenTab) {
  const settings = resolveSettings(state.settings);
  container.innerHTML = `
    <h2>Calculations</h2>
    <p class="hint">Every column on every chart, and how its times are worked out.</p>

    <div class="guide-lede">
      <p>Two answers for each one. The plain rule is what the column is, in the shul's terms. <strong>The exact rule</strong> under it is the formula as the program has it, down to the rounding, for checking against the workbook.</p>
      <p>The numbers beside each rule are not written here: they are produced by running the real formula on a real week, so a time on this page is the time on that board.</p>
    </div>

    <p class="hint calc-not-rules">This is not the <button type="button" class="linkish" id="calc-to-rules">Rules in Settings</button>. Those are the shul's own exceptions, the ones that add דרשה on שבת הגדול and mark ט באב, applied on top of everything below. What is here is the calculation underneath, which is the same every year and is not editable: it comes from the workbook the boards were always made from.</p>

    ${CHARTS.map((c) => chartHtml(c, state, settings)).join('')}

    <details class="panel">
      <summary>Things that are true of every column</summary>
      <div class="panel-body">
        <p><strong>Where the sun is</strong> comes from the שול's location, elevation and timezone in Settings, so moving those moves every time on every chart.</p>
        <p><strong>Underlined</strong> means the מנין davens בבית מדרש למטה. It is set by the formula, not typed, except where a cell has been typed over by hand.</p>
        <p><strong>Friday columns are worked on the Friday</strong>, not on the Shabbos the row is named for. The Shabbos columns are worked on the Shabbos.</p>
        <p><strong>ט באב</strong> is added automatically when the 9th of Av falls on that Shabbos, to the Shabbos מנחה and the motzei Shabbos מעריב. It is a fact of the calendar rather than a rule anyone set, so it is not in the rules list and cannot be switched off.</p>
        <p><strong>Then the rules, then anything typed.</strong> A rule from Settings is applied to the computed value, and a cell typed over by hand wins over both.</p>
      </div>
    </details>
  `;

  container.querySelector('#calc-to-rules')?.addEventListener('click', () => onOpenTab('settings'));
}
