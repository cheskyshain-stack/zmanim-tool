// Browser-only preview, synthetic account and messages; no live calendar writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),writes=[],errors=[];
let origin;
const storedEvents=[{id:'saved-wedding',type:'wedding',title:'Evening wedding',time:'19:30'},{id:'saved-bris-later',type:'custom',customCategory:'Bris',title:'Later bris',time:'08:00'},{id:'saved-bris-first',type:'custom',customCategory:'Bris',title:'First bris',time:'07:10'}].map(e=>({date:'2026-11-12',endDate:'2026-11-12',allDay:false,visibility:'everyone',revision:1,...e}));
storedEvents.push({id:'excluded-lechaim',type:'custom',customCategory:'Lechaim',title:'Excluded Lechaim',date:'2026-11-15',endDate:'2026-11-15',allDay:true,visibility:'everyone',revision:1});
const user={id:'synthetic-owner-123',name:'Synthetic owner',role:'viewer',email:'owner@example.test'};
const messages=[{id:'synthetic-preview-123',text:'Shalom Zachor for the Example family on 2026-11-27 at 9pm',createdAt:'2026-11-20T18:00:00.000Z',revision:1,sequence:1},{id:'synthetic-unclear-123',text:'Bris for Example, details to follow',createdAt:'2026-11-20T18:00:00.000Z',revision:1,sequence:2}];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(url.pathname==='/data/calendar.json')return json({endpoint:origin});
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET'){writes.push(req.url);return res.writeHead(405).end();}
  if(url.pathname==='/api/session')return json({user,eventAudienceDetails:true});
  if(url.pathname==='/api/events')return json({events:storedEvents});
  if(url.pathname==='/api/announcements')return json({messages,nextCursor:null,total:2,unread:2,canPost:true});
  if(url.pathname==='/api/announcements/status')return json({total:2,unread:2,canPost:true,canEdit:true,canDelete:true,editCount:0,deletedCount:0});
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
   assert.equal(await dialog.getByText(messages[0].text,{exact:true}).count(),1);
   await page.evaluate(()=>document.fonts.ready);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');
   await page.screenshot({path:path.join(out,'event-'+width+'.png')});
   await dialog.locator('[data-cal-close]').click();
   assert.equal(await page.locator('[data-cal-simcha-preview]').count(),0,'No preview toggle');
   await page.reload();
   await page.locator('[data-cal-day="2026-11-27"]').filter({hasText:'Example family'}).waitFor();
   await page.close();
  }
  assert.deepEqual(writes,[],'Preview must never save events or mark messages read');assert.deepEqual(errors,[]);
  console.log('Official message calendar passed on phone and desktop: events appear by default, survive reload, chronological order, same-day month navigation, excluded Lechaim, safe layout and zero calendar writes. Screenshots: '+out);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
