(()=>{
 'use strict';
 const header=document.querySelector('.shell>header'),alert=document.querySelector('.latest-alert'),button=document.getElementById('headerLatest');
 let observer,height=0;
 function sync(){
  const event=latestCatalogEvent();button.disabled=!event;
  if(!event){button.hidden=true;header.classList.remove('latest-in-header');return;}
  document.getElementById('headerLatestMag').textContent='M '+event.mag.toFixed(1);
  document.getElementById('headerLatestRegion').textContent=event.region;
  document.getElementById('headerLatestTime').textContent=formatLocalTime(event.time,false);
  button.style.setProperty('--latest-accent',rgb(event));
  const label=`Último sismo: M ${event.mag.toFixed(1)} · ${event.region} · ${dateShort(event.date)} · ${formatLocalTime(event.time)} Panamá · ${event.status}${latestIsSnapshot?' · Captura histórica':''}. Ver ficha.`;
  button.setAttribute('aria-label',label);button.title=label;
 }
 function visibility(){
  const past=alert.getBoundingClientRect().bottom<=height&&!!latestCatalogEvent();
  button.hidden=!past;header.classList.toggle('latest-in-header',past);
 }
 function measure(){
  const next=Math.ceil(header.getBoundingClientRect().height);if(next===height)return;
  height=next;document.documentElement.style.setProperty('--atlas-header-height',height+'px');
  observer?.disconnect();observer=new IntersectionObserver(visibility,{rootMargin:`-${height}px 0px 0px 0px`,threshold:0});observer.observe(alert);visibility();
 }
 button.onclick=()=>focusCatalogEvent(latestCatalogEvent());
 new MutationObserver(()=>{sync();visibility();}).observe(alert,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
 new ResizeObserver(measure).observe(header);sync();measure();
})();
