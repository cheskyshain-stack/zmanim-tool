const openPrintOptions=require('./helpers/seats-print-options.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-cmyk-')),remote=process.env.SEATS_CHECK_ORIGIN;
const server=http.createServer((req,res)=>{
  const pathname=req.url.split('?')[0];if(pathname==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const inspect=String.raw`
import fitz,sys,re,json,numpy as np
d=fitz.open(sys.argv[1]);assert d.metadata['format']=='PDF 1.7', 'Declare a PDF version that supports transparency and output profiles'
mono=sys.argv[2]=='1';paper=sys.argv[3];roster=paper=='roster'
expected=(612,792) if roster else (1224,792) if paper=='tabloid' else (792,612)
if not roster:assert len(d)==1, 'Chart must remain one page'
intent=d.xref_get_key(d.pdf_catalog(),'OutputIntents')[1];assert 'FOGRA39' in intent
profile=int(re.search(r'/DestOutputProfile\s+(\d+)',intent)[1]);assert d.xref_get_key(profile,'N')[1]=='4';assert d.xref_stream(profile)[16:20]==b'CMYK'
names=''.join(''.join(p.get_text().split()) for p in d)
assert 'YosefCohen' in names, 'Assigned names must remain searchable text'
assert any('\u05d0'<=c<='\u05ea' for c in names), 'Hebrew glyphs must stay in the PDF'
assert 'משהכהן' in names, 'Hebrew names must keep their correct reading order'
images=0;maximum_ink=0;seen=set()
if roster:assert names.count('YosefCohen')==1, 'A person with several seats appears once in the roster'
for p in d:
 assert tuple(p.rect[2:])==expected
 assert '/DeviceCMYK' in d.xref_get_key(p.xref,'Group')[1], 'Transparency must blend in CMYK'
 if not roster and '-design-' in sys.argv[1]:
  lines=p.get_drawings();assert len(lines)==20, 'The 20 tile joints must remain vector paths'
  images_by_order=[i for i,b in enumerate(p.get_bboxlog()) if b[0]=='fill-image']
  assert images_by_order[0]<min(line['seqno'] for line in lines) and max(line['seqno'] for line in lines)<images_by_order[-1], 'Grout must sit above stone and beneath the furniture'
  assert sum(image[1]>0 for image in p.get_images(full=True))>0, 'Furniture must preserve transparency above the grout'
  assert all(0<line['width']<=.51 and min(line['color'])>.82 for line in lines), 'Tile joints must stay fine and light, without a strong grid'
  margin=36 if paper=='tabloid' else 25.2;w,h=expected
  sx=(w-2*margin)/1176;sy=(h-2*margin-25.2-16)/916
  floor=fitz.Rect(margin+(550-12)*sx,margin+25.2+(600-50)*sy,margin+(650-12)*sx,margin+25.2+(620-50)*sy)
  stone=p.get_pixmap(matrix=fitz.Matrix(4,4),clip=floor,alpha=False)
  stone_pixels=np.frombuffer(stone.samples,dtype=np.uint8).reshape(-1,3)
  assert stone_pixels.mean()>244, 'The CMYK floor must remain a very pale neutral'
  assert (stone_pixels.max(axis=1)-stone_pixels.min(axis=1)).max()<=2, 'The CMYK floor must have no colored cast'
  if not mono:
   for fixture,box in [('Aron',(590,80,610,100)),('amud',(595,212,605,220)),('bimah',(588,540,612,546))]:
    x0,y0,x1,y1=box
    r=fitz.Rect(margin+(x0-12)*sx,margin+25.2+(y0-50)*sy,margin+(x1-12)*sx,margin+25.2+(y1-50)*sy)
    detail=p.get_pixmap(matrix=fitz.Matrix(8,8),clip=r,alpha=False)
    rgb=np.frombuffer(detail.samples,dtype=np.uint8).reshape(-1,3);lightness=rgb@np.array([.2126,.7152,.0722])
    assert 105<lightness.mean()<210, (fixture,'CMYK must preserve the lighter wood and fabric')
    assert np.percentile(lightness,95)-np.percentile(lightness,5)>3, (fixture,'CMYK must preserve photographic details')
  if mono:
   for fixture,box in [('Aron',(552,18,648,118)),('amud',(586,184,614,230)),('bimah',(570,514,630,552))]:
    x0,y0,x1,y1=box
    r=fitz.Rect(margin+(x0-12)*sx,margin+25.2+(y0-50)*sy,margin+(x1-12)*sx,margin+25.2+(y1-50)*sy)
    samples=p.get_pixmap(matrix=fitz.Matrix(4,4),clip=r,alpha=False).samples[::3]
    assert sum(samples)/len(samples)>200, (fixture,'CMYK must preserve light sketch interiors')
    drawing=[value for value in samples if value<242]
    assert drawing and sum(value<220 for value in drawing)/len(drawing)>.03, (fixture,'CMYK must preserve visible sketch details within the artwork, independent of the pale floor behind it')
   floor=fitz.Rect(margin+(550-12)*sx,margin+25.2+(600-50)*sy,margin+(650-12)*sx,margin+25.2+(620-50)*sy)
   floor_values=sorted(p.get_pixmap(matrix=fitz.Matrix(4,4),clip=floor,alpha=False).samples[::3])
   floor_paper=floor_values[int(len(floor_values)*.95)]
   for fixture,box in [('Aron',(590,80,610,100)),('amud',(595,212,605,220)),('bimah',(588,540,612,546))]:
    x0,y0,x1,y1=box
    r=fitz.Rect(margin+(x0-12)*sx,margin+25.2+(y0-50)*sy,margin+(x1-12)*sx,margin+25.2+(y1-50)*sy)
    samples=sorted(p.get_pixmap(matrix=fitz.Matrix(4,4),clip=r,alpha=False).samples[::3])
    paper_tone=samples[int(len(samples)*.95)]
    assert 214<=paper_tone<=238, (fixture,'CMYK must retain the light gray paper tone')
    assert paper_tone<=floor_paper-5, (fixture,'CMYK sketches must stay distinct from the marble')

 assert all(font[1]=='ttf' for font in p.get_fonts()), 'Use embedded fonts, including Hebrew'
 spans=[span for block in p.get_text('dict')['blocks'] for line in block.get('lines',[]) for span in line['spans']]
 assert len({span['color'] for span in spans})==1, 'All printed lettering must use the same solid black as the page heading'
 pattern_streams=[xref for xref in range(1,d.xref_length()) if '/PatternType' in d.xref_object(xref)]
 for stream in p.get_contents()+[x[0] for x in p.get_xobjects()]+pattern_streams:
  data=d.xref_stream(stream) or b''
  assert not re.search(rb'(?<!\w)(?:rg|RG|/DeviceRGB)(?!\w)',data), 'No RGB vector commands'
  for paint in re.findall(rb'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[kK]\b',data):
   inks=list(map(float,paint))
   if mono:assert inks[:3]==[0,0,0], 'Monochrome vectors must use black ink only'
   maximum_ink=max(maximum_ink,sum(inks)*255)
 for placement in p.get_image_info(xrefs=True):
  box=fitz.Rect(placement['bbox'])
  assert abs(placement['width']/box.width*72-1200)<.3 and abs(placement['height']/box.height*72-1200)<.3, 'Sample artwork at 1200 dpi on the actual paper size'
 for image in p.get_images(full=True):
  assert image[5]=='DeviceCMYK', 'Every image must use four CMYK channels'
  if image[0] in seen:continue
  seen.add(image[0])
  assert image[2]<=4096 and image[3]<=1024, 'Keep rendering tiles bounded on phones'
  raw=d.xref_stream(image[0]);assert d.xref_get_key(image[0],'Decode')[1]=='[1 0 1 0 1 0 1 0]'
  assert len(raw)==image[2]*image[3]*4, 'CMYK images must contain exactly four samples per pixel'
  pixels=np.frombuffer(raw,dtype=np.uint8).reshape(-1,4)
  if not roster and '-design-' in sys.argv[1] and image[1]==0:
   assert (pixels[:,:3]==255).all(), 'Neutral floor tiles must use black ink only, even in Color'
   assert (255-pixels[:,3]).max()<=20, 'Floor texture must not print as a heavy ink layer'
  if mono:assert (pixels[:,:3]==255).all(), 'Black and white must not use cyan, magenta or yellow ink'
  maximum_ink=max(maximum_ink,int((1020-pixels.sum(axis=1,dtype=np.int16)).max()));images+=1
 for block in p.get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   for span in line['spans']:
    r=fitz.Rect(span['bbox']);assert r.x0>=0 and r.y0>=0 and r.x1<=p.rect.width+.1 and r.y1<=p.rect.height+.1,('Clipped text',span['text'],r)
 rgb=p.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False).samples
 assert min(rgb[:3])>245,'Paper must be white, not inverted CMYK'
 if not roster:
  assert 'FirstDraft' in names and 'AnyonewhowouldlikeaseatshouldspeaktotheGabbaim.' in names, 'The editable chart header and footer must stay searchable in CMYK'
  # A light room floor must stay light after color conversion.
  pix=p.get_pixmap(matrix=fitz.Matrix(1,1),clip=fitz.Rect(p.rect.width*.43,p.rect.height*.58,p.rect.width*.57,p.rect.height*.62),alpha=False)
  assert sum(pix.samples)/len(pix.samples)>200,'Floor must stay light'
assert (images>0 if '-design-' in sys.argv[1] else images==0), 'Only illustrated room artwork needs raster tiles'
if images==0:assert all(page.get_drawings() for page in d), 'Plain charts and roster rules must stay vector'
assert maximum_ink<=768,('CMYK ink coverage exceeds the printing profile',maximum_ink)
d[0].get_pixmap(matrix=fitz.Matrix(1.3,1.3),alpha=False).save(sys.argv[1]+'.png')
print(json.dumps({'pages':len(d),'images':images,'maxInkPercent':round(maximum_ink/255*100,1),'KOnly':mono}))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const {seatsCreatePlan,seatsWriteName,seatsSeatBlocked}=await import('../js/seats/model.js');
  const plan=seatsCreatePlan('Synthetic CMYK chart');plan.paper='letter';plan.monochrome=false;
  let assigned=0;for(const table of plan.tables)for(let index=0;index<table.count;index++)if(!seatsSeatBlocked(plan,table.id,index))seatsWriteName(plan,table.id,index,assigned++===0?'Yosef Cohen':assigned===2?'משה כהן':assigned===3?'R משה Cohen':'Guest '+String(assigned).padStart(3,'0'));
  seatsWriteName(plan,plan.tables.find(table=>table.label==='D9').id,0,'Yosef Cohen');
  const seed={version:1,activeId:plan.id,plans:[plan]},browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(remote?{proxy:{server:'http://proxy:8080'}}:{})});
  try{for(const width of [375,1440]){
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],writes=[];
    await context.addInitScript(seed=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(seed));const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/pdf')window.testCmykPdf=blob;return create.call(this,blob);};window.testBrowserPrints=0;window.print=()=>window.testBrowserPrints++;},seed);
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','OPTIONS'].includes(r.method())&&!r.url().endsWith('/api/session'))writes.push(r.url());});
    if(remote){await context.route('**://static.cloudflareinsights.com/**',r=>r.abort());await context.route('**/api/**',r=>!['GET','OPTIONS'].includes(r.request().method())&&!new URL(r.request().url()).pathname.endsWith('/api/session')?r.abort():r.continue());}
    await page.goto(origin+'/seats/?count=off');if(remote)assert.equal(await page.locator('meta[name=seats-build]').getAttribute('content'),fs.readFileSync(path.join(root,'seats/index.html'),'utf8').match(/name="seats-build" content="([^"]+)/)[1]);await page.locator('#seats-name').fill('Synthetic CMYK Reviewer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card[data-id="'+plan.id+'"]').click();
    if(width===375){
      let blocked=true;await context.route('**/FOGRA39L_coated.icc',route=>blocked?route.abort():route.continue());
      const raw=await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1'));await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.getByText('The CMYK PDF could not be created.',{exact:false}).waitFor();assert.ok(await page.getByRole('button',{name:'Print / PDF',exact:true}).isEnabled());assert.equal(await page.evaluate(()=>window.testBrowserPrints),0);assert.equal(await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1')),raw);blocked=false;
    }
    const exportPdf=async(file,mono,paper)=>{
      const raw=await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1'));await page.evaluate(()=>{window.testCmykPdf=null;});
      await page.getByRole('button',{name:'Print / PDF',exact:true}).click();await page.waitForFunction(()=>window.testCmykPdf||document.querySelector('#seats-notice')?.textContent.includes('could not be'),null,{timeout:300000});assert.match(await page.locator('#seats-notice').textContent(),/CMYK PDF ready/);
      const data=await page.evaluate(async()=>{const bytes=new Uint8Array(await window.testCmykPdf.arrayBuffer());let value='';for(let i=0;i<bytes.length;i+=16384)value+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(value);});fs.writeFileSync(file,Buffer.from(data,'base64'));
      const result=JSON.parse(execFileSync('python',['-c',inspect,file,mono?'1':'0',paper],{encoding:'utf8'}));console.log(path.basename(file),result);assert.equal(await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1')),raw,'Exporting must not change chart data');assert.equal(await page.evaluate(()=>window.testBrowserPrints),0,'CMYK export must never fall back to RGB browser printing');for(const popup of context.pages())if(popup!==page)await popup.close();
    };
    const cases=width===375?[[true,false,'letter'],[true,true,'letter'],[false,false,'letter'],[false,true,'tabloid']]:[[true,false,'letter'],[true,true,'letter'],[true,true,'tabloid'],[false,false,'letter'],[false,true,'letter'],[false,true,'letter'],[false,true,'tabloid']];
    for(const [mono,designed,paper]of cases){await openPrintOptions(page);await page.locator('#print-color').selectOption(mono?'mono':'color');await openPrintOptions(page);await page.locator('#paper-size').selectOption(paper);await page.locator('#room-design').setChecked(designed);await exportPdf(path.join(output,[width,mono?'mono':'color',designed?'design':'plain',paper].join('-')+'.pdf'),mono,paper);}
    await page.locator('#chart-more summary').click();await page.getByRole('button',{name:'Alphabetical seat list',exact:true}).click();await exportPdf(path.join(output,width+'-roster.pdf'),true,'roster');
    await page.evaluate(()=>{window.open=()=>null;});const download=page.waitForEvent('download');await exportPdf(path.join(output,width+'-roster-download.pdf'),true,'roster');assert.match((await download).suggestedFilename(),/-CMYK\.pdf$/);
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();
  }}finally{await browser.close();if(!remote)server.close();}
  console.log('PASS: CMYK profile, K-only grayscale, embedded searchable Hebrew/Latin names, paper sizes, both room styles, roster pagination, phone/desktop, popup fallback and unchanged chart data.');console.log('Artifacts: '+output);
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
