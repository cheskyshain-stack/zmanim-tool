import {scheduleSnapshot} from '../src/schedules.js';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const out='../../../outputs/twenty-year-review';fs.mkdirSync(out,{recursive:true});
const results=[];
try{
 await page.goto('http://127.0.0.1:8797/display/');await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(async()=>{const {DisplayView}=await import('/display-assets/renderer.js');document.body.innerHTML='<div id="audit" style="width:100vw;height:100vh"></div>';window.v=new DisplayView(document.querySelector('#audit'));});
 for(const date of ['2026-09-30','2027-04-18','2027-04-21','2029-09-28','2045-03-26','2027-10-04','2028-09-17','2028-09-20','2028-10-04','2036-10-01','2046-09-20'])for(const theme of ['light','dark'])for(const variant of ['left','both','none']){
  const at=date+'T16:00:00Z',data={message:'Development layout fixture only. This announcement checks readable text, Hebrew and English, and sufficient space for community information beside the complete schedule. This is not published content.',priority:'normal',placement:'left',contact:'Development contact',phone:'TEST ONLY'};
  const items=variant==='none'?[]:[{id:'fixture',kind:'announcement',title:'DEVELOPMENT PREVIEW',startsAt:'2020',data},{id:'dedication',kind:'dedication',title:'Development',startsAt:'2020',data:{anonymous:true,dedicationType:'לזכות',dedicationName:'תצוגה לדוגמה בלבד',message:'Development dedication — not published.'}}];
  if(variant==='both')items.push({id:'right',kind:'announcement',title:'DEVELOPMENT PREVIEW',startsAt:'2020',data:{...data,placement:'right'}});
  const snapshot={at,schedule:scheduleSnapshot(at),items,upcoming:[],appearance:{mode:theme}};
  const issues=await page.evaluate(({snapshot,theme})=>{v.update(snapshot,{preview:true,theme,now:100000});return [...v.stage.querySelectorAll('.weekly-body,.special-body,.tv-side,.shul-bottom')].filter(e=>e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2).map(e=>({type:e.className,parent:e.parentElement.className,columns:v.stage.querySelector('.tv-center').style.gridTemplateColumns,vertical:e.scrollHeight-e.clientHeight,horizontal:e.scrollWidth-e.clientWidth}));},{snapshot,theme});
  results.push({date,theme,variant,issues});if(variant==='left')await page.screenshot({path:out+'/'+date+'-'+theme+'.png'});
 }
 await page.setViewportSize({width:3840,height:2160});await page.waitForTimeout(100);await page.screenshot({path:out+'/4k.png'});
}finally{fs.writeFileSync(out+'/variants.json',JSON.stringify(results,null,2));await browser.close();}
console.log(JSON.stringify(results.filter(r=>r.issues.length),null,2));
process.exitCode=results.some(r=>r.issues.length)?1:0;
