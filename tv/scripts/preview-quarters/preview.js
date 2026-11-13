import {DisplayView} from '/display-assets/renderer.js';
import {offlineSnapshot} from '/display-assets/offline-engine.js';
import {localToISO,localStamp} from '/display-assets/time.js';
import {quarterSchedule} from '/display-assets/quarter-schedules.js';

const samples={weekday:'2026-11-15T05:00',midday:'2026-11-15T12:00',evening:'2026-11-15T23:30',midnight:'2026-11-16T00:15',shabbos:'2026-11-14T05:00',sukkos:'2026-09-26T05:00','rosh-hashana':'2026-09-12T05:00'};
const controls={time:document.querySelector('#preview-time'),theme:document.querySelector('#preview-theme'),sponsor:document.querySelector('#preview-sponsor'),run:document.querySelector('#run-clock'),status:document.querySelector('#preview-status')};
const query=new URLSearchParams(location.search);
if(query.get('clean')==='1')document.body.classList.add('clean');
let saved={};
try{saved=JSON.parse(localStorage.getItem('quarter-layout-preview')||'{}');}catch{}
controls.time.value=query.get('at')||saved.time||samples.weekday;
controls.theme.value=query.get('theme')||saved.theme||'light';
controls.sponsor.value=query.get('sponsor')||saved.sponsor||'published';
const view=new DisplayView(document.querySelector('#screen'));
let seed,source,instant,lastClock=performance.now(),lastSnapshot;
const recentMotion=[],observedAnimations=new WeakSet();
try{instant=Date.parse(localToISO(controls.time.value,'earlier'));}catch{controls.time.value=samples.weekday;instant=Date.parse(localToISO(samples.weekday,'earlier'));}
function remember(){
  try{localStorage.setItem('quarter-layout-preview',JSON.stringify({time:controls.time.value,theme:controls.theme.value,sponsor:controls.sponsor.value}));}catch{}
  const url=new URL(location.href);
  for(const [key,value] of [['at',controls.time.value],['theme',controls.theme.value],['sponsor',controls.sponsor.value]])url.searchParams.set(key,value);
  history.replaceState(null,'',url);
}
function recordMotion(){
  for(const node of document.querySelectorAll('.quarter-flow > *, .quarter-departing')){
    for(const animation of node.getAnimations?.()||[]){
      if(observedAnimations.has(animation))continue;
      const effect=animation.effect,duration=effect?.getTiming().duration;
      if(!Number.isFinite(duration)||duration<=0)continue;
      observedAnimations.add(animation);
      const target=effect.target||node;
      recentMotion.push({observedAt:new Date().toISOString(),previewAt:new Date(instant).toISOString(),targetClass:target.className,text:target.textContent.trim().replace(/\s+/g,' ').slice(0,160),durationMs:duration,playState:animation.playState,currentTimeMs:animation.currentTime,keyframes:effect.getKeyframes().map(frame=>({offset:frame.computedOffset,transform:frame.transform||null,opacity:frame.opacity??null}))});
      if(recentMotion.length>32)recentMotion.shift();
    }
  }
}
function draw(){
  if(!seed)return;
  const snapshot=offlineSnapshot(seed,instant);
  if(controls.sponsor.value!=='published')snapshot.items=snapshot.items.filter(item=>item.kind!=='dedication');
  if(controls.sponsor.value==='sample')snapshot.items.push({id:'preview-only-sponsor',kind:'dedication',title:'Example sponsor',startsAt:'2000-01-01T00:00:00.000Z',endsAt:null,data:{dedicationType:'לזכות',dedicationName:'Example dedication',dedicationText:'A day of Torah and tefillah',message:'This example shows the larger sponsor area.',duration:35}});
  view.update(snapshot,{now:instant,preview:true,theme:controls.theme.value});
  recordMotion();
  lastSnapshot=snapshot;
  controls.status.textContent=`${source}. Prayer groups stay until one hour after their last time; daily zmanim stay for 30 minutes. ${controls.sponsor.value==='sample'?'The sponsor is an example for this preview. ':''}${view.warning?.length?view.warning.join(' '):'This preview does not change the live screen.'}`;
}
function jump(value){recentMotion.length=0;instant=value;lastClock=performance.now();controls.time.value=localStamp(new Date(instant)).slice(0,16);remember();draw();}
function showTransition(kind){
  if(!lastSnapshot)return;
  const data=quarterSchedule(lastSnapshot.schedule,new Date(instant).toISOString());
  const groups=(data.prayerDays||[{groups:data.groups}]).flatMap(day=>day.groups||[]);
  const zmanim=(data.zmanDays||[{zmanim:data.zmanim}]).flatMap(day=>day.zmanim||[]);
  const boundaries=[...(kind==='zmanim'?[]:groups.map(group=>({at:Date.parse(group.expiresAt)+1,label:group.label}))),...(kind==='prayers'?[]:zmanim.map(zman=>({at:Date.parse(zman.expiresAt)+1,label:zman.label})))].filter(value=>Number.isFinite(value.at)&&value.at>instant+8000).sort((a,b)=>a.at-b.at);
  if(!boundaries.length){controls.status.textContent='No later removal boundary is loaded. Choose another date or an earlier time.';return;}
  controls.run.checked=true;jump(boundaries[0].at-8000);
  controls.status.textContent=`${boundaries[0].label} will leave the frame in eight seconds. The next entries will move upward.`;
}
function measureLayout(){
  const stage=document.querySelector('.tv-stage');
  if(!stage)return;
  const rect=element=>element.getBoundingClientRect();
  const stageBox=rect(stage),scale=stageBox.width/1920;
  const number=value=>Math.round(value*100)/100;
  const dimensions=element=>{const box=rect(element);return {x:number((box.left-stageBox.left)/scale),y:number((box.top-stageBox.top)/scale),width:number(box.width/scale),height:number(box.height/scale)};};
  const left=stage.querySelector('.quarter-zmanim'),center=stage.querySelector('.quarter-center'),right=stage.querySelector('.quarter-prayers');
  const parts=[['Left: daily zmanim',left],['Center',center],['Right: daily prayers',right]].filter(([,node])=>node);
  const total=parts.reduce((sum,[,node])=>sum+rect(node).width,0);
  const rows=parts.map(([label,node])=>({section:label,...dimensions(node),shareOfPanelWidths:number(rect(node).width/total*100)+'%'}));
  const panels=[['Daily zmanim',left],['Daily prayers',right]].filter(([,node])=>node).map(([name,panel])=>{
    const viewport=panel.querySelector('.quarter-viewport'),bounds=rect(viewport);
    const visible=[...panel.querySelectorAll('[data-time]')].filter(node=>!node.hidden&&node.getClientRects().length);
    const partial=visible.filter(node=>{const box=rect(node);return box.top<bounds.top-.75||box.bottom>bounds.bottom+.75||box.left<bounds.left-.75||box.right>bounds.right+.75;});
    const labels=[...panel.querySelectorAll('h2,h3,.quarter-day-label,.quarter-day-heading')].filter(node=>node.getClientRects().length).map(node=>node.textContent.trim());
    return {name,viewport:dimensions(viewport),visibleTimes:visible.length,partiallyVisibleTimes:partial.map(node=>node.textContent.trim()),laterTimes:panel.dataset.laterTimes||'0',visibleHeadings:labels};
  });
  const focus=stage.querySelector('.quarter-focus'),sponsor=stage.querySelector('.board-dedication'),next=stage.querySelector('.next-minyan');
  const overflow=[...stage.querySelectorAll('.quarter-panel,.quarter-focus,.board-dedication')].filter(node=>node.scrollWidth>node.clientWidth+2||node.scrollHeight>node.clientHeight+2).map(node=>node.className);
  const report={previewNewYorkTime:localStamp(new Date(instant)),measuredIn:'Unscaled design pixels, from getBoundingClientRect; percentage excludes gaps and outside padding',renderedScreenPixels:{width:number(stageBox.width),height:number(stageBox.height)},designPixels:{width:1920,height:1080},sections:rows,center:{upper:focus?dimensions(focus):null,lower:sponsor?dimensions(sponsor):null,nextMinyan:next?dimensions(next):null},panels,overflowingPanels:overflow,recentMotion:[...recentMotion]};
  document.querySelector('#layout-report').textContent=JSON.stringify(report,null,2);
  document.querySelector('#layout-measurements').showModal();
}
document.querySelector('#preview-form').addEventListener('submit',event=>{
  event.preventDefault();
  try{jump(Date.parse(localToISO(controls.time.value,'earlier')));}catch(error){controls.status.textContent=error.message;}
});
for(const button of document.querySelectorAll('[data-sample]'))button.addEventListener('click',()=>{controls.run.checked=false;jump(Date.parse(localToISO(samples[button.dataset.sample],'earlier')));});
document.querySelector('#current-time').addEventListener('click',()=>{controls.run.checked=true;jump(Date.now());});
document.querySelector('#next-five').addEventListener('click',()=>jump(instant+5*60000));
document.querySelector('#next-hour').addEventListener('click',()=>jump(instant+60*60000));
document.querySelector('#demo-transition').addEventListener('click',()=>showTransition('all'));
document.querySelector('#demo-prayers').addEventListener('click',()=>showTransition('prayers'));
document.querySelector('#demo-zmanim').addEventListener('click',()=>showTransition('zmanim'));
document.querySelector('#measure-layout').addEventListener('click',measureLayout);
controls.theme.addEventListener('change',()=>{remember();draw();});
controls.sponsor.addEventListener('change',()=>{remember();draw();});
controls.run.addEventListener('change',()=>{lastClock=performance.now();});
document.querySelector('#full-screen').addEventListener('click',()=>document.querySelector('#screen').requestFullscreen?.().catch(()=>{controls.status.textContent='Full screen is unavailable in this browser. The preview below is unchanged.';}));
setInterval(()=>{
  const clock=performance.now();
  if(controls.run.checked){instant+=clock-lastClock;controls.time.value=localStamp(new Date(instant)).slice(0,16);draw();}
  lastClock=clock;
},1000);
try{
  const response=await fetch('/seed.json',{cache:'no-store'});
  if(!response.ok)throw Error('Could not load the preview data.');
  ({seed,source}=await response.json());remember();draw();
  if(query.get('measure')==='1')Promise.resolve(document.fonts?.ready).then(()=>requestAnimationFrame(()=>requestAnimationFrame(measureLayout)));
}catch(error){controls.status.textContent=error.message;}
addEventListener('pagehide',()=>view.destroy());
