// Browser-only preview, synthetic account and messages; no live calendar writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),writes=[],errors=[];
let origin;
const storedEvents=[{id:'saved-wedding',type:'wedding',title:'Evening wedding',time:'19:30'},{id:'saved-bris-later',type:'custom',customCategory:'Bris',title:'Later bris',time:'08:00'},{id:'saved-bris-first',type:'custom',customCategory:'Bris',title:'First bris',time:'07:10'}].map(e=>({date:'2026-11-12',endDate:'2026-11-12',allDay:false,visibility:'everyone',revision:1,...e}));
storedEvents.push({id:'excluded-lechaim',type:'custom',customCategory:'Lechaim',title:'Excluded Lechaim',date:'2026-11-15',endDate:'2026-11-15',allDay:true,visibility:'everyone',revision:1});
const user={id:'synthetic-owner-123',name:'Synthetic owner',role:'viewer',email:'owner@example.test'};
const messages=[{id:'synthetic-preview-123',text:'Shalom Zachor for the Example family on 2026-11-27 at 9pm',createdAt:'2026-11-20T18:00:00.000Z',revision:1,sequence:1},{id:'synthetic-unclear-123',text:'Bris for Example, details to follow',createdAt:'2026-11-20T18:00:00.000Z',revision:1,sequence:2}];
const weddingSource='Rabbi & Mrs Example Smith on the marriage of their DAUGHTER. Chasuna TONIGHT Fountain Ballroom Chupa 7:30 SCVK 10pm';
const weddingWording='Mazel tov to Rabbi and Mrs. Example Smith on the marriage of their daughter!\n\nThe chasuna will take place tonight at Fountain Ballroom.\n\nChuppah: 7:30 PM\nSimchas Chosson V’Kallah: 10:00 PM';
messages.push({id:'wedding-wording-example',text:weddingSource,createdAt:'2026-11-20T18:00:00.000Z',revision:1,sequence:3});
messages.push({id:'general-wording-example',text:'Shiur TONIGHT 8pm Main Shul',createdAt:'2026-11-20T18:10:00.000Z',revision:1,sequence:4});
storedEvents.push({id:'saved-message-wedding',type:'wedding',title:'Saved wedding',details:weddingSource,date:'2026-11-23',endDate:'2026-11-23',allDay:false,time:'22:00',visibility:'everyone',revision:1,updatedBy:'simcha-message-import'});
messages.push({id:'unsafe-wording-example',text:'<img src=x onerror=alert(1)> General notice',createdAt:'2026-11-20T18:15:00.000Z',revision:1,sequence:5});
const originals=JSON.stringify({messages,storedEvents});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(url.pathname==='/data/calendar.json')return json({endpoint:origin});
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET'){writes.push(req.url);if(['/api/announcements/open','/api/announcements/read'].includes(url.pathname))return json({total:5,unread:0,canPost:user.role!=='viewer',canEdit:user.role!=='viewer',canDelete:user.role!=='viewer'});return res.writeHead(405).end();}
  if(url.pathname==='/api/session')return json({user,eventAudienceDetails:true,reminderPublicKey:'synthetic-reminder-key',reminderSchedules:true,messageAlerts:true});
  if(url.pathname==='/api/events')return json({events:storedEvents});
  if(url.pathname==='/api/announcements')return json({messages,nextCursor:null,total:5,unread:5,canPost:true});
  if(url.pathname==='/api/announcements/status')return json({total:5,unread:5,canPost:true,canEdit:true,canDelete:true,editCount:0,deletedCount:0});
  return json({});
 }
 let file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-gpu']});
 const out=path.resolve(__dirname,'../test-results/simcha-preview');fs.mkdirSync(out,{recursive:true});
 try{
  for(const width of [393,1440]){
   const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>errors.push(e.message));
   await page.clock.setFixedTime(new Date('2026-11-21T18:00:00.000Z'));
   await page.addInitScript(user=>{const session={user,token:'a'.repeat(64),expires:Date.now()+86400000};sessionStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify(session));localStorage.setItem('zmanim-nocount','1');},{...user,role:'viewer'});
   await page.route('**/*',r=>r.request().url().startsWith(origin+'/')||r.request().url().startsWith('data:')?r.continue():r.abort());
   await page.goto(origin+'/admin/calendar/');
   await page.locator('[data-cal-day="2026-11-27"]').filter({hasText:'Example family'}).waitFor();
   assert.equal(await page.locator('[data-cal-simcha-review]').count(),0,'Member has no review controls');
   assert.equal(await page.locator('[data-cal-jump]').count(),0,'Reader month heading has no chooser');
   assert.equal(await page.locator('[data-cal-day="2026-11-15"] .cal-event-chip').count(),0,'Lechaim is excluded');
   await page.locator('[data-cal-day="2026-11-12"]').click();
   let cards=await page.getByRole('dialog').locator('.cal-event-card').allTextContents();
   assert.equal(cards.length,3);assert.ok(cards[0].includes('First bris'));assert.ok(cards[1].includes('Later bris'));assert.ok(cards[2].includes('Evening wedding'));
   await page.getByRole('dialog').locator('[data-cal-close]').click();
   await page.getByRole('button',{name:'Next month',exact:true}).click();
   await page.locator('[data-cal-day="2026-12-12"].is-selected').waitFor();
   await page.getByRole('button',{name:'Previous month',exact:true}).click();
   await page.locator('[data-cal-day="2026-11-12"].is-selected').waitFor();
   await page.locator('[data-cal-day="2026-11-27"]').click();
   const dialog=page.getByRole('dialog');await dialog.getByText('From message',{exact:true}).waitFor();
   assert.equal(await dialog.locator('[data-cal-edit]').count(),0);
   assert.equal(await dialog.getByRole('button',{name:'Phone reminders',exact:true}).count(),0,'No calendar reminder shortcut');
   assert.equal(await dialog.locator('.cal-event-description').innerText(),'Shalom Zachor for the Example family\n\nDate: Friday, November 27, 2026\nTime: 9:00 PM');
   await page.evaluate(()=>document.fonts.ready);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');
   await page.screenshot({path:path.join(out,'event-'+width+'.png')});
   await dialog.locator('[data-cal-close]').click();
   assert.equal(await page.locator('[data-cal-simcha-preview]').count(),0,'No preview toggle');
   await page.getByRole('button',{name:'Calendar options',exact:true}).click();
   assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Phone reminders',exact:true}).count(),0,'Calendar options have no reminder control');
   await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
   await page.reload();
   await page.locator('[data-cal-day="2026-11-27"]').filter({hasText:'Example family'}).waitFor();
   for(const date of ['2026-11-20','2026-11-23']){
    assert.match(await page.locator(`[data-cal-day="${date}"] .cal-event-chip`).innerText(),/Rabbi and Mrs\. Example Smith/,'Fetched and preview events share the concise family heading');
    await page.locator(`[data-cal-day="${date}"]`).click();
    const event=page.getByRole('dialog').locator('.cal-event-card').filter({hasText:'Fountain Ballroom'});
    await event.waitFor();assert.equal(await event.locator('.cal-event-description').innerText(),weddingWording);
    assert.deepEqual(await event.locator('.cal-event-description strong').allTextContents(),['Rabbi and Mrs. Example Smith','Chuppah:','Simchas Chosson V’Kallah:']);
    assert.equal(await event.locator('.cal-event-clock').count(),0,'No duplicate time below the labelled milestones');
    assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:path.join(out,`wedding-${date}-${width}.png`)});
    await page.getByRole('dialog').locator('[data-cal-close]').click();
   }
   assert(writes.every(route=>['/api/announcements/open','/api/announcements/read'].includes(new URL(route,'http://local').pathname)),'Calendar presentation has no event-write effects');
   await page.locator('[data-cal-announcements]').click();
   const feed=page.locator('.cal-announcement-feed');
   const wedding=feed.locator('[data-announcement-id="wedding-wording-example"]');await wedding.waitFor();
   assert.equal(await wedding.locator(':scope > p').innerText(),weddingSource);
   assert.deepEqual(await wedding.locator(':scope > p strong').allTextContents(),[]);
   assert.equal(await feed.locator('[data-announcement-id="general-wording-example"] > p').innerText(),messages[3].text);
   assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   assert.equal(await feed.locator('img,script').count(),0,'Message HTML stays plain text');
   assert.equal(await feed.locator('[data-announcement-id="unsafe-wording-example"] > p').innerText(),messages[4].text);
   await page.screenshot({path:path.join(out,`messages-${width}.png`)});
   await page.close();
  }
  user.role='owner';
  const manager=await browser.newPage({viewport:{width:393,height:1000}});
  manager.on('pageerror',error=>errors.push(error.message));
  await manager.clock.setFixedTime(new Date('2026-11-21T18:00:00.000Z'));
  await manager.addInitScript(user=>{sessionStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify({user,token:'a'.repeat(64),expires:Date.now()+86400000}));localStorage.setItem('zmanim-nocount','1');},user);
  await manager.route('**/*',route=>route.request().url().startsWith(origin+'/')||route.request().url().startsWith('data:')?route.continue():route.abort());
  await manager.goto(origin+'/calendar/');await manager.locator('[data-cal-announcements]').click();
  const sourceCard=manager.locator('[data-announcement-id="wedding-wording-example"]');
  await sourceCard.locator('[data-cal-edit-announcement]').click();
  assert.equal(await sourceCard.locator('textarea[name=text]').inputValue(),weddingSource,'Edit retains the exact original wording');
  await sourceCard.locator('[data-cal-cancel-edit]').click();
  assert.equal(await sourceCard.locator(':scope > p').innerText(),weddingSource);
  await manager.close();
  assert.equal(JSON.stringify({messages,storedEvents}),originals,'Original event and announcement records are unchanged');
  assert(writes.every(route=>['/api/announcements/open','/api/announcements/read'].includes(new URL(route,'http://local').pathname)),'Only deliberate message viewing records reads');
  assert.deepEqual(errors,[]);
  console.log('Professional calendar entries and original Messages passed on phone/desktop, with names, labelled clocks, unchanged originals and normal read tracking. Screenshots: '+out);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
