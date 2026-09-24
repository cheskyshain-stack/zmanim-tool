import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scheduleSnapshot,dateInfo,previewMonth} from '../src/schedules.js';
import {validate,publicItems,warnings} from '../src/model.js';
import {localStamp,phase} from '../public/display-assets/time.js';

// The real built admin and display components run against an in-memory API.
// No live data or local/remote database is changed by this test.
const {chromium}=createRequire(import.meta.url)('playwright');
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const at='2026-09-24T16:00:00.000Z';
const fixture=JSON.parse((await readFile(new URL('./fixtures/current-public-announcements.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const initial=fixture.map(item=>({...item,status:'published',version:7,internalName:'Private: '+item.title,startsAt:'2026-09-23T12:00:00.000Z',endsAt:null,createdAt:at,updatedAt:at,createdBy:'test@example.com',updatedBy:'test@example.com'}));
const dedication={id:'development-anonymous-dedication',kind:'dedication',status:'published',title:'פרנס היום',internalName:'PRIVATE DEDICATION',version:3,startsAt:'2026-09-23T12:00:00.000Z',endsAt:null,data:{sponsor:'PRIVATE SPONSOR',anonymous:true,dedicationName:'DEVELOPMENT PREVIEW ONLY',dedicationType:'לזכות',dedicationText:'Development fixture only',sponsorshipDate:'2026-09-24',timing:'civil',duration:35}};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
const server=createServer(async(req,res)=>{
  try{
    let name=new URL(req.url,'http://localhost').pathname;
    if(name==='/__public_view__'){
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><link rel="stylesheet" href="/display-assets/display.css"></head><body><div id="public-check" style="width:1920px;height:1080px"></div></body></html>');return;
    }
    if(name.endsWith('/'))name+='index.html';
    const file=path.resolve(dist,'.'+name);
    if(!file.startsWith(path.resolve(dist)+path.sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const screenshots=process.env.ADMIN_SCREEN_SCREENSHOT_DIR;
const errors=[];
const kindCapability={announcement:'announcements',dedication:'dedications',schedule:'schedules'};
const schedules=new Map();
function schedule(instant){if(!schedules.has(instant))schedules.set(instant,scheduleSnapshot(instant));return schedules.get(instant);}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

async function scenario({capabilities=['full'],records=[...initial,dedication],mobile=false,delayPreview=false}={}){
  const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:1100}});
  await context.addInitScript(instant=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return NativeDate.parse(instant);}};},at);
  const state={records:structuredClone(records),writes:[],previewCalls:0,previewStarted:deferred(),previewRelease:deferred()};
  const permitted=item=>capabilities.includes('full')||capabilities.includes(kindCapability[item.kind]);
  await context.route('**/api/display/admin/**',async route=>{
    const req=route.request(),url=new URL(req.url()),name=url.pathname.slice('/api/display/admin/'.length),method=req.method(),raw=req.postDataJSON();
    let body,status=200;
    try{
      assert.equal(req.headers()['x-display-request'],'1');
      if(name==='me')body={email:'test@example.com',capabilities,local:true};
      else if(name==='date')body=dateInfo(raw.date,raw.hebrew);
      else if(name==='calendar')body=previewMonth(url.searchParams.get('month'));
      else if(name==='items'&&method==='GET')body=state.records.filter(permitted).map(item=>({...item,phase:phase(item,at)}));
      else if(name==='preview'){
        state.previewCalls++;state.previewStarted.resolve();
        if(delayPreview&&state.previewCalls===1)await state.previewRelease.promise;
        const instant=new Date(raw.at).toISOString();let rows=state.records;
        if(raw.item){assert.ok(permitted(raw.item));rows=rows.filter(item=>item.id!==raw.item.id).concat({...validate({...raw.item,status:'published'}),id:raw.item.id||'unsaved-preview'});}
        body={at:instant,generatedAt:at,items:publicItems(rows,instant),schedule:schedule(instant),appearance:{mode:'dark'},upcoming:[],warnings:warnings(rows,instant),timeline:rows.filter(permitted).map(item=>({id:item.id,title:item.internalName||item.title,phase:phase(item,instant)}))};
      }else if(/^items(?:\/[\w-]+)?$/.test(name)&&['POST','PUT'].includes(method)){
        const id=name.split('/')[1],old=state.records.find(item=>item.id===id);
        assert.ok(permitted(raw),'UI attempted an unauthorized mutation');
        if(old){assert.ok(permitted(old));assert.equal(raw.version,old.version);}
        const value=validate(raw);
        body={...value,id:id||'development-created-'+(state.writes.length+1),version:(old?.version||0)+1,updatedAt:at,updatedBy:'test@example.com',createdAt:old?.createdAt||at,createdBy:old?.createdBy||'test@example.com'};
        state.writes.push({method,name,raw:structuredClone(raw),saved:body});state.records=state.records.filter(item=>item.id!==body.id).concat(body);status=old?200:201;
      }else throw Error('Unexpected mocked API '+method+' '+name);
    }catch(error){errors.push(error.message);status=500;body={error:error.message};}
    try{await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});}catch(error){if(!context.pages().every(page=>page.isClosed()))errors.push(error.message);}
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/admin/display/');
  return {...state,state,context,page};
}
async function screen(page){await page.locator('#screen-editor .tv-stage').waitFor();await page.locator('#screen-add-announcement').waitFor();}
async function cancel(page){await page.locator('#cancel').click();if(await page.locator('#confirm[open]').count())await page.locator('#confirm #yes').click();await screen(page);}
async function shot(page,name){if(screenshots){await mkdir(screenshots,{recursive:true});await page.screenshot({path:path.join(screenshots,name),fullPage:true});}}

try{
  const sw=await readFile(path.join(dist,'display/sw.js'),'utf8');
  assert.ok(sw.includes('/display-assets/renderer.js'),'public renderer remains in offline manifest');
  for(const asset of ['admin.screen.js','admin.js','admin.css'])assert.ok(!sw.includes('/display-assets/'+asset),`${asset} must remain out of public offline manifest`);
  const publicPage=await browser.newPage({viewport:{width:1920,height:1080}});
  await publicPage.goto(origin+'/__public_view__');
  await publicPage.evaluate(async snapshot=>{
    const {DisplayView}=await import('/display-assets/renderer.js');
    window.publicView=new DisplayView(document.querySelector('#public-check'));
    window.publicView.update(snapshot,{preview:true});
  },{at,schedule:schedule(at),items:publicItems([...initial,dedication],at),appearance:{mode:'dark'},upcoming:[],warnings:[]});
  assert.equal(await publicPage.locator('.announcement-section').count(),10);
  assert.equal(await publicPage.locator('[role=button],[data-screen-edit],[data-screen-area],.screen-edit-target').count(),0,'admin edit controls must not change the public DisplayView');
  await publicPage.close();

  // Direct clicks must select the exact underlying record, not its merged area.
  const full=await scenario(),{page,state}=full;
  await screen(page);
  assert.equal(await page.locator('#screen-editor .announcement-section').count(),10);
  assert.equal(await page.locator('#screen-editor').getByText('PRIVATE SPONSOR',{exact:false}).count(),0);
  const source=initial.find(item=>item.id==='uploaded-poster-hall-booking');
  await page.locator(`.announcement-section[data-source-id="${source.id}"]`).click();
  await page.locator('#editor').waitFor();
  assert.equal(await page.locator('[name=title]').inputValue(),source.title);
  assert.equal(await page.locator('[name=internalName]').inputValue(),source.internalName);
  assert.equal(await page.locator('[name=startLocal]').inputValue(),localStamp(source.startsAt));
  assert.equal(await page.locator('[name=untilOff]').isChecked(),true);
  await page.locator('[name=message]').fill(source.data.message+' Development draft edit.');
  await page.locator('#draft').click();await screen(page);
  assert.equal(state.writes.length,1);assert.equal(state.writes[0].raw.version,7);
  assert.equal(state.writes[0].raw.status,'draft');assert.equal(state.writes[0].saved.startsAt,source.startsAt);assert.equal(state.writes[0].saved.endsAt,null);
  assert.equal(await page.locator(`.announcement-section[data-source-id="${source.id}"]`).count(),0,'draft must not appear in live-shaped screen');

  // Adding through a selected area persists the explicit group without publishing.
  await page.locator('[data-screen-area="hall"]').click();
  await page.locator('#screen-add-announcement').click();await page.locator('#editor').waitFor();
  assert.equal(await page.locator('[name=displayGroup]').inputValue(),'hall');
  await page.locator('[name=title]').fill('DEVELOPMENT DRAFT FROM SCREEN');
  await page.locator('[name=message]').fill('Created in a selected screen area for a private automated test.');
  await page.locator('#draft').click();await screen(page);
  assert.equal(state.writes.at(-1).raw.data.displayGroup,'hall');assert.equal(state.writes.at(-1).raw.status,'draft');
  assert.equal(await page.locator('[data-screen-area="hall"]').getAttribute('aria-pressed'),'true','selected area must persist after saving');
  assert.equal(state.writes.at(-1).saved.startsAt,null,'new draft must not gain a live start time');
  assert.ok(state.writes.every(write=>write.raw.status==='draft'));

  // Normal-size keyboard controls and group-heading clicks are equivalent.
  await page.locator('[data-screen-area="community"]').focus();await page.keyboard.press('Enter');
  await page.locator('#screen-add-announcement').click();assert.equal(await page.locator('[name=displayGroup]').inputValue(),'community');
  await cancel(page);
  assert.equal(await page.locator('[data-screen-area="community"]').getAttribute('aria-pressed'),'true','selected area must persist after cancel');
  await page.locator('.announcement-group[data-announcement-group="rav"] h2').click();
  await page.locator('#screen-add-announcement').click();assert.equal(await page.locator('[name=displayGroup]').inputValue(),'rav');
  await cancel(page);
  assert.equal(await page.locator('[data-screen-area="rav"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-screen-area="support"]').click();
  const appeal=initial.find(item=>item.id==='uploaded-poster-yom-tov-appeal');
  await page.locator(`[data-screen-edit="${appeal.id}"]`).click();assert.equal(await page.locator('[name=internalName]').inputValue(),appeal.internalName);await cancel(page);
  assert.equal(await page.locator('[data-screen-area="support"]').getAttribute('aria-pressed'),'true','editing an item keeps its selected area');
  await shot(page,'admin-screen-desktop.png');
  await page.locator('#saved-items').click();await page.locator('#list').waitFor();
  await page.locator('#screen-layout').click();await screen(page);
  await full.context.close();

  // Mobile users can choose/edit content with full-size controls below the screen.
  const mobile=await scenario({mobile:true});await screen(mobile.page);
  assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const targets=await mobile.page.locator('[data-screen-area]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  assert.ok(targets.length>=4);assert.ok(targets.every(height=>height>=44),'area choices need phone-sized tap targets');
  await mobile.page.locator('[data-screen-area="rav"]').click();await mobile.page.locator('#screen-add-announcement').click();
  assert.equal(await mobile.page.locator('[name=displayGroup]').inputValue(),'rav');await cancel(mobile.page);
  assert.equal(await mobile.page.locator('[data-screen-area="rav"]').getAttribute('aria-pressed'),'true');
  await shot(mobile.page,'admin-screen-mobile.png');await mobile.context.close();

  // Restricted admins see the whole public screen but can edit only their kinds.
  const restricted=await scenario({capabilities:['dedications']});
  await restricted.page.locator('#screen-editor .tv-stage').waitFor();
  assert.equal(await restricted.page.locator('#screen-add-announcement').count(),0);
  assert.equal(await restricted.page.locator('.announcement-section[role=button]').count(),0);
  assert.deepEqual(await restricted.page.locator('[data-screen-edit]').evaluateAll(nodes=>nodes.map(node=>node.dataset.screenEdit)),[dedication.id]);
  await restricted.page.locator('#screen-add-dedication').click();await restricted.page.locator('[name=sponsor]').waitFor();
  assert.equal(restricted.state.writes.length,0);await restricted.context.close();
  const announcementsOnly=await scenario({capabilities:['announcements']});await screen(announcementsOnly.page);
  assert.equal(await announcementsOnly.page.locator('#screen-add-dedication').count(),0);
  assert.equal(await announcementsOnly.page.locator('.board-dedication[role=button]').count(),0);
  await announcementsOnly.context.close();

  // Empty areas are still usable and never require fake publicly visible notices.
  const empty=await scenario({records:[]});await screen(empty.page);
  assert.equal(await empty.page.locator('#screen-editor .announcement-section').count(),0);
  await empty.page.locator('[data-screen-area="support"]').click();await empty.page.locator('#screen-add-announcement').click();
  assert.equal(await empty.page.locator('[name=displayGroup]').inputValue(),'support');assert.equal(empty.state.writes.length,0);await empty.context.close();

  // A late preview response cannot restore the screen after navigation away.
  const delayed=await scenario({delayPreview:true});await delayed.state.previewStarted.promise;
  await delayed.page.locator('#saved-items').click();await delayed.page.locator('#list').waitFor();
  delayed.state.previewRelease.resolve();await delayed.page.waitForTimeout(200);
  assert.equal(await delayed.page.locator('#screen-editor').count(),0);assert.equal(await delayed.page.locator('#list').isVisible(),true);
  await delayed.context.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: screen-shaped admin, exact notice editing, persistent area selection, draft/version/timing preservation, mobile controls, restricted capabilities, empty areas, stale-response navigation, public display unchanged, and admin modules excluded from public offline cache. No database writes.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
