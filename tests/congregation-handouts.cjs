const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../dist'),output=fs.mkdtempSync(path.join(os.tmpdir(),'congregation-handouts-'));
const remote=process.env.CONGREGATION_CHECK_ORIGIN;
const server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
(async()=>{
  if(!remote)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=remote||'http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox'],...(process.env.CONGREGATION_CHECK_PROXY?{proxy:{server:process.env.CONGREGATION_CHECK_PROXY}}:{})});
  try{
    for(const width of [375,1440]){
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      if(remote)await context.route('**://static.cloudflareinsights.com/**',route=>route.abort());
      await page.goto(origin+'/chart/?count=off');await page.locator('#chart-host .page').first().waitFor();await page.evaluate(()=>document.fonts.ready);
      await page.locator('#chart-host .header-icon').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
      const photos=await page.locator('#chart-host .header-icon').evaluateAll(images=>images.map(image=>({source:new URL(image.src).pathname,loaded:image.naturalWidth>0})));assert.ok(photos.length>=2);
      assert.ok(photos.every(photo=>photo.source==='/assets/logo-building-icon.png'&&photo.loaded),'Seasonal and weekday charts keep the original building picture');
      await page.screenshot({path:path.join(output,'charts-'+width+'.png'),fullPage:true});
      let fullHtml;
      for(const [name,date,half] of [['noraim','2026-09-14T15:00:00Z',false],['chanukah','2026-12-06T15:00:00Z',true],['two-handouts','2026-12-10T15:00:00Z',true],['asara','2026-12-20T15:00:00Z',true]]){
        await page.goto(origin+'/schedules/?count=off&website-preview='+encodeURIComponent(date));
        try { await page.locator('.luach-sheets .poster').first().waitFor({timeout:5000}); }
        catch(error){console.error(name,await page.evaluate(async()=>{const {currentOnePageSheets}=await import('/js/ui/posters-view.js'),{resolveSettings}=await import('/js/settings.js'),published=await(await fetch('/data/published.json')).json();try{return {sheets:currentOnePageSheets(published,resolveSettings(published.settings)).length,body:document.querySelector('.luach-sheets')?.textContent};}catch(error){return {error:error.stack};}}));throw error;}
        await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);
        assert.equal(await page.locator('.luach-sheet-page.is-handout').count()>0,half,name);
        assert.equal(await page.getByText('Blank half',{exact:true}).count(),0);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        if(half){
          const widths=await page.locator('.luach-sheet-page.is-handout').first().evaluate(box=>({available:box.clientWidth,painted:box.querySelector('.poster-half-sheet').getBoundingClientRect().width}));
          assert.ok(Math.abs(widths.available-widths.painted)<2,'Handout fills the screen preview: '+JSON.stringify(widths));
          assert.equal(await page.locator('.poster-half-slot.is-blank').count(),0);
        }else fullHtml=await page.locator('.luach-sheet-page').first().innerHTML();
        await page.screenshot({path:path.join(output,name+'-'+width+'.png'),fullPage:true});
        const times=await page.locator('.luach-sheets .poster').allTextContents();
        const pdf=path.join(output,name+'-'+width+'.pdf');await page.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});
        const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}),text=execFileSync('pdftotext',['-raw',pdf,'-'],{encoding:'utf8'});const count=await page.locator('.luach-sheet').count();
        assert.match(info,new RegExp('Pages:\\s+'+count+'\\b'));assert.match(info,half?/792 x 612 pts/:/612 x 792 pts/);
        for(const time of new Set(times.join(' ').match(/\b\d{1,2}:\d{2}\b/g)||[]))assert.ok(text.includes(time),name+' retains '+time);
        if(half)execFileSync('python',['-c','import fitz,sys\np=fitz.open(sys.argv[1])\nfor page in p:\n assert page.get_text("words")\n assert max(w[2] for w in page.get_text("words")) < 397, "The handout must occupy only one printed half"',pdf]);
      }
      await page.evaluate(async full=>{
        const host=document.querySelector('.luach-sheets'),half=document.querySelector('.luach-sheet').cloneNode(true);host.replaceChildren();host.className='luach-sheets has-mixed-handouts';
        const large=document.createElement('section');large.className='luach-sheet';large.innerHTML='<div class="luach-sheet-page">'+full+'</div>';host.append(large,half);
        const {setPrintPage}=await import('/js/ui/print-page.js'),{layoutPosters}=await import('/js/ui/posters-view.js');setPrintPage('letter portrait');layoutPosters(host);
      },fullHtml);
      const mixed=path.join(output,'mixed-'+width+'.pdf');await page.pdf({path:mixed,preferCSSPageSize:true,printBackground:true});assert.match(execFileSync('pdfinfo',[mixed],{encoding:'utf8'}),/Pages:\s+2\b/);
      assert.deepEqual(errors,[]);await context.close();
    }
    console.log('PASS: congregation charts retain the original picture; modern special handouts fill phone/desktop previews with no blank half, and native single/mixed PDFs keep every time and their correct half-sheet dimensions.');console.log('Artifacts: '+output);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
