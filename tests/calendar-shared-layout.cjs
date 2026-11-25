// Build first. This fixture never connects to a real calendar or changes its data.
// For manual browser checks: CALENDAR_DIST=<build> node tests/calendar-shared-layout.cjs --serve
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(process.env.CALENDAR_DIST || path.join(__dirname, '../dist'));
const accounts = Object.fromEntries(['owner','editor','viewer'].map((role,index) => [role, {
  user:{ id:'fixture-' + role, name:'Example ' + role, email:role + '@example.test', role }, token:String(index + 1).repeat(64),
}]));
const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
const day = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
const events = [
  {id:'editor-public',createdBy:'fixture-editor',details:'Example editor event',adminDetails:'Private editor notes',visibility:'everyone'},
  {id:'owner-public',createdBy:'fixture-owner',details:'Example owner event',adminDetails:'Private owner notes',visibility:'everyone'},
  {id:'admin-only',createdBy:'fixture-owner',details:'Admin-only planning',adminDetails:'Admin-only planning',visibility:'admins'},
].map(event => ({type:'kiddush',title:event.details || event.adminDetails,date:day,endDate:day,allDay:true,revision:1,...event}));
const messages = [{id:'example-message',text:'Example notice\n\nOriginal incoming wording.',createdAt:new Date().toISOString(),revision:1,sequence:1,read:true}];
const writes = []; let origin;
const server = http.createServer(async(req,res) => {
  const url = new URL(req.url,'http://localhost');
  const json = (value,status=200) => {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname === '/data/calendar.json') return json({endpoint:origin});
  if(url.pathname === '/fixture-checks') return json({day,writes});
  if(url.pathname === '/fixture-admin/') {
    // Render the same embedded component inside the real admin shell, with
    // synthetic shared accounts rather than the unrelated device PIN gate.
    const shell=fs.readFileSync(path.join(root,'admin/index.html'),'utf8').replace(/<script type="module" src="[^"\n]*\/app\.js[^"\n]*"><\/script>/,
      `<script type="module">import {loadTables} from '/js/data-loader.js';import {resolveSettings} from '/js/settings.js';import {renderCalendar} from '/js/ui/calendar-view.js';const [tables,response]=await Promise.all([loadTables(),fetch('/data/published.json')]);const config=await response.json();renderCalendar(document.getElementById('main'),resolveSettings(config.settings),tables);</script>`);
    res.setHeader('Content-Type','text/html');return res.end(shell);
  }
  if(url.pathname.startsWith('/api/')) {
    if(url.pathname === '/api/session' && req.method === 'POST') {
      let body='';for await (const chunk of req) body+=chunk;
      const account=accounts[JSON.parse(body).email?.split('@')[0]];
      return account ? json({...account,expires:Date.now()+86400000,eventAudienceDetails:true}) : json({error:'Use owner, editor or viewer@example.test.'},401);
    }
    const account=Object.values(accounts).find(item => req.headers.authorization === 'Bearer ' + item.token);
    if(!account) return json({error:'Sign in to the synthetic fixture.'},401);
    const viewer=account.user.role==='viewer' || url.searchParams.get('view')==='congregation';
    const status={total:1,unread:0,canPost:!viewer,canEdit:!viewer,canDelete:!viewer,dateEditing:!viewer};
    if(req.method !== 'GET') {
      writes.push({role:account.user.role,method:req.method,path:url.pathname});
      if(['/api/announcements/open','/api/announcements/read'].includes(url.pathname)) return json(status);
      if(req.method==='DELETE' && url.pathname==='/api/session') return json({});
      return json({error:'Fixture data is read-only.'},405);
    }
    if(url.pathname==='/api/session') return json({...account,eventAudienceDetails:true});
    if(url.pathname==='/api/events') return json({events:events.filter(item => !viewer || item.visibility!=='admins').map(item => viewer ? {...item,adminDetails:''} : item)});
    if(url.pathname==='/api/announcements') return json({...status,messages,nextCursor:null});
    if(url.pathname==='/api/announcements/status') return json(status);
    if(url.pathname==='/api/access') return json({users:Object.values(accounts).map(item=>item.user)});
    if(url.pathname==='/api/login-history') return json({entries:[]});
    return json({});
  }
  let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)) return res.writeHead(403).end();
  if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file=path.join(file,'index.html');
  if(!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'})[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(Number(process.env.PORT)||0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  if(process.argv.includes('--serve')) {console.log('Synthetic calendar: '+origin+'/calendar/');return;}
  const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:true}), errors=[];
  try {
    for(const role of ['owner','editor','viewer']) {
      const page=await browser.newPage({viewport:{width:393,height:852}});page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/calendar/');await page.getByLabel('Email',{exact:true}).fill(role+'@example.test');
      await page.getByLabel('Password',{exact:true}).fill('Fixture password 2026');await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.locator('.cal-reader-heading').waitFor();
      assert.equal(await page.locator('.cal-admin-heading,.cal-preview-banner,.cal-day-panel,.cal-footer').count(),0);
      assert.equal(await page.getByRole('link',{name:'Scheduled messages',exact:true}).count(),role==='viewer'?0:1);
      for(const [width,height] of [[375,852],[393,852],[1440,900],[844,390],[393,350]]) {
        await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);
        const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,buttons:[...document.querySelectorAll('.cal-reader-actions button,.cal-reader-actions a')].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))}));
        assert(geometry.pageWidth<=width+1 && geometry.pageHeight<=height+1,JSON.stringify({role,geometry}));
        assert(geometry.buttons.every(button=>button.width>=44 && button.height>=44));
      }
      await page.setViewportSize({width:393,height:852});
      await page.getByRole('button',{name:'Calendar options',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Calendar access',exact:true}).count(),role==='owner'?1:0);
      assert.equal(await page.getByRole('button',{name:'Add an event',exact:true}).count(),role==='viewer'?0:1);
      assert.equal(await page.getByRole('combobox',{name:'View calendar as',exact:true}).count(),role==='owner'?1:0);
      await page.getByRole('button',{name:'Close',exact:true}).click();
      await page.locator(`[data-cal-day="${day}"]`).click();await page.getByRole('dialog',{name:'Day details',exact:true}).waitFor();
      assert.equal(await page.locator('.cal-event-card').count(),role==='viewer'?2:3);
      assert.equal(await page.locator('[data-cal-edit]').count(),role==='owner'?3:role==='editor'?1:0);
      assert.equal(await page.locator('.cal-event-card').filter({hasText:'Private editor notes'}).count(),role==='viewer'?0:1);
      await page.getByRole('button',{name:'Close',exact:true}).click();
      await page.locator('[data-cal-announcements]').click();await page.locator('.cal-announcement-feed').waitFor();
      assert.equal(await page.locator('.cal-announcement-compose').isVisible(),role!=='viewer');
      await page.close();
    }
    assert.deepEqual(errors,[]);assert(writes.every(item=>['/api/announcements/open','/api/announcements/read'].includes(item.path)));
    console.log('Shared calendar layout, phone/desktop geometry and role controls passed.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
