const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-desktop-')),key='lakewood-commons-seats-v1';
const server=http.createServer((request,response)=>{
  if(request.url.split('?')[0]==='/data/seats-sync.json'){response.setHeader('Content-Type','application/json');return response.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(request.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){response.statusCode=403;return response.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){response.statusCode=404;return response.end();}
  response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');response.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/seats/');
    await page.locator('#seats-name').fill('Synthetic Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
    await page.getByRole('button',{name:'Create new chart',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('.room-stage .table-item').first().waitFor();
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.getByRole('button',{name:'Edit layout',exact:true}).count(),0);
    assert.ok(await page.locator('#people-search').isVisible(),'Names should be the initial view');
    await page.locator('#names-file').setInputFiles({name:'names.csv',mimeType:'text/csv',buffer:Buffer.from('Name\nYosef Cohen\nMoshe Levi\nRabbi Shmuel Alexander Friedlander\n')});
    await page.getByText('3 names added; 0 duplicates skipped.').waitFor();
    const state=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),plan=async()=>(await state()).plans[0];
    const person=async name=>(await plan()).people.find(person=>person.name===name);
    const seat=(table,index=0)=>page.locator('.room-stage [data-table="'+table+'"][data-seat="'+index+'"] .seat-area');
    const assigned=async(table,index=0)=>(await plan()).tables.find(entry=>entry.id===table).seats[index];
    for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
      await page.setViewportSize(viewport);
      const bounds=await page.evaluate(()=>Object.fromEntries(['.seats-panel','.seats-canvas','.room-scroll'].map(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return [selector,{top:box.top,bottom:box.bottom}];})));
      assert.ok(Object.values(bounds).every(box=>box.top>=0&&box.bottom<=viewport.height+1),JSON.stringify({viewport,bounds}));
      const size=await page.locator('.room-scroll').evaluate(scroll=>{
        const a=scroll.querySelector('[data-item=A3] .table-surface').getBoundingClientRect(),d=scroll.querySelector('[data-item=D3] .table-surface').getBoundingClientRect();
        return {available:scroll.clientWidth,painted:d.right-a.left,verticalScroll:scroll.scrollHeight>scroll.clientHeight};
      });
      assert.ok(size.painted>size.available*.94,'Default chart fills the available width: '+JSON.stringify(size));
      assert.ok(size.verticalScroll,'The full-width chart scrolls vertically instead of shrinking into a small area');
      assert.ok(await page.locator('.people-list').evaluate(node=>node.clientHeight>=130));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(output,'desktop-'+viewport.width+'.png'),fullPage:true});
    }
    await page.setViewportSize({width:1366,height:768});
    await page.locator('#chart-view').selectOption('whole');
    assert.ok(await page.locator('.room-scroll').evaluate(node=>node.scrollHeight<=node.clientHeight+1));
    await page.locator('#chart-view').selectOption('width');
    await page.locator('#people-extra-tools').evaluate(node=>{node.open=true;});
    await page.locator('#seat-list').evaluate(node=>{node.open=true;});
    await page.locator('#selected-item').scrollIntoViewIfNeeded();
    const panelTop=await page.locator('.seats-panel').evaluate(node=>node.scrollTop),controlTop=(await page.locator('#selected-item').boundingBox()).y;
    await page.locator('#selected-item').selectOption('B1');
    assert.ok(Math.abs(await page.locator('.seats-panel').evaluate(node=>node.scrollTop)-panelTop)<1,'Editing tools should keep their pane scroll');
    assert.ok(Math.abs((await page.locator('#selected-item').boundingBox()).y-controlTop)<1,'Editing tools should keep their screen position');
    await page.locator('#people-extra-tools').evaluate(node=>{node.open=false;});
    const yosef=await person('Yosef Cohen'),moshe=await person('Moshe Levi');
    await seat('A3').click();await page.locator('#seat-name-input').fill('Draft person');
    // Start the native drag before crossing the open editor, which sits above A3 at full width.
    await page.locator('[data-person="'+yosef.id+'"]').scrollIntoViewIfNeeded();
    const dragSource=await page.locator('[data-person="'+yosef.id+'"]').boundingBox();
    await page.mouse.move(dragSource.x+dragSource.width/2,dragSource.y+dragSource.height/2);await page.mouse.down();
    await page.mouse.move(dragSource.x+dragSource.width/2+12,dragSource.y+dragSource.height/2,{steps:4});
    const dropTarget=await seat('A1').boundingBox();await page.mouse.move(dropTarget.x+dropTarget.width/2,dropTarget.y+dropTarget.height/2,{steps:15});await page.mouse.up();
    assert.equal(await assigned('A1'),yosef.id,'Drag from the list should assign the name');
    const draftId=await assigned('A3');
    assert.equal((await plan()).people.find(person=>person.id===draftId)?.name,'Draft person','Dropping a name should save the open seat draft');
    assert.equal(await page.locator('.seat-editor:visible').count(),0);
    async function moveSeat(from,to,copy=false){
      const a=await from.boundingBox(),b=await to.boundingBox();if(copy)await page.keyboard.down('Control');
      await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
      await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:15});await page.mouse.up();
      if(copy)await page.keyboard.up('Control');
    }
    await page.locator('#show-assigned').check();
    const beforeListCopy=await state();
    await page.locator('[data-person="'+yosef.id+'"]').dragTo(seat('A2'));
    const listCopy=await assigned('A2');
    assert.equal(await assigned('A1'),yosef.id,'Dragging an already seated name from the list must keep its original seat');
    assert.ok(listCopy&&listCopy!==yosef.id);assert.equal((await plan()).people.find(person=>person.id===listCopy).name,'Yosef Cohen');
    await page.getByRole('button',{name:'Undo',exact:true}).click();assert.deepEqual(await state(),beforeListCopy);
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await assigned('A2'),listCopy);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    await page.locator('#show-assigned').uncheck();
    await moveSeat(seat('A1'),seat('B1'));
    assert.equal(await assigned('A1'),null);assert.equal(await assigned('B1'),yosef.id,'Drag from one seat to another should move the person');
    await moveSeat(seat('B1'),seat('A2'),true);
    const child=await assigned('A2');assert.ok(child&&child!==yosef.id);assert.equal(await assigned('B1'),yosef.id);
    assert.equal((await plan()).people.find(person=>person.id===child).name,'Yosef Cohen','Ctrl-drag should create a separate copy');
    await page.locator('[data-person="'+moshe.id+'"]').dragTo(seat('B1'));
    assert.equal(await assigned('B1'),moshe.id);assert.ok(await page.locator('[data-person="'+yosef.id+'"]').isVisible(),'A displaced person should return to the waiting list');
    const beforeReturn=await state();await moveSeat(seat('B1'),page.locator('#people-list'));
    assert.equal(await assigned('B1'),null);assert.ok(await page.locator('[data-person="'+moshe.id+'"]').isVisible());
    await page.getByRole('button',{name:'Undo',exact:true}).click();assert.deepEqual(await state(),beforeReturn);
    await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await assigned('B1'),null);
    await page.locator('#chart-view').selectOption('actual');
    const scroll=page.locator('.room-scroll');assert.ok(await scroll.evaluate(node=>node.scrollHeight>node.clientHeight));
    const box=await scroll.boundingBox(),pageTop=await page.evaluate(()=>scrollY);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,250);await page.waitForTimeout(100);
    assert.ok(await scroll.evaluate(node=>node.scrollTop>0),'The enlarged chart should scroll inside its pane');assert.equal(await page.evaluate(()=>scrollY),pageTop);
    await page.locator('#chart-view').selectOption('width');assert.equal(await scroll.evaluate(node=>node.scrollTop),0);
    const beforeCancel=await state();
    await page.locator('#chart-view').selectOption('actual');await seat('A2').scrollIntoViewIfNeeded();
    const source=await seat('A2').boundingBox(),viewport=await scroll.boundingBox();
    await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
    await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height-4,{steps:10});await page.waitForTimeout(350);
    assert.ok(await scroll.evaluate(node=>node.scrollTop>0),'Dragging near the chart edge should scroll it');
    await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await state(),beforeCancel);assert.equal(await page.locator('.seat-drag-label').count(),0);
    await page.locator('#chart-view').selectOption('width');
    await page.screenshot({path:path.join(output,'assigned-desktop.png'),fullPage:true});
    for(const paper of ['letter','tabloid']){
      await page.locator('#paper-size').selectOption(paper);await page.emulateMedia({media:'print'});
      const pdf=path.join(output,'assign-mode-'+paper+'.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
      const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}),text=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'}).replace(/\s+/g,' ');
      assert.match(info,/Pages:\s+1\b/);assert.match(info,paper==='letter'?/792 x 612 pts/:/1224 x 792 pts/);
      assert.match(text,/Yosef Cohen/);assert.match(text,/Draft person/);assert.doesNotMatch(text,/Drag names|Upload names|Add names/);
      await page.emulateMedia({media:'screen'});
    }
    await page.setViewportSize({width:375,height:850});
    await page.waitForFunction(()=>document.querySelectorAll('[data-person][draggable="true"]').length===0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await page.locator('.seats-panel').evaluate(node=>getComputedStyle(node).overflowY),'visible','Phone page should keep normal page scrolling');
    assert.equal(await page.locator('[data-person][draggable="true"]').count(),0,'Phone names should retain normal touch scrolling');
    assert.deepEqual(errors,[]);
    console.log('PASS: desktop panes fit, native list drag, seat moves, copy, displacement, unassign, Undo/Redo, chart zoom/scroll, drag autoscroll, cancel, printing from Assign names, and phone layout.');console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
