// Compare the date preview with the actual public pages at the same instant.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=process.env.WEBSITE_PREVIEW_OUTPUT;
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+req.url.split('?')[0]);
 if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(403).end();
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=process.env.WEBSITE_PREVIEW_ORIGIN||'http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const errors=[],checks=[];if(output)fs.mkdirSync(output,{recursive:true});
 const real='2026-10-25T12:00:00Z';
 const routes=[['/','.luach-home-date,.luach-next,.luach-menu,.luach-site-footer'],['/week/','#week-host'],['/chart/','#chart-host'],['/schedules/','.luach-sheets'],['/donate/','.luach-give-page']];
 const settle=page=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 const ready=async(page,route)=>{
  await page.locator(route==='/'?'.luach-menu':route==='/week/'?'.reader-nav,.week-nav':route==='/chart/'?'.pages .page':route==='/schedules/'?'.luach-sheets':'.luach-give-page').first().waitFor();await settle(page);
 };
 const snapshot=(page,selector)=>page.locator(selector).evaluateAll(nodes=>nodes.map(node=>node.innerText));
 const closeNotice=async(page)=>{const button=page.locator('.luach-announce[open] .luach-announce-close');if(await button.count())await button.click();};
 try{
  const ordinary=await browser.newContext({viewport:{width:1440,height:1000}}),simulated=await browser.newContext({viewport:{width:1440,height:1000}});
  for(const context of [ordinary,simulated])await context.addInitScript(()=>{localStorage.setItem('zmanim-nocount','1');localStorage.setItem('zmanim-chart-announced','unchanged-marker');});
  const actual=await ordinary.newPage(),preview=await simulated.newPage();
  for(const page of [actual,preview])page.on('pageerror',error=>errors.push(error.message));
  await preview.clock.setFixedTime(new Date(real));
  for(const instant of ['2026-12-10T11:42:00Z','2026-09-11T22:00:00Z','2026-12-13T02:00:00Z','2035-11-01T12:00:00Z','2027-03-14T07:30:00Z']){
   await actual.clock.setFixedTime(new Date(instant));
   for(const [route,selector]of routes){
    await actual.goto(origin+route);await ready(actual,route);
    const url=new URL(route,origin);url.searchParams.set('website-preview',new Date(instant).toISOString());
    await preview.goto(url.href);await ready(preview,route);
    assert.deepEqual(await snapshot(preview,selector),await snapshot(actual,selector),route+' matches the congregation site at '+instant);
    assert(await preview.locator('.website-preview-banner').isVisible());
    assert.equal(await preview.evaluate(()=>new Date().toISOString()),new Date(real).toISOString(),'Date itself remains real');
    assert.equal(await preview.evaluate(()=>localStorage.getItem('zmanim-chart-announced')),'unchanged-marker','Preview does not mark future announcements as seen');
    if(instant.startsWith('2026-12-10')&&route==='/chart/'){
     const pdfs=[];
     for(const page of [actual,preview]){
      const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});
      assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2);
      const text=execFileSync('pdftotext',['-layout','-','-'],{input:pdf,encoding:'utf8'});
      assert(!text.includes('Exit preview')&&!text.includes('Preview:'));pdfs.push(text);
      if(output)fs.writeFileSync(path.join(output,page===preview?'preview.pdf':'ordinary.pdf'),pdf);
     }
     assert.equal(pdfs[0],pdfs[1],'Preview chrome never changes the printed chart');
    }
    checks.push({instant,route});
   }
  }
  const legacy=new URL('/',origin);legacy.searchParams.set('website-preview','2026-12-10T11:42:00.000Z');legacy.hash='week';
  await preview.goto(legacy.href);await ready(preview,'/week/');
  assert.equal(new URL(preview.url()).pathname,'/week/');
  assert.equal(new URL(preview.url()).searchParams.get('website-preview'),'2026-12-10T11:42:00.000Z');
  assert(await preview.locator('.reader-time').filter({hasText:'6:43'}).count()>0,'Legacy links retain the preview clock');
  checks.push({legacyPreview:true});
  await ordinary.close();await simulated.close();
  for(const width of [375,1440]){
   const context=await browser.newContext({viewport:{width,height:1000}});
   await context.addInitScript(()=>{localStorage.setItem('zmanim-nocount','1');localStorage.setItem('zmanim-admin-unlock',JSON.stringify({at:Date.parse('2026-10-25T12:00:00Z')}));});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.clock.setFixedTime(new Date(real));
   await page.goto(origin+'/admin/#home');await page.locator('.admin-home-task[href="#preview"]').click();
   await page.locator('#website-preview-frame').waitFor();
   const date=page.locator('#website-preview-date'),time=page.locator('#website-preview-time');
   const saved=await page.evaluate(()=>localStorage.getItem('zmanim-app-state-v1'));
   await date.fill('2026-12-10');await time.fill('06:42');await page.getByRole('button',{name:'Show preview',exact:true}).click();
   const frame=page.frameLocator('#website-preview-frame');
   await frame.locator('.luach-next-time').filter({hasText:'6:43'}).first().waitFor();
   assert.match(await frame.locator('.luach-home-date').innerText(),/December 10/);
   assert.match(await frame.locator('.website-preview-banner').innerText(),/2026/);
   await page.locator('#website-preview-screen').selectOption('phone');
   assert.equal(await frame.locator('body').evaluate(()=>innerWidth),390);
   await closeNotice(frame);
   await frame.locator('.luach-menu a[href*="/week/"]').click();
   await page.waitForFunction(()=>document.querySelector('#website-preview-page').value==='/week/');
   const open=page.locator('#website-preview-open');assert.equal(new URL(await open.getAttribute('href')).pathname,'/week/');
   assert.equal(new URL(await open.getAttribute('href')).searchParams.get('website-preview'),'2026-12-10T11:42:00.000Z');
   assert(await frame.locator('.reader-time').filter({hasText:'6:43'}).count()>0);
   await frame.locator('body').evaluate(()=>history.back());await frame.locator('.luach-menu').waitFor();
   assert.match(await frame.locator('.luach-next-time').first().innerText(),/6:43/);
   await frame.locator('body').evaluate(()=>history.forward());await frame.locator('.reader-time').filter({hasText:'6:43'}).first().waitFor();
   await frame.locator('body').evaluate(()=>location.reload());await frame.locator('.reader-time').filter({hasText:'6:43'}).first().waitFor();
   assert.equal(await page.evaluate(()=>localStorage.getItem('zmanim-app-state-v1')),saved,'Preview controls do not change saved schedules');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(output)await page.screenshot({path:path.join(output,width+'-admin.png'),fullPage:true});
   const popupWait=page.waitForEvent('popup');await open.click();const popup=await popupWait;
   await ready(popup,'/week/');assert(await popup.locator('.website-preview-banner').isVisible());
   await popup.clock.setFixedTime(new Date(real));await popup.getByRole('link',{name:'Exit preview',exact:true}).click();
   await ready(popup,'/week/');assert(!new URL(popup.url()).searchParams.has('website-preview'));assert.equal(await popup.locator('.website-preview-banner').count(),0);await popup.close();
   const previous=await page.locator('iframe').getAttribute('src');
   await date.fill('2027-03-14');await time.fill('02:30');await page.getByRole('button',{name:'Show preview',exact:true}).click();
   assert.match(await page.locator('#website-preview-note').innerText(),/does not occur/);
   // Date edits may have previewed the valid old time before the invalid time was entered.
   assert.notEqual(new URL(await page.locator('iframe').getAttribute('src')).searchParams.get('website-preview'),'2027-03-14T07:30:00.000Z');
   await page.locator('#website-preview-today').click();assert.equal(await date.inputValue(),'2026-10-25');assert.equal(await time.inputValue(),'08:00');
   await page.locator('#website-preview-screen').selectOption('desktop');assert.equal(await frame.locator('body').evaluate(()=>innerWidth),1200);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.goto(origin+'/admin/#home');await page.locator('.admin-home-task[href="#preview"]').click();await page.locator('iframe').waitFor();
   assert.equal(await date.inputValue(),'2026-10-25');assert.equal(await page.locator('#website-preview-screen').inputValue(),'desktop');
   checks.push({width,admin:true,previous});await context.close();
  }
  assert.deepEqual(errors,[]);if(output)fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
