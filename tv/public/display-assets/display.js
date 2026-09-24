import {DisplayView} from './renderer.js';
import {offlineSnapshot,validSeed} from './offline-engine.js';
import {readOfflineCache,saveOfflineCache} from './offline-cache.js';
const host=document.querySelector('#screen');host.style.height='100vh';
const view=new DisplayView(host);
const connecting=document.createElement('p');connecting.className='boot';connecting.textContent='Connecting to load Shul View…';
Object.assign(connecting.style,{position:'absolute',inset:'40% 0 auto',textAlign:'center'});host.append(connecting);
const OFFLINE_GRACE=5*60*1000;
let seed=null,data=null,offset=0,lastSyncAt=0,inflight=false,recomputeAt=0,seedKey='';
const now=()=>Date.now()+offset;
function draw(){
  connecting.hidden=!!(seed||data);
  if(seed){
    const instant=now();
    if(!data||instant>=recomputeAt||instant<Date.parse(data.at)){
      data=offlineSnapshot(seed,instant);
      recomputeAt=Math.min(instant+60000,Date.parse(data.nextChangeAt)||Infinity);
    }
    view.update(data,{now:instant,stale:false,connection:Date.now()-lastSyncAt>=OFFLINE_GRACE?'cached':'live',lastSyncAt});
  }else if(data){
    // A changed engine is updated on the next normal page load. While connected,
    // retain the authoritative server snapshot instead of guessing new settings.
    view.update(data,{now:now(),stale:Date.now()-lastSyncAt>=OFFLINE_GRACE,connection:'live',lastSyncAt});
  }
}
async function refresh(){
  if(inflight)return;inflight=true;
  try{
    const response=await fetch('/api/display/offline',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Unavailable');
    const incoming=await response.json();
    if(!validSeed(incoming)){
      const latest=await fetch('/api/display/public',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      if(!latest.ok)throw Error('Unavailable');
      data=await latest.json();seed=null;offset=Date.parse(data.at)-Date.now();lastSyncAt=Date.now();
    }else{
      lastSyncAt=Date.now();offset=Date.parse(incoming.generatedAt)-lastSyncAt;
      // Server timestamps change on every poll; unchanged public content must not
      // force a DOM rebuild or reset the fitted original page.
      const key=JSON.stringify([incoming.engine,incoming.appearance,incoming.items]);
      seed=incoming;
      if(key!==seedKey){seedKey=key;recomputeAt=0;}
      await saveOfflineCache({seed,offset,lastSyncAt}).catch(()=>{});
    }
  }catch{/* Brief weak connections leave the running display alone. */}
  finally{inflight=false;draw();}
}
async function start(){
  try{
    const cached=await readOfflineCache();
    if(validSeed(cached?.seed)){seed=cached.seed;offset=Number(cached.offset)||0;lastSyncAt=Number(cached.lastSyncAt)||0;seedKey=JSON.stringify([seed.engine,seed.appearance,seed.items]);draw();}
  }catch{/* Browsers with storage disabled still support the live display. */}
  if('serviceWorker' in navigator){
    // New Workers wait for a normal close/reopen. Never reload a live screen.
    void navigator.serviceWorker.register('/display/sw.js',{scope:'/display/',updateViaCache:'none'}).catch(()=>{});
  }
  void refresh();setInterval(refresh,15000);setInterval(draw,1000);
  addEventListener('online',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){draw();void refresh();}});
}
void start();
