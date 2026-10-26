const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-empty-drafts-'));
const key='lakewood-commons-seats-v1',backupKey=key+'-before-empty-drafts-2026-10-26',sharedKey='lakewood-commons-seats-shared-v1';
const server=http.createServer((request,response)=>{
  if(request.url.split('?')[0]==='/data/seats-sync.json'){response.setHeader('Content-Type','application/json');return response.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(request.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){response.statusCode=403;return response.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){response.statusCode=404;return response.end();}
  response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');response.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const {seatsCreatePlan,seatsCreateState,seatsAddNames}=await import('../js/seats/model.js');
    const {seatsDatedChartName}=await import('../js/seats/chart-names.js');
    const errors=[];
    const state=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),key);
    const plans=async page=>(await state(page))?.plans||[];
    const unlock=async page=>{page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/seats/');await page.locator('#seats-name').fill('Synthetic Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();};
    const home=async page=>{const button=page.locator('[data-action=home]');if(await button.count())await button.click();await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();};
    const create=async page=>{await page.getByRole('button',{name:'Create new chart',exact:true}).click();await page.locator('#chart-name').waitFor();};
    const folder=async page=>{await page.getByRole('button',{name:/^(View saved charts|Saved charts)$/}).click();await page.getByRole('heading',{name:'Saved charts',exact:true}).waitFor();};
    const close=page=>page.getByRole('button',{name:'Close',exact:true}).click();
    const addNames=async(page,names)=>{await page.locator('#people-extra-tools').evaluate(node=>{node.open=true;});await page.locator('#manual-names').evaluate(node=>{node.open=true;});await page.locator('#new-names').fill(names);await page.locator('[data-action=add-names]').click();};
    for(const width of [1440,375]){
      const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===375,hasTouch:width===375}),page=await context.newPage();await unlock(page);
      let title;
      for(let attempt=0;attempt<3;attempt++){
        await create(page);const currentTitle=await page.locator('#chart-name').inputValue();assert.match(currentTitle,/^Seating plan - /);if(title)assert.equal(currentTitle,title,'Repeated untouched drafts do not consume date suffixes');else title=currentTitle;
        assert.equal(await state(page),null,'Create and cancelling the name chooser do not save an empty device file');
        assert.equal(await page.locator('.saved-label').textContent(),'Not saved yet');assert.ok(await page.getByRole('button',{name:'Save',exact:true}).isDisabled());
        if(attempt===0){await page.locator('#paper-size').selectOption('tabloid');await page.locator('#print-color').selectOption('color');assert.equal(await state(page),null,'Print preferences alone do not turn an empty draft into a chart');}
        await home(page);await folder(page);assert.equal(await page.locator('.sharing-local-plan').count(),0);await close(page);await page.reload();await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();assert.equal(await state(page),null);
      }
      await create(page);await addNames(page,'Synthetic Waiting Person');
      let saved=await state(page);assert.equal(saved.plans.length,1);const waitingId=saved.activeId;
      assert.equal(saved.plans[0].people.length,1);assert.equal(saved.plans[0].people[0].name,'Synthetic Waiting Person');assert.ok(saved.plans[0].tables.every(table=>table.seats.every(seat=>seat===null)),'Unassigned people are meaningful saved content');
      await home(page);await folder(page);assert.equal(await page.locator('.sharing-local-plan').count(),1);await page.locator('.sharing-local-plan .saved-page-card').click();
      assert.equal((await state(page)).activeId,waitingId);await folder(page);assert.equal(await page.locator('.sharing-local-plan').count(),1,'Opening an existing chart does not append a blank copy');
      await page.getByRole('button',{name:'New chart',exact:true}).click();assert.equal((await plans(page)).length,1);
      await page.locator('.room-stage [data-table=A1][data-seat="0"]').click();await page.locator('#seat-name-input').fill('Synthetic Draft Seat Person');await folder(page);
      saved=await state(page);assert.equal(saved.plans.length,2,'Opening the folder flushes a meaningful seat draft once');const seated=saved.plans.find(plan=>plan.id===saved.activeId);assert.ok(seated.people.some(person=>person.name==='Synthetic Draft Seat Person'));
      assert.equal(await page.locator('.sharing-local-plan').count(),2);await close(page);await home(page);await page.reload();await page.getByRole('button',{name:'View saved charts',exact:true}).waitFor();assert.equal((await plans(page)).length,2);
      await page.screenshot({path:path.join(output,'meaningful-files-'+width+'.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();
    }
    const slowImport=await browser.newContext(),slowPage=await slowImport.newPage();await unlock(slowPage);await create(slowPage);
    const importTitle=await slowPage.locator('#chart-name').inputValue();
    await slowPage.evaluate(()=>{
      const original=File.prototype.text;window.__csvReadStarted=false;
      const gate=new Promise(resolve=>{window.__releaseCsvRead=resolve;});
      File.prototype.text=async function(){if(this.name==='Synthetic slow names.csv'){window.__csvReadStarted=true;await gate;}return original.call(this);};
    });
    await slowPage.locator('#names-file').setInputFiles({name:'Synthetic slow names.csv',mimeType:'text/csv',buffer:Buffer.from('Name\nSynthetic Slow One\nSynthetic Slow Two\n')});
    await slowPage.waitForFunction(()=>window.__csvReadStarted===true);
    await slowPage.locator('[data-action=home]').click();
    assert.equal(await slowPage.locator('#chart-name').inputValue(),importTitle,'Home cannot discard the target draft while its uploaded names are still being read');
    assert.match(await slowPage.locator('#seats-notice').textContent(),/Reading names/);assert.equal(await state(slowPage),null);assert.equal(await slowPage.locator('.saved-label').textContent(),'Not saved yet');
    await slowPage.getByRole('button',{name:'Saved charts',exact:true}).click();assert.equal(await slowPage.locator('.sharing-dialog[open]').count(),0,'Saved charts also waits until parsing finishes');
    assert.equal(await slowPage.locator('#chart-name').inputValue(),importTitle);assert.equal(await state(slowPage),null);
    await slowPage.evaluate(()=>window.__releaseCsvRead());
    await slowPage.waitForFunction(key=>{const saved=JSON.parse(localStorage.getItem(key)||'null');return saved?.plans.length===1&&saved.plans[0].people.length===2;},key);
    assert.deepEqual((await plans(slowPage))[0].people.map(person=>person.name),['Synthetic Slow One','Synthetic Slow Two']);
    await home(slowPage);await folder(slowPage);assert.equal(await slowPage.locator('.sharing-local-plan').count(),1,'After parsing, the imported names save once and normal navigation resumes');await slowImport.close();
    const transition=await browser.newContext(),page=await transition.newPage();await unlock(page);await create(page);
    await page.locator('#people-extra-tools').evaluate(node=>{node.open=true;});await page.locator('#room-settings').evaluate(node=>{node.open=true;});await page.locator('#layout-item').selectOption('A1');await page.locator('#seat-count').fill('4');await page.locator('#seat-count').blur();
    assert.equal((await plans(page)).length,1,'A deliberate layout change saves its chart');assert.equal((await plans(page))[0].tables.find(table=>table.id==='A1').count,4);
    await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await state(page),null,'Undoing the first meaningful edit removes the empty automatic chart from saved files');
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal((await plans(page)).length,1);assert.equal((await plans(page))[0].tables.find(table=>table.id==='A1').count,4);
    await folder(page);page.once('dialog',dialog=>dialog.accept());await page.locator('.sharing-local-plan').getByRole('button',{name:'Delete',exact:true}).click();assert.equal(await page.locator('.sharing-local-plan').count(),0);assert.equal(await state(page),null,'Deleting the last device chart leaves no replacement empty file');
    await close(page);await home(page);await create(page);await page.locator('#chart-name').fill('Synthetic Named Section');await page.locator('#chart-name').press('Enter');assert.equal((await plans(page)).length,1,'An explicitly chosen custom title is meaningful');await home(page);await folder(page);assert.equal(await page.locator('.sharing-local-plan strong').textContent(),'Synthetic Named Section');await transition.close();
    const dateName=seatsDatedChartName(),old=seatsCreateState(),legacy=old.plans[0];
    const dated=seatsCreatePlan(dateName+' (2)'),waiting=seatsCreatePlan(dateName+' (3)'),layout=seatsCreatePlan(dateName+' (4)'),named=seatsCreatePlan('Synthetic Custom Section');
    seatsAddNames(waiting,['Synthetic Retained Waiting Name']);Object.assign(layout.tables.find(table=>table.id==='B8'),{autoSize:false,width:225,x:304});old.plans=[legacy,dated,waiting,layout,named];old.activeId=dated.id;const raw=JSON.stringify(old,null,2);
    const cleanup=await browser.newContext();await cleanup.addInitScript(({key,raw})=>{if(!localStorage.getItem(key)&&!localStorage.getItem('fixture-installed')){localStorage.setItem(key,raw);localStorage.setItem('fixture-installed','true');}},{key,raw});const cleaned=await cleanup.newPage();await unlock(cleaned);
    assert.equal(await cleaned.evaluate(key=>localStorage.getItem(key),backupKey),raw,'Cleanup keeps the exact original bytes as a recovery backup');
    assert.deepEqual((await plans(cleaned)).map(plan=>plan.id),[waiting.id,layout.id,named.id]);await folder(cleaned);assert.equal(await cleaned.locator('.sharing-local-plan').count(),3);await close(cleaned);await cleaned.reload();await cleaned.getByRole('button',{name:'View saved charts',exact:true}).waitFor();assert.equal((await plans(cleaned)).length,3);assert.equal(await cleaned.evaluate(key=>localStorage.getItem(key),backupKey),raw);await cleanup.close();
    const linkedState=seatsCreateState(),linkedPlan=linkedState.plans[0],unlinkedBlank=seatsCreatePlan(dateName);linkedPlan.name=dateName;linkedState.plans.push(unlinkedBlank);linkedState.activeId=unlinkedBlank.id;
    const connection={version:1,profile:'Synthetic Organizer',entries:[{localId:linkedPlan.id,remoteId:crypto.randomUUID(),base:{plan:linkedPlan,revision:1},queue:[]}]};
    const offlineLinked=await browser.newContext();await offlineLinked.addInitScript(({key,sharedKey,state,connection})=>{if(!localStorage.getItem('fixture-installed')){localStorage.setItem(key,JSON.stringify(state));localStorage.setItem(sharedKey,JSON.stringify(connection));localStorage.setItem('fixture-installed','true');}},{key,sharedKey,state:linkedState,connection});const linkedPage=await offlineLinked.newPage();await unlock(linkedPage);assert.deepEqual((await plans(linkedPage)).map(plan=>plan.id),[linkedPlan.id],'A remembered shared file is retained even when empty and the service is unavailable');await folder(linkedPage);assert.equal(await linkedPage.locator('.sharing-local-plan').count(),1);await offlineLinked.close();
    const limitState=seatsCreateState();limitState.plans=Array.from({length:29},(_,i)=>seatsCreatePlan('Synthetic Saved Section '+(i+1)));limitState.plans.push(seatsCreatePlan(dateName));limitState.activeId=limitState.plans.at(-1).id;
    const limit=await browser.newContext();await limit.addInitScript(({key,state})=>{if(!localStorage.getItem('fixture-installed')){localStorage.setItem(key,JSON.stringify(state));localStorage.setItem('fixture-installed','true');}},{key,state:limitState});const limitPage=await limit.newPage();await unlock(limitPage);assert.equal((await plans(limitPage)).length,29);await create(limitPage);assert.equal((await plans(limitPage)).length,29);await limitPage.locator('#chart-name').fill('Synthetic Thirtieth Section');await limitPage.locator('#chart-name').press('Enter');assert.equal((await plans(limitPage)).length,30,'The 30-chart limit counts saved content rather than abandoned drafts');await limit.close();
    assert.deepEqual(errors,[]);console.log('PASS: untouched automatic drafts stay unsaved, repeated New does not consume files or suffixes, meaningful content saves once, slow name parsing protects its target draft, Undo/Redo and deletion keep the folder accurate, old empty copies are backed up and pruned, and linked/offline files survive.');console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
