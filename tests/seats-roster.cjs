const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-roster-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspectPdf=String.raw`
import sys,json,collections,re,fitz
doc=fitz.open(sys.argv[1]);names=json.loads(sys.argv[2]);counts=collections.Counter(names)
assert len(doc)==2, ('The unique-name fixture should print on two pages',len(doc))
text=''.join(''.join(page.get_text().split()) for page in doc)
assert 'ARONKODESH' not in text, 'The room chart must not be printed with the list'
assert 'SyntheticRosterTitle' not in text, 'The saved chart title stays off printed lists'
assert 'Seatednames' not in text and 'Sortedby' not in text, 'The top-right list heading, sort description and count stay off printed lists'
for name,count in counts.items():
 assert text.count(''.join(name.split()))==count, ('Missing or duplicated printed name',name,count)
for page in doc:
 assert abs(page.rect.width-612)<.1 and abs(page.rect.height-792)<.1
 assert all(word in page.get_text() for word in ['Name','Table']), 'Column headers repeat on every page'
 assert not re.search(r'\bSeat\b',page.get_text()), 'Seat numbers are omitted from the roster'
 for block in page.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   for span in line['spans']:
    r=fitz.Rect(span['bbox']);assert r.x0>=35 and r.y0>=30 and r.x1<=577 and r.y1<=763, ('Printed text is clipped',r)
print(json.dumps({'pages':len(doc),'printedNames':len(names),'fullNamesRetained':True,'headersRepeated':True}))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreateState,seatsWriteName,seatsAddNames,seatsSeatBlocked}=await import('../js/seats/model.js'),{seatsParseDelimited}=await import('../js/seats/import.js');
  const sample=seatsCreateState(),plan=sample.plans[0];plan.name='SyntheticRosterTitle'.repeat(4);plan.paper='tabloid';
  const capacity=[...plan.tables,...plan.objects.filter(o=>o.type==='rav')].reduce((sum,t)=>sum+t.count,0);
  let index=0;
  for(const table of [...plan.tables,...plan.objects.filter(o=>o.type==='rav')])for(let seat=0;seat<table.count;seat++){const name='Person '+String(++index).padStart(3,'0')+' Family'+String(capacity+1-index).padStart(3,'0');if(seatsSeatBlocked(plan,table.id,seat)){const person={id:crypto.randomUUID(),name};plan.people.push(person);table.seats[seat]=person.id;}else seatsWriteName(plan,table.id,seat,name,{duplicate:true});}
  const a1=plan.tables.find(t=>t.id==='A1'),first=plan.people.find(p=>p.id===a1.seats[0]);plan.people.find(p=>p.id===a1.seats[1]).name=first.name;plan.people.find(p=>p.id===a1.seats[2]).name=first.name;plan.people.find(p=>p.id===plan.tables.find(t=>t.id==='A2').seats[0]).name=first.name;
  plan.people.find(p=>p.id===a1.seats[3]).name='Z'.repeat(130);plan.tables.find(t=>t.id==='A2').label='Side table';seatsAddNames(plan,['Never Seated Person']);
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{
    for(const width of [375,1440]){
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],writes=[],patches=[];
      await context.addInitScript(sample=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));localStorage.setItem('lakewood-commons-seats-short-names','1');},sample);
      if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
      page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});
      page.on('websocket',s=>s.on('framesent',e=>{try{if(JSON.parse(e.payload).type==='patch')patches.push('patch');}catch{}}));
      const response=await page.goto(origin+'/seats/?count=off');
      if(remote){const html=await response.text(),local=fs.readFileSync(path.join(root,'seats/index.html'),'utf8'),pattern=/\.\.\/js\/seats-app\.js\?v=[0-9a-f]+/;assert.equal(html.match(pattern)[0],local.match(pattern)[0]);}
      await page.locator('#seats-name').fill('Synthetic Roster Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
      await page.locator('.room-stage [data-table=B1][data-seat="0"]').click();await page.locator('#seat-name-input').fill('New Pending Person');
      await page.locator('#chart-more summary').click();await page.getByRole('button',{name:'Alphabetical seat list',exact:true}).click();
      await page.getByRole('heading',{name:'Alphabetical seat list',exact:true}).waitFor();assert.ok((await page.locator('.seats-roster-table tbody').textContent()).includes('New Pending Person'),'Opening the list flushes unfinished seat typing');
      const raw=()=>page.evaluate(key=>localStorage.getItem(key),key),before=await raw();
      const rows=()=>page.locator('.seats-roster-table tbody tr').evaluateAll(rows=>rows.map(row=>[...row.cells].map(cell=>cell.textContent)));
      assert.equal((await rows()).length,capacity-3);assert.equal((await rows()).filter(row=>row[0]===first.name).length,1);assert.deepEqual((await rows()).find(row=>row[0]===first.name),[first.name,'A1, Side table']);assert.deepEqual(await page.locator('.seats-roster-table th').allTextContents(),['Name','Table']);assert.ok((await rows()).every(row=>row.length===2));assert.ok(!(await rows()).some(row=>row[0]==='Never Seated Person'));
      await page.locator('#roster-sort').selectOption('last');assert.deepEqual((await rows())[0],['Person '+String(capacity).padStart(3,'0')+' Family001','Rav']);
      await page.locator('#roster-sort').selectOption('first');assert.equal((await rows())[0][0],'New Pending Person');assert.equal(await raw(),before,'The report and sort controls do not edit the chart');
      await page.screenshot({path:path.join(output,'roster-'+width+'.png')});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The list and long chart titles must fit the viewport');
      const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV',exact:true}).click();const file=await download,csv=path.join(output,'seated-'+width+'.csv');await file.saveAs(csv);
      assert.deepEqual(seatsParseDelimited(fs.readFileSync(csv,'utf8')).slice(1),await rows());
      await page.evaluate(()=>{window.__rosterPrints=0;window.print=()=>window.__rosterPrints++;});await page.getByRole('button',{name:'Print / PDF',exact:true}).click();assert.equal(await page.evaluate(()=>window.__rosterPrints),1,'The list prints even when a chart name is too long to fit');
      for(const order of ['first','last']){
        await page.locator('#roster-sort').selectOption(order);const pdf=path.join(output,'list-'+width+'-'+order+'.pdf'),names=(await rows()).map(row=>row[0]);
        await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});console.log(execFileSync('python',['-c',inspectPdf,pdf,JSON.stringify(names)],{encoding:'utf8'}).trim());
      }
      await page.reload();await page.getByRole('heading',{name:'Alphabetical seat list',exact:true}).waitFor();assert.equal(await page.locator('#roster-sort').inputValue(),'last');assert.equal(await raw(),before);
      await page.getByRole('button',{name:'Back to chart',exact:false}).click();await page.locator('.room-stage').waitFor();assert.ok(await page.getByRole('switch',{name:'Initials + last name',exact:true}).isChecked());assert.match(await page.locator('#seats-page-size').textContent(),/17in 11in/);
      const saved=JSON.parse(await raw());assert.equal(saved.plans.length,1);assert.equal(saved.activeId,plan.id);assert.deepEqual(saved.plans[0].tables,JSON.parse(before).plans[0].tables);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
    }
    if(!remote){
      const context=await browser.newContext(),page=await context.newPage();await page.goto(origin+'/seats/');await page.locator('#seats-name').fill('Empty List Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();
      await page.locator('#chart-more summary').click();await page.getByRole('button',{name:'Alphabetical seat list',exact:true}).click();assert.ok(await page.getByText('No seats assigned yet.',{exact:false}).isVisible());assert.ok(await page.getByRole('button',{name:'Print / PDF',exact:true}).isDisabled());assert.ok(await page.getByRole('button',{name:'Download CSV',exact:true}).isDisabled());assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);await page.reload();await page.getByRole('heading',{name:'Alphabetical seat list',exact:true}).waitFor();assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);await context.close();
    }
    console.log('PASS: seated-only alphabetical rows, full names shown once, combined tables, custom labels, two-column CSV, multi-page native PDFs, repeated headers, refresh, empty drafts and return to the chart.');console.log('Artifacts: '+output);
  }finally{await browser.close();if(!remote)server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
