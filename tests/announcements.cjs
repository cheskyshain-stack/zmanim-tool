const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{createHash,randomBytes,hkdfSync}=require('node:crypto');
const {Miniflare,convertV4MiniflareOptions}=require('../worker/announcements/node_modules/miniflare');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.ANNOUNCEMENTS_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'announcements-'));
fs.mkdirSync(out,{recursive:true});
const setupToken=randomBytes(32).toString('hex'),ownerPassword='Synthetic owner password 2026',editorPassword='Synthetic editor password 2026';
const requests=[],errors=[],checks=[];
let backend,endpoint='';
const server=http.createServer((req,res)=>{
 if(req.url.split('?')[0]==='/data/announcements.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({endpoint}));}
 let file=path.resolve(root,'dist','.'+req.url.split('?')[0]);if(!file.startsWith(path.join(root,'dist')+path.sep))return res.writeHead(403).end();
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 if(!fs.existsSync(file))return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Timed out waiting for notification delivery.');};
async function decryptPush(request,privateKey,clientPublic,auth){
 const data=new Uint8Array(request.body),salt=data.slice(0,16),length=data[20],serverPublic=data.slice(21,21+length);
 const peer=await crypto.subtle.importKey('raw',serverPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:peer},privateKey,256));
 const info=Buffer.concat([Buffer.from('WebPush: info\0'),clientPublic,serverPublic]);
 const ikm=hkdfSync('sha256',shared,auth,info,32),key=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['decrypt']);
 const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,data.slice(21+length)));
 let end=plain.length;while(plain[end-1]===0)end--;assert.equal(plain[end-1],2);return JSON.parse(new TextDecoder().decode(plain.slice(0,end-1)));
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const build=path.join(out,'worker');
 execFileSync(path.join(root,'worker/announcements/node_modules/.bin/wrangler'),['deploy','--dry-run','--config','worker/announcements/wrangler.jsonc','--outdir',build],{cwd:root,stdio:'pipe'});
 backend=new Miniflare(convertV4MiniflareOptions({name:'announcements',modules:true,script:fs.readFileSync(path.join(build,'worker.js'),'utf8'),compatibilityDate:'2026-10-01',bindings:{ALLOWED_ORIGIN:origin,BOOTSTRAP_SHA256:createHash('sha256').update(setupToken).digest('hex')},
  durableObjects:{ANNOUNCEMENTS:{className:'AnnouncementBoard',useSQLite:true}},serviceBindings:{PUSH_DELIVERY:async request=>{requests.push({url:request.url,headers:Object.fromEntries(request.headers),body:await request.arrayBuffer()});return new Response('',{status:201});}}}));
 endpoint=(await backend.ready).origin;
 const call=async(route,method='GET',body,token,customOrigin=origin)=>{
  const response=await backend.dispatchFetch('https://service.test'+route,{method,headers:{Origin:customOrigin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,body:await response.json()};
 };
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  assert.equal((await call('/api/manage/posts')).status,401);assert.equal((await call('/api/posts','GET',null,null,'https://unrelated.example')).status,403);
  assert.equal((await call('/api/setup','POST',{setupToken:'wrong',name:'Owner',email:'owner@example.test',password:ownerPassword})).status,401);
  const owner=await call('/api/setup','POST',{setupToken,name:'Test owner',email:'owner@example.test',password:ownerPassword});assert.equal(owner.status,201);assert.equal(owner.body.user.role,'owner');
  assert.equal((await call('/api/setup','POST',{setupToken})).status,409);
  const info=await call('/api/info');assert.equal(info.body.ready,true);assert.equal(Buffer.from(info.body.publicKey,'base64url').length,65);assert(!JSON.stringify(info.body).includes('privateKey'));
  const invite=await call('/api/access','POST',{name:'Test poster',email:'test-poster@example.test',role:'owner'},owner.body.token);assert.equal(invite.status,201);assert.equal(invite.body.user.role,'editor');
  const editor=await call('/api/invitations/claim','POST',{token:invite.body.token,password:editorPassword});assert.equal(editor.status,200);
  assert.equal((await call('/api/invitations/claim','POST',{token:invite.body.token,password:editorPassword})).status,401);
  assert.equal((await call('/api/access','GET',null,editor.body.token)).status,403);
  assert.equal((await call('/api/access','POST',{name:'Other',email:'other@example.test'},editor.body.token)).status,403);
  checks.push('server authentication, one-use invitations, owner/editor role enforcement');
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),clientPublic=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)),auth=randomBytes(16);
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-owned-test',keys:{p256dh:clientPublic.toString('base64url'),auth:auth.toString('base64url')}};
  assert.equal((await call('/api/subscriptions','POST',{...sub,endpoint:'https://127.0.0.1/private'})).status,400);
  assert.equal((await call('/api/subscriptions','POST',{...sub,keys:{...sub.keys,p256dh:Buffer.alloc(65).toString('base64url')}})).status,400);
  assert.equal((await call('/api/subscriptions','POST',sub)).status,200);
  const id=crypto.randomUUID(),draft={title:'Tomorrow’s shul update',body:'This is a test message.\nשחרית בשעה 7:00',status:'draft',expiresAt:'',revision:0};
  const saved=await call('/api/manage/posts/'+id,'PUT',draft,editor.body.token);assert.equal(saved.status,201);assert.equal((await call('/api/posts')).body.posts.length,0);
  const published=await call('/api/manage/posts/'+id,'PUT',{...draft,status:'published',revision:1},editor.body.token);assert.equal(published.status,200);
  assert.equal((await call('/api/posts')).body.posts[0].id,id);
  await wait(()=>requests.length===1);
  assert.equal(requests[0].headers['content-encoding'],'aes128gcm');assert(requests[0].headers.authorization.startsWith('vapid '));
  const decoded=await decryptPush(requests[0],pair.privateKey,clientPublic,auth);assert.equal(decoded.title,draft.title);assert.equal(decoded.body,draft.body);assert.equal(new URL(decoded.url).searchParams.get('post'),id);
  assert.equal((await call('/api/manage/posts/'+id,'PUT',{...draft,status:'published',revision:1},editor.body.token)).status,409);
  assert.equal((await call('/api/manage/posts/'+id,'PUT',{...draft,title:'Updated message',status:'published',revision:2},editor.body.token)).status,200);
  await new Promise(resolve=>setTimeout(resolve,1300));assert.equal(requests.length,1,'Editing or retrying does not send duplicate alerts');
  assert.equal((await call('/api/subscriptions','DELETE',{...sub,keys:{...sub.keys,auth:randomBytes(16).toString('base64url')}})).status,403);
  assert.equal((await call('/api/subscriptions','DELETE',sub)).status,200);
  const expiresId=crypto.randomUUID();
  assert.equal((await call('/api/manage/posts/'+expiresId,'PUT',{...draft,status:'published',expiresAt:new Date(Date.now()-1000).toISOString()},editor.body.token)).status,400);
  assert.equal((await call('/api/manage/posts/'+expiresId,'PUT',{...draft,status:'published',expiresAt:new Date(Date.now()+1000).toISOString()},editor.body.token)).status,201);
  assert((await call('/api/posts')).body.posts.some(post=>post.id===expiresId));await new Promise(resolve=>setTimeout(resolve,1200));
  assert(!(await call('/api/posts')).body.posts.some(post=>post.id===expiresId),'Expired messages disappear from the public feed');
  checks.push('draft/public visibility, optimistic concurrency, real Web Push encryption and decryption, single alert, endpoint validation and opt-out');
  for(const width of [375,1440]){
   const context=await browser.newContext({viewport:{width,height:950},permissions:['notifications']});await context.addInitScript(()=>localStorage.setItem('zmanim-nocount','1'));
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
   await page.goto(origin+'/announcements/manage/');await page.getByLabel('Email',{exact:true}).fill('test-poster@example.test');await page.getByLabel('Password',{exact:true}).fill(editorPassword);await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await page.getByRole('heading',{name:'New message',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Posting access',exact:true}).count(),0);
   await page.getByLabel('Title',{exact:true}).fill('A new shul message '+width);await page.getByLabel('Message',{exact:true}).fill('A test announcement for the shul.\nשלום וברכה <img src=x onerror=alert(1)>');
   await page.getByRole('button',{name:'Preview',exact:true}).click();assert.equal(await page.locator('#announcement-message-preview img').count(),0);assert.match(await page.locator('#announcement-message-preview').innerText(),/שלום וברכה/);
   await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved.',{exact:true}).waitFor();
   const publicPage=await context.newPage();await publicPage.goto(origin+'/announcements/');await publicPage.getByRole('heading',{name:'Updated message',exact:true}).waitFor();assert.equal(await publicPage.getByRole('heading',{name:'A new shul message '+width,exact:true}).count(),0);
   await page.getByRole('button',{name:'Publish and notify',exact:true}).click();await page.getByText('Message published.',{exact:true}).waitFor();
   await publicPage.reload();await publicPage.getByRole('heading',{name:'A new shul message '+width,exact:true}).waitFor();assert.equal(await publicPage.locator('.announcement-message img').count(),0);
   await page.getByLabel('Message',{exact:true}).fill('Tomorrow’s shiur will begin at 8:15 PM.\nAll are welcome.\nהשיעור מחר בשעה 8:15 בערב.');
   await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Changes saved.',{exact:true}).waitFor();
   await publicPage.reload();await publicPage.getByRole('heading',{name:'A new shul message '+width,exact:true}).waitFor();assert.match(await publicPage.locator('.announcement-message').first().innerText(),/8:15 PM/);
   for(const tab of [page,publicPage]){assert(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await tab.screenshot({path:path.join(out,width+(tab===page?'-editor.png':'-announcements.png')),fullPage:true});}
   await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
   await page.getByLabel('Email',{exact:true}).fill('owner@example.test');await page.getByLabel('Password',{exact:true}).fill(ownerPassword);await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await page.getByRole('heading',{name:'Posting access',exact:true}).waitFor();await page.getByRole('button',{name:'Use a test person',exact:true}).click();assert.equal(await page.locator('#announcement-access-form [name=email]').inputValue(),'test-poster@example.test');
   assert(!await page.locator('#announcement-invitation').isVisible());
   await page.screenshot({path:path.join(out,width+'-owner.png'),fullPage:true});
   await page.locator('#announcement-access-form [name=email]').fill('test-poster-'+width+'@example.test');await page.getByRole('button',{name:'Create posting link',exact:true}).click();
   await page.getByText('Posting link created.',{exact:true}).waitFor();const postingLink=await page.locator('#announcement-invitation textarea').inputValue();
   const invitedContext=await browser.newContext(),invitedPage=await invitedContext.newPage();
   await invitedPage.goto(postingLink);await invitedPage.getByLabel('Password',{exact:true}).fill(editorPassword);await invitedPage.getByRole('button',{name:'Create account',exact:true}).click();
   await invitedPage.getByRole('heading',{name:'New message',exact:true}).waitFor();assert.equal(new URL(invitedPage.url()).hash,'');assert.equal(await invitedPage.getByRole('heading',{name:'Posting access',exact:true}).count(),0);
   await invitedPage.getByRole('button',{name:'Sign out',exact:true}).click();await invitedPage.getByRole('button',{name:'Sign in',exact:true}).waitFor();await invitedContext.close();
   checks.push('phone/desktop editor, safe Hebrew and text, draft/preview/publish, public reading, owner-only access controls at '+width);await context.close();
  }
  const notificationContext=await browser.newContext({viewport:{width:390,height:844}});
  await notificationContext.addInitScript(sub=>{
   window.permissionRequests=0;window.subscriptionActive=false;
   class TestNotification{static permission='default';static requestPermission(){window.permissionRequests++;this.permission='granted';return Promise.resolve('granted');}}window.Notification=TestNotification;window.PushManager=class {};
   const subscription={endpoint:sub.endpoint,toJSON:()=>sub,unsubscribe:async()=>{window.subscriptionActive=false;return true;}};
   const registration={active:{scriptURL:location.origin+'/announcements-sw.js'},pushManager:{getSubscription:async()=>window.subscriptionActive?subscription:null,subscribe:async()=>{window.subscriptionActive=true;return subscription;}}};
   Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)}});
  },sub);
  const notificationPage=await notificationContext.newPage();await notificationPage.goto(origin+'/announcements/');await notificationPage.getByRole('button',{name:'Notify me of new messages',exact:true}).waitFor();assert.equal(await notificationPage.evaluate(()=>window.permissionRequests),0);
  await notificationPage.getByRole('button',{name:'Notify me of new messages',exact:true}).click();await notificationPage.getByText('Notifications are on for this device.',{exact:true}).waitFor();assert.equal(await notificationPage.evaluate(()=>window.permissionRequests),1);
  await notificationPage.getByRole('button',{name:'Turn off notifications',exact:true}).click();await notificationPage.getByRole('button',{name:'Notify me of new messages',exact:true}).waitFor();await notificationContext.close();
  checks.push('notification opt-in only on a user click, browser subscription registration and opt-out');
  const workerContext=await browser.newContext({permissions:['notifications']});
  const workerPage=await workerContext.newPage();await workerPage.goto(origin+'/announcements/');
  const cdp=await workerContext.newCDPSession(workerPage);let registrationId='';
  cdp.on('ServiceWorker.workerRegistrationUpdated',event=>{for(const registration of event.registrations)if(registration.scopeURL===origin+'/announcements/')registrationId=registration.registrationId;});
  await cdp.send('ServiceWorker.enable');
  await workerPage.evaluate(async()=>{await navigator.serviceWorker.register('/announcements-sw.js',{scope:'/announcements/'});await navigator.serviceWorker.ready;});
  await wait(()=>registrationId);
  await cdp.send('ServiceWorker.deliverPushMessage',{origin,registrationId,data:JSON.stringify({title:'Local notification check',body:'A local synthetic push.',url:'https://unrelated.example/private',tag:'local-check'})});
  await wait(()=>workerPage.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/announcements/');return (await reg.getNotifications()).some(value=>value.title==='Local notification check');}));
  const shown=await workerPage.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/announcements/');const value=(await reg.getNotifications()).find(value=>value.title==='Local notification check');return {body:value.body,url:value.data.url};});
  assert.equal(shown.body,'A local synthetic push.');assert.equal(shown.url,origin+'/announcements/');await workerContext.close();
  checks.push('real service worker displays a local synthetic notification and restricts its link to the shul site');
  await call('/api/access/'+editor.body.user.id,'DELETE',null,owner.body.token);assert.equal((await call('/api/manage/posts','GET',null,editor.body.token)).status,401);
  const locked=await browser.newPage();locked.on('pageerror',error=>errors.push(error.message));await locked.addInitScript(()=>localStorage.setItem('zmanim-admin-unlock',JSON.stringify({at:Date.now()})));await locked.goto(origin+'/offline/');await locked.locator('.admin-home').waitFor();assert.equal(await locked.locator('#announcements-manage').count(),0);
  await locked.locator('#nav [data-tab=charts]').click();await locked.locator('.page').first().waitFor();await locked.evaluate(()=>document.fonts.ready);
  const offlinePDF=await locked.pdf({preferCSSPageSize:true,printBackground:true});
  assert((offlinePDF.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>=1);assert.match(execFileSync('pdftotext',['-layout','-','-'],{input:offlinePDF,encoding:'utf8'}),/Bais Medrash/);
  fs.writeFileSync(path.join(out,'offline-charts.pdf'),offlinePDF);await locked.close();
  checks.push('revoked sessions stop working; standalone announcement programs do not execute in the offline admin');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors,encryptedPushes:requests.length},null,2));console.log(JSON.stringify({checks,errors,out}));
 }finally{await browser.close();await backend.dispose();await new Promise(resolve=>server.close(resolve));}
})().catch(async error=>{console.error(error);if(backend)await backend.dispose();server.close();process.exitCode=1;});
