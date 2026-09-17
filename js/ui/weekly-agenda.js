import { hebrewDateExtended, excelWeekday } from '../hebrew-calendar.js';
import { shulNow, dateFromSerial } from '../zmanim/solar.js';
import { UL_START, UL_END } from '../format.js';

export function agendaDayKind(serial, settings) {
  const h = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const d = h.dayOfMonth, m = h.month;
  let holy = '';
  if (m === 7) holy = d <= 2 ? 'Rosh Hashana' : d === 10 ? 'Yom Kippur' : [15,16].includes(d) ? 'Sukkos' : d === 22 ? 'Shemini Atzeres' : d === 23 ? 'Simchas Torah' : '';
  if (m === 1 && [15,16,21,22].includes(d)) holy = 'Pesach';
  if (m === 3 && [6,7].includes(d)) holy = 'Shavuos';
  const chol = (m === 7 && d >= 17 && d <= 21) || (m === 1 && d >= 17 && d <= 20);
  const shabbos = excelWeekday(serial) === 7;
  return { holy: shabbos ? (holy ? `Shabbos / ${holy}` : chol ? 'Shabbos Chol Hamoed' : 'Shabbos') : holy,
    chol, label: chol ? `Chol Hamoed ${m === 7 ? 'Sukkos' : 'Pesach'}` : '' };
}

export function agendaSection(event, serial, settings) {
  // A post-midnight Maariv belongs to the preceding evening, not tonight.
  if (event.mins < 180 && /מעריב/.test(event.name)) serial--;
  const here = agendaDayKind(serial, settings), next = agendaDayKind(serial + 1, settings);
  const evening = /מעריב|כל נדרי|קול נדרי/.test(event.name);
  if ((event.earlyShabbos || /הדלקת|שקיעה/.test(event.name)) && next.holy) return { key: `holy-${serial+1}`, title: next.holy, serial: serial+1 };
  if (evening && next.holy) return { key: `holy-${serial+1}`, title: next.holy, serial: serial+1 };
  if ((evening || /קידוש לבנה/.test(event.name)) && here.holy) return { key: `motzaei-${serial}`, title: `Motzaei ${here.holy}`, serial };
  if (here.holy) return { key: `holy-${serial}`, title: here.holy, serial };
  if (next.holy && (/מנחה|הדלקת|שקיעה|פלג/.test(event.name))) return { key: `erev-${serial}`, title: `Erev ${next.holy}`, serial };
  return { key: `day-${serial}`, title: [dateFromSerial(serial).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long'}),here.label].filter(Boolean).join(' '), serial };
}

function agendaChartEvents(rows, showing) {
  const out = [];
  for (const row of rows) {
    const serial = row.eventSerial ?? showing - (row.friday ? 1 : 0);
    const plain = String(row.value).replace(/<u\b[^>]*>/gi, UL_START).replace(/<\/u>/gi, UL_END)
      .replace(/<br\s*\/?>|<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ');
    for (const line of plain.split('\n')) {
      const named = line.match(/דרשה|שקיעה|פלג[^\d]*/)?.[0]?.trim();
      const name = named || (row.header || row.title).split('\n').map(s=>s.trim()).filter(s=>s && !s.startsWith('פלג') && !s.startsWith('(')).join(' ');
      const morning = /שחרית|קר.*ש/.test(row.title);
      const auxiliary = /דרשה|שקיעה|פלג|הדלקת|קר.*ש/.test(name);
      const re = new RegExp(`(${UL_START}?)\\s*(\\d{1,2}):(\\d{2})(\\*{0,2})(${UL_END}?)`, 'g');
      for (const match of line.matchAll(re)) {
        const h = +match[2], m = +match[3];
        if (h < 1 || h > 12 || m > 59) continue;
        const mins = ((h % 12) + (morning ? 0 : 12))*60 + m;
        const place = match[4] === '**' ? 'באולם השמחות' : match[4] === '*' ? 'בעזר״נ' : match[1] || match[5] ? 'למטה' : /בעזר/.test(row.title) ? 'בעזר״נ' : /למטה/.test(row.title) ? 'למטה' : '';
        out.push({serial,mins,name,place:auxiliary?'':place,auxiliary,earlyShabbos:row.friday && /פלג/.test(row.header || row.title)});
      }
    }
  }
  return out;
}

export function weeklyAgenda(data, showing, state, settings, now = new Date()) {
  const clock = shulNow(now, settings), events = [], notices = [];
  for (const day of data.regular) {
    for (const e of day.events) events.push({...e,serial:day.serial});
  }
  for (const day of data.special) {
    for (const e of day.events) events.push({...e,serial:day.serial});
    if (day.candles) events.push({...day.candles,serial:day.serial,auxiliary:true});
    if (day.unconfirmed && day.serial >= clock.serial) notices.push(day);
  }
  // Ordinary Friday morning comes from the regular list; afternoon and Shabbos
  // come from the chart, including its drasha and other non-minyan times.
  events.push(...agendaChartEvents(data.shabbos, showing));
  const unique = new Set();
  const normalized = events.map(e=>({...e,auxiliary:e.auxiliary || /קידוש לבנה|דרשה/.test(e.name),serial:e.serial+Math.floor(e.mins/1440),mins:e.mins%1440}));
  const delta = e => (e.serial-clock.serial)*1440+e.mins-clock.mins;
  const categoryKey = e => JSON.stringify([
    agendaSection(e,e.serial,settings).key,
    e.serial - (e.mins < 180 && /מעריב/.test(e.name) ? 1 : 0), e.name,
  ]);
  const activeCategories = new Set(normalized.filter(e=>!e.auxiliary && delta(e)>=-5).map(categoryKey));
  const remaining = normalized
    .filter(e=>e.auxiliary ? delta(e)>=0 : activeCategories.has(categoryKey(e)))
    .filter(e=>{const key=JSON.stringify([e.serial,e.mins,e.name,e.place]);if(unique.has(key))return false;unique.add(key);return true;})
    .sort((a,b)=>a.serial-b.serial || a.mins-b.mins);
  const isCurrentWeek = clock.serial >= showing - 6 && clock.serial <= showing;
  const first = isCurrentWeek ? remaining.find(e=>!e.auxiliary && (e.serial-clock.serial)*1440+e.mins-clock.mins>=0) : null;
  const sections=[];
  for(const event of remaining) {
    const info=agendaSection(event,event.serial,settings);
    let section=sections.find(s=>s.key===info.key);
    if(!section){section={...info,events:[]};sections.push(section);}
    section.events.push({...event,next:event===first,started:delta(event)<0 && delta(event)>=-5});
  }
  return {sections,notices};
}
