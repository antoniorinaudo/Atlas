import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initCatalogStore,prepareMerge,viewStored,seedLegacy,prepareRecovery,archivePage,eventRevisions} from './catalog-store.mjs';
import {AtlasLive,collect,readLimited} from './worker.mjs';

const NOW=Date.parse('2026-10-14T21:00:00Z'),at=new Date(NOW).toISOString();
const event=(n=0,extra={})=>({date:'2026-10-14',time:`12:${String(n).padStart(2,'0')}:00`,displayTime:`12:${String(n).padStart(2,'0')}:00PM`,lat:7.5,lon:-80.5,mag:4.2,depth:5,status:'PRELIMINAR',region:'Tonosí',...extra});
function database(){
 const db=new DatabaseSync(':memory:'),writes=[];
 const sql={exec(query,...args){const statement=db.prepare(query),rows=statement.columns().length?statement.all(...args):(writes.push(query),statement.run(...args),[]);return {toArray:()=>rows};}};
 initCatalogStore(sql);return {sql,db,writes};
}
function context(){
 const {sql,db}=database(),messages=[];let alarm=null,fail=false;
 return {messages,failCommit:()=>{fail=true;},blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[{send:message=>messages.push(JSON.parse(message))}],storage:{transactionSync(fn){db.exec('BEGIN');try{const result=fn();if(fail)throw Error('simulated commit failure');db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},sql,getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;}}};
}
const table=events=>'<table><tr><th>Estado</th><th>Fecha</th><th>Hora</th><th>Latitud</th><th>Longitud</th><th>Profundidad</th><th>Magnitud</th><th>Región</th></tr>'+events.map(e=>`<tr><td>${e.status}</td><td>${e.date}</td><td>${e.displayTime}</td><td>${e.lat}</td><td>${e.lon}</td><td>${e.depth}km</td><td>${e.mag}</td><td>${e.region}</td></tr>`).join('')+'</table>';
const response=(events,etag='"source-one"')=>new Response(table(events),{headers:{'content-type':'text/html; charset=utf-8',etag,'last-modified':'Wed, 14 Oct 2026 20:00:00 GMT'}});

test('Solo escribe eventos nuevos o modificados; un catálogo igual no duplica filas ni revisiones',()=>{
 const {sql,writes}=database(),initial=[event(),event(1)];
 const first=prepareMerge(sql,initial,at,NOW);first.apply();assert.equal(first.stats.inserted,2);
 writes.length=0;const second=prepareMerge(sql,initial,new Date(NOW+60000).toISOString(),NOW+60000);second.apply();
 assert.equal(second.stats.event_rows_written,0);assert.equal(writes.length,0);assert.equal(second.stats.stored_events,2);assert.equal(second.stats.stored_revisions,2);
});
test('Una respuesta menor conserva los eventos ausentes y distingue observado/conservado',()=>{
 const {sql}=database(),initial=Array.from({length:10},(_,i)=>event(i));prepareMerge(sql,initial,at,NOW).apply();
 const partial=prepareMerge(sql,initial.slice(2),at,NOW);partial.apply();assert.equal(partial.events.length,10);assert.equal(partial.stats.retained_active,2);assert.equal(partial.stats.event_rows_written,0);
 const restored=viewStored(sql,NOW);assert.equal(restored.filter(e=>e.source_presence==='retained').length,2);
});
test('Una caída de 40 a 1 registros se rechaza sin modificar el histórico ni su presencia',()=>{
 const {sql}=database(),initial=Array.from({length:40},(_,i)=>event(i));prepareMerge(sql,initial,at,NOW).apply();
 assert.throws(()=>prepareMerge(sql,initial.slice(0,1),at,NOW),/Catálogo parcial/);assert.equal(viewStored(sql,NOW).length,40);assert(viewStored(sql,NOW).every(e=>e.source_presence==='observed'));
});
test('Revisiones conservan uid e historial; una relocalización inequívoca enlaza una nueva coordenada',()=>{
 const {sql}=database(),first=prepareMerge(sql,[event()],at,NOW);first.apply();const uid=first.events[0].uid;
 const second=prepareMerge(sql,[event(0,{status:'REVISADO',mag:4.1,depth:8,lat:7.51})],at,NOW);second.apply();assert.equal(second.events[0].uid,uid);assert.equal(second.stats.updated,1);assert.equal(second.stats.stored_events,1);
 const history=eventRevisions(sql,uid);assert.equal(history.revisions.length,2);assert.equal(history.revisions[1].event.mag,4.2);assert.equal(history.revisions[0].event.mag,4.1);
 const stale=prepareMerge(sql,[event()],at,NOW);stale.apply();assert.equal(stale.events[0].mag,4.1);assert.equal(stale.stats.reviewed_preserved,1);assert.equal(stale.stats.event_rows_written,0);
});
test('Dos eventos simultáneos ambiguos no se fusionan por cercanía',()=>{
 const {sql}=database();prepareMerge(sql,[event()],at,NOW).apply();const next=prepareMerge(sql,[event(0,{lat:7.51}),event(0,{lat:7.52})],at,NOW);next.apply();assert.equal(next.stats.stored_events,3);assert.equal(next.stats.inserted,2);
});
test('Salir de los 7 días solo cambia la vista; el archivo y las revisiones siguen accesibles',()=>{
 const {sql}=database();prepareMerge(sql,[event(),event(1)],at,NOW).apply();const later=NOW+8*86400000;prepareMerge(sql,[event(2,{date:'2026-10-22'})],new Date(later).toISOString(),later).apply();
 assert.equal(viewStored(sql,later).length,1);const archive=archivePage(sql,new URL('https://atlas.test/historico.json?limit=2'));assert.equal(archive.events.length,2);assert.equal(archive.next_offset,2);assert.equal(archivePage(sql,new URL('https://atlas.test/historico.json?from=2026-10-14&to=2026-10-14')).events.length,2);
});
test('La migración importa la copia anterior una sola vez',()=>{
 const {sql}=database(),catalog={events:[event()],fetched_at_utc:at};assert.equal(seedLegacy(sql,catalog,NOW),true);assert.equal(seedLegacy(sql,catalog,NOW),false);assert.equal(viewStored(sql,NOW).length,1);assert.equal(eventRevisions(sql,viewStored(sql,NOW)[0].uid).revisions.length,1);
});
test('Una captura de recuperación solo incorpora registros faltantes, sin sustituir revisiones ni fingir presencia actual',()=>{
 const {sql}=database();prepareMerge(sql,[event(0,{status:'REVISADO',mag:5}),event(2)],at,NOW).apply();
 const capture={fetched_at_utc:new Date(NOW-3600000).toISOString(),events:[event(),event(1)]};
 const recovery=prepareRecovery(sql,capture,NOW);recovery.apply();assert.equal(recovery.stats.recovered,1);assert.equal(viewStored(sql,NOW).length,3);assert.equal(viewStored(sql,NOW).find(e=>e.time==='12:00:00').mag,5);assert.equal(viewStored(sql,NOW).find(e=>e.time==='12:01:00').source_presence,'retained');assert.equal(prepareRecovery(sql,capture,NOW),null);
});
test('El colector cancela el resto después de la tabla y no descarga los 20 MB de tablas duplicadas',async()=>{
 let sent=0,cancelled=false;const chunks=[new TextEncoder().encode(table([event()])),new Uint8Array(20_000_000)];
 const stream=new ReadableStream({pull(controller){controller.enqueue(chunks[sent++]);},cancel(){cancelled=true;}},{highWaterMark:0});
 const result=await collect(async()=>new Response(stream,{headers:{etag:'"a"'}}),async()=>{});assert.equal(result.events.length,1);assert.equal(sent,1);assert(cancelled);assert(result.bytes_read<1000);
});
test('UTF-8 cortado entre chunks y tablas previas sin datos no dañan la tabla útil',async()=>{
 const bytes=new TextEncoder().encode('<table><tr><td>navegación</td></tr></table>'+table([event(0,{region:'Tonosí'} )]));let i=0;
 const stream=new ReadableStream({pull(controller){if(i<bytes.length)controller.enqueue(bytes.slice(i,i+=13));else controller.close();}},{highWaterMark:0});const result=await collect(async()=>new Response(stream),async()=>{});assert.equal(result.events[0].region,'Tonosí');
});
test('ETag permite HTTP 304 sin HTML; la copia y la fecha de descarga persisten entre instancias',async()=>{
 const ctx=context(),service=new AtlasLive(ctx,{});await service.ready;await service.check(async()=>response([event()]),async()=>{});const fetched=service.snapshot.catalog.fetched_at_utc;
 let header;await service.check(async(url,options)=>{header=options.headers['If-None-Match'];return new Response(null,{status:304});},async()=>{});
 assert.equal(header,'"source-one"');assert.equal(service.snapshot.diagnostic.http_status,304);assert.equal(service.snapshot.diagnostic.bytes_read,0);assert.equal(service.snapshot.catalog.fetched_at_utc,fetched);assert.equal(service.snapshot.diagnostic.persistence.event_rows_written,0);assert(service.snapshot.catalog.verified_at_utc);
 const restored=new AtlasLive(ctx,{});await restored.ready;assert.deepEqual(restored.snapshot,service.snapshot);assert.equal((await (await restored.fetch(new Request('https://atlas.test/historico.json'))).json()).events.length,1);
});
test('Mantenimiento y catálogo parcial mantienen datos, fecha, validadores e historial de consultas',async()=>{
 const ctx=context(),service=new AtlasLive(ctx,{});await service.ready;await service.check(async()=>response(Array.from({length:30},(_,i)=>event(i))),async()=>{});const old=service.snapshot.catalog;
 await service.check(async()=>response([event()],'"partial"'),async()=>{});assert.deepEqual(service.snapshot.catalog,old);assert.equal(service.snapshot.diagnostic.reason,'partial_catalog');assert.equal(service.snapshot.diagnostic.http_status,200);assert.equal(service.snapshot.diagnostic.upstream.etag,'"source-one"');
 await service.check(async()=>new Response('Estamos en mantenimiento hasta las 4:30pm.'),async()=>{});assert.deepEqual(service.snapshot.catalog,old);assert.match(service.snapshot.diagnostic.logs[0],/mantenimiento/);
 const diagnostic=await (await service.fetch(new Request('https://atlas.test/diagnostico.json'))).json();assert(diagnostic.recent_checks.length>=2);
});
test('Un error de commit revierte ledger y copia pública, sin publicar datos a medio guardar',async()=>{
 const ctx=context(),service=new AtlasLive(ctx,{});await service.ready;await service.check(async()=>response([event()]),async()=>{});const before=service.snapshot;
 ctx.failCommit();await assert.rejects(()=>service.check(async()=>response([event(),event(1)]),async()=>{}),/commit failure/);assert.equal(service.snapshot,before);assert.equal((await (await service.fetch(new Request('https://atlas.test/historico.json'))).json()).events.length,1);
});
