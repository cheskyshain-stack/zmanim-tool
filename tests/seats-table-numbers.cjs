const openPrintOptions=require('./helpers/seats-print-options.cjs');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-table-numbers-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
const server=http.createServer((req,res)=>{
  const url=req.url.split('?')[0];if(url==='/data/seats-sync.json'){res.setHeader('content-type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(url));if(!file.startsWith(root+'/')){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspect=String.raw`
import fitz,sys,json
d=fitz.open(sys.argv[1]);assert len(d)==1
p=d[0];shown=sys.argv[2]=='1';expected=set(json.loads(sys.argv[3]))
words={word[4] for word in p.get_text('words')}
assert expected.intersection(words)==(expected if shown else set()), ('Table label visibility',shown,expected.intersection(words))
text=''.join(p.get_text().split());assert 'AssignedPerson' in text and 'Rav' in text, 'Names and the fixed Rav label stay visible'
if sys.argv[1].endswith('-CMYK.pdf'):assert not p.get_images(), 'Plain charts remain fully vector'
print(json.dumps({'labelsShown':shown,'tableLabels':len(expected.intersection(words)),'paper':list(p.rect)[2:]}))
`;
(async()=>{
  if(!remote)await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreatePlan,seatsWriteName}=await import('../js/seats/model.js');
  const plan=seatsCreatePlan('Table label toggle QA'),other=seatsCreatePlan('Independent table labels');plan.paper='letter';plan.monochrome=false;
  seatsWriteName(plan,'A1',0,'Assigned Person');seatsWriteName(plan,'C2',1,'משה כהן');seatsWriteName(other,'B2',0,'Second Chart Person');
  const seed={version:1,activeId:plan.id,plans:[plan,other]},expected=plan.tables.map(table=>table.label);
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(remote?{proxy:{server:process.env.HTTPS_PROXY||process.env.HTTP_PROXY}}:{})});
  try{for(const width of remote?[1440]:[375,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],writes=[];
    if(remote){await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());await context.route('**/api/**',r=>{const req=r.request();if(!['GET','OPTIONS'].includes(req.method())&&!new URL(req.url()).pathname.endsWith('/api/session')){writes.push(req.url());return r.abort();}return r.continue();});}
    await context.addInitScript(seed=>{
      if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(seed));
      const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/pdf')window.testPdf=blob;return create.call(this,blob);};window.open=()=>null;
      const send=WebSocket.prototype.send;window.testPatches=0;WebSocket.prototype.send=function(value){try{if(JSON.parse(value).type==='patch'){window.testPatches++;return;}}catch{}return send.call(this,value);};
    },seed);
    page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/seats/?count=off&verify='+Date.now());
    if(remote)assert.equal(await page.locator('meta[name=seats-build]').getAttribute('content'),fs.readFileSync(root+'/seats/index.html','utf8').match(/name="seats-build" content="([^"]+)/)[1]);
    await page.locator('#seats-name').fill('Synthetic Table Label Reviewer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
    await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
    const toggle=page.getByRole('switch',{name:'Show table numbers',exact:true}),raw=()=>page.evaluate(key=>localStorage.getItem(key),key);
    const labels=async shown=>{for(const scope of ['.room-stage','#seats-print']){
      const values=await page.locator(scope+' .table-item .table-label').allTextContents();assert.deepEqual(values,shown?expected:[]);
      assert.equal(await page.locator(scope+' .rav-label').textContent(),'Rav');
    }assert.match(await page.locator('#room-item-A1').getAttribute('aria-label'),/Table A1/);assert.match(await page.locator('#seat-A1-0').getAttribute('aria-label'),/A1, seat 1/);};
    assert.equal(await toggle.isChecked(),true);await labels(true);const before=await raw();
    await toggle.scrollIntoViewIfNeeded();const top=(await toggle.boundingBox()).y;await toggle.uncheck();await labels(false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'table-numbers');assert.ok(Math.abs((await toggle.boundingBox()).y-top)<1);assert.equal(await raw(),before,'Only the per-chart display preference changes');
    await page.locator('#seat-A1-0').click();assert.equal(await page.locator('#seat-name-input').inputValue(),'Assigned Person');await page.locator('#seat-name-input').press('Escape');assert.equal(await raw(),before);
    for(const designed of [true,false]){await page.locator('#room-design').setChecked(designed);for(const color of ['mono','color']){await openPrintOptions(page);await page.locator('#print-color').selectOption(color);await labels(false);}}
    for(const shown of [false,true]){
      await toggle.setChecked(shown);await labels(shown);
      for(const paper of ['letter','tabloid']){
        await openPrintOptions(page);await page.locator('#paper-size').selectOption(paper);const file=path.join(output,[width,shown?'shown':'hidden',paper,'native.pdf'].join('-'));
        await page.pdf({path:file,preferCSSPageSize:true,printBackground:true});execFileSync('python',['-c',inspect,file,shown?'1':'0',JSON.stringify(expected)],{encoding:'utf8'});
      }
      if(width===1440){
        await openPrintOptions(page);await page.locator('#paper-size').selectOption('letter');await page.evaluate(()=>window.testPdf=null);const saved=await raw();await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.waitForFunction(()=>window.testPdf,null,{timeout:120000});
        const data=await page.evaluate(async()=>{const bytes=new Uint8Array(await window.testPdf.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary);});const file=path.join(output,(shown?'shown':'hidden')+'-CMYK.pdf');fs.writeFileSync(file,Buffer.from(data,'base64'));console.log(execFileSync('python',['-c',inspect,file,shown?'1':'0',JSON.stringify(expected)],{encoding:'utf8'}).trim());assert.equal(await raw(),saved);
      }
    }
    await toggle.uncheck();await page.reload();await page.locator('.room-stage').waitFor();assert.equal(await toggle.isChecked(),false);await labels(false);
    const open=async id=>{await page.getByRole('button',{name:'Saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+id+'"]').click();};
    await open(other.id);assert.equal(await toggle.isChecked(),true);await open(plan.id);assert.equal(await toggle.isChecked(),false);await labels(false);
    await page.locator('#chart-more summary').click();await page.getByRole('button',{name:'Alphabetical seat list',exact:true}).click();assert.match(await page.locator('.seats-roster-table').textContent(),/A1/);assert.match(await page.locator('.seats-roster-table').textContent(),/C2/);await page.locator('[data-action="back-to-chart"]').click();assert.equal(await toggle.isChecked(),false);await labels(false);
    const stored=JSON.parse(await raw());for(const original of seed.plans){const actual=stored.plans.find(p=>p.id===original.id);for(const field of ['people','tables','objects'])assert.deepEqual(actual[field],original[field]);}
    assert.equal(await page.evaluate(()=>window.testPatches),0);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(output,width+'-hidden.png'),fullPage:true});await context.close();console.log('PASS',width,'per-chart table numbers, focus/scroll, reload, accessible editing, native/CMYK print, roster labels and unchanged assignments.');
  }}finally{await browser.close();server.close();}
  console.log('Artifacts: '+output);
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
