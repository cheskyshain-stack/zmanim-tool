import { weeklyAgenda, agendaDayKind } from './weekly-agenda.js';
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
      shabbos.push({ title: c.header.replace(/\n/g,' '), header: c.header, value, html: built.overriddenKeys.has(c.key),
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
  return `<span class="reader-time${e.next ? ' reader-next-time' : ''}" dir="ltr" title="${escAttr(place)}">${marked}${star}<small>${meridiem(e.mins)}</small>${room}${e.started?'<small>Just started</small>':''}</span>`;
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

/** Keep a continuous Shabbos/Yom Tov together across the weekly boundary. */
export function weeklyAgendaData(showing,index,state,settings) {
  let first=showing-6, last=showing;
  if (agendaDayKind(first,settings).holy) {
    while (agendaDayKind(first-1,settings).holy) first--;
    first--;
  }
  if (agendaDayKind(last,settings).holy) {
    while (agendaDayKind(last+1,settings).holy) last++;
  }
  const data={regular:[],special:[],night:[],shabbos:[]};
  for (const anchor of [showing-7,showing,showing+7]) {
    if (!index.has(anchor) || anchor<first || anchor-6>last) continue;
    const part=weeklyReaderData(anchor,index,state,settings);
    for(const kind of ['regular','special','night']) {
      for(const day of part[kind]) {
        if(day.serial<first || day.serial>last)continue;
        const copy={...day};
        if(day.serial<showing-6 && !agendaDayKind(day.serial,settings).holy) {
          copy.events=day.events.filter(e=>e.mins>=720);
          if(!copy.events.length && !copy.candles)continue;
        }
        data[kind].push(copy);
      }
    }
    for(const row of part.shabbos) {
      const serial=anchor-(row.friday?1:0);
      if(serial>=first && serial<=last)data.shabbos.push({...row,eventSerial:serial});
    }
  }
  return data;
}

export function renderWeeklyReader(container, { showing, index, state, settings, serials, onSerialChange, title, now = new Date() }) {
  const data = weeklyAgendaData(showing,index,state,settings);
  const agenda = weeklyAgenda(data,showing,state,settings,now);
  const at = serials.indexOf(showing);
  const date = dateFromSerial(showing-6).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
  const displaySections = [];
  for (const section of agenda.sections) {
    if (!/^(holy|erev|motzaei)-/.test(section.key)) { displaySections.push(section); continue; }
    let start = section.serial + (section.key.startsWith('erev-') ? 1 : 0);
    while (agendaDayKind(start-1,settings).holy) start--;
    let end=start;
    const titles=[];
    while (agendaDayKind(end,settings).holy) {
      const name=agendaDayKind(end,settings).holy;
      for (const part of name.split(' / ')) if(!titles.includes(part)) titles.push(part);
      end++;
    }
    const key=`holy-${end-1}`;
    let combined = displaySections.find(s=>s.key===key && s.combined);
    if (!combined) {
      combined={key,title:titles.join(' / '),serial:end-1,events:[],combined:true};
      displaySections.push(combined);
    }
    const repeated=agenda.sections.filter(s=>s.title===section.title).length>1;
    const subtitle=section.title+(repeated ? ` · ${dateFromSerial(section.serial).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'})}` : '');
    combined.events.push(...section.events.map(e=>({...e,sectionTitle:subtitle,dayPart:e.serial<section.serial?'Evening':'Day'})));
  }
  const sectionHtml = displaySections.map((section,i)=>{
    const rows=[];
    for(const event of section.events){
      let row=rows[rows.length-1];
      if (row && (row.name!==event.name || row.serial!==event.serial || row.sectionTitle!==event.sectionTitle || row.dayPart!==event.dayPart)) row=null;
      if(!row){row={name:event.name,serial:event.serial,sectionTitle:event.sectionTitle,dayPart:event.dayPart,events:[]};rows.push(row);}
      row.events.push(event);
    }
    const hasNext=section.events.some(e=>e.next);
    const dates=(section.combined ? [...new Set(section.events.map(e=>e.serial))].sort((a,b)=>a-b) : [section.serial]).map(serial=>dateFromSerial(serial).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'})).join(' / ');
    return `<details class="reader-agenda-day" data-agenda-key="${section.key}" ${hasNext || (!agenda.sections.some(s=>s.events.some(e=>e.next)) && i===0)?'open':''}>
      <summary><span><strong>${escAttr(section.title)}</strong><small>${escAttr(dates)}</small></span>${hasNext?'<span class="reader-next-badge">Next minyan</span>':''}<span class="reader-agenda-chevron" aria-hidden="true">⌄</span></summary>
      <div class="reader-agenda-rows">${rows.map((row,ri)=>`${row.sectionTitle && row.sectionTitle!==rows[ri-1]?.sectionTitle?`<h3 class="reader-agenda-subheading">${escAttr(row.sectionTitle)}</h3>`:''}<div class="reader-agenda-row"><div class="reader-agenda-label"><span lang="he" dir="rtl">${escAttr(row.name)}</span>${row.dayPart?`<small>${row.dayPart}</small>`:row.serial>section.serial?'<small>After midnight</small>':''}</div><div class="reader-times">${row.events.map(readerTimeHtml).join('')}</div></div>`).join('')}</div>
    </details>`;
  }).join('');
  container.innerHTML=`<div class="weekly-reader">
    <header class="reader-heading"><h2 lang="he">${escAttr(title)}</h2><p>Week of ${escAttr(date)}</p></header>
    <details class="reader-options no-print"><summary>More options</summary><div class="reader-nav">
      <button id="reader-prev" ${at<=0?'disabled':''}>← Previous</button><button id="reader-today">Today</button><button id="reader-next" ${at>=serials.length-1?'disabled':''}>Next →</button>
    </div></details>
    ${sectionHtml || '<p class="reader-note">No remaining minyanim this week. Select Next for the coming week.</p>'}
    ${agenda.notices.map(d=>`<p class="reader-note">${escAttr(d.label)}: Check with the shul for this day’s full schedule.</p>`).join('')}
    <p class="reader-note">For additional zmanim and notices, see <a href="/schedules/">Special schedules</a>.</p>
    <p class="reader-legend"><span><u>Underlined</u>: downstairs</span><span>* Ezras Nashim</span><span>** Simcha hall</span></p>
  </div>`;
  container.querySelector('#reader-prev').addEventListener('click',()=>onSerialChange(serials[at-1]));
  container.querySelector('#reader-next').addEventListener('click',()=>onSerialChange(serials[at+1]));
  container.querySelector('#reader-today').addEventListener('click',()=>onSerialChange(null));
}
