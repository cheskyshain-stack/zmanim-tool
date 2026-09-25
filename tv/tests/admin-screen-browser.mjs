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

async function scenario({capabilities=['full'],records=[...initial,dedication],mobile=false,delayPreview=false,hideConflict=false}={}){
  const context=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:1100}});
  await context.addInitScript(instant=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return NativeDate.parse(instant);}};},at);
  const state={records:structuredClone(records),writes:[],hideAttempts:[],previewCalls:0,previewStarted:deferred(),previewRelease:deferred()};
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
      }else if(/^items\/[\w-]+\/hide$/.test(name)&&method==='POST'){
        const id=name.split('/')[1],old=state.records.find(item=>item.id===id);
        assert.ok(old,'The removal must address a saved item');
        assert.ok(permitted(old),'UI attempted an unauthorized removal');
        assert.deepEqual(raw,{version:old.version},'Removal uses the saved version without replacing content');
        state.hideAttempts.push({name,raw:structuredClone(raw)});
        if(hideConflict){status=409;body={error:'This item changed. Reopen it first.'};}
        else{
          const saved={...old,status:'hidden',version:old.version+1,updatedAt:at,updatedBy:'test@example.com'};
          state.writes.push({method,name,raw:structuredClone(raw),saved});
          state.records=state.records.map(item=>item.id===id?saved:item);body={ok:true};
        }
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
async function crop(page,selector,name){if(screenshots){await mkdir(screenshots,{recursive:true});await page.locator(selector).screenshot({path:path.join(screenshots,name)});}}

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

  // Names and the anonymous checkbox are optional through preview and publishing.
  const nameless=await scenario({records:initial}),namelessPage=nameless.page;
  const dedicationText='לזכות כל לומדי בית המדרש\nולהצלחת כל הקהילה\nבברכת שנה טובה';
  await screen(namelessPage);
  const available=namelessPage.locator('.board-left-rail>.board-dedication');
  assert.equal(await available.getAttribute('role'),'button');
  assert.equal(await available.getAttribute('aria-label'),'Add פרנס היום sponsorship');
  assert.match(await available.textContent(),/Sponsorship available/);
  await available.click();await namelessPage.locator('#editor').waitFor();
  assert.equal(await namelessPage.locator('[name=sponsor]').inputValue(),'');
  assert.equal(await namelessPage.locator('[name=dedicationName]').inputValue(),'');
  assert.equal(await namelessPage.locator('[name=anonymous]').isChecked(),false);
  assert.equal(await namelessPage.locator('[name=sponsorshipDate]').inputValue(),'','New dedication must not automatically choose today');
  assert.equal(await namelessPage.locator('#dedication-calendar [aria-pressed=true]').count(),0);
  assert.equal(await namelessPage.locator('#dedication-manual-date').getAttribute('open'),null,'Manual date entry is secondary');
  await namelessPage.locator('[name=dedicationText]').fill(dedicationText);
  await namelessPage.locator('[name=timing]').selectOption('civil');
  await namelessPage.locator('#dedication-calendar [data-date="2026-09-24"]').click();
  await namelessPage.waitForFunction(start=>document.querySelector('[name=startLocal]')?.value===start,localStamp(dateInfo('2026-09-24').civilStart));
  await namelessPage.locator('#preview').click();await namelessPage.locator('#preview-host .dedication-text').waitFor();
  assert.equal(await namelessPage.locator('#preview-host .dedication-text').textContent(),dedicationText);
  assert.equal(await namelessPage.locator('#preview-host .board-dedication .sponsor').count(),0);
  assert.equal(nameless.state.writes.length,0,'preview must not publish the nameless dedication');
  await namelessPage.locator('#back').click();await namelessPage.locator('#editor').waitFor();
  assert.equal(await namelessPage.locator('[name=dedicationText]').inputValue(),dedicationText);
  await namelessPage.locator('#editor button[type=submit]').click();await namelessPage.locator('#confirm[open]').waitFor();
  assert.equal(nameless.state.writes.length,0,'publishing still waits for the normal confirmation');
  await namelessPage.locator('#confirm #yes').click();await screen(namelessPage);
  assert.equal(nameless.state.writes.length,1);
  const published=nameless.state.writes[0].saved;
  assert.equal(published.status,'published');assert.equal(published.data.sponsor,'');
  assert.equal(published.data.dedicationName,'');assert.equal(published.data.anonymous,false);
  assert.equal(published.data.dedicationText,dedicationText);
  assert.equal(published.startsAt,dateInfo('2026-09-24').civilStart);
  assert.equal(published.endsAt,dateInfo('2026-09-24').civilEnd);
  assert.equal(await namelessPage.locator('#screen-editor .dedication-text').textContent(),dedicationText);
  const namelessPublic=await nameless.context.newPage();await namelessPublic.goto(origin+'/__public_view__');
  await namelessPublic.evaluate(async snapshot=>{
    const {DisplayView}=await import('/display-assets/renderer.js');
    window.publicView=new DisplayView(document.querySelector('#public-check'));
    window.publicView.update(snapshot,{preview:true});
  },{at,schedule:schedule(at),items:publicItems(nameless.state.records,at),appearance:{mode:'dark'},upcoming:[],warnings:[]});
  assert.equal(await namelessPublic.locator('.board-dedication .dedication-text').textContent(),dedicationText);
  assert.equal(await namelessPublic.locator('.board-dedication .sponsor').count(),0);
  assert.doesNotMatch(await namelessPublic.locator('.board-dedication').textContent(),/anonymous/i,'blank sponsor must not create an anonymous placeholder');
  await nameless.context.close();

  // Calendar selection, manual English dates and Hebrew conversion all update
  // one sponsorship date and the same existing evening-window calculation.
  const calendar=await scenario({records:initial}),cp=calendar.page;
  await screen(cp);await cp.locator('#screen-add-dedication').click();await cp.locator('#editor').waitFor();
  await cp.locator('#dedication-calendar [data-date="2026-09-26"]').waitFor();
  assert.equal(await cp.locator('[name=sponsorshipDate]').inputValue(),'');
  assert.equal(await cp.locator('[name=startLocal]').inputValue(),'');
  assert.equal(await cp.locator('[name=endLocal]').inputValue(),'');
  assert.match(await cp.locator('#dedication-selection').textContent(),/Choose a day/);
  await cp.locator('[name=timing]').selectOption('custom');
  assert.equal(await cp.locator('[name=startLocal]').isEditable(),true,'Custom timing is editable before choosing a sponsorship date');
  assert.equal(await cp.locator('[name=endLocal]').isEditable(),true);
  await cp.locator('[name=untilOff]').check();
  assert.equal(await cp.locator('[name=endLocal]').isDisabled(),true,'Until turned off disables the custom end date');
  await cp.locator('[name=untilOff]').uncheck();
  await cp.locator('[name=timing]').selectOption('evening');
  await cp.locator('[data-shortcut=custom]').click();
  assert.equal(await cp.locator('[name=timing]').inputValue(),'custom');
  assert.equal(await cp.locator('[name=startLocal]').evaluate(node=>node===document.activeElement),true,'Choose dates focuses the editable custom start');
  await cp.locator('[name=timing]').selectOption('evening');
  const holiday=cp.locator('#dedication-calendar [data-date="2026-09-26"]');
  assert.ok(await holiday.locator('.hebrew-date').textContent());
  assert.match(await holiday.locator('.calendar-holiday').allTextContents().then(x=>x.join(' ')),/סוכות|Sukkos/i);
  await holiday.click();
  await cp.waitForFunction(start=>document.querySelector('[name=startLocal]').value===start,localStamp(dateInfo('2026-09-26').previousSunset));
  assert.equal(await cp.locator('[name=sponsorshipDate]').inputValue(),'2026-09-26');
  assert.equal(await cp.locator('[name=timing]').inputValue(),'evening');
  assert.equal(await cp.locator('[name=endLocal]').inputValue(),localStamp(dateInfo('2026-09-26').sunset));
  assert.equal(await holiday.getAttribute('aria-pressed'),'true');
  assert.match(await cp.locator('#dedication-selection').textContent(),/2026-09-26/);
  assert.equal(await cp.locator('[name=hebrewDay]').inputValue(),String(dateInfo('2026-09-26').hebrew.dayOfMonth));
  await cp.locator('#dedication-manual-date summary').click();
  await cp.locator('[name=sponsorshipDate]').fill('2026-10-02');
  await cp.locator('#dedication-calendar [data-date="2026-10-02"][aria-pressed=true]').waitFor();
  await cp.waitForFunction(start=>document.querySelector('[name=startLocal]').value===start,localStamp(dateInfo('2026-10-02').previousSunset));
  assert.equal(await cp.locator('[name=hebrewDay]').inputValue(),'21');
  await cp.locator('[name=hebrewDay]').fill('1');
  await cp.locator('[name=hebrewMonth]').selectOption('7');
  await cp.locator('[name=hebrewYear]').fill('5787');
  await cp.locator('#convert-date').click();
  await cp.locator('#dedication-calendar [data-date="2026-09-12"][aria-pressed=true]').waitFor();
  await cp.waitForFunction(()=>document.querySelector('[name=sponsorshipDate]').value==='2026-09-12');
  assert.equal(await cp.locator('[name=hebrewDay]').inputValue(),'1');
  await cp.locator('#dedication-calendar [data-date="2026-09-26"]').click();
  await cp.locator('[name=dedicationText]').fill('Calendar-selected evening dedication for this private test.');
  await cp.waitForFunction(start=>document.querySelector('[name=startLocal]').value===start,localStamp(dateInfo('2026-09-26').previousSunset));
  await cp.locator('#dedication-manual-date summary').click();
  await shot(cp,'admin-dedication-calendar-desktop.png');
  await crop(cp,'.dedication-date-picker','admin-dedication-calendar-crop.png');
  await cp.locator('#editor button[type=submit]').click();await cp.locator('#confirm[open]').waitFor();
  assert.equal(calendar.state.writes.length,0);
  await cp.locator('#confirm #yes').click();await screen(cp);
  const evening=calendar.state.writes.at(-1).saved;
  assert.equal(evening.data.sponsorshipDate,'2026-09-26');
  assert.equal(evening.startsAt,dateInfo('2026-09-26').previousSunset);
  assert.equal(evening.endsAt,dateInfo('2026-09-26').sunset);
  assert.equal(evening.status,'published');
  assert.equal(await cp.locator(`[data-screen-remove="${evening.id}"]`).count(),1,'Future published dedication has a removal action');
  await cp.reload();await screen(cp);
  await cp.locator(`[data-screen-edit="${evening.id}"]`).click();
  await cp.locator('#dedication-calendar [data-date="2026-09-26"][aria-pressed=true]').waitFor();
  assert.equal(await cp.locator('[name=sponsorshipDate]').inputValue(),'2026-09-26','Saved date survives reopening');
  await calendar.context.close();

  // An undated draft remains undated; opening a new calendar must not activate it.
  const undated=await scenario({records:[]}),up=undated.page;
  await screen(up);await up.locator('.board-dedication').focus();await up.keyboard.press('Enter');await up.locator('#editor').waitFor();
  await up.locator('[name=dedicationText]').fill('Undated private draft.');
  await up.locator('#draft').click();await screen(up);
  const draft=undated.state.writes.at(-1).saved;
  assert.equal(draft.status,'draft');assert.equal(draft.data.sponsorshipDate,'');
  assert.equal(draft.startsAt,null);assert.equal(draft.endsAt,null);
  assert.equal(await up.locator(`[data-screen-remove="${draft.id}"]`).count(),0);
  await undated.context.close();

  // Both active and upcoming removal actions hide the saved record, retain its
  // complete contents, and remain effective after a fresh dashboard load.
  const future={...evening,id:'development-future-dedication',version:5};
  const removal=await scenario({records:[...initial,dedication,future]}),rp=removal.page;
  await screen(rp);
  assert.equal(await rp.locator('[data-screen-remove]').count(),2);
  await shot(rp,'admin-dedication-removal-controls.png');
  await crop(rp,'.screen-dedication-controls','admin-dedication-removal-crop.png');
  await rp.locator(`[data-screen-edit="${dedication.id}"]`).click();
  await rp.locator('#remove-dedication').click();await screen(rp);
  assert.equal(removal.state.writes.length,1);
  assert.equal(removal.state.writes[0].name,`items/${dedication.id}/hide`);
  assert.equal(removal.state.writes[0].raw.version,3);
  const hidden=removal.state.records.find(item=>item.id===dedication.id);
  assert.equal(hidden.status,'hidden');assert.equal(hidden.version,4);
  assert.deepEqual(hidden.data,dedication.data);assert.equal(hidden.startsAt,dedication.startsAt);
  assert.equal(await rp.locator('#screen-editor .board-dedication .dedication-text').count(),0);
  assert.equal(await rp.locator('#screen-editor .board-dedication .dedication-available').count(),1,'Removing the active dedication restores the availability card');
  await rp.reload();await screen(rp);
  assert.equal(await rp.locator(`[data-screen-remove="${dedication.id}"]`).count(),0);
  await rp.locator(`[data-screen-remove="${future.id}"]`).click();
  await rp.locator(`[data-screen-remove="${future.id}"]`).waitFor({state:'detached'});
  await rp.reload();await screen(rp);
  assert.equal(await rp.locator('[data-screen-remove]').count(),0);
  assert.equal(removal.state.records.length,initial.length+2,'Removal must not delete the saved record');
  assert.equal(removal.state.records.find(item=>item.id===future.id).status,'hidden');
  assert.deepEqual(removal.state.records.find(item=>item.id===future.id).data,future.data);
  assert.ok(removal.state.writes.every(write=>write.method==='POST'&&write.name.endsWith('/hide')));
  await removal.context.close();

  // A concurrent edit rejects the saved version. The UI must keep the
  // dedication visible, show the actionable error, and re-enable controls.
  const conflict=await scenario({hideConflict:true}),xp=conflict.page;
  await screen(xp);await xp.locator(`[data-screen-remove="${dedication.id}"]`).click();
  await xp.waitForFunction(()=>document.querySelector('#error')?.textContent.includes('This item changed. Reopen it first.'));
  await xp.waitForFunction(id=>!document.querySelector(`[data-screen-remove="${id}"]`)?.disabled,dedication.id);
  assert.equal(conflict.state.writes.length,0);
  assert.deepEqual(conflict.state.hideAttempts,[{name:`items/${dedication.id}/hide`,raw:{version:3}}]);
  assert.equal(conflict.state.records.find(item=>item.id===dedication.id).status,'published');
  assert.equal(await xp.locator('#screen-editor .board-dedication .dedication-text').textContent(),dedication.data.dedicationText);
  await xp.reload();await screen(xp);
  assert.equal(await xp.locator(`[data-screen-remove="${dedication.id}"]`).count(),1);
  assert.equal(conflict.state.records.find(item=>item.id===dedication.id).version,3);
  await conflict.context.close();

  // Mobile users can choose/edit content with full-size controls below the screen.
  const mobile=await scenario({mobile:true});await screen(mobile.page);
  assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const targets=await mobile.page.locator('[data-screen-area]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  assert.ok(targets.length>=4);assert.ok(targets.every(height=>height>=44),'area choices need phone-sized tap targets');
  await mobile.page.locator('[data-screen-area="rav"]').click();await mobile.page.locator('#screen-add-announcement').click();
  assert.equal(await mobile.page.locator('[name=displayGroup]').inputValue(),'rav');await cancel(mobile.page);
  assert.equal(await mobile.page.locator('[data-screen-area="rav"]').getAttribute('aria-pressed'),'true');
  await mobile.page.locator('#screen-add-dedication').click();
  await mobile.page.locator('#dedication-calendar [data-date="2026-09-26"]').waitFor();
  assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'393px calendar must not create horizontal overflow');
  await mobile.page.locator('#dedication-calendar [data-date="2026-09-26"]').click();
  await mobile.page.waitForFunction(()=>document.querySelector('[name=sponsorshipDate]').value==='2026-09-26');
  await shot(mobile.page,'admin-dedication-calendar-mobile.png');
  await mobile.page.locator('#dedication-manual-date summary').click();
  assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Expanded manual English/Hebrew fields fit a phone');
  await cancel(mobile.page);
  await shot(mobile.page,'admin-screen-mobile.png');await mobile.context.close();

  // Restricted admins see the whole public screen but can edit only their kinds.
  const restricted=await scenario({capabilities:['dedications']});
  await restricted.page.locator('#screen-editor .tv-stage').waitFor();
  assert.equal(await restricted.page.locator('#screen-add-announcement').count(),0);
  assert.equal(await restricted.page.locator('.announcement-section[role=button]').count(),0);
  assert.equal(await restricted.page.locator(`[data-screen-remove="${dedication.id}"]`).count(),1);
  assert.deepEqual(await restricted.page.locator('[data-screen-edit]').evaluateAll(nodes=>nodes.map(node=>node.dataset.screenEdit)),[dedication.id]);
  await restricted.page.locator('#screen-add-dedication').click();await restricted.page.locator('[name=sponsor]').waitFor();
  assert.equal(restricted.state.writes.length,0);await restricted.context.close();
  const announcementsOnly=await scenario({capabilities:['announcements']});await screen(announcementsOnly.page);
  assert.equal(await announcementsOnly.page.locator('#screen-add-dedication').count(),0);
  assert.equal(await announcementsOnly.page.locator('.board-dedication[role=button]').count(),0);
  assert.equal(await announcementsOnly.page.locator('[data-screen-remove],#remove-dedication').count(),0,'Announcement-only admins cannot remove dedications');
  await announcementsOnly.context.close();

  // Empty areas are still usable and never require fake publicly visible notices.
  const empty=await scenario({records:[]});await screen(empty.page);
  assert.equal(await empty.page.locator('#screen-editor .announcement-section').count(),0);
  await empty.page.locator('.board-dedication').focus();await empty.page.keyboard.press('Space');
  await empty.page.locator('#dedication-calendar').waitFor();
  assert.equal(await empty.page.locator('[name=sponsorshipDate]').inputValue(),'','Keyboard activation opens an undated dedication draft');
  await cancel(empty.page);
  await empty.page.locator('[data-screen-area="support"]').click();await empty.page.locator('#screen-add-announcement').click();
  assert.equal(await empty.page.locator('[name=displayGroup]').inputValue(),'support');assert.equal(empty.state.writes.length,0);await empty.context.close();

  // A late preview response cannot restore the screen after navigation away.
  const delayed=await scenario({delayPreview:true});await delayed.state.previewStarted.promise;
  await delayed.page.locator('#saved-items').click();await delayed.page.locator('#list').waitFor();
  delayed.state.previewRelease.resolve();await delayed.page.waitForTimeout(200);
  assert.equal(await delayed.page.locator('#screen-editor').count(),0);assert.equal(await delayed.page.locator('#list').isVisible(),true);
  await delayed.context.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: screen-shaped admin, exact notice editing, persistent area selection, nameless publishing, sponsorship calendar/Hebrew/manual sync, undated drafts, evening/custom timing, versioned active/future dedication removal with reload and conflict preservation, mobile calendar/controls, restricted capabilities, empty areas, stale-response navigation, public display unchanged, and admin modules excluded from public offline cache. No database writes.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
