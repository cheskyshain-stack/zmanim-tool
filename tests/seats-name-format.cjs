const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-name-format-')),remote=process.env.SEATS_CHECK_ORIGIN;
const server=http.createServer((req,res)=>{
 if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
 let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspect=String.raw`
import sys,fitz,json
doc=fitz.open(sys.argv[1]);assert len(doc)==1
p=doc[0];text=''.join(p.get_text().split());assert 'DavidMcDonald' in text and 'OldMixedName' in text
for block in p.get_text('dict')['blocks']:
 for line in block.get('lines',[]):
  for span in line['spans']:
   r=fitz.Rect(span['bbox']);assert r.x0>=0 and r.y0>=0 and r.x1<=p.rect.width+.1 and r.y1<=p.rect.height+.1
print(json.dumps({'pages':1,'formattedNamesPrinted':True}))
`;
(async()=>{
 if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
 const {seatsCreateState}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];plan.name='Synthetic formatting check';plan.paper='letter';
 const legacy={id:'synthetic-old-name',name:'  old  mixed   name '};plan.people.push(legacy);plan.tables[0].seats[0]=legacy.id;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
 try{for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[],writes=[],patches=[];
  await context.addInitScript(sample=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));},sample);
  if(remote){await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());await context.route('**/data/seats-sync.json',r=>r.fulfill({status:200,contentType:'application/json',body:'{\"endpoint\":\"\"}'}));}
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});page.on('websocket',s=>s.on('framesent',e=>{try{if(JSON.parse(e.payload).type==='patch')patches.push('patch');}catch{}}));
  const response=await page.goto(origin+'/seats/?count=off');if(remote){const imports=html=>JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]).imports;assert.equal(imports(await response.text())['/js/seats/name-format.js'],imports(fs.readFileSync(path.join(root,'seats/index.html'),'utf8'))['/js/seats/name-format.js']);}
  await page.locator('#seats-name').fill('Synthetic Formatting Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
  const read=()=>page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('lakewood-commons-seats-v1'));return state.plans.find(plan=>plan.id===state.activeId);}),seat=(id,index)=>page.locator('.room-stage [data-table="'+id+'"][data-seat="'+index+'"]');
  assert.equal((await read()).people[0].name,legacy.name,'Opening an old chart does not silently rewrite its saved people');
  await seat('A2',0).click();await page.locator('#seat-name-input').fill('  yosef   cohen  ');assert.equal(await page.locator('#seat-name-input').inputValue(),'  yosef   cohen  ','Draft typing stays where the user put it');await page.locator('#seat-name-input').press('Enter');
  let current=await read(),person=current.people.find(person=>person.name==='Yosef Cohen');assert.ok(person);assert.equal(current.tables.find(table=>table.id==='A2').seats[0],person.id);const sameId=person.id;
  await page.locator('#show-assigned').check();page.once('dialog',dialog=>dialog.accept('  david   McDonald  '));await page.getByRole('button',{name:'Edit Yosef Cohen',exact:true}).click();
  current=await read();assert.equal(current.people.find(person=>person.id===sameId).name,'David McDonald');assert.equal(current.tables.find(table=>table.id==='A2').seats[0],sameId);
  await page.locator('#people-extra-tools').evaluate(node=>node.open=true);await page.locator('#manual-names').evaluate(node=>node.open=true);await page.locator('#new-names').fill('  moshe  levi \nMoshe Levi');await page.locator('#manual-names [data-action=add-names]').click();
  assert.equal((await read()).people.filter(person=>person.name==='Moshe Levi').length,1);
  await page.locator('#names-file').setInputFiles({name:'Synthetic formatting.csv',mimeType:'text/csv',buffer:Buffer.from('Name\n  chaim  cohen \nCHAIM COHEN\n דוד  לוי \n')});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')).plans.some(plan=>plan.people.some(person=>person.name==='Chaim Cohen')));
  current=await read();assert.equal(current.people.filter(person=>person.name==='Chaim Cohen').length,1);assert.ok(current.people.some(person=>person.name==='דוד לוי'));assert.equal(current.people.find(person=>person.id===legacy.id).name,legacy.name);
  const queued=await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-name-uploads-v1')||'[]'));assert.deepEqual(queued[0].names,['Chaim Cohen','דוד לוי']);
  await page.locator('#people-extra-tools').evaluate(node=>node.open=false);await seat('B1',1).click();await page.locator('#seat-name-input').fill('old');await page.locator('.seat-suggestions [data-suggest="'+legacy.id+'"]').click();
  current=await read();const duplicateId=current.tables.find(table=>table.id==='B1').seats[1];assert.notEqual(duplicateId,legacy.id);assert.equal(current.people.find(person=>person.id===duplicateId).name,'Old Mixed Name');assert.equal(current.tables[0].seats[0],legacy.id);
  for(const paper of ['letter','tabloid']){await page.locator('#paper-size').selectOption(paper);const pdf=path.join(output,'formatted-'+width+'-'+paper+'.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});console.log({width,paper,...JSON.parse(execFileSync('python',['-c',inspect,pdf],{encoding:'utf8'}))});}
  await page.screenshot({path:path.join(output,'formatting-'+width+'.png'),fullPage:true});await page.reload();await page.locator('.room-stage').waitFor();current=await read();assert.equal(current.people.find(person=>person.id===sameId).name,'David McDonald');assert.equal(current.tables[0].seats[0],legacy.id);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
 }console.log('PASS: typing, editing an assigned name, manual lists, uploads, duplicate detection, legacy copy preservation, reload, and four one-page native PDFs on phone/desktop.');console.log('Artifacts: '+output);
 }finally{await browser.close();if(!remote)server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
