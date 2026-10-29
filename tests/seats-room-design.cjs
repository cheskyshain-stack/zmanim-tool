const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-room-design-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspectPdf=String.raw`
import sys,re,json,fitz
page=fitz.open(sys.argv[1]);assert len(page)==1, 'Room design must fit on one page'
p=page[0];w,h=(792,612) if sys.argv[2]=='letter' else (1224,792)
assert abs(p.rect.width-w)<.1 and abs(p.rect.height-h)<.1
text=''.join(p.get_text().split())
assert all(name in text for name in ['DesignTest','BookcaseExample','RavTest'])
for drawing in p.get_drawings():
 r=drawing['rect'];assert r.x0>=0 and r.y0>=0 and r.x1<=w+.1 and r.y1<=h+.1, ('Clipped drawing',r)
for block in p.get_text('dict')['blocks']:
 for line in block.get('lines',[]):
  for span in line['spans']:
   r=fitz.Rect(span['bbox']);assert r.x0>=0 and r.y0>=0 and r.x1<=w+.1 and r.y1<=h+.1, ('Clipped name',r)
print(json.dumps({'pages':1,'drawings':len(p.get_drawings()),'paper':sys.argv[2]}))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreateState,seatsWriteName}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];plan.name='Synthetic room design';plan.paper='letter';plan.monochrome=true;
  seatsWriteName(plan,'A1',0,'Design Test');seatsWriteName(plan,'B2',2,'Bookcase Example');seatsWriteName(plan,'rav-seat',0,'Rav Test');
  const cabinets=plan.objects.filter(object=>object.type==='cabinet');
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{for(const width of [375,1440]){
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],writes=[],patches=[];
    await context.addInitScript(sample=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));},sample);
    if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});page.on('websocket',s=>s.on('framesent',e=>{try{if(JSON.parse(e.payload).type==='patch')patches.push('patch');}catch{}}));
    const response=await page.goto(origin+'/seats/?count=off');if(remote){const imports=html=>JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]).imports;assert.equal(imports(await response.text())['/js/seats/room.js'],imports(fs.readFileSync(path.join(root,'seats/index.html'),'utf8'))['/js/seats/room.js']);}
    await page.locator('#seats-name').fill('Synthetic Design Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
    const toggle=page.getByRole('switch',{name:'Room design',exact:true}),raw=()=>page.evaluate(key=>localStorage.getItem(key),key);
    const geometry=()=>page.locator('.room-stage .room-item').evaluateAll(nodes=>nodes.map(node=>[node.getAttribute('data-item'),node.getAttribute('transform'),...node.querySelectorAll(':scope>.table-surface,:scope>.object-surface')].map(value=>typeof value==='string'?value:[value.getAttribute('width'),value.getAttribute('height')])));
    assert.equal(await toggle.isChecked(),false);assert.equal(await page.locator('.cabinet-design').count(),0);const before=await raw(),positions=await geometry(),oldArt=await page.locator('.room-stage .room-object').evaluateAll(nodes=>nodes.map(node=>node.innerHTML));
    const off=path.join(output,'off-'+width+'.pdf');await page.pdf({path:off,preferCSSPageSize:true,printBackground:true});const offInfo=JSON.parse(execFileSync('python',['-c',inspectPdf,off,'letter'],{encoding:'utf8'}));
    await toggle.scrollIntoViewIfNeeded();const top=(await toggle.boundingBox()).y;await toggle.check();assert.equal(await page.evaluate(()=>document.activeElement.id),'room-design');assert.ok(Math.abs((await toggle.boundingBox()).y-top)<1,'The switch stays in place');
    assert.equal(await page.locator('.room-stage .cabinet-design').count(),cabinets.length);assert.equal(await page.locator('#seats-print .cabinet-design').count(),cabinets.length);assert.ok(await page.locator('.room-stage .leaning-book').count()>0);assert.equal(await raw(),before);assert.deepEqual(await geometry(),positions);
    assert.ok(await page.locator('.room-stage .cabinet-design').evaluateAll(groups=>groups.every(group=>{const surface=group.parentElement.querySelector('.object-surface'),width=Number(surface.getAttribute('width')),height=Number(surface.getAttribute('height'));return getComputedStyle(surface).fill==='rgb(255, 255, 255)'&&[...group.querySelectorAll('rect,path')].every(node=>{const b=node.getBBox();return b.x>=1&&b.y>=1&&b.x+b.width<=width-1&&b.y+b.height<=height-1;});})),'Every book and shelf fits inside its existing cabinet');
    await page.screenshot({path:path.join(output,'design-'+width+'.png'),fullPage:true});
    for(const paper of ['auto','letter','tabloid']){await page.locator('#paper-size').selectOption(paper);const pdf=path.join(output,'design-'+width+'-'+paper+'.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});const info=JSON.parse(execFileSync('python',['-c',inspectPdf,pdf,paper==='auto'?'letter':paper],{encoding:'utf8'}));assert.ok(info.drawings>offInfo.drawings+50,'Designed shelves must appear in the native PDF');console.log({width,...info});}
    const afterPaper=await raw();await page.reload();await page.locator('.room-stage').waitFor();assert.ok(await toggle.isChecked());assert.equal(await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-room-design')),'1');assert.equal(await raw(),afterPaper);
    await toggle.uncheck();assert.equal(await page.locator('.cabinet-design').count(),0);assert.deepEqual(await page.locator('.room-stage .room-object').evaluateAll(nodes=>nodes.map(node=>node.innerHTML)),oldArt,'Switching off restores the original room drawing');assert.equal(await raw(),afterPaper);
    await page.locator('[data-action=home]').click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();const saved=await raw();await toggle.check();assert.equal(await raw(),saved,'The switch does not save an empty chart');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
  }
  console.log('PASS: optional bookcase design on phone/desktop and Letter/Tabloid PDFs, contained artwork, stable positions/focus, original drawing restored, persistent preference and unchanged chart data.');console.log('Artifacts: '+output);
  }finally{await browser.close();if(!remote)server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
