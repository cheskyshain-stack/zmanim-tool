const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-chart-names-')),key='lakewood-commons-seats-v1';
const recordsKey='lakewood-commons-seats-records-v1',today='Seating plan - Oct 26, 2026',earlier='Seating plan - Jan 2, 2026';
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
    const {seatsCreateState,seatsCreatePlan,seatsAddNames}=await import('../js/seats/model.js'),sample=seatsCreateState(),legacy=sample.plans[0];
    legacy.name='7:30 מנין';
    const sameDay=seatsCreatePlan('7:30 minyan'),custom=seatsCreatePlan('Yomim Noraim Family Section');sample.plans.push(sameDay,custom);
    seatsAddNames(legacy,['Synthetic Legacy Title Person']);seatsAddNames(sameDay,['Synthetic Same Day Title Person']);
    const metadata={createdAt:'2025-12-01T17:00:00Z',createdBy:'Example organizer',updatedAt:'2026-01-03T03:00:00Z',updatedBy:'Example organizer',history:[]};
    const records={version:1,records:Object.fromEntries(sample.plans.map(plan=>[plan.id,{...metadata}]))};
    for(const width of [1440,375]){
      const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===375,hasTouch:width===375}),page=await context.newPage(),errors=[];
      await context.addInitScript(({key,recordsKey,sample,records})=>{
        const OriginalDate=Date,fixed=Date.parse('2026-10-26T14:00:00Z');
        window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
        if(!localStorage.getItem(key)){localStorage.setItem(key,JSON.stringify(sample));localStorage.setItem(recordsKey,JSON.stringify(records));}
      },{key,recordsKey,sample,records});
      page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/seats/');
      await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      const openFolder=async()=>{await page.getByRole('button',{name:/^(View saved charts|Saved charts)$/}).click();};
      const openChart=async id=>{await openFolder();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+id+'"]').click();};
      const saved=async()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
      await openFolder();
      assert.equal(await page.locator('.sharing-local-plan .saved-page-card[data-id="'+legacy.id+'"] strong').textContent(),earlier);
      assert.equal(await page.locator('.sharing-local-plan .saved-page-card[data-id="'+sameDay.id+'"] strong').textContent(),earlier,'Legacy date labels stay deterministic across devices');
      assert.equal(await page.locator('.sharing-local-plan .saved-page-card[data-id="'+custom.id+'"] strong').textContent(),custom.name);
      await page.screenshot({path:path.join(output,'dated-folder-'+width+'.png'),fullPage:true});
      await page.locator('.sharing-local-plan .saved-page-card[data-id="'+legacy.id+'"]').click();assert.equal(await page.locator('#chart-name').inputValue(),earlier);
      await page.reload();await openChart(legacy.id);assert.equal(await page.locator('#chart-name').inputValue(),earlier,'The automatic title remains stable on reload after its rename was recorded');
      await page.locator('#chart-name').fill('Custom seating chart');await page.locator('#chart-name').press('Enter');
      await page.reload();await openChart(legacy.id);assert.equal(await page.locator('#chart-name').inputValue(),'Custom seating chart');
      assert.equal((await saved()).plans.find(plan=>plan.id===custom.id).name,custom.name,'Unrelated custom chart titles remain intact');
      await page.locator('#chart-more summary').click();await page.getByRole('button',{name:'Use today’s date',exact:true}).click();
      assert.equal(await page.locator('#chart-name').inputValue(),today);assert.equal(await page.locator('#seats-print h1').textContent(),'7:30 Minyan');
      const selectedTitle=await page.locator('#chart-name').evaluate(input=>({focused:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd,length:input.value.length}));
      assert.equal(selectedTitle.focused,true);assert.equal(selectedTitle.start,0);assert.equal(selectedTitle.end,selectedTitle.length,'Using today selects the title for an optional custom edit');
      for(const paper of ['letter','tabloid']){
        await page.locator('#paper-size').selectOption(paper);await page.emulateMedia({media:'print'});
        const file=path.join(output,'dated-title-'+width+'-'+paper+'.pdf');await page.pdf({path:file,preferCSSPageSize:true,printBackground:true});
        const info=execFileSync('pdfinfo',[file],{encoding:'utf8'}),text=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'}).replace(/\s+/g,' ');
        assert.match(info,/Pages:\s+1\b/);assert.match(text,/7:30\s+MINYAN/i);assert.ok(!text.includes(today),'The saved chart title stays out of the '+paper+' printout');await page.emulateMedia({media:'screen'});
      }
      const create=async name=>{
        await page.locator('[data-action=home]').click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();
        await page.locator('.room-stage [data-table=A1][data-seat="0"]').click();await page.locator('#seat-name-input').fill(name);await page.locator('#seat-name-input').press('Enter');
      };
      await create('Synthetic Dated Chart Person Two');assert.equal(await page.locator('#chart-name').inputValue(),today+' (2)');
      await create('Synthetic Dated Chart Person Three');assert.equal(await page.locator('#chart-name').inputValue(),today+' (3)');
      const titleFit=await page.locator('#chart-name').evaluate(input=>{const style=getComputedStyle(input),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.font;return {text:context.measureText(input.value).width,available:input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};});
      assert.ok(titleFit.text<=titleFit.available+1,'The full dated title and suffix fit the chart-name field: '+JSON.stringify({width,...titleFit}));
      const titles=(await saved()).plans.map(plan=>plan.name);assert.ok(titles.includes(today));assert.ok(titles.includes(today+' (2)'));assert.ok(titles.includes(today+' (3)'));
      await page.reload();await openFolder();
      assert.ok((await page.locator('.sharing-local-plan strong').allTextContents()).includes(today+' (3)'));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await context.close();
    }
    console.log('PASS: chart names use New York dates, legacy metadata names stay stable, custom names persist, chart actions open directly, today action and same-day suffixes work, and Letter/Tabloid PDFs use the minyan wordmark on phone/desktop.');
    console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
