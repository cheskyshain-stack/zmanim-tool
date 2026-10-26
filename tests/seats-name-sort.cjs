const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-name-sort-')),key='lakewood-commons-seats-v1';
const preference='lakewood-commons-seats-name-sort';
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
    const {seatsCreateState,seatsAddNames,seatsAssign}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];
    const {seatsParseDelimited}=await import('../js/seats/import.js');
    const first=['Rabbi Aaron Zilber','Dr. Baruch Brown III','R. Chaim Brown Jr.','Moshe Aaron','Reb Yitzchok Stern','Yosef Cohen'];
    const last=['Moshe Aaron','Dr. Baruch Brown III','R. Chaim Brown Jr.','Yosef Cohen','Reb Yitzchok Stern','Rabbi Aaron Zilber'];
    plan.name='Name sorting example';
    seatsAddNames(plan,[first[5],first[2],first[0],first[3],first[1],first[4],'דוד לוי','הרב אברהם כהן',...Array.from({length:40},(_,i)=>'ZZ Test Person '+String(i).padStart(2,'0'))]);
    const assigned=plan.people.find(person=>person.name==='Moshe Aaron');seatsAssign(plan,'A1',0,assigned.id);
    for(const width of [1440,375]){
      const context=await browser.newContext({viewport:{width,height:900},isMobile:width===375,hasTouch:width===375,acceptDownloads:true}),page=await context.newPage(),errors=[];
      await context.addInitScript(({key,sample})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(sample));},{key,sample});
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/seats/');
      const photo=page.locator('.seats-lock-photo');await photo.evaluate(node=>node.decode());
      const photoSize=await photo.evaluate(node=>{const bounds=node.getBoundingClientRect();return {width:bounds.width,height:bounds.height,naturalWidth:node.naturalWidth,naturalHeight:node.naturalHeight};});
      assert.equal(photoSize.naturalWidth,240);assert.equal(photoSize.naturalHeight,141);
      assert.ok(Math.abs(photoSize.height-54)<1);assert.ok(Math.abs(photoSize.width/photoSize.height-photoSize.naturalWidth/photoSize.naturalHeight)<.02,'The login photo keeps the congregation picture proportions');
      await page.locator('#seats-name').fill('Synthetic Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      const openSaved=async()=>{await page.getByRole('button',{name:/^(View saved charts|Saved charts)$/}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();};
      await openSaved();await page.locator('#people-sort').waitFor();
      const visibleNames=async()=>page.locator('#people-list .person-name bdi').allTextContents();
      const chosenNames=async()=>(await visibleNames()).filter(name=>first.includes(name));
      assert.equal(await page.locator('#people-sort').inputValue(),'first');
      assert.deepEqual(await chosenNames(),first.filter(name=>name!=='Moshe Aaron'));
      await page.locator('#show-assigned').check();assert.deepEqual(await chosenNames(),first);
      const saved=await page.evaluate(key=>localStorage.getItem(key),key);
      await page.locator('#people-sort').scrollIntoViewIfNeeded();await page.locator('#people-sort').focus();
      await page.locator('#people-list').evaluate(node=>{node.scrollTop=120;});
      const before=await page.evaluate(()=>({page:scrollY,people:document.querySelector('#people-list').scrollTop,control:document.querySelector('#people-sort').getBoundingClientRect().top,panel:document.querySelector('.seats-panel').scrollTop}));
      await page.locator('#people-sort').selectOption('last');
      assert.deepEqual(await chosenNames(),last);
      const after=await page.evaluate(()=>({page:scrollY,people:document.querySelector('#people-list').scrollTop,control:document.querySelector('#people-sort').getBoundingClientRect().top,panel:document.querySelector('.seats-panel').scrollTop,focus:document.activeElement.id}));
      assert.equal(after.focus,'people-sort');assert.ok(Math.abs(after.page-before.page)<1);assert.equal(after.people,before.people);assert.equal(after.panel,before.panel);assert.ok(Math.abs(after.control-before.control)<1);
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),saved,'Sorting must not reorder canonical people or change assignments');
      assert.equal(await page.evaluate(preference=>localStorage.getItem(preference),preference),'last');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(output,'last-name-'+width+'.png'),fullPage:true});
      await page.locator('#people-extra-tools').evaluate(node=>{node.open=true;});await page.locator('#plan-files').evaluate(node=>{node.open=true;});
      const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download seating list',exact:true}).click();
      const file=await downloading,filePath=path.join(output,'sorted-'+width+'.csv');await file.saveAs(filePath);
      const exported=seatsParseDelimited(fs.readFileSync(filePath,'utf8')).slice(1).map(row=>row[0]);
      assert.deepEqual(exported.filter(name=>first.includes(name)),last,'Seating-list export should follow the selected name order');
      await page.reload();await openSaved();assert.equal(await page.locator('#people-sort').inputValue(),'last');
      await page.locator('#show-assigned').check();assert.deepEqual(await chosenNames(),last);
      assert.equal(await page.evaluate(({key,id})=>JSON.parse(localStorage.getItem(key)).plans.find(plan=>plan.id===id).tables.find(table=>table.id==='A1').seats[0],{key,id:plan.id}),assigned.id);
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('PASS: first/last name sorting, titles, Hebrew names, unchanged assignments/canonical ordering, CSV export, focus/scroll, preference persistence and phone/desktop layout.');
    console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
