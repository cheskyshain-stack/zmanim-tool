// Synthetic local accounts and messages only. No production writes.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { createHash, randomBytes } = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), runtime = path.join(root, 'worker/calendar');
const { build } = require(require.resolve('esbuild', { paths: [runtime] }));
const { Miniflare, convertV4MiniflareOptions } = require(require.resolve('miniflare', { paths: [runtime] }));
let endpoint, backend, browser;
const errors = [];
const server = http.createServer((request, response) => {
  if (request.url.split('?')[0] === '/data/calendar.json') { response.setHeader('Content-Type','application/json'); return response.end(JSON.stringify({ endpoint })); }
  let file = path.resolve(root, 'dist', '.' + decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(path.join(root,'dist')+path.sep)) return response.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
  if (!fs.existsSync(file)) return response.writeHead(404).end();
  response.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.jpg':'image/jpeg'})[path.extname(file)] || 'application/octet-stream');
  response.end(fs.readFileSync(file));
});
(async () => {
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port, setupToken=randomBytes(32).toString('hex');
    const bundle=await build({entryPoints:[path.join(runtime,'worker.js')],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
    backend=new Miniflare(convertV4MiniflareOptions({name:'sms-import-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-10-01',bindings:{ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(setupToken).digest('hex')},durableObjects:{CALENDAR:{className:'CommunityCalendar',useSQLite:true}}}));
    endpoint=(await backend.ready).origin;
    const call=async(route,method='GET',body,token,customOrigin=origin,key)=>{
      const response=await backend.dispatchFetch(endpoint+route,{method,headers:{...(customOrigin?{Origin:customOrigin}:{}),...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(key?{'X-Calendar-SMS-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,headers:response.headers,body:await response.json()};
    };
    const incoming=(body,key)=>call('/api/sms-import/receive','POST',body,null,null,key);
    assert.equal((await incoming({check:true})).status,401);
    assert.equal((await call('/api/sms-import')).status,401);
    assert.equal((await call('/api/info')).body.smsImport,true);
    assert.equal((await call('/api/announcements','GET',null,null,null)).status,403);
    const owner=(await call('/api/setup','POST',{setupToken,name:'Synthetic owner',email:'owner@example.test',password:'Synthetic owner password 2026'})).body;
    const invited=(await call('/api/access','POST',{name:'Synthetic editor',email:'editor@example.test'},owner.token)).body;
    const editor=(await call('/api/invitations/claim','POST',{token:invited.token,password:'Synthetic editor password 2026'})).body;
    const viewer=(await call('/api/register','POST',{name:'Synthetic viewer',email:'viewer@example.test',password:'Synthetic viewer password 2026'})).body;
    for(const actor of [editor,viewer]) for(const method of ['GET','POST','DELETE']) assert.equal((await call('/api/sms-import',method,method==='GET'?null:{revision:0},actor.token)).status,403);
    let configured=await call('/api/sms-import','POST',{revision:0},owner.token),key=configured.body.key;
    assert.match(key,/^[a-f0-9]{64}$/);
    const status=(await call('/api/sms-import','GET',null,owner.token)).body;
    assert(!JSON.stringify(status).includes(key));assert(!('keyHash' in status.connection));
    assert.equal((await incoming({check:true},key)).body.ready,true);
    const text='"Evening shiur"\r\nמנחה בשעה 6:30\nC:\\Signs\\notice & + % 🚪';
    const message={id:randomBytes(16).toString('hex'),text,receivedAt:new Date(Date.now()-10000).toISOString()};
    let result=await incoming(message,key);assert.equal(result.status,201);assert.equal(result.body.posted,true);assert.equal(result.headers.get('Access-Control-Allow-Origin'),null);
    assert.equal((await incoming(message,key)).body.duplicate,true);
    assert.equal((await incoming({...message,text:'Changed original'},key)).status,409);
    let feed=(await call('/api/announcements','GET',null,viewer.token)).body;
    assert.equal(feed.messages.length,1);assert.equal(feed.messages[0].text,text);assert.equal(feed.messages[0].createdAt,message.receivedAt);assert.equal(feed.messages[0].authorName,'Shul');assert.equal(feed.unread,1);
    assert(!JSON.stringify(feed).includes(key));assert(!JSON.stringify(feed).includes(message.id));
    assert.equal((await call('/api/announcements/status','GET',null,owner.token)).body.unread,1);
    const id=result.body.announcementId;
    await call('/api/announcements/'+id,'PUT',{text:'Admin correction',revision:1,operationId:randomBytes(16).toString('hex')},editor.token);
    await incoming(message,key);assert.equal((await call('/api/announcements','GET',null,viewer.token)).body.messages[0].text,'Admin correction');
    await call('/api/announcements/'+id,'DELETE',{},owner.token);await incoming(message,key);
    assert.equal((await call('/api/announcements','GET',null,viewer.token)).body.messages.length,0);
    const long={...message,id:randomBytes(16).toString('hex'),text:'מ'.repeat(15000)};
    result=await incoming(long,key);assert.equal(result.status,201);
    assert.equal((await call('/api/announcements/'+result.body.announcementId,'PUT',{text:'מ'.repeat(14000),revision:1,operationId:randomBytes(16).toString('hex')},editor.token)).status,200);
    for(const change of [{text:''},{text:'x'.repeat(16001)},{receivedAt:'unknown'},{id:'bad'},{text:'\0'}])assert.equal((await incoming({...message,...change},key)).status,400);
    configured=await call('/api/sms-import','POST',{revision:1},owner.token);const old=key;key=configured.body.key;
    assert.equal((await incoming(message,old)).status,401);assert.equal((await incoming(message,key)).body.duplicate,true);
    browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true});
    for(const width of [320,393,1440]){
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.addInitScript(session=>{sessionStorage.setItem('lakewood-commons-calendar-session-v1',JSON.stringify(session));localStorage.setItem('zmanim-nocount','1');},owner);
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
      await page.goto(origin+'/admin/calendar/');await page.locator('[data-cal-access]').click();await page.locator('[data-cal-sms-import]').click();
      await page.getByRole('heading',{name:'Shul SMS connection',exact:true}).waitFor();
      await page.locator('[data-cal-sms-create]').click();await page.locator('[aria-label="Private SMS connection key"]').waitFor({state:'visible'});
      const privateKey=await page.locator('[aria-label="Private SMS connection key"]').inputValue();assert.match(privateKey,/^[a-f0-9]{64}$/);assert.notEqual(privateKey,owner.token);
      assert.equal((await incoming({check:true},privateKey)).status,200);
      await page.locator('[data-cal-sms-refresh]').click();await page.getByText('Connected',{exact:true}).waitFor();
      const bounds=await page.locator('[data-cal-sms-content]').evaluate(el=>({right:el.getBoundingClientRect().right,viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert(bounds.right<=width+1,JSON.stringify(bounds));assert(bounds.scroll<=width+1,JSON.stringify(bounds));
      console.log('SMS connection fits '+width+'px: '+JSON.stringify(bounds));
      await page.locator('[data-cal-sms-disable]').click();await page.getByText('Not connected',{exact:true}).waitFor();
      assert.equal((await incoming({check:true},privateKey)).status,401);
      await context.close();
    }
    assert.deepEqual(errors,[]);console.log('Passed SMS authentication, exact text, long messages, unread counts, deduplication, edit/delete protection, key rotation and browser connection checks.');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{await browser?.close();await backend?.dispose();await new Promise(resolve=>server.close(resolve));}
})();
