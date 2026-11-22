// Real isolated service permissions. OAuth network exchange is tested separately with synthetic responses.
const path=require('node:path'),assert=require('node:assert/strict'),{createHash,randomBytes}=require('node:crypto');
const runtime=path.resolve(__dirname,'../worker/calendar');
const {build}=require(require.resolve('esbuild',{paths:[runtime]}));
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[runtime]}));
(async()=>{
 const origin='http://127.0.0.1:8999',setupToken=randomBytes(32).toString('hex');
 const bundle=await build({entryPoints:[path.join(runtime,'worker.js')],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
 const backend=new Miniflare(convertV4MiniflareOptions({name:'google-calendar-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',bindings:{ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(setupToken).digest('hex')},durableObjects:{CALENDAR:{className:'CommunityCalendar',useSQLite:true}}}));
 try{
  const endpoint=(await backend.ready).origin;
  async function call(route,method='GET',body,token,requestOrigin=origin){
   const response=await backend.dispatchFetch(endpoint+route,{method,headers:{...(requestOrigin?{Origin:requestOrigin}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,body:await response.json()};
  }
  const owner=(await call('/api/setup','POST',{setupToken,name:'Synthetic owner',email:'owner@example.test',password:'Synthetic owner password 2026'})).body;
  const viewer=(await call('/api/register','POST',{name:'Synthetic viewer',email:'viewer@example.test',password:'Synthetic viewer password 2026'})).body;
  assert.equal((await call('/api/info')).body.googleCalendar,true);
  for(const user of [owner,viewer]){
   assert.equal((await call('/api/google-calendar','GET',null,user.token)).body.available,false);
   assert.equal((await call('/api/google-calendar/connect','POST',{},user.token)).status,503);
   assert.equal((await call('/api/google-calendar','DELETE',{},user.token)).status,200,'Off remains available without setup');
   assert.equal((await call('/api/google-calendar','GET',null,user.token,'https://evil.example')).status,403);
   assert.equal((await call('/api/google-calendar','GET',null,user.token,null)).status,403);
  }
  for(const route of ['/api/google-calendar','/api/google-calendar/connect','/api/google-calendar/complete','/api/google-calendar/forget']){
   assert.equal((await call(route,route.endsWith('calendar')?'GET':'POST',route.endsWith('calendar')?null:{})).status,401);
  }
  assert.equal((await call('/api/google-calendar/callback?state=invalid','GET',null,null,null)).status,503,'Exact callback is the only new origin exception');
  console.log('Real isolated Google routes passed owner/viewer access, origin checks, signed-out denial and unavailable setup gates.');
 }finally{await backend.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
