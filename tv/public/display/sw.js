// Built for both the canonical and legacy scopes. Each scope owns its caches.
const CACHE_PREFIX='__CACHE_PREFIX__';
const CACHE=CACHE_PREFIX+'__CACHE_VERSION__';
const PUBLIC_ASSETS=__PUBLIC_ASSETS__;
const allowed=new Set(PUBLIC_ASSETS);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  const request=url=>new Request(url,{cache:'reload',credentials:'omit'});
  await cache.addAll(PUBLIC_ASSETS.filter(url=>url!=='/display/').map(request));
  if(allowed.has('/display/')){
    // The legacy URL now redirects online. Store a non-redirected copy of the
    // canonical shell for old bookmarks that are opened without a connection.
    const response=await fetch(request('/tv/'));
    if(!response.ok||new URL(response.url).origin!==self.location.origin)throw new Error('Unable to cache the public screen.');
    await cache.put('/display/',new Response(await response.arrayBuffer(),{status:response.status,statusText:response.statusText,headers:response.headers}));
  }
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith(CACHE_PREFIX)&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Never intercept admin pages, authentication, private previews or API calls.
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!allowed.has(url.pathname)||url.search)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(event.request,{signal:AbortSignal.timeout(4000)});
      // Navigation fetches may expose a manual redirect. Let the browser follow
      // it instead of substituting the legacy cached page on a good connection.
      if(response.type==='opaqueredirect'||response.redirected)return response;
      if(response.ok&&!response.redirected){await cache.put(url.pathname,response.clone());return response;}
      const cached=await cache.match(url.pathname);return cached||response;
    }catch{
      const cached=await cache.match(url.pathname);
      return cached||new Response('Reconnect once to load Shul View.',{status:503,headers:{'Content-Type':'text/plain'}});
    }
  })());
});
