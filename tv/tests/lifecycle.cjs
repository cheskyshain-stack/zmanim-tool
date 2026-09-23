const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.DISPLAY_TEST_URL||'http://127.0.0.1:8795';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  const snapshot=await(await fetch(base+'/api/display/public')).json();
  const originTime=Date.parse('2026-09-23T13:00:00.000Z'),began=Date.now();let reads=0;
  const a={id:'expiry',kind:'announcement',title:'DEVELOPMENT SAMPLE EXPIRING',startsAt:new Date(originTime-1000).toISOString(),endsAt:new Date(originTime+2400).toISOString(),data:{message:'Test only',placement:'left',behavior:'rotating',priority:'normal',duration:25}};
  const b={...a,id:'starting',title:'DEVELOPMENT SAMPLE STARTING',startsAt:new Date(originTime+1200).toISOString(),endsAt:new Date(originTime+600000).toISOString()};
  await page.addInitScript(()=>{Date.now=()=>Date.parse('2050-01-01T00:00:00Z')});
  await page.route('**/api/display/public',route=>{reads++;const now=originTime+Date.now()-began,at=new Date(now).toISOString();return route.fulfill({contentType:'application/json',body:JSON.stringify({...snapshot,at,generatedAt:at,nextChangeAt:[a.endsAt,b.startsAt,b.endsAt].filter(t=>t>at).sort()[0],items:[a,b].filter(i=>i.startsAt<=at&&i.endsAt>at),upcoming:[]})});});
  await page.goto(base+'/display/');await page.getByText(a.title,{exact:true}).waitFor();assert.match(await page.locator('.tv-clock').innerText(),/9:00 AM/);
  await page.getByText(b.title,{exact:true}).waitFor({timeout:6000});assert.equal(await page.getByText(a.title,{exact:true}).count(),0);assert.ok(reads>=3,'Start and end boundaries should refresh before the 15-second poll');
  console.log('PASS: automatic start/end refresh, expiry and server clock despite incorrect device clock.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
