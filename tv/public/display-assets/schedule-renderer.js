const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=d=>new Date(d+'T12:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const rich=v=>esc(String(v??'').replace(/\uE000\s*/g,'\uE000').replace(/\s*\uE001/g,'\uE001')).replace(/\uE000/g,'<u>').replace(/\uE001/g,'</u>').replace(/\n/g,'<br>').replace(/\u00a0/g,' ');
function times(ts,sep=""){return ts.flatMap(t=>String(t.text??'').includes('/')?String(t.text).split('/').map(text=>({...t,text:text.trim()})):[t]).map(t=>`<span class="source-time"><bdi dir="ltr">${t.underlined?'<u>':''}${rich(String(t.text??'').replace(/\s*\/\s*/g,'\u2003'))}${t.underlined?'</u>':''}${esc(t.mark)}</bdi>${t.name?`<small dir="rtl">${esc(t.name)}</small>`:''}</span>`).join(` <span class="time-sep">${esc(sep.replace(/\//g,'').trim())}</span> `);}
export function sourceRow(row){
 let entries=row.times||[],note=row.note;
 if(row.plagDetail&&note){const match=note.match(/(\d{1,2}:\d{2})/);if(match){entries=[...entries,{text:match[1],name:note.replace(match[1],'').trim()}];note='';}}
 return `<div class="source-row${row.plagDetail?' has-plag':''}" data-source-id="${esc(row.id)}"><div class="source-times">${times(entries,row.sep)}</div><div class="source-label" dir="rtl">${rich(row.label)}</div>${note?`<p class="source-note" dir="auto">${rich(note)}</p>`:''}</div>`;
}
function eventTimes(events){const source=events.find(e=>e.sourceText);if(source)return times([{text:source.sourceText}]);return times(events.map(e=>({text:e.time,underlined:/למטה/.test(e.place),mark:/אולם/.test(e.place)?'**':/בעזר/.test(e.place)?'*':'',name:!['בית מדרש','למטה','בעזר״נ','באולם השמחות',''].includes(e.place)?e.place:''})));}
function scope(days){
 const groups=new Map();
 for(const d of days){const pieces=d.label.split(' · '),day=pieces.pop(),occasion=pieces.join(' · ');if(!groups.has(occasion))groups.set(occasion,[]);groups.get(occasion).push(day);}
 return [...groups].map(([occasion,labels])=>`${esc(occasion)}${occasion?' · ':''}${[...new Set(labels)].map(esc).join(' · ')}`).join(' · ');
}
function pattern(g,i,name){
 const label=i?scope(g.days):esc(name);
 return `<div class="weekly-pattern${i?' exception':''}"><h3 class="weekly-row-label" dir="rtl">${label}</h3><div class="source-times">${eventTimes(g.events)}</div>${g.events.some(e=>e.note)?`<p class="source-note">${g.events.map(e=>esc(e.note||'')).filter(Boolean).join(' · ')}</p>`:''}</div>`;
}export function fullSchedules(p,upcoming=""){
 const w=p.weekly;
 const services=w.services.map(service=>{const groups=service.groups.filter(g=>g.events.length);return `<section class="weekly-service">${groups.map((g,i)=>pattern(g,i,service.name)).join('')}</section>`;}).join(''); const s=p.special;
 return `<section class="tv-panel weekly-reference"><h2 class="tv-panel-title" dir="rtl">${esc(w.title)}</h2><p class="tv-panel-date">${date(w.from)} – ${date(w.to)} · לוח השבוע</p><div class="weekly-body">${services}${(w.posterSections||[]).map(section=>`<section class="source-section"><h3 class="source-heading" dir="rtl">${esc(section.heading)} <small dir="ltr">${section.dates.map(date).join(', ')}</small></h3>${section.morningExclusion?`<p class="weekly-scope" dir="rtl">${esc(section.morningExclusion)}</p>`:''}${section.rows.map(sourceRow).join('')}</section>`).join('')}${upcoming}</div></section>${s?`<section class="tv-panel complete-special"><h2 class="tv-panel-title" dir="rtl">${esc(s.title)}</h2><p class="tv-panel-date">${date(s.from)} – ${date(s.to)} <span class="schedule-page-label"></span></p><div class="special-body">${s.sections.map(section=>`<section class="source-section" data-group-day="${esc(section.groupDay||section.date)}"><h3 class="source-heading" dir="rtl">${esc(section.heading)} <small dir="ltr">${date(section.date)}</small></h3>${section.rows.map(sourceRow).join('')}</section>`).join('')}</div></section>`:''}`;
}
/** Measure actual typography. Never discard rows or shrink them to fit. */
export function paginateSpecial(stage){
 const panel=stage.querySelector('.complete-special'),body=panel?.querySelector('.special-body');
 if(!body)return null;
 const height=body.clientHeight-18,pages=[];let page=document.createElement('div');page.style.display='flow-root';body.replaceChildren(page);
 const source=panel._sections; // caller supplies the original rendered sections
 if(!source)return null;
 // Ordinary Shabbos is a complete reference: show Friday alongside Shabbos/Motzai
 // when both columns fit at the normal readable font size.
 const ordinary=source.length&&source.every(section=>[...section.querySelectorAll('[data-source-id]')].every(row=>row.dataset.sourceId.startsWith('chart:')));
 panel.classList.toggle('ordinary-shabbos', Boolean(ordinary));
 if(ordinary&&panel.clientWidth>=780){
   page.className='shabbos-overview';
   const evening=document.createElement('div'),day=document.createElement('div');
   source.forEach((section,i)=>(i===0?evening:day).append(section.cloneNode(true)));
   page.append(evening,day);
   if(page.scrollHeight<=height){return {pages:[page.outerHTML],body,label:panel.querySelector('.schedule-page-label')};}
   page.replaceChildren();page.className='';
 }
 // All connected holidays use the explicit source day ownership.
 const festivalDays=new Map();
 for(const section of source){const key=section.dataset.groupDay;if(!key){festivalDays.clear();break;}if(!festivalDays.has(key))festivalDays.set(key,[]);festivalDays.get(key).push(section);}
 if(!ordinary&&festivalDays.size>=2&&festivalDays.size<=3&&panel.clientWidth>=780){
  page.className='festival-overview';
  page.style.gridTemplateColumns=`repeat(${festivalDays.size},minmax(0,1fr))`;
  for(const sections of festivalDays.values()){
   const column=document.createElement('section');column.className='festival-day';
   const main=sections.find(s=>!/^ערב|^מוצאי/.test(s.querySelector('.source-heading').textContent))||sections[0];
   column.append(main.querySelector('.source-heading').cloneNode(true));
   for(const section of sections)for(const row of section.querySelectorAll('.source-row'))column.append(row.cloneNode(true));
   page.append(column);
  }
  if(page.scrollHeight<=height)return {pages:[page.outerHTML],body,label:panel.querySelector('.schedule-page-label')};
  page.replaceChildren();page.className='';
 }
 // Dense groups use fixed columns, never rotating pages.
 panel.classList.add('static-dense');
 const rows=source.flatMap(section=>[...section.querySelectorAll('.source-row')].map(row=>({row,heading:section.querySelector('.source-heading')})));
 let best='',bestHeight=Infinity;
 for(const count of [2,3,4]){
  page.className='static-schedule-columns';page.style.gridTemplateColumns=`repeat(${count},minmax(0,1fr))`;page.replaceChildren();
  const columns=Array.from({length:count},()=>{const col=document.createElement('section');col.className='static-schedule-column';page.append(col);return col;});
  let index=0,previous=null;
  for(let i=0;i<rows.length;i++){
   if(index<count-1&&i>=Math.ceil(rows.length*(index+1)/count)){index++;previous=null;}
   const {row,heading}=rows[i];
   if(heading!==previous){columns[index].append(heading.cloneNode(true));previous=heading;}
   columns[index].append(row.cloneNode(true));
  }
  if(page.scrollHeight<bestHeight){bestHeight=page.scrollHeight;best=page.outerHTML;}
  if(page.scrollHeight<=height)break;
 }
 body.innerHTML=best;
 return {pages:[best],body,label:panel.querySelector('.schedule-page-label')};
}
