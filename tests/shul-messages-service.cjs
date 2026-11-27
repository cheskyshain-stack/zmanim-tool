// Isolated Workerd data only. Verify a pause never replaces accounts or removes data.
const path=require('node:path'),assert=require('node:assert/strict'),{randomBytes,createHash,generateKeyPairSync}=require('node:crypto');
const runtime=path.resolve(__dirname,'../worker/calendar');
const {build}=require(require.resolve('esbuild',{paths:[runtime]}));
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[runtime]}));
async function createMessagesFixture(origin){
 const setupToken=randomBytes(32).toString('hex');
 const bundle=await build({entryPoints:[path.join(runtime,'worker.js')],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
 const base={name:'shul-messages-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',bindings:{CALENDAR_REMINDER_VAPID:JSON.stringify(generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'})),ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(setupToken).digest('hex')},durableObjects:{CALENDAR:{className:'CommunityCalendar',useSQLite:true}}};
 const backend=new Miniflare(convertV4MiniflareOptions(base));await backend.ready;
 const call=async(route,method='GET',body,token)=>{
  const response=await backend.dispatchFetch((await backend.ready).origin+route,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 };
 const password='Synthetic password for local tests 2026';
 const owner=(await call('/api/setup','POST',{setupToken,name:'Synthetic owner',email:'owner@example.test',password})).body;
 const viewer=(await call('/api/register','POST',{name:'Synthetic viewer',email:'viewer@example.test',password})).body;
 return {backend,call,owner,viewer,password,async pause(value=true){await backend.setOptions(convertV4MiniflareOptions({...base,bindings:{...base.bindings,CALENDAR_EVENTS_ENABLED:value?'false':'true'}}));await backend.ready;}};
}
module.exports={createMessagesFixture};
async function verify(){
 const fixture=await createMessagesFixture('http://127.0.0.1:8999');const {backend,call,owner,viewer,password}=fixture;
 try{
  const event={id:'synthetic-retained-event',title:'Stored Kiddush',type:'kiddush',date:'2026-11-28',time:'10:00',details:'Retain this while paused'};
  assert.equal((await call('/api/events/'+event.id,'PUT',{...event,revision:0},owner.token)).status,201);
  const original=(await call('/api/events?from=2026-11-01&to=2026-11-30','GET',null,owner.token)).body.events;
  const invitation=(await call('/api/access','POST',{name:'Existing editor',email:'editor@example.test'},owner.token)).body;
  const editor=(await call('/api/invitations/claim','POST',{token:invitation.token,password})).body;
  await fixture.pause();
  const info=(await call('/api/info')).body;assert.equal(info.calendarEnabled,false);assert.equal(info.messagesPage,true);assert.equal(info.simchaImport,false);assert.equal(info.googleCalendar,false);
  for(const field of ['ready','accounts','selfRegistration','announcements','messageFeeds','emailImport','smsImport'])assert.equal(info[field],true,field);
  for(const account of [owner,viewer,editor])assert.equal((await call('/api/session','GET',null,account.token)).body.user.id,account.user.id,'Saved sessions survive pause');
  assert.equal((await call('/api/session','POST',{email:'viewer@example.test',password})).body.user.id,viewer.user.id,'Existing password survives');
  assert.equal((await call('/api/register','POST',{name:'New member',email:'new@example.test',password})).status,201,'Registration remains available');
  for(const [route,method,body]of [['/api/events?from=2026-11-01&to=2026-11-30','GET'],['/api/events','POST',event],['/api/events/'+event.id,'DELETE'],['/api/simcha-import','GET'],['/api/simcha-import/scan','POST',{}],['/api/google-calendar/connect','POST',{}]])assert.equal((await call(route,method,body,owner.token)).status,503,route);
  const message={id:'synthetic-original-message',text:'Kiddush for Example on 2026-11-28 at 10am\nOriginal WORDING stays.'};
  assert.equal((await call('/api/announcements','POST',message,owner.token)).status,201);
  const feed=(await call('/api/announcements','GET',null,viewer.token)).body;assert.equal(feed.messages[0].text,message.text);
  assert.equal((await call('/api/announcements','POST',{id:'synthetic-denied-message',text:'No posting'},viewer.token)).status,403);
  assert.equal((await call('/api/announcements/'+message.id,'PUT',{text:'Updated exact text',revision:1,operationId:'synthetic-message-edit'},owner.token)).status,200);
  assert.equal((await call('/api/announcements/read','POST',{ids:[message.id]},viewer.token)).status,200);
  const key=(await call('/api/message-feeds','POST',{name:'Synthetic consuming site'},owner.token)).body;
  assert.ok(key.key,'Read-only message keys can still be issued');
  await fixture.pause(false);
  assert.deepEqual((await call('/api/events?from=2026-11-01&to=2026-11-30','GET',null,owner.token)).body.events,original,'Stored events survive and messages create no new events while paused');
  console.log('Shul Messages service: existing sessions/passwords, new accounts, messages, read tracking and API keys survive; calendar APIs pause and events remain intact.');
 }finally{await backend.dispose();}
}
if(require.main===module)verify().catch(error=>{console.error(error);process.exitCode=1;});
