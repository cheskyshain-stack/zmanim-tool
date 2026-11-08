const http=require('node:http'),net=require('node:net'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-reservation-timeout-'));
let backend='',worker,logs='';
const server=http.createServer((request,response)=>{
  const url=request.url.split('?')[0];
  if(url==='/data/seats-sync.json'){response.setHeader('Content-Type','application/json');return response.end(JSON.stringify({endpoint:backend}));}
  let file=path.resolve(root,'.'+decodeURIComponent(url));
  if(!file.startsWith(root+path.sep)){response.statusCode=403;return response.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){response.statusCode=404;return response.end();}
  response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');response.end(fs.readFileSync(file));
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),duration=30*60*1000;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));backend='http://127.0.0.1:'+port;
  const binary=process.env.SEATS_WRANGLER_BIN;if(!binary)throw new Error('Set SEATS_WRANGLER_BIN to the Wrangler executable.');
  worker=spawn(binary,['dev','--config','worker/seats/wrangler.jsonc','--local','--port',String(port),'--inspector-port','0','--persist-to',path.join(output,'worker-data'),'--var','ALLOWED_ORIGIN:'+origin],{cwd:path.resolve(__dirname,'..'),env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  worker.stdout.on('data',chunk=>{logs+=chunk});worker.stderr.on('data',chunk=>{logs+=chunk});
  let token;
  const api=async(route,body)=>{
    const response=await fetch(backend+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.ok(response.ok,route+': '+response.status);return response.json();
  };
  let booted=false;for(let attempt=0;attempt<100;attempt++){try{if((await fetch(backend+'/api/info',{headers:{Origin:origin}})).status===401){booted=true;break;}}catch{}await pause(200);}
  assert.ok(booted,logs.slice(-2500));token=(await api('/api/session',{pin:'4444',name:'Fixture Organizer'})).token;
  assert.equal((await api('/api/info')).seatReservationMinutes,30);
  const {seatsCreateState,seatsWriteName}=await import('../js/seats/model.js'),plan=seatsCreateState().plans[0];
  plan.id='synthetic-timeout-chart';plan.name='Selection timeout test';seatsWriteName(plan,'B9',0,'Original Saved Person');await api('/api/plans',{id:plan.id,plan});
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const pages=[],errors=[];
    for(const [name,width] of [['First Organizer',375],['Second Organizer',1440]]){
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/seats/');await page.locator('#seats-name').fill(name);await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-site-plan .saved-page-card[data-id="'+plan.id+'"]').click();await page.waitForFunction(()=>document.querySelector('.saved-label')?.textContent==='Saved to website');
    }
    const [a,b]=pages,seat=page=>page.locator('.room-stage [data-table=B9][data-seat="0"]'),editor=a.locator('.seat-editor:visible');
    const before=await api('/api/plans/'+plan.id);
    await a.clock.install();await a.clock.pauseAt(new Date());
    await seat(a).click();await a.waitForFunction(()=>document.querySelector('#seat-name-input')?.readOnly===false);await a.locator('#seat-name-input').fill('Unfinished Timeout Draft');
    await seat(b).locator('xpath=self::*[contains(@class,"is-remote")]').waitFor();await seat(b).click();assert.equal(await b.locator('.seat-editor:visible').count(),0);
    await a.clock.fastForward(duration-1000);assert.equal(await editor.count(),1);await a.locator('#seat-name-input').fill('Retained Timeout Draft');
    await a.clock.fastForward(1000);assert.equal(await editor.count(),0);assert.equal(await a.locator('.room-stage .is-active').count(),0);
    await b.waitForFunction(()=>!document.querySelector('.room-stage [data-table=B9][data-seat="0"].is-remote'));
    assert.match(await a.locator('#seats-notice').textContent(),/released after 30 minutes/);assert.deepEqual(await api('/api/plans/'+plan.id),before,'Expiration keeps every saved name, seat and date intact');
    await a.screenshot({path:path.join(output,'phone-expired-selection.png'),fullPage:true});
    await seat(b).click();await b.waitForFunction(()=>document.querySelector('#seat-name-input')?.readOnly===false);await b.locator('#seat-name-input').fill('New Organizer Assignment');await b.locator('#seat-name-input').press('Enter');
    await a.clock.resume();await a.waitForFunction(()=>document.querySelector('.room-stage [data-table=B9][data-seat="0"] .seat-name')?.textContent.includes('New'));
    await seat(a).click();await a.waitForFunction(()=>document.querySelector('#seat-name-input')?.readOnly===false);assert.equal(await a.locator('#seat-name-input').inputValue(),'Retained Timeout Draft');
    await a.locator('#seat-name-input').press('Enter');assert.ok(await a.locator('.seat-editor-conflict').isVisible(),'A returned draft cannot silently overwrite the new organizer’s name');await a.locator('#seat-name-input').press('Escape');
    await seat(a).click();await a.waitForFunction(()=>document.querySelector('#seat-name-input')?.readOnly===false);assert.equal(await a.locator('#seat-name-input').inputValue(),'New Organizer Assignment');
    await a.locator('#seat-name-input').fill('Suspended Browser Draft');
    await a.clock.setSystemTime((await a.evaluate(()=>Date.now()))+duration);
    await a.locator('.seat-editor form').evaluate(form=>form.requestSubmit());assert.equal(await editor.count(),0,'A suspended timer cannot allow a save after the deadline');
    await b.waitForFunction(()=>!document.querySelector('.room-stage [data-table=B9][data-seat="0"].is-remote'));
    assert.equal((await api('/api/plans/'+plan.id)).revision,before.revision+1,'Only the deliberate second-organizer assignment changed the chart');
    await seat(a).click();await a.waitForFunction(()=>document.querySelector('#seat-name-input')?.readOnly===false);assert.equal(await a.locator('#seat-name-input').inputValue(),'Suspended Browser Draft');await a.locator('#seat-name-input').press('Escape');
    for(const page of pages)assert.equal(await page.locator('.sharing-peers,[data-organizer]').count(),0);
    assert.deepEqual(errors,[]);console.log('PASS: exact 30-minute selection expiry, no heartbeat renewal, release on another device, unchanged saved data, retained drafts, stale draft conflict and suspended-browser save guard.');
    console.log('Artifacts: '+output);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);console.error(logs.slice(-2000));process.exitCode=1;}).finally(()=>{worker?.kill('SIGTERM');server.close();});
