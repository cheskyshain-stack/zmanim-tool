const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=t=>`<span class="sheet-time">${t.name?`<small>${esc(t.name)}</small>`:''}<span>${t.underlined?`<u>${esc(t.text)}</u>`:esc(t.text)}${esc(t.mark)}</span></span>`;
function row(r){return `<div class="sheet-row ${r.times.length>3?'sheet-many':r.label.length>22?'sheet-wide':''}" data-sheet-source="${esc(r.id)}"><div class="sheet-times">${r.times.map(time).join('')}${r.note?`<span class="sheet-note">${esc(r.note)}</span>`:''}</div><div class="sheet-label">${esc(r.label)}</div></div>`;}
export function fullSheetHTML(sheet,schedule,{preview,stale}){
 const blocks=sheet.blocks;
 // Match the approved grouping by the saved headings, never by calendar guesses.
 const middle=blocks.filter(b=>/חול המועד|הושענא|אחר סוכות/.test(b.heading)&&!/^שבת/.test(b.heading));
 const first=blocks.filter(b=>/^יום [אב]['׳]/.test(b.heading));
 const rest=blocks.filter(b=>!middle.includes(b)&&!first.includes(b));
 const groups=[first,middle,rest];
 return `<section class="full-sheet"><header class="sheet-header"><div dir="rtl">${esc(schedule.shulName)}</div><h1 dir="rtl">${esc(sheet.title)} · ${esc(sheet.yearLabel || sheet.year)}</h1><small dir="rtl">${esc(schedule.hebrewDate)}<br><bdi dir="ltr">${esc(schedule.date)}</bdi> · <bdi class="tv-clock" dir="ltr"></bdi></small></header><main class="sheet-columns">${groups.map(group=>`<div class="sheet-column">${group.map(b=>`<section><h2 dir="rtl">${esc(b.heading)}</h2>${b.rows.map(row).join('')}</section>`).join('')}</div>`).join('')}</main><footer class="sheet-footer"><span>${preview?'PRIVATE PREVIEW · ':''}${stale?'CONNECTION LOST — confirm schedule times':'SHUL VIEW'}</span><span dir="rtl">כל הזמנים מעוגלים — נא להחמיר שתי דקות</span><span dir="rtl"><u>קו תחתי</u>: בבית מדרש למטה · * בעזרת נשים · ** באולם השמחות</span></footer></section>`;
}
export function fitFullSheet(root){
 const sheet=root.querySelector('.full-sheet');if(!sheet)return;
 const cols=[...sheet.querySelectorAll('.sheet-column')];
 if(cols.some(c=>c.scrollHeight>c.clientHeight+2)){
   const blocks=cols.flatMap(c=>[...c.children]);
   const grid=sheet.querySelector('.sheet-columns');grid.style.gridTemplateColumns='repeat(4,minmax(0,1fr))';
   grid.innerHTML='';const out=Array.from({length:4},()=>{const c=document.createElement('div');c.className='sheet-column';c.style.justifyContent='flex-start';grid.append(c);return c;});
   const height=c=>[...c.children].reduce((n,e)=>n+e.getBoundingClientRect().height,0)+Math.max(0,c.children.length-1)*10;
   for(const block of blocks){const target=out.reduce((a,b)=>height(a)<=height(b)?a:b);target.append(block);}
 }
 // Keep the established full schedule view if a future source sheet cannot fit.
 // Never clip source information to force a particular number of columns.
 if([...sheet.querySelectorAll('.sheet-column,.sheet-row')].some(c=>c.scrollHeight>c.clientHeight+2||c.scrollWidth>c.clientWidth+2))sheet.remove();
}
