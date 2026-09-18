import { hebrewDateExtended, excelWeekday } from '../hebrew-calendar.js';
import { shulNow, dateFromSerial } from '../zmanim/solar.js';
import { UL_START, UL_END } from '../format.js';

/** Which day of a yom tov this is, written the way the shul says it: "Sukkos 1st day".
 *
 *  Asked for on the congregation's own page, where two days of סוכות ran under one name and
 *  there was nothing on the screen to say which of them a heading was for. A one day yom tov
 *  takes none, and פסח's second pair are its seventh and eighth rather than its first and
 *  second, which is why the number is worked from the date rather than counted off. */
const YT_ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const ytNth = (n) => `${YT_ORDINAL[n - 1]} day`;

export function agendaDayKind(serial, settings) {
  const h = hebrewDateExtended(serial, settings.useGregorianBefore1582);
  const d = h.dayOfMonth, m = h.month;
  let holy = '', nth = '';
  if (m === 7) {
    holy = d <= 2 ? 'Rosh Hashana' : d === 10 ? 'Yom Kippur' : [15,16].includes(d) ? 'Sukkos' : d === 22 ? 'Shemini Atzeres' : d === 23 ? 'Simchas Torah' : '';
    if (d <= 2) nth = ytNth(d);
    if ([15,16].includes(d)) nth = ytNth(d - 14);
  }
  if (m === 1 && [15,16,21,22].includes(d)) { holy = 'Pesach'; nth = ytNth(d - 14); }
  if (m === 3 && [6,7].includes(d)) { holy = 'Shavuos'; nth = ytNth(d - 5); }
  const chol = (m === 7 && d >= 17 && d <= 21) || (m === 1 && d >= 17 && d <= 20);
  const shabbos = excelWeekday(serial) === 7;
  const named = holy && nth ? `${holy} ${nth}` : holy;
  const withShabbos = (name) => (shabbos ? (name ? `Shabbos / ${name}` : chol ? 'Shabbos Chol Hamoed' : 'Shabbos') : name);
  /* What the evening after this day is called, where the festival is not over with it.
     Asked for on מוצאי יום ב' של סוכות: the yom tov is out, but Sukkos runs another week, so
     "Motzai Sukkos" reads as the end of the whole thing rather than of the two days that
     have just finished. Only the second days of סוכות and פסח are in it, those being the
     only evenings this heading can land on with more of the same festival still to come:
     every other one really is the end of what it names, and Motzai Shabbos and
     Motzai Yom Kippur must stay the words they are.
     Neither day can be a Shabbos, 16 תשרי and 16 ניסן never falling on one, so this never
     has to swallow a "Shabbos / " in front of it. */
  const runsOn = d === 16 && (m === 7 || m === 1);
  /* Three names rather than one. `holy` is the yom tov itself and is what "Erev" is built on,
     where a day number would be wrong: ערב סוכות is not the eve of a particular day of it.
     `holyDay` names the day and heads the times of that day alone. `motzai` is the evening
     after. */
  return { holy: withShabbos(holy), holyDay: withShabbos(named),
    motzai: runsOn ? 'Yom Tov' : withShabbos(holy),
    chol, label: chol ? `Chol Hamoed ${m === 7 ? 'Sukkos' : 'Pesach'}` : '' };
}

export function agendaSection(event, serial, settings) {
  // A post-midnight Maariv belongs to the preceding evening, not tonight.
  if (event.mins < 180 && /מעריב/.test(event.name)) serial--;
  const here = agendaDayKind(serial, settings), next = agendaDayKind(serial + 1, settings);
  const evening = /מעריב|כל נדרי|קול נדרי/.test(event.name);
  /* holyDay on the three that head one day's own times, so a heading says which day of the
     yom tov it is; holy on Erev and Motzaei, where a day number would be wrong. */
  if ((event.earlyShabbos || /הדלקת|שקיעה/.test(event.name)) && next.holy) return { key: `holy-${serial+1}`, title: next.holyDay, serial: serial+1 };
  if (evening && next.holy) return { key: `holy-${serial+1}`, title: next.holyDay, serial: serial+1 };
  /* "Motzai", which is how the shul spells it, and `motzai` rather than `holy` because on the
     second day of סוכות or פסח the festival has another week to run. */
  if ((evening || /קידוש לבנה/.test(event.name)) && here.holy) return { key: `motzaei-${serial}`, title: `Motzai ${here.motzai}`, serial };
  if (here.holy) return { key: `holy-${serial}`, title: here.holyDay, serial };
  if (next.holy && (/מנחה|הדלקת|שקיעה|פלג/.test(event.name))) return { key: `erev-${serial}`, title: `Erev ${next.holy}`, serial };
  return { key: `day-${serial}`, title: [dateFromSerial(serial).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long'}),here.label].filter(Boolean).join(' '), serial };
}

/* The line of a column heading that names the two reckonings a זמן is given on, "גר״א / מ״א".
   Run into the name it made a three line label on a phone, so it comes off the name and is set
   small over the time it belongs to instead, which is how the posters already print this pair
   (see posters/reckonings.js).

   Matched by the names themselves rather than by "the second line", and normalised past the
   quote mark first: the chart headings are written with the Hebrew gershayim and reckonings.js
   with an ASCII one, so the two are different strings for the same word. */
const RECKONING_NAMES = { 'מא': true, 'גרא': true };
const reckoningBare = (s) => s.replace(/["״׳'\s]/g, '');
function reckoningParts(line) {
  const parts = line.split('/').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 && parts.every((p) => RECKONING_NAMES[reckoningBare(p)]) ? parts : null;
}

function agendaChartEvents(rows, showing) {
  const out = [];
  for (const row of rows) {
    const serial = row.eventSerial ?? showing - (row.friday ? 1 : 0);
    const plain = String(row.value).replace(/<u\b[^>]*>/gi, UL_START).replace(/<\/u>/gi, UL_END)
      .replace(/<br\s*\/?>|<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ');
    const headLines = String(row.header || row.title).split('\n').map(s=>s.trim()).filter(Boolean);
    /* Reversed against the heading as it is stored. The heading reads "גר״א / מ״א" and the
       cell holds מ״א first, because a Hebrew line is set right to left while the digits are
       set left to right: measured on the board, מ״א paints over the earlier of the two times
       although it is written second. Pairing them by position without this turn crosses every
       name over the wrong time, which is the exact bug reckonings.js was written for. */
    const reckonings = headLines.map(reckoningParts).find(Boolean)?.slice().reverse() || null;
    for (const line of plain.split('\n')) {
      const named = line.match(/דרשה|שקיעה|פלג[^\d]*/)?.[0]?.trim();
      const name = named || headLines.filter(s=>!s.startsWith('פלג') && !s.startsWith('(') && !reckoningParts(s)).join(' ');
      const morning = /שחרית|קר.*ש/.test(row.title);
      const auxiliary = /דרשה|שקיעה|פלג|הדלקת|קר.*ש/.test(name);
      const re = new RegExp(`(${UL_START}?)\\s*(\\d{1,2}):(\\d{2})(\\*{0,2})(${UL_END}?)`, 'g');
      let at = 0;
      for (const match of line.matchAll(re)) {
        const h = +match[2], m = +match[3];
        if (h < 1 || h > 12 || m > 59) continue;
        const mins = ((h % 12) + (morning ? 0 : 12))*60 + m;
        const place = match[4] === '**' ? 'באולם השמחות' : match[4] === '*' ? 'בעזר״נ' : match[1] || match[5] ? 'למטה' : /בעזר/.test(row.title) ? 'בעזר״נ' : /למטה/.test(row.title) ? 'למטה' : '';
        out.push({serial,mins,name,place:auxiliary?'':place,auxiliary,
          reckoning:(named ? null : reckonings?.[at]) || '',
          earlyShabbos:row.friday && /פלג/.test(row.header || row.title)});
        at++;
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
