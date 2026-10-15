(()=>{
 'use strict';
 const get=id=>document.getElementById(id),stamp=e=>e.date+'T'+e.time;
 let reports=[],source={};
 const section=document.createElement('details');section.className='channel-reports';section.hidden=true;
 const summary=document.createElement('summary'),note=document.createElement('p'),list=document.createElement('div');
 note.textContent='Reportes del canal oficial. La ubicación numérica no fue publicada; no se dibujan puntos aproximados.';
 section.append(summary,note,list);get('eventList').before(section);
 const dialog=document.createElement('dialog');dialog.className='channel-report-dialog';dialog.id='channelReportDialog';
 dialog.setAttribute('aria-labelledby','channelReportTitle');
 dialog.innerHTML='<form method="dialog"><button class="channel-close" aria-label="Cerrar ficha">×</button></form><small>IGC–UP · CANAL OFICIAL</small><h2 id="channelReportTitle"></h2><p class="channel-location"></p><p class="channel-facts"></p><p class="channel-location-note">Coordenadas no publicadas en el canal. Este reporte se conserva sin añadir un punto al mapa.</p><a target="_blank" rel="noopener noreferrer" href="https://whatsapp.com/channel/0029VbAUotm2ZjCgDnlGAZ08">Ver canal oficial ↗</a>';
 document.body.append(dialog);dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 function open(e){
  if(!e)return;
  get('channelReportTitle').textContent='M '+e.mag.toFixed(1);
  dialog.querySelector('.channel-location').textContent=e.region;
  dialog.querySelector('.channel-facts').textContent=dateShort(e.date)+' · '+formatLocalTime(e.time)+' Panamá · '+e.depth+' km · '+e.status;
  dialog.showModal();
 }
 function filtered(){
  const today=todayPanama(),q=state.query.toLocaleLowerCase('es');
  if(state.district||state.period==='aftershocks')return [];
  return reports.filter(e=>(state.period==='today'?e.date===today:state.period==='before'?e.date!==today:state.period.startsWith('date:')?e.date===state.period.slice(5):true)&&(state.status==='all'||e.status===state.status)&&(!q||e.region.toLocaleLowerCase('es').includes(q)));
 }
 function render(){
  const rows=filtered();section.hidden=!rows.length;
  if(section.dataset.period!==state.period){section.open=state.period==='today';section.dataset.period=state.period;}
  summary.textContent='IGC–UP · '+rows.length+' sin coordenadas';
  if(rows.length)get('listCount').textContent=lastFilter.length+' en mapa';
  list.replaceChildren();
  for(const e of rows){
   const button=document.createElement('button');button.type='button';button.className='channel-report-row';
   const mag=document.createElement('b'),copy=document.createElement('span'),place=document.createElement('span'),time=document.createElement('small');
   mag.textContent=e.mag.toFixed(1);mag.style.color=rgb(e);place.textContent=e.region;
   time.textContent=dateShort(e.date)+' · '+formatLocalTime(e.time,false)+' · '+e.depth+' km';
   copy.append(place,time);button.append(mag,copy);button.onclick=()=>open(e);list.append(button);
  }
 }
 function accept(body){
  source=body.collector?.sources?.['IGC-WHATSAPP']||body.sources?.['IGC-WHATSAPP']||{};
  reports=(Array.isArray(body.channel_reports)?body.channel_reports:[]).filter(e=>e.provider==='IGC-WHATSAPP'&&e.lat===null&&e.lon===null&&[e.mag,e.depth].every(v=>typeof v==='number'&&Number.isFinite(v))&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&/^\d{2}:\d{2}:\d{2}$/.test(e.time)).map(e=>({...e,region:String(e.region||'').slice(0,240),status:String(e.status||'SIN CLASIFICAR').slice(0,40),channelReport:true,source_presence:source.status==='stale'?'retained':'observed'})).sort((a,b)=>stamp(b).localeCompare(stamp(a)));
  render();window.atlasHeader?.sync();
 }
 window.atlasChannel={accept,render,open,latest:()=>reports[0]||null,filtered};
})();
