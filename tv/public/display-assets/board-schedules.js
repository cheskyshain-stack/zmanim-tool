const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rich=v=>esc(v).replace(/\uE000\s*/g,'<u>').replace(/\s*\uE001/g,'</u>').replace(/\n/g,'<br>');
const date=d=>new Date(d+'T12:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
function times(entries){return entries.flatMap(t=>String(t.text??'').split(/\s*\/\s*|\n(?=\s*[\uE000\s]*\d{1,2}:)/).map(text=>({...t,text:text.trim()}))).map(t=>`<span class="board-time">${t.name?`<small dir="rtl">${esc(t.name)}</small>`:''}<bdi dir="ltr">${t.underlined?'<u>':''}${rich(t.text)}${t.underlined?'</u>':''}${esc(t.mark)}</bdi></span>`).join('');}
function row(r){let entries=r.times||[],note=r.note;if(r.plagDetail&&note){const m=note.match(/\d{1,2}:\d{2}/);if(m){entries=[...entries,{text:m[0],name:note.replace(m[0],'').trim()}];note='';}}return `<div class="board-schedule-row ${r.label.length>26?'board-long-label':''}" data-source-id="${esc(r.id)}"><div class="board-times">${times(entries)}</div><div class="board-prayer-label" dir="rtl">${rich(r.label)}</div>${note?`<p class="board-row-note" dir="auto">${rich(note)}</p>`:''}</div>`;}
function scope(days){const byOccasion=new Map();for(const d of days){const bits=d.label.split(' · '),day=bits.pop(),occasion=bits.join(' · ');if(!byOccasion.has(occasion))byOccasion.set(occasion,[]);byOccasion.get(occasion).push(day);}return [...byOccasion].map(([occasion,days])=>[occasion,...new Set(days)].filter(Boolean).join(' · ')).join(' · ');}
function events(g){const source=g.events.find(e=>e.sourceText);return source?[{text:source.sourceText}]:g.events.map(e=>({text:e.time,underlined:/למטה/.test(e.place),mark:/אולם/.test(e.place)?'**':/בעזר/.test(e.place)?'*':'',name:!['בית מדרש','למטה','בעזר״נ','באולם השמחות',''].includes(e.place)?e.place:''}));}
export function boardSchedules(p,upcoming=''){
 const w=p.weekly,s=p.special;
 const ordinary=s?.sections.every(s=>s.rows.every(r=>r.id.startsWith('chart:')));
 const weekly=`<section class="board-weekly"><h2 dir="rtl">זמני חול</h2><h3 class="board-week-title" dir="rtl">${esc(w.title.replace(/^חול /,''))}</h3><p class="board-range">${date(w.from)} – ${date(w.to)}</p><div class="board-week-body">${w.services.map(service=>`<section class="board-service"><h3 dir="rtl">${esc(service.name)}</h3>${service.groups.filter(g=>g.events.length).map((g,i)=>`<div class="board-pattern ${i?'board-exception':''}">${i?`<h4 dir="rtl">${esc(scope(g.days))}</h4>`:''}<div class="board-times">${times(events(g))}</div>${g.events.some(e=>e.note)?`<p dir="auto">${[...new Set(g.events.map(e=>e.note).filter(Boolean))].map(esc).join(' · ')}</p>`:''}</div>`).join('')}</section>`).join('')}${(w.posterSections||[]).map(section=>`<section class="board-service"><h3 dir="rtl">${esc(section.heading)}</h3>${section.rows.map(row).join('')}${section.morningExclusion?`<p dir="rtl">${esc(section.morningExclusion)}</p>`:''}</section>`).join('')}${upcoming}</div></section>`;
 const special=s?`<section class="board-shabbos"><h2 dir="rtl">${esc(s.title)}</h2><p class="board-range">${date(s.from)} – ${date(s.to)}</p><div class="board-shabbos-body">${s.sections.map(section=>`${!ordinary?`<h3 dir="rtl">${esc(section.heading)}</h3>`:''}${section.rows.map(row).join('')}`).join('')}</div></section>`:'';
 return special+weekly;
}

/** Keep every saved row on screen. Long special schedules share their panel
 * across two static columns; the weekly reference never rotates or disappears. */
export function fitBoardSchedules(root,p){
 const special=root.querySelector('.board-shabbos'),weekly=root.querySelector('.board-weekly');
 if(!special||!p?.special)return;
 const body=special.querySelector('.board-shabbos-body'),area=special.parentElement;
 const overflow=panel=>Math.max(0,panel.scrollHeight-panel.clientHeight-2);
 if(body.dataset.fitted==='columns')return;
 for(const panel of [special,weekly].filter(Boolean))if(overflow(panel))panel.classList.add('board-compact');
 if(!overflow(special))return;
 // A summer Shabbos needs only a little less vertical row padding, without
 // reducing the Hebrew lettering or time size further.
 for(const row of body.querySelectorAll('.board-schedule-row'))row.style.paddingBlock='3px';
 if(!overflow(special))return;

 const ordinary=p.special.sections.every(s=>s.rows.every(r=>r.id.startsWith('chart:')));
 const rows=p.special.sections.flatMap((section,sectionIndex)=>section.rows.map(r=>({r,sectionIndex,heading:section.heading})));
 if(rows.length<2)return;
 const columnHTML=part=>{
  let previous=-1;
  return part.map(entry=>{
   const heading=!ordinary&&entry.sectionIndex!==previous?`<h3 dir="rtl" style="font:700 23px David;margin:5px 0;color:var(--accent,#b39750)">${esc(entry.heading)}</h3>`:'';
   previous=entry.sectionIndex;
   return heading+row(entry.r);
  }).join('');
 };
 body.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;direction:rtl;flex:1;min-height:0';
 const render=cut=>{
  body.innerHTML=[rows.slice(0,cut),rows.slice(cut)].map(part=>`<div class="board-static-column" style="min-width:0;min-height:0;direction:ltr">${columnHTML(part)}</div>`).join('');
  for(const row of body.querySelectorAll('.board-schedule-row'))row.style.paddingBlock='3px';
 };
 // Measure real rendered text (including long Hebrew labels and multiple
 // minyanim). Keep source order and repeat only the day heading at a split.
 let best={cost:Infinity,ratio:'2fr 1fr',cut:Math.ceil(rows.length/2)};
 for(const ratio of ['2fr 1fr','1.8fr 1.2fr','1.6fr 1.4fr','1.4fr 1.6fr']){
  area.style.setProperty('grid-template-columns',ratio,'important');
  if(weekly&&overflow(weekly))weekly.classList.add('board-compact');
  for(let cut=1;cut<rows.length;cut++){
   render(cut);
   const columns=[...body.children],maxHeight=Math.max(...columns.map(c=>c.lastElementChild?c.lastElementChild.getBoundingClientRect().bottom-c.getBoundingClientRect().top:0));
   const columnOverflow=Math.max(...columns.map(c=>Math.max(0,c.scrollHeight-c.clientHeight-2)));
   const cost=columnOverflow+(weekly?overflow(weekly):0);
   // When multiple divisions fit, prefer the one with more reading space.
   if(cost<best.cost||(cost===best.cost&&maxHeight<best.height))best={cost,ratio,cut,height:maxHeight};
  }
  if(best.cost===0)break;
 }
 area.style.setProperty('grid-template-columns',best.ratio,'important');
 render(best.cut);
 body.dataset.fitted='columns';
 special.classList.add('board-static-special');
}
