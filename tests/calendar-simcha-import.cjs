// Isolated accounts and synthetic announcements. Never use a production endpoint.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'worker/calendar');
const {build}=require(require.resolve('esbuild',{paths:[runtime]}));
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[runtime]}));
(async()=>{
 const origin='http://127.0.0.1:8999',setupToken=randomBytes(32).toString('hex');
 const bundle=await build({entryPoints:[path.join(runtime,'worker.js')],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
 const backend=new Miniflare(convertV4MiniflareOptions({name:'simcha-import-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',bindings:{ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(setupToken).digest('hex')},durableObjects:{CALENDAR:{className:'CommunityCalendar',useSQLite:true}}}));
 try{
  const endpoint=(await backend.ready).origin;
  const call=async(route,method='GET',body,token,key)=>{
   const response=await backend.dispatchFetch(endpoint+route,{method,headers:{...(key?{'X-Calendar-SMS-Key':key}:{Origin:origin}),...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,body:await response.json()};
  };
  const owner=(await call('/api/setup','POST',{setupToken,name:'Synthetic owner',email:'owner@example.test',password:'Synthetic owner password 2026'})).body;
  const viewer=(await call('/api/register','POST',{name:'Synthetic viewer',email:'viewer@example.test',password:'Synthetic viewer password 2026'})).body;
  const invitation=(await call('/api/access','POST',{name:'Synthetic editor',email:'editor@example.test'},owner.token)).body;
  const editor=(await call('/api/invitations/claim','POST',{token:invitation.token,password:'Synthetic editor password 2026'})).body;
  assert.equal((await call('/api/info')).body.simchaImport,true);
  assert.equal((await call('/api/simcha-import')).status,401);
  for(const user of [viewer,editor]){
   assert.equal((await call('/api/simcha-import','GET',null,user.token)).status,403);
   assert.equal((await call('/api/simcha-import/scan','POST',{},user.token)).status,403);
   assert.equal((await call('/api/simcha-import/synthetic-review','POST',{decision:'skip',revision:1},user.token)).status,403);
  }
  const source={id:'synthetic-simcha-123',text:'Kiddush for Example on 2026-11-22 at 10am'};
  assert.equal((await call('/api/announcements','POST',source,owner.token)).status,201);
  assert.equal((await call('/api/announcements','POST',source,owner.token)).status,200);
  const events=()=>call('/api/events?from=2026-11-01&to=2026-11-30','GET',null,viewer.token);
  let result=await events();assert.equal(result.body.events.length,1);assert.equal(result.body.events[0].time,'10:00');
  const key=(await call('/api/sms-import','POST',{revision:0},owner.token)).body.key;
  const sms={id:'synthetic-source-sms-123',text:source.text,receivedAt:new Date().toISOString()};
  assert.equal((await call('/api/sms-import/receive','POST',sms,null,key)).status,201);
  assert.equal((await call('/api/sms-import/receive','POST',sms,null,key)).body.duplicate,true);
  assert.equal((await events()).body.events.length,1);
  assert.equal((await call('/api/announcements/status','GET',null,viewer.token)).body.unread,2);
  const uncertain={id:'synthetic-uncertain-123',text:'Bris for Example, details to follow'};
  await call('/api/announcements','POST',uncertain,editor.token);
  let review=(await call('/api/simcha-import','GET',null,owner.token)).body;
  assert.equal(review.review.length,1);assert.equal(review.duplicates,1);assert.equal(review.added,1);
  assert.equal((await call('/api/simcha-import/scan','POST',{},owner.token)).status,200);
  assert.equal((await events()).body.events.length,1,'Historical scan does not duplicate imported events');
  const decision={decision:'add',revision:1,operationId:'synthetic-review-operation',event:{title:'Example Bris',type:'custom',customCategory:'Bris',date:'2026-11-23',time:'08:30',details:uncertain.text}};
  assert.equal((await call('/api/simcha-import/'+uncertain.id,'POST',decision,owner.token)).status,200);
  assert.equal((await call('/api/simcha-import/'+uncertain.id,'POST',decision,owner.token)).status,200);
  assert.equal((await events()).body.events.length,2);
  await call('/api/announcements/'+source.id,'PUT',{text:'Kiddush for Example on 2026-11-28 at 10am',revision:1,operationId:'synthetic-edit-123'},owner.token);
  result=await events();assert.ok(result.body.events.some(event=>event.date==='2026-11-28'));
  assert.equal((await call('/api/simcha-import','GET',null,owner.token)).body.review.length,0);
  console.log('Real local service passed automatic imports, private permissions, review, SMS retries, historical scan, corrections and unchanged unread state.');
 }finally{await backend.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
