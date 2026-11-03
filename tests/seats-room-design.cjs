const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-room-design-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
assert.ok(fs.readFileSync(path.join(root,'assets/seats/room-fixtures-photo-v1.png')).equals(fs.readFileSync(path.resolve(__dirname,'../offline/assets/seats/room-fixtures-photo-v1.png'))),'The same fixture artwork must ship with the offline copy');
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
if len(sys.argv)>3 and sys.argv[3]=='1':
 assert len(p.get_image_info())>=3, 'All three realistic fixtures must be embedded in the native PDF'
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
  const {seatsCreateState,seatsCreatePlan,seatsWriteName}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];plan.name='Synthetic room design';plan.paper='letter';plan.monochrome=true;
  seatsWriteName(plan,'A1',0,'Design Test');seatsWriteName(plan,'B2',2,'Bookcase Example');seatsWriteName(plan,'rav-seat',0,'Rav Test');
  const cabinets=plan.objects.filter(object=>object.type==='cabinet');
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{for(const monochrome of [true,false]){plan.monochrome=monochrome;for(const width of [375,1440]){
    const variant=(monochrome?'mono':'color')+'-'+width;
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],writes=[],patches=[];
    await context.addInitScript(sample=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));},sample);
    if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});page.on('websocket',s=>s.on('framesent',e=>{try{if(JSON.parse(e.payload).type==='patch')patches.push('patch');}catch{}}));
    const response=await page.goto(origin+'/seats/?count=off');if(remote){const imports=html=>JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]).imports;assert.equal(imports(await response.text())['/js/seats/room.js'],imports(fs.readFileSync(path.join(root,'seats/index.html'),'utf8'))['/js/seats/room.js']);}
    await page.locator('#seats-name').fill('Synthetic Design Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
    const toggle=page.getByRole('switch',{name:'Room design',exact:true}),raw=()=>page.evaluate(key=>localStorage.getItem(key),key);
    const geometry=()=>page.locator('.room-stage .room-item').evaluateAll(nodes=>nodes.map(node=>[node.getAttribute('data-item'),node.getAttribute('transform'),...node.querySelectorAll(':scope>.table-surface,:scope>.object-surface')].map(value=>typeof value==='string'?value:[value.getAttribute('width'),value.getAttribute('height')])));
    assert.equal(await toggle.isChecked(),false);assert.equal(await page.locator('.cabinet-design').count(),0);const before=await raw(),positions=await geometry(),oldArt=await page.locator('.room-stage .room-object').evaluateAll(nodes=>nodes.map(node=>node.innerHTML));
    const off=path.join(output,'off-'+variant+'.pdf');await page.pdf({path:off,preferCSSPageSize:true,printBackground:true});const offInfo=JSON.parse(execFileSync('python',['-c',inspectPdf,off,'letter'],{encoding:'utf8'}));
    await toggle.scrollIntoViewIfNeeded();const top=(await toggle.boundingBox()).y;await toggle.check();assert.equal(await page.evaluate(()=>document.activeElement.id),'room-design');assert.ok(Math.abs((await toggle.boundingBox()).y-top)<1,'The switch stays in place');
    assert.equal(await page.locator('.room-stage .cabinet-design').count(),cabinets.length);assert.equal(await page.locator('#seats-print .cabinet-design').count(),cabinets.length);assert.ok(await page.locator('.room-stage .leaning-book').count()>0);assert.equal(await raw(),before);assert.deepEqual(await geometry(),positions);
    assert.ok(await page.locator('.room-stage .cabinet-design').evaluateAll((groups,monochrome)=>groups.every(group=>{const surface=group.parentElement.querySelector('.object-surface'),width=Number(surface.getAttribute('width')),height=Number(surface.getAttribute('height')),fill=getComputedStyle(surface).fill;return (monochrome?fill==='rgb(255, 255, 255)':fill.includes('#room-design-screen-wood'))&&[...group.querySelectorAll('rect,path')].every(node=>{const b=node.getBBox(),matrix=group.parentElement.getCTM().inverse().multiply(node.getCTM());return [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].every(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return p.x>=1&&p.y>=1&&p.x<=width-1&&p.y<=height-1;});});}),monochrome),'Every book and shelf fits inside its existing cabinet');
    assert.equal(await page.locator('.room-stage .room-design-color').count(),monochrome?0:1);
    let screenAronHeight=0;
    if(!monochrome){
      assert.equal(await page.locator('.realistic-fixture text').count(),0,'Recognizable fixture pictures do not need visible captions');
      screenAronHeight=await page.locator('.room-stage .design-aron .fixture-picture').evaluate(node=>node.viewBox.baseVal.height*node.getScreenCTM().d/node.closest('.room-art').getScreenCTM().d);
      const amudHeight=await page.locator('.room-stage .design-amud .fixture-picture').evaluate(node=>node.viewBox.baseVal.height*node.getScreenCTM().d/node.closest('.room-art').getScreenCTM().d);
      assert.ok(amudHeight>=plan.objects.find(object=>object.type==='amud').height*.95,'The amud picture uses its available height instead of reserving caption space');
      assert.equal(await page.locator('.room-stage .fixture-picture image').count(),3);
      assert.equal(await page.locator('#seats-print .fixture-picture image').count(),3);
      const picture=await page.locator('.room-stage .fixture-picture image').first().evaluate(async node=>{const image=new Image();image.src=node.getAttribute('href');await image.decode();return [image.naturalWidth,image.naturalHeight];});
      assert.deepEqual(picture,[2172,724],'The transparent fixture artwork must load before printing');
      assert.ok(await page.locator('.fixture-picture').evaluateAll(nodes=>nodes.every(node=>{const crop=node.viewBox.baseVal,clip=node.querySelector('clipPath rect');return ['x','y','width','height'].every(key=>Math.abs(crop[key]-Number(clip.getAttribute(key)))<.01);})), 'Letterboxing must not reveal a neighboring fixture from the source sheet');
      const clipIds=await page.locator('.fixture-picture clipPath').evaluateAll(nodes=>nodes.map(node=>node.id));assert.equal(new Set(clipIds).size,clipIds.length,'Screen and print clip IDs must be independent');
      assert.equal(await page.locator('.room-stage .design-table-edge').count(),plan.tables.length);
      assert.equal(await page.locator('#seats-print .design-table-edge').count(),plan.tables.length);
      const seatFills=await page.locator('.room-stage .table-item .seat-area').evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).fill))]);
      assert.equal(seatFills.length,1,'Names and empty seats must share the same table background');
      assert.match(seatFills[0],/transparent|rgba\(0, 0, 0, 0\)/);
      for(const [scope,id]of [['.room-stage','screen'],['#seats-print','print']])assert.ok(await page.locator(scope+' .table-surface').evaluateAll((nodes,id)=>nodes.every(node=>{const fill=getComputedStyle(node).fill,filter=getComputedStyle(node).filter;return fill.includes('#room-design-'+id+'-wood')&&filter.includes('#room-design-'+id+'-shadow');}),id),'Each drawing uses its own wood and shadow definitions');
      const printFills=await page.locator('#seats-print .table-item .seat-area').evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).fill))]);assert.deepEqual(printFills,seatFills);
    }
    const directions={'rear-case-left':'north','rear-case-center':'north','rear-case-right':'north','rear-case-side-left':'east','rear-case-side-right':'west','rear-case-a7':'east'};
    for(const [id,direction]of Object.entries(directions)){
      const artwork=page.locator('.room-stage [data-item="'+id+'"] .cabinet-design');assert.equal(await artwork.getAttribute('data-facing'),direction);
      const vector=await artwork.evaluate(group=>{const m=group.parentElement.getCTM().inverse().multiply(group.getCTM());return {x:-m.c,y:-m.d};});
      const expected={north:[0,-1],east:[1,0],west:[-1,0]}[direction];assert.ok(Math.abs(vector.x-expected[0])<.001&&Math.abs(vector.y-expected[1])<.001,'The drawn books face into the room at '+id);
      assert.equal(await page.locator('#seats-print .room-object').filter({has:page.locator('.cabinet-design[data-facing="'+direction+'"]')}).count()>0,true);
    }
    await page.screenshot({path:path.join(output,'design-'+variant+'.png'),fullPage:true});
    if(!monochrome)await page.locator('.room-stage .room-diagram').screenshot({path:path.join(output,'room-'+variant+'.png')});
    for(const paper of ['auto','letter','tabloid']){
      await page.locator('#paper-size').selectOption(paper);
      if(!monochrome){
        await page.emulateMedia({media:'print'});
        const pictures=await page.locator('#seats-print .fixture-picture').evaluateAll(nodes=>nodes.map(node=>{const box=node.viewBox.baseVal,m=node.getScreenCTM(),scene=node.closest('.room-art').getScreenCTM(),center=new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(m),expected=new DOMPoint(600,0).matrixTransform(scene);return {aron:Boolean(node.closest('.design-aron')),height:box.height*m.d/scene.d,offset:center.x-expected.x,ratio:Math.hypot(m.a,m.b)/Math.hypot(m.c,m.d)};}));
        assert.ok(pictures.every(picture=>Math.abs(picture.offset)<.1&&Math.abs(picture.ratio-1)<.01),'Every picture must retain its center and natural proportions on paper');
        assert.ok(pictures.find(picture=>picture.aron).height>=screenAronHeight-.01,'The Aron Kodesh must not get an extra size reduction when printing');
        await page.emulateMedia({media:null});
      }
      const pdf=path.join(output,'design-'+variant+'-'+paper+'.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});const info=JSON.parse(execFileSync('python',['-c',inspectPdf,pdf,paper==='auto'?'letter':paper,monochrome?'0':'1'],{encoding:'utf8'}));assert.ok(info.drawings>offInfo.drawings+50,'Designed shelves must appear in the native PDF');console.log({width,monochrome,...info});
    }
    const afterPaper=await raw();await page.reload();await page.locator('.room-stage').waitFor();assert.ok(await toggle.isChecked());assert.equal(await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-room-design')),null,'Toggling one chart must not write a device-wide choice');assert.equal(await raw(),afterPaper);
    await toggle.uncheck();assert.equal(await page.locator('.cabinet-design').count(),0);assert.deepEqual(await page.locator('.room-stage .room-object').evaluateAll(nodes=>nodes.map(node=>node.innerHTML)),oldArt,'Switching off restores the original room drawing');assert.equal(await raw(),afterPaper);
    await page.locator('[data-action=home]').click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();const saved=await raw();await toggle.check();assert.equal(await raw(),saved,'The switch does not save an empty chart');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
  }}
  for(const width of [375,1440]){
    const a=JSON.parse(JSON.stringify(plan)),b=seatsCreatePlan('Independent chart B');seatsWriteName(b,'A1',0,'Separate Person');
    const seed={version:1,activeId:a.id,plans:[a,b]},context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
    await context.addInitScript(seed=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(seed));},seed);page.on('pageerror',error=>errors.push(error.message));
    if(remote)await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());
    await page.goto(origin+'/seats/?count=off');await page.locator('#seats-name').fill('Synthetic Chart Choice Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();
    const toggle=page.getByRole('switch',{name:'Room design',exact:true});
    const open=async id=>{if(!await page.locator('.sharing-dialog[open]').count())await page.getByRole('button',{name:'Saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+id+'"]').click();await page.locator('#chart-name').waitFor();};
    await open(a.id);await toggle.check();await open(b.id);assert.equal(await toggle.isChecked(),false,'Chart A must not enable Room design on chart B');
    await toggle.check();await toggle.uncheck();await open(a.id);assert.equal(await toggle.isChecked(),true,'Chart B must not disable Room design on chart A');
    await page.reload();await page.locator('#chart-name').waitFor();assert.equal(await toggle.isChecked(),true,'Chart A keeps its choice after reload');
    await open(b.id);await page.reload();await page.locator('#chart-name').waitFor();assert.equal(await toggle.isChecked(),false,'Chart B keeps its different choice after reload');
    await page.goBack();await page.getByRole('button',{name:'View saved charts',exact:true}).waitFor();await page.goForward();await page.locator('#chart-name').waitFor();assert.equal(await toggle.isChecked(),false,'Browser navigation restores the destination chart choice');
    await open(a.id);assert.equal(await toggle.isChecked(),true);await page.locator('[data-action=home]').click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();assert.equal(await toggle.isChecked(),false,'New charts do not inherit another chart choice');
    const raw=await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1'));await toggle.check();assert.equal(await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1')),raw,'A new draft display choice must not save a chart');
    await page.locator('[data-action=home]').click();await page.getByRole('button',{name:'Create new chart',exact:true}).click();assert.equal(await toggle.isChecked(),false,'A second new draft remains independent');
    await open(b.id);assert.equal(await toggle.isChecked(),false);await open(a.id);assert.equal(await toggle.isChecked(),true);
    const reopened=await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')));assert.deepEqual(reopened.plans.find(p=>p.id===a.id),a);assert.deepEqual(reopened.plans.find(p=>p.id===b.id),b);assert.deepEqual(errors,[]);await context.close();
    console.log('PASS '+width+'px: Room design choices are independent across saved charts, reload, Back/Forward and new drafts, with chart data unchanged.');
  }
  const slow=await browser.newContext({viewport:{width:1440,height:1000}}),slowPage=await slow.newPage();
  let releasePictures,requestedPictures;const picturesHeld=new Promise(resolve=>{releasePictures=resolve;}),picturesRequested=new Promise(resolve=>{requestedPictures=resolve;});
  plan.monochrome=false;
  await slow.addInitScript(sample=>{localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));localStorage.setItem('lakewood-commons-seats-room-design','1');window.printCalls=0;window.print=()=>window.printCalls++;},sample);
  await slow.route('**/room-fixtures-photo-v1.png',async route=>{requestedPictures();await picturesHeld;await route.continue();});
  await slowPage.goto(origin+'/seats/?count=off');await slowPage.locator('#seats-name').fill('Synthetic Print Organizer');await slowPage.locator('#seats-pin').fill('4444');await slowPage.getByRole('button',{name:'Open Seats',exact:true}).click();await slowPage.getByRole('button',{name:'View saved charts',exact:true}).click();await slowPage.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
  await picturesRequested;await slowPage.getByRole('button',{name:'Print / PDF',exact:true}).click();assert.equal(await slowPage.evaluate(()=>window.printCalls),0,'Printing must wait while the artwork is loading');
  releasePictures();await slowPage.waitForFunction(()=>window.printCalls===1);await slow.close();
  console.log('PASS: optional room design in color and black/white on phone/desktop and Letter/Tabloid PDFs, uniform name backgrounds, contained artwork, stable positions/focus, original drawing restored, persistent preference and unchanged chart data.');console.log('Artifacts: '+output);
  }finally{await browser.close();if(!remote)server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
