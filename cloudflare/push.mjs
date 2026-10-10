import {buildPushPayload} from '@block65/webcrypto-web-push';
const ORIGIN='https://antoniorinaudo.github.io';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
export const eventKey=e=>[e.date,e.time,e.lat,e.lon].join('|');
const pushClock12=time=>{const[hour,minute]=time.split(':');return `${Number(hour)%12||12}:${minute} ${Number(hour)>=12?'PM':'AM'}`;};
export function initPush(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, subscription TEXT NOT NULL, token TEXT NOT NULL, min_mag REAL NOT NULL, created_at INTEGER NOT NULL, last_test INTEGER NOT NULL DEFAULT 0)');
 sql.exec('CREATE TABLE IF NOT EXISTS push_outbox (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, expires INTEGER NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS push_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
}
export async function validateSubscription(input){
 const endpoint=new URL(input?.endpoint);
 const host=endpoint.hostname;
 const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.notify.windows.com')||host.endsWith('.push.apple.com');
 if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||endpoint.hash||!allowed||input.endpoint.length>4096)throw Error('Servicio push no permitido');
 const decode=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(value))throw Error('Clave de suscripción inválida');return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));};
 const point=decode(input.keys?.p256dh),auth=decode(input.keys?.auth);if(point.length!==65||auth.length!==16)throw Error('Claves de suscripción inválidas');
 await crypto.subtle.importKey('raw',point,{name:'ECDH',namedCurve:'P-256'},false,[]);
 return {endpoint:endpoint.href,expirationTime:null,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
}
const headers=origin=>({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':origin||ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','X-Content-Type-Options':'nosniff'});
const response=(body,status=200,origin)=>new Response(JSON.stringify(body),{status,headers:headers(origin)});
const ready=env=>env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY;
export async function sendPush(subscription,payload,env,fetcher=fetch){
 if(!ready(env))throw Error('Servicio push no configurado');
 const request=await buildPushPayload({data:JSON.stringify(payload),options:{ttl:1800,urgency:'normal'}},subscription,{subject:env.VAPID_SUBJECT||ORIGIN+'/Atlas/',publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 // Workers supports manual/follow only. Refuse redirects without forwarding VAPID credentials.
 try{const result=await fetcher(subscription.endpoint,{...request,redirect:'manual',signal:controller.signal});await result.body?.cancel();return result.status;}
 finally{clearTimeout(timer);}
}
export async function pushAPI(request,sql,env,fetcher=fetch){
 const path=new URL(request.url).pathname,origin=request.headers.get('Origin'),allowedOrigin=env.PUSH_ORIGIN||ORIGIN;
 if(path==='/push/public-key'&&request.method==='GET')return response({publicKey:env.VAPID_PUBLIC_KEY||null,configured:!!ready(env)},200,'*');
 if(origin!==allowedOrigin)return response({error:'Origen no permitido'},403,allowedOrigin);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(allowedOrigin)});
 if(request.method!=='POST')return response({error:'Método no permitido'},405,allowedOrigin);
 if(!ready(env))return response({error:'Servicio push no configurado'},503,allowedOrigin);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return response({error:'Se requiere JSON'},415,allowedOrigin);
 if(Number(request.headers.get('Content-Length'))>6000)return response({error:'Solicitud demasiado grande'},413,allowedOrigin);
 const reader=request.body?.getReader(),chunks=[];let size=0;
 if(reader)for(;;){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6000){await reader.cancel();return response({error:'Solicitud demasiado grande'},413,allowedOrigin);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return response({error:'JSON inválido'},400,allowedOrigin);}
 try{
  if(path==='/push/subscribe'){
   const subscription=await validateSubscription(body.subscription),minMagnitude=Number(body.minMagnitude);
   if(!Number.isFinite(minMagnitude)||minMagnitude<0||minMagnitude>9)throw Error('Magnitud inválida');
   const id=await hash(subscription.endpoint),old=sql.exec('SELECT * FROM push_subscriptions WHERE id=?',id).toArray()[0];
   if(old&&body.token!==old.token&&JSON.stringify(JSON.parse(old.subscription).keys)!==JSON.stringify(subscription.keys))return response({error:'La suscripción pertenece a otro dispositivo'},403,allowedOrigin);
   if(!old){
    sql.exec('DELETE FROM push_limits WHERE expires<?',Date.now());
    const key=await hash((request.headers.get('CF-Connecting-IP')||'unknown')+env.VAPID_PRIVATE_KEY),limit=sql.exec('SELECT * FROM push_limits WHERE id=?',key).toArray()[0];
    if((limit?.count||0)>=10)return response({error:'Demasiadas altas; reintenta más tarde'},429,allowedOrigin);
    if(sql.exec('SELECT COUNT(*) AS total FROM push_subscriptions').toArray()[0].total>=500)return response({error:'Suscripciones ocupadas; reintenta más tarde'},503,allowedOrigin);
    sql.exec('INSERT INTO push_limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',key,Date.now()+3600000);
   }
   const token=old&&body.token===old.token?old.token:crypto.randomUUID();
   sql.exec('INSERT INTO push_subscriptions(id,subscription,token,min_mag,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,token=excluded.token,min_mag=excluded.min_mag',id,JSON.stringify(subscription),token,minMagnitude,Date.now());
   return response({id,token,minMagnitude},200,allowedOrigin);
  }
  const sub=typeof body.id==='string'?sql.exec('SELECT * FROM push_subscriptions WHERE id=?',body.id).toArray()[0]:null;
  if(!sub){if(path==='/push/unsubscribe')return response({ok:true},200,allowedOrigin);return response({error:'Suscripción no encontrada'},404,allowedOrigin);}
  if(body.token!==sub.token)return response({error:'Credencial del dispositivo inválida'},403,allowedOrigin);
  if(path==='/push/unsubscribe'){sql.exec('DELETE FROM push_subscriptions WHERE id=?',sub.id);sql.exec('DELETE FROM push_outbox WHERE recipient=?',sub.id);return response({ok:true},200,allowedOrigin);}
  if(path==='/push/test'){
   if(Date.now()-sub.last_test<60000)return response({error:'Espera un minuto entre pruebas'},429,allowedOrigin);
   sql.exec('UPDATE push_subscriptions SET last_test=? WHERE id=?',Date.now(),sub.id);
   const status=await sendPush(JSON.parse(sub.subscription),{title:'Prueba · Atlas Sísmico Panamá',body:'Los avisos de nuevos registros IGC–UP están preparados para este dispositivo. Esto es una prueba.',tag:'atlas-prueba'},env,fetcher);
   if(status===404||status===410){sql.exec('DELETE FROM push_subscriptions WHERE id=?',sub.id);return response({error:'La suscripción caducó. Desactiva y vuelve a activar los avisos.'},410,allowedOrigin);}
   if(status<200||status>=300)return response({error:'El proveedor push rechazó la prueba: HTTP '+status},502,allowedOrigin);
   return response({ok:true,accepted:true},200,allowedOrigin);
  }
  return response({error:'Ruta no encontrada'},404,allowedOrigin);
 }catch(error){
  console.error(JSON.stringify({event:'push-error',name:error.name,reason:String(error.message).replace(/https?:\/\/\S+/g,'[proveedor]').replace(/[A-Za-z0-9_-]{35,}/g,'[dato omitido]').slice(0,240)}));
  const invalid=path==='/push/subscribe'&&(/subscription|suscripci|Clave|Magnitud|URL|Invalid key|Servicio push no permitido/i.test(error.message)||error.name==='DataError');
  return response({error:invalid?'Suscripción o magnitud inválida':'No se pudo completar el envío. Reintenta más tarde.'},invalid?400:503,allowedOrigin);
 }
}
export function newPublishedEvents(before,after,now=Date.now()){
 if(!before?.length)return [];
 const last=before.reduce((a,e)=>[e.date,e.time].join('T')>a?[e.date,e.time].join('T'):a,'');
 const known=new Set(before.map(eventKey));
 return after.filter(e=>{const age=now-Date.parse(e.date+'T'+e.time+'-05:00');return !known.has(eventKey(e))&&[e.date,e.time].join('T')>last&&age>=-5*60000&&age<=24*3600000;});
}
export async function queueNewEvents(sql,before,after,now=Date.now()){
 const added=newPublishedEvents(before,after,now);if(!added.length)return 0;let queued=0;
 for(const sub of sql.exec('SELECT id,min_mag FROM push_subscriptions').toArray()){
  const matching=added.filter(e=>e.mag>=sub.min_mag).sort((a,b)=>[b.date,b.time].join('T').localeCompare([a.date,a.time].join('T')));if(!matching.length)continue;
  const e=matching[0],id=await hash(sub.id+'|'+eventKey(e));
  const payload={title:`M ${e.mag.toFixed(1)} · Nuevo registro IGC–UP`,body:`${e.region.slice(0,190)} · ${e.date} ${pushClock12(e.time)} Panamá · ${e.depth} km.${matching.length>1?' '+matching.length+' registros nuevos.':''} Aviso informativo.`,tag:'atlas-'+id.slice(0,24),event:eventKey(e),timestamp:Date.parse(e.date+'T'+e.time+'-05:00')};
  sql.exec('INSERT OR IGNORE INTO push_outbox(id,recipient,payload,due,expires) VALUES(?,?,?,?,?)',id,sub.id,JSON.stringify(payload),now,now+1800000);queued++;
 }
 return queued;
}
export async function dispatchPush(sql,env,fetcher=fetch,now=Date.now()){
 sql.exec('DELETE FROM push_outbox WHERE expires<? OR recipient NOT IN (SELECT id FROM push_subscriptions)',now);
 const rows=sql.exec('SELECT o.*,s.subscription FROM push_outbox o JOIN push_subscriptions s ON s.id=o.recipient WHERE o.due<=? ORDER BY o.due LIMIT 40',now).toArray();
 let accepted=0,failed=0,expired=0;
 for(let i=0;i<rows.length;i+=8)await Promise.all(rows.slice(i,i+8).map(async row=>{
  let status=0;try{status=await sendPush(JSON.parse(row.subscription),JSON.parse(row.payload),env,fetcher);}catch{}
  if(status>=200&&status<300){sql.exec('DELETE FROM push_outbox WHERE id=?',row.id);accepted++;}
  else if(status===404||status===410){sql.exec('DELETE FROM push_subscriptions WHERE id=?',row.recipient);sql.exec('DELETE FROM push_outbox WHERE recipient=?',row.recipient);expired++;}
  else{failed++;const attempts=row.attempts+1;if(attempts>=3||status===400||status===401||status===403)sql.exec('DELETE FROM push_outbox WHERE id=?',row.id);else sql.exec('UPDATE push_outbox SET attempts=?,due=? WHERE id=?',attempts,now+60000*2**(attempts-1),row.id);}
 }));
 return {accepted,failed,expired,pending:sql.exec('SELECT COUNT(*) AS total FROM push_outbox').toArray()[0].total};
}
