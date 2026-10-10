function eventIdentity(e){return [e.date,e.time,e.lat,e.lon].join('|');}
function eventAgeLabel(e){
 const delta=Date.now()-Date.parse(e.date+'T'+e.time+'-05:00');
 if(!Number.isFinite(delta)||delta<0)return e.time.slice(0,5)+' · Panamá';
 const minutes=Math.floor(delta/60000);
 return minutes<1?'hace menos de 1 min':minutes<60?'hace '+minutes+' min':minutes<1440?'hace '+Math.floor(minutes/60)+' h':dateShort(e.date)+' · '+e.time.slice(0,5);
}
function markerMetricsPx(mag,mobile=matchMedia('(max-width:630px)').matches){
 const scale=Math.pow(Math.max(0,Math.min(9,mag))/9,1.1);
 return {radius:9+scale*(mobile?12:15),fontSize:9+scale*(mobile?6.5:8)};
}
function markerRadiusPx(mag,mobile=matchMedia('(max-width:630px)').matches){return markerMetricsPx(mag,mobile).radius;}
function renderMap(){
 if(window.atlasMap?.isGesturing)return;
 const svg=$('geoMap'),bounds=svg.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
 const mobile=matchMedia('(max-width:630px)').matches,k=Math.max(bounds.width/state.view[2],bounds.height/state.view[3],.01);
 svg.setAttribute('viewBox',state.view.join(' '));
 const left=state.view[0]+(state.view[2]-bounds.width/k)/2,top=state.view[1]+(state.view[3]-bounds.height/k)/2;
 const latest=latestCatalogEvent(),labelsOn=window.atlasMap?.labelsVisible!==false;
 const toScreen=e=>({x:(x(e.lon)-left)*k,y:(y(e.lat)-top)*k});
 const visible=lastFilter.filter(e=>{const p=toScreen(e);return p.x>=-25&&p.x<=bounds.width+25&&p.y>=-25&&p.y<=bounds.height+25;});
 const ordered=visible.slice().sort((a,b)=>((a.id===state.selected?1:0)+(a.id===latest?.id?2:0))-((b.id===state.selected?1:0)+(b.id===latest?.id?2:0))||a.mag-b.mag);
 let contents='';
 for(const e of ordered){
  const metrics=markerMetricsPx(e.mag,mobile),r=metrics.radius/k,c=rgb(e),selected=e.id===state.selected,isLatest=e.id===latest?.id;
  const age=Date.now()-Date.parse(e.date+'T'+e.time+'-05:00');
  const recent=!latestIsSnapshot&&lastSuccessAt&&Date.now()-Date.parse(lastSuccessAt)<5*60000&&age>=0&&age<30*60000;
  const newlyPublished=!!window.atlasLiveUI?.isNew(e);
  const name=`${isLatest?'Último registro · ':''}M ${e.mag.toFixed(1)} · ${e.region} · ${e.depth} km · ${e.time.slice(0,5)} Panamá`;
  contents+=`<g class="point epicenter ${isLatest?'latest-event':''} ${newlyPublished?'new-event':''}" data-id="${e.id}" role="button" tabindex="0" aria-label="${escaped(name)}">`;
  if((isLatest&&recent)||newlyPublished)contents+=`<circle class="latest-pulse" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r+5/k}" style="stroke-width:${1.5/k}"/>`;
  if(e.mag>=6)contents+=`<circle class="marker-halo" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r*1.55}" fill="${c}"/>`;
  contents+=`<circle class="point-hit" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${Math.max(r,(mobile?22:15)/k)}"/><circle class="marker-outer" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r}" fill="${c}" stroke="${c}" style="stroke-width:${1/k}"/>`;
  if(selected)contents+=`<circle class="selected-ring" cx="${x(e.lon)}" cy="${y(e.lat)}" r="${r+4/k}" style="stroke-width:${1.7/k};stroke-dasharray:${4/k} ${3/k}"/>`;
  contents+=`<text class="marker-value" x="${x(e.lon)}" y="${y(e.lat)}" dy=".35em" text-anchor="middle" style="font-size:${metrics.fontSize/k}px">${e.mag.toFixed(1)}</text>`;
  contents+='</g>';
 }
 const intersects=(a,b)=>a.x<b.x+b.w+5&&a.x+a.w+5>b.x&&a.y<b.y+b.h+5&&a.y+a.h+5>b.y;
 const reserved=[...document.querySelectorAll('.map-info,.map-ctrl,.map-legend')].filter(el=>el.offsetParent).map(el=>{const b=el.getBoundingClientRect();return{x:b.left-bounds.left,y:b.top-bounds.top,w:b.width,h:b.height};});
 const selected=visible.find(e=>e.id===state.selected);
 const priorities=[latest&&visible.find(e=>e.id===latest.id),selected,...(labelsOn?visible.filter(e=>e.mag>=5).sort((a,b)=>b.mag-a.mag):[])].filter(Boolean);
 const seen=new Set();let labelCount=0;
 for(const e of priorities){
  if(seen.has(e.id))continue;seen.add(e.id);
  const isLatest=e.id===latest?.id,isSelected=e.id===state.selected;
  if(!isLatest&&!isSelected&&labelCount>=(mobile?3:7))continue;
  const p=toScreen(e),radius=markerRadiusPx(e.mag,mobile),w=isLatest?148:isSelected?142:60,h=isLatest||isSelected?42:27;
  if(p.x<0||p.x>bounds.width||p.y<0||p.y>bounds.height)continue;
  const proposed=[[p.x+radius+9,p.y-h-radius-7],[p.x-w-radius-9,p.y-h-radius-7],[p.x+radius+9,p.y+radius+8],[p.x-w-radius-9,p.y+radius+8],[p.x-w/2,p.y-h-radius-12],[p.x-w/2,p.y+radius+13]];
  let best=null;
  for(const [px,py] of proposed){
   const box={x:Math.max(8,Math.min(bounds.width-w-8,px)),y:Math.max(8,Math.min(bounds.height-h-8,py)),w,h};
   if(reserved.some(b=>intersects(box,b)))continue;
   const crowd=visible.filter(other=>other.id!==e.id).reduce((sum,other)=>{const q=toScreen(other);return sum+(q.x>box.x-5&&q.x<box.x+w+5&&q.y>box.y-5&&q.y<box.y+h+5?1:0);},0);
   const score=crowd*100+Math.hypot(box.x+w/2-p.x,box.y+h/2-p.y);
   if(!best||score<best.score)best={...box,score};
  }
  if(!best)continue;
  reserved.push(best);labelCount++;
  const bx=left+best.x/k,by=top+best.y/k,ww=w/k,hh=h/k;
  const title=isLatest?'ÚLTIMO · M '+e.mag.toFixed(1):isSelected?'SELECCIÓN · M '+e.mag.toFixed(1):'M '+e.mag.toFixed(1);
  const sub=isLatest?eventAgeLabel(e):e.depth+' km · '+e.time.slice(0,5);
  contents+=`<g class="point magnitude-tag ${isLatest?'latest-tag':isSelected?'selected-tag':'strong-tag'}" data-id="${e.id}" role="button" tabindex="0" aria-label="Abrir ${escaped(title+' · '+e.region)}"><line class="latest-leader" x1="${x(e.lon)}" y1="${y(e.lat)}" x2="${bx+ww/2}" y2="${by+hh/2}" style="stroke-width:${1/k}"/><rect class="magnitude-label-bg" x="${bx}" y="${by}" width="${ww}" height="${hh}" rx="${9/k}" style="stroke-width:${1/k}"/><text class="magnitude-label-title" x="${bx+ww/2}" y="${by+17/k}" text-anchor="middle" style="font-size:${12/k}px">${title}</text>${isLatest||isSelected?`<text class="magnitude-label-detail" x="${bx+ww/2}" y="${by+32/k}" text-anchor="middle" style="font-size:${10/k}px">${escaped(sub)}</text>`:''}</g>`;
 }
 $('mapMarkers').innerHTML=contents;
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
}
