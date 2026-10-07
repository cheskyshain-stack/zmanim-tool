import { TV3View } from './tv3-view.js';
import { offlineSnapshot, validSeed } from './offline-engine.js';
import { readOfflineCache, saveOfflineCache } from './offline-cache.js';

const host = document.querySelector('#screen'), view = new TV3View(host);
const boot = document.createElement('p'); boot.className = 'boot'; boot.setAttribute('role','status');
boot.textContent = 'Connecting to load the shul schedule…'; host.append(boot);
let seed = null, snapshot = null, offset = 0, lastSync = 0, nextCalculation = 0, fetching = false, signature = '';
const now = () => Date.now() + offset;
function render() {
  boot.hidden = !!(seed || snapshot);
  if (seed) {
    const at = now();
    if (!snapshot || at >= nextCalculation || at < Date.parse(snapshot.at)) {
      snapshot = offlineSnapshot(seed,at);
      nextCalculation = Math.min(at + 60000,Date.parse(snapshot.nextChangeAt) || Infinity);
    }
    view.update(snapshot,{now:at,connection:Date.now() - lastSync >= 300000 ? 'cached' : 'live'});
  } else if (snapshot) view.update(snapshot,{now:now(),stale:Date.now() - lastSync >= 300000});
}
async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    const response = await fetch('/api/display/offline',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('Schedule unavailable');
    const result = await response.json();
    if (validSeed(result)) {
      lastSync = Date.now(); offset = Date.parse(result.generatedAt) - lastSync;
      const key = JSON.stringify([result.engine,result.appearance,result.items]);
      seed = result;
      if (key !== signature) { signature = key; nextCalculation = 0; }
      await saveOfflineCache({seed,offset,lastSyncAt:lastSync}).catch(()=>{});
    } else {
      const fallback = await fetch('/api/display/public',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});
      if (!fallback.ok) throw Error('Schedule unavailable');
      snapshot = await fallback.json(); seed = null; lastSync = Date.now(); offset = Date.parse(snapshot.at) - lastSync;
    }
  } catch {
    if (!seed && !snapshot) boot.textContent = 'The schedule is unavailable. Reconnecting…';
  } finally { fetching = false; render(); }
}
async function start() {
  try {
    const cached = await readOfflineCache();
    if (validSeed(cached?.seed)) {
      seed = cached.seed; offset = Number(cached.offset) || 0; lastSync = Number(cached.lastSyncAt) || 0;
      signature = JSON.stringify([seed.engine,seed.appearance,seed.items]); render();
    }
  } catch {}
  refresh(); setInterval(refresh,15000); setInterval(render,1000);
  addEventListener('online',refresh);
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) { render(); refresh(); } });
}
start();
