function eventIdentity(e){return [e.date,e.time,e.lat,e.lon].join('|');}
function eventAgeLabel(e){
 const delta=Date.now()-Date.parse(e.date+'T'+e.time+'-05:00');
 if(!Number.isFinite(delta)||delta<0)return formatLocalTime(e.time,false)+' · Panamá';
 const minutes=Math.floor(delta/60000);
 return minutes<1?'hace menos de 1 min':minutes<60?'hace '+minutes+' min':minutes<1440?'hace '+Math.floor(minutes/60)+' h':dateShort(e.date)+' · '+formatLocalTime(e.time,false);
}
function markerMetricsPx(mag,mobile=matchMedia('(max-width:630px)').matches){
 const scale=Math.pow(Math.max(0,Math.min(9,mag))/9,1.1);
 const referenceWidth=x(-79.15)-x(-82.65);
 const zoomFactor=Math.max(.72,Math.min(1,Math.pow(state.view[2]/referenceWidth,.18)));
 return {radius:Math.max(7.5,(8.5+scale*(mobile?4.5:5.5))*zoomFactor),fontSize:Math.max(7.5,(8+scale*3)*zoomFactor)};
}
function markerRadiusPx(mag,mobile=matchMedia('(max-width:630px)').matches){return markerMetricsPx(mag,mobile).radius;}
function resizeMarkersDuringZoom(){
 const map=$('geoMap'),group=$('mapMarkers'),bounds=map.getBoundingClientRect();
 const k=Math.max(bounds.width/state.view[2],bounds.height/state.view[3],.01),mobile=matchMedia('(max-width:630px)').matches;
 if(Number(group.dataset.markerScale)===k)return;
 for(const node of group.querySelectorAll('.epicenter')){
  const metrics=markerMetricsPx(Number(node.dataset.mag),mobile),outer=node.querySelector('.marker-outer');
  outer.setAttribute('r',metrics.radius/k);outer.style.strokeWidth=1/k;
  node.querySelector('.point-hit').setAttribute('r',Math.max(metrics.radius,mobile?22:15)/k);
  node.querySelector('.marker-value').style.fontSize=metrics.fontSize/k+'px';
  const ring=node.querySelector('.selected-ring');if(ring){ring.setAttribute('r',(metrics.radius+4)/k);ring.style.strokeWidth=1.7/k;ring.style.strokeDasharray=4/k+' '+3/k;}
  const locator=node.querySelector('.latest-location-ring');if(locator){locator.setAttribute('r',(metrics.radius+3)/k);locator.style.strokeWidth=2/k;}
  node.querySelectorAll('.latest-pulse').forEach(pulse=>{pulse.setAttribute('r',(metrics.radius+(node.classList.contains('latest-event')?3:5))/k);pulse.style.strokeWidth=(node.classList.contains('latest-event')?2:1.5)/k;});
 }
 group.dataset.markerScale=String(k);
}
function renderMap(){
 if(window.atlasMap?.isGesturing)return;
 const svg=$('geoMap'),bounds=svg.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
 const mobile=matchMedia('(max-width:630px)').matches,k=Math.max(bounds.width/state.view[2],bounds.height/state.view[3],.01);
 svg.setAttribute('viewBox',state.view.join(' '));
 renderLatestMapCard();
 const left=state.view[0]+(state.view[2]-bounds.width/k)/2,top=state.view[1]+(state.view[3]-bounds.height/k)/2;
 const latest=latestCatalogEvent();
 const toScreen=e=>({x:(x(e.lon)-left)*k,y:(y(e.lat)-top)*k});
 const visible=lastFilter.filter(e=>{const p=toScreen(e);return p.x>=-25&&p.x<=bounds.width+25&&p.y>=-25&&p.y<=bounds.height+25;});
 const ordered=visible.slice().sort((a,b)=>((a.id===state.selected?1:0)+(a.id===latest?.id?2:0))-((b.id===state.selected?1:0)+(b.id===latest?.id?2:0))||a.mag-b.mag);
 let contents='';
 for(const e of ordered){
  const metrics=markerMetricsPx(e.mag,mobile),r=metrics.radius/k,c=rgb(e),selected=e.id===state.selected,isLatest=e.id===latest?.id;
  const newlyPublished=!!window.atlasLiveUI?.isNew(e);
  const name=`${isLatest?'Último registro · ':''}M ${e.mag.toFixed(1)} · ${e.region} · ${e.depth} km · ${formatLocalTime(e.time,false)} Panamá`;
  contents+=`<g class="point epicenter ${isLatest?'latest-event':''} ${newlyPublished?'new-event':''}" data-id="${e.id}" data-mag="${e.mag}" style="--epicenter-accent:${c}" role="button" tabindex="0" aria-label="${escaped(name)}">`;
  if(isLatest){
   contents+=`<circle class="latest-location-ring" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r+3/k}" style="stroke-width:${2/k}"/>`;
   for(const delay of ['', ' latest-pulse-lag'])contents+=`<circle class="latest-pulse${delay}" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r+3/k}" style="stroke-width:${2/k}"/>`;
  }else if(newlyPublished)contents+=`<circle class="latest-pulse" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r+5/k}" style="stroke-width:${1.5/k}"/>`;
  contents+=`<circle class="point-hit" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${Math.max(r,(mobile?22:15)/k)}"/><circle class="marker-outer" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r}" fill="${c}" stroke="${c}" style="stroke-width:${1/k}"/>`;
  if(selected)contents+=`<circle class="selected-ring" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r+4/k}" style="stroke-width:${1.7/k};stroke-dasharray:${4/k} ${3/k}"/>`;
  contents+=`<text class="marker-value" x="${x(e.lon)}" y="${y(e.lat)}" dy=".35em" text-anchor="middle" style="font-size:${metrics.fontSize/k}px">${e.mag.toFixed(1)}</text>`;
  contents+='</g>';
 }
 const intersects=(a,b)=>a.x<b.x+b.w+5&&a.x+a.w+5>b.x&&a.y<b.y+b.h+5&&a.y+a.h+5>b.y;
 const reserved=[...document.querySelectorAll('.map-info,.map-ctrl,.map-legend,#mapLatestHover')].filter(el=>el.offsetParent&&!el.hidden).map(el=>{const b=el.getBoundingClientRect();return{x:b.left-bounds.left,y:b.top-bounds.top,w:b.width,h:b.height};});
 $('mapMarkers').innerHTML=contents;
 $('mapMarkers').dataset.markerScale=String(k);
 $('mapMarkers').querySelectorAll('.point').forEach(node=>{
  node.addEventListener('pointerenter',ev=>{if(ev.pointerType!=='touch'){const e=EVENTS.find(e=>e.id===+node.dataset.id);if(e)showMapHover(e);}});node.addEventListener('pointerleave',hideMapHover);
  node.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();selectEvent(+node.dataset.id,false,true);}});
 });
 if(!$('mapPopup').hidden&&state.mode==='2d')requestAnimationFrame(positionEventPopup);
 // City names use screen-sized text and yield to controls and event labels.
 const places=[...document.querySelectorAll('.place')].sort((a,b)=>Number(!!b.querySelector('.important'))-Number(!!a.querySelector('.important')));
 for(const place of places){
  const text=place.querySelector('text'),circle=place.querySelector('circle');if(!text||!circle)continue;
  text.removeAttribute('transform');text.style.visibility='';text.style.fontSize=(text.classList.contains('important')?13:11)/k+'px';text.style.strokeWidth=3/k+'px';circle.setAttribute('r',2.4/k);
  const dot=circle.getBoundingClientRect();if(dot.left<bounds.left||dot.right>bounds.right||dot.top<bounds.top||dot.bottom>bounds.bottom){text.style.visibility='hidden';continue;}
  let fit=false;
  for(const [dx,dy] of [[0,0],[0,-15],[0,16],[-16,0],[16,0]]){
   text.setAttribute('transform',`translate(${dx/k} ${dy/k})`);const b=text.getBoundingClientRect();
   const edgeX=b.right>bounds.right-7?bounds.right-7-b.right:b.left<bounds.left+7?bounds.left+7-b.left:0;
   if(edgeX)text.setAttribute('transform',`translate(${(dx+edgeX)/k} ${dy/k})`);
   const final=text.getBoundingClientRect(),box={x:final.left-bounds.left,y:final.top-bounds.top,w:final.width,h:final.height};
   if(box.y>=6&&box.y+box.h<=bounds.height-6&&!reserved.some(r=>intersects(box,r))){reserved.push(box);fit=true;break;}
  }
  if(!fit)text.style.visibility='hidden';
 }
 document.querySelectorAll('.map-territory').forEach(el=>el.style.fontSize=15/k+'px');
 window.atlasDistricts?.layer();
}
