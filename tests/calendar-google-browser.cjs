// Browser-only preview, synthetic account and messages; no live calendar writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),writes=[],errors=[];
let origin,googleState;
const resetGoogle=()=>googleState={available:true,connected:true,enabled:true,disconnecting:false,reminders:0,name:'Lakewood Commons',lastSyncedAt:null,error:''};
const user={id:'synthetic-owner-123',name:'Synthetic owner',role:'viewer',email:'owner@example.test'};
const messages=[{id:'synthetic-preview-123',text:'Shalom Zachor for the Example family on 2026-11-27 at 9pm',createdAt:'2026-11-20T18:00:00.000Z',revision:1,sequence:1},{id:'synthetic-unclear-123',text:'Bris for Example, details to follow',createdAt:'2026-11-20T18:00:00.000Z',revision:1,sequence:2}];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(url.pathname==='/data/calendar.json')return json({endpoint:origin});
 if(url.pathname.startsWith('/api/')){
  if(url.pathname==='/api/info')return json({googleCalendar:true});
  if(url.pathname==='/api/google-calendar'){
   if(req.method==='GET')return json(googleState);
   writes.push(req.url);let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    const data=JSON.parse(body||'{}');
    if(req.method==='PUT')googleState.reminders=data.reminders;
    if(req.method==='DELETE')googleState={...googleState,connected:false,enabled:false};
    json(googleState);
   });return;
  }
  if(req.method!=='GET'){writes.push(req.url);return res.writeHead(405).end();}
  if(url.pathname==='/api/session')return json({user,eventAudienceDetails:true});
  if(url.pathname==='/api/events')return json({events:[]});
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
 const out=path.resolve(__dirname,'../test-results/google-calendar');fs.mkdirSync(out,{recursive:true});
 try{
  for(const width of [393,1440]){
   const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',e=>errors.push(e.message));
   await page.clock.setFixedTime(new Date('2026-11-21T18:00:00.000Z'));
   await page.addInitScript(user=>{const session={user,token:'a'.repeat(64),expires:Date.now()+86400000};sessionStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify(session));localStorage.setItem('zmanim-nocount','1');},user);
   await page.route('**/*',r=>r.request().url().startsWith(origin+'/')||r.request().url().startsWith('data:')?r.continue():r.abort());
   resetGoogle();
   await page.goto(origin+'/admin/calendar/');
   await page.locator('[data-cal-options]').click();
   await page.getByRole('dialog').getByRole('button',{name:'Google Calendar',exact:true}).click();
   const dialog=page.getByRole('dialog');
   await dialog.locator('[data-google-reminders]').waitFor();
   await dialog.locator('[data-google-reminders]').selectOption('30');
   await dialog.getByRole('button',{name:'Save reminders',exact:true}).click();
   await dialog.getByText('Reminder preference saved.',{exact:true}).waitFor();
   assert.equal(googleState.reminders,30);
   await page.evaluate(()=>document.fonts.ready);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow');
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'Dialog fits viewport');
   await page.screenshot({path:path.join(out,'connected-'+width+'.png')});
   page.once('dialog',d=>d.accept());
   await dialog.getByRole('button',{name:'Turn off and remove shul calendar',exact:true}).click();
   await dialog.getByRole('button',{name:'Connect Google Calendar',exact:true}).waitFor();
   assert.equal(googleState.enabled,false);
   await dialog.locator('[data-cal-close]').click();
   await page.close();
  }
  assert.equal(writes.length,4);assert.ok(writes.every(path=>path==='/api/google-calendar'),'No event or message writes');assert.deepEqual(errors,[]);
  console.log('Google controls passed on phone and desktop: reader access, separate reminder preference, confirmed disconnect, reconnect button and safe layout. Screenshots: '+out);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
