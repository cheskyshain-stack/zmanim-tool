const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-navigation-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreateState,seatsCreatePlan,seatsWriteName}=await import('../js/seats/model.js'),sample=seatsCreateState();
  sample.plans=Array.from({length:5},(_,i)=>{const plan=seatsCreatePlan(i===4?'Synthetic long chart title '.repeat(3).trim().slice(0,80):'Synthetic saved chart '+(i+1));seatsWriteName(plan,'A1',0,'Synthetic Person '+i);return plan;});sample.activeId=sample.plans[0].id;
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{
    for(const width of [375,1440]){
      const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===375,hasTouch:width===375}),page=await context.newPage(),errors=[],writes=[],patches=[];
      await context.addInitScript(sample=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));},sample);
      if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});
      page.on('websocket',s=>s.on('framesent',e=>{try{if(JSON.parse(e.payload).type==='patch')patches.push('patch');}catch{}}));
      await page.goto(origin+'/seats/?previous=1&count=off');const response=await page.goto(origin+'/seats/?count=off');
      if(remote){const html=await response.text(),local=fs.readFileSync(path.join(root,'seats/index.html'),'utf8'),pattern=/\.\.\/js\/seats-app\.js\?v=[0-9a-f]+/;assert.equal(html.match(pattern)[0],local.match(pattern)[0]);}
      await page.locator('#seats-name').fill('Synthetic Navigation Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      const home=async()=>{await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();await page.waitForFunction(()=>history.state?.seatsView?.screen==='home'&&!history.state.seatsView.dialog);assert.equal(await page.locator('dialog[open]').count(),0);};
      const back=async()=>{await page.goBack();await home();assert.ok(!page.url().includes('previous=1'),'Back stays inside Seats until reaching home');};
      const openFolder=async()=>{await page.getByRole('button',{name:/^(View saved charts|Saved charts)$/}).click();await page.getByRole('heading',{name:'Saved charts',exact:true}).waitFor();};
      const openOriginal=async()=>{await openFolder();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+sample.activeId+'"]').click();await page.locator('#chart-name').waitFor();};
      const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
      await home();assert.ok(await page.getByRole('button',{name:'Log out',exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'Lock',exact:true}).count(),0);
      await openFolder();
      const rows=await page.locator('.sharing-local-plan').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
      assert.equal(rows.length,5);assert.ok(rows.every(row=>Math.abs(row.x-rows[0].x)<1&&Math.abs(row.width-rows[0].width)<1));assert.ok(rows.slice(1).every((row,i)=>row.y>=rows[i].y+rows[i].height-1),'Saved charts form one vertical list');assert.ok(rows.slice(0,4).every(row=>row.height<190),'Ordinary rows stay compact');assert.equal(await page.locator('.sharing-local-plan .saved-page-icon').count(),0);
      assert.ok(await page.locator('.sharing-local-plan .saved-chart-actions button').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect(),row=node.closest('li').getBoundingClientRect();return r.height>=44&&r.left>=row.left&&r.right<=row.right+1;})));
      await page.locator('.sharing-local-plan').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'saved-list-'+width+'.png')});
      await back();await page.goForward();await page.getByRole('heading',{name:'Saved charts',exact:true}).waitFor();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+sample.activeId+'"]').click();
      await page.locator('.room-stage [data-table=B1][data-seat="0"]').click();await page.locator('#seat-name-input').fill('Synthetic Unfinished Name');await back();assert.ok((await stored()).plans[0].people.some(person=>person.name==='Synthetic Unfinished Name'),'Back saves a name still being typed');
      await page.goForward();await page.locator('#chart-name').waitFor();assert.equal(await page.locator('#chart-name').inputValue(),sample.plans[0].name);await page.reload();await page.locator('#chart-name').waitFor();await back();
      await page.goForward();await page.locator('#chart-name').waitFor();await page.locator('#chart-more summary').click();await page.getByRole('button',{name:'Alphabetical seat list',exact:true}).click();await page.getByRole('heading',{name:'Alphabetical seat list',exact:true}).waitFor();await back();
      await page.goForward();await page.getByRole('heading',{name:'Alphabetical seat list',exact:true}).waitFor();await page.getByRole('button',{name:/Back to chart/}).click();await openFolder();await back();
      await page.getByRole('button',{name:'Create new chart',exact:true}).click();await page.locator('#chart-name').waitFor();const blankId=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('lakewood-commons-seats-view-v1')).id);await back();assert.equal((await stored()).plans.length,5,'Empty drafts stay out of saved charts');await page.goForward();await page.locator('#chart-name').waitFor();await page.reload();await page.locator('#chart-name').waitFor();assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('lakewood-commons-seats-view-v1')).id),blankId);await back();
      for(let i=0;i<3;i++){await openOriginal();await page.getByRole('button',{name:/Seats home/}).click();await home();}
      const before=await stored();await page.getByRole('button',{name:'Log out',exact:true}).click();await page.locator('#seats-unlock').waitFor();await page.reload();await page.locator('#seats-unlock').waitFor();assert.deepEqual(await stored(),before,'Logging out keeps saved charts');
      await page.locator('#seats-name').fill('Synthetic Navigation Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await home();await page.goBack();await page.waitForURL(/previous=1/);assert.ok(page.url().includes('previous=1'),'Back from home is allowed to leave, with no duplicate home entries');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
    }
    console.log('PASS: phone/desktop Back and Forward, refreshed chart and empty draft, unfinished-name saving, folder dismissal, no duplicate home entries, compact chart rows and persistent logout.');console.log('Artifacts: '+output);
  }finally{await browser.close();if(!remote)server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
