// Synthetic local records only. No production calendar writes.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomBytes,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'worker/calendar');
const {build}=require(require.resolve('esbuild',{paths:[runtime]}));
const {Miniflare,convertV4MiniflareOptions}=require(require.resolve('miniflare',{paths:[runtime]}));
(async()=>{
 const {messageFeedWeek,readMessageFeed}=await import('../worker/calendar/message-feed.js');
 assert.deepEqual(messageFeedWeek(Date.parse('2026-11-01T03:59:59Z')),{start:'2026-10-25',end:'2026-10-31',since:'2026-10-25T04:00:00.000Z',until:'2026-11-01T04:00:00.000Z'});
 for(const [instant,start,end,hours] of [['2026-11-01T04:00:00Z','2026-11-01','2026-11-07',169],['2026-03-08T05:00:00Z','2026-03-08','2026-03-14',167],['2027-01-01T12:00:00Z','2026-12-27','2027-01-02',168]]){
  const week=messageFeedWeek(Date.parse(instant));assert.equal(week.start,start);assert.equal(week.end,end);assert.equal((Date.parse(week.until)-Date.parse(week.since))/3600000,hours);
 }
 let origin='http://127.0.0.1:8999',endpoint='',server;
 if(process.env.CALENDAR_FEED_BROWSER==='1'){
  server=require('node:http').createServer((req,res)=>{
   if(req.url.split('?')[0]==='/data/calendar.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({endpoint}));}
   let file=path.resolve(root,'dist','.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(path.join(root,'dist')+path.sep))return res.writeHead(403).end();
   if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file))return res.writeHead(404).end();
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 }
 const bootstrap=randomBytes(32).toString('hex');
 const bundle=await build({entryPoints:[path.join(runtime,'worker.js')],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
 const backend=new Miniflare(convertV4MiniflareOptions({name:'message-feeds-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',bindings:{ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(bootstrap).digest('hex')},durableObjects:{CALENDAR:{className:'CommunityCalendar',useSQLite:true}}}));
 try{
  endpoint=(await backend.ready).origin;
  async function call(route,method='GET',body,token,source=origin){
   const response=await backend.dispatchFetch(endpoint+route,{method,headers:{...(source?{Origin:source}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const text=await response.text();return {status:response.status,headers:response.headers,body:response.headers.get('Content-Type')?.includes('application/json')?JSON.parse(text):text};
  }
  const owner=(await call('/api/setup','POST',{setupToken:bootstrap,name:'Synthetic owner',email:'owner@example.test',password:'Synthetic owner password 2026'})).body;
  const invitation=(await call('/api/access','POST',{name:'Synthetic editor',email:'editor@example.test'},owner.token)).body;
  const editor=(await call('/api/invitations/claim','POST',{token:invitation.token,password:'Synthetic editor password 2026'})).body;
  const viewer=(await call('/api/register','POST',{name:'Synthetic viewer',email:'viewer@example.test',password:'Synthetic viewer password 2026'})).body;
  assert.equal((await call('/api/info')).body.messageFeeds,true);
  for(const token of [undefined,editor.token,viewer.token]){
   for(const method of ['GET','POST','DELETE'])assert.equal((await call('/api/message-feeds'+(method==='DELETE'?'/'+randomBytes(16).toString('hex'):''),method,method==='POST'?{name:'Forbidden'}:undefined,token)).status,token?403:401);
  }
  assert.equal((await call('/api/message-feeds','POST',{name:'  '},owner.token)).status,400);
  const created=await call('/api/message-feeds','POST',{name:'Synthetic website'},owner.token);assert.equal(created.status,201);
  const key=created.body.key,id=created.body.link.id;
  const listed=(await call('/api/message-feeds','GET',null,owner.token)).body;assert.deepEqual(Object.keys(listed.links[0]).sort(),['createdAt','id','name']);assert(!JSON.stringify(listed).includes(key));
  const feed=(route='/api/v1/messages',token=key,source=null)=>call(route,'GET',null,token,source);
  for(const token of [null,owner.token,'calmsg_'+id+'_'+randomBytes(32).toString('hex')])assert.equal((await feed('/api/v1/messages',token)).status,401);
  assert.equal((await feed('/api/v1/messages?key='+key,key)).status,401);
  assert.equal((await feed('/api/v1/messages?key='+key+'&key='+key,null)).status,401);
  assert.equal((await feed('/api/v1/messages?from=2000-01-01')).status,400);
  assert.deepEqual((await feed()).body.messages,[]);assert.equal((await feed('/api/v1/messages.txt')).body,'');
  const week=messageFeedWeek(),at=week.since;
  const post=async(text,addedAt)=>{
   const result=await call('/api/announcements','POST',{id:randomBytes(16).toString('hex'),text,addedAt},owner.token);assert.equal(result.status,201,JSON.stringify(result.body));return result.body.message;
  };
  const outside=await post('Last week: do not share',new Date(Date.parse(at)-1).toISOString());
  const first=await post('שלום עולם\nExact wording <script> & quotes "',at),second=await post('Second message',new Date(Date.parse(at)+1).toISOString());
  const before=(await call('/api/announcements/status','GET',null,viewer.token)).body;
  const activityBefore=(await call('/api/activity','GET',null,owner.token)).body.counts;
  let result=await feed();assert.equal(result.status,200);assert.deepEqual(result.body.week,{start:week.start,end:week.end});assert.deepEqual(result.body.messages.map(m=>m.id),[first.id,second.id]);
  assert.deepEqual(Object.keys(result.body.messages[0]).sort(),['id','postedAt','revision','text','updatedAt']);assert.equal(result.body.messages[0].text,first.text);
  assert(!JSON.stringify(result.body).includes(outside.id));
  const text=await feed('/api/v1/messages.txt?key='+key,null,'https://other.example');assert.equal(text.body,first.text+'\n\n'+second.text);assert.match(text.headers.get('Content-Type'),/^text\/plain; charset=utf-8/);
  for(const response of [text,await feed('/api/v1/messages',undefined)]){
   assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  }
  const preflight=await call('/api/v1/messages','OPTIONS',null,null,'https://other.example');assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Methods'),'GET,OPTIONS');
  for(const method of ['POST','PUT','DELETE'])assert.equal((await call('/api/v1/messages',method,{},key,null)).status,405);
  for(const route of ['/api/events?from=2026-11-01&to=2026-11-30','/api/access','/api/announcements','/api/message-feeds']){
   assert.equal((await call(route,'GET',null,key)).status,401);assert.equal((await call(route,'GET',null,key,null)).status,403);
  }
  const after=(await call('/api/announcements/status','GET',null,viewer.token)).body;for(const prop of ['total','unread','deletedCount','editCount'])assert.equal(after[prop],before[prop]);
  assert.deepEqual((await call('/api/activity','GET',null,owner.token)).body.counts,activityBefore);
  await call('/api/announcements/'+first.id,'PUT',{text:'Edited wording',revision:1,operationId:randomBytes(16).toString('hex')},owner.token);
  result=await feed();assert.equal(result.body.messages[0].text,'Edited wording');assert.equal(result.body.messages[0].revision,2);
  await call('/api/announcements/'+first.id,'PUT',{text:'Moved outside this week',addedAt:outside.addedAt,revision:2,operationId:randomBytes(16).toString('hex')},owner.token);
  assert.deepEqual((await feed()).body.messages.map(m=>m.id),[second.id]);
  await call('/api/announcements/'+second.id,'DELETE',null,owner.token);assert.deepEqual((await feed()).body.messages,[]);
  // More than two storage pages, identical timestamps, long SMS text and private metadata.
  const records=new Map([['message-feed:'+id,{keyHash:createHash('sha256').update(key).digest('hex')}]]);
  for(let i=0;i<225;i++){
   const message={id:'bulk-'+i,text:i===224?'א'.repeat(16000):'Wording '+i,sequence:i,addedAt:at,createdAt:at,authorId:'private',updatedBy:'private',sourcePhone:'private'};
   records.set('announcement-date-order:'+at+':'+String(i).padStart(16,'0'),message.id);records.set('announcement:'+message.id,message);
  }
  const storage={get:async key=>Array.isArray(key)?new Map(key.filter(k=>records.has(k)).map(k=>[k,records.get(k)])):records.get(key),list:async options=>new Map([...records].filter(([key])=>(!options.start||key>=options.start)&&(!options.startAfter||key>options.startAfter)&&(!options.end||key<options.end)).sort(([a],[b])=>a.localeCompare(b)).slice(0,options.limit))};
  const bulk=await (await readMessageFeed(storage,new Request(endpoint+'/api/v1/messages',{headers:{Authorization:'Bearer '+key}}),new URL(endpoint+'/api/v1/messages'))).json();assert.equal(bulk.messages.length,225);assert.equal(bulk.messages.at(-1).text.length,16000);assert(!JSON.stringify(bulk).includes('private'));
  if(server){
   const {chromium}=require('playwright'),browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
   const output=fs.mkdtempSync(path.join(os.tmpdir(),'message-feeds-browser-')),errors=[];
   try{
    const context=await browser.newContext();await context.addInitScript(session=>{sessionStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify(session));localStorage.setItem('zmanim-nocount','1');},owner);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    for(const width of [320,393,1440]){
     await page.setViewportSize({width,height:900});await page.goto(origin+'/admin/calendar/');await page.locator('[data-cal-access]').click();await page.locator('[data-cal-message-feeds]').click();
     const dialog=page.getByRole('dialog',{name:'Share messages'});await dialog.getByText('Links are up to date.',{exact:true}).waitFor();
     await dialog.getByLabel('Website name').fill('Synthetic mobile '+width);await dialog.getByRole('button',{name:'Create private link',exact:true}).click();
     const field=dialog.getByRole('textbox',{name:'Private text-only message link',exact:true});await field.waitFor();const url=await field.inputValue();assert(url.startsWith(endpoint+'/api/v1/messages.txt?key=calmsg_'));
     const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download API instructions'}).click();const download=await downloadPromise;const file=await download.path();assert(fs.readFileSync(file,'utf8').includes(url));
     const geometry=await dialog.evaluate(el=>({overflow:el.scrollWidth-el.clientWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));assert(geometry.overflow<=1&&geometry.left>=0&&geometry.right<=width,JSON.stringify({width,...geometry}));
     // Mask private fields even though all keys here are synthetic.
     await page.screenshot({path:path.join(output,'share-'+width+'.png'),mask:[dialog.locator('textarea')]});
     page.once('dialog',prompt=>prompt.accept());await dialog.getByRole('button',{name:'Revoke link for Synthetic mobile '+width,exact:true}).click();await dialog.getByText('Link revoked. Existing messages are unchanged.',{exact:true}).waitFor();assert.equal((await call(new URL(url).pathname+new URL(url).search,'GET',null,null,null)).status,401);
     await dialog.getByRole('button',{name:'Close',exact:true}).click();
    }
    // A previous Worker advertises no capability: no link is created or exposed.
    await page.route('**/api/info',async route=>{const response=await route.fetch(),body=await response.json();delete body.messageFeeds;await route.fulfill({response,json:body});});
    await page.locator('[data-cal-access]').click();await page.locator('[data-cal-message-feeds]').click();await page.getByText('Message sharing is awaiting calendar service activation.',{exact:true}).waitFor();assert.equal(await page.locator('[data-cal-feed-content]').isVisible(),false);
    assert.deepEqual(errors,[]);console.log('Browser verified at 320, 393 and 1440px. Screenshots: '+output);
   }finally{await browser.close();}
  }
  const other=(await call('/api/message-feeds','POST',{name:'Independent website'},owner.token)).body;
  for(let i=0;i<18;i++)assert.equal((await call('/api/message-feeds','POST',{name:'Synthetic link '+i},owner.token)).status,201);
  assert.equal((await call('/api/message-feeds','POST',{name:'Over the link limit'},owner.token)).status,409);
  assert.equal((await call('/api/message-feeds/'+id,'DELETE',null,owner.token)).status,200);
  assert.equal((await feed('/api/v1/messages',other.key)).status,200,'Revoking one site preserves another site’s access');assert.equal((await feed()).status,401);assert.equal((await feed('/api/v1/messages.txt?key='+key,null)).status,401);
  console.log('Weekly posted-message API: permissions, revocation, exact text, DST, pagination, edits, deletion and read-only behavior passed.');
 }finally{await backend.dispose();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
