import test from 'node:test';
import assert from 'node:assert/strict';
import {manageGoogle,googleCallback,googleEvent,runGoogleSync,googleReady} from '../worker/calendar/google-calendar.js';
class Storage {
 rows=new Map();alarm=null;
 async get(k){return structuredClone(this.rows.get(k));}
 async put(k,v){this.rows.set(k,structuredClone(v));}
 async delete(k){for(const item of Array.isArray(k)?k:[k])this.rows.delete(item);}
 async list({prefix}){return new Map([...this.rows].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 async getAlarm(){return this.alarm;}async setAlarm(n){this.alarm=n;}
}
const env={GOOGLE_CALENDAR_CLIENT_ID:'synthetic-client',GOOGLE_CALENDAR_CLIENT_SECRET:'synthetic-secret',GOOGLE_CALENDAR_TOKEN_KEY:'ab'.repeat(32),GOOGLE_CALENDAR_REDIRECT_URI:'https://calendar.example.test/api/google-calendar/callback',ALLOWED_ORIGIN:'https://shul.example.test'};
const user={id:'synthetic-user',version:1,active:true};
const request=(path='',method='GET')=>new Request('https://calendar.example.test/api/google-calendar'+path,{method});
const fields={id:'event-1',title:'Example Wedding',date:'2026-11-22',endDate:'2026-11-22',time:'19:30',endTime:'',details:'Original wording',visibility:'everyone',adminDetails:'Never export this'};
function mockGoogle(){
 const calls=[],events=new Map();let unavailable=false;
 const send=async(url,options)=>{
  calls.push({url,method:options.method,body:options.body});
  if(unavailable)return Response.json({error:'unavailable'},{status:503});
  if(url.endsWith('/token'))return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:'https://www.googleapis.com/auth/calendar.app.created'});
  if(url.endsWith('/calendars')&&options.method==='POST')return Response.json({id:'synthetic-secondary'});
  if(url.includes('/calendarList/'))return Response.json({});
  if(url.endsWith('/events')&&options.method==='POST'){
   const event=JSON.parse(options.body);if(events.has(event.id))return Response.json({},{status:409});events.set(event.id,event);return Response.json(event);
  }
  if(url.includes('/events/')){
   const id=url.split('/').at(-1);
   if(options.method==='DELETE'){events.delete(id);return new Response(null,{status:204});}
   if(options.method==='PUT'){if(!events.has(id))return Response.json({},{status:404});events.set(id,JSON.parse(options.body));return Response.json({id});}
  }
  if(url.endsWith('/calendars/synthetic-secondary')&&options.method==='DELETE'){events.clear();return new Response(null,{status:204});}
  throw Error('Unexpected request '+url);
 };
 return {send,calls,events,setUnavailable(v){unavailable=v;}};
}
async function connect(db,mock){
 await db.put('user:'+user.id,user);
 const result=await (await manageGoogle(db,env,request('/connect','POST'),user,{},mock.send)).json();
 const url=new URL(result.url),state=url.searchParams.get('state');
 assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/calendar.app.created');assert.equal(url.searchParams.get('access_type'),'offline');assert.ok(url.searchParams.get('code_challenge'));
 const callback=await googleCallback(db,env,new URL(env.GOOGLE_CALENDAR_REDIRECT_URI+'?state='+state+'&code=synthetic-code'));
 assert.equal(callback.status,303);assert.equal(callback.headers.get('Location'),env.ALLOWED_ORIGIN+'/admin/calendar/#google-calendar='+state);
 await assert.rejects(()=>manageGoogle(db,env,request('/complete','POST'),{...user,id:'other'}, {state},mock.send),/expired/);
 const completed=await (await manageGoogle(db,env,request('/complete','POST'),user,{state},mock.send)).json();
 assert.equal(completed.connected,true);assert.equal(JSON.stringify(completed).includes('synthetic-refresh'),false);
 assert.equal(JSON.stringify([...db.rows.values()]).includes('synthetic-refresh'),false);
 return state;
}
test('optional setup gates and single use OAuth bind authorization to signed-in account',async()=>{
 const db=new Storage(),mock=mockGoogle();assert.equal(googleReady(env),true);assert.equal(googleReady({}),false);
 assert.equal((await (await manageGoogle(db,{},request(),user,{})).json()).available,false);
 await assert.rejects(()=>manageGoogle(db,{},request('/connect','POST'),user,{}),/setup/);
 const state=await connect(db,mock);
 await assert.rejects(()=>googleCallback(db,env,new URL(env.GOOGLE_CALENDAR_REDIRECT_URI+'?state='+state+'&code=replay')),/expired/);
 await assert.rejects(()=>manageGoogle(db,env,request('/complete','POST'),user,{state},mock.send),/already/);
});
test('Google sync copies only public source fields, reconciles updates/deletes, and removes only its calendar',async()=>{
 const db=new Storage(),mock=mockGoogle();await connect(db,mock);
 await db.put('event:event-1',fields);await db.put('event:private',{...fields,id:'private',visibility:'admins'});
 let now=Date.now()+100;await runGoogleSync(db,env,now,mock.send);assert.equal(mock.events.size,1);
 let event=[...mock.events.values()][0];assert.equal(event.summary,'LC · Example Wedding');assert.equal(event.description.includes('Never export'),false);assert.deepEqual(event.reminders.overrides,[]);assert.equal(event.start.timeZone,'America/New_York');
 const creations=mock.calls.filter(c=>c.url.endsWith('/events')&&c.method==='POST').length;
 await runGoogleSync(db,env,now+=61000,mock.send);assert.equal(mock.calls.filter(c=>c.url.endsWith('/events')&&c.method==='POST').length,creations);
 await db.put('event:event-1',{...fields,title:'Updated Wedding'});
 await manageGoogle(db,env,request('','PUT'),user,{reminders:30},mock.send);
 await runGoogleSync(db,env,now+=61000,mock.send);event=[...mock.events.values()][0];assert.equal(event.summary,'LC · Updated Wedding');assert.deepEqual(event.reminders.overrides,[{method:'popup',minutes:30}]);
 await db.put('event:event-1',{...fields,visibility:'admins'});await runGoogleSync(db,env,now+=61000,mock.send);assert.equal(mock.events.size,0,'Visibility change removes previously exported event');
 await db.put('event:event-1',fields);await runGoogleSync(db,env,now+=61000,mock.send);assert.equal(mock.events.size,1);
 await db.delete('event:event-1');await runGoogleSync(db,env,now+=61000,mock.send);assert.equal(mock.events.size,0);
 const off=await(await manageGoogle(db,env,request('','DELETE'),user,{},mock.send)).json();assert.equal(off.enabled,false);assert.equal(off.disconnecting,true);
 mock.setUnavailable(true);await runGoogleSync(db,env,now+=61000,mock.send);assert.equal((await(await manageGoogle(db,env,request(),user,{})).json()).disconnecting,true);
 mock.setUnavailable(false);await runGoogleSync(db,env,now+=6*60000,mock.send);assert.equal((await(await manageGoogle(db,env,request(),user,{})).json()).connected,false);
 assert.equal(mock.calls.some(c=>c.url.includes('/primary')),false);
});
test('inactive accounts stop exporting and cleanup their shul calendar',async()=>{
 const db=new Storage(),mock=mockGoogle();await connect(db,mock);await runGoogleSync(db,env,Date.now()+1,mock.send);
 await db.put('user:'+user.id,{...user,active:false});await runGoogleSync(db,env,Date.now()+61000,mock.send);
 assert.equal((await db.list({prefix:'google-connection:'})).size,0);
});
test('date only, multiple days, explicit ends and missing end durations preserve source meaning',async()=>{
 const allDay=await googleEvent({...fields,time:'',endDate:'2026-11-24'});assert.deepEqual(allDay.start,{date:'2026-11-22'});assert.deepEqual(allDay.end,{date:'2026-11-25'});
 const overnight=await googleEvent({...fields,time:'23:30'});assert.equal(overnight.end.dateTime,'2026-11-23T00:30:00');assert.match(overnight.description,/estimated/);
 const explicit=await googleEvent({...fields,endTime:'21:00'});assert.equal(explicit.end.dateTime,'2026-11-22T21:00:00');assert.doesNotMatch(explicit.description,/estimated/);
});

test('lost insert responses and Google tombstones retry without duplicate live events',async()=>{
 const db=new Storage(),mock=mockGoogle();await connect(db,mock);await db.put('event:event-1',fields);
 let lost=true;const tombstones=new Set();
 const send=async(url,options)=>{
  const id=url.split('/').at(-1);
  if(url.includes('/events/')&&options.method==='PUT'&&tombstones.has(id))return Response.json({},{status:410});
  if(url.endsWith('/events')&&options.method==='POST'&&tombstones.has(JSON.parse(options.body).id))return Response.json({},{status:409});
  const result=await mock.send(url,options);
  if(url.endsWith('/events')&&options.method==='POST'&&lost){lost=false;throw Error('Synthetic lost response');}
  return result;
 };
 let now=Date.now()+100;await runGoogleSync(db,env,now,send);assert.equal(mock.events.size,1);
 await runGoogleSync(db,env,now+=6*60000,send);assert.equal(mock.events.size,1,'Lost response reuses same ID');
 const id=[...mock.events.keys()][0];mock.events.delete(id);tombstones.add(id);
 await db.put('event:event-1',{...fields,title:'Corrected event'});
 await runGoogleSync(db,env,now+=61000,send);assert.equal(mock.events.size,1);assert.notEqual([...mock.events.keys()][0],id);assert.equal([...mock.events.values()][0].summary,'LC · Corrected event');
});
test('expired pending authorization is rejected, and cancelled consent creates no connection',async()=>{
 const db=new Storage(),mock=mockGoogle();await db.put('user:'+user.id,user);
 let link=await(await manageGoogle(db,env,request('/connect','POST'),user,{},mock.send)).json();let state=new URL(link.url).searchParams.get('state');
 const key=[...(await db.list({prefix:'google-state:'})).keys()][0];await db.put(key,{...await db.get(key),expires:Date.now()-1});
 await assert.rejects(()=>googleCallback(db,env,new URL(env.GOOGLE_CALENDAR_REDIRECT_URI+'?state='+state+'&code=expired')),/expired/);
 link=await(await manageGoogle(db,env,request('/connect','POST'),user,{},mock.send)).json();state=new URL(link.url).searchParams.get('state');
 const result=await googleCallback(db,env,new URL(env.GOOGLE_CALENDAR_REDIRECT_URI+'?state='+state+'&error=access_denied'));
 assert.match(result.headers.get('Location'),/cancelled$/);assert.equal((await db.list({prefix:'google-connection:'})).size,0);assert.equal(mock.calls.length,0);
});
test('explicitly skipped older reviews stay skipped while older unclear records use improved rules',async()=>{
 const {syncSimchaMessage}=await import('../worker/calendar/simcha-import.js');
 const db=new Storage();const message={id:'old-review',text:'Kiddush for R&M Example Smith',createdAt:'2026-11-20T18:00:00Z',revision:1};
 await db.put('simcha-source:'+message.id,{messageId:message.id,revision:1,addedAt:message.createdAt,status:'review'});
 assert.equal((await syncSimchaMessage(db,message)).status,'added');
 const skipped={...message,id:'old-skipped'};await db.put('simcha-source:'+skipped.id,{messageId:skipped.id,revision:1,addedAt:skipped.createdAt,status:'skipped'});
 assert.equal((await syncSimchaMessage(db,skipped)).status,'skipped');
});
