const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-print-notes-'));
const server=http.createServer((req,res)=>{
  const pathname=req.url.split('?')[0];if(pathname==='/data/seats-sync.json'){res.setHeader('content-type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspect=String.raw`
import fitz,sys,json
d=fitz.open(sys.argv[1]);assert len(d)==1,'Notes must not add another page'
p=d[0];header=sys.argv[2];footer=sys.argv[3];text=' '.join(p.get_text().split())
assert 'Synthetic Person' in text,'Assigned names must stay searchable'
for value in [header,footer]:
 if value:assert value in text,('Missing note',value)
if not header:assert 'First Draft' not in text and 'Second Draft' not in text
if not footer:assert 'Gabbaim' not in text
for box in p.search_for(header) if header else []:assert box.x0>p.rect.width*.65 and box.y1<65,'Header must use the clear top-right area'
for box in p.search_for(footer) if footer else []:assert box.y0>p.rect.height*.85,'Footer must be below the room'
for block in p.get_text('dict')['blocks']:
 for line in block.get('lines',[]):
  for span in line['spans']:
   r=fitz.Rect(span['bbox']);assert r.x0>=0 and r.y0>=0 and r.x1<=p.rect.width+.1 and r.y1<=p.rect.height+.1,('Clipped text',span['text'],r)
p.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(sys.argv[1]+'.png')
print(json.dumps({'pages':1,'header':header,'footer':footer}))
`;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const {seatsCreatePlan,seatsWriteName}=await import('../js/seats/model.js'),{seatsPrintGeometry}=await import('../js/seats/print.js');
 const plan=seatsCreatePlan('Notes QA'),other=seatsCreatePlan('Independent QA');plan.paper='letter';seatsWriteName(plan,'A1',0,'Synthetic Person');
 const seed={version:1,activeId:plan.id,plans:[plan,other]},browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await context.addInitScript(seed=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(seed));const original=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/pdf')window.testNotesPdf=blob;return original.call(this,blob);};},seed);
  await page.goto(origin+'/seats/');await page.locator('#seats-name').fill('Synthetic Notes Reviewer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
  await page.locator('#chart-print-notes summary').click();assert.equal(await page.locator('#print-header').inputValue(),'First Draft');assert.equal(await page.locator('#print-footer').inputValue(),'Anyone who would like a seat should speak to the Gabbaim.');
  await page.locator('#print-header').fill('Second Draft');await page.locator('#print-header').press('Tab');
  const footer='Please speak to the Gabbaim for a seat.';await page.locator('#print-footer').fill(footer);
  // Clicking Print while the note is focused must export that last edit on the first click.
  await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.waitForFunction(()=>window.testNotesPdf,null,{timeout:120000});
  const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await window.testNotesPdf.arrayBuffer()))),file=path.join(output,width+'-notes-CMYK.pdf');fs.writeFileSync(file,Buffer.from(bytes));console.log(execFileSync('python',['-c',inspect,file,'Second Draft',footer],{encoding:'utf8'}).trim());for(const tab of context.pages())if(tab!==page)await tab.close();
  await page.reload();await page.locator('#chart-name').waitFor();await page.locator('#chart-print-notes summary').click();assert.equal(await page.locator('#print-header').inputValue(),'Second Draft');assert.equal(await page.locator('#print-footer').inputValue(),footer);
  await page.locator('#print-header').fill('Browser Draft');await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));assert.equal(await page.locator('#seats-print .chart-print-header').textContent(),'Browser Draft');await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
  await page.locator('#print-header').fill('');await page.locator('#print-header').press('Tab');await page.locator('#print-footer').fill('');await page.locator('#print-footer').press('Tab');assert.equal(await page.locator('#seats-print footer').count(),0);assert.equal(await page.locator('#seats-print .room-diagram').getAttribute('viewBox'),seatsPrintGeometry('letter').viewBox,'Blank notes must restore the original print geometry');
  const blank=path.join(output,width+'-blank-native.pdf');await page.pdf({path:blank,preferCSSPageSize:true,printBackground:true});console.log(execFileSync('python',['-c',inspect,blank,'',''],{encoding:'utf8'}).trim());
  await page.locator('#print-header').fill('W'.repeat(80));await page.locator('#print-header').press('Tab');await page.locator('#print-footer').fill('Wide footer wording '.repeat(12).trim());await page.locator('#print-footer').press('Tab');const long=path.join(output,width+'-wrapped-native.pdf');await page.pdf({path:long,preferCSSPageSize:true,printBackground:true});execFileSync('python',['-c',inspect,long,'',''],{encoding:'utf8'});
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1'))),active=stored.plans.find(p=>p.id===plan.id);assert.deepEqual(active.tables,plan.tables);assert.deepEqual(active.people,plan.people);assert.deepEqual(active.objects,plan.objects);assert.deepEqual(stored.plans.find(p=>p.id===other.id),other);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,width+'-editor.png'),fullPage:true});await context.close();
 }}finally{await browser.close();server.close();}
 console.log('PASS: editable per-chart notes, immediate print, reload, independent charts, native and CMYK output, blank and wrapped notes, phone/desktop, and unchanged seats.');console.log('Artifacts: '+output);
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
