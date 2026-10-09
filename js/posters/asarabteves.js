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
  const serial = asaraBTevesSerial(year), date = dateFromSerial(serial);
  const friday = excelWeekday(serial) === 6;
  const netz = Z.sunriseElev(date, settings), shkia = Z.sunsetElev(date, settings);
  const rawShkia = zman('שקיעה', shkia, 'on Asara B\'Teves, at the shul\'s elevation');
  const shkiaTrace = rawShkia.ceil('show sunset at the later whole minute, never before the actual sunset');
  const shacharisLines = specialShacharisLines();
  if (asaraSelichosFirst(netz)) {
    const first = shacharisLines.flat().find(time => time.text === '6:40');
    if (first) {
      first.timeNote = ASARA_TEXT.selichosFirst;
      first.explanation = 'Sunrise is later than 7:05, twenty-five minutes after the 6:40 start. Say Selichos before Shacharis.';
    }
  }

  const last = asaraCell(friday ? fridayLateMinchaTrace(date, settings) : asaraLastMinchaTrace(shkia));
  const mincha = friday
    ? [...fridayMainMinchaParts(date, settings, serial + 1).times.map(asaraCell), last]
    : [
      asaraCell(fixedTime('12:45').underline()),
      asaraCell(fixedTime('1:15').mark('*')),
      asaraCell(fixedTime('1:35').underline()),
      asaraCell(fixedTime('1:50')),
      asaraCell(fixedTime('3:30').underline()),
      last,
    ];
  const maariv = friday ? [] : [
    asaraCell(rawShkia.plus(35, 'the first fast-day Maariv is thirty-five minutes after sunset')
      .ceil('never start before the full thirty-five minutes have elapsed')),
    asaraCell(rawShkia.plus(50, 'the downstairs Maariv is fifty minutes after sunset')
      .ceil('never start before the full fifty minutes have elapsed').underline()),
    asaraCell(fixedTime('10:30')),
  ];
  const candles = friday ? candleLightingParts(date, settings).times[0] : null;
  const sets = [
    { calc: 'shacharis', head: ASARA_TEXT.shacharis, lines: shacharisLines },
    { calc: 'mincha', head: ASARA_TEXT.mincha, lines: [mincha.slice(0, 4), mincha.slice(4)] },
    ...(candles ? [{ calc: 'candles', note: { label: ASARA_TEXT.candles, text: candles.plain(), trace: candles } }] : []),
    { calc: 'shkia', note: { label: ASARA_TEXT.shkia, text: shkiaTrace.plain(), trace: shkiaTrace } },
    ...(maariv.length ? [{ calc: 'maariv', head: ASARA_TEXT.maariv, lines: [maariv] }] : []),
  ];
  const M = minyanList();
  M.list(serial, ASARA_TEXT.shacharis, shacharisLines.flat(), MORNING);
  M.list(serial, ASARA_TEXT.mincha, mincha, AFTERNOON);
  // The Friday poster matches the reference sheet and has no weekday Maariv block.
  // The phone still needs the ordinary Friday-night Maariv, read from the winter chart.
  const fridayMaariv = friday
    ? buildChorefRow({ serial: serial + 1, specialParsha: '' }, settings).traces.F.map(asaraCell) : [];
  M.list(serial, ASARA_TEXT.maariv, friday ? fridayMaariv : maariv, AFTERNOON);
  if (candles) M.zman(serial, ASARA_TEXT.candles, candles.value);
  const all = [...shacharisLines.flat(), ...mincha, ...maariv];
  const stars = ['*', '**'].filter(mark => all.some(time => time.mark === mark));
  return {
    hebrewYear: year, title: friday ? ASARA_TEXT.fridayTitle : ASARA_TEXT.title,
    span: { from: serial, to: serial }, friday, netz, shkia, sets,
    minyanim: M.out, zmanim: M.zmanim,
    legend: [
      { dir: 'ltr', text: 'All underlined מנינים will be בבית מדרש למטה' },
      { dir: 'rtl', text: stars.map(mark => mark === '*' ? '*בעזרת נשים' : '**באולם השמחות').join(' ') },
    ].filter(line => line.text),
  };
}
