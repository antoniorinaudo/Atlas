(()=>{
 'use strict';
 const origins=new Set(['https://sismosgeociencias.up.ac.pa','https://earthquake.usgs.gov','https://www.emsc.eu','https://whatsapp.com']);
 const names={'IGC-UP':'IGC–UP','IGC-WHATSAPP':'IGC–UP · WhatsApp',USGS:'USGS',EMSC:'EMSC'};
 const safeURL=value=>{try{const u=new URL(value);return origins.has(u.origin)?u.href:null;}catch{return null;}};
 function normalize(item,e){
  if(names[item.provider])e.provider=item.provider;
  e.mag_type=String(item.mag_type||'').slice(0,12);
  const url=safeURL(item.sourceUrl);if(url)e.sourceUrl=url;
  if(Array.isArray(item.observations))e.observations=item.observations.slice(0,4).filter(o=>names[o?.provider]&&[o.mag,o.depth].every(v=>typeof v==='number'&&Number.isFinite(v))&&[o.lat,o.lon].every(v=>v===null||typeof v==='number'&&Number.isFinite(v))).map(o=>({provider:o.provider,mag:o.mag,mag_type:String(o.mag_type||'').slice(0,12),lat:o.lat,lon:o.lon,depth:o.depth,date:String(o.date||'').slice(0,10),time:String(o.time||'').slice(0,8),status:String(o.status||'').slice(0,40),agency:String(o.agency||'').slice(0,40),source_health:o.source_health,source_presence:o.source_presence,source_updated_at_utc:o.source_updated_at_utc,verified_at_utc:o.verified_at_utc,sourceUrl:safeURL(o.sourceUrl)}));
 }
 const stamp=iso=>{try{return iso?formatPanamaStamp(iso,true):'Sin hora de revisión publicada';}catch{return 'Sin hora de revisión publicada';}};
 function render(e){
  const panel=document.getElementById('mapPopup');let details=document.getElementById('sourceComparison');
  if(!details){details=document.createElement('details');details.id='sourceComparison';details.className='source-comparison';panel.querySelector('.popup-actions').before(details);details.addEventListener('toggle',()=>requestAnimationFrame(()=>{positionEventPopup();if(details.open&&!matchMedia('(max-width:630px)').matches)panel.scrollIntoView({block:'nearest',behavior:'instant'});}));}
  const obs=e.observations||[];details.hidden=!obs.length;
  if(details.dataset.uid!==e.uid)details.open=false;details.dataset.uid=e.uid||'';
  details.replaceChildren();
  const summary=document.createElement('summary');summary.textContent=obs.length>1?'Comparar fuentes · '+obs.length:'Fuente y verificación';details.append(summary);
  const list=document.createElement('div');list.className='source-comparison-list';
  for(const o of obs){
   const row=document.createElement('div'),head=document.createElement('div'),link=document.createElement('a'),mag=document.createElement('b'),facts=document.createElement('p'),meta=document.createElement('small');row.className='source-observation';
   link.textContent=names[o.provider]+' ↗';link.href=o.sourceUrl||'#';link.target='_blank';link.rel='noopener noreferrer';
   mag.textContent='M '+o.mag.toFixed(1)+(o.mag_type?' '+o.mag_type:' · tipo no informado');head.append(link,mag);
   const coords=typeof o.lat==='number'&&typeof o.lon==='number'?o.lat.toFixed(4)+'°, '+o.lon.toFixed(4)+'°':'Coordenadas no publicadas en el canal';
   facts.textContent=`${dateShort(o.date)} · ${formatLocalTime(o.time)} · ${o.depth.toLocaleString('es-PA',{maximumFractionDigits:1})} km · ${coords}`;
   meta.textContent=(o.agency?'Agencia: '+o.agency+' · ':'')+(o.source_updated_at_utc?'Revisión: '+stamp(o.source_updated_at_utc):o.status==='SIN CLASIFICAR'?'Estado de revisión no informado':o.status)+(o.source_health==='failure'?' · Fuente en reintento; reporte conservado':'')+(o.source_presence==='retained'?' · Ausente en la última respuesta':'')+(o.verified_at_utc?' · Consulta: '+stamp(o.verified_at_utc):'');
   row.append(head,facts,meta);list.append(row);
  }
  const note=document.createElement('p');note.className='source-comparison-note';note.textContent=obs.length>1?'Asociación aproximada según los parámetros publicados. Cada organismo conserva su medición; no se promedian magnitudes ni se asume independencia.':'Se muestra el organismo que publicó este reporte.';
  list.append(note);details.append(list);
  const preferred=obs[0];panel.querySelector('.popup-location-caption').textContent='Reporte de '+(names[e.provider]||'IGC–UP')+(preferred?.source_health==='failure'?' · fuente en reintento; registro conservado':e.source_presence==='retained'?' · registro conservado':'');
 }
 window.atlasSources={normalize,render,safeURL,name:e=>names[e?.provider]||'IGC–UP'};
})();
