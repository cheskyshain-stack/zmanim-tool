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
assert len(frames)==34, ('Missing table frames',len(frames))
pitch=max(r.width for r in frames)/5
chars=[{'size':s['size'],'bbox':c['bbox'],'text':c['c']} for b in p.get_text('rawdict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans'] for c in s['chars']]
fonts=[]
for r in frames:
 count=round(r.width/pitch)
 for i in range(count):
  left,right=r.x0+r.width*i/count,r.x0+r.width*(i+1)/count
  sizes=[s['size'] for s in chars if s['text'].strip() and not s['text'].strip().isdigit() and left<=(s['bbox'][0]+s['bbox'][2])/2<right and r.y0<=(s['bbox'][1]+s['bbox'][3])/2<=r.y1]
  if sizes: fonts.append(round(max(sizes),2))
assert len(fonts)==164, ('Every assigned name must print',len(fonts))
sizes=collections.Counter(fonts)
assert max(sizes.values())>=math.ceil(len(fonts)*.85), ('Most printed names must share one size',sizes)
assert len(sizes)>1, 'Long names still need a smaller exception size'
print(json.dumps({'assigned':len(fonts),'sameSize':max(sizes.values()),'sizes':dict(sorted(sizes.items()))}))
`;
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.SEATS_CHECK_PROXY?{proxy:{server:process.env.SEATS_CHECK_PROXY}}:{})});
  try{
    const {seatsCreateState,seatsWriteName}=await import('../js/seats/model.js'),sample=seatsCreateState(),plan=sample.plans[0];plan.name='Synthetic name sizing check';
    const names=['Ari Stone','Eli Hart','Noah Reed','Yosef Cohen','Moshe Levi','David Adler','Shimon Baker','Chaim Miller','Gavriel Green','Yonah Silver','Yehuda Gold','Yisroel Fox','Meir Fields','Yaakov Brooks','Avraham Weiss','Mordechai Stern','Yosef Dovid Rosen','Eliezer Rosenfeld','Shlomo Zalman Klein','Alexander Theodore Montgomery','Christopher Alexander Silverstone','דוד כהן','משה לוי','אליהו דוד ישראלי'];
    let index=0;for(const table of plan.tables)for(let seat=0;seat<table.count;seat++)seatsWriteName(plan,table.id,seat,names[index++%names.length],{duplicate:true});
    seatsWriteName(plan,'rav-seat',0,'Rav Levi');
    for(const width of [375,1440]){
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      if(remote)await context.route('**://static.cloudflareinsights.com/**',route=>route.abort());
      const writes=[],patches=[];
      page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','OPTIONS'].includes(request.method())&&!request.url().endsWith('/api/session'))writes.push(request.url());});
      page.on('websocket',socket=>socket.on('framesent',event=>{try{if(JSON.parse(event.payload).type==='patch')patches.push('patch');}catch{}}));
      await context.addInitScript(state=>{if(!localStorage.getItem('lakewood-commons-seats-v1'))localStorage.setItem('lakewood-commons-seats-v1',JSON.stringify(state));},sample);
      await page.goto(origin+'/seats/?count=off');await page.locator('#seats-name').fill('Synthetic Organizer');await page.locator('#seats-pin').fill('4444');await page.getByRole('button',{name:'Open Seats',exact:true}).click();
      await page.getByRole('button',{name:'View saved charts',exact:true}).click();await page.locator('.sharing-local-plan .saved-page-card').click();await page.evaluate(()=>document.fonts.ready);
      const before=await page.evaluate(()=>localStorage.getItem('lakewood-commons-seats-v1'));
      const inspect=async selector=>page.locator(selector).evaluate(stage=>{
        const texts=[...stage.querySelectorAll('.table-seat.assigned .seat-name')],sizes={};
        for(const text of texts){const size=text.getAttribute('font-size');sizes[size]=(sizes[size]||0)+1;}
        const names=texts.map(text=>[...text.querySelectorAll('tspan')].map(line=>line.textContent).join(' '));
        const overflow=texts.filter(text=>{
          const parent=text.closest('.table-seat'),rav=parent.classList.contains('rav-seat'),seat=parent.querySelector(rav?'.shtender-surface':'.seat-area').getBBox(),box=text.getBBox();
          const padding=rav?0:1;
          return box.x<seat.x-padding-.5||box.x+box.width>seat.x+seat.width+padding+.5||box.y<seat.y-.5||box.y+box.height>seat.y+seat.height+.5;
        }).map(text=>({name:text.textContent,font:text.getAttribute('font-size')}));
        return {count:texts.length,sizes,names,overflow};
      });
      const screen=await inspect('.room-stage');assert.ok(Math.max(...Object.values(screen.sizes))>=Math.ceil(screen.count*.85));assert.equal(screen.overflow.length,0,JSON.stringify(screen.overflow));
      assert.deepEqual(screen.names.sort(),plan.people.map(person=>person.name).sort(),'Full English and Hebrew names stay intact');
      await page.screenshot({path:path.join(output,'names-'+width+'.png'),fullPage:true});
      for(const paper of ['letter','tabloid']){
        await page.locator('#paper-size').selectOption(paper);await page.emulateMedia({media:'print'});
        const printed=await inspect('#seats-print');assert.ok(Math.max(...Object.values(printed.sizes))>=Math.ceil(printed.count*.85));
        const file=path.join(output,'names-'+width+'-'+paper+'.pdf');await page.pdf({path:file,preferCSSPageSize:true,printBackground:true});
        assert.match(execFileSync('pdfinfo',[file],{encoding:'utf8'}),/Pages:\s+1\b/);
        console.log(JSON.stringify({width,paper,...JSON.parse(execFileSync('python',['-c',pdfFonts,file],{encoding:'utf8'}))}));
        await page.emulateMedia({media:'screen'});
      }
      const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('lakewood-commons-seats-v1')));assert.deepEqual(after.plans[0].people,JSON.parse(before).plans[0].people);assert.deepEqual(after.plans[0].tables,JSON.parse(before).plans[0].tables);
      assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(patches,[]);await context.close();
    }
    console.log('PASS: most assigned names share one font size, long names shrink further, whole English/Hebrew names and assignments survive, and actual Letter/Tabloid PDFs remain one page.');console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
