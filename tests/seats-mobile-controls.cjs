const openPrintOptions=require('./helpers/seats-print-options.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-mobile-controls-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
const server=http.createServer((req,res)=>{
  const pathname=req.url.split('?')[0];
  if(pathname==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreateState,seatsWriteName}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];
  plan.name='Seating plan - כסלו תשפ״ז';seatsWriteName(plan,'A1',0,'Yosef Cohen');
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{for(const width of remote?[375]:[320,360,375,390,430,768,1440]){
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],writes=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/data/seats-sync.json*',route=>route.fulfill({contentType:'application/json',body:'{"endpoint":""}'}));
    await context.route('**/api/**',route=>{writes.push(route.request().method()+' '+route.request().url());return route.abort();});
    await context.addInitScript(sample=>{localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));},sample);
    const response=await page.goto(origin+'/seats/?count=off');
    if(remote){const source=await response.text(),local=fs.readFileSync(path.join(root,'seats/index.html'),'utf8');assert.equal(source.match(/name="seats-build" content="([^"]+)"/)[1],local.match(/name="seats-build" content="([^"]+)"/)[1],'The deployed build matches the tested build');}
    await page.locator('#seats-name').fill('Synthetic Mobile Reviewer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
    await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
    const raw=()=>page.evaluate(key=>localStorage.getItem(key),key),before=await raw();
    const header=page.locator('.seats-editor-head'),mode=page.getByRole('combobox',{name:'Seat labels',exact:true});
    assert.equal(await page.locator('#print-options').getAttribute('open'),null,'Print options start collapsed');
    assert.equal(await page.locator('.top-actions>button').count(),2);
    for(const label of ['Saved charts','Print / PDF'])assert.ok(await header.getByRole('button',{name:label,exact:true}).isVisible());
    assert.ok(await header.locator('.editor-status').getByRole('button',{name:'Save',exact:true}).isVisible());
    assert.equal(await mode.inputValue(),'full');
    assert.ok(await page.locator('.canvas-title-row').getByRole('switch',{name:'Room design',exact:true}).isVisible());
    assert.ok(await page.getByRole('switch',{name:'Show Open on empty seats',exact:true}).isVisible());
    assert.ok(await page.getByRole('switch',{name:'Show table numbers',exact:true}).isVisible());
    const targets=await page.locator('.seats-editor-head button,.seats-editor-head>details>summary,#chart-name,.canvas-buttons button,.canvas-buttons select,.canvas-heading .chart-name-switch,.canvas-name-options .chart-name-switch,#seat-label-mode').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>{const b=node.getBoundingClientRect();return {label:node.getAttribute('aria-label')||node.textContent.trim()||node.id,x:b.x,right:b.right,height:b.height,width:b.width};}));
    assert.ok(targets.every(b=>b.height>=44&&b.width>=44),'Touch targets are at least 44px: '+JSON.stringify(targets));
    assert.ok(targets.every(b=>b.x>=0&&b.right<=width+.1),'Every top control fits the viewport: '+JSON.stringify(targets));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');
    await page.screenshot({path:path.join(output,width+'-overview.png'),fullPage:true});
    await mode.scrollIntoViewIfNeeded();await mode.focus();const top=(await mode.boundingBox()).y;
    for(const value of ['initials','reserved','full']){
      await mode.selectOption(value);assert.equal(await mode.inputValue(),value);assert.equal(await page.evaluate(()=>document.activeElement.id),'seat-label-mode');
      assert.ok(Math.abs((await mode.boundingBox()).y-top)<1,'Name choices retain their position');
      const expected={initials:'Y Cohen',reserved:'Reserved',full:'Yosef Cohen'}[value];
      for(const scope of ['.room-stage','#seats-print'])assert.equal((await page.locator(scope+' .table-seat.assigned .seat-name').evaluate(node=>[...node.querySelectorAll('tspan')].map(line=>line.textContent).join(' '))).trim(),expected);
      assert.equal(await raw(),before,'Display choices preserve all chart data');
    }
    const menu=page.locator('#chart-more'),summary=menu.locator('summary');
    await summary.click();assert.ok(await menu.getAttribute('open')!==null);await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('open'),null);assert.equal(await page.evaluate(()=>document.activeElement.closest('details')?.id),'chart-more');
    await summary.click();await page.locator('#chart-name').click({position:{x:8,y:20}});assert.equal(await menu.getAttribute('open'),null,'Tapping elsewhere closes the action menu');assert.equal(await page.evaluate(()=>document.activeElement.id),'chart-name');
    await summary.click();await page.getByRole('button',{name:'Use today’s date',exact:true}).focus();await page.locator('#chart-name').focus();assert.equal(await menu.getAttribute('open'),null,'Keyboard focus leaving the menu closes it');
    await openPrintOptions(page);assert.equal(await page.locator('#print-options details').count(),0,'Print settings have no nested disclosures');
    for(const id of ['paper-size','print-color','pdf-colors','print-header','print-footer']){
      assert.ok(await page.locator('#'+id).isVisible(),id+' is directly available in Print options');
      assert.ok((await page.locator('#'+id).boundingBox()).height>=44);
      if(width<=700)assert.equal(await page.locator('#'+id).evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),16,'Phone form fields prevent automatic text zoom');
    }
    await page.locator('#paper-size').scrollIntoViewIfNeeded();await page.locator('#paper-size').focus();const paperTop=(await page.locator('#paper-size').boundingBox()).y;await page.locator('#paper-size').selectOption('legal');
    assert.ok(await page.locator('#print-options').getAttribute('open')!==null);assert.equal(await page.evaluate(()=>document.activeElement.id),'paper-size');assert.ok(Math.abs((await page.locator('#paper-size').boundingBox()).y-paperTop)<1);
    assert.equal(await raw(),before,'Legal device choice preserves chart data');
    await page.locator('#print-options summary').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,width+'-print-options.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await context.close();
  }}finally{await browser.close();if(!remote)server.close();}
  console.log('PASS: responsive editor controls, 44px targets, one print panel, all name modes, menu dismissal, focus/position stability and unchanged chart data.');console.log('Artifacts: '+output);
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
