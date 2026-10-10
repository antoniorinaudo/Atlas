(()=>{
 'use strict';
 const get=id=>document.getElementById(id),dialog=get('pushDialog'),base=new URL('/push/',window.ATLAS_CONFIG.dataUrl),storageKey='atlas-push-v1';
 let registration=null,subscription=null,record=null,publicKey=null,busy=false,installPrompt=null;
 let eventToOpen=new URL(location.href).searchParams.get('event');
 try{record=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
 if(record?.minMagnitude!==undefined)get('pushMagnitude').value=String(record.minMagnitude);
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
 const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
 const supported='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window&&isSecureContext;
 const status=message=>get('pushStatus').textContent=message;
 const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(record));}catch{}};
 const soundKey='atlas-sound-v1',AudioEngine=window.AudioContext||window.webkitAudioContext;
 let soundEnabled=false,audio=null;
 try{soundEnabled=localStorage.getItem(soundKey)==='1';}catch{}
 const soundToggle=get('soundEnabled'),soundTest=get('soundTest'),soundStatus=get('soundStatus');
 soundToggle.checked=soundEnabled;soundToggle.disabled=!AudioEngine;soundTest.disabled=!soundEnabled||!AudioEngine;
 soundStatus.textContent=!AudioEngine?'Este navegador no permite sonido dentro de la app.':soundEnabled?'Sonido guardado. Toca «Probar sonido» para comprobarlo en esta sesión.':'Sonido dentro de la app desactivado.';
 async function armSound(){
  if(!soundEnabled||!AudioEngine)return false;
  try{audio ||= new AudioEngine();if(audio.state==='suspended')await audio.resume();return audio.state==='running';}
  catch{soundStatus.textContent='No se pudo iniciar el sonido. Toca «Probar sonido» para reintentar.';return false;}
 }
 function playTone(){
  if(!soundEnabled||audio?.state!=='running')return false;
  try{
   const now=audio.currentTime;
   [660,880,660].forEach((frequency,index)=>{
    const oscillator=audio.createOscillator(),gain=audio.createGain(),start=now+index*.24;
    oscillator.type='sine';oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+.015);gain.gain.exponentialRampToValueAtTime(.001,start+.18);
    oscillator.connect(gain);gain.connect(audio.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(start);oscillator.stop(start+.2);
   });return true;
  }catch{soundStatus.textContent='No se pudo reproducir el tono. Puedes volver a probar.';return false;}
 }
 soundToggle.onchange=async()=>{
  soundEnabled=soundToggle.checked;try{localStorage.setItem(soundKey,soundEnabled?'1':'0');}catch{}
  soundTest.disabled=!soundEnabled||!AudioEngine;
  if(!soundEnabled){soundStatus.textContent='Sonido dentro de la app desactivado.';return;}
  if(await armSound())soundStatus.textContent='Sonido activado para nuevos registros desde la magnitud elegida, mientras la app esté visible.';
 };
 soundTest.onclick=async()=>{if(await armSound()&&playTone())soundStatus.textContent='Tono de prueba reproducido. El volumen depende de tu dispositivo.';};
 // A saved preference still needs a user gesture to unlock browser audio.
 document.addEventListener('pointerdown',()=>{if(soundEnabled)void armSound();},{passive:true});
 document.addEventListener('keydown',()=>{if(soundEnabled)void armSound();});
 function controls(){
  const active=!!subscription&&!!record?.token&&Notification.permission==='granted';
  get('pushEnable').hidden=active;get('pushDisable').hidden=!active;get('pushTest').hidden=!active;
  get('pushEnable').disabled=busy||!supported||!registration||ios&&!standalone||Notification.permission==='denied';
  get('pushDisable').disabled=busy;get('pushTest').disabled=busy;get('pushMagnitude').disabled=busy;
  get('pushSummary').textContent=active?`Avisos ${Number(record.minMagnitude)?'M ≥ '+Number(record.minMagnitude).toFixed(1):'de todas las magnitudes'} activados`:'Elige desde qué magnitud recibir avisos';
 }
 async function api(path,body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error||'HTTP '+response.status);return result;}
  finally{clearTimeout(timer);}
 }
 function keyBytes(key){const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
 async function persist(){
  const result=await api('subscribe',{subscription:subscription.toJSON(),minMagnitude:Number(get('pushMagnitude').value),token:record?.token});
  record={id:result.id,token:result.token,minMagnitude:result.minMagnitude};save();
 }
 function availability(){
  if(!supported)status('Este navegador no ofrece notificaciones push. Puedes seguir consultando el mapa.');
  else if(ios&&!standalone)status('En iPhone: Compartir → Añadir a pantalla de inicio. Abre el Atlas desde ese icono para activar los avisos.');
  else if(Notification.permission==='denied')status('El navegador bloqueó los avisos. Permítelos en los ajustes de este sitio para activarlos.');
  else if(subscription&&record?.token)status(`Avisos activos ${Number(record.minMagnitude)?'desde M '+Number(record.minMagnitude).toFixed(1):'para todas las magnitudes'}. Puedes cambiar la magnitud o desactivarlos.`);
  else status(registration?'Elige la magnitud y pulsa «Activar avisos». El navegador te pedirá permiso.':'Preparando la app…');
  controls();
 }
 get('pushOpen').onclick=()=>{closeEventPopup();dialog.showModal();availability();};
 get('pushClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>get('pushOpen').focus({preventScroll:true}));
 get('pushEnable').onclick=async()=>{
  if(busy||!supported||!registration)return;
  // Request permission directly in the click handler, before network awaits.
  const permission=Notification.permission==='default'?Notification.requestPermission():Promise.resolve(Notification.permission);
  busy=true;controls();status('Activando avisos en este dispositivo…');
  try{
   if(await permission!=='granted'){availability();return;}
   publicKey=(await api('public-key')).publicKey;if(!publicKey)throw Error('El servicio push todavía no está configurado.');
   subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
   await persist();availability();
  }catch(error){status('No se pudieron activar: '+error.message+'. Puedes reintentar.');}
  finally{busy=false;controls();}
 };
 get('pushMagnitude').onchange=async()=>{
  const value=Number(get('pushMagnitude').value);
  if(!subscription||!record?.token){record={...record,minMagnitude:value};save();return;}
  busy=true;controls();status('Guardando la magnitud…');
  try{await persist();availability();}catch(error){get('pushMagnitude').value=String(record.minMagnitude);status('No se guardó el cambio: '+error.message);}
  finally{busy=false;controls();}
 };
 get('pushDisable').onclick=async()=>{
  busy=true;controls();let serverDeleted=false;
  try{await api('unsubscribe',{id:record.id,token:record.token});serverDeleted=true;}catch{}
  try{await subscription?.unsubscribe();subscription=null;record={minMagnitude:Number(get('pushMagnitude').value),...(!serverDeleted?{id:record.id,token:record.token,pendingDelete:true}:{})};save();status(serverDeleted?'Avisos desactivados y suscripción eliminada.':'Avisos desactivados en el navegador; la eliminación del servidor se reintentará al abrir la app.');}
  catch(error){status('No se pudo desactivar: '+error.message);}
  finally{busy=false;controls();}
 };
 get('pushTest').onclick=async()=>{
  busy=true;controls();status('Enviando una prueba solo a este dispositivo…');
  try{await api('test',{id:record.id,token:record.token});status('El servicio aceptó la prueba. Revisa las notificaciones del dispositivo; la entrega depende del navegador y del sistema.');}
  catch(error){status('Prueba no enviada: '+error.message);}
  finally{busy=false;controls();}
 };
 window.atlasPush={handleDeepLink(){
  if(!eventToOpen)return;const e=EVENTS.find(e=>eventIdentity(e)===eventToOpen);if(!e)return;
  eventToOpen=null;focusCatalogEvent(e);
 },catalogSound(additions){
  if(document.hidden||!soundEnabled)return;
  const minimum=Number(get('pushMagnitude').value);
  if(additions.some(event=>event.mag>=minimum)&&playTone())soundStatus.textContent='Sonó un aviso de nuevo registro del IGC–UP.';
 }};
 navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='atlas-open-event'){eventToOpen=event.data.event;window.atlasPush.handleDeepLink();if(eventToOpen)refreshAutomatically().then(()=>window.atlasPush.handleDeepLink());}});
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
 window.addEventListener('appinstalled',()=>{get('installApp').hidden=true;});
 get('installApp').hidden=!!standalone;
 get('installApp').onclick=async()=>{
  if(installPrompt){await installPrompt.prompt();installPrompt=null;return;}
  get('installHelp').textContent=ios?'En Safari, pulsa Compartir y «Añadir a pantalla de inicio». Después abre Atlas Sísmico Panamá desde su icono.':'Abre el menú del navegador y elige «Instalar app» o «Añadir a pantalla de inicio». Si no aparece, vuelve a abrir la página con conexión.';
  get('installDialog').showModal();
 };
 get('installClose').onclick=()=>get('installDialog').close();
 if('serviceWorker'in navigator&&isSecureContext){
  navigator.serviceWorker.register('./sw.js?v=20261010-visible-latest10',{scope:'./',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(async reg=>{
   registration=reg;if(supported)subscription=await reg.pushManager.getSubscription();
   if(record?.pendingDelete){try{await api('unsubscribe',{id:record.id,token:record.token});record={minMagnitude:record.minMagnitude};save();}catch{}}
   availability();window.atlasPush.handleDeepLink();
  }).catch(error=>{status('La instalación no se pudo preparar: '+error.message);controls();});
 }else availability();
 controls();
})();
