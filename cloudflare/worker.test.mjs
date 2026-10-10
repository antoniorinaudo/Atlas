import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{parseOfficial,collect,synchronize,pack,KEY} from './worker.mjs';

const row=(mag='4.2',date='2026-10-10')=>`<tr><td>REVISADO</td><td>${date}</td><td>12:10:05AM</td><td>7.5</td><td>-80.5</td><td>4km</td><td>${mag}</td><td>Localizado en Tonos&iacute; &amp; Coiba</td></tr>`;
const html=`<table><tr><th>Estado</th><th>Fecha</th><th>Hora</th><th>Latitud</th><th>Longitud</th><th>Profundidad</th><th>Magnitud</th><th>Región</th></tr>${row()}${row()}${row('100')}${row('4','2026-02-30')}</table>`;
const response=()=>new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
function memoryKV(initial=null) {let value=initial;return {get:async()=>value,put:async(key,data)=>{assert.equal(key,KEY);value=JSON.parse(data);},value:()=>value};}
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
 const kv=memoryKV(),env={ATLAS_KV:kv},event={cron:'*/10 * * * *',scheduledTime:Date.now()};
 await synchronize(env,event,async()=>response(),async()=>{});
 const previous=kv.value().catalog;
 await assert.rejects(()=>synchronize(env,event,async()=>new Response('error',{status:500}),async()=>{}));
 assert.deepEqual(kv.value().catalog,previous);assert.equal(kv.value().diagnostic.status,'failure');assert.equal(kv.value().diagnostic.http_status,500);
});
test('API solo lee copia; ETag/304, preflight, HEAD y rutas prohibidas',async()=>{
 const stored=await pack({events:parseOfficial(html),fetched_at_utc:'2026-10-10T15:00:00Z'},{status:'success'});
 const env={ATLAS_KV:memoryKV(stored)};
 const req=(path='/sismos.json',init={})=>new Request('https://atlas.test'+path,init);
 const r=await worker.fetch(req(),env);assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Expose-Headers'),'ETag');assert.equal(r.headers.get('ETag'),stored.etag);
 const same=await worker.fetch(req('/sismos.json',{headers:{'If-None-Match':stored.etag}}),env);assert.equal(same.status,304);assert.equal(await same.text(),'');
 assert.equal((await worker.fetch(req('/sismos.json',{method:'OPTIONS'}),env)).status,204);
 assert.equal(await (await worker.fetch(req('/sismos.json',{method:'HEAD'}),env)).text(),'');
 assert.equal((await worker.fetch(req('/sync',{method:'POST'}),env)).status,405);
 assert.equal((await worker.fetch(req('/sync'),env)).status,404);
 assert.equal((await worker.fetch(req(),{ATLAS_KV:memoryKV()})).status,503);
});
