import {scheduleSnapshot} from '../src/schedules.js';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const b=await chromium.launch({channel:'chrome',headless:true});
try{const p=await b.newPage({viewport:{width:1920,height:1080}});await p.goto('http://127.0.0.1:8795/display/');await p.evaluate(()=>document.fonts.ready);await p.evaluate(async()=>{const {DisplayView}=await import('/display-assets/renderer.js');document.body.innerHTML='<div id="audit" style="height:100vh"></div>';window.v=new DisplayView(document.querySelector('#audit'));});
for(const date of ['2026-09-24','2026-09-27','2026-09-30','2026-10-04','2026-10-15'])for(const theme of ['light','dark']){const at=date+'T16:00:00Z',s=scheduleSnapshot(at),snap={at,schedule:s,items:[],upcoming:[],appearance:{mode:theme}};await p.evaluate(snap=>v.update(snap,{preview:true,now:100000}),snap);const info=await p.evaluate(()=>({ids:[...document.querySelectorAll('[data-sheet-source]')].map(e=>e.dataset.sheetSource),overflow:[...document.querySelectorAll('.sheet-column,.sheet-row')].filter(e=>e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2).map(e=>({class:e.className,h:e.scrollHeight-e.clientHeight,w:e.scrollWidth-e.clientWidth}))}));assert.deepEqual(info.ids.sort(),(s.fullSheet?.blocks.flatMap(b=>b.rows.map(r=>r.id))||[]).sort());await p.screenshot({path:"../../../outputs/shul-view-redesign/check-live.png"});assert.deepEqual(info.overflow,[],date+theme);if(date==='2026-09-24')await p.screenshot({path:'../../../outputs/shul-view-redesign/published-'+theme+'.png'});console.log(date,theme,'all source rows fit');}
}finally{await b.close()}

