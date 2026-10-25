// The confirmed Chanukah 5787 morning time must agree in every public and printed view.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=process.env.CHANUKAH_PRINTED_OUTPUT;
const server=http.createServer((req,res)=>{
 let file=path.resolve(root,'.'+req.url.split('?')[0]);
 if(file!==root&&!file.startsWith(root+path.sep))return res.writeHead(403).end();
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=process.env.CHANUKAH_PRINTED_ORIGIN||'http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const checks=[],errors=[];if(output)fs.mkdirSync(output,{recursive:true});
 try{
  for(const width of [375,1440]){
   const context=await browser.newContext({viewport:{width,height:1000}});
   await context.addInitScript(()=>{localStorage.setItem('zmanim-nocount','1');localStorage.setItem('zmanim-admin-unlock',JSON.stringify({at:Date.parse('2026-12-10T11:42:00Z')}));});
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.clock.setFixedTime(new Date('2026-12-10T11:42:00Z'));
   const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
   await page.goto(origin+'/');await page.locator('.luach-next-time').first().waitFor();
   assert.match(await page.locator('.luach-next-time').first().innerText(),/6:43/,'The next-minyan card announces the confirmed time');
   await page.evaluate(async()=>{
    const {loadTables}=await import('/js/data-loader.js');
    const {buildAutomaticCharts}=await import('/js/publish.js');
    const state=buildAutomaticCharts(await(await fetch('/data/published.json')).json(),await loadTables(),new Date());
    localStorage.setItem('zmanim-app-state-v1',JSON.stringify(state));
   });
   await page.goto(origin+'/week/');await page.locator('.reader-time').first().waitFor();
   assert(await page.locator('.reader-time').filter({hasText:'6:43'}).count()>0,'The weekly reader uses the confirmed time');
   await page.goto(origin+'/texts/');await page.locator('.tx-card').first().waitFor();
   const messages=await page.locator('textarea[aria-label*="Rosh Chodesh"]').evaluateAll(nodes=>nodes.map(node=>node.value));
   assert(messages.length>0);assert(messages.every(message=>message.includes('6:43m')&&!message.includes('6:44m')),'Rosh Chodesh text messages agree');
   const weekMessages=await page.locator('textarea[aria-label^="Week"]').evaluateAll(nodes=>nodes.map(node=>node.value));
   assert(weekMessages.some(message=>message.includes('6:43')),'The weekly text message agrees');
   await page.goto(origin+'/chart/');await page.locator('.shacharis-panel').first().waitFor();
   const publicPanel=page.locator('.shacharis-panel .chanukah-highlight').filter({hasText:/ר["״]ח|ראש חודש/});
   // The next chart is posted early, so open navigation and return to the Chanukah page.
   if(!await publicPanel.count()) {
    await page.locator('.pages .page').first().click({clickCount:3});
    await page.locator('.chart-prev').click();await settle();
   }
   assert(await publicPanel.count()>0,'Public chart must include the Rosh Chodesh Chanukah panel');
   assert(await publicPanel.locator('.sh-time').filter({hasText:/^6:43$/}).count()>0,'The public seasonal chart agrees');
   assert((await publicPanel.allInnerTexts()).every(text=>!text.includes('6:44')));
   await page.goto(origin+'/admin/#charts');await page.locator('.pages .page').first().waitFor();
   await page.evaluate(async()=>{
    const {renderSheet}=await import('/js/ui/sheet-view.js');
    const state=JSON.parse(localStorage.getItem('zmanim-app-state-v1'));
    const sheet=state.sheets.find(sheet=>sheet.id==='auto-choref-5787');
    const companion=state.sheets.find(candidate=>candidate.linkedSheetId===sheet.id);
    sheet.pageSizes=[sheet.weeks.length];companion.pageSizes=[companion.weeks.length];
    document.querySelector('#main').classList.add('is-sheet-view');
    renderSheet(document.querySelector('#main'),state,sheet,()=>{});
   });await settle();
   const rcPanel=page.locator('#pages .shacharis-panel .chanukah-highlight').filter({hasText:/ר["״]ח|ראש חודש/});
   assert(await rcPanel.locator('.sh-time').filter({hasText:/^6:43$/}).count()>0);
   assert((await rcPanel.allInnerTexts()).every(text=>!text.includes('6:44')));
   if(output)await page.locator('#pages').screenshot({path:path.join(output,width+'-charts.png')});
   const pdfCheck=async(kind,pages)=>{
    const pdf=await page.pdf({preferCSSPageSize:true,printBackground:true});
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,pages);
    const text=execFileSync('pdftotext',['-layout','-','-'],{input:pdf,encoding:'utf8'}).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'');
    assert.match(text,/6\s*:\s*43/,'Printed '+kind+' includes the confirmed time');
    if(kind==='charts')assert(text.includes('Bais Medrash'));
    if(output)fs.writeFileSync(path.join(output,width+'-'+kind+'.pdf'),pdf);
   };
   await pdfCheck('charts',2);
   for(const [key,kind]of [['chanukah','chanukah'],['roshchodesh10','rosh-chodesh']]){
    await page.goto(origin+'/admin/#posters/'+key);await page.locator('.poster').first().waitFor();await settle();
    const text=(await page.locator('.poster').allInnerTexts()).join('\n');
    assert(text.includes('6:43')&&!text.includes('6:44'),kind+' poster agrees');
    await pdfCheck(kind,1);
    if(output)await page.locator('.poster').first().screenshot({path:path.join(output,width+'-'+kind+'.png')});
   }
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   checks.push({width,nextMinyan:'6:43',messages:messages.length,pdfs:3});await context.close();
  }
  assert.deepEqual(errors,[]);if(output)fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
