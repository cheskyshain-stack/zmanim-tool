const openPrintOptions=require('./helpers/seats-print-options.cjs');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-pdf-colors-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1',legal=process.env.SEATS_PDF_PAPER==='legal';
const server=http.createServer((req,res)=>{
  const url=req.url.split('?')[0];if(url==='/data/seats-sync.json'){res.setHeader('content-type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(url));if(!file.startsWith(root+'/')){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspect=String.raw`
import fitz,sys,numpy as np,json,re
d=fitz.open(sys.argv[1]);rgb=sys.argv[2]=='RGB';designed=sys.argv[3]=='1';mono=sys.argv[4]=='1';roster=sys.argv[5]=='1'
assert len(d)==1
assert d.metadata['title'].endswith('RGB' if rgb else 'CMYK'), 'Label the format in the PDF viewer as well as its filename'
p=d[0];assert tuple(p.rect[2:])==((612,792) if roster else (1008,612) if sys.argv[6]=='1' else (792,612))
if not roster and sys.argv[6]=='1':
 assert max(w[2] for w in p.get_text('words') if w[4]=='D1')>p.rect.width*.83, 'The chart must fill Legal paper rather than retain a Letter-sized room'
text=''.join(p.get_text().split());assert 'YosefCohen' in text and 'משהכהן' in text
assert all(font[1]=='ttf' for font in p.get_fonts()), 'Embed Hebrew and Latin fonts in both formats'
assert ('DeviceRGB' if rgb else 'DeviceCMYK') in d.xref_get_key(p.xref,'Group')[1]
intent=d.xref_get_key(d.pdf_catalog(),'OutputIntents')[1];assert ('FOGRA39' in intent)==(not rgb)
images=p.get_images(full=True);assert bool(images)==designed, 'Plain charts and rosters stay vector in both formats'
for image in images:
 assert image[5]==('DeviceRGB' if rgb else 'DeviceCMYK')
 assert image[2]<=4096 and image[3]<=1024
 if rgb:
  assert d.xref_get_key(image[0],'Decode')[1]=='null', 'RGB images must not inherit CMYK inversion'
  raw=d.xref_stream(image[0]);assert len(raw)==image[2]*image[3]*3
  if mono:
   a=np.frombuffer(raw,dtype=np.uint8).reshape(-1,3);assert (a[:,0]==a[:,1]).all() and (a[:,1]==a[:,2]).all()
for placement in p.get_image_info():
 box=fitz.Rect(placement['bbox']);assert abs(placement['width']/box.width*72-1200)<.3 and abs(placement['height']/box.height*72-1200)<.3
if rgb:
 for stream in p.get_contents()+[x[0] for x in p.get_xobjects()]:
  data=d.xref_stream(stream) or b'';assert not re.search(rb'(?<!\w)(?:[\d.]+\s+){4}[kK]\b',data), 'RGB vectors must not use CMYK operators'
pix=p.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False);assert min(pix.samples[:3])>245
if designed:
 assert len(p.get_drawings())==20, 'Keep the same vector tile joints in RGB and CMYK'
 m=25.2;sx=(p.rect.width-2*m)/1176;sy=(p.rect.height-2*m-25.2-16)/916
 for label,box in [('floor',(550,600,650,620)),('aron',(590,80,610,100)),('amud',(595,212,605,220)),('bimah',(588,540,612,546))]:
  x0,y0,x1,y1=box;r=fitz.Rect(m+(x0-12)*sx,m+25.2+(y0-50)*sy,m+(x1-12)*sx,m+25.2+(y1-50)*sy)
  crop=p.get_pixmap(matrix=fitz.Matrix(4,4),clip=r,alpha=False);a=np.frombuffer(crop.samples,dtype=np.uint8).reshape(-1,3);light=a@np.array([.2126,.7152,.0722])
  if label=='floor':assert light.mean()>244 and (a.max(1)-a.min(1)).max()<=2
  elif not mono:assert 105<light.mean()<210, (label,'Keep the lighter fixture photographs in both formats')
words=[(w[4],*[round(v,2) for v in w[:4]]) for w in p.get_text('words')]
print(json.dumps({'pages':len(d),'images':len(images),'mode':'RGB' if rgb else 'CMYK','words':words}))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreateState,seatsCreatePlan,seatsWriteName}=await import('../js/seats/model.js'),seed=seatsCreateState(),plan=seed.plans[0];
  plan.name='Synthetic PDF comparison';plan.paper='letter';plan.monochrome=false;seatsWriteName(plan,'A1',0,'Yosef Cohen');seatsWriteName(plan,'C2',2,'משה כהן');
  const other=seatsCreatePlan('Other print preference');seed.plans.push(other);
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(remote?{proxy:{server:process.env.HTTPS_PROXY||process.env.HTTP_PROXY}}:{})});
  try{for(const width of remote?[375]:[375,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],writes=[],cmsRequests=[];
    page.on('pageerror',error=>errors.push(error.message));await context.route('**/data/seats-sync.json',route=>route.fulfill({contentType:'application/json',body:'{"endpoint":""}'}));
    await context.route('**/api/**',route=>{if(!['GET','OPTIONS'].includes(route.request().method())){writes.push(route.request().url());return route.abort();}return route.continue();});
    if(remote)await context.route('**://static.cloudflareinsights.com/**',route=>route.abort());
    let blockCms=true,blockProfile=true;const cmsRoute=route=>{const url=route.request().url();cmsRequests.push(url);return (url.endsWith('.icc')?blockProfile:blockCms)?route.abort():route.continue();};
    await context.route('**/lcms*',cmsRoute);await context.route('**/FOGRA39L_coated.icc',cmsRoute);
    await context.addInitScript(seed=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(seed));const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/pdf')window.testPdf=blob;return create.call(this,blob);};window.open=()=>null;},seed);
    await page.goto(origin+'/seats/?count=off');if(remote)assert.equal(await page.locator('meta[name=seats-build]').getAttribute('content'),fs.readFileSync(root+'/seats/index.html','utf8').match(/name="seats-build" content="([^\"]+)/)[1]);
    await page.locator('#seats-name').fill('Synthetic PDF Reviewer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
    const open=async(id,expand=true)=>{await page.getByRole('button',{name:/^(View saved charts|Saved charts)$/}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+id+'"]').click();if(expand)await openPrintOptions(page);};await open(plan.id,false);assert.equal(await page.locator('#print-options').getAttribute('open'),null);assert.equal(await page.locator('#paper-size').isVisible(),false);assert.equal(await page.locator('#pdf-colors').isVisible(),false);assert.ok(await page.getByRole('button',{name:'Print / PDF',exact:true}).isVisible());assert.equal(await page.locator('#chart-more [data-action=browser-print],#chart-more [data-action=cmyk-pdf]').count(),0);await page.locator('.seats-editor-head').screenshot({path:path.join(output,width+'-closed.png')});await openPrintOptions(page);
    const choice=page.getByRole('combobox',{name:'PDF colors',exact:true}),raw=()=>page.evaluate(key=>localStorage.getItem(key),key);
    if(legal){const before=await raw();await page.locator('#paper-size').selectOption('legal');assert.equal(await raw(),before,'Legal is a device printing choice and never changes shared chart data');assert.match(await page.locator('.print-paper-hint').textContent(),/Legal/);const native=path.join(output,width+'-legal-native.pdf');await page.pdf({path:native,preferCSSPageSize:true,printBackground:true});execFileSync('python',['-c',"import fitz,sys;p=fitz.open(sys.argv[1])[0];assert tuple(p.rect[2:])==(1008,612);assert max(w[2] for w in p.get_text('words') if w[4]=='D1')>p.rect.width*.83",native]);}
    assert.equal(await choice.inputValue(),'cmyk');const original=await raw();await choice.scrollIntoViewIfNeeded();const top=(await choice.boundingBox()).y;await choice.focus();await choice.selectOption('rgb');assert.equal(await page.evaluate(()=>document.activeElement.id),'pdf-colors');assert.ok(Math.abs((await choice.boundingBox()).y-top)<1);assert.equal(await raw(),original);
    const exportPdf=async(mode,designed=false,mono=false,roster=false)=>{
      const before=await raw();await page.evaluate(()=>{window.testPdf=null;});const download=page.waitForEvent('download');await page.getByRole('button',{name:'Print / PDF',exact:true}).click();
      await page.waitForFunction(()=>window.testPdf||document.querySelector('#seats-notice')?.textContent.includes('could not be'),null,{timeout:300000});assert.match(await page.locator('#seats-notice').textContent(),new RegExp(mode+' PDF ready'));
      assert.match((await download).suggestedFilename(),new RegExp('-'+mode+'\\.pdf$'));
      const data=await page.evaluate(async()=>{const a=new Uint8Array(await window.testPdf.arrayBuffer());let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s);});
      const file=path.join(output,[width,mode,designed?'design':'plain',mono?'mono':'color',roster?'roster':'chart'].join('-')+'.pdf');fs.writeFileSync(file,Buffer.from(data,'base64'));
      const report=JSON.parse(execFileSync('python',['-c',inspect,file,mode,designed?'1':'0',mono?'1':'0',roster?'1':'0',legal?'1':'0'],{encoding:'utf8'}));assert.equal(await raw(),before);console.log(path.basename(file),report.mode,report.images,'images');return report;
    };
    await page.locator('#print-options>summary').click();const plainRgb=await exportPdf('RGB');await openPrintOptions(page);assert.deepEqual(cmsRequests,[],'RGB must not fetch the CMYK converter or profile');
    blockCms=false;await choice.selectOption('cmyk');await page.evaluate(()=>{window.testPdf=null;});await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.getByText('The CMYK PDF could not be created.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>window.testPdf),null);assert.equal(await raw(),original);
    blockProfile=false;const plainCmyk=await exportPdf('CMYK');assert.deepEqual(plainRgb.words,plainCmyk.words,'Color spaces must keep the same page layout and text positions');
    if(width===375&&!remote&&!process.env.SEATS_PDF_COLOR_SMOKE){
      await page.locator('#room-design').check();await choice.selectOption('rgb');const rgb=await exportPdf('RGB',true);await choice.selectOption('cmyk');const cmyk=await exportPdf('CMYK',true);assert.deepEqual(rgb.words,cmyk.words);
      await openPrintOptions(page);await page.locator('#print-color').selectOption('mono');await choice.selectOption('rgb');await exportPdf('RGB',true,true);
    }
    await choice.selectOption('rgb');await page.reload();await page.locator('.room-stage').waitFor();assert.equal(await page.locator('#print-options').getAttribute('open'),null);await openPrintOptions(page);assert.equal(await choice.inputValue(),'rgb');if(legal)assert.equal(await page.locator('#paper-size').inputValue(),'legal');await open(other.id);assert.equal(await choice.inputValue(),'printer');assert.ok(await choice.isDisabled());if(legal)assert.equal(await page.locator('#paper-size').inputValue(),'auto');await open(plan.id);assert.equal(await choice.inputValue(),'rgb');if(legal)assert.equal(await page.locator('#paper-size').inputValue(),'legal');
    await page.locator('#chart-more summary').click();await page.getByRole('button',{name:'Alphabetical seat list',exact:true}).click();assert.equal(await page.locator('#print-options').getAttribute('open'),null);await openPrintOptions(page);assert.equal(await choice.inputValue(),'rgb');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.seats-roster-controls').screenshot({path:path.join(output,width+'-roster-controls.png')});const rosterRgb=await exportPdf('RGB',false,true,true);await choice.selectOption('cmyk');const rosterCmyk=await exportPdf('CMYK',false,true,true);assert.deepEqual(rosterRgb.words,rosterCmyk.words);
    await page.locator('[data-action=back-to-chart]').click();await openPrintOptions(page);await choice.selectOption('rgb');if(legal){const before=await raw();await page.locator('#paper-size').selectOption('letter');assert.equal(await raw(),before);assert.match(await page.locator('#seats-page-size').textContent(),/11in 8.5in/);await page.locator('#paper-size').selectOption('legal');assert.equal(await raw(),before);assert.match(await page.locator('#seats-page-size').textContent(),/14in 8.5in/);}assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('.seats-editor-head').screenshot({path:path.join(output,width+'-controls.png')});
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);console.log('PASS',width,'RGB/CMYK, independent resources, retry, matching layout, per-chart choice, vector roster, artwork quality and original chart data.');await context.close();
  }}finally{await browser.close();if(!remote)server.close();}console.log('Artifacts: '+output);
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
