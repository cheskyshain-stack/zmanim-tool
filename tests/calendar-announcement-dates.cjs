// Local Workerd only. Exercise real account permissions, date ordering and history bounds.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomBytes,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'worker/calendar');
const {build}=require(require.resolve('esbuild',{paths:[runtime]}));
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[runtime]}));
(async()=>{
 let origin='http://127.0.0.1:8999',endpoint='',server;
 const setupToken=randomBytes(32).toString('hex');
 if(process.env.CALENDAR_DATE_BROWSER==='1'){
  server=require('node:http').createServer((req,res)=>{
   if(req.url.split('?')[0]==='/data/calendar.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({endpoint}));}
   let file=path.resolve(root,'dist','.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(path.join(root,'dist')+path.sep))return res.writeHead(403).end();
   if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file))return res.writeHead(404).end();
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 }
 const bundle=await build({entryPoints:[path.join(runtime,'worker.js')],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
 const options={name:'announcement-dates-test',modules:true,compatibilityDate:'2026-10-01',isolatedResourcePersistencePath:fs.mkdtempSync(path.join(os.tmpdir(),'announcement-migration-')),bindings:{ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(setupToken).digest('hex')},durableObjects:{CALENDAR:{className:'CommunityCalendar',useSQLite:true}}};
 const legacy={id:'legacy-existing-01',sequence:1,text:'Existing announcement before the date index',authorId:'previous-author',createdAt:new Date(Date.now()-20*86400000).toISOString()};
 let backend=new Miniflare(convertV4MiniflareOptions({...options,script:`import {DurableObject} from 'cloudflare:workers';export class CommunityCalendar extends DurableObject{constructor(ctx,env){super(ctx,env);this.ctx=ctx;}async fetch(){const message=${JSON.stringify(legacy)};await this.ctx.storage.put({'announcement:legacy-existing-01':message,'announcement-order:0000000000000001':message.id,'announcement-count':1});return new Response('seeded');}}export default{fetch(request,env){return env.CALENDAR.get(env.CALENDAR.idFromName('lakewood-commons')).fetch(request);}}`}));
 await backend.ready;const seeded=await backend.dispatchFetch('https://fixture.test/');assert.equal(await seeded.text(),'seeded');
 await backend.setOptions(convertV4MiniflareOptions({...options,script:bundle.outputFiles[0].text}));
 try {
  endpoint=(await backend.ready).origin;
  const call=async(route,method='GET',body,token)=>{
   const response=await backend.dispatchFetch(endpoint+route,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,body:await response.json()};
  };
  const owner=(await call('/api/setup','POST',{setupToken,name:'Synthetic owner',email:'owner@example.test',password:'Synthetic owner password 2026'})).body;
  const invitation=(await call('/api/access','POST',{name:'Synthetic editor',email:'editor@example.test'},owner.token)).body;
  const editor=(await call('/api/invitations/claim','POST',{token:invitation.token,password:'Synthetic editor password 2026'})).body;
  const viewer=(await call('/api/register','POST',{name:'Synthetic viewer',email:'viewer@example.test',password:'Synthetic viewer password 2026'})).body;
  const post=async(addedAt,text='Synthetic date update')=>{
   const result=await call('/api/announcements','POST',{id:randomBytes(16).toString('hex'),text,...(addedAt?{addedAt}:{})},owner.token);assert.equal(result.status,201,JSON.stringify(result));return result.body.message;
  };
  const oldAt=new Date(Date.now()-15*86400000).toISOString(),recentAt=new Date(Date.now()-3600000).toISOString();
  const old=await post(oldAt),recent=await post(recentAt),fresh=await post();
  let feed=(await call('/api/announcements','GET',null,viewer.token)).body;
  assert.deepEqual(feed.messages.map(value=>value.id),[fresh.id,recent.id]);assert.equal(feed.unread,2);assert.equal(feed.historyDays,10);
  const managerFeed=(await call('/api/announcements','GET',null,owner.token)).body;
  assert.equal(managerFeed.messages.length,4);assert.equal(managerFeed.messages.at(-1).id,legacy.id,'Existing messages survive date-index backfill');
  assert.equal((await call('/api/announcements?view=congregation','GET',null,editor.token)).body.messages.length,2);
  assert.equal((await call('/api/announcements/open?view=congregation','POST',{id:randomBytes(16).toString('hex')},owner.token)).body.messages.length,2);
  for(const query of ['?days=1000','?view=admin','?before='+old.sequence]) assert(!(await call('/api/announcements'+query,'GET',null,viewer.token)).body.messages.some(value=>value.id===old.id));
  await call('/api/announcements/read','POST',{ids:[recent.id]},viewer.token);
  const edit={text:recent.text,addedAt:oldAt,revision:1,operationId:randomBytes(16).toString('hex')};
  assert.equal((await call('/api/announcements/'+recent.id,'PUT',edit,viewer.token)).status,403);
  let changed=await call('/api/announcements/'+recent.id,'PUT',edit,editor.token);assert.equal(changed.status,200);assert.equal(changed.body.message.createdAt,recent.createdAt);assert.equal(changed.body.message.addedAt,oldAt);
  assert.equal((await call('/api/announcements/'+recent.id,'PUT',edit,editor.token)).body.message.revision,2);
  assert.equal((await call('/api/announcements/'+recent.id,'PUT',{...edit,addedAt:recentAt},editor.token)).status,409);
  assert.equal((await call('/api/announcements/'+recent.id,'PUT',{...edit,operationId:randomBytes(16).toString('hex'),revision:2,addedAt:'2099-01-01T00:00:00.000Z'},editor.token)).status,400);
  feed=(await call('/api/announcements','GET',null,viewer.token)).body;assert.deepEqual(feed.messages.map(value=>value.id),[fresh.id]);assert.equal(feed.unread,1);
  const updates=(await call('/api/announcements/updates?after=0','GET',null,viewer.token)).body;assert.equal(updates.messages.length,0);assert(updates.hiddenIds.includes(recent.id));
  changed=await call('/api/announcements/'+recent.id,'PUT',{...edit,addedAt:recentAt,revision:2,operationId:randomBytes(16).toString('hex')},owner.token);assert.equal(changed.status,200);
  feed=(await call('/api/announcements','GET',null,viewer.token)).body;assert.equal(feed.messages.find(value=>value.id===recent.id).read,true);assert.equal(feed.unread,1);
  const {midnight,shiftDate,civilDate}=await import('../worker/traffic-calendar.js');
  const cutoff=midnight(shiftDate(civilDate(Date.now()),-9));
  const boundary=await post(new Date(cutoff).toISOString()),outside=await post(new Date(cutoff-1).toISOString());
  feed=(await call('/api/announcements','GET',null,viewer.token)).body;assert(feed.messages.some(value=>value.id===boundary.id));assert(!feed.messages.some(value=>value.id===outside.id));
  for(let i=0;i<32;i++)await post(recentAt,'Same-minute message '+i);
  let cursor=null,ids=[];
  do {feed=(await call('/api/announcements'+(cursor?'?cursor='+encodeURIComponent(cursor):''),'GET',null,owner.token)).body;assert(Array.isArray(feed.messages),JSON.stringify(feed));ids.push(...feed.messages.map(value=>value.id));cursor=feed.nextCursor;}while(cursor);
  assert.equal(ids.length,38);assert.equal(new Set(ids).size,38);assert.equal(ids.at(-1),legacy.id);
  assert.equal((await call('/api/announcements?cursor=invalid','GET',null,viewer.token)).status,400);
  const beforeDelete=(await call('/api/announcements','GET',null,owner.token)).body;
  assert(beforeDelete.nextCursor);
  await call('/api/announcements/'+beforeDelete.messages.at(-1).id,'DELETE',null,owner.token);
  const afterDelete=(await call('/api/announcements?cursor='+encodeURIComponent(beforeDelete.nextCursor),'GET',null,owner.token)).body;assert(afterDelete.messages.length>0,'A frozen date cursor survives deletion of its last row');
  const info=(await call('/api/info')).body;assert.equal(info.announcementDateEditing,true);assert.equal(info.announcementHistoryDays,10);
  if(server){
   const {chromium}=require('playwright'),{calendarAnnouncementLocalTime}=await import('../js/calendar/announcement-model.js');
   const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true}),errors=[],output=fs.mkdtempSync(path.join(os.tmpdir(),'announcement-date-browser-'));
   try{
    const prepare=async(session,width)=>{
     const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Jerusalem'});
     await context.addInitScript(value=>{localStorage.setItem('zmanim-nocount','1');localStorage.setItem('zmanim-admin-unlock',JSON.stringify({at:Date.now()}));sessionStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify(value));},session);
     const page=await context.newPage(), requests=[];
     const isFirstPage=url=>{const parsed=new URL(url);return parsed.pathname==='/api/announcements'&&!parsed.searchParams.has('cursor')&&!parsed.searchParams.has('before');};
     page.on('pageerror',e=>errors.push(e.message));
     page.on('request',request=>{if(request.method()!=='OPTIONS')requests.push(new URL(request.url()).pathname);});
     const preloaded=page.waitForResponse(response=>isFirstPage(response.url())&&response.request().method()==='GET'&&response.ok());
     await page.goto(origin+'/admin/calendar/');
     await page.locator('.shul-calendar').waitFor();
     const initial=await (await preloaded).json();
     assert(initial.unread>0,'The preload fixture includes unread messages');
     await page.locator(`[data-cal-announcements][aria-label$=", ${initial.unread} unread"]`).waitFor();
     assert(!requests.includes('/api/announcements/open')&&!requests.includes('/api/announcements/read'),'Preloading neither opens nor reads messages');
     let pageFetches=0;
     const blockFirstPage=route=>{pageFetches++;return route.abort();};
     await page.route(isFirstPage,blockFirstPage);
     for(let opening=0;opening<2;opening++){
      if(opening)await page.locator('.cal-announcements-dialog [data-cal-close]').click();
      const recorded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/announcements/open'&&response.request().method()==='POST'&&response.ok());
      const firstFrame=await page.evaluate(()=>{
       document.querySelector('[data-cal-announcements]').click();
       const feed=document.querySelector('.cal-announcement-feed');
       const cards=feed.querySelectorAll('[data-announcement-id]');
       return {count:cards.length,last:cards[cards.length-1]?.dataset.announcementId,atBottom:feed.scrollHeight-feed.clientHeight-feed.scrollTop<=2};
      });
      assert.deepEqual(firstFrame,{count:initial.messages.length,last:fresh.id,atBottom:true},'The first render opens the preloaded feed at the newest message');
      assert(!Object.hasOwn(await (await recorded).json(),'messages'),'Recording an open does not download the feed again');
     }
     assert.equal(pageFetches,0,'Opening and reopening an unchanged feed require no first-page request');
     await page.unroute(isFirstPage,blockFirstPage);
     return page;
    };
    const manager=await prepare(owner,393),congregant=await prepare(viewer,393);
    const managerDialog = manager.getByRole('dialog', { name: 'Announcements' });
    const managerFeed = managerDialog.locator('.cal-announcement-feed');
    const managerCards = managerFeed.locator('[data-announcement-id]');
    const composer = managerDialog.locator('.cal-announcement-compose');
    const managerAtBottom = () => managerFeed.evaluate(feed => feed.scrollHeight - feed.clientHeight - feed.scrollTop <= 2);
    assert.equal(await managerCards.last().getAttribute('data-announcement-id'),fresh.id,'The manager opens with the newest announcement last');
    assert(await managerAtBottom(),'The manager opens at the bottom');
    for (const [width, height] of [[375, 650], [393, 852], [393, 350]]) {
     await manager.setViewportSize({ width, height });
     await manager.waitForFunction(() => parseFloat(document.querySelector('.cal-announcements-dialog').style.getPropertyValue('--cal-dialog-height')) === (window.visualViewport?.height || innerHeight) - 32);
     const geometry = await managerDialog.evaluate(dialog => {
      const feed = dialog.querySelector('.cal-announcement-feed'), form = dialog.querySelector('.cal-announcement-compose');
      const box = dialog.getBoundingClientRect(), before = form.getBoundingClientRect(), list = feed.getBoundingClientRect();
      feed.scrollTop = 0;
      feed.scrollTop = 100;
      return { composerBelowFeed: before.top >= list.bottom, composerFixed: before.top === form.getBoundingClientRect().top,
       composerFits: before.bottom <= box.bottom && form.scrollWidth <= form.clientWidth, historyScrolls: feed.scrollTop > 0,
       fitsViewport: box.bottom < innerHeight && box.right < innerWidth && box.left > 0, outerOverflow: dialog.scrollHeight - dialog.clientHeight };
     });
     const { composerBelowFeed, composerFixed, composerFits, historyScrolls, fitsViewport, outerOverflow } = geometry;
     assert(composerBelowFeed && composerFixed && composerFits && historyScrolls && fitsViewport && outerOverflow <= 1, JSON.stringify({ width, height, ...geometry }));
     await managerFeed.evaluate(feed => { feed.scrollTop = feed.scrollHeight; });
     await manager.screenshot({path:path.join(output,`manager-composer-${width}x${height}.png`)});
    }
    await manager.setViewportSize({ width: 393, height: 852 });
    assert.equal(await congregant.getByText('Showing the last 10 days.',{exact:true}).count(),0);
    const readerDialog = congregant.locator('.cal-announcement-reader');
    const readerFeed = readerDialog.locator('.cal-announcement-feed');
    const readerCards = readerFeed.locator('[data-announcement-id]');
    const atBottom = () => readerFeed.evaluate(feed => feed.scrollHeight - feed.clientHeight - feed.scrollTop <= 2);
    assert.equal(await readerCards.last().getAttribute('data-announcement-id'),fresh.id,'The newest message is last');
    assert(await atBottom(),'The reader opens at the newest message');
    for (const [width, height] of [[375, 650], [393, 852], [740, 350]]) {
     await congregant.setViewportSize({ width, height });
     await congregant.waitForFunction(() => parseFloat(document.querySelector('.cal-announcement-reader').style.getPropertyValue('--cal-dialog-height')) === (window.visualViewport?.height || innerHeight) - 32);
     const geometry = await readerDialog.evaluate(dialog => {
      const box = dialog.getBoundingClientRect();
      const footer = dialog.querySelector('.cal-dialog-header').getBoundingClientRect();
      const close = dialog.querySelector('[data-cal-close]');
      const closeTop = close.getBoundingClientRect().top;
      const feed = dialog.querySelector('.cal-announcement-feed');
      const list = feed.getBoundingClientRect();
      feed.scrollTop = 100;
      const scrolled = feed.scrollTop > 0;
      const fixedClose = close.getBoundingClientRect().top === closeTop;
      feed.scrollTop = 0;
      return { top: box.top, left: box.left, right: innerWidth - box.right, bottom: innerHeight - box.bottom,
       footerGap: footer.top - list.bottom, listHeight: list.height, outerOverflow: dialog.scrollHeight - dialog.clientHeight,
       closeHeight: close.getBoundingClientRect().height, scrolled, fixedClose };
     });
     const { top, left, right, bottom, footerGap, listHeight, outerOverflow, closeHeight, scrolled, fixedClose } = geometry;
     assert(top >= 12 && left >= 12 && right >= 12 && bottom >= 12 && bottom <= 24, JSON.stringify({ width, height, ...geometry }));
     assert(footerGap >= 0 && footerGap <= 12 && listHeight > height * .48 && outerOverflow <= 1 && closeHeight >= 44 && scrolled && fixedClose, JSON.stringify({ width, height, ...geometry }));
     if (width === 393) {
      await readerFeed.evaluate(feed => { feed.scrollTop = feed.scrollHeight; });
      await congregant.screenshot({ path: path.join(output, 'reader-messages-footer.png') });
     }
    }
    await congregant.setViewportSize({ width: 393, height: 900 });
    const older = readerFeed.getByRole('button',{name:'Load older messages',exact:true});
    await older.scrollIntoViewIfNeeded();
    const anchorId = await readerCards.first().getAttribute('data-announcement-id');
    const anchor = readerFeed.locator(`[data-announcement-id="${anchorId}"]`);
    const anchorOffset = () => anchor.evaluate(node=>node.getBoundingClientRect().top-node.closest('.cal-announcement-feed').getBoundingClientRect().top);
    const offset = await anchorOffset();
    await older.click();
    await older.waitFor({state:'hidden'});
    assert.notEqual(await readerCards.first().getAttribute('data-announcement-id'),anchorId,'Older messages are added above the first page');
    assert(Math.abs(await anchorOffset()-offset)<=2,'Prepending keeps the old message in the same place');
    assert.equal(await congregant.locator('[data-announcement-id="'+legacy.id+'"]').count(),0);
    assert.equal(await congregant.locator('[data-cal-edit-announcement]:visible').count(),0);
    await manager.locator('[data-cal-older-announcements]').click();await manager.locator('[data-announcement-id="'+legacy.id+'"]').waitFor();
    const row=manager.locator('[data-announcement-id="'+legacy.id+'"]');
    await row.locator('[data-cal-edit-announcement]').click();
    const dateInput=row.locator('input[name=addedAt]');assert.equal(await dateInput.inputValue(),calendarAnnouncementLocalTime(legacy.createdAt,'America/New_York'));
    const movedLocal=calendarAnnouncementLocalTime(new Date(Date.now()-60000).toISOString(),'America/New_York');
    await dateInput.fill(movedLocal);
    for(const width of [320,393,1440]){await manager.setViewportSize({width,height:900});await dateInput.scrollIntoViewIfNeeded();const geometry=await dateInput.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,pageWidth:document.documentElement.scrollWidth,width:innerWidth};});assert(geometry.pageWidth<=width&&geometry.right<=width&&geometry.left>=0&&geometry.height>=44,JSON.stringify(geometry));await manager.screenshot({path:path.join(output,'date-editor-'+width+'.png'),fullPage:true});}
    await row.getByRole('button',{name:'Save changes',exact:true}).click();await row.locator('.cal-announcement-edit-form').waitFor({state:'detached'});
    assert.equal((await manager.locator('[data-announcement-id]').all()).length,37);
    assert.equal(await managerCards.nth(-2).getAttribute('data-announcement-id'),legacy.id,'Date edit repositions the saved row');
    assert.equal((await call('/api/announcements','GET',null,owner.token)).body.messages.find(value=>value.id===legacy.id).createdAt,legacy.createdAt);
    await congregant.evaluate(()=>window.dispatchEvent(new Event('focus')));await congregant.locator('[data-announcement-id="'+legacy.id+'"]').waitFor();
    assert.equal(await readerCards.nth(-2).getAttribute('data-announcement-id'),legacy.id,'An edited date inserts a newly recent message near the bottom');
    await row.locator('[data-cal-edit-announcement]').click();await row.locator('input[name=addedAt]').fill(calendarAnnouncementLocalTime(legacy.createdAt,'America/New_York'));
    await row.getByRole('button',{name:'Save changes',exact:true}).click();await row.locator('.cal-announcement-edit-form').waitFor({state:'detached'});
    await congregant.evaluate(()=>window.dispatchEvent(new Event('focus')));await congregant.locator('[data-announcement-id="'+legacy.id+'"]').waitFor({state:'detached'});
    assert.equal(await manager.locator('[data-announcement-id="'+legacy.id+'"]').count(),1,'Backdating retains the manager archive');
    await managerFeed.evaluate(feed => { feed.scrollTop = 0; });
    await readerFeed.evaluate(feed=>{feed.scrollTop=feed.scrollHeight;});
    const followed = await post(null,'A message arriving while at the latest');
    await congregant.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await readerFeed.locator(`[data-announcement-id="${followed.id}"]`).waitFor();
    assert.equal(await readerCards.last().getAttribute('data-announcement-id'),followed.id);
    assert(await atBottom(),'A new message follows the bottom while the reader is there');
    await readerFeed.evaluate(feed=>{feed.scrollTop=80;});
    const reading = await readerFeed.evaluate(feed=>feed.scrollTop);
    const whileReading = await post(null,'A message arriving while reading history');
    await congregant.evaluate(()=>window.dispatchEvent(new Event('focus')));
    const showNew = readerDialog.getByRole('button',{name:'Show new messages',exact:true});
    await showNew.waitFor();
    assert.equal(await readerFeed.evaluate(feed=>feed.scrollTop),reading,'New arrivals leave the reader’s position alone');
    await showNew.click();
    await readerFeed.locator(`[data-announcement-id="${whileReading.id}"]`).waitFor();
    assert.equal(await readerCards.last().getAttribute('data-announcement-id'),whileReading.id);
    assert(await atBottom(),'Show new messages returns to the latest message');
    await managerFeed.evaluate(feed => { feed.scrollTop = 0; });
    await manager.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await managerDialog.getByRole('button',{name:'Show new announcements',exact:true}).waitFor();
    assert.equal(await managerCards.count(),37,'The manager keeps the loaded archive while reading older messages');
    const draft = composer.getByLabel('New announcement'), send = composer.getByRole('button',{name:'Send announcement'});
    const postedText = 'Sent from the bottom\nמזל טוב';
    await draft.fill(postedText);
    await send.click();
    await managerCards.last().getByText('מזל טוב').waitFor();
    assert.equal(await managerCards.last().locator('p').textContent(),postedText);
    assert.equal(await managerCards.count(),38,'Sending appends the confirmed post without discarding loaded history');
    assert.equal(await draft.inputValue(),'');
    assert(await managerAtBottom(),'Sending a new post scrolls to it');
    const date = composer.locator('input[name=addedAt]');
    assert(await date.isHidden(),'The optional date starts collapsed');
    await composer.getByText('Set date and time',{exact:true}).click();
    await date.fill(calendarAnnouncementLocalTime(oldAt,'America/New_York'));
    await draft.fill('An intentionally backdated post');
    await send.click();
    await managerCards.getByText('An intentionally backdated post',{exact:true}).waitFor();
    assert.equal(await managerCards.last().locator('p').textContent(),postedText,'A backdated post sorts into its original place');
    assert(await date.isHidden(),'Sending closes the optional date');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({browserDates:true,phoneAndDesktop:true,dateMovesRow:true,viewerWindowEnforced:true,openFeedReorders:true,originalTimestampPreserved:true,pinnedManagerComposer:true,postPreservesHistory:true,output}));
   }finally{await browser.close();}
  }
  console.log('Passed real server date edits, owner/editor/viewer boundaries, chronological pagination, date cutoff, unread preservation, idempotency and cursor deletion checks.');
 }finally{await backend.dispose();server?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
