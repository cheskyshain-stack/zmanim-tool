const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=d=>new Date(d+'T12:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const rich=v=>esc(String(v??'').replace(/\uE000\s*/g,'\uE000').replace(/\s*\uE001/g,'\uE001')).replace(/\uE000/g,'<u>').replace(/\uE001/g,'</u>').replace(/\n/g,'<br>').replace(/\u00a0/g,' ');
let measuringContext;
function textWidth(element){
 const style=getComputedStyle(element);
 measuringContext??=document.createElement('canvas').getContext('2d');
 measuringContext.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
 const text=node=>node.nodeName==='BR'?'\n':node.nodeType===3?node.textContent:[...node.childNodes].map(text).join('');
 return Math.max(0,...text(element).split('\n').map(line=>measuringContext.measureText(line).width));
}
export function fitScheduleLabels(root){
 if(!root)return;
 for(const row of root.querySelectorAll('.source-row,.weekly-pattern')){
  row.classList.remove('label-above');
  const label=row.querySelector('.source-label,.weekly-row-label');
  if(!label)continue;
  const tooWide=textWidth(label)>label.clientWidth-2;
  const timeGrid=row.querySelector('.source-times'),entries=[...row.querySelectorAll('.source-time')];
  const pairWidth=Math.max(row.closest('.static-dense')?150:164,entries.slice(0,2).reduce((sum,item)=>sum+Math.max(...[...item.children].map(textWidth))+2,12));
  const pairNeedsRoom=entries.length>1&&timeGrid.clientWidth<pairWidth&&row.clientWidth>=pairWidth;
  row.classList.toggle('label-above',tooWide||!entries.length||pairNeedsRoom);
 }
 for(const grid of root.querySelectorAll('.source-times')){
  const style=getComputedStyle(grid),columns=style.gridTemplateColumns.split(' ').filter(Boolean),count=columns.length;
  const width=parseFloat(columns[0]),gap=parseFloat(style.columnGap)||0;
  if(!width||style.display==='none')continue;
  for(const item of grid.querySelectorAll('.source-time')){
   item.style.gridColumn='';item.classList.remove('time-prose');
   const needed=Math.max(...[...item.children].map(textWidth))+2;
   const span=Math.min(count,Math.max(1,Math.ceil((needed+gap)/(width+gap))));
   item.style.gridColumn=`span ${span}`;
   item.classList.toggle('time-prose',needed>span*width+(span-1)*gap+1);
  }
 }
}
function fittedHeight(root){fitScheduleLabels(root);return root.scrollHeight;}
function times(ts,sep=""){return ts.flatMap(t=>String(t.text??'').split(/\s*\/\s*|\n(?=\s*[\uE000\s]*\d{1,2}:)/).map(text=>({...t,text:text.trim()}))).map(t=>`<span class="source-time"><bdi dir="ltr">${t.underlined?'<u>':''}${rich(String(t.text??'').replace(/\s*\/\s*/g,'\u2003'))}${t.underlined?'</u>':''}${esc(t.mark)}</bdi>${t.name?`<small dir="rtl">${esc(t.name)}</small>`:''}</span>`).join(` <span class="time-sep">${esc(sep.replace(/\//g,'').trim())}</span> `);}
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
 const center=stage.querySelector('.tv-center'),weeklyColumns=stage.querySelector('.weekly-split')?2:1;
 const height=body.clientHeight-18,pages=[];let page=document.createElement('div');page.style.display='flow-root';body.replaceChildren(page);
 const source=panel._sections; // caller supplies the original rendered sections
 if(!source)return null;
 // Ordinary Shabbos is a complete reference: show Friday alongside Shabbos/Motzai
 // when both columns fit at the normal readable font size.
 const ordinary=source.length&&source.every(section=>[...section.querySelectorAll('[data-source-id]')].every(row=>row.dataset.sourceId.startsWith('chart:')));
 panel.classList.toggle('ordinary-shabbos', Boolean(ordinary));
 if(ordinary){
  const center=stage.querySelector('.tv-center');
  const previousColumns=center?.style.gridTemplateColumns;
  if(center)center.style.gridTemplateColumns=`minmax(0,${weeklyColumns}fr) minmax(0,1fr)`;
  page.className='shabbos-single';
  for(const section of source)page.append(section.cloneNode(true));
  if(fittedHeight(page)<=body.clientHeight-18)return {pages:[page.outerHTML],body,label:panel.querySelector('.schedule-page-label')};
  if(center)center.style.gridTemplateColumns=previousColumns;
  page.replaceChildren();page.className='';
 }
 if(ordinary&&panel.clientWidth>=780){
   page.className='shabbos-overview';
   const evening=document.createElement('div'),day=document.createElement('div');
   source.forEach((section,i)=>(i===0?evening:day).append(section.cloneNode(true)));
   page.append(evening,day);
   if(fittedHeight(page)<=height){return {pages:[page.outerHTML],body,label:panel.querySelector('.schedule-page-label')};}
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
  if(fittedHeight(page)<=height)return {pages:[page.outerHTML],body,label:panel.querySelector('.schedule-page-label')};
  page.replaceChildren();page.className='';
 }
 // Dense groups use fixed columns, never rotating pages.
 panel.classList.add('static-dense');
 const rows=source.flatMap(section=>[...section.querySelectorAll('.source-row')].map(row=>({row,heading:section.querySelector('.source-heading')})));
 let best='',bestHeight=Infinity,bestCount=2;
 for(const count of [2,3,4]){
  if(center)center.style.gridTemplateColumns=`minmax(0,${weeklyColumns}fr) minmax(0,${count}fr)`;
  page.className='static-schedule-columns';page.style.gridTemplateColumns=`repeat(${count},minmax(0,1fr))`;page.replaceChildren();
  const columns=Array.from({length:count},()=>{const col=document.createElement('section');col.className='static-schedule-column';page.append(col);return col;});
  let index=0,previous=null;
  for(let i=0;i<rows.length;i++){
   if(index<count-1&&i>=Math.ceil(rows.length*(index+1)/count)){index++;previous=null;}
   const {row,heading}=rows[i];
   if(heading!==previous){columns[index].append(heading.cloneNode(true));previous=heading;}
   columns[index].append(row.cloneNode(true));
  }
  // Balance by rendered height, not row count: prose and named times need more room.
  fitScheduleLabels(page);
  const rendered=[...page.querySelectorAll('.source-row')];
  const heights=rendered.map(row=>row.offsetHeight);
  const headingHeight=heading=>{const match=[...page.querySelectorAll('.source-heading')].find(h=>h.textContent===heading.textContent);if(!match)return 0;const style=getComputedStyle(match);return match.offsetHeight+parseFloat(style.marginTop)+parseFloat(style.marginBottom);};
  const costs=Array.from({length:rows.length},()=>[]);
  for(let from=0;from<rows.length;from++){let total=0,heading=null;for(let to=from;to<rows.length;to++){if(rows[to].heading!==heading){heading=rows[to].heading;total+=headingHeight(heading);}total+=heights[to];costs[from][to+1]=total;}}
  const memo=new Map();
  const partition=(from,left)=>{if(left===1)return {height:costs[from]?.[rows.length]||0,cuts:[rows.length]};const key=from+':'+left;if(memo.has(key))return memo.get(key);let best={height:Infinity,cuts:[]};for(let end=from+1;end<=rows.length-left+1;end++){const tail=partition(end,left-1),height=Math.max(costs[from][end],tail.height);if(height<best.height)best={height,cuts:[end,...tail.cuts]};}memo.set(key,best);return best;};
  const balanced=partition(0,Math.min(count,rows.length));let from=0;
  balanced.cuts.forEach((end,i)=>{columns[i].replaceChildren();let heading=null;for(let r=from;r<end;r++){if(rows[r].heading!==heading){heading=rows[r].heading;columns[i].append(heading.cloneNode(true));}columns[i].append(rows[r].row.cloneNode(true));}from=end;});
  if(fittedHeight(page)<bestHeight){bestHeight=fittedHeight(page);best=page.outerHTML;bestCount=count;}
  if(fittedHeight(page)<=height)break;
 }
 body.innerHTML=best;
 if(center)center.style.gridTemplateColumns=`minmax(0,${weeklyColumns}fr) minmax(0,${bestCount}fr)`;
 return {pages:[best],body,label:panel.querySelector('.schedule-page-label')};
}
