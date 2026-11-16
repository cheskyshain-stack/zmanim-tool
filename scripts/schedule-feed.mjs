import { buildAutomaticCharts } from '../js/publish.js';
import { resolveSettings } from '../js/settings.js';
import { readerWeekIndex, weeklyReaderData } from '../js/ui/weekly-reader.js';
import { weeklyAgenda, agendaDayKind } from '../js/ui/weekly-agenda.js';
import { shulNow, dateFromSerial } from '../js/zmanim/solar.js';
import { hebrewDateExtended, excelWeekday, hasRoshChodesh, hasBehab, hasTaanis } from '../js/hebrew-calendar.js';
import { clock, meridiem } from '../js/upcoming.js';
import { timeDisplayMinutes } from '../js/format.js';
import { DAY_NAMES } from '../js/util.js';

const dateString = serial => dateFromSerial(serial).toISOString().slice(0, 10);
const plainLabel = value => String(value || '')
  .replace(/\([^)]*(?:למטה|בעזר|עזרת נשים|אולם|בית מדרש)[^)]*\)/g, '')
  .replace(/[\uE000\uE001\u2066-\u2069*]/g, '').replace(/\s+/g, ' ').trim();

function eventCategory(name) {
  if (/שחרית|סליחות|ותיקין/.test(name)) return 'shacharis';
  if (/מנחה/.test(name)) return 'mincha';
  if (/מעריב|כל נדרי|קול נדרי/.test(name)) return 'maariv';
  return 'other';
}

/** A full calendar-day feed, independent of the weekly page's past-time filtering.
 * Only explicit public fields are serialized. Room fields and print markings never
 * travel, and services at the same time in different rooms become one entry. */
export function buildScheduleFeed(config, tables, now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid feed build time');
  const state = buildAutomaticCharts(config, tables, now);
  const settings = resolveSettings(state.settings);
  const english = { ...settings, english: true };
  const index = readerWeekIndex(state);
  const first = shulNow(now, settings).serial;
  const last = first + 9;
  const firstAnchor = first + 7 - excelWeekday(first);
  const lastAnchor = last + 7 - excelWeekday(last);
  const data = { regular: [], special: [], night: [], shabbos: [] };
  // The preceding week can supply a post-midnight service on the first calendar day.
  for (let anchor = firstAnchor - 7; anchor <= lastAnchor; anchor += 7) {
    if (!index.has(anchor)) continue;
    const part = weeklyReaderData(anchor, index, state, settings);
    for (const kind of ['regular', 'special', 'night']) data[kind].push(...part[kind]);
    data.shabbos.push(...part.shabbos.map(row => ({ ...row, eventSerial: anchor - (row.friday ? 1 : 0) })));
  }
  // Start before the window so already-passed times still appear in today's full schedule.
  const agenda = weeklyAgenda(data, lastAnchor, state, settings, dateFromSerial(first - 2));
  const byDay = new Map();
  for (const event of agenda.sections.flatMap(section => section.events)) {
    if (event.serial < first || event.serial > last) continue;
    const minutes = timeDisplayMinutes(event.mins / 1440) % 1440;
    const name = plainLabel(event.name);
    const entry = {
      name,
      category: eventCategory(name),
      time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      displayTime: `${clock(minutes)} ${meridiem(minutes)}`,
    };
    if (event.reckoning) entry.reckoning = plainLabel(event.reckoning);
    const entries = byDay.get(event.serial) || new Map();
    entries.set(JSON.stringify([entry.name, entry.time, entry.reckoning || '']), entry);
    byDay.set(event.serial, entries);
  }
  const days = Array.from({ length: 10 }, (_, offset) => {
    const serial = first + offset;
    const hebrew = hebrewDateExtended(serial, settings.useGregorianBefore1582);
    const kind = agendaDayKind(serial, settings);
    const occasions = [...new Set([
      kind.holyDay || kind.label,
      hasRoshChodesh(serial, english),
      hasBehab(serial, english) ? 'BHB' : '',
      hasTaanis(serial, english),
    ].filter(Boolean))];
    const events = [...(byDay.get(serial)?.values() || [])].sort((a, b) => a.time.localeCompare(b.time));
    const unconfirmed = data.special.some(day => day.serial === serial && day.unconfirmed);
    return {
      date: dateString(serial),
      weekday: DAY_NAMES[excelWeekday(serial) - 1],
      hebrewDate: { year: hebrew.year, month: hebrew.month, day: hebrew.dayOfMonth },
      parsha: plainLabel(index.get(serial + 7 - excelWeekday(serial))?.week.parsha),
      occasions,
      status: unconfirmed ? 'unconfirmed' : events.length ? 'available' : 'unavailable',
      events,
    };
  });
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    timeZone: settings.timezone.id,
    range: { startDate: dateString(first), endDate: dateString(last), dayCount: 10 },
    days,
  };
}
