const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-open-'));
const server=http.createServer((req,res)=>{
 const pathname=req.url.split('?')[0];if(pathname==='/data/seats-sync.json'){res.setHeader('content-type','application/json');return res.end('{"endpoint":""}');}
 let file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspect=String.raw`
import fitz,sys,json,re
d=fitz.open(sys.argv[1]);assert len(d)==1,'The chart must stay on one page'
p=d[0];words=p.get_text('words');text=' '.join(p.get_text().split());opened=sys.argv[2]=='1'
assert ('Open' in text)==opened,'The PDF must follow the Open seats toggle'
assert 'Rav' in text and 'Original Rav Person' not in text,'The Rav keeps its fixed label'
assert not any(re.fullmatch(r'[1-9]\d*',word[4]) for word in words),'Seat numbers must not appear in the PDF'
assert ('Assigned Person' in text)==(sys.argv[3]!='reserved')
for block in p.get_text('dict')['blocks']:
 for line in block.get('lines',[]):
  for span in line['spans']:
   r=fitz.Rect(span['bbox']);assert r.x0>=0 and r.y0>=0 and r.x1<=p.rect.width+.1 and r.y1<=p.rect.height+.1,('Clipped label',span['text'],r)
if sys.argv[1].endswith('-CMYK.pdf'):assert all(image[5]=='DeviceCMYK' for image in p.get_images(full=True))
p.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(sys.argv[1]+'.png')
print(json.dumps({'pages':1,'Open':opened,'fixedRav':True,'seatNumbers':False}))
`;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const {seatsCreatePlan,seatsWriteName,seatsSeatBlocked}=await import('../js/seats/model.js');
 const plan=seatsCreatePlan('Open seats QA'),other=seatsCreatePlan('Independent QA');plan.paper='letter';seatsWriteName(plan,'A1',0,'Assigned Person');seatsWriteName(plan,'rav-seat',0,'Original Rav Person');plan.objects.find(o=>o.type==='rav').label='Old custom label';
 const seed={version:1,activeId:plan.id,plans:[plan,other]},expectedOpen=plan.tables.reduce((n,t)=>n+t.seats.filter((id,i)=>!id&&!seatsSeatBlocked(plan,t.id,i)).length,0);
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(seed=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(seed));const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/pdf')window.testOpenPdf=blob;return create.call(this,blob);};},seed);
  await page.goto(origin+'/seats/');await page.locator('#seats-name').fill('Synthetic Open Reviewer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
  const toggle=page.getByRole('switch',{name:'Show Open on empty seats',exact:true});
  const raw=()=>page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1'));
  const labels=async enabled=>{for(const scope of ['.room-stage','#seats-print']){
   const texts=await page.locator(scope+' .empty-seat').allTextContents();assert.equal(texts.length,enabled?expectedOpen:0);assert.ok(texts.every(value=>value==='Open'));
   assert.equal(await page.locator(scope+' .blocked-seat .empty-seat').count(),0);assert.equal(await page.locator(scope+' .rav-label').textContent(),'Rav');assert.equal(await page.locator(scope+' .rav-seat[data-seat]').count(),0);
  }};
  assert.equal(await toggle.isChecked(),false);await labels(false);const before=await raw();
  await page.locator('.room-stage .rav-seat .seat-area').click();assert.equal(await page.locator('.seat-editor:not([hidden])').count(),0);assert.ok(await page.locator('#item-label').isDisabled());assert.equal(await raw(),before);
  await toggle.scrollIntoViewIfNeeded();const top=(await toggle.boundingBox()).y;await toggle.check();assert.ok(Math.abs((await toggle.boundingBox()).y-top)<1);assert.equal(await page.evaluate(()=>document.activeElement.id),'open-seats');await labels(true);assert.equal(await raw(),before,'Showing Open must not save or change chart data');
  await page.locator('#seat-A1-1').click();assert.equal(await page.locator('#seat-name-input').inputValue(),'');await page.locator('#seat-name-input').press('Escape');
  const last=plan.tables.at(-1);await page.locator('#seat-'+last.id+'-'+(last.count-1)).click();await page.locator('#seat-name-input').press('Tab');assert.match(await page.locator('.seat-editor-heading h2').textContent(),/^A1/,'Tab wraps past the fixed Rav');await page.locator('#seat-name-input').press('Escape');
  for(const designed of [false,true]){await page.locator('#room-design').setChecked(designed);await labels(true);for(const color of ['mono','color']){await page.locator('#print-color').selectOption(color);await labels(true);}}
  await page.locator('#short-names').check();await page.locator('#reserved-print').check();await labels(true);assert.equal(await page.locator('#seat-A1-0 .seat-name').textContent(),'Reserved');await page.locator('#reserved-print').uncheck();await page.locator('#short-names').uncheck();
  await page.locator('#print-color').selectOption(width===375?'mono':'color');
  const originalPdf=path.join(output,width+'-open-native.pdf');await page.pdf({path:originalPdf,preferCSSPageSize:true,printBackground:true});console.log(execFileSync('python',['-c',inspect,originalPdf,'1','names'],{encoding:'utf8'}).trim());
  await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.waitForFunction(()=>window.testOpenPdf,null,{timeout:120000});const data=await page.evaluate(async()=>{const bytes=new Uint8Array(await window.testOpenPdf.arrayBuffer());let result='';for(let i=0;i<bytes.length;i+=16384)result+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(result);});const cmyk=path.join(output,width+'-open-CMYK.pdf');fs.writeFileSync(cmyk,Buffer.from(data,'base64'));console.log(execFileSync('python',['-c',inspect,cmyk,'1','names'],{encoding:'utf8'}).trim());for(const tab of context.pages())if(tab!==page)await tab.close();
  await page.reload();await page.locator('.room-stage').waitFor();assert.equal(await toggle.isChecked(),true);await labels(true);
  const open=async id=>{await page.getByRole('button',{name:'Saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+id+'"]').click();};
  await open(other.id);assert.equal(await toggle.isChecked(),false);await open(plan.id);assert.equal(await toggle.isChecked(),true);
  const current=await raw();await toggle.uncheck();await labels(false);assert.equal(await raw(),current);const blank=path.join(output,width+'-blank-native.pdf');await page.pdf({path:blank,preferCSSPageSize:true,printBackground:true});execFileSync('python',['-c',inspect,blank,'0','names'],{encoding:'utf8'});
  const stored=JSON.parse(await raw()),active=stored.plans.find(p=>p.id===plan.id);assert.deepEqual(active.people,plan.people);assert.deepEqual(active.tables,plan.tables);assert.deepEqual(active.objects,plan.objects);assert.deepEqual(stored.plans.find(p=>p.id===other.id),other);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await toggle.check();await page.screenshot({path:path.join(output,width+'-editor.png'),fullPage:true});await context.close();
 }}finally{await browser.close();server.close();}
 console.log('PASS: seat numbers removed, per-chart Open labels, fixed Rav, usable blank seats, Tab navigation, native/CMYK printing, both designs/colors, phone/desktop and unchanged assignments.');console.log('Artifacts: '+output);
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
