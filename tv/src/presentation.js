import { buildWeekdayRow, WEEKDAY_COLUMNS } from '../../js/sheets/weekday.js';
import { mergeRow } from '../../js/overrides.js';
import { announcedCell } from '../../js/announced.js';
import { specialMinyanim } from '../../js/posters/day.js';
/** Presentation only: never used to calculate the next minyan. */
import { agendaDayKind } from '../../js/ui/weekly-agenda.js';
import { hebrewDateExtended, excelWeekday, hasRoshChodesh, hasBehab, hasTaanis, hasParsha, dateFromHebrew } from '../../js/hebrew-calendar.js';
import { dateFromSerial } from '../../js/zmanim/solar.js';
import { weekIndex, rowFor, weekdayChartFor } from '../../js/sheets/rows.js';
import { buildSukkosPoster, SK_TEXT } from '../../js/posters/sukkos.js';
import { buildPesachPoster } from '../../js/posters/pesach.js';
import { buildRoshHashanaPoster } from '../../js/posters/roshhashana.js';
import { buildYomKippurPoster } from '../../js/posters/yomkippur.js';
export const civil = s => dateFromSerial(s).toISOString().slice(0,10);
const weekdays=['יום א׳','יום ב׳','יום ג׳','יום ד׳','יום ה׳','יום ו׳','שבת קודש'];
export function hebrewDay(s,settings) {
 const h=hebrewDateExtended(s),d=h.dayOfMonth,m=h.month;
 let name='';
 if(m===7) name=d===1?'יום א׳ ראש השנה':d===2?'יום ב׳ ראש השנה':d===10?'יום כיפור':d===15?'יום א׳ סוכות':d===16?'יום ב׳ סוכות':d===22?SK_TEXT.shmini:d===23?SK_TEXT.simchas:d===21?SK_TEXT.hoshana:d>16&&d<21?'חול המועד סוכות':'';
 if(m===1) name=d===15?'יום א׳ פסח':d===16?'יום ב׳ פסח':d===21?'שביעי של פסח':d===22?'אחרון של פסח':d>16&&d<21?'חול המועד פסח':'';
 if(m===3) name=d===6?'יום א׳ שבועות':d===7?'יום ב׳ שבועות':'';
 if(excelWeekday(s)===7)return name?'שבת קודש · '+name:'שבת קודש';
 return name || [hasRoshChodesh(s,{...settings,english:false}),hasBehab(s,{...settings,english:false}),hasTaanis(s,{...settings,english:false}),weekdays[excelWeekday(s)-1]].filter(Boolean).join(' · ');
}
const cleanText=value=>String(value??'').replace(/<u\b[^>]*>/gi,'\uE000').replace(/<\/u>/gi,'\uE001').replace(/<br\s*\/?>|<\/(div|p)>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const publicTime=t=>({text:cleanText(t.text),underlined:!!t.underlined,mark:t.mark||'',name:t.name||''});
export function posterRows(lines,prefix) {
 return lines.flatMap((l,i)=>[{id:prefix+':'+i,label:cleanText(l.label),times:(l.times||[]).map(publicTime),note:[l.note,l.sub].filter(Boolean).map(cleanText).join('\n'),calc:l.calc||'',sep:l.sep||' / ',keepUp:!!l.keepUp},...(l.extra?[{id:prefix+':'+i+':extra',label:cleanText(l.extra.label),times:(l.extra.times||[]).map(publicTime),note:'',calc:l.calc||'',sep:l.sep||' / ',keepUp:true}]:[])]);
}
function splitPoster(block,s,prefix) {
 const rows=posterRows(block.lines,prefix);
 // Explicit source calculation identifiers mark morning and closing boundaries.
 const morning=rows.findIndex(r=>['shacharis','shabbosShacharis','simchasShacharis'].includes(r.calc));
 const closing=rows.findIndex(r=>['motzeiMaariv','shabbosMotzei'].includes(r.calc));
 const sections=[];
 const add=(heading,date,lines)=>{if(lines.length)sections.push({heading,date:civil(date),rows:lines});};
 if(morning>0)add('ערב / ליל '+block.heading,s-1,rows.slice(0,morning));
 add(block.heading,s,rows.slice(Math.max(morning,0),closing<0?rows.length:closing));
 if(closing>=0)add('מוצאי '+block.heading,s,rows.slice(closing));
 return sections;
}
/** Attach actual dates using the source's explicit day constants, not its printed times. */
export function holySource(s,settings) {
 const h=hebrewDateExtended(s),d=h.dayOfMonth,m=h.month,year=h.year;
 const rh=dateFromHebrew(1,7,year);
 if(m===7&&d<=2){const p=buildRoshHashanaPoster(year,settings);return {sections:[...(d===1?[{heading:p.erevHeading,date:civil(s-1),rows:posterRows(p.erevLines,'rh:'+year+':erev')}]:[]),...splitPoster(p.blocks[d-1],s,'rh:'+year+':'+d)],poster:p};}
 if(m===7&&d===10){const p=buildYomKippurPoster(year,settings);return {sections:[{heading:p.erevHeading,date:civil(s-1),rows:posterRows(p.erevLines,'yk:'+year+':erev')},...splitPoster({heading:p.dayHeading,lines:p.dayLines},s,'yk:'+year)],poster:p};}
 if(m===7&&d>=15&&d<=24){const p=buildSukkosPoster(year,settings);let key=d===15?SK_TEXT.day1:d===16?SK_TEXT.day2:d===22?SK_TEXT.shmini:d===23?SK_TEXT.simchas:excelWeekday(s)===7?(d===24?SK_TEXT.shabbosBereishis:SK_TEXT.shabbosChm):null;
 const block=key&&p.blocks.find(b=>b.heading===key||b.heading.startsWith(key+' ·'));
 if(block)return {sections:splitPoster({...block,heading:(d===15||d===16)?block.heading.replace(SK_TEXT.day1,SK_TEXT.day1+' דסוכות').replace(SK_TEXT.day2,SK_TEXT.day2+' דסוכות'):block.heading},s,'sk:'+year+':'+d),poster:p};}
 if(m===1){const p=buildPesachPoster(year,settings);const b=p.blocks.find(b=>b.serial===s&&agendaDayKind(s,settings).holy);
 if(b){const before=p.blocks.filter(b=>b.serial===s-1&&d===15&&excelWeekday(s-1)!==7&&/ערב/.test(b.heading));return {sections:[...before.map(b=>({heading:b.heading,date:civil(s-1),rows:posterRows(b.lines,'ps:'+year+':erev')})),...splitPoster({...b,heading:[15,16].includes(d)?b.heading.split(' · ').map((part,i)=>i===0?part+' דפסח':part).join(' · '):b.heading},s,'ps:'+year+':'+d)],poster:p};}}
 return null;
}
function ordinaryShabbos(s,state,settings) {
 const entry=weekIndex(state).get(s);
 if(!entry?.sheet)return [{heading:hebrewDay(s,settings),date:civil(s),rows:[{id:'missing:'+s,label:'הלוח המלא אינו זמין במקור שפורסם. יש לברר בבית המדרש.',times:[]}]}];
 const built=rowFor(entry.week,entry.sheet,state,settings);
 const friday=new Set(built.season==='kayitz'?['L','K','J','I','H','G','F']:['I','H','G','F']);
 const sections=[{heading:'ערב שבת / ליל שבת',date:civil(s-1),rows:[]},{heading:'שבת קודש',date:civil(s),rows:[]},{heading:'מוצאי שבת',date:civil(s),rows:[]}];
 for(const c of [...built.columns].reverse()){
  if(c.key==='A')continue;const value=built.row[c.key];if(value==null||value==='')continue;
  const row={id:'chart:'+s+':'+c.key,label:cleanText(c.header).replace(/\n/g,' '),times:[{text:cleanText(value)}],note:''};
  // Both chart seasons store MGA first, GRA second in column D.
  if(c.key==='D'){row.label='ס״ז קר״ש';row.times=cleanText(value).split('/').map((text,i)=>({text:text.trim(),name:i===0?'מ״א':'גר״א'}));}
  const target=sections[c.key==='B'?2:friday.has(c.key)?0:1].rows;
  const lines=cleanText(value).split('\n');
  if(['H','G'].includes(c.key)&&lines.length>1&&/^(שקיעה|מעריב)\s/.test(lines[1])){
    row.times=[{text:lines[0]}];
    if(c.key==='G')row.label='מנחה';
    target.push(row);
    lines.slice(1).forEach((line,i)=>{const match=line.match(/^(שקיעה|מעריב)\s+(.+)$/);target.push({id:row.id+':detail:'+i,label:match?match[1]:row.label,times:[{text:match?match[2]:line}],note:''});});
  }else if(/פלג/.test(row.label)&&lines.length>1){
    row.times=[{text:lines[0]}];row.note=lines.slice(1).join('\n');row.plagDetail=true;target.push(row);
  }else target.push(row);
 }
 return sections.filter(s=>s.rows.length);
}
export function consolidateWeek(days) {
 const names=[...new Set(days.flatMap(d=>d.events.map(e=>e.name)))];
 return names.map(name=>{
  const groups=[];
  for(const d of days){const events=d.events.filter(e=>e.name===name);const signature=JSON.stringify(events.map(({at,serial,...e})=>Object.fromEntries(Object.entries(e).sort(([a],[b])=>a.localeCompare(b)))));let g=groups.find(x=>x.signature===signature);if(!g){g={signature,events,days:[]};groups.push(g);}g.days.push({date:d.date,label:d.label});}
  groups.sort((a,b)=>b.days.length-a.days.length);
  return {name,groups:groups.map(({signature,...g})=>g)};
 });
}
export function schedulePresentation({serial,state,settings,tables,day,instant,sunset}) {
 const start=serial-excelWeekday(serial)+1, sat=start+6;
 const holy=s=>!!agendaDayKind(s,settings).holy;
 const span=s=>{let first=s,last=s;while(holy(first-1))first--;while(holy(last+1))last++;return {first,last};};
 // Retain yesterday's group through its last closing event, even after midnight.
 const candidates=[];for(let s=serial-1;s<=serial+8;s++)if(holy(s)){const g=span(s);if(!candidates.some(x=>x.first===g.first))candidates.push(g);}
 const end=g=>{const final=day(g.last);return new Date(Math.max(Date.parse(sunset(civil(g.last)))+72*60000,...final.events.map(e=>Date.parse(e.at)))+5*60000).toISOString();};
 const group=candidates.find(g=>instant<=end(g));
 const sections=[];const covered=[];
 if(group)for(let s=group.first;s<=group.last;s++){
    const source=holySource(s,settings),h=hebrewDateExtended(s);
  let parts=source?.sections||ordinaryShabbos(s,state,settings);
  if(h.month===1&&h.dayOfMonth===14&&excelWeekday(s)===7&&source){
    // The Erev Pesach poster supplies that morning and chametz deadlines;
    // the Shabbos chart supplies the remaining Shabbos entries.
    const chart=ordinaryShabbos(s,state,settings);
    parts=[...chart.filter(x=>x.date===civil(s-1)),...source.sections,...chart.filter(x=>x.date===civil(s)).map(x=>({...x,rows:x.rows.filter(r=>!r.id.endsWith(':E'))}))];
  }
  if(!source&&holy(s-1))parts=parts.map(x=>({...x,rows:x.rows.filter(r=>!/:([IJKL])$/.test(r.id))})).filter(x=>x.rows.length);
  if(holy(s+1))parts=parts.map(x=>({...x,rows:x.rows.filter(r=>!r.id.endsWith(':B')&&!['motzeiMaariv','shabbosMotzei'].includes(r.calc))})).filter(x=>x.rows.length);
  sections.push(...parts);covered.push(hebrewDay(s,settings));
 }
 const weekdaysData=[],references=[],posterSections=[];
 for(let s=start;s<sat;s++){
  if(holy(s)){references.push({date:civil(s),label:hebrewDay(s,settings),text:'ראה לוח '+hebrewDay(s,settings)});continue;}
  const h=hebrewDateExtended(s);
  if((h.month===7&&h.dayOfMonth>=17&&h.dayOfMonth<=21)||(h.month===1&&h.dayOfMonth>=17&&h.dayOfMonth<=20)){
    const poster=h.month===7?buildSukkosPoster(h.year,settings):buildPesachPoster(h.year,settings);
    const block=poster.blocks.find(b=>b.heading==='חול המועד');
    if(block){
      let section=posterSections.find(x=>x.heading==='חול המועד');
      if(!section){section={heading:'חול המועד',dates:[],rows:posterRows(block.lines,'chm:'+h.year+':'+h.month)};posterSections.push(section);}
      section.dates.push(civil(s));
      if(h.month===7&&h.dayOfMonth===21){
        const hos=poster.blocks.find(b=>b.heading===SK_TEXT.hoshana);
        if(hos)posterSections.push({heading:hos.heading,dates:[civil(s)],rows:posterRows(hos.lines,'hoshana:'+h.year)});
        section.morningExclusion='הושענא רבה: שחרית לפי השורה הנפרדת להלן';
      }
      continue;
    }
  }
  const d=day(s);const ownsErev=holy(s+1);
  // Erev RH/YK/Pesach mornings are explicitly printed on their special poster.
  const next=hebrewDateExtended(s+1);const entireErev=ownsErev&&((next.month===7&&[1,10].includes(next.dayOfMonth))||(next.month===1&&next.dayOfMonth===15));
  if(entireErev){references.push({date:civil(s),label:'ערב '+hebrewDay(s+1,settings),text:'ראה לוח '+hebrewDay(s+1,settings)});continue;}
  let events=d.events;
  // Retain complete edited public cells, including prose, separately from live events.
  if(excelWeekday(s)<6&&!specialMinyanim(s,settings).length){
    const entry=weekIndex(state).get(sat),chart=weekdayChartFor(entry?.sheet,sat,state),week=chart?.weeks.find(w=>w.serial===sat);
    if(week){const built=mergeRow(buildWeekdayRow(week,settings),chart,sat);
      for(const col of WEEKDAY_COLUMNS.filter(c=>['B','C'].includes(c.key)&&built.overriddenKeys.has(c.key))){
        const name=col.key==='B'?'מעריב':'מנחה';const sourceText=cleanText(announcedCell(built.row[col.key],col.key,s));
        let attached=false;events=events.map(e=>{if(e.name!==name||attached)return e;attached=true;return {...e,sourceText};});
        if(!attached&&sourceText)events=[...events,{name,mins:col.key==='B'?1200:800,time:'',place:'',sourceText}];
      }
    }
  }
  weekdaysData.push({...d,label:hebrewDay(s,settings),events:events.filter(e=>!ownsErev||e.mins<720)});
  if(ownsErev)references.push({date:civil(s),label:hebrewDay(s,settings),text:'אחר הצהריים והערב: ראה לוח '+hebrewDay(s+1,settings)});
 }
 let title=hasParsha(sat,{...settings,english:false},tables)||hebrewDay(sat,settings);
 if(title&&!/פרשת|שבת|סוכות|פסח|ראש השנה|שבועות|כיפור/.test(title))title='פרשת '+title;
 const parshaFor=s=>{let name=hasParsha(s,{...settings,english:false},tables)||'';return name.replace(/^פרשת\s*/, '').replace(/^שבת\s*/, '');};
 if(posterSections.length)title='חול המועד';
 else if(title.startsWith('פרשת '))title='חול '+title;
 let specialTitle=[...new Set(covered)].join(' · ');
 if(group){
   const h=hebrewDateExtended(group.first);
   if(h.month===7&&[15,16].includes(h.dayOfMonth))specialTitle='סוכות';
   else if(h.month===7&&[22,23].includes(h.dayOfMonth))specialTitle='שמיני עצרת / שמחת תורה';
   else if(group.first===group.last&&excelWeekday(group.first)===7){
     const name=parshaFor(group.first);specialTitle=/חול המועד/.test(name)?'שבת חול המועד':name?'שבת פרשת '+name:'שבת קודש';
   }
 }
 return {currentDay:hebrewDay(serial,settings),weekly:{title,from:civil(start),to:civil(sat),services:consolidateWeek(weekdaysData),references,posterSections},special:group?{id:civil(group.first),title:specialTitle,from:civil(group.first-1),to:civil(group.last),endsAt:end(group),sections}:null};
}
