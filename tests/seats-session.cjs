const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-session-'));
let origin,signIns=0,issueTime=Date.parse('2026-10-28T17:00:00Z');const requests=[];
const server=http.createServer(async(req,res)=>{
  const route=req.url.split('?')[0];
  if(route==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({endpoint:origin}));}
  if(route.startsWith('/api/')){
    requests.push({route,method:req.method});res.setHeader('Content-Type','application/json');
    if(route==='/api/session'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
      if(body.pin!=='4444'){res.statusCode=401;return res.end(JSON.stringify({error:'That PIN did not match.'}));}
      const {shulSessionExpiration}=await import('../js/session-expiration.js');
      signIns++;return res.end(JSON.stringify({name:body.name,token:'a'.repeat(64),expires:shulSessionExpiration(issueTime)}));
    }
    if(route==='/api/plans')return res.end('{"plans":[]}');
    if(route==='/api/name-lists')return res.end('{"files":[]}');
    if(route==='/api/info')return res.end('{"chartDates":true,"changeHistory":true,"sharedNameFiles":true,"deleteFiles":true}');
    res.statusCode=404;return res.end('{}');
  }
  let file=path.resolve(root,'.'+decodeURIComponent(route));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Jerusalem'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await context.routeWebSocket('**/api/live',socket=>socket.onMessage(message=>{if(JSON.parse(message).type==='ping')socket.send('{"type":"pong"}');}));
    await page.clock.install({time:new Date(issueTime)});await page.goto(origin+'/seats/');
    await page.locator('#seats-name').fill('Synthetic Session Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
    await page.getByRole('button',{name:'Create new chart',exact:true}).waitFor();assert.equal(signIns,1);
    await page.getByRole('button',{name:'Create new chart',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);await page.getByRole('button',{name:'Add names',exact:true}).click();await page.getByRole('heading',{name:'Name files',exact:true}).waitFor();
    assert.equal(await page.locator('#sharing-name,#sharing-pin').count(),0);await page.getByRole('button',{name:'Close',exact:true}).click();
    const title=await page.locator('#chart-name').inputValue();assert.match(title,/ at \d{1,2}:\d{2} [AP]M/);
    await page.reload();await page.locator('#chart-name').waitFor();assert.equal(await page.locator('#chart-name').inputValue(),title);
    assert.equal(await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1')),null,'A refreshed empty draft stays out of Saved charts');
    const assignedSeat=page.locator('.room-stage [data-table=A1][data-seat="0"]');
    await assignedSeat.click();await page.locator('#seat-name-input').fill('Synthetic Preserved Person');await page.locator('#seat-name-input').press('Enter');
    const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')));
    await page.reload();await page.locator('#chart-name').waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).activeId),before.activeId);
    assert.match(await assignedSeat.locator('.seat-name').textContent(),/Synthetic/);
    for(const [table,index] of [['B7',1],['C7',3]]){
      assert.equal(await page.locator('.room-stage [data-table='+table+'][data-seat="'+index+'"] .chair-marker').count(),0);
      const geometry=await page.locator('.room-stage').evaluate((stage,{table,index})=>{
        const pillar=stage.querySelector('[data-item="seat-pillar-'+table+'-'+(index+1)+'"] rect').getBoundingClientRect(),seat=stage.querySelector('[data-table='+table+'][data-seat="'+index+'"] .seat-area').getBoundingClientRect();
        return {center:Math.abs(pillar.x+pillar.width/2-seat.x-seat.width/2),gap:pillar.top-seat.bottom};
      },{table,index});assert.ok(geometry.center<.01);assert.ok(geometry.gap>0);
    }
    await page.getByRole('button',{name:'Saved charts',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'Add names',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();assert.equal(signIns,1);
    const deadline=Date.parse('2026-11-05T08:00:00Z');
    await page.clock.fastForward(7*24*60*60*1000);await page.reload();await page.locator('#chart-name').waitFor();
    assert.equal(signIns,1,'Seven days of inactivity and a reload keep the session until the overnight deadline');
    await page.clock.fastForward(deadline-(await page.evaluate(()=>Date.now()))-5000);
    await page.locator('#people-search').click();
    assert.equal(await page.locator('#seats-unlock').count(),0,'Seats stays open shortly before 3 a.m. New York time');
    await page.clock.fastForward(5500);await page.locator('#seats-unlock').waitFor();
    assert.equal(signIns,1);assert.ok(await page.locator('#seats-name').isVisible());
    for(const width of [375,393]){
      await page.setViewportSize({width,height:852});
      const fit=await page.locator('#seats-unlock').evaluate(form=>{const rect=form.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth;});
      assert(fit,'The expired sign-in fits at '+width+'px');
    }
    await page.screenshot({path:path.join(output,'overnight-sign-in.png'),fullPage:true});
    issueTime=await page.evaluate(()=>Date.now());
    await page.locator('#seats-name').fill('Synthetic Session Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.locator('#chart-name').waitFor();
    assert.equal(signIns,2);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).activeId),before.activeId);
    await page.getByRole('button',{name:'Saved charts',exact:true}).click();await page.getByRole('button',{name:'Log out',exact:true}).click();await page.locator('#seats-unlock').waitFor();
    await page.reload();await page.locator('#seats-unlock').waitFor();assert.equal(signIns,2,'Sign out remains signed out after reload');
    assert.equal(requests.filter(request=>['POST','DELETE'].includes(request.method)&&request.route!=='/api/session').length,0);assert.deepEqual(errors,[]);
    console.log('PASS: one login opens charts and name files, reload restores the chart, a week of inactivity keeps Seats signed in until 3 a.m. New York time, and sign-out persists.');console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
