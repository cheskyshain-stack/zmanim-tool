// Exercise real touch/trackpad gestures against delayed, synthetic private events.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const assert = require('node:assert/strict'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist'), endpoint = 'https://month-navigation.example.test';
const output = process.env.CALENDAR_NAV_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-navigation-'));
fs.mkdirSync(output, { recursive:true });
const server = http.createServer((req,res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = process.env.CALENDAR_NAV_ORIGIN || 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({executablePath:process.env.CHROME_BIN || '/usr/bin/chromium',headless:true});
  const errors=[], checks=[], calls=[], finished=[];
  let revision=1, blocked=false, revoked=false, delay=900;
  const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true,serviceWorkers:'block'});
  try {
    await context.addInitScript(() => {
      localStorage.setItem('zmanim-nocount','1');
      sessionStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify({token:'f'.repeat(64),expires:Date.parse('2299-01-01T00:00:00Z'),user:{id:'fixture-reader',role:'viewer',name:'Example reader',active:true}}));
    });
    await context.route('**/data/calendar.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({endpoint})}));
    await context.route(endpoint+'/**',async route=>{
      const request=route.request(), url=new URL(request.url());
      const headers={'Access-Control-Allow-Origin':new URL(origin).origin,'Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(url.pathname==='/api/events'){
        const from=url.searchParams.get('from'),to=url.searchParams.get('to');
        assert((Date.parse(to)-Date.parse(from))/86400000<=62,'Prefetch respects the deployed API range');
        const middle=new Date(Date.parse(from)+20*86400000).toISOString().slice(0,7);
        calls.push({month:middle,from,to});
        if(blocked) return route.fulfill({status:503,headers,contentType:'application/json',body:'{"error":"Synthetic offline response"}'});
        if(revoked) return route.fulfill({status:401,headers,contentType:'application/json',body:'{"error":"Sign in again"}'});
        if(middle!=='2026-11')await new Promise(resolve=>setTimeout(resolve,delay));
        const events=[];
        for(let month=9;month<=12;month++){
          const date='2026-'+String(month).padStart(2,'0')+'-15';
          if(date>=from&&date<=to)events.push({id:'event-'+date,type:'kiddush',title:'Fixture update '+revision,date,endDate:date,allDay:true,createdBy:'fixture-editor',revision});
        }
        await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({events})});finished.push(middle);return;
      }
      const body=url.pathname==='/api/session'?{user:{id:'fixture-reader',role:'viewer',name:'Example reader',active:true}}:{total:0,unread:0,deletedCount:0,editCount:0,messages:[],nextBefore:null};
      return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(body)});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-11-15T17:00:00Z'));
    await page.goto(origin+'/admin/calendar/?preview=congregation');
    await page.locator('[data-cal-day="2026-11-15"]:not([disabled]) .cal-event-total').waitFor();
    console.log(JSON.stringify({stage:'initial',calls,finished}));
    await page.evaluate(()=>{
      window.calendarEmptyFrames=[];
      new MutationObserver(()=>{
        const grid=document.querySelector('.shul-calendar');if(!grid)return;
        const first=grid.querySelector('td:not(.cal-outside) [data-cal-day]');
        const mid=first?.dataset.calDay.slice(0,7)+'-15';
        if(!grid.querySelector('[data-cal-day]:not([disabled])')||!grid.querySelector('[data-cal-day="'+mid+'"] .cal-event-total'))window.calendarEmptyFrames.push(grid.innerText);
      }).observe(document.getElementById('calendar-editor'),{childList:true,subtree:true});
    });
    await page.locator('[data-cal-step="1"]').click();
    assert.match(await page.locator('[data-cal-jump]').innerText(),/November/,'The old month remains visible while prefetch completes');
    await page.locator('[data-cal-day="2026-12-15"]:not([disabled]) .cal-event-total').waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-cal-jump]').textContent.includes('December'));
    assert.equal(calls.length,3,'Current, previous and next month each load once');
    for(let step=0;finished.length<3&&step<50;step++)await page.waitForTimeout(30);
    assert.equal(finished.length,3,JSON.stringify({calls,finished}));
    console.log(JSON.stringify({stage:'prefetched',calls,finished}));
    const cdp=await context.newCDPSession(page);
    const touchTap=async locator=>{
      const b=await locator.boundingBox();
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:1,radiusX:1,radiusY:1,force:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    await touchTap(page.locator('[data-cal-day="2026-12-15"]'));
    await page.locator('.cal-dialog .cal-event-card').waitFor({timeout:3000});await page.keyboard.press('Escape');
    blocked=true;
    const swipe=async(direction,vertical=false)=>{
      const b=await page.locator('.cal-grid-wrap').boundingBox(), y=b.y+b.height*.45;
      const start=direction==='left'?b.x+b.width*.8:b.x+b.width*.2;
      const end=direction==='left'?b.x+b.width*.2:b.x+b.width*.8;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y,id:1}]});
      for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:vertical?start:start+(end-start)*step/6,y:vertical?y-step*15:y,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    };
    const month=()=>page.locator('[data-cal-jump]').innerText();
    await swipe('right');assert.match(await month(),/November/);assert.equal(await page.locator('.cal-dialog').count(),0,'A swipe must not open day details');
    await swipe('right');assert.match(await month(),/October/);
    await swipe('right');assert.match(await month(),/October/,'Readers stop at last month');
    const grid=await page.locator('.cal-grid-wrap').boundingBox();await page.mouse.move(grid.x+grid.width/2,grid.y+grid.height/2);
    await page.mouse.wheel(100,0);await page.waitForFunction(()=>document.querySelector('[data-cal-jump]').textContent.includes('November'));
    await page.mouse.wheel(110,0);assert.match(await month(),/November/,'Trackpad inertia advances only once');
    await page.waitForTimeout(250);await page.mouse.wheel(100,0);await page.waitForFunction(()=>document.querySelector('[data-cal-jump]').textContent.includes('December'));
    await swipe('left');assert.match(await month(),/December/,'Readers stop at next month');
    await swipe('right');assert.match(await month(),/November/);
    await touchTap(page.locator('[data-cal-day="2026-11-15"]'));
    await page.locator('.cal-dialog .cal-event-card').waitFor();await page.keyboard.press('Escape');
    await swipe('right',true);assert.match(await month(),/November/,'Vertical movement does not change months');
    assert.equal(calls.length,3,'Cached arrow and gesture navigation works without a network response');
    assert.deepEqual(await page.evaluate(()=>window.calendarEmptyFrames),[],'No empty or loading calendar is painted');
    checks.push({touch:true,trackpad:true,cachedRequests:3,coldMonthKeepsCurrentVisible:true,inertiaLimited:true,verticalIgnored:true,boundsEnforced:true,noLoadingFrames:true});
    console.log(JSON.stringify({stage:'gestures',checks}));
    blocked=false;revision=2;delay=450;
    await page.evaluate(()=>{
      const now=performance.now.bind(performance);let offset=31000;
      Object.defineProperty(performance,'now',{value:()=>now()+offset});
      window.advanceCalendarCacheClock=()=>{offset+=31000;};
    });
    await page.locator('[data-cal-step="1"]').click();
    assert.match(await month(),/December/,'Stale cached events appear immediately');
    await page.waitForResponse(response=>response.url().includes('/api/events')&&response.ok());
    await page.waitForTimeout(50);
    await page.locator('[data-cal-day="2026-12-15"]').click();
    await page.locator('.cal-dialog').getByText('Fixture update 2',{exact:true}).waitFor();await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(()=>window.calendarEmptyFrames),[],'Background refresh keeps the month populated');
    checks.push({backgroundRefresh:true,updatedEvents:true});
    await page.screenshot({path:path.join(output,'congregation.png'),fullPage:true});
    blocked=true;await page.evaluate(()=>window.advanceCalendarCacheClock());
    await page.locator('[data-cal-step="-1"]').click();
    await page.locator('.cal-reader-status').filter({hasText:'Synthetic offline response'}).waitFor();
    assert.match(await month(),/November/);assert(await page.locator('[data-cal-day="2026-11-15"] .cal-event-total').isVisible());
    assert.deepEqual(await page.evaluate(()=>window.calendarEmptyFrames),[],'A failed background refresh keeps cached events visible');
    checks.push({failedRefreshPreservesCalendar:true});
    blocked=false;revoked=true;await page.evaluate(()=>window.advanceCalendarCacheClock());await page.locator('[data-cal-step="1"]').click();
    await page.getByRole('heading',{name:'Calendar sign in',exact:true}).waitFor();
    await page.waitForTimeout(delay+50);
    assert.equal(await page.locator('[data-cal-day],.cal-event-card').count(),0,'Expired access clears visible cached events');
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('lakewood-commons-calendar-session-v1')),null);
    checks.push({expiredAccessClearsCache:true});
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors,calls},null,2));
    console.log(JSON.stringify({passed:true,checks,errors,output}));
  }finally{await context.close();await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
