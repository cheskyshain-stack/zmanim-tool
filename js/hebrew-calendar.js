// Hebrew calendar engine, ported 1:1 from the workbook's own defined names
// (ROSH_HASHANA, JEWISH_DATE_AS_ARRAY_EXTENDED, GET_DATE_FROM_JEWISH_DATE_ARRAY,
// HAS_PARSHA, HAS_SPECIAL_PARSHA, HAS_YOM_TOV, HAS_ROSH_CHODESH). Fully self-contained
// (no external calendar library) so results match the source workbook exactly,
// including its specific special-Shabbos day-of-year definitions.
import { excelSerial } from './zmanim/solar.js';

/** Excel MOD: result takes the sign of the divisor (n - d*FLOOR(n/d)), unlike JS %. */
function mod(n, d) {
  return n - d * Math.floor(n / d);
}
/** Excel WEEKDAY(serial) in its default mode: 1=Sunday .. 7=Saturday. Calibrated
 *  directly against this file's own excelSerial() numbering (verified against a known
 *  Saturday) rather than assumed - matches the same mod(x-1,7)+1 pattern the workbook
 *  itself uses inline for rhdow in HAS_PARSHA. */
export function excelWeekday(serial) {
  return mod(Math.floor(serial) - 1, 7) + 1;
}

export const JEWISH_MONTHS_HE = ['ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול', 'תשרי', 'חשון', 'כסלו', 'טבת', 'שבט', 'אדר', 'אדר א׳', 'אדר ב׳'];
export const JEWISH_MONTHS_EN = ['Nissan', 'Iyar', 'Sivan', 'Tammuz', 'Av', 'Elul', 'Tishrei', 'Cheshvan', 'Kislev', 'Teves', 'Shevat', 'Adar', 'Adar I', 'Adar II'];

/** ROSH_HASHANA(x): molad-based date of Rosh Hashana for AM year (x+3761), including
 *  the four dechiyos (postponement rules), baked into this closed-form arithmetic.
 *  Returns an Excel-style serial date (compatible with excelSerial()/dateFromSerial()). */
export function roshHashana(x) {
  const year = x + 3761;
  const molad = 57444 + 9185196 * (year - 1) + 765433 * Math.floor((year * 7 - 6) / 19);
  const moladMod = mod(molad, 181440);
  const t1 = Math.floor(molad / 25920 + 0.25);
  const t2 = mod(Math.floor(mod(molad / 25920 - 2.75, 7)), 2);
  const t3 = mod(year * 7 + 1, 19) > 6 && moladMod >= 87684 && moladMod < 97200 ? 2 : 0;
  const t4 = mod((year - 1) * 7 + 1, 19) < 7 && moladMod >= 68629 && moladMod < 71280 ? 1 : 0;
  return t1 + t2 + t3 + t4 - 2067023;
}

/** YEAR_ETERNAL: proleptic Gregorian year for an Excel serial date. */
function yearEternal(serial, useGregorianBefore1582) {
  const I = Math.floor(serial);
  const a = Math.floor((I + 547803) / 36524.25);
  const gregorianCorrection = useGregorianBefore1582 || I > -115859;
  const b = I + (gregorianCorrection ? a + 1 - Math.floor(a / 4) : 0) + 1510;
  const C = Math.floor((b - 122.1) / 365.25);
  return C + 1897 - (Math.floor((b - Math.floor(365.25 * C)) / 30.6) < 14 ? 1 : 0);
}

/** JEWISH_DATE_AS_ARRAY_EXTENDED: full Hebrew-date breakdown for an Excel serial date. */
export function hebrewDateExtended(serial, useGregorianBefore1582 = false) {
  const date = Math.floor(serial);
  const yEternal = yearEternal(date, useGregorianBefore1582);
  const year = yEternal + 3760 + (roshHashana(yEternal) <= date ? 1 : 0);
  const rh = roshHashana(year - 3761);
  const yearLength = roshHashana(year - 3760) - rh;
  const dateAfterRH = date - rh + 1;
  const yearType = mod(yearLength, 10);
  const leap = mod(7 * year + 1, 19) < 7;
  const d = mod(dateAfterRH + 176, yearLength) + 1;
  let dayOfYear;
  if (yearType === 3 && d > 265) dayOfYear = d + 1;
  else if (yearType === 5) dayOfYear = d > 237 ? d - 1 : d === 237 ? 0 : d;
  else dayOfYear = d;
  let month, dayOfMonth;
  if (dayOfYear === 0) {
    month = 8;
    dayOfMonth = 30;
  } else if (dayOfYear >= 326 && leap) {
    month = Math.floor((dayOfYear - 31) / 29.5) + 3;
    dayOfMonth = Math.floor(mod(dayOfYear - 31, 29.5)) + 1;
  } else {
    month = Math.floor((dayOfYear - 1) / 29.5) + 1;
    dayOfMonth = Math.floor(mod(dayOfYear - 1, 29.5)) + 1;
  }
  return { dayOfMonth, month, year, dayOfYear, leap, yearType, roshHashana: rh, yearLength };
}

/** GET_DATE_FROM_JEWISH_DATE_ARRAY: Hebrew (day, month, year-AM) -> Excel serial date.
 *  Month numbering follows the workbook/Torah convention: Nissan=1 .. Adar=12,
 *  Adar I=13, Adar II=14 (leap years only). */
export function dateFromHebrew(day, month, year) {
  const leap = mod((year - 1) * 7 + 1, 19) < 7;
  const yearLength = roshHashana(year - 3760) - roshHashana(year - 3761);
  const yearType = mod(yearLength, 10);
  const monthTerm = leap && month >= 12 ? Math.floor((month - 2) * 29.5 + 1) : Math.floor(month * 29.5 - 29);
  let adj = 0;
  if (yearType === 3 && month >= 10) adj = -1;
  else if (yearType === 5 && month >= 9) adj = 1;
  const sum = -177 + monthTerm + adj + (day - 1);
  return roshHashana(year - 3761) + mod(sum, yearLength);
}

/** JEWISH_DATE display string, e.g. "כה אדר, תשפו" / "25 Adar, 5786". */
function hebrewNumber(n) {
  // __HEBREW_NUMBER, simplified to the numeral forms actually needed here (1-30, years).
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
  let num = n;
  let out = '';
  while (num >= 400) { out += 'ת'; num -= 400; }
  out += hundreds[Math.floor(num / 100)]; num %= 100;
  out += tens[Math.floor(num / 10)]; num %= 10;
  out += ones[num];
  out = out.replace('יה', 'טו').replace('יו', 'טז');
  return out.length <= 1 ? out + '׳' : out.slice(0, -1) + '״' + out.slice(-1);
}
/** A year in לפרט קטן, the way one is written: the thousands are left off, so 5786 is
 *  תשפ"ו. Spelled in full it would start with fourteen ת's, since the numeral system has
 *  no letter past 400 and hebrewNumber repeats it - which is what this used to print. */
function hebrewYear(year) {
  const small = year % 1000;
  return hebrewNumber(small || year);
}
export function jewishDateString(serial, english, useGregorianBefore1582 = false) {
  const { dayOfMonth, month, year } = hebrewDateExtended(serial, useGregorianBefore1582);
  const monthName = (english ? JEWISH_MONTHS_EN : JEWISH_MONTHS_HE)[month - 1];
  return english ? `${dayOfMonth} ${monthName}, ${year}` : `${hebrewNumber(dayOfMonth)} ${monthName}, ${hebrewYear(year)}`;
}

/** HAS_PARSHA: the parsha read on the Shabbos containing `serial` (Hebrew calendar
 *  tables, `tables` = {parshaChutz, parshaEY, parshaNames} as loaded from data/*.json).
 *  Returns '' for any day that isn't a Saturday, and for Yom Tov Shabbosim (no parsha
 *  read) - this is exactly the signal weeks.js uses to skip Yom Tov weeks. */
export function hasParsha(serial, settings, tables) {
  if (excelWeekday(serial) !== 7) return '';
  const jdate = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const rh = roshHashana(jdate.year - 3761);
  const rhdow = mod(rh - 1, 7) + 1;
  const yearTypeKey = `${rhdow}${jdate.yearType}${jdate.leap ? 'M' : 'P'}`;
  const table = settings.inIsrael ? tables.parshaEY : tables.parshaChutz;
  const parshaCol = table.headers.indexOf(yearTypeKey);
  if (parshaCol === -1) return '';
  const parshaRow = Math.trunc((serial - rh + rhdow) / 7);
  const rowValues = table.rows[parshaRow - 1];
  if (!rowValues) return '';
  const parshaNum = rowValues[parshaCol];
  if (typeof parshaNum !== 'number') return '';
  const namesRow = tables.parshaNames.rows[parshaNum - 1];
  if (!namesRow) return '';
  return settings.english ? namesRow[1] : namesRow[0];
}

/** HAS_SPECIAL_PARSHA: named special Shabbosim (Shuva, Shira, Shekalim, Zachor, Parah,
 *  HaChodesh, HaGadol, Chazon, Nachamu), by exact Hebrew-calendar day-of-year, exactly
 *  as hardcoded in the workbook. */
export function hasSpecialParsha(serial, settings) {
  if (excelWeekday(serial) !== 7) return '';
  const jdate = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const d = jdate.dayOfYear;
  const doy = jdate.leap ? (d > 315 ? (d < 345 ? 0 : d - 30) : d) : d;
  const english = settings.english;
  const inSet = (arr) => arr.includes(doy);
  if (inSet([180, 182, 183, 185])) return english ? 'Shuva' : 'שובה';
  if ((doy === 305 && jdate.yearType === 5) || (doy === 312 && jdate.yearType === 3) || inSet([306, 307, 308, 310])) return english ? 'Shira' : 'שירה';
  if (inSet([320, 322, 324, 326])) return english ? 'Shekalim' : 'שקלים';
  if (inSet([333, 334, 336, 338])) return english ? 'Zachor' : 'זכור';
  if (inSet([343, 345, 347, 348])) return english ? 'Parah' : 'פרה';
  if (inSet([350, 352, 354, 1])) return english ? 'Hachodesh' : 'החדש';
  if (inSet([8, 10, 12, 14])) return english ? 'Hagadol' : 'הגדול';
  if (inSet([122, 124, 126, 127])) return english ? 'Chazon' : 'חזון';
  if (inSet([129, 131, 133, 134])) return english ? 'Nachamu' : 'נחמו';
  return '';
}

/** HAS_YOM_TOV: the Yom Tov / Chol Hamoed / Rosh Hashana name for a date, if any,
 *  via SPECIAL_DAYS_TABLE (data/special_days.json). */
export function hasYomTov(serial, settings, specialDaysTable) {
  const jdate = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  let doy = jdate.dayOfYear;
  if ([267, 268, 269].includes(doy) && jdate.yearType === 3) doy -= 1; // first 3 days of Teves, chanukah on a chaser year
  const row = specialDaysTable.rows.find((r) => r[0] === doy);
  if (!row) return '';
  const col = 1 + (jdate.leap ? 1 : 0) + (settings.inIsrael ? 2 : 0) + (settings.english ? 0 : 4);
  return row[col] || '';
}

/** IS_ASSUR_MELACHA: true on Shabbos or any full Yom Tov day (not Chol Hamoed). */
export function isAssurMelacha(serial, settings) {
  if (excelWeekday(serial) === 7) return true;
  const jdate = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const days = [21, 65, 178, 179, 187, 192, 199].concat(settings.inIsrael ? [15] : [15, 16, 22, 66, 193, 200]);
  return days.includes(jdate.dayOfYear);
}

/** True for a weekday (non-Shabbos) whose Mincha/Maariv/Shacharis wouldn't follow the
 *  shul's regular weekday schedule - a full Yom Tov day, Chol Hamoed, or Hoshana
 *  Rabbah. Deliberately NOT true for Chanukah, Purim, Tu B'Shvat, and similar
 *  commemorative-but-unrestricted days - davening on those is still the regular
 *  weekday schedule (just with an added paragraph), so they should still count as a
 *  normal day for the Weekday chart's own week-inclusion rule (see
 *  weeks.js/computeWeekdayWeeks). */
export function isYomTovOrCholHamoed(serial, settings, specialDaysTable) {
  if (isAssurMelacha(serial, settings)) return true;
  const name = hasYomTov(serial, settings, specialDaysTable);
  return /Chol Hamoed|חול המועד|Hoshana Rabbah|הושענה רבה/.test(name);
}

/** HAS_ROSH_CHODESH: "ראש חדש <month>" on Rosh Chodesh, else "".
 *
 *  Ported from the workbook's own LAMBDA, including its two quirks: 1 Tishrei is
 *  excluded (that day is Rosh Hashana, not Rosh Chodesh), and the 30th of a full month
 *  is the *first* day of the next month's Rosh Chodesh, so it is named for the month
 *  that is starting. In a leap year the month after Shevat is Adar I, hence the +2. */
export function hasRoshChodesh(serial, settings) {
  const j = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const months = settings.english ? JEWISH_MONTHS_EN : JEWISH_MONTHS_HE;
  const label = settings.english ? 'Rosh Chodesh ' : 'ראש חדש ';
  if (j.dayOfMonth === 1 && j.month !== 7) return label + months[j.month - 1];
  if (j.dayOfMonth === 30) return label + months[j.month + (j.leap && j.month === 11 ? 2 : 1) - 1];
  return '';
}

/** HAS_BEHAB: "בה״ב" on the Monday/Thursday/Monday after Rosh Chodesh Iyar and
 *  Cheshvan, else "".
 *
 *  The workbook expresses the custom as day-of-month windows rather than as "the first
 *  Monday after...": Iyar or Cheshvan only, Monday between the 4th and 17th, Thursday
 *  between the 7th and 13th. Each window holds exactly the intended days, two Mondays
 *  and the one Thursday between them. */
export function hasBehab(serial, settings) {
  const j = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  if (j.month !== 2 && j.month !== 8) return '';
  const weekday = excelWeekday(serial);
  const label = settings.english ? 'BeHaB' : 'בה״ב';
  if (weekday === 2 && j.dayOfMonth >= 4 && j.dayOfMonth <= 17) return label;
  if (weekday === 5 && j.dayOfMonth >= 7 && j.dayOfMonth <= 13) return label;
  return '';
}

/** HAS_TAANIS: the name of the fast falling on this date, else "".
 *
 *  Ported from the workbook, deferrals included: a fast that would fall on Shabbos moves
 *  to Sunday (the 18th of Tammuz, 10th of Av, 4th of Tishrei), except תענית אסתר, which
 *  moves back to the Thursday before (the 11th of Adar). Asara B'Teves can never fall on
 *  Shabbos, so it has no deferral. Yom Kippur is included, as the workbook counts it
 *  among the fasts. */
export function hasTaanis(serial, settings) {
  const j = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const weekday = excelWeekday(serial);
  const en = settings.english;
  const d = j.dayOfMonth;
  const name = {
    tammuz: en ? 'Seventeenth of Tammuz' : 'שבעה עשר בתמוז',
    av: en ? "Tishah B'Av" : 'תשעה באב',
    gedalyah: en ? 'Fast of Gedalyah' : 'צום גדליה',
    kippur: en ? 'Yom Kippur' : 'יום כפור',
    teves: en ? 'Tenth of Teves' : 'עשרה בטבת',
    esther: en ? 'Fast of Esther' : 'תענית אסתר',
  };
  switch (j.month) {
    case 4:
      if (d === 17 && weekday !== 7) return name.tammuz;
      if (d === 18 && weekday === 1) return name.tammuz;
      return '';
    case 5:
      if (d === 9 && weekday !== 7) return name.av;
      if (d === 10 && weekday === 1) return name.av;
      return '';
    case 7:
      if (d === 3 && weekday !== 7) return name.gedalyah;
      if (d === 4 && weekday === 1) return name.gedalyah;
      if (d === 10) return name.kippur;
      return '';
    case 10:
      return d === 10 ? name.teves : '';
    case 12:
    case 14:
      if (d === 13 && weekday !== 7) return name.esther;
      if (d === 11 && weekday === 5) return name.esther;
      return '';
    default:
      return '';
  }
}
