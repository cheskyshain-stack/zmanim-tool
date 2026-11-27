// Real browser with an isolated local service. Never write production records.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{createMessagesFixture}=require('./shul-messages-service.cjs');
(async()=>{
 const root=path.resolve(__dirname,'../dist'),screens=fs.mkdtempSync(path.join(os.tmpdir(),'shul-messages-'));let fixture;
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/data/calendar.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({endpoint:fixture.endpoint}));}
  let file=path.resolve(root,'.'+decodeURIComponent(pathname));if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(403).end();
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file))return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 fixture=await createMessagesFixture(origin);await fixture.pause();fixture.endpoint=(await fixture.backend.ready).origin;
 const {call,owner,viewer}=fixture;
 for(let index=0;index<34;index++)assert.equal((await call('/api/announcements','POST',{id:'synthetic-message-'+String(index).padStart(3,'0'),text:`Message ${index+1}\nOriginal WORDING. שלום לכולם\nA community update with enough text to check comfortable reading.`},owner.token)).status,201);
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true}),errors=[];
 try{
  for(const width of [375,655,1280]){
   const context=await browser.newContext({viewport:{width,height:width===375?740:900},serviceWorkers:width===375?'allow':'block'});
   const session=(await call('/api/session','POST',{email:'viewer@example.test',password:fixture.password})).body;
   await context.addInitScript(session=>{localStorage.setItem('zmanim-nocount','1');localStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify(session));},session);
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   const events=[];page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/events'))events.push(req.url());});
   await page.goto(origin+'/calendar/?messages=1');await page.waitForURL('**/messages/?messages=1');
   await page.locator('[data-announcement-id="synthetic-message-033"]').waitFor({timeout:10000}).catch(async error=>{console.log(await page.locator('body').innerText(),errors);await page.screenshot({path:require('node:path').join(screens,'failure.png')});throw error;});
   await page.waitForTimeout(150);
   assert.equal(await page.locator('dialog[open], .shul-calendar').count(),0,'Feed opens as page with no calendar');
   assert.equal(events.length,0,'No event API requests');
   assert.equal(await page.locator('.cal-announcement-compose').isVisible(),false,'Readers have no message composer');
   assert.equal(await page.locator('[data-cal-message-alerts]').isVisible(),true,'Phone alerts stay available');
   const geometry=await page.evaluate(()=>{
    const feed=document.querySelector('.cal-announcement-feed'),bar=document.querySelector('.cal-messages-toolbar');
    return {overflow:document.documentElement.scrollWidth>innerWidth,remaining:feed.scrollHeight-feed.scrollTop-feed.clientHeight,bar:bar.getBoundingClientRect().toJSON(),height:innerHeight,feed:feed.getBoundingClientRect().toJSON(),bodyHeight:document.documentElement.scrollHeight};
   });
   assert.equal(geometry.overflow,false);assert.ok(geometry.remaining<20,JSON.stringify(geometry));assert.ok(geometry.bar.bottom<=geometry.height+1,JSON.stringify(geometry));assert.ok(geometry.feed.height>300,JSON.stringify(geometry));
   const ids=await page.locator('[data-announcement-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.announcementId));assert.deepEqual([...ids].sort(),ids,'Messages are oldest first');
   await page.screenshot({path:path.join(screens,'viewer-'+width+'.png')});
   if(width===375){
    await page.locator('[data-cal-message-alerts]').click();
    await page.locator('dialog[open] .cal-primary:not([disabled])').waitFor();
    assert.match(await page.locator('dialog[open]').innerText(),/Turn on message alerts/);
    await page.locator('dialog[open] [data-cal-close]').click();
   }
   await page.locator('.cal-announcement-feed').evaluate(feed=>feed.scrollTop=0);
   const older=page.locator('[data-cal-older-announcements]');if(await older.isVisible()){await older.click();await page.locator('[data-announcement-id="synthetic-message-000"]').waitFor();}
   await page.locator('[data-cal-latest]').click();assert.ok(await page.locator('.cal-announcement-feed').evaluate(feed=>feed.scrollHeight-feed.scrollTop-feed.clientHeight<20));
   // Simulate a short viewport (phone keyboard or landscape).
   await page.setViewportSize({width,height:430});await page.waitForTimeout(100);
   assert.ok(await page.locator('.cal-messages-toolbar').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1));
   await page.setViewportSize({width,height:900});
   await page.reload();await page.locator('[data-announcement-id="synthetic-message-033"]').waitFor();
   if(width===1280){
    await page.locator('.cal-announcement-feed').evaluate(feed=>feed.scrollTop=0);
    const top=await page.locator('.cal-announcement-feed').evaluate(feed=>feed.scrollTop);
    assert.equal((await call('/api/announcements','POST',{id:'synthetic-live-message',text:'Synthetic arriving message'},owner.token)).status,201);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.locator('[data-cal-new-announcements]').waitFor();
    assert.equal(await page.locator('.cal-announcement-feed').evaluate(feed=>feed.scrollTop),top);
    await page.locator('[data-cal-latest]').click();await page.getByText('Synthetic arriving message',{exact:true}).waitFor();
    assert.ok(await page.locator('.cal-announcement-feed').evaluate(feed=>feed.scrollHeight-feed.clientHeight-feed.scrollTop<20));
   }
   await page.locator('[data-cal-message-options]').click();await page.locator('[data-cal-signout]').click();await page.locator('.cal-login form').waitFor();
   assert.match(await page.locator('.cal-login').innerText(),/Shul Messages sign in/);
   await page.locator('[data-cal-switch-login]').click();assert.match(await page.locator('.cal-login').innerText(),/Create a Shul Messages account/);
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:375,height:740},serviceWorkers:'block'});
  await context.addInitScript(session=>localStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify(session)),owner);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/messages/');
  const field=page.locator('textarea[name="message"]');await field.waitFor();await field.fill('Synthetic new page message');await page.locator('.cal-announcement-compose button[type="submit"]').click();
  await page.getByText('Synthetic new page message',{exact:true}).waitFor();await page.screenshot({path:path.join(screens,'owner-375.png')});
  await page.locator('[data-cal-message-options]').click();await page.locator('[data-cal-access]').click();assert.equal(await page.locator('[data-cal-simcha-import]').count(),0);assert.match(await page.locator('dialog[open]').innerText(),/Message accounts/);
  await page.locator('dialog[open] [data-cal-close]').click();
  await page.evaluate(()=>localStorage.setItem('zmanim-admin-unlock',JSON.stringify({at:Date.now()})));
  await page.goto(origin+'/admin/#calendar');await page.locator('[data-announcement-id="synthetic-message-033"]').waitFor();
  assert.equal(await page.locator('.shul-calendar').count(),0);assert.match(await page.locator('main').innerText(),/Shul Messages/);
  const adminBounds=await page.locator('.cal-messages-toolbar').evaluate(el=>({box:el.getBoundingClientRect().toJSON(),height:innerHeight}));
  assert.ok(adminBounds.box.bottom<=adminBounds.height+1,JSON.stringify(adminBounds));
  await page.screenshot({path:path.join(screens,'main-admin-375.png')});
  await page.goto(origin+'/');await page.locator('[data-community-calendar]').waitFor();assert.equal(await page.locator('[data-community-calendar]').getAttribute('href'),'/messages/');assert.match(await page.locator('[data-community-calendar]').innerText(),/Shul Messages/);
  await page.screenshot({path:path.join(screens,'home-375.png'),fullPage:true});
  await context.close();assert.deepEqual(errors,[]);console.log('Shul Messages browser passed: phone/desktop, legacy links, saved sign-in, page layout, chronological feed, older/latest, short viewport, registration and posting. Screenshots: '+screens);
 }finally{await browser.close();await fixture.backend.dispose();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
