(()=>{
 'use strict';
 const header=document.querySelector('.shell>header'),button=document.getElementById('headerLatest');
 function sync(){
  const event=latestCatalogEvent();button.disabled=!event;
  document.getElementById('headerLatestMag').textContent=event?'M '+event.mag.toFixed(1):'M —';
  document.getElementById('headerLatestRegion').textContent=event?event.region:'Sin registros disponibles';
  document.getElementById('headerLatestTime').textContent=event?formatLocalTime(event.time,false):'';
  const stale=lastSuccessAt&&Date.now()-Date.parse(lastSuccessAt)>30*60000;
  const unverified=latestIsSnapshot||stale||document.getElementById('syncLed').classList.contains('bad');
  button.querySelector('small').textContent='ÚLTIMO SISMO · IGC–UP'+(unverified?' · DATOS SIN VERIFICAR':'');
  button.classList.toggle('source-unverified',!!unverified);
  if(event)button.style.setProperty('--latest-accent',rgb(event));
  const label=event?`Último sismo: M ${event.mag.toFixed(1)} · ${event.region} · ${dateShort(event.date)} · ${formatLocalTime(event.time)} Panamá · ${event.status}${unverified?' · Datos sin verificar':''}. Ver ficha.`:'Sin registros disponibles';
  button.setAttribute('aria-label',label);button.title=label;
 }
 button.onclick=()=>focusCatalogEvent(latestCatalogEvent());
 window.atlasHeader={sync};
 const resize=new ResizeObserver(()=>{
  document.documentElement.style.setProperty('--atlas-header-height',Math.ceil(header.getBoundingClientRect().height)+'px');
  const border=button.querySelector('.header-snake rect');
  border.setAttribute('width',Math.max(0,button.clientWidth-2));border.setAttribute('height',Math.max(0,button.clientHeight-2));
 });resize.observe(header);resize.observe(button);
 sync();
})();
