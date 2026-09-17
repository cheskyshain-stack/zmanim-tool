import { minyanimForDay, clock, meridiem, candleLightingForDay } from '../upcoming.js';
import { specialMinyanim } from '../posters/day.js';
import { buildPesachPoster } from '../posters/pesach.js';
import { hebrewDateExtended, hasTaanis, hasRoshChodesh, excelWeekday } from '../hebrew-calendar.js';
import { rowFor, weekIndex } from '../sheets/rows.js';
import { dateFromSerial, shulNow } from '../zmanim/solar.js';
import { escAttr, DAY_NAMES } from '../util.js';
import { UL_START, UL_END } from '../format.js';
import { sanitizeRichText } from '../security.js';

const readerEventKey = e => JSON.stringify([e.name, e.mins, e.place || '']);
const readerCategory = e => e.name.includes('מנחה') ? 'mincha' : e.name.includes('מעריב') ? 'maariv' : e.mins < 720 ? 'morning' : 'other';
const READER_LABELS = { morning: 'שחרית / סליחות', mincha: 'מנחה', maariv: 'מעריב', other: 'Additional times' };

/** Holiday chart rows can be dated midweek. The reader always means Sunday to
 * Shabbos, including weeks whose only schedule is a special poster. */
export function readerWeekIndex(state) {
  const source = weekIndex(state), result = new Map();
  for (const [serial, entry] of source) {
    const anchor = serial + 7 - excelWeekday(serial);
    if (!result.has(anchor) || entry.sheet) result.set(anchor, {
      ...entry, week: { ...entry.week, serial: anchor, date: dateFromSerial(anchor) },
    });
  }
  const keys = [...result.keys()].sort((a,b)=>a-b);
  for (let serial=keys[0]; serial<=keys[keys.length-1]; serial+=7) {
    if (!result.has(serial)) result.set(serial,{week:{serial,date:dateFromSerial(serial),parsha:'',specialParsha:''},sheet:null});
  }
  return result;
}

/** Most frequent complete schedule, followed by explicitly dated exceptions.
 * A one-slot change can be shortened without losing any time or room information. */
export function groupReaderSchedules(days, category) {
  const groups = [];
  for (const day of days) {
    const events = day.events.filter(e => readerCategory(e) === category && e.mins >= 180);
    if (!events.length) continue;
    const signature = JSON.stringify(events.map(readerEventKey));
    let group = groups.find(g => g.signature === signature);
    if (!group) { group = { signature, events, days: [] }; groups.push(group); }
    group.days.push(day.label);
  }
  groups.sort((a, b) => b.days.length - a.days.length);
  const base = groups[0];
  for (const group of groups.slice(1)) {
    if (group.events.length !== base.events.length) continue;
    const changed = group.events.map((e, i) => readerEventKey(e) !== readerEventKey(base.events[i]) ? i : -1).filter(i => i >= 0);
    if (changed.length === 1) {
      const i = changed[0], from = base.events[i], to = group.events[i];
      if (from.name === to.name && from.place === to.place) group.change = { from, to };
    }
  }
  return groups;
}

function readerDayTitle(serial, settings) {
  const j = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const fast = hasTaanis(serial, settings);
  if (fast) return fast;
  if (j.month === 7) {
    if (j.dayOfMonth <= 2) return 'ראש השנה';
    if (j.dayOfMonth === 9) return 'ערב יום כיפור';
    if (j.dayOfMonth === 14) return 'ערב סוכות';
    if (j.dayOfMonth >= 15 && j.dayOfMonth <= 21) return 'סוכות';
    if (j.dayOfMonth === 22) return 'שמיני עצרת';
    if (j.dayOfMonth === 23) return 'שמחת תורה';
  }
  if (j.month === 6 && j.dayOfMonth === 29) return 'ערב ראש השנה';
  if (j.month === 1 && j.dayOfMonth >= 14 && j.dayOfMonth <= 22) return 'פסח';
  if (j.month === 3 && [5,6,7].includes(j.dayOfMonth)) return j.dayOfMonth === 5 ? 'ערב שבועות' : 'שבועות';
  return hasRoshChodesh(serial, settings) ? 'ראש חודש' : 'Special schedule';
}

/** Shared poster event lists take priority over the ordinary chart for that day.
 * This does not change the next-minyan engine or the underlying calculations. */
export function weeklyReaderData(showing, index, state, settings) {
  const regular = [], special = [], night = [];
  const { week, sheet } = index.get(showing);
  const hebrewYear = hebrewDateExtended(showing, settings.useGregorianBefore1582).year;
  const nisan = Array.from({ length: 7 }, (_, i) => showing - 6 + i)
    .some(s => hebrewDateExtended(s, settings.useGregorianBefore1582).month === 1);
  const pesach = nisan ? buildPesachPoster(hebrewYear, settings) : null;
  const specialSerials = new Set();
  for (let offset = 6; offset >= 0; offset--) {
    const serial = showing - offset;
    const date = dateFromSerial(serial);
    const label = DAY_NAMES[6 - offset];
    let events = specialMinyanim(serial, settings);
    const pesachEvents = pesach?.minyanim.filter(e => e.serial === serial) || [];
    const j = hebrewDateExtended(serial, settings.useGregorianBefore1582);
    const pesachDay = j.month === 1 && j.dayOfMonth >= 14 && j.dayOfMonth <= 22;
    if (pesachDay && pesachEvents.length) events = pesachEvents;
    // There is no complete Tisha B'Av day poster in the system. Do not imply that
    // the ordinary morning and afternoon apply to a day with its own schedule.
    const unconfirmed = j.month === 5 && Boolean(hasTaanis(serial, settings));
    if (events.length || unconfirmed) {
      specialSerials.add(serial);
      special.push({ serial, label, date, title: readerDayTitle(serial, settings), events,
        candles: candleLightingForDay(serial, state, settings), unconfirmed });
      continue;
    }
    if (offset === 0) {
      if (!sheet) special.push({serial,label,date,title:readerDayTitle(serial,settings),events:[],unconfirmed:true});
      continue;
    }
    events = minyanimForDay(serial, state, settings);
    // The night before Pesach is only a partial poster; replace its evening, not
    // the morning and afternoon which still come from the normal chart.
    if (pesachEvents.length) {
      const categories = new Set(pesachEvents.map(readerCategory));
      events = [...events.filter(e => !categories.has(readerCategory(e))), ...pesachEvents].sort((a,b) => a.mins-b.mins);
    }
    const overnight = events.filter(e => e.mins < 180);
    if (!events.length) {
      special.push({serial,label,date,title:readerDayTitle(serial,settings),events:[],unconfirmed:true});
      continue;
    }
    if (overnight.length) night.push({ serial, label, events: overnight });
    // Friday afternoon/evening belongs to the Erev Shabbos section below.
    regular.push({ serial, label, events: offset === 1 ? events.filter(e => readerCategory(e)==='morning') : events });
  }
  const shabbos = [];
  if (sheet) {
    const built = rowFor({ ...week, date: new Date(week.date) }, sheet, state, settings);
    const fridayKeys = new Set(built.season === 'kayitz' ? ['L','K','J','I','H','G','F'] : ['I','H','G','F']);
    for (const c of [...built.columns].reverse()) {
      const serial = fridayKeys.has(c.key) ? showing-1 : showing;
      if (specialSerials.has(serial)) continue;
      const value = built.row[c.key];
      if (value == null || value === '') continue;
      shabbos.push({ title: c.header.replace(/\n/g,' '), value, html: built.overriddenKeys.has(c.key),
        friday: fridayKeys.has(c.key) });
    }
  }
  return { regular, special, night, shabbos };
}

function readerTimeHtml(e) {
  const label = clock(e.mins);
  const place = e.place || '';
  const marked = place === 'למטה' ? `<u>${label}</u>` : label;
  const star = place === 'בעזר״נ' ? '*' : place === 'באולם השמחות' ? '**' : '';
  const room = place && !['למטה','בעזר״נ','באולם השמחות'].includes(place) ? `<small lang="he">${escAttr(place)}</small>` : '';
  return `<span class="reader-time" dir="ltr" title="${escAttr(place)}">${marked}${star}<small>${meridiem(e.mins)}</small>${room}</span>`;
}

function readerEventGroups(events) {
  const groups = [];
  for (const event of events) {
    let group = groups.find(g => g.name === event.name);
    if (!group) {group={name:event.name,events:[]};groups.push(group);}
    group.events.push(event);
  }
  return groups.map(g => `<div class="reader-special-row"><h4 lang="he">${escAttr(g.name)}</h4><div class="reader-times">${g.events.map(readerTimeHtml).join('')}</div></div>`).join('');
}

function readerScheduleHtml(groups, category) {
  if (!groups.length) return '';
  const names = [...new Set(groups.flatMap(g=>g.events.map(e=>e.name)))];
  const title = category === 'morning' && names.length === 1 ? names[0] : READER_LABELS[category];
  return `<section class="reader-card"><h3 lang="he">${escAttr(title)}</h3>${groups.map((g,i)=>
    `<div class="reader-schedule ${i ? 'reader-exception' : ''}"><p class="reader-days">${escAttr(g.days.join(', '))}${names.length>1?` <span lang="he">· ${escAttr([...new Set(g.events.map(e=>e.name))].join(' / '))}</span>`:''}</p>${g.change
      ? `<p class="reader-change">${readerTimeHtml(g.change.to)} <span>instead of</span> ${readerTimeHtml(g.change.from)}</p><p class="reader-note">All other times above stay the same.</p>`
      : `<div class="reader-times">${g.events.map(readerTimeHtml).join('')}</div>`}</div>`).join('')}</section>`;
}

function readerCellHtml(row) {
  const html = row.html ? sanitizeRichText(row.value) : escAttr(row.value)
    .split(UL_START).join('<u>').split(UL_END).join('</u>').replace(/\n/g,'<br>');
  // Chart alignment spaces must not extend the weekly reader's room markings.
  return html.replace(/<u>((?:\s|&nbsp;)*)/g, '$1<u>')
    .replace(/((?:\s|&nbsp;)*)<\/u>/g, '</u>$1');
}

export function remainingReaderDays(data, showing, settings, now = new Date()) {
  const today = shulNow(now, settings).serial;
  return {
    regular: data.regular.filter(d => d.serial >= today),
    special: data.special.filter(d => d.serial >= today),
    night: data.night.filter(d => d.serial >= today),
    shabbos: data.shabbos.filter(d => showing - (d.friday ? 1 : 0) >= today),
  };
}

export function renderWeeklyReader(container, { showing, index, state, settings, serials, onSerialChange, title, now = new Date() }) {
  const data = remainingReaderDays(weeklyReaderData(showing,index,state,settings), showing, settings, now);
  const at = serials.indexOf(showing);
  const date = dateFromSerial(showing).toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'});
  const regular = ['morning','mincha','maariv','other'].map(c=>readerScheduleHtml(groupReaderSchedules(data.regular,c),c)).join('');
  const shabbos = data.shabbos.length ? `<section class="reader-card reader-shabbos"><h3>Shabbos</h3>${data.shabbos.map(r=>`<div class="reader-shabbos-row"><span lang="he">${escAttr(r.title)}</span><div dir="ltr">${readerCellHtml(r)}</div></div>`).join('')}</section>` : '';
  container.innerHTML=`<div class="weekly-reader">
    <header class="reader-heading"><h2 lang="he">${escAttr(title)}</h2><p>Week ending Shabbos, ${escAttr(date)}</p></header>
    <details class="reader-options no-print"><summary>More options</summary><div class="reader-nav">
      <button id="reader-prev" ${at<=0?'disabled':''}>← Previous</button><button id="reader-today">Today</button><button id="reader-next" ${at>=serials.length-1?'disabled':''}>Next →</button>
      </div></details>
    ${!Object.values(data).some(rows=>rows.length)?'<p class="reader-note">All dates in this week have passed. Select Today to see the current week.</p>':''}
    <div class="reader-columns reader-regular">${regular}</div>
    ${data.night.map(n=>`<section class="reader-card"><h3>${escAttr(n.label)} after midnight</h3>${readerEventGroups(n.events)}</section>`).join('')}
    ${data.special.length?`<h3 class="reader-section-title">Special days this week</h3><div class="reader-columns">${data.special.map(d=>`<section class="reader-card reader-special"><p class="reader-days">${escAttr(d.label)} · ${d.date.toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'})}</p><h3 lang="he">${escAttr(d.title)}</h3>${d.unconfirmed?'<p>Check with the shul for this day’s full schedule.</p>':readerEventGroups(d.events)}${d.candles?`<div class="reader-special-row"><h4 lang="he">הדלקת נרות</h4>${readerTimeHtml(d.candles)}</div>`:''}</section>`).join('')}</div><p class="reader-note">For additional zmanim and notices, see <a href="/schedules/">Special schedules</a>.</p>`:''}
    ${shabbos}
    <p class="reader-legend"><span><u>Underlined</u>: downstairs</span><span>* Ezras Nashim</span><span>** Simcha hall</span></p>
  </div>`;
  container.querySelector('#reader-prev').addEventListener('click',()=>onSerialChange(serials[at-1]));
  container.querySelector('#reader-next').addEventListener('click',()=>onSerialChange(serials[at+1]));
  container.querySelector('#reader-today').addEventListener('click',()=>onSerialChange(null));
}
