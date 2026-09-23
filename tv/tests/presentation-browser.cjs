const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.env.DISPLAY_TEST_URL||'http://127.0.0.1:8797';
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage({viewport:{width:1920,height:1080}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/display/');await p.waitForSelector('.tv-panel');await p.evaluate(()=>document.fonts.ready);const out='../../../outputs/tv-schedules';fs.mkdirSync(out,{recursive:true});
for(const [name,at] of [['chol-hamoed','2026-09-30T16:00:00Z'],['ordinary-exceptions','2028-04-26T16:00:00Z'],['connected-yom-tov','2026-09-27T16:00:00Z'],['yom-kippur','2026-09-21T16:00:00Z'],['three-days','2024-10-19T16:00:00Z'],['shabbos-before-pesach','2025-04-14T16:00:00Z']]){
 const r=await fetch(base+'/api/display/admin/preview',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,'X-Display-Request':'1'},body:JSON.stringify({at})});assert.equal(r.status,200);const snap=await r.json();
 await p.evaluate(async snap=>{const {DisplayView}=await import('/display-assets/renderer.js');window.v?.destroy();document.body.innerHTML='<div id="capture" style="height:100vh;position:relative"></div>';window.v=new DisplayView(document.querySelector('#capture'));window.snap=snap;v.update(snap,{preview:true,theme:'dark',now:100000});},snap);
 await p.evaluate(()=>document.fonts.ready);await p.evaluate(()=>v.update(snap,{preview:true,theme:'dark',now:100000}));
 const info=await p.evaluate(()=>({count:v.schedulePages.pages.length,source:snap.schedule.presentation.special.sections.flatMap(s=>s.rows.map(r=>r.id)),shown:v.schedulePages.pages.flatMap(html=>{const d=document.createElement('div');d.innerHTML=html;return [...d.querySelectorAll('[data-source-id]')].map(e=>e.dataset.sourceId)})}));assert.deepEqual(info.shown,info.source);
 const steady=await p.locator('.weekly-reference').innerHTML();
 for(let i=0;i<info.count;i++){await p.evaluate(i=>v.update(snap,{preview:true,theme:'dark',now:100000+i*35000}),i);assert.equal(await p.locator('.weekly-reference').innerHTML(),steady);const over=await p.locator('.weekly-body,.special-body').evaluateAll(es=>es.map(e=>e.scrollHeight-e.clientHeight));assert.ok(over.every(n=>n<=2),name+JSON.stringify(over));await p.waitForTimeout(150);await p.screenshot({path:out+'/'+name+'-'+(i+1)+'.png'});}
 await p.evaluate(()=>v.update(snap,{preview:true,theme:'light',now:100000}));await p.waitForTimeout(150);await p.screenshot({path:out+'/'+name+'-light.png'});console.log(name,info.count+' pages; all '+info.source.length+' source rows preserved');
}
assert.deepEqual(errors,[]);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});


