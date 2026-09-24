import {scheduleSnapshot} from '../src/schedules.js';
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const start=process.env.AUDIT_START||'2026-09-23',end=process.env.AUDIT_END||'2046-09-23';
const out=process.env.AUDIT_OUT||'../../../outputs/twenty-year-audit';fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
const report={start,end,checked:0,failures:[],missing:[],errors:[],years:{}};
try{
 await page.goto('http://127.0.0.1:8797/display/');await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(async()=>{const {DisplayView}=await import('/display-assets/renderer.js');document.body.innerHTML='<div id="audit" style="width:1920px;height:1080px"></div>';window.auditView=new DisplayView(document.querySelector('#audit'));});
 for(let ms=Date.parse(start+'T16:00:00Z');ms<Date.parse(end+'T16:00:00Z');ms+=86400000){
  const at=new Date(ms).toISOString(),date=at.slice(0,10);
  try{
   const schedule=scheduleSnapshot(at),snapshot={at,schedule,items:[{id:'development-notice',kind:'announcement',title:'DEVELOPMENT AUDIT',startsAt:'2020',data:{placement:'left',message:'Development layout fixture only. This announcement checks readable text, Hebrew and English, and sufficient space for community information beside the complete schedule. This is not published content.',priority:'normal'}},{id:'development-dedication',kind:'dedication',title:'Development only',startsAt:'2020',data:{anonymous:true,dedicationType:'לזכות',dedicationName:'תצוגה לדוגמה בלבד',message:'Development dedication — not published.'}}],upcoming:[],appearance:{mode:'dark'}};
   const result=await page.evaluate(snapshot=>{const v=window.auditView;v.update(snapshot,{preview:true,theme:'dark',now:100000});const stage=v.stage,issues=[];
    for(const e of stage.querySelectorAll('.weekly-body,.special-body'))if(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)issues.push({type:'vertical',panel:e.className,extra:e.scrollHeight-e.clientHeight,horizontal:e.scrollWidth-e.clientWidth});
    for(const e of stage.querySelectorAll('.source-time bdi')){const box=e.getBoundingClientRect(),parent=e.closest('.source-times').getBoundingClientRect();if(box.right>parent.right+2)issues.push({type:'time-width',text:e.textContent});}
    for(const e of stage.querySelectorAll('.source-times')){const boxes=[...e.querySelectorAll('.source-time bdi')].map(x=>({r:x.getBoundingClientRect(),text:x.textContent}));for(let i=1;i<boxes.length;i++){const a=boxes[i-1],b=boxes[i];if(Math.abs(a.r.top-b.r.top)<3&&a.r.right>b.r.left+2)issues.push({type:'time-overlap',text:a.text+' | '+b.text});}}
    const actual=[...stage.querySelectorAll('.complete-special [data-source-id]')].map(e=>e.dataset.sourceId).sort(),expected=(snapshot.schedule.presentation.special?.sections||[]).flatMap(s=>s.rows.map(r=>r.id)).sort();if(JSON.stringify(actual)!==JSON.stringify(expected))issues.push({type:'lost-rows'});
    return {issues,columns:stage.querySelector('.tv-center')?.style.gridTemplateColumns};
   },snapshot);
   if(result.issues.length){report.failures.push({date,title:schedule.presentation.special?.title,...result});if(report.failures.length<=8)await page.screenshot({path:out+'/failure-'+date+'.png'});}
   if(schedule.today.note||schedule.presentation.special?.sections.some(s=>s.rows.some(r=>r.id.startsWith('missing:'))))report.missing.push({date,note:schedule.today.note||'Full saved chart unavailable'});
   report.checked++;report.years[date.slice(0,4)]=(report.years[date.slice(0,4)]||0)+1;
  }catch(e){report.errors.push({date,error:e.stack});}
  if((report.checked+report.errors.length)%100===0){fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(date,report.checked,'checked',report.failures.length,'layout failures',report.errors.length,'errors');}
 }
}finally{fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({checked:report.checked,failures:report.failures.length,missing:report.missing.length,errors:report.errors.length}));



process.exitCode=report.failures.length||report.errors.length?1:0;
