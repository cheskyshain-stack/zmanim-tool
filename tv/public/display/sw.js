// Retirement only: /display/ no longer serves a screen or redirects to /tv/.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('shul-view-shell-'))await caches.delete(name);
  await self.clients.claim();
  await self.registration.unregister();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin===self.location.origin&&(url.pathname==='/display'||url.pathname.startsWith('/display/'))){
    event.respondWith(new Response('This page has been removed.',{status:410,headers:{'Content-Type':'text/plain; charset=utf-8'}}));
  }
});
