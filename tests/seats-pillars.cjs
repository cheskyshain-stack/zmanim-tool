const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-pillars-')),remote=process.env.SEATS_CHECK_ORIGIN;
const server=http.createServer((req,res)=>{
 if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
 let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspect=String.raw`
import sys,json,fitz
doc=fitz.open(sys.argv[1]);assert len(doc)==1
p=doc[0];text=''.join(p.get_text().split())
assert text.count('Pillar')==2
for name in ['AnchorPerson','FrontB4Person','FrontC4Person','TabTestPerson']:
 assert name in text, 'An assigned name is missing from the printed chart'
for d in p.get_drawings():
 r=d['rect'];assert r.x0>=0 and r.y0>=0 and r.x1<=p.rect.width+.1 and r.y1<=p.rect.height+.1
print(json.dumps({'pages':1,'namesRetained':True,'blockedLabels':2}))
`;
(async()=>{
 if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
 const {seatsCreateState,seatsFrontPillars,seatsWriteName,seatsAddNames}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];plan.name='Synthetic pillar test';plan.paper='letter';plan.objects.push(...seatsFrontPillars(plan));
 seatsWriteName(plan,'A1',0,'Anchor Person');seatsWriteName(plan,'B4',1,'Front B4 Person');seatsWriteName(plan,'C4',3,'Front C4 Person');seatsAddNames(plan,['Waiting Drag Person']);
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
 try{for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[],writes=[],patches=[];
  await context.addInitScript(sample=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));},sample);
  if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});page.on('websocket',s=>s.on('framesent',e=>{try{if(JSON.parse(e.payload).type==='patch')patches.push('patch');}catch{}}));
  const response=await page.goto(origin+'/seats/?count=off');if(remote){const imports=html=>JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]).imports;assert.equal(imports(await response.text())['/js/seats/model.js'],imports(fs.readFileSync(path.join(root,'seats/index.html'),'utf8'))['/js/seats/model.js']);}
  await page.locator('#seats-name').fill('Synthetic Pillar Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
  const raw=()=>page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1')),seat=(id,index)=>page.locator('.room-stage [data-table="'+id+'"][data-seat="'+index+'"]');
  const before=await raw();assert.equal(await page.locator('.room-stage .blocked-seat').count(),2);assert.match(await page.locator('.canvas-heading p').textContent(),/172 seats/);
  for(const [id,index]of [['B7',1],['C7',3]]){
   const cell=seat(id,index);assert.equal(await cell.getAttribute('aria-disabled'),'true');assert.equal(await cell.getAttribute('tabindex'),'-1');assert.equal(await cell.locator('.chair-marker').count(),0);assert.equal(await cell.locator('.blocked-seat-label').textContent(),'Pillar');
   await cell.click({force:true});assert.ok(await page.locator('.seat-editor').isHidden());
   await cell.dispatchEvent('keydown',{key:'X',bubbles:true});assert.ok(await page.locator('.seat-editor').isHidden());assert.equal(await raw(),before);
  }
  for(const id of ['B4','C4']){
   assert.equal(await page.locator('.room-stage [data-item="'+id+'"] .chair-marker').count(),5);
   assert.equal(await page.locator('.room-stage [data-item="front-pillar-'+id+'"] .square-surface').count(),1);
  }
  await seat('A1',0).click();await page.locator('[data-editor=copy]').click();await page.locator('[data-editor=close]').click();await seat('B7',1).dispatchEvent('keydown',{key:'v',ctrlKey:true,bubbles:true});assert.equal(await raw(),before);
  await page.evaluate(()=>{document.querySelector('#people-extra-tools').open=true;document.querySelector('#seat-list').open=true;});await page.locator('#selected-item').selectOption('B7');
  const disabled=page.locator('#seat-list [data-open-seat="1"]');assert.ok(await disabled.isDisabled());assert.match(await disabled.textContent(),/Pillar/);assert.ok(await page.locator('#seat-list [data-open-seat="2"]').isEnabled());
  await page.evaluate(()=>{document.querySelector('#people-extra-tools').open=false;});
  await seat('B7',0).click();await page.locator('#seat-name-input').fill('Tab Test Person');await page.locator('#seat-name-input').press('Tab');assert.match(await page.locator('.seat-editor h2').textContent(),/B8.*Seat 3/);
  await page.locator('#seat-name-input').press('Shift+Tab');assert.match(await page.locator('.seat-editor h2').textContent(),/B8.*Seat 1/);await page.locator('[data-editor=close]').click();
  const afterTab=await raw();
  if(width===1440){
   await page.locator('#chart-view').selectOption('whole');await page.locator('.person-name').filter({hasText:'Waiting Drag Person'}).dragTo(seat('B7',1),{force:true});assert.equal(await raw(),afterTab,'Dragging to a pillar cannot assign a name');
   await page.locator('#chart-view').selectOption('width');
  }
  for(const paper of ['letter','tabloid']){await page.locator('#paper-size').selectOption(paper);const file=path.join(output,'pillars-'+width+'-'+paper+'.pdf');await page.pdf({path:file,preferCSSPageSize:true,printBackground:true});console.log({width,paper,...JSON.parse(execFileSync('python',['-c',inspect,file],{encoding:'utf8'}))});}
  await page.screenshot({path:path.join(output,'pillars-'+width+'.png'),fullPage:true});await page.reload();await page.locator('.room-stage').waitFor();assert.equal(await page.locator('.room-stage .blocked-seat[aria-disabled=true]').count(),2);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
 }
 // A previously entered name at a pillar must remain available to move or clear.
 const legacy=structuredClone(sample),p=legacy.plans[0],person={id:'synthetic-legacy-pillar',name:'Keep Legacy Name'};p.people.push(person);p.tables.find(t=>t.id==='B7').seats[1]=person.id;
 const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();await context.addInitScript(state=>localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(state)),legacy);
 if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());await page.goto(origin+'/seats/?count=off');await page.locator('#seats-name').fill('Synthetic Legacy Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card').first().click();
 await page.locator('.room-stage [data-table=B7][data-seat="1"]').click();assert.equal(await page.locator('#seat-name-input').inputValue(),person.name);assert.ok(await page.locator('#seat-name-input').evaluate(input=>input.readOnly));await page.locator('[data-editor=copy]').click();assert.ok(await page.locator('[data-editor=paste]').isDisabled());await page.locator('[data-editor=clear]').click();
 assert.ok(await page.locator('.person-name').filter({hasText:person.name}).isVisible());assert.equal(await page.locator('.room-stage [data-table=B7][data-seat="1"]').getAttribute('aria-disabled'),'true');await context.close();
 console.log('PASS: front pillars keep all seats; occupied names survive; blocked seats reject click/type/paste/drag/list; Tab skips them; phone/desktop and four native one-page PDFs.');console.log('Artifacts: '+output);
 }finally{await browser.close();if(!remote)server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
