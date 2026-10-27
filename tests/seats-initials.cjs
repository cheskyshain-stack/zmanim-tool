const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-initials-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspectPdf=String.raw`
import sys,re,fitz
doc=fitz.open(sys.argv[1]);assert len(doc)==1, 'The chart must fit on one page'
page=doc[0];text=page.get_text()
assert 'Cohen' in text
if sys.argv[2]=='short':
 assert re.search(r'Y\s+C\s+Cohen',text), text
 assert 'Yosef' not in text and 'Chuam' not in text
else:
 assert 'Yosef' in text and 'Chuam' in text
for block in page.get_text('dict')['blocks']:
 for line in block.get('lines',[]):
  for span in line['spans']:
   r=fitz.Rect(span['bbox']);assert r.x0>=0 and r.y0>=0 and r.x1<=page.rect.width+.1 and r.y1<=page.rect.height+.1, 'Printed text is clipped'
print('PASS PDF:',sys.argv[2],round(page.rect.width),round(page.rect.height))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreateState,seatsWriteName}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];plan.name='Synthetic initials chart';plan.paper='letter';
  const cases=[['A1',0,'Yosef Chuam Cohen','Y C Cohen'],['A1',1,'Alexander Theodore Levi','A T Levi'],['A1',2,'Christopher Alexander Stone','C A Stone'],['A1',3,'Amrom Yitzchok Friedman','A Y Friedman'],['A1',4,'הרב משה דוד כהן','מ ד כהן'],['B1',0,'Sarah van der Meer','S van der Meer'],['B1',1,'Rabbi Chaim Dovid Brown Jr.','C D Brown Jr.'],['rav-seat',0,'Rav Chaim Dovid Stern','C D Stern']];
  for(const [table,index,name]of cases)seatsWriteName(plan,table,index,name);
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{
    for(const width of [375,1440]){
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],writes=[],patches=[];
      await context.addInitScript(sample=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));},sample);
      if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});
      page.on('websocket',s=>s.on('framesent',e=>{try{if(JSON.parse(e.payload).type==='patch')patches.push('patch');}catch{}}));
      const response=await page.goto(origin+'/seats/?count=off');
      if(remote){const html=await response.text(),local=fs.readFileSync(path.join(root,'seats/index.html'),'utf8'),pattern=/\.\.\/js\/seats-app\.js\?v=[0-9a-f]+/;assert.equal(html.match(pattern)[0],local.match(pattern)[0]);}
      await page.locator('#seats-name').fill('Synthetic Initials Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
      const toggle=page.getByRole('switch',{name:'Initials + last name',exact:true}),raw=()=>page.evaluate(key=>localStorage.getItem(key),key);
      const label=async(table,index,scope='.room-stage')=>page.locator(scope+' [data-table="'+table+'"][data-seat="'+index+'"] .seat-name').evaluate(node=>[...node.querySelectorAll('tspan')].map(line=>line.textContent).join(' '));
      assert.equal(await toggle.isChecked(),false);assert.equal(await label('A1',0),'Yosef Chuam Cohen');const before=await raw();
      await page.locator('#show-assigned').check();await toggle.scrollIntoViewIfNeeded();const top=(await toggle.boundingBox()).y;
      await toggle.check();assert.ok(Math.abs((await toggle.boundingBox()).y-top)<1,'Switching must preserve the control position');
      for(const [table,index,name,short]of cases){assert.equal(await label(table,index),short);assert.match(await page.locator('.room-stage [data-table="'+table+'"][data-seat="'+index+'"]').getAttribute('aria-label'),new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}
      assert.ok((await page.locator('#people-list').textContent()).includes('Yosef Chuam Cohen'));assert.equal(await raw(),before,'Short names are a display choice, with no chart data changes');
      await page.locator('.room-stage [data-table=A1][data-seat="0"]').click();assert.equal(await page.locator('#seat-name-input').inputValue(),'Yosef Chuam Cohen');await page.locator('#seat-name-input').press('Escape');
      await page.reload();await page.locator('.room-stage').waitFor();assert.ok(await toggle.isChecked());assert.equal(await label('A1',0),'Y C Cohen');
      await page.screenshot({path:path.join(output,'short-names-'+width+'.png'),fullPage:true});
      await page.locator('#people-extra-tools').evaluate(node=>{node.open=true;});await page.locator('#plan-files').evaluate(node=>{node.open=true;});
      const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download seating list',exact:true}).click();const file=await download;const csv=path.join(output,'names-'+width+'.csv');await file.saveAs(csv);assert.ok(fs.readFileSync(csv,'utf8').includes('Yosef Chuam Cohen'));
      for(const paper of ['letter','tabloid']){
        await page.locator('#paper-size').selectOption(paper);const pdf=path.join(output,'short-'+width+'-'+paper+'.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
        console.log(execFileSync('python',['-c',inspectPdf,pdf,'short'],{encoding:'utf8'}).trim());
      }
      const afterPaper=await raw();await toggle.uncheck();assert.equal(await raw(),afterPaper);assert.equal(await label('A1',0),'Yosef Chuam Cohen');
      await page.locator('#paper-size').selectOption('letter');const pdf=path.join(output,'full-'+width+'-letter.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});console.log(execFileSync('python',['-c',inspectPdf,pdf,'full'],{encoding:'utf8'}).trim());
      const saved=JSON.parse(await raw()).plans.find(p=>p.id===plan.id);assert.deepEqual(saved.people,plan.people);assert.deepEqual(saved.tables,plan.tables);
      await page.locator('[data-action=home]').click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();const beforeDraft=await raw();await toggle.check();assert.equal(await raw(),beforeDraft,'Changing display on an empty draft never saves another chart');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
    }
    console.log('PASS: given-name initials on screen and native PDFs, full editor/list/export names, unchanged chart data, remembered preference, scroll stability and no empty saved copies.');console.log('Artifacts: '+output);
  }finally{await browser.close();if(!remote)server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
