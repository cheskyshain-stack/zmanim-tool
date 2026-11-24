// Build first. All accounts, events, latency and view counters are isolated fixtures.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(process.env.CALENDAR_TEST_DIST || path.join(__dirname, '../dist'));
const token = 'd'.repeat(64), sessionKey = 'lakewood-commons-calendar-session-v1';
const date = new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York' }).format(new Date());
let origin, endpoint, mode, role, calls = [], views = 0, calendarRequests = [], activate = false, paint = null, prepared = false, expectCalendar = false;
const user = () => ({ id:'synthetic-' + role, role, name:'Calendar preload fixture', active:true });
const api = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url, endpoint);
  const call = { path:url.pathname, method:req.method, completed:false }; calls.push(call);
  assert.equal(req.method, 'GET', 'Preparing the calendar must not write calendar or message records');
  if (url.pathname !== '/api/info') assert.equal(req.headers.authorization, 'Bearer ' + token);
  const event = { id:'preload-fixture-event', type:'kiddush', title:'Prepared calendar event', details:'Fixture event details', description:'Fixture event details', date, endDate:date, allDay:true, revision:1, createdBy:user().id };
  const body = url.pathname === '/api/session' ? { user:user() }
    : url.pathname === '/api/events' ? { events:[event] }
    : { ready:true, selfRegistration:true, messages:[], nextBefore:null, total:0, unread:0, deletedCount:0, editCount:0 };
  setTimeout(() => { call.completed = true; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(body)); }, 350);
});
const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/prepare') { res.setHeader('Content-Type','text/html'); return res.end('<!doctype html><title>Fixture setup</title>'); }
  if (url.pathname === '/qa/prepared') { prepared=true;return res.writeHead(204).end(); }
  if (url.pathname === '/qa/activate') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({activate})); }
  if (url.pathname === '/qa/paint') { let body='';req.on('data',part=>body+=part);req.on('end',()=>{paint=JSON.parse(body);res.writeHead(204).end();});return; }
  if (url.pathname === '/qa/calendar-open') { views++; return res.writeHead(204).end(); }
  if (url.pathname === '/data/calendar.json') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({ endpoint })); }
  if (mode === 'cold' && url.pathname === '/js/calendar-preload.js') { res.setHeader('Content-Type','text/javascript'); return res.end('export function preloadCalendar() {}'); }
  let file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep) && file !== root) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon' })[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control','public, max-age=600');
  let body = fs.readFileSync(file);
  if (url.pathname === '/calendar/') {
    calendarRequests.push(req.headers['sec-purpose'] || 'ordinary');
    body = body.toString().replace('</head>', `<script>
const testErrors=[];window.addEventListener('error',event=>testErrors.push(event.message||event.target.src||'Resource error'));window.addEventListener('unhandledrejection',event=>testErrors.push(String(event.reason)));
window.addEventListener('zmanim-calendar-open',()=>fetch('/qa/calendar-open',{method:'POST'}));
let sentPrepared=false;
const paintTimer=setInterval(()=>{
 const calendarReady=!!document.querySelector('[data-cal-day="${date}"]:not([disabled])') && !!document.querySelector('.cal-event-chip[title$="Prepared calendar event"]');
 const loginReady=!!document.querySelector('.cal-login h2');
 if(document.prerendering&&!sentPrepared&&(calendarReady||loginReady)){sentPrepared=true;fetch('/qa/prepared');}
 const ready=${expectCalendar}?calendarReady:loginReady;
 if(document.prerendering||!ready)return;clearInterval(paintTimer);
 fetch('/qa/paint',{method:'POST',body:JSON.stringify({errors:testErrors,ready:Date.now(),click:Number(sessionStorage.getItem('qa-click-at')),activation:performance.getEntriesByType('navigation')[0].activationStart||0})});
},20);
</script></head>`);
  }
  res.end(body);
});
const waitFor = async check => {
  for (let i=0; i<150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve,100)); }
  throw Error('The calendar did not prepare in the background: ' + JSON.stringify({ calls, calendarRequests }));
};
// Use one CDP session: multiple automation sessions make Chrome disable prerender.
async function startChrome(profile,width) {
  const process = spawn(global.process.env.CHROME_BIN || '/usr/bin/chromium', ['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size='+width+',852','about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile = path.join(profile,'DevToolsActivePort');
  await waitFor(()=>fs.existsSync(portFile));
  const [port,endpointPath] = fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
  const socket = new WebSocket('ws://127.0.0.1:'+port+endpointPath);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0,sessionId;const pending=new Map(),errors=[],preloads=[];
  socket.onmessage = event => {
    const message=JSON.parse(event.data);
    if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result);}}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')errors.push(message.params.entry.text);
    if(message.method==='Preload.prerenderStatusUpdated')preloads.push(message.params);
  };
  const rpc=(method,params={},sid=sessionId)=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params,...(sid?{sessionId:sid}:{})}));});
  const targets=await rpc('Target.getTargets',{},null);
  const targetId=targets.targetInfos.find(t=>t.type==='page').targetId;
  const attach=async target=>{
    sessionId=(await rpc('Target.attachToTarget',{targetId:target,flatten:true},null)).sessionId;
    await rpc('Page.enable');await rpc('Runtime.enable');await rpc('Log.enable');await rpc('Preload.enable');
    await rpc('Page.setPrerenderingAllowed',{isAllowed:true});
    await rpc('Emulation.setDeviceMetricsOverride',{width,height:852,deviceScaleFactor:1,mobile:true});
  };
  await attach(targetId);
  const evaluate=async expression=>{
    const result=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return {send:rpc,evaluate,errors,preloads,detach:async()=>{await rpc('Target.detachFromTarget',{sessionId},null);sessionId=null;},
    until:async expression=>{for(let i=0;i<150;i++){try{if(await evaluate(expression))return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Browser condition not met: '+expression);},
    attachActiveCalendar:async url=>{
      for(let i=0;i<100;i++){
        const {targetInfos}=await rpc('Target.getTargets',{},null);
        const target=targetInfos.find(t=>t.type==='page'&&t.url===url&&!t.subtype);
        if(target){await attach(target.targetId);return;}
        await new Promise(r=>setTimeout(r,100));
      }
      throw Error('The calendar target did not activate');
    },
    close:async()=>{rpc('Browser.close',{},null).catch(()=>{});await new Promise(resolve=>{const timer=setTimeout(()=>{process.kill();resolve();},3000);process.once('exit',()=>{clearTimeout(timer);resolve();});});socket.close();}
  };
}
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  await new Promise(resolve => api.listen(0,'127.0.0.1',resolve)); endpoint = 'http://127.0.0.1:' + api.address().port;
  const results = [];
  try {
    for (const scenario of [
      { mode:'cold', role:'viewer', width:393 },
      { mode:'warm', role:'viewer', width:393 },
      { mode:'warm', role:'editor', width:375 },
      { mode:'warm', role:'owner', width:393 },
      { mode:'fallback', role:'viewer', width:375 },
      { mode:'warm', role:null, width:393 },
      { mode:'warm', role:'viewer', width:393, fragment:'#invite=synthetic-private-invitation' },
      { mode:'warm', role:'viewer', width:393, expires:true },
      { mode:'save-data', role:'viewer', width:375 },
    ]) {
      ({ mode, role } = scenario); calls=[]; views=0; calendarRequests=[]; activate=false;paint=null;prepared=false;expectCalendar=!!role&&!scenario.expires&&!scenario.fragment;
      const profile = fs.mkdtempSync(path.join(os.tmpdir(),'calendar-prerender-'));
      const browser = await startChrome(profile, scenario.width);
      try {
        await browser.send('Page.navigate',{url:origin+'/prepare'});
        await browser.until(`location.pathname === '/prepare'`);
        if(mode==='warm')await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.requestIdleCallback = callback => setTimeout(callback,1000);'});
        if (mode === 'fallback') await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:'HTMLScriptElement.supports = () => false;'});
        if(mode==='save-data')await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator.connection,'saveData',{get:()=>true});"});
        const expires=scenario.expires?Date.now()+5000:Date.parse('2299-01-01T00:00:00Z');
        if (role) await browser.evaluate(`localStorage.setItem(${JSON.stringify(sessionKey)}, ${JSON.stringify(JSON.stringify({token,expires,user:user()}))}); sessionStorage.setItem(${JSON.stringify(sessionKey)}, localStorage.getItem(${JSON.stringify(sessionKey)}));`);
        await browser.send('Page.navigate',{url:origin+'/'});
        await browser.until(`!!document.querySelector('[data-community-calendar]')`);
        if (mode === 'warm') {
          // Chrome disables prerender while DevTools inspects the initiating page.
          // Detach while the real page prepares, then inspect the activated result.
          await browser.evaluate(`setTimeout(()=>{
            const timer=setInterval(async()=>{if((await(await fetch('/qa/activate')).json()).activate){clearInterval(timer);sessionStorage.setItem('qa-click-at',String(Date.now()));const link=document.querySelector('[data-community-calendar]');link.href+=${JSON.stringify(scenario.fragment||'')};link.click();}},50);
          },100);`);
          await browser.detach();
          try { await waitFor(() => prepared); }
          catch (error) { console.error(JSON.stringify({scenario,preloadStatus:browser.preloads,errors:browser.errors})); throw error; }
          await new Promise(resolve => setTimeout(resolve,600));
          assert.equal(views,0,'Background loading is not a calendar view');
        } else if (mode === 'fallback') {
          await waitFor(() => calendarRequests.length > 0);
          assert.equal(calls.length,0,'The fallback only warms public files');
        }
        if(mode==='save-data'){await new Promise(resolve=>setTimeout(resolve,600));assert.equal(calendarRequests.length,0);assert.equal(calls.length,0);}
        if(scenario.expires)await new Promise(resolve=>setTimeout(resolve,Math.max(0,expires-Date.now()+150)));
        if(mode==='warm') activate=true;
        else {
          const box = await browser.evaluate(`(()=>{const r=document.querySelector('[data-community-calendar]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
          await browser.evaluate(`sessionStorage.setItem('qa-click-at',String(Date.now()))`);
          await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});
          await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});
        }
        await waitFor(()=>paint);
        await browser.attachActiveCalendar(origin+'/calendar/');
        if (expectCalendar) {
          await browser.until(`!!document.querySelector('[data-cal-day="${date}"]:not([disabled])') && !!document.querySelector('.cal-event-chip[title$="Prepared calendar event"]')`);
          assert.equal(await browser.evaluate(`document.querySelectorAll('[data-cal-access]').length`), role === 'owner' ? 1 : 0);
          assert.equal(views,1);
        } else {
          await browser.until(`!!document.querySelector('.cal-login h2') && document.querySelector('.cal-login h2').textContent === ${JSON.stringify(scenario.fragment ? 'Choose your calendar password' : 'Calendar sign in')}`);
          if(!role)assert(!calls.some(c => c.path === '/api/events'),'No private event requests without sign-in');
          assert.equal(await browser.evaluate(`document.querySelectorAll('.shul-calendar').length`),0,'Expired or missing access cannot display a prepared calendar');
          assert.equal(views,0);
        }
        const elapsed = paint.ready-paint.click;
        const metrics = await browser.evaluate(`({activation:performance.getEntriesByType('navigation')[0].activationStart || 0,width:innerWidth,scroll:document.documentElement.scrollWidth})`);
        if (mode === 'warm' && !scenario.fragment) assert(metrics.activation > 0,'The prepared page was activated rather than loaded again');
        assert(metrics.scroll <= metrics.width);
        assert.deepEqual(browser.errors,[]);assert.deepEqual(paint.errors,[]);
        results.push({...scenario,elapsed,...metrics});
      } finally { await browser.close(); }
    }
    assert(results[1].elapsed < results[0].elapsed * .65, JSON.stringify(results));
    console.log(JSON.stringify({results,backgroundReadsOnly:true,analyticsWaitForActivation:true}));
  } finally { await Promise.all([new Promise(resolve => server.close(resolve)),new Promise(resolve => api.close(resolve))]); }
})().catch(error => {console.error(error);process.exitCode=1;});
