(()=>{
 'use strict';
 const get=id=>document.getElementById(id);
 const dialog=get('diagnosticDialog');
 const repo='https://github.com/antoniorinaudo/Atlas';
 const api='https://api.github.com/repos/antoniorinaudo/Atlas/actions/workflows/actualizar-sismos.yml/runs';
 const entries=[];
 let backend=null,runs=null,apiIssue='',backendIssue='',checkedAt=null,nextCheck=0,busy=false,timer=null;
 const time=iso=>{const d=new Date(iso);return iso&&Number.isFinite(d.getTime())?formatPanamaStamp(iso,true):'Sin registro todavía'};
 const age=iso=>iso?Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/60000)):null;
 const eventName=event=>({alarm:'Servicio automático',schedule:'Programación anterior',bootstrap:'Inicialización verificada',workflow_dispatch:'Manual',push:'Cambio de código'})[event]||event||'Sin información';
 const statusName=run=>run.status!=='completed'?({queued:'En cola',in_progress:'En ejecución',waiting:'Esperando',requested:'Solicitada',pending:'Pendiente'})[run.status]||run.status:({success:'Correcta',failure:'Falló',cancelled:'Cancelada',timed_out:'Tiempo agotado',skipped:'Omitida',action_required:'Requiere atención'})[run.conclusion]||run.conclusion||'Finalizada';
 function browserLog(){get('diagnosticBrowserLog').textContent=entries.length?entries.map(e=>`${time(e.at)} · ${e.level.toUpperCase()} · ${e.message}`).join('\n'):'Todavía no hay consultas registradas en esta pestaña.'}
 window.atlasDiagnostics={
  catalog:null,
  log(level,message){entries.push({at:new Date().toISOString(),level,message:String(message).slice(0,2500)});if(entries.length>50)entries.shift();if(dialog.open)browserLog()},
  setCatalog(catalog){this.catalog=catalog;if(dialog.open)render()},
  setCollector(collector){if(collector?.collector==='cloudflare'){backend=collector;backendIssue='';if(dialog.open)render()}},
 };
 function render(){
  const catalog=window.atlasDiagnostics.catalog;
  const fetched=catalog?.fetched_at_utc||backend?.fetched_at_utc;
  get('diagnosticDataTime').textContent=time(fetched)+' (Panamá)';
  const minutes=age(fetched);
  const verified=backend?.verified_at_utc||catalog?.verified_at_utc,persist=backend?.persistence;
  get('diagnosticDataDetail').textContent=fetched?`${catalog?.event_count??backend?.event_count??'—'} registros · descarga hace ${minutes} min${verified?' · fuente verificada hace '+age(verified)+' min':''}${catalog?.snapshot?' · captura inicial':''}.${persist?' Histórico: '+persist.stored_events+' eventos y '+persist.stored_revisions+' versiones; '+persist.retained_active+' registros conservados fuera de la última respuesta.':' Leer el archivo correctamente no significa que tenga datos nuevos.'}`:'Esperando la primera lectura del archivo de datos.';
  get('diagnosticSourceStatus').textContent=backend?.status==='success'?(backend.http_status===304?'Fuente sin cambios · HTTP 304':'Descarga oficial correcta'):backend?.status==='failure'?'Falló la descarga oficial':'Registro no disponible';
  get('diagnosticSourceDetail').textContent=backend?.checked_at_utc?`${time(backend.checked_at_utc)} (Panamá) · Inicio: ${eventName(backend.event)}. Próxima consulta del servicio: ${time(backend.next_check_at_utc)} (Panamá).${backendIssue?' La consulta actual del registro falló; se muestra la copia leída anteriormente.':''}`:backendIssue||'El registro estará disponible tras el próximo despliegue.';
  let health=get('diagnosticSourceHealth');if(!health){health=document.createElement('ul');health.id='diagnosticSourceHealth';health.className='source-health-list';get('diagnosticSourceDetail').after(health);}health.replaceChildren();
  for(const [provider,s]of Object.entries(backend?.sources||{})){const row=document.createElement('li'),name=document.createElement('b'),detail=document.createElement('span');row.dataset.state=s.status;name.textContent=provider+' · '+(s.status==='success'?'Disponible':s.status==='stale'?'Lector local sin actualizar':'En reintento');detail.textContent=' · Verificado: '+time(s.verified_at_utc)+' (Panamá)'+(s.stream?' · WebSocket '+(s.stream==='connected'?'conectado':'reconectando'):'')+' · Próxima consulta: '+time(s.next_check_at_utc);row.append(name,detail);health.append(row);}
  if(backend?.sources)get('diagnosticDataDetail').textContent=`${backend.event_count} sismos en la vista · archivo IGC–UP: ${persist?.stored_events??'—'} eventos · reportes externos archivados: ${persist?.observations??'—'} · ${persist?.compared_events??0} sismos con comparación.${persist?.channel_reports?' Canal WhatsApp: '+persist.channel_reports+' reportes · '+persist.channel_unlocated+' sin asociación geográfica inequívoca; conservados fuera del mapa.':''} Cada fuente conserva sus propias fechas de verificación.`;
  if(backend?.sources)get('diagnosticSourceStatus').textContent=backend.status==='failure'?'Ninguna fuente pudo verificarse':backend.partial_failure?'Actualizando con fuentes alternativas':'Fuentes disponibles';
  get('diagnosticSourceLog').textContent=Array.isArray(backend?.logs)?backend.logs.map(String).join('\n')+(backend.push?'\nPush: '+backend.push.queued+' en cola · '+backend.push.accepted+' aceptados por el proveedor · '+backend.push.failed+' fallidos · '+backend.push.expired+' suscripciones caducadas · '+backend.push.pending+' pendientes.':''):backendIssue||'Sin registro publicado.';
  if(backend?.recent_checks?.length)get('diagnosticSourceLog').textContent+='\n\nConsultas conservadas:\n'+backend.recent_checks.map(d=>`${time(d.checked_at_utc)} · ${d.status==='success'?'Correcta':'Falló'} · HTTP ${d.http_status??'—'} · ${d.event_count} registros`).join('\n');
  const note=get('diagnosticSummary');
  const automatic=runs?.find(r=>r.event==='schedule');
  if(backend?.collector==='cloudflare'){
   if(backend.sources){const failed=Object.entries(backend.sources).filter(([,s])=>s.status==='failure').map(([p])=>p);note.textContent=failed.length?`${failed.join(', ')} en reintento. ${backend.status==='success'?'Las otras fuentes siguen actualizándose.':'Se conserva el catálogo guardado.'} Los registros de cada organismo mantienen su procedencia; las coincidencias entre catálogos son aproximadas.`:'IGC–UP, USGS y EMSC disponibles. Se guardan novedades y revisiones; los cambios llegan sin recargar. Los catálogos pueden compartir agencias y no equivalen a confirmaciones independientes.';note.dataset.tone=failed.length?'warning':'normal';}
   else if(backend.status==='failure'){note.textContent='Falló la última consulta de Cloudflare al IGC–UP. Se conserva la última copia válida y su fecha real. Revisa el registro de descarga.';note.dataset.tone='warning'}
   else if(backend.event==='bootstrap'){note.textContent='Cloudflare tiene una copia inicial verificada. Está preparando la primera consulta del servicio.';note.dataset.tone='warning'}
   else if(age(backend.checked_at_utc)>30||age(verified||fetched)>30){note.textContent='La recolección de Cloudflare está atrasada. Se conserva el histórico y su fecha real.';note.dataset.tone='warning'}
   else{note.textContent=backend.http_status===304?'La fuente confirmó que no hay cambios: no se descargó HTML ni se reescribieron eventos. El histórico permanece guardado.':'La fuente se consultó correctamente. Solo se guardan eventos nuevos y revisiones; los registros ausentes se conservan en el histórico. Los cambios llegan sin recargar y mantienen filtros y zoom.';note.dataset.tone='normal'}
   if(backendIssue){note.textContent+=' No se pudo consultar el diagnóstico actual; se muestra el último registro leído.';note.dataset.tone='warning'}
  }
  else if(!runs){note.textContent=apiIssue||'Consultando el historial de GitHub…';note.dataset.tone=apiIssue?'warning':'normal'}
  else if(!automatic){note.textContent=`No aparecen ejecuciones automáticas en ${runs.length===1?'la última ejecución consultada':'las últimas '+runs.length+' ejecuciones consultadas'}. Las manuales y los cambios de código sí pueden actualizar el sitio. Esto no demuestra un bloqueo de la fuente.`;note.dataset.tone='warning'}
  else if(automatic.status!=='completed'){note.textContent=`La última ejecución automática está ${statusName(automatic).toLowerCase()}. Puedes abrirla para revisar sus pasos.`;note.dataset.tone='normal'}
  else if(automatic.conclusion!=='success'){note.textContent='La última ejecución automática no terminó correctamente. Abre sus registros en GitHub para identificar el paso que falló.';note.dataset.tone='warning'}
  else if(age(automatic.created_at)>30){note.textContent=`La última ejecución automática comenzó hace ${age(automatic.created_at)} minutos. Aunque haya datos recientes por una actualización manual, el inicio programado puede estar atrasado.`;note.dataset.tone='warning'}
  else if(minutes>30||catalog?.snapshot){note.textContent='Hay una ejecución automática correcta en el historial, pero la copia que muestra esta pestaña está atrasada. Compara las horas de descarga y publicación.';note.dataset.tone='warning'}
  else{note.textContent='Hay una ejecución automática correcta en el historial y la copia de datos tiene menos de 30 minutos.';note.dataset.tone='normal'}
  if(apiIssue&&runs){note.textContent+=' La consulta más reciente a GitHub falló; el historial mostrado es de la consulta anterior.';note.dataset.tone='warning'}
  get('diagnosticApiDetail').textContent=apiIssue|| (checkedAt?`Historial consultado el ${time(checkedAt)} (Panamá). Esta consulta no ejecuta el workflow.`:'Consulta pública de GitHub, sin claves.');
  get('diagnosticApiDetail').classList.toggle('diagnostic-error',!!apiIssue);
  const list=get('diagnosticRuns');list.replaceChildren();
  if(runs){for(const run of runs){
   const row=document.createElement('div');row.className='diagnostic-run';
   const link=document.createElement('a');link.textContent=`#${run.run_number||run.id} · ${eventName(run.event)}`;link.href=`${repo}/actions/runs/${run.id}`;link.target='_blank';link.rel='noopener noreferrer';
   const status=document.createElement('span');status.className='diagnostic-status';status.dataset.status=run.conclusion||run.status;status.textContent=statusName(run);
   const title=document.createElement('small');title.textContent=(run.display_title||run.name||'Actualizar atlas').slice(0,240);
   const meta=document.createElement('small');meta.textContent=`Inicio: ${time(run.created_at)} · Finalización: ${run.status==='completed'?time(run.updated_at):'pendiente'} · Panamá`;
   row.append(link,status,title,meta);list.append(row);
  }}
  browserLog();updateButton();
 }
 function updateButton(){const seconds=Math.ceil((nextCheck-Date.now())/1000);const button=get('diagnosticCheck');button.disabled=busy||seconds>0;button.textContent=busy?'Consultando…':seconds>0?`Consultar en ${seconds}s`:'Consultar de nuevo'}
 async function readBackend(){
  try{const response=await fetchWithTimeout(window.ATLAS_CONFIG?.diagnosticUrl||'./diagnostico.json?t='+Date.now(),new AbortController());const body=await response.json();if(!['success','failure','pending'].includes(body.status))throw Error('Formato de registro no reconocido');backend=body;backendIssue=''}
  catch(error){backendIssue='No se pudo leer el registro publicado: '+error.message;window.atlasDiagnostics.log('error',backendIssue)}
 }
 async function readActions(){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch(api+'?branch=main&per_page=20&_t='+Date.now(),{cache:'no-store',headers:{Accept:'application/vnd.github+json'},signal:controller.signal});
   const remaining=response.headers.get('x-ratelimit-remaining');
   const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
   if(!response.ok){
    if((response.status===403&&remaining==='0')||response.status===429){if(reset>Date.now())nextCheck=Math.max(nextCheck,reset);throw Error(`HTTP ${response.status}: límite de consultas a la API de GitHub${reset>Date.now()?'; disponible desde '+time(reset)+' (Panamá)':''}. Este límite del panel no confirma un bloqueo del colector.`)}
    throw Error('HTTP '+response.status+' al consultar las ejecuciones');
   }
   const body=await response.json();if(!Array.isArray(body.workflow_runs))throw Error('Historial no reconocido');
   runs=body.workflow_runs.filter(r=>Number.isSafeInteger(r.id)).slice(0,20);checkedAt=new Date().toISOString();apiIssue='';
   window.atlasDiagnostics.log('ok',`API GitHub: HTTP ${response.status} · ${runs.length} ejecuciones${remaining!==null?' · consultas restantes: '+remaining:''}`);
  }catch(error){apiIssue='No se pudo consultar GitHub: '+(error.name==='AbortError'?'tiempo agotado':error.message);window.atlasDiagnostics.log('error',apiIssue)}
  finally{clearTimeout(timeout)}
 }
 async function check(){if(busy||Date.now()<nextCheck)return;busy=true;nextCheck=Date.now()+60000;render();await Promise.allSettled([readBackend(),readActions()]);busy=false;render()}
 get('diagnosticOpen').onclick=()=>{closeEventPopup();dialog.showModal();render();timer=setInterval(updateButton,1000);check()};
 get('diagnosticClose').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{clearInterval(timer);timer=null;get('diagnosticOpen').focus({preventScroll:true})});
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
 get('diagnosticCheck').onclick=check;
 get('diagnosticDownload').onclick=()=>download('diagnostico-atlas.json',JSON.stringify({generated_at_utc:new Date().toISOString(),catalog:window.atlasDiagnostics.catalog,collector:backend,actions_checked_at_utc:checkedAt,actions_error:apiIssue||null,runs,browser_logs:entries},null,2),'application/json');
 window.atlasDiagnostics.log('info','Pestaña abierta. Los registros del navegador empiezan en esta sesión.');
})();
