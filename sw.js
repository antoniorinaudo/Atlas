const CACHE='atlas-mobile-pwa-20261015-23',VERSION='?v=20261015-whatsapp23';
const files=['./','manifest.webmanifest','assets/icon-192.png','assets/icon-512.png',...['config.js','sources.js','sources.css','time-format.js','map-cards.js','diagnostico.js','diagnostico.css','map-live.js','map-render.js','map-live.css','pwa.js','pwa.css','minimal.css','header-latest.js','chart-view.js','chart-view.css','districts.js','districts.css','distritos.json'].map(file=>'assets/'+file+VERSION)];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(files)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('atlas-mobile-pwa-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url),base=new URL(self.registration.scope);
 if(event.request.method!=='GET'||url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||url.pathname.endsWith('/sismos.json')||url.pathname.endsWith('/diagnostico.json'))return;
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(new Request(base.href),copy)));}return response;}).catch(()=>caches.match(base.href,{ignoreSearch:true})));
 else if(files.some(file=>new URL(file,base).pathname===url.pathname))event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request,{ignoreSearch:true})));
});
self.addEventListener('push',event=>{
 let data;try{data=event.data?.json();}catch{}
 const title=data?.title||'Atlas Sísmico Panamá';
 event.waitUntil(self.registration.showNotification(title,{body:data?.body||'Hay un aviso del catálogo del Atlas. Abre la app para consultarlo.',icon:new URL('assets/icon-192.png',self.registration.scope).href,badge:new URL('assets/icon-192.png',self.registration.scope).href,tag:data?.tag||'atlas-registro',data:{event:data?.event||null},timestamp:data?.timestamp||Date.now(),silent:false,renotify:true,vibrate:[200,100,200]}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const key=event.notification.data?.event;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const base=new URL(self.registration.scope),existing=windows.find(client=>{const url=new URL(client.url);return url.origin===base.origin&&url.pathname.startsWith(base.pathname);});
  if(existing){await existing.focus();if(key)existing.postMessage({type:'atlas-open-event',event:key});return;}
  const url=new URL(base);if(key)url.searchParams.set('event',key);await self.clients.openWindow(url.href);
 })());
});
