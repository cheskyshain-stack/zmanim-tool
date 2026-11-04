const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-room-design-')),remote=process.env.SEATS_CHECK_ORIGIN,key='lakewood-commons-seats-v1';
for(const file of ['room-fixtures-photo-v1.png','aron-crown-round-v1.png','amud-front-photo-v1.png','bimah-square-photo-v1.png','bimah-two-panel-photo-v2.png','light-marble-floor-v1.png','light-tabletop-v1.png'])assert.ok(fs.readFileSync(path.join(root,'assets/seats',file)).equals(fs.readFileSync(path.resolve(__dirname,'../offline/assets/seats',file))),'The same room artwork must ship with the offline copy');
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
 assert len(p.get_image_info())>=4, 'All three realistic fixtures and the round crown tip must be embedded in the native PDF'
 margin=36 if sys.argv[2]=='tabloid' else 25.2
 floor=fitz.Rect(margin+(500-12)*(w-2*margin)/1176,margin+25.2+(600-50)*(h-2*margin-25.2)/916,margin+(700-12)*(w-2*margin)/1176,margin+25.2+(620-50)*(h-2*margin-25.2)/916)
 stone=p.get_pixmap(matrix=fitz.Matrix(3,3),clip=floor,alpha=False).samples
 assert len({stone[i:i+3] for i in range(0,len(stone),3)})>(8 if len(sys.argv)>4 and sys.argv[4]=='1' else 48), 'The open walkway must retain natural marble variation in the native PDF'
 pix=p.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
 pixels=pix.samples
 header_ink=sum(1 for y in range(round(margin*2),round((margin+25.2)*2)) for x in range(round(w*.43*2),round(w*.57*2)) if max(pixels[(y*pix.width+x)*3:(y*pix.width+x)*3+3])<205)
 assert header_ink>30, 'The Aron must use the empty center header instead of shrinking the room'
if len(sys.argv)>4 and sys.argv[4]=='1':
 pix=p.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
 pixels=pix.samples
 colored=sum(1 for i in range(0,len(pixels),3) if max(pixels[i:i+3])-min(pixels[i:i+3])>2)
 assert colored==0, ('Black and white must contain only neutral grays, including all photo artwork',colored)
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
    const uniformSeatBackgrounds=async()=>{for(const scope of ['.room-stage','#seats-print']){const fills=await page.locator(scope+' .table-seat .seat-area').evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).fill))]);assert.ok(fills.length>0&&fills.every(fill=>/^(transparent|rgba\(0, 0, 0, 0\))$/.test(fill)),'Named and empty seats must show the same tabletop in '+scope);}};
    const checkSeatStates=async()=>{
      const saved=await raw(),seat=page.locator('#seat-A1-0');await seat.hover();await uniformSeatBackgrounds();await seat.click();await page.locator('.seat-editor:not([hidden]) #seat-name-input').waitFor();assert.equal(await page.locator('#seat-name-input').inputValue(),'Design Test');assert.ok(await seat.evaluate(node=>node.classList.contains('is-active')));await uniformSeatBackgrounds();await page.getByRole('button',{name:'Close seat editor',exact:true}).click();
      for(const state of ['name-drop-target','is-remote']){const style=await seat.evaluate((node,state)=>{node.classList.add(state);const paint=getComputedStyle(node.querySelector('.seat-area')),style={fill:paint.fill,stroke:paint.stroke,width:parseFloat(paint.strokeWidth)};node.classList.remove(state);return style;},state);assert.match(style.fill,/^(transparent|rgba\(0, 0, 0, 0\))$/);assert.ok(style.stroke!=='none'&&style.width>0,'Drop and reservation states retain visible outlines');}
      await page.mouse.move(0,0);assert.equal(await raw(),saved,'Checking seat backgrounds must not change names or assignments');
    };
    const geometry=()=>page.locator('.room-stage .room-item').evaluateAll(nodes=>nodes.map(node=>[node.getAttribute('data-item'),node.getAttribute('transform'),...node.querySelectorAll(':scope>.table-surface,:scope>.object-surface')].map(value=>typeof value==='string'?value:[value.getAttribute('width'),value.getAttribute('height')])));
    const fixturesClearOfNames=scope=>page.locator(scope+' .fixture-picture').evaluateAll((nodes,scope)=>nodes.every(node=>{const v=node.viewBox.baseVal,m=node.getScreenCTM(),p=new DOMPoint(v.x,v.y).matrixTransform(m),q=new DOMPoint(v.x+v.width,v.y+v.height).matrixTransform(m);return [...document.querySelectorAll(scope+' .table-seat .seat-area')].every(seat=>{const s=seat.getBoundingClientRect();return q.x<=s.left||p.x>=s.right||q.y<=s.top||p.y>=s.bottom;});}),scope);
    assert.equal(await toggle.isChecked(),false);assert.equal(await page.locator('.cabinet-design').count(),0);const before=await raw(),positions=await geometry(),oldArt=await page.locator('.room-stage .room-object').evaluateAll(nodes=>nodes.map(node=>node.innerHTML)),printView=await page.locator('#seats-print .room-diagram').getAttribute('viewBox');
    await checkSeatStates();
    const off=path.join(output,'off-'+variant+'.pdf');await page.pdf({path:off,preferCSSPageSize:true,printBackground:true});const offInfo=JSON.parse(execFileSync('python',['-c',inspectPdf,off,'letter'],{encoding:'utf8'}));
    await toggle.scrollIntoViewIfNeeded();const top=(await toggle.boundingBox()).y;await toggle.check();assert.equal(await page.evaluate(()=>document.activeElement.id),'room-design');assert.ok(Math.abs((await toggle.boundingBox()).y-top)<1,'The switch stays in place');
    await checkSeatStates();
    assert.equal(await page.locator('.room-stage .cabinet-design').count(),cabinets.length);assert.equal(await page.locator('#seats-print .cabinet-design').count(),cabinets.length);assert.ok(await page.locator('.room-stage .leaning-book').count()>0);assert.equal(await raw(),before);assert.deepEqual(await geometry(),positions);
    assert.equal(await page.locator('#seats-print .room-diagram').getAttribute('viewBox'),printView,'The Aron picture must not enlarge the view and shrink the rest of the printed chart');
    assert.ok(await page.locator('.room-stage .cabinet-design').evaluateAll(groups=>groups.every(group=>{const surface=group.parentElement.querySelector('.object-surface'),width=Number(surface.getAttribute('width')),height=Number(surface.getAttribute('height')),fill=getComputedStyle(surface).fill;return fill.includes('#room-design-screen-wood')&&[...group.querySelectorAll('rect,path')].every(node=>{const b=node.getBBox(),matrix=group.parentElement.getCTM().inverse().multiply(node.getCTM());return [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].every(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return p.x>=1&&p.y>=1&&p.x<=width-1&&p.y<=height-1;});});})),'Every book and shelf fits inside its existing cabinet');
    assert.equal(await page.locator('.room-stage .room-design').count(),1);
    assert.equal(await page.locator('.room-stage .design-floor-texture').count(),1,'Both styles include the realistic marble floor');
    assert.equal(await page.locator('.room-stage .design-table-texture').count(),1,'Both styles include the realistic tabletop texture');
    assert.equal(await page.locator('.design-cabinet-texture').count(),0,'Bookcases keep their restored light appearance');
    let screenAronHeight=0;
    {
      for(const scope of ['.room-stage','#seats-print']){
        const material=await page.locator(scope+' .design-table-texture').evaluate(async node=>{const picture=new Image();picture.src=node.getAttribute('href');await picture.decode();return [new URL(picture.src).pathname,picture.naturalWidth,picture.naturalHeight];});assert.deepEqual(material,['/assets/seats/light-tabletop-v1.png',2172,724],'Tables use a pale photographic wood texture');
      }
      const contrast=await page.locator('.room-stage .design-table-texture').evaluate(async node=>{
        const picture=new Image();picture.src=node.getAttribute('href');await picture.decode();const canvas=document.createElement('canvas');canvas.width=picture.naturalWidth;canvas.height=picture.naturalHeight;const ctx=canvas.getContext('2d');ctx.fillStyle=node.parentElement.querySelector('rect').getAttribute('fill');ctx.fillRect(0,0,canvas.width,canvas.height);ctx.globalAlpha=Number(node.getAttribute('opacity'));ctx.filter=getComputedStyle(node).filter;ctx.drawImage(picture,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,minimum=[255,255,255];for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)minimum[c]=Math.min(minimum[c],data[i+c]);
        const luminance=rgb=>rgb.reduce((sum,value,index)=>{const v=value/255;return sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][index];},0);return ['.seat-name','.empty-seat'].map(selector=>{const ink=getComputedStyle(document.querySelector('.room-stage .table-seat '+selector)).fill.match(/[\d.]+/g).slice(0,3).map(Number);return (luminance(minimum)+.05)/(luminance(ink)+.05);});
      });assert.ok(contrast.every(value=>value>=4.5),'Names and empty-seat numbers remain readable over the darkest grain');
      for(const scope of ['.room-stage','#seats-print']){
        await page.emulateMedia({media:scope==='#seats-print'?'print':'screen'});
        const marble=page.locator(scope+' .design-floor-texture');assert.equal(await marble.count(),1);
        const image=await marble.evaluate(async node=>{const picture=new Image();picture.src=node.getAttribute('href');await picture.decode();return [new URL(picture.src).pathname,picture.naturalWidth,picture.naturalHeight];});assert.deepEqual(image,['/assets/seats/light-marble-floor-v1.png',1774,887],'The floor uses realistic stone artwork');
        const grid=await marble.evaluate(node=>{const pattern=node.parentElement,paths=[...pattern.querySelectorAll('.floor-tile-joints path')],boxes=paths.map(path=>path.getBBox()),xs=boxes.filter(b=>b.width===0).map(b=>b.x).sort((a,b)=>a-b),ys=boxes.filter(b=>b.height===0).map(b=>b.y).sort((a,b)=>a-b);return {tile:[xs[1]-xs[0],ys[1]-ys[0]],center:[+pattern.getAttribute('x')+(xs[1]+xs[2])/2,+pattern.getAttribute('y')+(ys[1]+ys[2])/2],curves:paths.some(path=>/[CQSTA]/i.test(path.getAttribute('d')))};});
        assert.deepEqual(grid.tile,[144,72]);assert.deepEqual(grid.center,[600,515],'A rectangular tile stays centered in the room');assert.equal(grid.curves,false,'Only physical grout joints are drawn, with no artificial marble-vein curves');
      }
      await page.emulateMedia({media:null});
      assert.equal(await page.locator('.realistic-fixture text').count(),0,'Recognizable fixture pictures do not need visible captions');
      screenAronHeight=await page.locator('.room-stage .design-aron .fixture-picture').evaluate(node=>node.viewBox.baseVal.height*node.getScreenCTM().d/node.closest('.room-art').getScreenCTM().d);
      const amudHeight=await page.locator('.room-stage .design-amud .fixture-picture').evaluate(node=>node.viewBox.baseVal.height*node.getScreenCTM().d/node.closest('.room-art').getScreenCTM().d);
      assert.ok(Math.abs(amudHeight/plan.objects.find(object=>object.type==='amud').height-1.21)<.01,'The amud illustration is ten percent larger than its previous 1.1 scale');
      const bimahSize=await page.locator('.room-stage .design-bimah .fixture-picture').evaluate(node=>{const v=node.viewBox.baseVal,m=node.getScreenCTM(),scene=node.closest('.room-art').getScreenCTM();return {width:v.width*m.a/scene.a,height:v.height*m.d/scene.d};});
      const bimah=plan.objects.find(object=>object.type==='bimah');assert.ok(Math.abs(bimahSize.width/(Math.min(bimah.width,bimah.height)*1.1)-.75)<.001,'The bimah is 25% narrower than the original wide illustration');assert.ok(bimahSize.width/bimahSize.height>=1.25&&bimahSize.width/bimahSize.height<=1.75,'The bimah keeps the requested lower rectangular silhouette');
      const bimahImage=await page.locator('.room-stage .design-bimah .fixture-picture > image').evaluate(async node=>{const image=new Image();image.src=node.getAttribute('href');await image.decode();return [new URL(image.src).pathname,image.naturalWidth,image.naturalHeight];});assert.deepEqual(bimahImage,['/assets/seats/bimah-two-panel-photo-v2.png',1419,1108],'The bimah uses the clean-glass two-panel illustration');
      const amudImage=await page.locator('.room-stage .design-amud .fixture-picture > image').evaluate(async node=>{const image=new Image();image.src=node.getAttribute('href');await image.decode();return [new URL(image.src).pathname,image.naturalWidth,image.naturalHeight];});assert.deepEqual(amudImage,['/assets/seats/amud-front-photo-v1.png',990,1589],'The amud uses the straight-on illustration');
      assert.ok(await fixturesClearOfNames('.room-stage'),'Enlarged fixture pictures must remain clear of seat names');
      assert.equal(await page.locator('.room-stage .fixture-picture > image').count(),3);
      assert.equal(await page.locator('#seats-print .fixture-picture > image').count(),3);
      for(const scope of ['.room-stage','#seats-print'])assert.equal(await page.locator(scope+' .fixture-crown-correction image').count(),1,'Only the Aron crown tip receives the artwork correction');
      const picture=await page.locator('.room-stage .fixture-picture image').first().evaluate(async node=>{const image=new Image();image.src=node.getAttribute('href');await image.decode();return [image.naturalWidth,image.naturalHeight];});
      assert.deepEqual(picture,[2172,724],'The transparent fixture artwork must load before printing');
      assert.ok(await page.locator('.fixture-picture').evaluateAll(nodes=>nodes.every(node=>{const crop=node.viewBox.baseVal,clip=node.querySelector('clipPath rect');return ['x','y','width','height'].every(key=>Math.abs(crop[key]-Number(clip.getAttribute(key)))<.01);})), 'Letterboxing must not reveal a neighboring fixture from the source sheet');
      const clipIds=await page.locator('.fixture-picture clipPath').evaluateAll(nodes=>nodes.map(node=>node.id));assert.equal(new Set(clipIds).size,clipIds.length,'Screen and print clip IDs must be independent');
      assert.equal(await page.locator('.room-stage .design-table-edge').count(),plan.tables.length);
      assert.equal(await page.locator('#seats-print .design-table-edge').count(),plan.tables.length);
      const seatFills=await page.locator('.room-stage .table-item .seat-area').evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).fill))]);
      assert.equal(seatFills.length,1,'Names and empty seats must share the same table background');
      assert.match(seatFills[0],/transparent|rgba\(0, 0, 0, 0\)/);
      for(const [scope,id]of [['.room-stage','screen'],['#seats-print','print']])assert.ok(await page.locator(scope+' .table-surface').evaluateAll((nodes,id)=>nodes.every(node=>{const fill=getComputedStyle(node).fill,filter=getComputedStyle(node).filter;return fill.includes('#room-design-'+id+'-tabletop')&&filter.includes('#room-design-'+id+'-shadow');}),id),'Each drawing uses its own light tabletop material and shadow definitions');
      const printFills=await page.locator('#seats-print .table-item .seat-area').evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).fill))]);assert.deepEqual(printFills,seatFills);
      const labelColors=async scope=>page.locator(scope+' .book-label-strip').evaluateAll(nodes=>[...new Set(nodes.map(node=>getComputedStyle(node).stroke))].sort());
      const colors=await labelColors('.room-stage');assert.equal(colors.length,4,'Book sets keep their varied tape in both styles');if(monochrome)assert.ok(colors.every(color=>{const rgb=color.match(/\d+/g).map(Number);return rgb[0]===rgb[1]&&rgb[1]===rgb[2];}),'Book labels use neutral grays');assert.deepEqual(await labelColors('#seats-print'),colors,'Printed books keep the same varied tape colors');
    }
    const directions={'rear-case-left':'north','rear-case-center':'north','rear-case-right':'north','rear-case-side-left':'east','rear-case-side-right':'west','rear-case-a7':'east'};
    for(const [id,direction]of Object.entries(directions)){
      const artwork=page.locator('.room-stage [data-item="'+id+'"] .cabinet-design');assert.equal(await artwork.getAttribute('data-facing'),direction);
      const vector=await artwork.evaluate(group=>{const m=group.parentElement.getCTM().inverse().multiply(group.getCTM());return {x:m.c,y:m.d};});
      const expected={north:[0,-1],east:[1,0],west:[-1,0]}[direction];assert.ok(Math.abs(vector.x-expected[0])<.001&&Math.abs(vector.y-expected[1])<.001,'The drawn books face into the room at '+id);
      for(const scope of ['.room-stage','#seats-print']){
        await page.emulateMedia({media:scope==='#seats-print'?'print':'screen'});
        assert.ok(await page.locator(scope+' .cabinet-design').nth(cabinets.findIndex(cabinet=>cabinet.id===id)).evaluate((group,expected)=>{
        const object=group.parentElement,surface=object.querySelector('.object-surface'),cx=Number(surface.getAttribute('width'))/2,cy=Number(surface.getAttribute('height'))/2,toObject=object.getCTM().inverse();
        const books=[...group.querySelectorAll('.book-volume')].filter(book=>{const b=book.getBBox();return b.height>b.width*1.5;});
        const fronts=books.map(book=>{const b=book.getBBox();return new DOMPoint(b.x+b.width/2,b.y+b.height).matrixTransform(toObject.multiply(book.getCTM()));});
        for(const label of group.querySelectorAll('.book-label-strip')){const b=label.getBBox();fronts.push(new DOMPoint(b.x+b.width/2,b.y).matrixTransform(toObject.multiply(label.getCTM())));}
        return books.length>0&&fronts.every(point=>(point.x-cx)*expected[0]+(point.y-cy)*expected[1]>0);
        },expected),'Actual book bases and tape must be on the room side in '+scope+' at '+id);
      }
      await page.emulateMedia({media:null});
    }
    await page.screenshot({path:path.join(output,'design-'+variant+'.png'),fullPage:true});
    await page.locator('.room-stage .room-diagram').screenshot({path:path.join(output,'room-'+variant+'.png')});
    for(const paper of ['auto','letter','tabloid']){
      await page.locator('#paper-size').selectOption(paper);
      await uniformSeatBackgrounds();
      {
        const screenViewport=page.viewportSize();await page.setViewportSize(paper==='tabloid'?{width:1536,height:960}:{width:989,height:749});
        await page.emulateMedia({media:'print'});
        assert.ok(await fixturesClearOfNames('#seats-print'),'The enlarged bimah stays clear of every seat name on '+paper+' paper');
        const pictures=await page.locator('#seats-print .fixture-picture').evaluateAll(nodes=>nodes.map(node=>{const box=node.viewBox.baseVal,m=node.getScreenCTM(),scene=node.closest('.room-art').getScreenCTM(),center=new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(m),expected=new DOMPoint(600,0).matrixTransform(scene);return {aron:Boolean(node.closest('.design-aron')),height:box.height*m.d/scene.d,offset:center.x-expected.x,ratio:Math.hypot(m.a,m.b)/Math.hypot(m.c,m.d)};}));
        assert.ok(pictures.every(picture=>Math.abs(picture.offset)<.1&&Math.abs(picture.ratio-1)<.01),'Every picture must retain its center and natural proportions on paper');
        assert.ok(pictures.find(picture=>picture.aron).height>=screenAronHeight-.01,'The Aron Kodesh must not get an extra size reduction when printing');
        await page.emulateMedia({media:null});
        await page.setViewportSize(screenViewport);
      }
      const pdf=path.join(output,'design-'+variant+'-'+paper+'.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});const info=JSON.parse(execFileSync('python',['-c',inspectPdf,pdf,paper==='auto'?'letter':paper,'1',monochrome?'1':'0'],{encoding:'utf8'}));assert.ok(info.drawings>offInfo.drawings+50,'Designed shelves must appear in the native PDF');console.log({width,monochrome,...info});
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
  for(const monochrome of [true,false]){
  const slow=await browser.newContext({viewport:{width:1440,height:1000}}),slowPage=await slow.newPage();
  let releasePictures,requestedPictures;const picturesHeld=new Promise(resolve=>{releasePictures=resolve;}),picturesRequested=new Promise(resolve=>{requestedPictures=resolve;});
  plan.monochrome=monochrome;
  await slow.addInitScript(sample=>{localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(sample));localStorage.setItem('lakewood-commons-seats-room-design','1');window.printCalls=0;window.print=()=>window.printCalls++;},sample);
  await slow.route('**/light-tabletop-v1.png',async route=>{requestedPictures();await picturesHeld;await route.continue();});
  await slowPage.goto(origin+'/seats/?count=off');await slowPage.locator('#seats-name').fill('Synthetic Print Organizer');await slowPage.locator('#seats-pin').fill('4444');await slowPage.getByRole('button',{name:'Open Seats',exact:true}).click();await slowPage.getByRole('button',{name:'View saved charts',exact:true}).click();await slowPage.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
  await picturesRequested;await slowPage.getByRole('button',{name:'Print / PDF',exact:true}).click();assert.equal(await slowPage.evaluate(()=>window.printCalls),0,'Printing must wait while the artwork is loading');
  releasePictures();await slowPage.waitForFunction(()=>window.printCalls===1);await slow.close();
  }
  console.log('PASS: optional room design in color and black/white on phone/desktop and Letter/Tabloid PDFs, uniform name backgrounds, contained artwork, stable positions/focus, original drawing restored, persistent preference and unchanged chart data.');console.log('Artifacts: '+output);
  }finally{await browser.close();if(!remote)server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
