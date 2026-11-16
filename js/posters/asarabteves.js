// Asara B'Teves, using the shul's weekday and Friday rules. The older Word sheets
// are reference examples; the current chart owns the standing morning and Friday lists.
import { dateFromHebrew, excelWeekday } from '../hebrew-calendar.js';
import { dateFromSerial } from '../zmanim/solar.js';
import * as Z from '../zmanim/zmanim.js';
import { fridayMainMinchaParts, candleLightingParts, asaraLastMinchaTrace, fridayLateMinchaTrace } from '../sheets/common.js';
import { buildChorefRow } from '../sheets/choref.js';
import { specialShacharisLines } from './special-shacharis.js';
import { minyanList, MORNING, AFTERNOON } from './minyanim.js';
import { fixedTime, zman } from '../zmanim/trace.js';

export const ASARA_TEXT = {
  title: 'עשרה בטבת',
  fridayTitle: 'עשרה בטבת · ערב שבת',
  shacharis: 'שחרית',
  selichosFirst: 'סליחות קודם שחרית',
  mincha: 'מנחה',
  candles: 'הדלקת נרות',
  shkia: 'שקיעה',
  maariv: 'מעריב',
};

export const asaraBTevesSerial = (year) => dateFromHebrew(10, 10, year);

/** The 6:40 minyan reaches its usual twenty-five-minute point at 7:05. */
export const asaraSelichosFirst = (netz) => netz > (7 * 60 + 5) / 1440 + 1e-9;

function asaraCell(trace) {
  return { text: trace.plain(), underlined: Boolean(trace.flags.underlined), mark: trace.flags.mark || '', trace };
}

export function buildAsaraBTevesPoster(year, settings) {
  if (!year) return null;
  return buildFastDayPoster(year, settings, asaraBTevesSerial(year), ASARA_TEXT);
}

/** The same fast-day timing rules, evaluated on the chosen fast's actual date. */
export function buildFastDayPoster(year, settings, serial, labels) {
  if (!year) return null;
  const date = dateFromSerial(serial);
  const friday = excelWeekday(serial) === 6;
  const netz = Z.sunriseElev(date, settings), shkia = Z.sunsetElev(date, settings);
  const rawShkia = zman('שקיעה', shkia, `on ${labels.title}, at the shul's elevation`);
  const shkiaTrace = rawShkia.ceil('show sunset at the later whole minute, never before the actual sunset');
  const shacharisLines = specialShacharisLines();
  if (asaraSelichosFirst(netz)) {
    const first = shacharisLines.flat().find(time => time.text === '6:40');
    if (first) {
      first.timeNote = labels.selichosFirst;
      first.explanation = 'Sunrise is later than 7:05, twenty-five minutes after the 6:40 start. Say Selichos before Shacharis.';
    }
  }

  const last = asaraCell(friday ? fridayLateMinchaTrace(date, settings) : asaraLastMinchaTrace(shkia, false, labels.title));
  const gedola = zman('מנחה גדולה לחומרא', Z.minchaGedolaLechumra(date, settings), 'on the fast day, using the configured shul location');
  const earlyMincha = fixedTime(gedola.value <= 13.25 / 24 ? '1:15' : '1:20')
    .mark('*').onlyWhen(gedola.value <= (13 + 20 / 60) / 24, 'The 1:15/1:20 minyan must not precede Mincha Gedola Lechumra');
  const standingMincha = [
    fixedTime('12:45').underline().onlyWhen(gedola.value <= 12.75 / 24, '12:45 runs only after Mincha Gedola Lechumra'),
    earlyMincha,
    fixedTime('1:35').laterOf(gedola.ceilToStep(5, 'Advance to a five-minute time after Mincha Gedola Lechumra'),
      'The early downstairs Mincha cannot start before Mincha Gedola Lechumra').underline(),
    fixedTime('1:50').onlyWhen(gedola.value <= (13 + 50 / 60) / 24, '1:50 runs only after Mincha Gedola Lechumra'),
    fixedTime('3:30').underline().onlyWhen(gedola.value <= 15.5 / 24, '3:30 runs only after Mincha Gedola Lechumra'),
  ].filter(trace => trace.text()).map(asaraCell);
  const mincha = friday
    ? [...fridayMainMinchaParts(date, settings, serial + 1).times.map(asaraCell), last]
    : [...standingMincha, last];
  const maariv = friday ? [] : [
    asaraCell(rawShkia.plus(35, 'the first fast-day Maariv is thirty-five minutes after sunset')
      .ceil('never start before the full thirty-five minutes have elapsed')),
    asaraCell(rawShkia.plus(50, 'the downstairs Maariv is fifty minutes after sunset')
      .ceil('never start before the full fifty minutes have elapsed').underline()),
    asaraCell(fixedTime('10:30')),
  ];
  const candles = friday ? candleLightingParts(date, settings).times[0] : null;
  const sets = [
    { calc: 'shacharis', head: labels.shacharis, lines: shacharisLines },
    { calc: 'mincha', head: labels.mincha, lines: [mincha.slice(0, 4), mincha.slice(4)].filter(line => line.length) },
    ...(candles ? [{ calc: 'candles', note: { label: labels.candles, text: candles.plain(), trace: candles } }] : []),
    { calc: 'shkia', note: { label: labels.shkia, text: shkiaTrace.plain(), trace: shkiaTrace } },
    ...(maariv.length ? [{ calc: 'maariv', head: labels.maariv, lines: [maariv] }] : []),
  ];
  const M = minyanList();
  M.list(serial, labels.shacharis, shacharisLines.flat(), MORNING);
  M.list(serial, labels.mincha, mincha, AFTERNOON);
  // The Friday poster matches the reference sheet and has no weekday Maariv block.
  // The phone still needs the ordinary Friday-night Maariv, read from the winter chart.
  const fridayMaariv = friday
    ? buildChorefRow({ serial: serial + 1, specialParsha: '' }, settings).traces.F.map(asaraCell) : [];
  M.list(serial, labels.maariv, friday ? fridayMaariv : maariv, AFTERNOON);
  if (candles) M.zman(serial, labels.candles, candles.value);
  const all = [...shacharisLines.flat(), ...mincha, ...maariv];
  const stars = ['*', '**'].filter(mark => all.some(time => time.mark === mark));
  return {
    hebrewYear: year, title: friday ? labels.fridayTitle : labels.title,
    span: { from: serial, to: serial }, friday, netz, shkia, sets,
    minyanim: M.out, zmanim: M.zmanim,
    legend: [
      { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' },
      { dir: 'rtl', text: stars.map(mark => mark === '*' ? '*בעזרת נשים' : '**באולם השמחות').join(' ') },
    ].filter(line => line.text),
  };
}
