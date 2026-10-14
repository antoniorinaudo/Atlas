import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{AtlasLive,parseOfficial,collect,pack,KEY} from './worker.mjs';

const row=(mag='4.2',date='2026-10-10')=>`<tr><td>REVISADO</td><td>${date}</td><td>12:10:05AM</td><td>7.5</td><td>-80.5</td><td>4km</td><td>${mag}</td><td>Localizado en Tonos&iacute; &amp; Coiba</td></tr>`;
const html=`<table><tr><th>Estado</th><th>Fecha</th><th>Hora</th><th>Latitud</th><th>Longitud</th><th>Profundidad</th><th>Magnitud</th><th>Región</th></tr>${row()}${row()}${row('100')}${row('4','2026-02-30')}</table>`;
const response=()=>new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
function memoryKV(initial=null) {let value=initial;return {get:async()=>value,put:async(key,data)=>{assert.equal(key,KEY);value=JSON.parse(data);},value:()=>value};}
function context() {
 const db=new DatabaseSync(':memory:');let alarm=null;const messages=[];
 return {messages,blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[{send:data=>messages.push(JSON.parse(data))}],storage:{transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},sql:{exec(query,...values){const statement=db.prepare(query);const rows=statement.columns().length?statement.all(...values):(statement.run(...values),[]);return{toArray:()=>rows};}},getAlarm:async()=>alarm,setAlarm:async time=>{alarm=time;}}};
}

test('Extrae tabla, deduplica y rechaza magnitudes/fechas inválidas',()=>{
 const events=parseOfficial(html);assert.equal(events.length,1);assert.equal(events[0].time,'00:10:05');assert.equal(events[0].depth,4);assert.equal(events[0].id,1);assert.equal(events[0].region,'Tonosí & Coiba');
 assert.throws(()=>parseOfficial('<html>fuente caída</html>'));
});
test('Reintenta HTTP transitorio; 403 y HTML inválido no producen tres GET',async()=>{
 let calls=0;const waits=[];
 const result=await collect(async()=>++calls===1?new Response('busy',{status:503}):response(),async ms=>waits.push(ms));
 assert.equal(calls,2);assert.deepEqual(waits,[2000]);assert.equal(result.http_status,200);
 calls=0;await assert.rejects(()=>collect(async()=>{calls++;return new Response('denied',{status:403});},async()=>{}));assert.equal(calls,1);
 calls=0;await assert.rejects(()=>collect(async()=>{calls++;return new Response('not a catalogue');},async()=>{}));assert.equal(calls,1);
});
test('Un fallo conserva registros y fecha de la última descarga; deja diagnóstico de fallo',async()=>{
 const ctx=context(),service=new AtlasLive(ctx,{});await service.ready;
 await service.check(async()=>response(),async()=>{});
 assert.equal(ctx.messages.at(-1).type,'catalog');
 await service.check(async()=>response(),async()=>{});assert.equal(ctx.messages.at(-1).type,'heartbeat','unchanged catalogue sends only heartbeat');
 const previous=service.snapshot.catalog;
 await service.check(async()=>new Response('error',{status:500}),async()=>{});
 assert.deepEqual(service.snapshot.catalog,previous);assert.equal(service.snapshot.diagnostic.status,'failure');assert.equal(service.snapshot.diagnostic.http_status,500);
 assert.equal(ctx.messages.at(-1).collector.status,'failure');assert(service.snapshot.diagnostic.next_check_at_utc);
 const restored=new AtlasLive(ctx,{});await restored.ready;assert.deepEqual(restored.snapshot,service.snapshot,'snapshot survives a new instance');
});
test('API solo lee copia; ETag/304, preflight, HEAD y rutas prohibidas',async()=>{
 const stored=await pack({events:parseOfficial(html),fetched_at_utc:'2026-10-10T15:00:00Z'},{status:'success'});
 const service=new AtlasLive(context(),{ATLAS_KV:memoryKV(stored)});await service.ready;const env={ATLAS_LIVE:{getByName:()=>service}};
 const req=(path='/sismos.json',init={})=>new Request('https://atlas.test'+path,init);
 const r=await worker.fetch(req(),env);assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Expose-Headers'),'ETag');assert.equal(r.headers.get('ETag'),stored.etag);
 const same=await worker.fetch(req('/sismos.json',{headers:{'If-None-Match':stored.etag}}),env);assert.equal(same.status,304);assert.equal(await same.text(),'');
 assert.equal((await worker.fetch(req('/sismos.json',{method:'OPTIONS'}),env)).status,204);
 assert.equal(await (await worker.fetch(req('/sismos.json',{method:'HEAD'}),env)).text(),'');
 assert.equal((await worker.fetch(req('/sismos.json',{method:'POST'}),env)).status,405);
 assert.equal((await worker.fetch(req('/sync'),env)).status,404);
 const empty=new AtlasLive(context(),{});await empty.ready;assert.equal((await empty.fetch(req())).status,503);
});
test('Mensajes de clientes no disparan descargas ni escrituras',async()=>{
 const service=new AtlasLive(context(),{});await service.ready;const sent=[],closed=[];const socket={send:x=>sent.push(JSON.parse(x)),close:(...x)=>closed.push(x)};
 await service.webSocketMessage(socket,'ping');assert.equal(sent[0].type,'pong');await service.webSocketMessage(socket,'refresh');assert.equal(closed[0][0],1008);assert.equal(service.snapshot,null);
 for(const code of [1005,1006,1015]){await service.webSocketClose(socket,code,'');assert.equal(closed.at(-1)[0],1000);}
 await service.webSocketClose(socket,1001,'Salir');assert.deepEqual(closed.at(-1),[1001,'Salir']);
});
