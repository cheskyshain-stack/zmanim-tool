const http=require('node:http'),net=require('node:net'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-trash-'));let endpoint='',worker,logs='';
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({endpoint}));}
  let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const openSaved=async page=>{const button=page.getByRole('button',{name:'Saved charts',exact:true});if(await button.isVisible())await button.click();else await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('#sharing-device-plans[aria-busy=false]').waitFor();};
const openTrash=async page=>{const details=page.locator('#seats-trash');if(!await details.evaluate(node=>node.open))await details.locator(':scope>summary').click();await page.locator('#site-trash').getByText('Loading Trash…',{exact:true}).waitFor({state:'hidden'});};
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));endpoint='http://127.0.0.1:'+port;
  assert.ok(process.env.SEATS_WRANGLER_BIN);worker=spawn(process.env.SEATS_WRANGLER_BIN,['dev','--config','worker/seats/wrangler.jsonc','--local','--port',String(port),'--inspector-port','0','--persist-to',path.join(output,'worker-data'),'--var','ALLOWED_ORIGIN:'+origin],{cwd:path.resolve(__dirname,'..'),env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
  worker.stdout.on('data',chunk=>logs+=chunk);worker.stderr.on('data',chunk=>logs+=chunk);
  const api=(route,options={})=>fetch(endpoint+route,{...options,headers:{Origin:origin,'Content-Type':'application/json',...options.headers}});
  let booted=false;for(let i=0;i<100;i++){try{if((await api('/api/plans')).status===401){booted=true;break;}}catch{}await pause(200);}assert.ok(booted,logs.slice(-2000));
  const session=await (await api('/api/session',{method:'POST',body:JSON.stringify({pin:'4444',name:'Synthetic API Organizer'})})).json(),headers={Authorization:'Bearer '+session.token};
  const {seatsCreateState,seatsCreatePlan,seatsWriteName}=await import('../js/seats/model.js');
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const contexts=[],errors=[];
  try{for(const width of [1440,375]){
    const state=seatsCreateState(),local=state.plans[0];local.name='Device recovery '+width;seatsWriteName(local,'A1',0,'Synthetic Local Person');const original=structuredClone(local);
    const anchor=seatsCreatePlan('Device anchor '+width);seatsWriteName(anchor,'A1',0,'Synthetic Anchor');state.plans.push(anchor);
    const remote={...structuredClone(local),id:'synthetic-website-trash-'+width,name:'Website recovery '+width};
    const created=await (await api('/api/plans',{method:'POST',headers,body:JSON.stringify({id:remote.id,plan:remote})})).json();assert.equal(created.plan.name,remote.name);
    const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(({state,id})=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(state));if(!localStorage.getItem('lakewood-commons-seats-records-v1'))localStorage.setItem('lakewood-commons-seats-records-v1',JSON.stringify({version:1,records:{[id]:{createdAt:'2026-10-01T12:00:00.000Z',createdBy:'Original Device Organizer',updatedAt:'2026-10-10T12:00:00.000Z',updatedBy:'Earlier Organizer',history:[{id:'synthetic-history',at:'2026-10-10T12:00:00.000Z',by:'Earlier Organizer',details:['Original device history']}]}}}));},{state,id:local.id});
    await page.goto(origin+'/seats/?count=off');await page.locator('#seats-name').fill('Synthetic Trash Organizer '+width);await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await openSaved(page);
    const localRow=()=>page.locator('.sharing-local-plan').filter({has:page.locator('.saved-page-card[data-id="'+local.id+'"]')});
    page.once('dialog',d=>d.accept());await localRow().getByRole('button',{name:'Delete',exact:true}).click();await localRow().waitFor({state:'detached'});await openTrash(page);
    await page.locator('#local-trash .trash-row').filter({hasText:local.name}).waitFor();await page.reload();await openSaved(page);await openTrash(page);
    const localTrash=page.locator('#local-trash .trash-row').filter({hasText:local.name});await localTrash.waitFor();assert.match(await localTrash.textContent(),/Restore until/);
    await localTrash.getByRole('button',{name:'Restore',exact:true}).click();await localRow().waitFor();await localTrash.waitFor({state:'detached'});
    const restored=await page.evaluate(id=>({plan:JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).plans.find(plan=>plan.id===id),record:JSON.parse(localStorage.getItem('lakewood-commons-seats-records-v1')).records[id]}),local.id);
    assert.deepEqual(restored.plan,original);assert.equal(restored.record.createdAt,'2026-10-01T12:00:00.000Z');assert.ok(restored.record.history.some(entry=>entry.details.includes('Original device history')));assert.equal(restored.record.history.at(-1).details[0],'Restored chart from Trash');
    await page.evaluate(()=>{window.trashOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='lakewood-commons-seats-trash-v1')throw new DOMException('Quota','QuotaExceededError');return window.trashOriginalSet.call(this,key,value);};});
    page.once('dialog',d=>d.accept());await localRow().getByRole('button',{name:'Delete',exact:true}).click();await page.locator('.sharing-error').filter({hasText:'Nothing was deleted'}).waitFor();assert.equal(await localRow().count(),1);await page.evaluate(()=>{Storage.prototype.setItem=window.trashOriginalSet;});
    const siteRow=page.locator('.sharing-site-plan').filter({has:page.locator('.saved-page-card[data-id="'+remote.id+'"]')});
    await context.route(endpoint+'/api/info',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({editNameFiles:true})}));
    page.once('dialog',d=>d.accept());await siteRow.getByRole('button',{name:'Delete',exact:true}).click();await page.locator('.sharing-error').filter({hasText:'Nothing was deleted'}).waitFor();assert.equal((await api('/api/plans/'+remote.id,{headers})).status,200);await context.unroute(endpoint+'/api/info');
    page.once('dialog',d=>d.accept());await siteRow.getByRole('button',{name:'Delete',exact:true}).click();await siteRow.waitFor({state:'detached'});await openTrash(page);
    const siteTrash=page.locator('#site-trash .trash-row').filter({hasText:remote.name});await siteTrash.waitFor();await page.screenshot({path:path.join(output,'trash-'+width+'.png'),fullPage:true});
    assert.ok(await page.locator('.trash-row button').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44)));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    // Another signed-in device restores the same server record, including all assignments.
    const other=await browser.newContext({viewport:{width:width===375?1440:375,height:1000}});contexts.push(other);const second=await other.newPage();second.on('pageerror',e=>errors.push(e.message));
    await second.goto(origin+'/seats/?count=off');await second.locator('#seats-name').fill('Synthetic Second Organizer');await second.locator('#seats-pin').fill('4444');await second.getByRole('button',{name:'Open Seats',exact:true}).click();await openSaved(second);await openTrash(second);
    await second.locator('#site-trash .trash-row').filter({hasText:remote.name}).getByRole('button',{name:'Restore',exact:true}).click();await second.locator('.sharing-site-plan .saved-page-card[data-id="'+remote.id+'"]').waitFor();await siteRow.waitFor();await siteTrash.waitFor({state:'detached'});
    const recovered=await (await api('/api/plans/'+remote.id,{headers})).json();assert.deepEqual(recovered.plan,created.plan);assert.equal(recovered.createdAt,created.createdAt);assert.equal(recovered.updatedBy,'Synthetic Second Organizer');
    const file={id:'synthetic-trash-names-'+width,name:'Names recovery '+width,names:['Synthetic File Person','Synthetic Other Person']};await api('/api/name-lists',{method:'POST',headers,body:JSON.stringify(file)});
    await page.getByRole('button',{name:'Close',exact:true}).click();await openSaved(page);await localRow().locator('.saved-page-card').click();await page.getByRole('button',{name:'Add names',exact:true}).click();
    const fileRow=page.locator('.sharing-name-file').filter({hasText:file.name});await fileRow.waitFor();page.once('dialog',d=>d.accept());await fileRow.getByRole('button',{name:'Delete',exact:true}).click();await fileRow.waitFor({state:'detached'});await openTrash(page);
    await page.locator('#site-trash .trash-row').filter({hasText:file.name}).getByRole('button',{name:'Restore',exact:true}).click();await fileRow.waitFor();assert.deepEqual((await (await api('/api/name-lists/'+file.id,{headers})).json()).names,file.names);
    console.log('PASS: Trash, phone/desktop, cross-device restore, original names/geometry/dates/history, reload, 44px controls, quota protection and old-service gate at '+width+'px');
  }assert.deepEqual(errors,[]);console.log('Artifacts: '+output);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);console.error(logs.slice(-2000));process.exitCode=1;}).finally(()=>{worker?.kill('SIGTERM');server.close();});
