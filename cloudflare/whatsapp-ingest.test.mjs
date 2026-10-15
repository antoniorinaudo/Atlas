import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{AtlasLive} from './worker.mjs';
import {initMulti,prepareMulti} from './multi-source.mjs';
import {initWhatsApp,parseWhatsApp,prepareWhatsApp,authorized,readIngest,WHATSAPP_CHANNEL,INGEST_PATH} from './whatsapp-ingest.mjs';
const at='2026-10-15T15:00:00.000Z',now=Date.parse(at);
const message=(extra={})=>({id:'123',published_at_utc:at,text:'PRELIMINAR\nFecha: 15/10/2026\nHora: 9:12:35 AM\nLatitud: 7.5 N\nLongitud: 80.5 O\nMagnitud: 4.4\nProfundidad: 20km\nLocalizado en Panamá a 10km al noroeste de Tonosí',has_media:false,...extra});
function context(){
 const db=new DatabaseSync(':memory:');let alarm=null;const messages=[];
 return {messages,blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[{send:data=>messages.push(JSON.parse(data))}],storage:{transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(error){db.exec('ROLLBACK');throw error;}},sql:{exec(q,...a){const s=db.prepare(q),r=s.columns().length?s.all(...a):(s.run(...a),[]);return {toArray:()=>r};}},getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;}}};
}
test('Interpreta parámetros explícitos, hora Panamá y conserva procedencia IGC',()=>{
 const e=parseWhatsApp(message(),at);assert.equal(e.mag,4.4);assert.equal(e.lon,-80.5);assert.equal(e.origin_at_utc,'2026-10-15T14:12:35.000Z');assert.equal(e.agency,'IGC-UP');assert.equal(e.provider,'IGC-WHATSAPP');
 const link='https://sismosgeociencias.up.ac.pa/ultimosismo.html?'+new URLSearchParams({f:'2026-10-15',h:'09:12:35AM',lt:'7.5',ln:'-80.5',m:'4.4',p:'20km',r:'Localizado en Tonosí',e:'REVISADO'});
 assert.equal(parseWhatsApp(message({text:link}),at).status,'REVISADO');
 assert.equal(parseWhatsApp(message({text:'Magnitud: 4.4\nLocalizado en Tonosí'}),at),null);
 assert.equal(parseWhatsApp(message({text:message().text.replace('15/10/2026','30/02/2026')}),at),null);
});
test('Autenticación y validación rechazan otras fuentes, lotes duplicados y tamaños excesivos',async()=>{
 const secret='x'.repeat(64);assert.equal(await authorized(new Request('https://example.com',{headers:{Authorization:'Bearer '+secret}}),secret),true);assert.equal(await authorized(new Request('https://example.com'),secret),false);
 const req=data=>new Request('https://example.com',{method:'POST',body:JSON.stringify(data)});
 const valid={channel:WHATSAPP_CHANNEL,fetched_at_utc:at,messages:[message()]};assert.equal((await readIngest(req(valid),now)).messages.length,1);
 await assert.rejects(()=>readIngest(req({...valid,channel:'otro'}),now));await assert.rejects(()=>readIngest(req({...valid,messages:[message(),message()]}),now));await assert.rejects(()=>readIngest(req({text:'a'.repeat(1000001)}),now));
 const response=await worker.fetch(new Request('https://example.com'+INGEST_PATH,{method:'POST',body:'{}'}),{WHATSAPP_INGEST_TOKEN:secret});assert.equal(response.status,401);
});
test('Persistencia idempotente y revisiones; reportes incompletos se conservan sin inventar epicentros',async()=>{
 const ctx=context(),sql=ctx.storage.sql;initWhatsApp(sql);
 const first=await prepareWhatsApp(sql,{messages:[message(),message({id:'incomplete',text:'Magnitud 4.5'})]},now);first.apply();assert.equal(first.events.length,1);assert.equal(first.result.incomplete,1);
 const again=await prepareWhatsApp(sql,{messages:[message()]},now+1000);again.apply();assert.equal(again.result.inserted,0);assert.equal(again.events.length,0);
 const changed=await prepareWhatsApp(sql,{messages:[message({text:message().text.replace('4.4','4.3')})]},now+2000);changed.apply();assert.equal(changed.result.revised,1);assert.equal(sql.exec('SELECT * FROM atlas_whatsapp_revisions').toArray().length,3);
});
test('Formato real del canal sin coordenadas se archiva y solo se asocia a una coincidencia única',()=>{
 const {storage:{sql}}=context();initMulti(sql);
 const text='El Instituto de Geociencias de la Universidad de Panamá,\nReporta el siguiente evento:\nEstado: REVISADO\nFecha: 2026-10-15\nHora: 9:51:45AM hora local\nMagnitud: 3.7\nProfundidad: 5km\nLocalizado en Panamá a 23km al este de Tonosí';
 const wa=parseWhatsApp(message({text,published_at_utc:'2026-10-15T15:04:09Z'}),at);assert.equal(wa.lat,null);assert.equal(wa.time,'09:51:45');
 const first=prepareMulti(sql,[],{'IGC-WHATSAPP':{events:[wa]}},{},now);first.apply();assert.equal(first.events.length,0);assert.equal(first.stats.channel_unlocated,1);
 const geo={...wa,provider:'EMSC',provider_id:'emsc-1',lat:7.4,lon:-80.3};
 const next=prepareMulti(sql,[],{EMSC:{events:[geo]}},{},now);next.apply();assert.equal(next.events.length,1);assert.equal(next.events[0].provider,'EMSC');assert.equal(next.events[0].observations.length,2);assert.equal(next.events[0].observations[1].lat,null);assert.equal(next.stats.channel_unlocated,0);
 const again=prepareMulti(sql,[],{},{},now);assert.equal(again.events[0].uid,next.events[0].uid);assert.equal(again.stats.observation_rows_written,0);
});
test('Sin coordenadas no se elige entre dos coincidencias ni se crea un punto adicional',()=>{
 const {storage:{sql}}=context();initMulti(sql);
 const wa=parseWhatsApp(message({text:message().text.replace(/Latitud:[^\n]+\n|Longitud:[^\n]+\n/g,'')}),at);
 const geo={...wa,provider:'EMSC',provider_id:'one',lat:7.5,lon:-80.5};
 const p=prepareMulti(sql,[],{EMSC:{events:[geo,{...geo,provider_id:'two',lat:7.6}]},'IGC-WHATSAPP':{events:[wa]}},{},now);assert.equal(p.events.length,2);assert.equal(p.stats.channel_unlocated,1);assert.equal(p.events.filter(e=>e.observations.some(o=>o.provider==='IGC-WHATSAPP')).length,0);
});
test('Un reporte nuevo sin coordenadas se publica por WebSocket sin crear un punto',async()=>{
 const ctx=context(),secret='x'.repeat(64),obj=new AtlasLive(ctx,{MULTI_SOURCE:'true',WHATSAPP_INGEST_TOKEN:secret});await obj.ready;
 const local=new Date(Date.now()-18000000-60000).toISOString();
 const m=message({published_at_utc:new Date().toISOString(),text:message().text.replace('15/10/2026',local.slice(0,10)).replace('9:12:35 AM',local.slice(11,19)).replace(/Latitud:[^\n]+\n|Longitud:[^\n]+\n/g,'')});
 const req=()=>new Request('https://example.com'+INGEST_PATH,{method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify({channel:WHATSAPP_CHANNEL,fetched_at_utc:new Date().toISOString(),messages:[m]})});
 const r=await obj.fetch(req());assert.equal(r.status,200);assert.equal(obj.snapshot.catalog.events.length,0);assert.equal(obj.snapshot.catalog.channel_reports.length,1);assert(ctx.messages.some(f=>f.type==='catalog'&&f.payload.channel_reports.length===1));
 const revision=obj.snapshot.revision;ctx.messages.length=0;await obj.fetch(req());assert.equal(obj.snapshot.revision,revision);assert(ctx.messages.some(f=>f.type==='heartbeat'));
});
test('Ingesta real del objeto persiste, difunde por WebSocket y no consulta otras fuentes ni duplica al repetir',async()=>{
 const ctx=context(),secret='x'.repeat(64),obj=new AtlasLive(ctx,{MULTI_SOURCE:'true',WHATSAPP_INGEST_TOKEN:secret});await obj.ready;
 const local=new Date(Date.now()-18000000-60000).toISOString();const m=message({published_at_utc:new Date().toISOString(),text:message().text.replace('15/10/2026',local.slice(0,10)).replace('9:12:35 AM',local.slice(11,19))});
 const payload={channel:WHATSAPP_CHANNEL,fetched_at_utc:new Date().toISOString(),messages:[m]};
 const req=()=>new Request('https://example.com'+INGEST_PATH,{method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify(payload)});
 const fetchBefore=globalThis.fetch;globalThis.fetch=()=>{throw Error('La ingesta no debe recosechar fuentes');};
 try{
  const first=await obj.fetch(req());assert.equal(first.status,200);assert.equal((await first.json()).inserted,1);const uid=obj.snapshot.catalog.events[0].uid;assert.equal(obj.snapshot.catalog.events[0].provider,'IGC-WHATSAPP');assert.ok(ctx.messages.some(m=>m.type==='catalog'));
  const again=await obj.fetch(req());assert.equal((await again.json()).inserted,0);assert.equal(obj.snapshot.catalog.events.length,1);assert.equal(obj.snapshot.catalog.events[0].uid,uid);
 }finally{globalThis.fetch=fetchBefore;}
});
