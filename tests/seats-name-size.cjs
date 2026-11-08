const openPrintOptions=require('./helpers/seats-print-options.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'seats-name-size-'));
const remote=process.env.SEATS_CHECK_ORIGIN;
const server=http.createServer((req,res)=>{
  if(req.url.split('?')[0]==='/data/seats-sync.json'){res.setHeader('Content-Type','application/json');return res.end('{"endpoint":""}');}
  let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const pdfFonts=String.raw`
import sys,fitz,collections,json,math
p=fitz.open(sys.argv[1])[0]
frames=[d['rect'] for d in p.get_drawings() if d['rect'].width>80 and 20<d['rect'].height<40 and d['rect'].width/d['rect'].height>3]
# The wider paper can also include the Aron frame; table surfaces share one height.
table_height=collections.Counter(round(r.height,1) for r in frames).most_common(1)[0][0]
frames=[r for r in frames if abs(r.height-table_height)<.2]
assert len(frames)==int(sys.argv[3]), ('Missing table frames',len(frames))
pitch=max(r.width for r in frames)/5
chars=[{'size':s['size'],'bbox':c['bbox'],'text':c['c'],'bold':bool(s['flags']&16),'color':s['color']} for b in p.get_text('rawdict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans'] for c in s['chars']]
ink=next(s['color'] for b in p.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans'] if '7:30' in s['text'])
fonts=[]
for r in frames:
 count=round(r.width/pitch)
 for i in range(count):
  left,right=r.x0+r.width*i/count,r.x0+r.width*(i+1)/count
  seat=[s for s in chars if s['text'].strip() and left<=(s['bbox'][0]+s['bbox'][2])/2<right and r.y0<=(s['bbox'][1]+s['bbox'][3])/2<=r.y1]
  if ''.join(s['text'] for s in seat)=='Pillar':continue
  assert all(s['color']==ink for s in seat), ('Print names in solid black',seat)
  assert all(s['bold'] for s in seat), ('An assigned name is not bold in the PDF',seat)
  assert all(s['bbox'][0]>=left-.6 and s['bbox'][2]<=right+.6 and s['bbox'][1]>=r.y0-.6 and s['bbox'][3]<=r.y1+.6 for s in seat), ('Name clipped or overlapping a neighboring seat',r,seat)
  sizes=[s['size'] for s in seat]
  if sizes: fonts.append(round(max(sizes),2))
assert len(fonts)==int(sys.argv[2]), ('Every assigned name must print',len(fonts))
sizes=collections.Counter(fonts)
assert max(sizes.values())>=math.ceil(len(fonts)*.85), ('Most printed names must share one size',sizes)
assert len(sizes)>1, 'Long names still need a smaller exception size'
print(json.dumps({'assigned':len(fonts),'sameSize':max(sizes.values()),'sizes':dict(sorted(sizes.items()))}))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(remote?{proxy:{server:process.env.SEATS_CHECK_PROXY||process.env.HTTPS_PROXY||process.env.HTTP_PROXY}}:{})});
  try{
    const {seatsCreateState,seatsWriteName,seatsSeatBlocked}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];plan.name='Synthetic name sizing check';
    const fullNames=['Ari Stone','Eli Hart','Noah Reed','Yosef Cohen','Moshe Levi','David Adler','Shimon Baker','Chaim Miller','Gavriel Green','Yonah Silver','Yehuda Gold','Yisroel Fox','Meir Fields','Yaakov Brooks','Avraham Weiss','Mordechai Stern','Yosef Dovid Rosen','Eliezer Rosenfeld','Shlomo Zalman Klein','Alexander Theodore Montgomery','Christopher Alexander Silverstone','דוד כהן','משה לוי','אליהו דוד ישראלי'];
    const names=process.env.SEATS_NAME_SURNAME_FIXTURE?['Stone','Hart','Reed','Cohen','Levi','Adler','Baker','Miller','Green','Silver','Gold','Fox','Fields','Brooks','Weiss','Stern','Rosen','Klein','Fried','Finkel','Alexander Theodore Montgomery','Christopher Alexander Silverstone','דוד כהן','משה לוי']:fullNames;
    let index=0;for(const table of plan.tables)for(let seat=0;seat<table.count;seat++)if(!seatsSeatBlocked(plan,table.id,seat))seatsWriteName(plan,table.id,seat,names[index++%names.length],{duplicate:true});
    seatsWriteName(plan,'rav-seat',0,'Rav Levi');
    const renderedNames=plan.tables.flatMap(table=>table.seats.filter(Boolean).map(id=>plan.people.find(person=>person.id===id).name));
    for(const width of remote?[375]:[375,1440]){
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      if(remote)await context.route('**://static.cloudflareinsights.com/**',route=>route.abort());
      if(remote){await context.route('**/data/seats-sync.json',route=>route.fulfill({contentType:'application/json',body:'{"endpoint":""}'}));await context.route('**/api/**',route=>!['GET','OPTIONS'].includes(route.request().method())?route.abort():route.continue());}
      const writes=[],patches=[];
      page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','OPTIONS'].includes(request.method())&&!request.url().endsWith('/api/session'))writes.push(request.url());});
      page.on('websocket',socket=>socket.on('framesent',event=>{try{if(JSON.parse(event.payload).type==='patch')patches.push('patch');}catch{}}));
      await context.addInitScript(state=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(state));const create=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob.type==='application/pdf')window.nameSizePdf=blob;return create.call(this,blob);};window.open=()=>null;},sample);
      await page.goto(origin+'/seats/?count=off');if(remote)assert.equal(await page.locator('meta[name=seats-build]').getAttribute('content'),fs.readFileSync(path.join(root,'seats/index.html'),'utf8').match(/name="seats-build" content="([^"]+)/)[1]);await page.locator('#seats-name').fill('Synthetic Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card').click();await page.evaluate(()=>document.fonts.ready);
      const before=await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1'));
      const inspect=async selector=>page.locator(selector).evaluate(stage=>{
        const texts=[...stage.querySelectorAll('.table-seat.assigned .seat-name')],sizes={};
        for(const text of texts){if(!getComputedStyle(text).fontFamily.startsWith('Arial'))throw new Error('Assigned names must use the original Arial font');if(getComputedStyle(text).fontWeight!=='700')throw new Error('Assigned names must render in bold');const size=text.getAttribute('font-size');sizes[size]=(sizes[size]||0)+1;}
        const names=texts.map(text=>[...text.querySelectorAll('tspan')].map(line=>line.textContent).join(' '));
        const overflow=texts.filter(text=>{
          const parent=text.closest('.table-seat'),rav=parent.classList.contains('rav-seat'),seat=parent.querySelector(rav?'.shtender-surface':'.seat-area').getBBox(),box=text.getBBox();
          const padding=rav?0:1;
          return box.x<seat.x-padding-.5||box.x+box.width>seat.x+seat.width+padding+.5||box.y<seat.y-.5||box.y+box.height>seat.y+seat.height+.5;
        }).map(text=>({name:text.textContent,font:text.getAttribute('font-size')}));
        return {count:texts.length,sizes,names,overflow};
      });
      const screen=await inspect('.room-stage');assert.ok(Math.max(...Object.values(screen.sizes))>=Math.ceil(screen.count*.85));assert.equal(screen.overflow.length,0,JSON.stringify(screen.overflow));
      assert.deepEqual(screen.names.sort(),[...renderedNames].sort(),'Full English and Hebrew names stay intact');
      await page.screenshot({path:path.join(output,'names-'+width+'.png'),fullPage:true});
      const reports={};for(const testCase of [{paper:'letter',name:'letter'},{paper:'legal',name:'legal'},{paper:'auto',format:'Letter',name:'auto-letter'},{paper:'auto',format:'Legal',name:'auto-legal'},{paper:'tabloid',name:'tabloid'}]){const paper=testCase.paper;
        await openPrintOptions(page);await page.locator('#paper-size').selectOption(paper);await page.emulateMedia({media:'print'});
        const printed=await inspect('#seats-print');assert.ok(Math.max(...Object.values(printed.sizes))>=Math.ceil(printed.count*.85));
        const file=path.join(output,'names-'+width+'-'+testCase.name+'.pdf');await page.pdf({path:file,preferCSSPageSize:true,printBackground:true,...(testCase.format?{format:testCase.format,landscape:true}:{})});
        assert.match(execFileSync('pdfinfo',[file],{encoding:'utf8'}),/Pages:\s+1\b/);
        reports[testCase.name]=JSON.parse(execFileSync('python',['-c',pdfFonts,file,String(renderedNames.length),String(plan.tables.length)],{encoding:'utf8'}));console.log(JSON.stringify({width,paper:testCase.name,...reports[testCase.name]}));
        await page.emulateMedia({media:'screen'});
        if(paper==='legal'&&process.env.SEATS_NAME_SURNAME_FIXTURE&&!process.env.SEATS_NAME_SIZE_BASELINE){
          for(const mode of ['rgb','cmyk']){
            await openPrintOptions(page);await page.locator('#pdf-colors').selectOption(mode);await page.evaluate(()=>{window.nameSizePdf=null;});await page.getByRole('button',{name:'Print / PDF',exact:true}).click();
            await page.waitForFunction(()=>window.nameSizePdf,null,{timeout:120000});const data=await page.evaluate(async()=>{const a=new Uint8Array(await window.nameSizePdf.arrayBuffer());let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s);});
            const exported=path.join(output,'names-'+width+'-legal-'+mode+'.pdf');fs.writeFileSync(exported,Buffer.from(data,'base64'));const metrics=JSON.parse(execFileSync('python',['-c',pdfFonts,exported,String(renderedNames.length),String(plan.tables.length)],{encoding:'utf8'}));console.log(JSON.stringify({width,paper:'legal-'+mode,...metrics}));
          }
        }
      }
      if(process.env.SEATS_NAME_SURNAME_FIXTURE&&!process.env.SEATS_NAME_SIZE_BASELINE){const mode=r=>Number(Object.entries(r.sizes).sort((a,b)=>b[1]-a[1])[0][0]);assert.ok(mode(reports.legal)>mode(reports.letter)*1.1,'Legal should use its extra width for larger names');assert.ok(mode(reports['auto-legal'])>mode(reports['auto-letter'])*1.1,'Auto fit should also enlarge names on Legal');}
      const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')));assert.deepEqual(after.plans[0].people,JSON.parse(before).plans[0].people);assert.deepEqual(after.plans[0].tables,JSON.parse(before).plans[0].tables);
      assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
    }
    console.log('PASS: most assigned names share one font size, long names shrink further, whole English/Hebrew names and assignments survive, and actual Letter/Legal/Tabloid and Auto fit PDFs remain one page without clipped names.');console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
