import {initPush,pushAPI,queueNewEvents,dispatchPush} from './push.mjs';
import {initCatalogStore,prepareMerge,viewStored,seedLegacy,prepareRecovery,recordCheck,recentChecks,archivePage,eventRevisions} from './catalog-store.mjs';
import recoveryCapture from './recovery-20261014.json' with {type:'json'};
import {initMulti,normalizeFeature,inRegion,externalArchive,comparisonRevisions} from './multi-source.mjs';
import {checkMulti} from './multi-check.mjs';
// Read-only public API. One Durable Object harvests and broadcasts changes.
export const SOURCE = 'https://sismosgeociencias.up.ac.pa/';
export const KEY = 'catalog-v1';
const retryable = new Set([408, 429, 500, 502, 503, 504]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function text(html) {
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ',uuml:'ü'};
  return html.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') {const letter=entities[entity.toLowerCase()];return letter?entity[0]===entity[0].toUpperCase()?letter.toUpperCase():letter:match;}
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/\s+/g, ' ').trim();
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function time24(value) {
  const v=value.replace(/\s+/g,'').toUpperCase();
  const m=v.match(/^(\d{1,2}):(\d{2}):(\d{2})(AM|PM)?$/);
  if(!m) throw Error('Hora no reconocida');
  let h=Number(m[1]);
  if(Number(m[2])>59||Number(m[3])>59||(m[4] ? h<1||h>12 : h>23)) throw Error('Hora inválida');
  if(m[4]) h=h%12+(m[4]==='PM'?12:0);
  return `${String(h).padStart(2,'0')}:${m[2]}:${m[3]}`;
}
export function parseOfficial(html) {
  const tables=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  const table=tables.map(t=>[...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(r=>[...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(c=>text(c[1]))))
    .find(rows=>rows.slice(0,4).some(r=>['latitud','longitud','magnitud','fecha'].every(word=>r.join(' ').toLowerCase().includes(word))));
  if(!table) throw Error('No hay una tabla sísmica reconocible');
  const seen=new Set(), events=[];
  for(const c of table) {
    if(c.length<8||!validDate(c[1])) continue;
    try {
      const time=time24(c[2]), lat=Number(c[3].replace(',','.')), lon=Number(c[4].replace(',','.'));
      const depth=Number(c[5].replace(/\s*(?:km|kil[oó]metros?)\s*$/i,'').replace(',','.')), mag=Number(c[6].replace(',','.'));
      if([c[3],c[4],c[5],c[6]].some(v=>!v.trim())||![lat,lon,depth,mag].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lon)>180||depth<0||depth>800||mag<0||mag>10) continue;
      const key=[c[1],time,lat.toFixed(5),lon.toFixed(5)].join('|');
      if(seen.has(key)) continue;seen.add(key);
      events.push({status:c[0].toUpperCase().slice(0,40),date:c[1],time,displayTime:c[2],lat,lon,depth,mag,region:c[7].replace(/^Localizado en\s*/i,'').slice(0,240)||'Región sin descripción'});
    } catch { /* A malformed row does not discard the valid catalogue. */ }
  }
  if(!events.length) throw Error('No se extrajo ningún sismo; se conserva la copia anterior');
  events.sort((a,b)=>(b.date+'T'+b.time).localeCompare(a.date+'T'+a.time));
  return events.map((e,i)=>({...e,id:i+1}));
}
export async function readLimited(response) {
  const reader=response.body.getReader();let size=0,html='',tableStart=-1,scanned=0;
  const charset=response.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1]||'utf-8';
  const decoder=new TextDecoder(charset);
  try {for(;;){
    const {done,value}=await reader.read();if(done){html+=decoder.decode();break;}
    size+=value.byteLength;if(size>12_000_000)throw Error('Tabla oficial superior al límite de seguridad de 12 MB');
    const previousLength=html.length;html+=decoder.decode(value,{stream:true});
    if(tableStart<0){const match=/<table\b[^>]*>/i.exec(html.slice(scanned));if(match)tableStart=scanned+match.index;else scanned=Math.max(0,html.length-256);}
    let search=Math.max(tableStart,previousLength-32),match;
    const closing=/<\/table\s*>/ig;closing.lastIndex=Math.max(0,search);
    while(tableStart>=0&&(match=closing.exec(html))){
      const end=match.index+match[0].length,header=html.slice(tableStart,Math.min(end,tableStart+6000)).toLowerCase();
      if(['latitud','longitud','magnitud','fecha'].every(word=>header.includes(word))){
        await reader.cancel();return {html:html.slice(0,end),bytes_read:size,stopped_after_table:true};
      }
      const next=/<table\b[^>]*>/i.exec(html.slice(end));tableStart=next?end+next.index:-1;scanned=end;
    }
  }}catch(error){await reader.cancel();throw error;}
  return {html,bytes_read:size,stopped_after_table:false};
}
export async function collect(fetcher=fetch, wait=sleep, validators={}) {
  const logs=[];
  for(let attempt=1;attempt<=3;attempt++) {
    const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    let status=null,canRetry=true;
    try {
      const headers={'Accept':'text/html,application/xhtml+xml','Cache-Control':'no-cache','User-Agent':'AtlasSismicoPanama/3.0 (persistent public catalogue)'};
      if(validators.etag)headers['If-None-Match']=validators.etag;else if(validators.last_modified)headers['If-Modified-Since']=validators.last_modified;
      const response=await fetcher(SOURCE,{headers,signal:controller.signal});
      status=response.status;
      if(status===304){canRetry=false;await response.body?.cancel();if(!validators.etag&&!validators.last_modified)throw Error('HTTP 304 sin una copia verificada');logs.push(`GET condicional: HTTP 304 · sin cambios · 0 bytes de HTML · ${Date.now()-started} ms`);return {not_modified:true,logs,http_status:304,bytes_read:0,validators};}
      if(!response.ok) {canRetry=retryable.has(status);await response.body?.cancel();throw Error('HTTP '+status);}
      canRetry=false; // Invalid HTML must not provoke a burst of repeated downloads.
      const body=await readLimited(response);
      if(/estamos\s+en\s+mantenimiento|sitio.{0,30}en\s+mantenimiento/i.test(text(body.html.slice(0,6000))))throw Error('Fuente oficial en mantenimiento; se conserva el histórico');
      let events;try{events=parseOfficial(body.html);}catch(error){const title=text(body.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').slice(0,100);error.message+=` · ${body.bytes_read} bytes${title?' · título: '+title:body.bytes_read<2000?' · '+text(body.html).slice(0,140):''}`;throw error;}
      const nextValidators={etag:response.headers.get('etag')?.slice(0,300)||null,last_modified:response.headers.get('last-modified')?.slice(0,150)||null};
      logs.push(`GET oficial: intento ${attempt}/3 · HTTP ${status} · ${Date.now()-started} ms · ${events.length} sismos · ${body.bytes_read} bytes${body.stopped_after_table?' · lectura detenida al cerrar la tabla principal':''}`);
      return {events,logs,http_status:status,bytes_read:body.bytes_read,validators:nextValidators};
    } catch(error) {
      if(error.name==='AbortError'||error instanceof TypeError) canRetry=true;
      logs.push(`GET oficial: intento ${attempt}/3 · ${status===null?'red o tiempo agotado':'HTTP '+status} · ${Date.now()-started} ms · ${error.message}`);
      if(!canRetry||attempt===3) {error.logs=logs;error.http_status=status;throw error;}
    } finally {clearTimeout(timer);}
    logs.push(`Reintento en ${2**attempt} segundos`);await wait(2**attempt*1000);
  }
}
export async function pack(catalog,diagnostic) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({catalog,diagnostic})));
  const etag='"'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')+'"';
  return {catalog,diagnostic,etag};
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(['/push/public-key','/push/subscribe','/push/unsubscribe','/push/test'].includes(path))return env.ATLAS_LIVE.getByName('panama').fetch(request);
    if(!['/sismos.json','/diagnostico.json','/historico.json','/revisiones.json','/live'].includes(path))return jsonResponse({error:'Ruta no encontrada'},404);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:publicHeaders()});
    if(!['GET','HEAD'].includes(request.method))return jsonResponse({error:'API de solo lectura'},405);
    return env.ATLAS_LIVE.getByName('panama').fetch(request);
  }
};
function publicHeaders() {
  return {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'If-None-Match','Access-Control-Expose-Headers':'ETag','Access-Control-Max-Age':'86400','X-Content-Type-Options':'nosniff'};
}
function jsonResponse(data,status=200,extra={}) {return new Response(JSON.stringify(data),{status,headers:{...publicHeaders(),...extra}});}
export async function eventRevision(events) {
  const data=events.map(({id,verified_at_utc,...event})=>({...event,...(event.observations?{observations:event.observations.map(({verified_at_utc,...observation})=>observation)}:{})}));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export class AtlasLive {
  constructor(ctx,env) {
    this.ctx=ctx;this.env=env;this.snapshot=null;this.inFlight=null;
    this.ready=ctx.blockConcurrencyWhile(async()=>{
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS atlas_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
      initPush(ctx.storage.sql);
      initCatalogStore(ctx.storage.sql);
      initMulti(ctx.storage.sql);
      const row=ctx.storage.sql.exec('SELECT value FROM atlas_state WHERE id = 1').toArray()[0];
      if(row)this.snapshot=JSON.parse(row.value);
      else if(env.ATLAS_KV){
        this.snapshot=await env.ATLAS_KV.get(KEY,{type:'json',cacheTtl:30});
        if(this.snapshot){this.snapshot.revision=await eventRevision(this.snapshot.catalog?.events||[]);this.save(this.snapshot);}
      }
      const migrated=this.atomic(()=>seedLegacy(ctx.storage.sql,this.snapshot?.catalog));
      let recovered=false;
      if(env.RECOVERY_CAPTURE==='20261014'){
        const recovery=prepareRecovery(ctx.storage.sql,recoveryCapture);
        if(recovery){
          const old=this.snapshot,latestDownload=Date.parse(old?.catalog?.fetched_at_utc||0)>Date.parse(recoveryCapture.fetched_at_utc)?old.catalog.fetched_at_utc:recoveryCapture.fetched_at_utc;
          const catalog={source:'IGC-UP',source_url:SOURCE,...old?.catalog,fetched_at_utc:latestDownload,verified_at_utc:old?.catalog?.verified_at_utc||recoveryCapture.fetched_at_utc,snapshot_only:!old?.catalog||!!old.catalog.snapshot_only,events:recovery.events,recovery:{capture_at_utc:recoveryCapture.fetched_at_utc,imported_at_utc:new Date().toISOString(),note:'Captura oficial verificada recuperada; la disponibilidad actual de la fuente se informa en el diagnóstico.'}};
          const diagnostic={collector:'cloudflare',service:'durable-object',event:'bootstrap',status:'pending',checked_at_utc:new Date().toISOString(),...old?.diagnostic,fetched_at_utc:latestDownload,event_count:catalog.events.length,persistence:recovery.stats,logs:[...(old?.diagnostic?.logs||[]),`Recuperación: ${recovery.stats.recovered} eventos incorporados desde captura oficial verificada del ${recoveryCapture.fetched_at_utc}; no se sobrescriben eventos existentes.`]};
          const snapshot={...await pack(catalog,diagnostic),revision:await eventRevision(catalog.events)};
          this.atomic(()=>{recovery.apply();this.save(snapshot);});recovered=true;
        }
      }
      this.baselineReady=!!ctx.storage.sql.exec('SELECT value FROM atlas_catalog_meta WHERE key=?','push-baseline-v1').toArray()[0];
      // Recheck once after migration; otherwise alarms survive hibernation unchanged.
      const multiUpgrade=env.MULTI_SOURCE==='true'&&!ctx.storage.sql.exec('SELECT provider FROM atlas_provider_state LIMIT 1').toArray().length;
      if(migrated||recovered||multiUpgrade||await ctx.storage.getAlarm()===null)await ctx.storage.setAlarm(Date.now()+1000);
    });
  }
  atomic(callback){const previous=this.snapshot;try{return this.ctx.storage.transactionSync(callback);}catch(error){this.snapshot=previous;throw error;}}
  save(snapshot) {
    this.ctx.storage.sql.exec('INSERT INTO atlas_state (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(snapshot));
    this.snapshot=snapshot;
  }
  broadcast(message) {
    const data=JSON.stringify(message);
    for(const socket of this.ctx.getWebSockets())try{socket.send(data);}catch{try{socket.close(1011,'Reconectar');}catch{}}
  }
  async alarm() {
    await this.ready;
    if(this.inFlight)return this.inFlight;
    if(this.env.EMSC_STREAM==='true')await this.connectEMSC();
    this.inFlight=this.check().finally(()=>{this.inFlight=null;});
    return this.inFlight;
  }
  async connectEMSC(){
    if(this.emscSocket?.readyState===1||this.emscConnecting)return;
    this.emscConnecting=true;
    try{
      const response=await fetch('https://www.seismicportal.eu/standing_order/websocket',{headers:{Upgrade:'websocket'},signal:AbortSignal.timeout(10000)});
      if(!response.webSocket)throw Error('EMSC WebSocket HTTP '+response.status);
      const socket=response.webSocket;socket.accept();this.emscSocket=socket;
      socket.addEventListener('message',message=>{
        try{const frame=JSON.parse(message.data);if(!['create','update','insert'].includes(String(frame.action).toLowerCase()))return;const event=normalizeFeature('EMSC',frame.data);if(!inRegion(event))return;
          // Serialize stream writes with alarm harvests. HTTP checkpoints remain
          // independent, so reconnects recover any missed messages.
          this.streamQueue=(this.streamQueue||Promise.resolve()).catch(()=>{}).then(async()=>{await this.inFlight;this.inFlight=checkMulti.call(this,fetch,undefined,{live:event,event:'stream'}).finally(()=>{this.inFlight=null;});await this.inFlight;});
          this.ctx.waitUntil(this.streamQueue);
        }catch(error){console.log(JSON.stringify({event:'emsc-frame',error:error.message}));}
      });
      for(const type of ['close','error'])socket.addEventListener(type,()=>{if(this.emscSocket===socket)this.emscSocket=null;});
    }catch(error){console.log(JSON.stringify({event:'emsc-stream',error:error.message,recovery:'API incremental'}));}
    finally{this.emscConnecting=false;}
  }
  async check(fetcher=fetch,wait=sleep) {
    if(this.env.MULTI_SOURCE==='true')return checkMulti.call(this,fetcher,wait);
    // A safety alarm is persisted before I/O so an interrupted invocation recovers.
    await this.ctx.storage.setAlarm(Date.now()+120000);
    const old=this.snapshot;
    const checked=new Date().toISOString();
    const base={collector:'cloudflare',service:'durable-object',event:'alarm',checked_at_utc:checked};
    let catalog=old?.catalog||null,diagnostic,revision=old?.revision||null,plan=null;
    try {
      const result=await collect(fetcher,wait,old?.diagnostic?.upstream||{}),verified=new Date().toISOString();
      if(result.not_modified){
        if(!catalog)throw Error('No existe una copia persistente para HTTP 304');
        catalog={...catalog,verified_at_utc:verified,events:viewStored(this.ctx.storage.sql)};
      }else{
        try{plan=prepareMerge(this.ctx.storage.sql,result.events,verified);}
        catch(error){error.http_status=result.http_status;error.logs=[...result.logs,error.message];throw error;}
        catalog={source:'IGC-UP',source_url:SOURCE,fetched_at_utc:verified,verified_at_utc:verified,snapshot_only:false,events:plan.events};
      }
      revision=await eventRevision(catalog.events);
      const persistence=plan?.stats||{...old.diagnostic.persistence,active_events:catalog.events.length,inserted:0,updated:0,unchanged:catalog.events.length,event_rows_written:0};
      diagnostic={...base,status:'success',fetched_at_utc:catalog.fetched_at_utc,verified_at_utc:verified,event_count:catalog.events.length,http_status:result.http_status,bytes_read:result.bytes_read,logs:result.logs,upstream:result.validators,persistence,failure_count:0};
      diagnostic.logs.push(`Persistencia: ${persistence.stored_events} eventos archivados · ${persistence.inserted} nuevos · ${persistence.updated} revisados · ${persistence.retained_active} conservados fuera de la última respuesta · ${persistence.event_rows_written} filas de eventos escritas`);
    }catch(error){
      // A failed validation cannot publish a half-prepared catalogue or ledger.
      catalog=old?.catalog||null;revision=old?.revision||null;plan=null;
      diagnostic={...base,status:'failure',fetched_at_utc:catalog?.fetched_at_utc||null,verified_at_utc:catalog?.verified_at_utc||null,event_count:catalog?.events?.length||0,http_status:error.http_status??null,logs:error.logs||[error.message],reason:error.code||null,upstream:old?.diagnostic?.upstream||{},persistence:old?.diagnostic?.persistence?{...old.diagnostic.persistence,inserted:0,updated:0,unchanged:0,event_rows_written:0}:null,failure_count:(old?.diagnostic?.failure_count||0)+1};
    }
    const delay=diagnostic.status==='success'?60000:Math.min(600000,60000*2**Math.min(4,diagnostic.failure_count));
    diagnostic.next_check_at_utc=new Date(Date.now()+delay).toISOString();
    const snapshot={...await pack(catalog,diagnostic),revision};
    const baselineReady=this.baselineReady;
    this.atomic(()=>{
      plan?.apply();this.save(snapshot);recordCheck(this.ctx.storage.sql,diagnostic);
      if(diagnostic.status==='success'&&!this.baselineReady)this.ctx.storage.sql.exec('INSERT OR IGNORE INTO atlas_catalog_meta(key,value) VALUES(?,?)','push-baseline-v1',checked);
    });
    if(diagnostic.status==='success')this.baselineReady=true;
    // Migration/recovery establishes a baseline; historical fills and revisions
    // never become new-event push notifications.
    const queued=diagnostic.status==='success'&&baselineReady&&plan?await queueNewEvents(this.ctx.storage.sql,old?.catalog?.events,plan.added):0;
    await this.ctx.storage.setAlarm(Date.now()+delay);
    const changed=revision!==old?.revision;
    this.broadcast(changed&&catalog?{type:'catalog',etag:snapshot.etag,revision,payload:{...catalog,collector:diagnostic}}:{type:'heartbeat',etag:snapshot.etag,revision,collector:diagnostic});
    const push=await dispatchPush(this.ctx.storage.sql,this.env);
    if(queued||push.accepted||push.failed||push.expired||push.pending){
      const updated={...diagnostic,push:{queued,...push}};const pushed={...await pack(catalog,updated),revision};this.atomic(()=>{this.save(pushed);recordCheck(this.ctx.storage.sql,updated);});
      this.broadcast({type:'heartbeat',etag:this.snapshot.etag,revision,collector:updated});
      console.log(JSON.stringify({event:'push',queued,...push}));
    }
    console.log(JSON.stringify({event:'alarm',status:diagnostic.status,changed,event_count:diagnostic.event_count,next_check_at_utc:diagnostic.next_check_at_utc,logs:diagnostic.logs}));
  }
  async fetch(request) {
    await this.ready;
    const path=new URL(request.url).pathname;
    if(path.startsWith('/push/'))return pushAPI(request,this.ctx.storage.sql,this.env);
    if(path==='/historico.json'||path==='/revisiones.json'){
      try{const url=new URL(request.url),sql=this.ctx.storage.sql,uid=url.searchParams.get('uid');let data;if(path==='/historico.json')data=url.searchParams.has('provider')?externalArchive(sql,url):archivePage(sql,url);else{const linked=sql.exec('SELECT value FROM atlas_observations WHERE canonical_uid=? AND provider=?',uid,'IGC-UP').toArray()[0];data={...eventRevisions(sql,linked?JSON.parse(linked.value).provider_id:uid),uid,sources:comparisonRevisions(sql,uid)};}return new Response(request.method==='HEAD'?null:JSON.stringify(data),{headers:publicHeaders()});}
      catch(error){return jsonResponse({error:error.message},400);}
    }
    if(path==='/live'){
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return jsonResponse({error:'Se requiere WebSocket'},426);
      if(this.ctx.getWebSockets().length>=1000)return jsonResponse({error:'Conexiones ocupadas; usar API de lectura'},429);
      const [client,server]=Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      if(this.snapshot?.catalog)server.send(JSON.stringify({type:'catalog',etag:this.snapshot.etag,revision:this.snapshot.revision,payload:{...this.snapshot.catalog,collector:this.snapshot.diagnostic}}));
      else server.send(JSON.stringify({type:'pending',message:'Esperando la primera descarga oficial'}));
      return new Response(null,{status:101,webSocket:client});
    }
    const headers=publicHeaders(),stored=this.snapshot;
    if(!stored)return new Response('{"error":"Colector pendiente de su primera descarga"}',{status:503,headers});
    headers.ETag=stored.etag;
    const data=path==='/diagnostico.json'?{...stored.diagnostic,recent_checks:recentChecks(this.ctx.storage.sql)}:stored.catalog?{...stored.catalog,collector:stored.diagnostic}:null;
    if(!data)return new Response('{"error":"No hay copia válida disponible"}',{status:503,headers});
    if(request.headers.get('If-None-Match')?.split(',').map(v=>v.trim().replace(/^W\//,'')).some(v=>v===stored.etag||v==='*'))return new Response(null,{status:304,headers});
    return new Response(request.method==='HEAD'?null:JSON.stringify(data),{headers});
  }
  async webSocketMessage(socket,message) {
    // Clients cannot trigger harvesting, change settings or publish data.
    if(message==='ping')socket.send(JSON.stringify({type:'pong'}));else socket.close(1008,'Canal de solo lectura');
  }
  async webSocketClose(socket,code,reason) {try{socket.close(code===1005||code===1006||code===1015?1000:code,reason);}catch{}}
  async webSocketError(socket) {try{socket.close(1011,'Reconectar');}catch{}}
}
