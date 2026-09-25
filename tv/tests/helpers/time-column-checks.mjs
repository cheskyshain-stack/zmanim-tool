// Browser-only geometry checks shared by focused fixtures and the calendar audit.
// The function is self-contained so the static preview server needs no test route.
export function inspectTimeColumns(root, scale=1, {includeSheets=true}={}) {
 const issues=[],metrics={tables:0,pairedRows:0,balancedGroups:0,wrappedGroups:0,firstTimeNotes:0,maximumBoundaryGap:0,maximumLeftSpread:0,timeCounts:[]};
 const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left/scale,right:r.right/scale,top:r.top/scale,bottom:r.bottom/scale,width:r.width/scale,height:r.height/scale};};
 const text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim().slice(0,110);
 const ink=e=>{
  const boxes=[],walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
  for(let node;(node=walker.nextNode());)if(node.textContent.trim()){
   const range=document.createRange();range.selectNodeContents(node);
   boxes.push(...[...range.getClientRects()].filter(r=>r.width&&r.height));
  }
  return boxes.length?{left:Math.min(...boxes.map(r=>r.left))/scale,right:Math.max(...boxes.map(r=>r.right))/scale,top:Math.min(...boxes.map(r=>r.top))/scale,bottom:Math.max(...boxes.map(r=>r.bottom))/scale}:null;
 };
 const lineBoxes=elements=>{
  const lines=[];
  for(const element of elements){
   const r=rect(element);
   let line=lines.find(line=>Math.abs(line.bottom-r.bottom)<=3);
   if(!line){line={bottom:r.bottom,items:[],left:Infinity,right:-Infinity};lines.push(line);}
   line.items.push(element);line.left=Math.min(line.left,r.left);line.right=Math.max(line.right,r.right);
  }
  return lines.sort((a,b)=>a.bottom-b.bottom);
 };
 function balanced(times,selector){
  const units=[...times.querySelectorAll(selector)].filter(el=>el.getClientRects().length);
  if(!units.length)return;
  const lines=lineBoxes(units),counts=lines.map(line=>line.items.length),details={times:text(times),counts};
  metrics.balancedGroups++;metrics.timeCounts.push(units.length);
  if(lines.length>1){
   metrics.wrappedGroups++;
   if(Math.max(...counts)-Math.min(...counts)>1)issues.push({code:'unbalanced-time-lines',...details});
   const starts=lines.map(line=>line.left);
   if(Math.max(...starts)-Math.min(...starts)>2)issues.push({code:'time-lines-different-left-start',...details,starts});
  }
  // DOM order must still read left-to-right, then onto the next full line.
  const actual=lines.flatMap(line=>[...line.items].sort((a,b)=>rect(a).left-rect(b).left));
  if(units.some((unit,index)=>unit!==actual[index]))issues.push({code:'time-reading-order',...details});
  for(const line of lines)for(let i=1;i<line.items.length;i++){
   const previous=rect(line.items[i-1]),current=rect(line.items[i]);
   if(current.left<previous.right-2)issues.push({code:'time-units-overlap',...details});
  }
 }
 function table(container,rowSelector,labelSelector,timeSelector,unitSelector){
  const records=[];
  for(const row of container.querySelectorAll(rowSelector)){
   const label=row.querySelector(labelSelector),times=row.querySelector(timeSelector);
   if(!label?.textContent.trim()||!times?.textContent.trim())continue;
   const l=rect(label),t=rect(times),li=ink(label),ti=ink(times);
   if(!li||!ti)continue;
   // A notes-only row may span the table. Paired rows keep the label on its right.
   if(li.bottom<=ti.top+2)continue;
   const rowBox=rect(row),style=getComputedStyle(row),font=Math.max(parseFloat(getComputedStyle(label).fontSize),parseFloat(getComputedStyle(times).fontSize));
   const gap=l.left-t.right,details={table:container.className,label:text(label),times:text(times)};
   records.push({l,t,li,ti,font});metrics.pairedRows++;
   const labelStyle=getComputedStyle(label),lineHeight=parseFloat(labelStyle.lineHeight)||parseFloat(labelStyle.fontSize)*1.2;
   if(li.bottom-li.top>lineHeight*2+2)issues.push({code:'paired-label-over-two-lines',...details,height:li.bottom-li.top,lineHeight});
   if(t.right>l.left+2)issues.push({code:'shared-time-label-overlap',...details,gap});
   if(gap>Math.min(40,1.5*font)+2)issues.push({code:'shared-column-gap',...details,gap});
   metrics.maximumBoundaryGap=Math.max(metrics.maximumBoundaryGap,gap);
   const end=rowBox.right-(parseFloat(style.paddingRight)||0)-(parseFloat(style.borderRightWidth)||0);
   if(Math.abs(l.right-end)>3)issues.push({code:'schedule-table-not-right-anchored',...details,labelRight:l.right,rowEnd:end});
   const first=times.querySelector(unitSelector),firstInk=first&&ink(first.querySelector(':scope > bdi:not(.onepage-note),:scope > .zman-pair-time')||first);
   if(firstInk&&text(times).startsWith(text(first))&&Math.abs(firstInk.left-t.left)>3)issues.push({code:'time-not-at-column-left',...details,start:firstInk.left,columnLeft:t.left});
  }
  if(!records.length)return;
  metrics.tables++;
  const starts=records.map(r=>r.t.left),ends=records.map(r=>r.t.right),labels=records.map(r=>r.l.left);
  const spread=Math.max(...starts)-Math.min(...starts);
  metrics.maximumLeftSpread=Math.max(metrics.maximumLeftSpread,spread);
  if(spread>2||Math.max(...ends)-Math.min(...ends)>2||Math.max(...labels)-Math.min(...labels)>2)
   issues.push({code:'schedule-shared-columns-not-aligned',table:container.className,starts,ends,labels});
  // Shared cells may leave trailing space beside a short list. Only the widest
  // line defines the required table width, rather than every individual row.
  const used=Math.max(...records.map(r=>r.ti.right-r.ti.left)),available=Math.max(...records.map(r=>r.t.width)),font=Math.max(...records.map(r=>r.font));
  if(available-used>Math.max(60,2*font))issues.push({code:'schedule-time-column-too-wide',table:container.className,available,used});
 }
 for(const panel of root.querySelectorAll('.board-shabbos,.board-weekly'))
  table(panel,'.board-schedule-row','.board-prayer-label','.board-times','.board-time');
 for(const times of root.querySelectorAll('.board-times'))balanced(times,'.board-time');
 const dailyColumns=new Map();
 for(const row of root.querySelectorAll('.board-zmanim>div')){
  const time=row.querySelector(':scope > bdi'),value=time&&ink(time);if(!value)continue;
  const column=Math.round(rect(row).left),starts=dailyColumns.get(column)||[];
  starts.push(value.left);dailyColumns.set(column,starts);
  if(Math.abs(value.left-rect(time).left)>2)issues.push({code:'daily-time-not-left-aligned',time:text(time)});
 }
 for(const starts of dailyColumns.values())if(Math.max(...starts)-Math.min(...starts)>2)issues.push({code:'daily-time-left-starts-differ',starts});
 for(const heading of root.querySelectorAll('.board-service>h3,.board-pattern>h4,.board-day-service>h4')){
  if(!heading.getClientRects().length)continue;
  if(heading.matches('.board-service>h3')&&heading.closest('.board-inline-services')&&getComputedStyle(heading.parentElement).display==='grid')continue;
  if(getComputedStyle(heading).textAlign!=='center')issues.push({code:'weekday-heading-not-centered',label:text(heading)});
 }
 const shadow=includeSheets&&root.querySelector('.original-sheet-host')?.shadowRoot;
 if(shadow){
  for(const column of shadow.querySelectorAll('.onepage-col'))if(column.getClientRects().length)
   table(column,'.onepage-row','.onepage-label','.onepage-times','.onepage-t,.zman-pair');
  for(const times of shadow.querySelectorAll('.onepage-times'))balanced(times,'.onepage-t,.zman-pair');
  for(const note of shadow.querySelectorAll('.sheet-time-note')){
   const times=note.closest('.onepage-times'),first=times?.querySelector('.onepage-t');
   if(!first)continue; // A source note without any clock is not a qualified time.
   metrics.firstTimeNotes++;
   if(note.closest('.onepage-t')!==first)issues.push({code:'source-note-not-attached-to-first-time',note:text(note)});
  }
 }
 metrics.timeCounts=[...new Set(metrics.timeCounts)].sort((a,b)=>a-b);
 return {issues,metrics};
}
