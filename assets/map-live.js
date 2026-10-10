(()=>{
 'use strict';
 const get=id=>document.getElementById(id),map=get('geoMap'),notice=get('mapLiveNotice'),dialog=get('nearbyDialog');
 const log=(level,message)=>window.atlasDiagnostics?.log(level,message);
 const identity=eventIdentity,stamp=e=>e.date+'T'+e.time;
 const newUntil=new Map();let noticeKey=null,pulseActive=false;
 window.atlasMap={labelsVisible:true};
 get('mapLabelToggle').onclick=()=>{window.atlasMap.labelsVisible=!window.atlasMap.labelsVisible;get('mapLabelToggle').setAttribute('aria-pressed',String(window.atlasMap.labelsVisible));renderMap();};
 get('mapGoLatest').onclick=()=>focusCatalogEvent(latestCatalogEvent());
 get('mapNoticeClose').onclick=()=>{notice.hidden=true;get('mapGoLatest').focus({preventScroll:true});};
 get('mapNoticeView').onclick=()=>{const e=EVENTS.find(e=>identity(e)===noticeKey);notice.hidden=true;focusCatalogEvent(e);};
 window.atlasLiveUI={
  isNew:e=>(newUntil.get(identity(e))||0)>Date.now(),
  catalogChanged(before,after){
   const old=new Map(before.map(e=>[identity(e),e]));
   const latest=after.reduce((a,e)=>!a||stamp(e)>stamp(a)?e:a,null);
   const prior=before.reduce((a,e)=>!a||stamp(e)>stamp(a)?e:a,null);
   const additions=after.filter(e=>!old.has(identity(e))&&(!prior||stamp(e)>stamp(prior)));
   const revised=after.find(e=>{const a=old.get(identity(e));return a&&[a.mag,a.depth,a.status,a.region].join('|')!==[e.mag,e.depth,e.status,e.region].join('|');});
   const e=additions.length?latest:revised;if(!e)return;
   additions.forEach(e=>newUntil.set(identity(e),Date.now()+90000));
   noticeKey=identity(e);notice.hidden=false;
   get('mapNoticeText').textContent=`${additions.length?'Nuevo registro':'Registro revisado'} · M ${e.mag.toFixed(1)} · ${e.region} · ${eventAgeLabel(e)}`;
   log('info',`${additions.length?'Nuevo registro':'Revisión'} recibido sin recargar: M ${e.mag.toFixed(1)} · ${e.time} Panamá`);
  }
 };
 function updatePulse(){
  const latest=latestCatalogEvent(),age=latest?Date.now()-Date.parse(latest.date+'T'+latest.time+'-05:00'):Infinity;
  const fresh=!!latest&&!latestIsSnapshot&&!!lastSuccessAt&&Date.now()-Date.parse(lastSuccessAt)<5*60000;
  const active=fresh&&(age>=0&&age<30*60000||window.atlasLiveUI.isNew(latest));
  document.querySelector('.latest-alert').classList.toggle('has-recent-event',active);
  let expired=false;for(const [key,until]of newUntil)if(until<=Date.now()){newUntil.delete(key);expired=true;}
  if(pulseActive!==active||expired){pulseActive=active;renderMap();}
  const ageLabel=document.querySelector('.latest-tag .magnitude-label-detail');if(ageLabel&&latest)ageLabel.textContent=eventAgeLabel(latest);
 }
 setInterval(()=>{if(!document.hidden)updatePulse();},10000);

 // One read-only channel per visible tab. HTTP is a recovery path, not a harvester.
 let socket=null,retryTimer=null,attempt=0,lastMessage=0,nextCheck=0,lastBody=null;
 const status=(value,label)=>{get('streamState').dataset.state=value;get('streamState').textContent=label;};
 window.atlasStream={healthy:()=>socket?.readyState===WebSocket.OPEN&&Date.now()-lastMessage<Math.max(180000,nextCheck-lastMessage+60000)};
 function accept(body,etag){
  const rows=normalizeRows(body.events),accepted={...body,events:rows};
  formatUpdated(accepted.fetched_at_utc||accepted.generated_at_utc);
  if(displayCatalog(accepted,'Servicio en vivo · Cloudflare · IGC–UP')){
   lastBody=accepted;cachedCatalogs.set(DATA_URL,{etag,body:accepted});updatePulse();
  }
 }
 function reconnect(){
  if(document.hidden||!navigator.onLine||retryTimer)return;
  const delay=Math.min(30000,1000*2**Math.min(attempt++,5))*(.8+Math.random()*.4);
  retryTimer=setTimeout(()=>{retryTimer=null;connect();},delay);
 }
 function connect(){
  if(document.hidden||!navigator.onLine||socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;
  const url=window.ATLAS_CONFIG?.liveUrl;if(!url){status('fallback','Consulta periódica');return;}
  status('connecting','Conectando…');
  let channel;try{channel=new WebSocket(url);socket=channel;lastMessage=0;nextCheck=0;}catch(error){log('error','Canal en vivo: '+error.message);status('fallback','Reconectando…');reconnect();return;}
  channel.onopen=()=>{if(socket!==channel)return;log('ok','Canal en vivo conectado.');};
  channel.onmessage=event=>{
   if(socket!==channel)return;
   try{
    const message=JSON.parse(event.data);
    if(!['catalog','heartbeat','pending','pong'].includes(message.type))return;
    if(message.type==='catalog')accept(message.payload,message.etag);
    else if(message.type==='heartbeat'){
     window.atlasDiagnostics?.setCollector(message.collector);
     if(lastBody){accept({...lastBody,collector:message.collector,fetched_at_utc:message.collector.fetched_at_utc||lastBody.fetched_at_utc},message.etag);}
     else if(!updating)refreshAutomatically();
    }
    lastMessage=Date.now();nextCheck=Date.parse(message.collector?.next_check_at_utc||message.payload?.collector?.next_check_at_utc)||0;attempt=0;
    status(message.type==='pending'?'connecting':'live',message.type==='pending'?'Preparando datos…':(message.collector||message.payload?.collector)?.status==='failure'?'En vivo · fuente en reintento':'En vivo');
   }catch(error){log('error','Mensaje en vivo rechazado: '+error.message);}
  };
  channel.onerror=()=>{if(socket===channel)log('warning','Canal en vivo interrumpido; se conserva la copia y se reintenta.');};
  channel.onclose=()=>{if(socket!==channel)return;socket=null;status('fallback',navigator.onLine?'Reconectando…':'Sin conexión');reconnect();};
 }
 function disconnect(){clearTimeout(retryTimer);retryTimer=null;const previous=socket;socket=null;previous?.close();}
 document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else{connect();updatePulse();renderMap();}});
 window.addEventListener('offline',()=>{disconnect();status('offline','Sin conexión');});
 window.addEventListener('online',connect);
 setInterval(()=>{if(!document.hidden&&socket?.readyState===WebSocket.OPEN&&!window.atlasStream.healthy()){log('warning','Canal sin respuesta; reconectando.');disconnect();connect();}},30000);
 connect();updatePulse();

 // Pointer gestures work over the SVG and its labels; page scrolling outside stays native.
 const pointers=new Map();let gesture=null,moved=false,suppressUntil=0,lastPointer='mouse',frame=0,tappedTag=null;
 const center=points=>({x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length});
 const distance=points=>points.length>1?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0;
 function begin(){const points=[...pointers.values()];gesture={view:[...state.view],points,center:center(points),distance:distance(points),bounds:map.getBoundingClientRect()};}
 function redraw(){map.setAttribute('viewBox',state.view.join(' '));if(!frame)frame=requestAnimationFrame(()=>{frame=0;renderMap();});}
 function candidatesAt(event,touch){
  const candidates=[];
  for(const node of map.querySelectorAll('.epicenter')){
   const rect=node.querySelector('.marker-outer').getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,d=Math.hypot(cx-event.clientX,cy-event.clientY);
   if(d<=Math.max(touch?22:15,rect.width/2))candidates.push({id:+node.dataset.id,d,cx,cy});
  }
  return candidates.sort((a,b)=>a.d-b.d);
 }
 map.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;lastPointer=event.pointerType;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(pointers.size===1){moved=false;tappedTag=event.target.closest('.magnitude-tag')?.dataset.id||null;}else{moved=true;tappedTag=null;}
  begin();map.setPointerCapture(event.pointerId);hideMapHover();
 });
 map.addEventListener('pointermove',event=>{
  if(!pointers.has(event.pointerId)||!gesture){
   if(event.pointerType!=='touch'){
    const tag=event.target.closest('.magnitude-tag'),id=tag?+tag.dataset.id:candidatesAt(event,false)[0]?.id;
    const e=EVENTS.find(e=>e.id===id);if(e)showMapHover(e);else hideMapHover();
   }
   return;
  }
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const points=[...pointers.values()],c=center(points),g=gesture;
  if(!moved&&Math.hypot(c.x-g.center.x,c.y-g.center.y)<5)return;moved=true;
  const [a,b,w,h]=g.view,oldScale=Math.max(g.bounds.width/w,g.bounds.height/h);
  const ratio=points.length>1&&g.distance>0?g.distance/Math.max(1,distance(points)):1;
  const factor=Math.max(Math.max(65/w,55/h),Math.min(Math.min(1600/w,900/h),ratio));
  const nw=w*factor,nh=h*factor,newScale=Math.max(g.bounds.width/nw,g.bounds.height/nh);
  const bx=g.bounds.left+g.bounds.width/2,by=g.bounds.top+g.bounds.height/2;
  const anchorX=a+w/2+(g.center.x-bx)/oldScale,anchorY=b+h/2+(g.center.y-by)/oldScale;
  state.view=[Math.max(0,Math.min(1600-nw,anchorX-(c.x-bx)/newScale-nw/2)),Math.max(0,Math.min(900-nh,anchorY-(c.y-by)/newScale-nh/2)),nw,nh];
  event.preventDefault();redraw();
 });
 function end(event){if(!pointers.has(event.pointerId))return;if(moved||event.type==='pointercancel')suppressUntil=Date.now()+450;pointers.delete(event.pointerId);if(pointers.size)begin();else gesture=null;}
 for(const name of ['pointerup','pointercancel','lostpointercapture'])map.addEventListener(name,end);
 map.addEventListener('pointerleave',()=>{if(!pointers.size)hideMapHover();});
 map.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY>0?1.13:.88);},{passive:false});
 map.addEventListener('keydown',event=>{if(event.target!==map)return;if(['+','=','-','Home','Escape'].includes(event.key)){event.preventDefault();if(event.key==='Home')focusZone();else if(event.key==='Escape')closeEventPopup();else zoom(event.key==='-'?1.38:.72);}});
 get('nearbyClose').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>map.focus({preventScroll:true}));
 function chooseNearby(candidates){
  closeEventPopup();hideMapHover();get('nearbyEvents').replaceChildren();
  for(const item of candidates.slice(0,6)){
   const e=EVENTS.find(e=>e.id===item.id);if(!e)continue;
   const button=document.createElement('button');button.className='nearby-event';
   const mag=document.createElement('strong');mag.textContent='M '+e.mag.toFixed(1);mag.style.color=rgb(e);
   const details=document.createElement('span'),title=document.createElement('b'),meta=document.createElement('small');
   title.textContent=e.region;meta.textContent=`${dateShort(e.date)} · ${e.time} · ${e.depth} km · ${e.status}`;details.append(title,meta);button.append(mag,details);
   button.onclick=()=>{dialog.close();selectEvent(e.id,false,true);};get('nearbyEvents').append(button);
  }
  dialog.showModal();
 }
 map.addEventListener('click',event=>{
  if(Date.now()<suppressUntil){event.preventDefault();return;}
  const tag=event.target.closest('.magnitude-tag');if(tag||tappedTag){const id=+(tag?.dataset.id||tappedTag);tappedTag=null;selectEvent(id,false,true);return;}
  const touch=(event.pointerType||lastPointer)==='touch',candidates=candidatesAt(event,touch);
  if(touch&&candidates.length>1&&candidates[1].d-candidates[0].d<6&&Math.hypot(candidates[0].cx-candidates[1].cx,candidates[0].cy-candidates[1].cy)<18){chooseNearby(candidates);return;}
  if(candidates.length)selectEvent(candidates[0].id,false,true);else closeEventPopup();
 });
})();
