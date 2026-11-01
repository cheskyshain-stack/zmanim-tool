const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-updates-')),remote=process.env.SEATS_CHECK_ORIGIN;
const built=JSON.parse(fs.readFileSync(path.join(root,'seats/version.json'),'utf8')).version;
let htmlVersion=built,latest=built,staleOnce=false,mode='ok',documents=0,checks=[];
const versions=Array.from({length:12},(_,i)=>(i+1).toString(16).repeat(16));
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
 if(url.pathname==='/seats/version.json'){
  checks.push({url:url.pathname+url.search,cache:req.headers['cache-control']});res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','public, max-age=3600');
  if(mode==='error'){res.statusCode=503;return res.end('{}');}if(mode==='invalid')return res.end('<html>Temporarily unavailable</html>');
  return res.end(JSON.stringify({version:mode==='bad-version'?'https://example.com':latest}));
 }
 let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
 if(file===path.join(root,'seats/index.html')){documents++;const version=staleOnce?built:htmlVersion;staleOnce=false;res.setHeader('Cache-Control','public, max-age=3600');return res.end(fs.readFileSync(file,'utf8').replace(/(<meta name="seats-build" content=")[a-f0-9]+/,(_,prefix)=>prefix+version));}
 res.end(fs.readFileSync(file));
});
(async()=>{
 if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
 const makeContext=async options=>{
  const context=await browser.newContext(options);
  if(remote){
   await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
   await context.route('**/data/seats-sync.json',r=>r.fulfill({status:200,contentType:'application/json',body:'{"endpoint":""}'}));
   await context.route('**/api/**',r=>{throw new Error('The synthetic live update check must not access production records: '+new URL(r.request().url()).pathname);});
   await context.route('**/seats/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/seats/version.json'){
     checks.push({url:url.pathname+url.search,cache:request.headers()['cache-control']});
     return route.fulfill({status:mode==='error'?503:200,contentType:'application/json',body:mode==='invalid'?'<html>Temporarily unavailable</html>':JSON.stringify({version:mode==='bad-version'?'https://example.com':latest})});
    }
    if(!request.isNavigationRequest())return route.continue();
    const response=await route.fetch(),html=await response.text(),maps=text=>JSON.parse(text.match(/<script type="importmap">([^<]+)<\/script>/)[1]).imports,local=maps(fs.readFileSync(path.join(root,'seats/index.html'),'utf8')),published=maps(html);
    for(const file of ['/js/seats/updates.js','/js/seats-app.js','/js/seats/sharing.js'])assert.equal(published[file],local[file],'The published update code matches the tested version');
    assert.ok(html.includes('content="'+built+'"'),'The published build identifier matches the built HTML');
    documents++;const version=staleOnce?built:htmlVersion;staleOnce=false;
    await route.fulfill({response,body:html.replace(/(<meta name="seats-build" content=")[a-f0-9]+/,(_,prefix)=>prefix+version)});
   });
  }
  return context;
 };
 try{
 if(remote){const context=await browser.newContext(),page=await context.newPage(),response=await page.goto(origin+'/seats/version.json?check='+Date.now());assert.equal(response.status(),200);assert.equal((await response.json()).version,built,'The real published version endpoint matches the tested build');await context.close();}
 for(const width of [375,1440]){
  const context=await makeContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  htmlVersion=latest=versions[0];staleOnce=true;mode='ok';const start=documents;
  await page.goto(origin+'/seats/?count=off&keep=yes#chart');await page.locator('#seats-name').waitFor();
  assert.equal(documents-start,2,'A stale startup page is automatically replaced exactly once');assert.equal(new URL(page.url()).searchParams.get('keep'),'yes');assert.equal(new URL(page.url()).hash,'#chart');assert.ok(!new URL(page.url()).searchParams.has('seats-update'));
  await page.locator('#seats-name').fill('Synthetic Update Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();
  await page.locator('#chart-name').fill('Automatic update preservation');await page.locator('#chart-name').press('Enter');
  const read=()=>page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('lakewood-commons-seats-v1'));return s.plans.find(p=>p.id===s.activeId);});
  const seat=(table,index=0)=>page.locator('.room-stage [data-table="'+table+'"][data-seat="'+index+'"]');
  await seat('A2').click();await page.locator('#seat-name-input').fill('Original Person');await page.locator('#seat-name-input').press('Enter');const original=await read();
  const wake=async(type='visibilitychange')=>{await page.clock.fastForward(6000);const response=page.waitForResponse(r=>r.url().includes('/seats/version.json?'));await page.evaluate(type=>{if(type==='pageshow')window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));else(type==='visibilitychange'?document:window).dispatchEvent(new Event(type));},type);await response;};
  const waitBuild=async version=>{await page.clock.fastForward(4000);await page.waitForFunction(v=>document.querySelector('meta[name="seats-build"]')?.content===v,version);await page.locator('.room-stage').waitFor();assert.equal((await read()).id,original.id);assert.equal(await page.locator('#chart-name').inputValue(),original.name);assert.equal(await page.locator('#seats-unlock').count(),0);};
  await seat('B2').click();await page.locator('#seat-name-input').fill('saved after update');htmlVersion=latest=versions[1];const beforeDraft=documents;await wake();await page.clock.fastForward(8000);
  assert.equal(documents,beforeDraft,'An update cannot reload while a seat draft is open');assert.equal(await page.locator('#seat-name-input').inputValue(),'saved after update');
  await page.locator('#seat-name-input').press('Enter');await waitBuild(versions[1]);let plan=await read();assert.ok(plan.people.some(p=>p.name==='Original Person'));assert.ok(plan.people.some(p=>p.name==='Saved After Update'));assert.equal(plan.tables.find(t=>t.id==='A2').seats[0],original.tables.find(t=>t.id==='A2').seats[0]);
  const stable=documents;await wake('pageshow');await page.clock.fastForward(4000);assert.equal(documents,stable,'The current build is not reloaded on return');
  await page.locator('#people-extra-tools').evaluate(n=>n.open=true);await page.locator('#manual-names').evaluate(n=>n.open=true);await page.locator('#new-names').fill('Draft One\nDraft Two');await page.locator('.canvas-heading h2').click();
  htmlVersion=latest=versions[2];const beforeNames=documents;await wake('online');await page.clock.fastForward(6000);assert.equal(documents,beforeNames,'An unfocused manual name-list draft also blocks automatic refresh');assert.equal(await page.locator('#new-names').inputValue(),'Draft One\nDraft Two');
  await page.locator('#manual-names [data-action=add-names]').click();await waitBuild(versions[2]);plan=await read();assert.ok(plan.people.some(p=>p.name==='Draft One'));assert.ok(plan.people.some(p=>p.name==='Draft Two'));
  await page.getByRole('button',{name:'Add names',exact:true}).click();await page.getByRole('heading',{name:'Name files',exact:true}).waitFor();htmlVersion=latest=versions[3];const beforeDialog=documents;await wake('focus');await page.clock.fastForward(6000);assert.equal(documents,beforeDialog,'Open file dialogs and editors defer the update');await page.getByRole('button',{name:'Close',exact:true}).click();await waitBuild(versions[3]);
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));htmlVersion=latest=versions[4];const beforePrint=documents;await wake();await page.clock.fastForward(6000);assert.equal(documents,beforePrint,'Printing defers the update');await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await waitBuild(versions[4]);
  for(const failure of ['error','invalid','bad-version']){mode=failure;const beforeFailure=documents;await wake();await page.clock.fastForward(4000);assert.equal(documents,beforeFailure,'An unavailable or malformed version endpoint leaves the chart usable');assert.equal((await read()).id,original.id);}mode='ok';
  const beforeQuota=documents;await page.evaluate(()=>{window.updateOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Test full storage','QuotaExceededError');};});htmlVersion=latest=versions[5];await wake();await page.clock.fastForward(6000);assert.equal(documents,beforeQuota,'Failed backup storage prevents an automatic refresh');await page.evaluate(()=>{Storage.prototype.setItem=window.updateOriginalSetItem;});await page.locator('#paper-size').selectOption('letter');await page.locator('.canvas-heading h2').click();await waitBuild(versions[5]);
  const retained=await read();assert.equal(retained.people.length,4);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).plans.length),1,'Automatic refresh never creates a duplicate chart');
  await page.screenshot({path:path.join(output,'updated-'+width+'.png'),fullPage:true});await page.goBack();await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();assert.equal(await page.locator('.room-stage').count(),0,'Back still goes to Seats home after automatic replacements');
  assert.ok(checks.every(c=>new URL(c.url,origin).searchParams.has('check')));assert.deepEqual(errors,[]);await context.close();
  console.log('PASS '+width+'px: stale opening, cache bypass, unchanged-build return, draft/list/dialog/print protection, safe reload with same chart/session/assignments, failure handling, storage protection, no duplicate charts, and phone Back.');
 }
 const context=await makeContext(),page=await context.newPage();await page.clock.install();htmlVersion=versions[6];latest=versions[7];const beforeLoop=documents;await page.goto(origin+'/seats/?seats-update='+latest);await page.locator('#seats-name').waitFor();const staleCheck=page.waitForResponse(r=>r.url().includes('/seats/version.json?'));await page.clock.fastForward(125000);await (await staleCheck).finished();assert.equal(documents,beforeLoop+1,'A stale replacement response cannot cause a reload loop');
 await page.locator('#seats-name').fill('Preserved Login');await page.locator('#seats-pin').fill('4444');htmlVersion=latest=versions[8];await page.clock.fastForward(6000);const response=page.waitForResponse(r=>r.url().includes('/seats/version.json?'));await page.evaluate(()=>window.dispatchEvent(new Event('online')));await response;await page.clock.fastForward(6000);assert.equal(await page.locator('#seats-name').inputValue(),'Preserved Login','An unfinished login form is never replaced');
 await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();await page.clock.fastForward(4000);await page.waitForFunction(v=>document.querySelector('meta[name="seats-build"]')?.content===v,versions[8]);await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();assert.equal(await page.locator('#seats-unlock').count(),0,'The completed login survives the queued update');await context.close();
 console.log('PASS: stale-response loop prevention, later release discovery, and protected name/PIN entry.');console.log('Artifacts: '+output);
 }finally{await browser.close();if(!remote)server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;if(!remote)server.close();});
