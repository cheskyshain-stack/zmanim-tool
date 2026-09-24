const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=t=>`<span class="sheet-time">${t.name?`<small>${esc(t.name)}</small>`:''}<span>${t.underlined?`<u>${esc(t.text)}</u>`:esc(t.text)}${esc(t.mark)}</span></span>`;
function row(r){return `<div class="sheet-row ${r.times.length>3?'sheet-many':r.label.length>22?'sheet-wide':''}" data-sheet-source="${esc(r.id)}"><div class="sheet-times">${r.times.map(time).join('')}${r.note?`<span class="sheet-note">${esc(r.note)}</span>`:''}</div><div class="sheet-label">${esc(r.label)}</div></div>`;}
export function fullSheetHTML(sheet,_schedule,_options={}){
 const blocks=sheet.blocks;
 // Match the approved grouping by the saved headings, never by calendar guesses.
 const middle=blocks.filter(b=>/חול המועד|הושענא|אחר סוכות/.test(b.heading)&&!/^שבת/.test(b.heading));
 const first=blocks.filter(b=>/^יום [אב]['׳]/.test(b.heading));
 const rest=blocks.filter(b=>!middle.includes(b)&&!first.includes(b));
 const groups=[first,middle,rest];
 return `<section class="full-sheet"><header class="sheet-header"><h1 dir="rtl">${esc(sheet.title)} · ${esc(sheet.yearLabel || sheet.year)}</h1></header><main class="sheet-columns">${groups.map(group=>`<div class="sheet-column">${group.map(b=>`<section data-sheet-block="${blocks.indexOf(b)}"><h2 dir="rtl">${esc(b.heading)}</h2>${b.rows.map(row).join('')}</section>`).join('')}</div>`).join('')}</main></section>`;
}

// Keep the approved grouping when it fits. Larger future sheets may be split
// at source-row boundaries, in source order, without losing or rotating rows.
export function fitSheetColumns(root){
 const sheet=root?.matches?.('.full-sheet')?root:root?.querySelector('.full-sheet');
 if(!sheet)return {fits:false,repartitioned:false,reason:'No special sheet'};
 const columns=[...sheet.querySelectorAll('.sheet-column')];
 if(columns.length!==3)return {fits:false,repartitioned:false,reason:'Expected three columns'};
 const fits=()=>columns.every(c=>c.scrollHeight<=c.clientHeight+2&&c.scrollWidth<=c.clientWidth+2);
 if(fits())return {fits:true,repartitioned:false};
 const blocks=[...sheet.querySelectorAll('.sheet-column>section')].sort((a,b)=>Number(a.dataset.sheetBlock)-Number(b.dataset.sheetBlock));
 const entries=blocks.flatMap((block,b)=>{
   const rows=[...block.querySelectorAll(':scope>.sheet-row')];
   return (rows.length?rows:[null]).map(row=>({block:b,row}));
 });
 if(entries.length<3)return {fits:false,repartitioned:false,reason:'Too few rows to repartition'};
 const metrics=columns.map(column=>{
   const style=getComputedStyle(column),probe=document.createElement('section');
   const width=column.clientWidth-parseFloat(style.paddingLeft||0)-parseFloat(style.paddingRight||0);
   probe.style.cssText=`position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:${width}px;`;
   column.append(probe);
   try{
     const headings=blocks.map(block=>{
       const heading=block.querySelector(':scope>h2').cloneNode(true);probe.append(heading);
       const css=getComputedStyle(heading);
       return heading.offsetHeight+parseFloat(css.marginTop||0)+parseFloat(css.marginBottom||0);
     });
     const rows=entries.map(entry=>{
       if(!entry.row)return 0;
       const clone=entry.row.cloneNode(true);probe.append(clone);return clone.offsetHeight;
     });
     return {headings,rows,gap:parseFloat(style.rowGap)||10,height:column.clientHeight};
   }finally{probe.remove();}
 });
 const n=entries.length;
 const costs=metrics.map(m=>Array.from({length:n},(_,start)=>{
   const values=Array(n+1).fill(Infinity);let height=0,previous=-1;
   for(let end=start;end<n;end++){
     const block=entries[end].block;
     if(block!==previous){height+=m.headings[block]+(previous===-1?0:m.gap);previous=block;}
     height+=m.rows[end];values[end+1]=height;
   }
   return values;
 }));
 let best=null;
 for(let a=1;a<n-1;a++)for(let b=a+1;b<n;b++){
   const heights=[costs[0][0][a],costs[1][a][b],costs[2][b][n]];
   if(heights.some((h,i)=>h>metrics[i].height+1))continue;
   const splits=Number(entries[a-1].block===entries[a].block)+Number(entries[b-1].block===entries[b].block);
   const spread=Math.max(...heights)-Math.min(...heights);
   if(!best||splits<best.splits||(splits===best.splits&&spread<best.spread))best={a,b,splits,spread};
 }
 if(!best)return {fits:false,repartitioned:false,reason:'All source rows cannot fit in three columns at the current type size'};
 const original=columns.map(c=>[...c.children]);
 const boundaries=[0,best.a,best.b,n];
 columns.forEach((column,i)=>{
   const fragment=document.createDocumentFragment();let section=null,previous=-1;
   for(let index=boundaries[i];index<boundaries[i+1];index++){
     const entry=entries[index];
     if(entry.block!==previous){
       section=document.createElement('section');section.dataset.sheetBlock=blocks[entry.block].dataset.sheetBlock;
       section.append(blocks[entry.block].querySelector(':scope>h2').cloneNode(true));
       fragment.append(section);previous=entry.block;
     }
     if(entry.row)section.append(entry.row.cloneNode(true));
   }
   column.replaceChildren(fragment);
 });
 if(!fits()){
   columns.forEach((c,i)=>c.replaceChildren(...original[i]));
   return {fits:false,repartitioned:false,reason:'Measured repartition still overflows; original rows preserved'};
 }
 return {fits:true,repartitioned:true};
}
