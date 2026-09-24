// Replaced by the build with a content hash and an explicit public-file list.
const CACHE='shul-view-shell-__CACHE_VERSION__';
const PUBLIC_ASSETS=__PUBLIC_ASSETS__;
const allowed=new Set(PUBLIC_ASSETS);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(PUBLIC_ASSETS.map(url=>new Request(url,{cache:'reload',credentials:'omit'})));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('shul-view-shell-')&&name!==CACHE)await caches.delete(name);
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
      if(response.ok&&!response.redirected){await cache.put(url.pathname,response.clone());return response;}
      const cached=await cache.match(url.pathname);return cached||response;
    }catch{
      const cached=await cache.match(url.pathname);
      return cached||new Response('Reconnect once to load Shul View.',{status:503,headers:{'Content-Type':'text/plain'}});
    }
  })());
});
