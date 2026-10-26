const http=require('node:http'),net=require('node:net'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-sharing-'));
let backend='',worker,logs='';
const server=http.createServer((request,response)=>{
  if(request.url.split('?')[0]==='/data/seats-sync.json'){response.setHeader('Content-Type','application/json');return response.end(JSON.stringify({endpoint:backend}));}
  let file=path.resolve(root,'.'+decodeURIComponent(request.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){response.statusCode=403;return response.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){response.statusCode=404;return response.end();}
  response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json','.png':'image/png'})[path.extname(file)]||'application/octet-stream');response.end(fs.readFileSync(file));
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));backend='http://127.0.0.1:'+port;
  const binary=process.env.SEATS_WRANGLER_BIN;if(!binary)throw new Error('Set SEATS_WRANGLER_BIN to the Wrangler executable.');
  worker=spawn(binary,['dev','--config','worker/seats/wrangler.jsonc','--local','--port',String(port),'--inspector-port','0','--persist-to',path.join(output,'worker-data'),'--var','ALLOWED_ORIGIN:'+origin],{cwd:path.resolve(__dirname,'..'),env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  worker.stdout.on('data',chunk=>{logs+=chunk});worker.stderr.on('data',chunk=>{logs+=chunk});
  const api=async(route,options={})=>fetch(backend+route,{...options,headers:{Origin:origin,'Content-Type':'application/json',...options.headers}});
  let booted=false;for(let attempt=0;attempt<100;attempt++){try{if((await api('/api/plans')).status===401){booted=true;break}}catch{}await pause(200)}
  assert.ok(booted,'Shared service did not start: '+logs.slice(-2500));
  assert.equal((await fetch(backend+'/api/plans',{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await api('/api/plans')).status,401);
  assert.equal((await api('/api/session',{method:'POST',body:JSON.stringify({pin:'1111',name:'Test'})})).status,401);
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const contexts=[],pages=[],errors=[];
    for(const name of ['Organizer One','Organizer Two']){
      const context=await browser.newContext({viewport:{width:1440,height:1050}});contexts.push(context);
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));pages.push(page);
      await page.goto(origin+'/seats/');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      await page.getByRole('button',{name:'Save to site',exact:true}).click();
      await page.locator('#sharing-name').fill(name);await page.locator('#sharing-pin').fill('4444');await page.getByRole('button',{name:'Open shared plans',exact:true}).click();
      await page.locator('#sharing-plans').waitFor();
      if(name==='Organizer One'){
        await page.getByRole('button',{name:'Save this plan to the site',exact:true}).click();
      }else{
        await page.locator('.sharing-plan button').first().click();
      }
      await page.waitForFunction(()=>document.querySelector('.saved-label')?.textContent==='Saved online');
    }
    const [a,b]=pages;
    const seat=(page,table,index)=>page.locator('.room-stage [data-table="'+table+'"][data-seat="'+index+'"]');
    const type=async(page,table,index,name)=>{await seat(page,table,index).click();await page.locator('#seat-name-input').fill(name);await page.locator('#seat-name-input').press('Enter');};
    const nameAt=async(page,table,index)=>seat(page,table,index).locator('.seat-name').evaluateAll(nodes=>nodes.map(node=>node.textContent).join(' '));
    await seat(a,'B9',0).click();await a.locator('#seat-name-input').fill('First organizer name');
    await b.waitForFunction(()=>document.querySelector('.sharing-peers')?.textContent.includes('Organizer One editing B9'));
    await seat(b,'B9',0).click();assert.equal(await b.locator('.seat-editor:visible').count(),0,'A busy seat cannot be edited by both organizers');
    await type(b,'B9',1,'Second organizer name');
    await a.waitForFunction(()=>document.querySelector('.room-stage [data-table=B9][data-seat="1"] .seat-name')?.textContent.includes('Second'));
    assert.equal(await a.locator('#seat-name-input').inputValue(),'First organizer name','Remote updates must keep unfinished typing');
    await a.locator('#seat-name-input').press('Enter');
    await b.waitForFunction(()=>document.querySelector('.room-stage [data-table=B9][data-seat="0"] .seat-name')?.textContent.includes('First'));
    assert.match(await nameAt(a,'B9',1),/Second/);assert.match(await nameAt(b,'B9',0),/First/);
    await a.getByRole('button',{name:'Undo',exact:true}).click();
    await b.waitForFunction(()=>!document.querySelector('.room-stage [data-table=B9][data-seat="0"] .seat-name'));
    assert.match(await nameAt(b,'B9',1),/Second/,'Undo keeps the other organizer’s work');
    await a.getByRole('button',{name:'Redo',exact:true}).click();
    await b.waitForFunction(()=>document.querySelector('.room-stage [data-table=B9][data-seat="0"] .seat-name')?.textContent.includes('First'));
    await Promise.all([type(a,'B8',0,'Parallel One'),type(b,'B8',1,'Parallel Two')]);
    await a.waitForFunction(()=>document.querySelector('.room-stage [data-table=B8][data-seat="1"] .seat-name')?.textContent.includes('Parallel'));
    await b.waitForFunction(()=>document.querySelector('.room-stage [data-table=B8][data-seat="0"] .seat-name')?.textContent.includes('Parallel'));
    await contexts[0].setOffline(true);
    await a.waitForFunction(()=>document.querySelector('.saved-label')?.textContent.includes('Reconnecting'));
    await type(a,'C8',0,'Queued offline name');
    assert.equal(await nameAt(b,'C8',0),'','Offline edits must wait locally');
    await type(b,'D8',1,'Saved while other offline');
    await contexts[0].setOffline(false);
    await a.waitForFunction(()=>document.querySelector('.room-stage [data-table=D8][data-seat="1"] .seat-name')?.textContent.includes('Saved'),{timeout:20000});
    await b.waitForFunction(()=>document.querySelector('.room-stage [data-table=C8][data-seat="0"] .seat-name')?.textContent.includes('Queued'),{timeout:20000});
    await contexts[0].setOffline(true);await a.waitForFunction(()=>document.querySelector('.saved-label')?.textContent.includes('Reconnecting'));
    await type(a,'C7',0,'My offline version');await type(b,'C7',0,'Confirmed online version');
    await contexts[0].setOffline(false);
    await a.waitForFunction(()=>document.querySelector('.room-stage [data-table=C7][data-seat="0"] .seat-name')?.textContent.includes('Confirmed'));
    const recovery=await a.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).plans.find(plan=>plan.name.includes('unsynced copy')));
    assert.ok(recovery.people.some(person=>person.name==='My offline version'),'Conflicting offline typing is preserved as a local copy');
    await type(a,'A2',0,'My latest change');
    await b.waitForFunction(()=>document.querySelector('.room-stage [data-table=A2][data-seat="0"] .seat-name')?.textContent.includes('latest'));
    await type(b,'A2',0,'Other organizer update');
    await a.waitForFunction(()=>document.querySelector('.room-stage [data-table=A2][data-seat="0"] .seat-name')?.textContent.includes('Other'));
    await a.getByRole('button',{name:'Undo',exact:true}).click();assert.match(await nameAt(a,'A2',0),/Other/,'Undo cannot erase a newer remote edit');
    await seat(a,'C6',0).click();await a.locator('#seat-name-input').fill('Unfinished draft');
    await contexts[0].setOffline(true);await a.waitForFunction(()=>document.querySelector('.saved-label')?.textContent.includes('Reconnecting'));
    await b.waitForFunction(()=>!document.querySelector('.sharing-peers')?.textContent.includes('Organizer One editing C6'));
    await type(b,'C6',0,'Changed while offline');await contexts[0].setOffline(false);
    await a.waitForFunction(()=>document.querySelector('.room-stage [data-table=C6][data-seat="0"] .seat-name')?.textContent.includes('Changed'));
    assert.equal(await a.locator('#seat-name-input').inputValue(),'Unfinished draft');
    await a.locator('#seat-name-input').press('Enter');assert.ok(await a.locator('.seat-editor-conflict').isVisible(),'A stale draft requires review instead of replacing a newer name');
    assert.match(await nameAt(a,'C6',0),/Changed/);await a.locator('#seat-name-input').press('Escape');
    await a.reload();await a.locator('.room-stage .table-item').first().waitFor();
    await a.waitForFunction(()=>document.querySelector('.saved-label')?.textContent==='Saved online');
    assert.match(await nameAt(a,'C8',0),/Queued/);assert.match(await nameAt(a,'D8',1),/Saved/);
    await a.screenshot({path:path.join(output,'shared-desktop.png'),fullPage:true});
    await b.setViewportSize({width:375,height:900});assert.ok(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await b.screenshot({path:path.join(output,'shared-phone.png'),fullPage:true});
    const login=await (await api('/api/session',{method:'POST',body:JSON.stringify({pin:'4444',name:'Storage QA'})})).json();
    const large=await a.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).plans[0]);
    large.people=[...large.people,...Array.from({length:1990},(_,index)=>({id:'synthetic-person-'+index,name:'Synthetic Imported Person '+index+' '+('X'.repeat(115))}))].slice(0,2000);
    const stored=await api('/api/plans',{method:'POST',headers:{Authorization:'Bearer '+login.token},body:JSON.stringify({id:crypto.randomUUID(),plan:{...large,name:'Large import QA'}})});
    assert.equal(stored.status,201,'A large valid name import must fit durable storage: '+JSON.stringify(await stored.clone().json()));
    assert.deepEqual(errors,[]);
    for(const context of contexts)await context.close();
    console.log('PASS: PIN-protected saved plans, two real browser sessions, seat presence, simultaneous different-seat editing, unfinished typing, safe undo/redo, offline reconnection, persistence, desktop and phone.');
    console.log('Artifacts: '+output);
  }finally{await browser.close()}
})().catch(error=>{console.error(error);console.error(logs.slice(-2500));process.exitCode=1}).finally(()=>{worker?.kill('SIGTERM');server.close()});
