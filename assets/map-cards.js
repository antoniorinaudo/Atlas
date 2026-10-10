function placeMapCard(panel,event,avoid=[]){
 const wrap=document.querySelector('.view-wrap').getBoundingClientRect(),map=$('geoMap'),bounds=map.getBoundingClientRect();
 const point=map.createSVGPoint();point.x=x(event.lon);point.y=y(event.lat);
 const matrix=map.getScreenCTM(),p=matrix?point.matrixTransform(matrix):{x:-Infinity,y:-Infinity};
 const shown=state.mode==='2d'&&lastFilter.some(e=>e.id===event.id)&&p.x>=bounds.left&&p.x<=bounds.right&&p.y>=bounds.top&&p.y<=bounds.bottom;
 const width=panel.offsetWidth,height=panel.offsetHeight,gap=14,radius=markerRadiusPx(event.mag);
 const reserved=[...document.querySelectorAll('.map-info,.map-ctrl,.map-legend'),...avoid].filter(el=>!el.hidden&&el.offsetParent).map(el=>{const r=el.getBoundingClientRect();return{x:r.left-wrap.left,y:r.top-wrap.top,w:r.width,h:r.height};});
 const ax=p.x-wrap.left,ay=p.y-wrap.top;
 const info=reserved[0];
 const candidates=shown?[[ax+radius+gap,ay-height/2],[ax-width-radius-gap,ay-height/2],[ax-width/2,ay-height-radius-gap],[ax-width/2,ay+radius+gap]]:[[12,(info?info.y+info.h:0)+12],[12,12],[wrap.width-width-12,wrap.height-height-12]];
 for(const card of avoid.filter(el=>!el.hidden)){
  const r=card.getBoundingClientRect(),left=r.left-wrap.left,top=r.top-wrap.top;
  candidates.push([ax-width/2,top-height-gap],[ax-width/2,top+r.height+gap],[left-width-gap,ay-height/2],[left+r.width+gap,ay-height/2]);
 }
 let best=null;
 for(const [left,top] of candidates){
  const box={x:Math.max(12,Math.min(wrap.width-width-12,left)),y:Math.max(12,Math.min(wrap.height-height-12,top)),w:width,h:height};
  const overlap=reserved.reduce((sum,r)=>sum+Math.max(0,Math.min(box.x+box.w,r.x+r.w)-Math.max(box.x,r.x))*Math.max(0,Math.min(box.y+box.h,r.y+r.h)-Math.max(box.y,r.y)),0);
  const score=overlap*100+Math.hypot(box.x-left,box.y-top)+(shown?Math.hypot(box.x+box.w/2-ax,box.y+box.h/2-ay)*.1:0);
  if(!best||score<best.score)best={...box,score};
 }
 if(best){panel.style.left=Math.round(best.x)+'px';panel.style.top=Math.round(best.y)+'px';}
 panel.dataset.anchored=String(shown);
 return shown;
}
function renderLatestMapCard(){
 const panel=$('mapLatestHover'),event=latestCatalogEvent();
 if(!event){panel.hidden=true;return;}
 panel.hidden=false;panel.dataset.eventId=String(event.id);
 $('latestHoverMag').textContent='ÚLTIMO · M '+event.mag.toFixed(1);
 $('latestHoverRegion').textContent=event.region;
 $('latestHoverFacts').textContent=`${dateShort(event.date)} · ${formatLocalTime(event.time)} (Panamá) · ${event.depth} km · ${event.status}`;
 panel.hidden=!placeMapCard(panel,event);
}
window.addEventListener('resize',()=>requestAnimationFrame(renderLatestMapCard));
