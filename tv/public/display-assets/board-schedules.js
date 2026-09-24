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

/** Always keep Shabbos as one continuous column, in saved source order.
 * First measure at the normal type size so the screen can make the panel
 * taller. Compact spacing is an explicit second pass after space is reclaimed.
 * This function never rebuilds rows, paginates, or changes column widths. */
export function fitBoardSchedules(root,p,{allowCompact=false,compactWeekly=true}={}){
 const special=root.querySelector('.board-shabbos'),weekly=root.querySelector('.board-weekly');
 special?.classList.remove('board-compact');
 weekly?.classList.remove('board-compact');
 const naturalSpecial=panelFit(special,'.board-shabbos-body');
 const naturalWeekly=panelFit(weekly,'.board-week-body');
 if(allowCompact&&naturalSpecial?.overflow){
  special.classList.add('board-compact');
 }
 if(compactWeekly&&naturalWeekly?.overflow)weekly.classList.add('board-compact');
 return {
  special:naturalSpecial?{...panelFit(special,'.board-shabbos-body'),naturalRequiredHeight:naturalSpecial.requiredHeight}:null,
  weekly:naturalWeekly?{...panelFit(weekly,'.board-week-body'),naturalRequiredHeight:naturalWeekly.requiredHeight}:null
 };
}
