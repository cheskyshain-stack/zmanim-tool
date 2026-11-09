// Local Workerd only. Exercise real account permissions, date ordering and history bounds.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomBytes,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'worker/calendar');
const {build}=require(require.resolve('esbuild',{paths:[runtime]}));
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[runtime]}));
(async()=>{
 const origin='http://127.0.0.1:8999',setupToken=randomBytes(32).toString('hex');
 const bundle=await build({entryPoints:[path.join(runtime,'worker.js')],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
 const options={name:'announcement-dates-test',modules:true,compatibilityDate:'2026-10-01',isolatedResourcePersistencePath:fs.mkdtempSync(path.join(os.tmpdir(),'announcement-migration-')),bindings:{ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(setupToken).digest('hex')},durableObjects:{CALENDAR:{className:'CommunityCalendar',useSQLite:true}}};
 const legacy={id:'legacy-existing-01',sequence:1,text:'Existing announcement before the date index',authorId:'previous-author',createdAt:new Date(Date.now()-20*86400000).toISOString()};
 let backend=new Miniflare(convertV4MiniflareOptions({...options,script:`import {DurableObject} from 'cloudflare:workers';export class CommunityCalendar extends DurableObject{constructor(ctx,env){super(ctx,env);this.ctx=ctx;}async fetch(){const message=${JSON.stringify(legacy)};await this.ctx.storage.put({'announcement:legacy-existing-01':message,'announcement-order:0000000000000001':message.id,'announcement-count':1});return new Response('seeded');}}export default{fetch(request,env){return env.CALENDAR.get(env.CALENDAR.idFromName('lakewood-commons')).fetch(request);}}`}));
 await backend.ready;const seeded=await backend.dispatchFetch('https://fixture.test/');assert.equal(await seeded.text(),'seeded');
 await backend.setOptions(convertV4MiniflareOptions({...options,script:bundle.outputFiles[0].text}));
 try {
  const endpoint=(await backend.ready).origin;
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
  console.log('Passed real server date edits, owner/editor/viewer boundaries, chronological pagination, date cutoff, unread preservation, idempotency and cursor deletion checks.');
 }finally{await backend.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
