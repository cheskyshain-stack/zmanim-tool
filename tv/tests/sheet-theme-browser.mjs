import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot} from '../src/schedules.js';

const {chromium,webkit,devices}=createRequire(import.meta.url)('playwright');
const hasWebKit=existsSync(webkit.executablePath());
const engine=hasWebKit?'webkit':'chromium-without-host-context';
const dist=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types={'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
// Static local previews only: no Worker, API, or saved settings are changed.
const server=createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/display/'){
   res.setHeader('Content-Type','text/html');
   res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/display-assets/display.css"></head><body></body></html>');
   return;
  }
  const file=path.resolve(dist,'.'+pathname);
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const screenshots=process.env.BOARD_SCREENSHOT_DIR;
const palettes={
 light:{background:'rgb(247, 243, 235)',text:'rgb(20, 42, 66)',gold:'rgb(128, 100, 31)',band:'rgb(238, 229, 208)',border:'rgb(214, 203, 180)'},
 dark:{background:'rgb(11, 20, 35)',text:'rgb(245, 242, 234)',gold:'rgb(216, 183, 106)',band:'rgb(20, 34, 56)',border:'rgb(52, 68, 92)'},
};
const notices=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
 .map(item=>({...item,startsAt:'2020-01-01T00:00:00.000Z',endsAt:null}));
const results=[],failures=[],errors=[];
let browser;
try{
 browser=await (hasWebKit?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
 if(screenshots)await mkdir(screenshots,{recursive:true});
 for(const device of ['desktop','iphone']){
  const context=await browser.newContext(device==='iphone'?devices['iPhone 13']:{viewport:{width:1920,height:1080}});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push({device,message:error.message}));
  await page.goto(origin+'/display/');
  await page.evaluate(async()=>{
   await document.fonts.load('700 28px David');await document.fonts.ready;
   const {DisplayView}=await import('/display-assets/renderer.js');
   document.body.innerHTML='<div id="audit" style="width:100vw;height:100vh"></div>';
   window.audit=new DisplayView(document.querySelector('#audit'));
  });
  // Exercise two-column Sukkos in both placements, plus the one-column RH page.
  for(const date of ['2026-09-24','2026-09-26','2026-09-12']){
   const at=date+'T16:00:00.000Z',schedule=scheduleSnapshot(at);
   assert.ok(schedule.specialSheet,`${date} must exercise an original special sheet`);
   const snapshot={at,schedule,items:notices,upcoming:[],appearance:{mode:'light'}};
   for(const [step,theme] of ['light','dark','light','dark'].entries()){
    // A saved display choice must win over the phone or desktop OS preference.
    await page.emulateMedia({colorScheme:theme==='light'?'dark':'light'});
    const result=await page.evaluate(async({snapshot,theme,step,disableHostContext,palette})=>{
     const view=window.audit;
     view.update({...snapshot,appearance:{mode:theme}},{preview:true,now:100000+step*60000});
     const host=view.stage.querySelector('.original-sheet-host');
     await host.originalSheetReady;await document.fonts.ready;
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
     const shadow=host.shadowRoot,originalPage=shadow.querySelector('.original-page');
     let removedHostContextRules=0;
     // Safari does not support :host-context. When WebKit is unavailable,
     // remove those rules in Chrome instead of silently relying on its support.
     if(disableHostContext){
      const removeRules=sheet=>{
       for(let index=sheet.cssRules.length-1;index>=0;index--){
        const rule=sheet.cssRules[index];
        if(rule.selectorText?.includes(':host-context')){sheet.deleteRule(index);removedHostContextRules++;}
        else if(rule.cssRules)removeRules(rule);
       }
      };
      for(const style of shadow.querySelectorAll('style,link[rel="stylesheet"]'))if(style.sheet)removeRules(style.sheet);
     }
     if(step===0)window.sheetBaseline={host,page:originalPage,fitCount:host.originalSheetFitCount,rows:shadow.querySelectorAll('.onepage-row').length};
     const baseline=window.sheetBaseline,issues=[],colors={},counts={};
     const checkColor=(name,elements,property,expected)=>{
      counts[name]=elements.length;
      if(!elements.length){issues.push({missing:name});return;}
      const actual=[...new Set(elements.map(element=>getComputedStyle(element)[property]))];
      colors[name]=actual;
      if(actual.some(color=>color!==expected))issues.push({name,property,expected,actual});
     };
     const all=selector=>[...shadow.querySelectorAll(selector)];
     checkColor('hostBackground',[host],'backgroundColor',palette.background);
     checkColor('pageBackground',all('.poster.is-onepage'),'backgroundColor',palette.background);
     checkColor('pageText',all('.poster.is-onepage'),'color',palette.text);
     checkColor('times',all('.onepage-times,.onepage-times bdi,.zman-pair-time'),'color',palette.text);
     checkColor('headings',all('.onepage-title,.onepage-sec-head,.onepage-label,.zman-pair-name'),'color',palette.gold);
     checkColor('bands',all('.onepage-sec-head'),'backgroundColor',palette.band);
     checkColor('headingRules',all('.onepage-sec-head'),'borderTopColor',palette.gold);
     checkColor('titleRule',all('.onepage-title'),'borderBottomColor',palette.gold);
     const ruledRows=all('.onepage-row').filter(row=>parseFloat(getComputedStyle(row).borderBottomWidth)>0);
     checkColor('rowBorders',ruledRows,'borderBottomColor',palette.border);
     const stable=host===baseline.host&&originalPage===baseline.page&&host.originalSheetFitCount===baseline.fitCount&&shadow.querySelectorAll('.onepage-row').length===baseline.rows;
     if(!stable)issues.push({themeSwitchChangedPage:true,fitCount:host.originalSheetFitCount,originalFitCount:baseline.fitCount});
     if(host.dataset.sheetReady!=='true')issues.push({sheetNotReady:true});
     return {theme,stable,fitCount:host.originalSheetFitCount,removedHostContextRules,counts,colors,issues};
    },{snapshot,theme,step,disableHostContext:!hasWebKit,palette:palettes[theme]});
    const name=`${device} ${date} ${theme} switch=${step}`;
    results.push({name,...result});
    if(result.issues.length)failures.push({name,issues:result.issues});
    if(screenshots&&date==='2026-09-24'&&step<2)await page.screenshot({path:path.join(screenshots,`sheet-theme-${device}-${theme}.png`)});
   }
  }
  await context.close();
 }
 console.log(JSON.stringify({engine,limitation:hasWebKit?null:'WebKit is not installed. Chrome ran with shadow :host-context rules removed; actual Safari rendering was not tested.',results,failures,errors},null,2));
 assert.deepEqual(errors,[],'No browser runtime errors');
 assert.equal(failures.length,0,'Original sheet colors or theme stability failed');
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
