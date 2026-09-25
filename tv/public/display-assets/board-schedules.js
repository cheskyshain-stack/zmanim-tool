import {groupWeekdayPresentation} from './weekday-groups.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=v=>esc(v).replace(/\uE000\s*/g,'<u>').replace(/\s*\uE001/g,'</u>').replace(/\n/g,'<br>');
const date=d=>new Date(d+'T12:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
function times(entries){return entries.flatMap(t=>String(t.text??'').split(/\s*\/\s*|\n(?=\s*[\uE000\s]*\d{1,2}:)/).map(text=>({...t,text:text.trim()}))).map(t=>`<span class="board-time">${t.name?`<small dir="rtl">${esc(t.name)}</small>`:''}<bdi dir="ltr">${t.underlined?'<u>':''}${rich(t.text)}${t.underlined?'</u>':''}${esc(t.mark)}</bdi></span>`).join('');}
function row(r){let entries=r.times||[],note=r.note;if(r.plagDetail&&note){const m=note.match(/\d{1,2}:\d{2}/);if(m){entries=[...entries,{text:m[0],name:note.replace(m[0],'').trim()}];note='';}}return `<div class="board-schedule-row ${r.label.length>26?'board-long-label':''}" data-source-id="${esc(r.id)}"><div class="board-times">${times(entries)}</div><div class="board-prayer-label" dir="rtl">${rich(r.label)}</div>${note?`<p class="board-row-note" dir="auto">${rich(note)}</p>`:''}</div>`;}
function scope(days){const byOccasion=new Map();for(const d of days){const bits=d.label.split(' · '),day=bits.pop(),occasion=bits.join(' · ');if(!byOccasion.has(occasion))byOccasion.set(occasion,[]);byOccasion.get(occasion).push(day);}return [...byOccasion].map(([occasion,days])=>[occasion,...new Set(days)].filter(Boolean).join(' · ')).join(' · ');}
function events(g){const source=g.events.find(e=>e.sourceText);return source?[{text:source.sourceText}]:g.events.map(e=>({text:e.time,underlined:/למטה/.test(e.place),mark:/אולם/.test(e.place)?'**':/בעזר/.test(e.place)?'*':'',name:!['בית מדרש','למטה','בעזר״נ','באולם השמחות',''].includes(e.place)?e.place:''}));}
const weekdaySource=(name,days)=>`data-weekday-service="${esc(name)}" data-weekday-dates="${esc(days.map(day=>day.date).join(','))}"`;
const notes=g=>g.events.some(e=>e.note)?`<p dir="auto">${[...new Set(g.events.map(e=>e.note).filter(Boolean))].map(esc).join(' · ')}</p>`:'';
function weeklyService(service){
 const groups=service.groups.filter(g=>g.events.length&&g.days.length);
 if(!groups.length)return '';
 // Equally common patterns have no unqualified "regular" list. A morning
 // service present on only some dates (such as first-Sunday Shacharis) also
 // needs its days named. Empty Friday afternoon groups simply hand over to
 // the Shabbos chart, so they do not add day headings to ordinary weeks.
 const noCommonPattern=groups.length>1&&groups[0].days.length*2<=groups.reduce((n,g)=>n+g.days.length,0);
 const partialMorning=['שחרית','סליחות'].includes(service.name)&&service.groups.some(g=>g.days.length&&!g.events.length);
 const heading=[service.name,...(noCommonPattern||partialMorning?[scope(groups[0].days)]:[])].join(' · ');
 return `<section class="board-service"><h3 dir="rtl">${esc(heading)}</h3>${groups.map((g,i)=>`<div class="board-pattern ${i?'board-exception':''}" ${weekdaySource(service.name,g.days)}>${i?`<h4 dir="rtl">${esc(scope(g.days))}</h4>`:''}<div class="board-times">${times(events(g))}</div>${notes(g)}</div>`).join('')}</section>`;
}
function daySection(section){
 return `<section class="board-day-section" data-day-dates="${esc(section.days.map(day=>day.date).join(','))}"><h3 dir="rtl">${esc(scope(section.days))}</h3><p class="board-day-date" dir="ltr">${section.days.map(day=>date(day.date)).join(' · ')}</p><div class="board-day-services">${section.services.map(service=>`<section class="board-day-service" ${weekdaySource(service.name,section.days)}><h4 dir="rtl">${esc(service.name)}</h4><div class="board-times">${times(events(service))}</div>${notes(service)}</section>`).join('')}</div></section>`;
}
export function boardSchedules(p,upcoming=''){
 const w=p.weekly,s=p.special;
 const weekday=groupWeekdayPresentation(w.services);
 const ordinary=s?.sections.every(s=>s.rows.every(r=>r.id.startsWith('chart:')));
 const weekly=`<section class="board-weekly"><h2 dir="rtl">${esc(w.title)}</h2><p class="board-range">${date(w.from)} – ${date(w.to)}</p><div class="board-week-body">${weekday.services.map(weeklyService).join('')}${(w.posterSections||[]).map(section=>`<section class="board-service"><h3 dir="rtl">${esc(section.heading)}</h3>${section.rows.map(row).join('')}${section.morningExclusion?`<p dir="rtl">${esc(section.morningExclusion)}</p>`:''}</section>`).join('')}${weekday.daySections.map(daySection).join('')}${upcoming}</div></section>`;
 const special=s?`<section class="board-shabbos"><h2 dir="rtl">${esc(s.title)}</h2><p class="board-range">${date(s.from)} – ${date(s.to)}</p><div class="board-shabbos-body">${s.sections.map(section=>`${!ordinary?`<h3 dir="rtl">${esc(section.heading)}</h3>`:''}${section.rows.map(row).join('')}`).join('')}</div></section>`:'';
 return weekly+special;
}

/** Measure a schedule in its native, unscaled 1920px layout coordinates.
 * The body can shrink inside the flex panel while its rows extend beyond it,
 * so its scroll height, rather than the panel's box alone, is authoritative. */
function panelFit(panel,bodySelector){
 if(!panel)return null;
 const body=panel.querySelector(bodySelector),bounds=panel.getBoundingClientRect();
 const scale=panel.offsetWidth?bounds.width/panel.offsetWidth:1;
 const style=getComputedStyle(panel);
 const bottomSpace=(parseFloat(style.paddingBottom)||0)+(parseFloat(style.borderBottomWidth)||0);
 const contentBottom=body
  ?(body.getBoundingClientRect().top-bounds.top)/(scale||1)+body.scrollHeight
  :panel.scrollHeight;
 const requiredHeight=Math.ceil(contentBottom+bottomSpace);
 const availableHeight=panel.offsetHeight;
 return {requiredHeight,availableHeight,overflow:Math.max(0,requiredHeight-availableHeight-2),compact:panel.classList.contains('board-compact')};
}

// Every row in a table shares one compact time column. Measure the saved
// tokens, not their displayed text, so underlines, names and marks stay intact.
function alignTimeColumns(panel,limit=4){
 if(!panel||panel.classList.contains('board-weekly'))return;
 const style=getComputedStyle(panel);
 const innerWidth=panel.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
 const rows=[...panel.querySelectorAll('.board-schedule-row')];
 const labels=rows.filter(row=>row.querySelector('.board-time')).map(row=>row.querySelector('.board-prayer-label'));
 let labelWidth=0;
 for(const label of labels){
  const copy=label.cloneNode(true);
  Object.assign(copy.style,{position:'absolute',visibility:'hidden',width:'max-content',maxWidth:'none',whiteSpace:'nowrap'});
  panel.append(copy);
  labelWidth=Math.max(labelWidth,Math.min(copy.offsetWidth,parseFloat(getComputedStyle(label).fontSize)*7,innerWidth*.4));
  copy.remove();
 }
 panel.style.setProperty('--board-label-column',Math.ceil(labelWidth)+'px');
 panel.style.setProperty('--board-time-column',Math.max(1,innerWidth-labelWidth-16)+'px');
 const tables=[],centered=[];
 for(const container of panel.querySelectorAll('.board-times')){
  container.style.removeProperty('width');
  const tokens=[...container.querySelectorAll('.board-time')];
  if(!tokens.length)continue;
  const paired=container.parentElement.classList.contains('board-schedule-row');
  const available=paired?innerWidth-labelWidth-16:container.clientWidth;
  const gap=parseFloat(getComputedStyle(container).columnGap)||14;
  container.style.setProperty('--board-line-gap',gap+'px');
  const widths=tokens.map(token=>token.offsetWidth);
  let count=Math.ceil(tokens.length/limit),lengths;
  const distribute=()=>Array.from({length:count},(_,i)=>Math.floor(tokens.length/count)+(i<tokens.length%count?1:0));
  const widest=lengths=>{
   let index=0;
   return Math.max(...lengths.map(length=>{
    const line=widths.slice(index,index+length);index+=length;
    return line.reduce((sum,width)=>sum+width,0)+gap*(length-1);
   }));
  };
  lengths=distribute();
  while(count<tokens.length&&widest(lengths)>available){count++;lengths=distribute();}
  const fragment=document.createDocumentFragment();
  let index=0;
  for(const length of lengths){
   const line=document.createElement('span');line.className='board-time-line';
   for(let n=0;n<length;n++)line.append(tokens[index++]);
   fragment.append(line);
  }
  container.replaceChildren(fragment);
  const width=Math.ceil(widest(lengths));
  (paired?tables:centered).push({container,width,available});
 }
 if(tables.length)panel.style.setProperty('--board-time-column',Math.max(...tables.map(row=>row.width))+'px');
 if(centered.length){
  const width=Math.min(Math.max(...centered.map(row=>row.width)),...centered.map(row=>row.available));
  for(const row of centered)row.container.style.width=Math.ceil(width)+'px';
 }
}

/** Always keep Shabbos as one continuous column, in saved source order.
 * First measure at the normal type size so the screen can make the panel
 * taller. Compact spacing is an explicit second pass after space is reclaimed.
 * Saved rows stay in order; only their intact time tokens are balanced across
 * lines and aligned in compact shared columns. There is no pagination. */
export function fitBoardSchedules(root,p,{allowCompact=false,compactWeekly=true}={}){
 const special=root.querySelector('.board-shabbos'),weekly=root.querySelector('.board-weekly');
 special?.classList.remove('board-compact','board-tight-spacing');
 weekly?.classList.remove('board-compact','board-inline-services');
 alignTimeColumns(special);alignTimeColumns(weekly);
 const naturalSpecial=panelFit(special,'.board-shabbos-body');
 const naturalWeekly=panelFit(weekly,'.board-week-body');
 if(allowCompact&&naturalSpecial?.overflow){
  special.classList.add('board-compact');
  alignTimeColumns(special);
 }
 if(compactWeekly&&naturalWeekly?.overflow){weekly.classList.add('board-compact');alignTimeColumns(weekly);}
 // Prefer compact balanced runs. Only use more entries per row if the full
 // schedule needs the height; keep the same shared left edge at every size.
 for(const [panel,selector,canCompact] of [[special,'.board-shabbos-body',allowCompact],[weekly,'.board-week-body',compactWeekly]]){
  if(!panel||!canCompact)continue;
  const fullHeight=panel===special?panel.closest('.right-extended'):panel.closest('.week-extended');
  for(const limit of (fullHeight?[5,6,7,8]:[5,6])){
   if(!panelFit(panel,selector).overflow)break;
   alignTimeColumns(panel,limit);
  }
 }
 // A full-height connected schedule may still need a little less row padding,
 // especially with complete source-availability notices. Preserve all text and
 // the current lettering size; use this only after balanced runs need no room.
 if(allowCompact&&special?.closest('.right-extended')&&panelFit(special,'.board-shabbos-body').overflow)
  special.classList.add('board-tight-spacing');
 // Weekday prayer headings always stay above their centered times. Report
 // any remaining height requirement to the board layout rather than switching
 // just some prayers into a second, inline presentation.
 return {
  special:naturalSpecial?{...panelFit(special,'.board-shabbos-body'),naturalRequiredHeight:naturalSpecial.requiredHeight}:null,
  weekly:naturalWeekly?{...panelFit(weekly,'.board-week-body'),naturalRequiredHeight:naturalWeekly.requiredHeight}:null
 };
}
