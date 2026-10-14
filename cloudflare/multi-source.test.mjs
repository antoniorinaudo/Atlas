import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initMulti,normalizeFeature,collectProvider,prepareMulti,providerStates} from './multi-source.mjs';
import {AtlasLive,eventRevision} from './worker.mjs';
const now=Date.parse('2026-10-14T21:00:00Z'),at=new Date(now).toISOString();
const igc=(extra={})=>({uid:'igc-one',date:'2026-10-14',time:'12:00:00',displayTime:'12:00:00',lat:7.5,lon:-80.5,mag:4.5,depth:10,status:'REVISADO',region:'Tonosí',...extra});
const obs=(provider='USGS',extra={})=>({...igc(),uid:undefined,provider,provider_id:provider+'-one',mag_type:'mw',agency:provider,source_updated_at_utc:at,origin_at_utc:'2026-10-14T17:00:02Z',sourceUrl:'https://earthquake.usgs.gov/earthquakes/eventpage/us-example',...extra});
function db(){const db=new DatabaseSync(':memory:');const sql={exec(q,...a){const s=db.prepare(q),r=s.columns().length?s.all(...a):(s.run(...a),[]);return {toArray:()=>r};}};initMulti(sql);return {db,sql};}
const batch=(events)=>Object.fromEntries(['USGS','EMSC'].map(p=>[p,{events:events.filter(e=>e.provider===p)}]));
const feature=(extra={})=>({id:'us-one',geometry:{coordinates:[-80.5,7.5,12]},properties:{time:Date.parse('2026-10-14T17:00:02Z'),updated:now,mag:4.5,magType:'mww',status:'reviewed',net:'us',place:'Panama',...extra}});

test('Normaliza UTC a Panamá, conserva tipo de magnitud y toma profundidad EMSC del campo positivo',()=>{
 const a=normalizeFeature('USGS',feature());assert.equal(a.time,'12:00:02');assert.equal(a.mag_type,'mww');assert.equal(a.status,'REVISADO');
 const b=normalizeFeature('EMSC',{id:'e-one',geometry:{coordinates:[-80.5,7.5,-15]},properties:{time:'2026-10-14T02:00:00Z',lastupdate:at,mag:4.5,magtype:'ml',depth:15,source_id:'123',auth:'EMSC'}});assert.equal(b.date,'2026-10-13');assert.equal(b.time,'21:00:00');assert.equal(b.depth,15);assert.equal(b.status,'SIN CLASIFICAR');assert.throws(()=>normalizeFeature('USGS',feature({mag:null})));
});
test('Tres reportes compatibles forman un punto, conservando las tres mediciones sin promediarlas',()=>{
 const {sql}=db(),p=prepareMulti(sql,[igc()],batch([obs(),obs('EMSC',{mag:4.7})]),{},now);p.apply();assert.equal(p.events.length,1);assert.equal(p.events[0].mag,4.5);assert.equal(p.events[0].observations.length,3);assert.equal(p.stats.compared_events,1);
 const restart=prepareMulti(sql,[igc()],{}, {},now);restart.apply();assert.equal(restart.events[0].uid,'igc-one');assert.equal(restart.stats.observation_rows_written,0);assert.equal(restart.events[0].observations.length,3);
});
test('No junta eventos alejados ni coincidencias temporales ambiguas',()=>{
 const {sql}=db();const p=prepareMulti(sql,[igc(),igc({uid:'igc-two',time:'12:00:03',lat:7.501})],batch([obs()]),{},now);assert.equal(p.events.length,3);
 const q=prepareMulti(db().sql,[igc()],batch([obs('USGS',{lat:8.5})]),{},now);assert.equal(q.events.length,2);
});
test('Dos observaciones de una fuente no se asignan a un solo sismo',()=>{
 const {sql}=db();const p=prepareMulti(sql,[igc()],batch([obs(),obs('USGS',{provider_id:'us-two',origin_at_utc:'2026-10-14T17:00:03Z'})]),{},now);assert.equal(p.events.length,3);
});
test('Una revisión conserva UID e historial; datos iguales no escriben y una revisión antigua se ignora',()=>{
 const {sql}=db();prepareMulti(sql,[igc()],batch([obs()]),{},now).apply();const second=prepareMulti(sql,[igc()],batch([obs('USGS',{mag:4.9,lat:7.51,source_updated_at_utc:new Date(now+60000).toISOString()})]),{},now+60000);second.apply();assert.equal(second.events[0].uid,'igc-one');assert.equal(second.events[0].observations[1].mag,4.9);assert.equal(sql.exec('SELECT * FROM atlas_observation_revisions').toArray().length,2);
 const stale=prepareMulti(sql,[igc()],batch([obs()]),{},now+120000);stale.apply();assert.equal(stale.stats.observation_rows_written,0);assert.equal(stale.events[0].observations[1].mag,4.9);
});
test('Cuando vuelve IGC se incorpora al evento externo sin crear otro punto ni cambiar su UID',()=>{
 const {sql}=db();const first=prepareMulti(sql,[],batch([obs(),obs('EMSC')]),{},now);first.apply();const uid=first.events[0].uid;
 const second=prepareMulti(sql,[igc()],{}, {},now);second.apply();assert.equal(second.events.length,1);assert.equal(second.events[0].uid,uid);assert.equal(second.events[0].provider,'IGC-UP');assert.equal(second.events[0].observations.length,3);
 const third=prepareMulti(sql,[igc({mag:4.4})],{}, {},now);third.apply();assert.equal(third.events.length,1);assert.equal(third.events[0].observations.length,3);assert.equal(third.events[0].uid,uid);
});
test('Una respuesta vacía no borra reportes externos; salir de la ventana conserva el archivo',()=>{
 const {sql}=db();prepareMulti(sql,[],batch([obs()]),{},now).apply();assert.equal(prepareMulti(sql,[],batch([]),{},now).events.length,1);assert.equal(prepareMulti(sql,[],{}, {},now+8*86400000).events.length,0);assert.equal(sql.exec('SELECT * FROM atlas_observations').toArray().length,1);
});
test('Consultas incrementales usan solape, paginan y no avanzan el checkpoint ante HTML inválido',async()=>{
 const urls=[];let calls=0;const result=await collectProvider('USGS',{checkpoint:at},async url=>{urls.push(new URL(url));calls++;return Response.json({features:calls===1?Array.from({length:1000},(_,i)=>({...feature(),id:'us-'+i})):[]});},now+60000);
 assert.equal(calls,2);assert.equal(result.events.length,1000);assert.equal(urls[0].searchParams.get('updatedafter'),'2026-10-14T20:50:00.000Z');assert.equal(urls[1].searchParams.get('offset'),'1001');assert.equal(result.state.checkpoint,new Date(now+60000).toISOString());await assert.rejects(()=>collectProvider('EMSC',{checkpoint:at},async()=>new Response('maintenance'),now));
});
test('HTTP 204 se acepta como consulta vacía completa',async()=>{const r=await collectProvider('EMSC',{checkpoint:at},async()=>new Response(null,{status:204}),now+60000);assert.equal(r.events.length,0);assert.equal(r.state.status,'success');});
test('Fallo IGC no detiene USGS/EMSC; primer llenado no envía push y reinicio conserva asociaciones',async()=>{
 const {sql,db:database}=db();let alarm=null;const ctx={blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[],storage:{sql,getAlarm:async()=>alarm,setAlarm:async v=>{alarm=v;},transactionSync(fn){database.exec('BEGIN');try{const r=fn();database.exec('COMMIT');return r;}catch(e){database.exec('ROLLBACK');throw e;}}}};
 const service=new AtlasLive(ctx,{MULTI_SOURCE:'true'});await service.ready;
 await service.check(async url=>String(url).includes('up.ac.pa')?new Response('mantenimiento'):Response.json({features:String(url).includes('usgs')?[feature()]:[]}),async()=>{});
 assert.equal(service.snapshot.diagnostic.status,'success');assert.equal(service.snapshot.diagnostic.sources['IGC-UP'].status,'failure');assert.equal(service.snapshot.catalog.events.length,1);assert.equal(service.snapshot.catalog.events[0].provider,'USGS');assert.equal(providerStates(sql).USGS.status,'success');
 const uid=service.snapshot.catalog.events[0].uid;const restarted=new AtlasLive(ctx,{MULTI_SOURCE:'true'});await restarted.ready;await restarted.check(async()=>{throw Error('not due');},async()=>{});assert.equal(restarted.snapshot.catalog.events[0].uid,uid);
});

test('Verificar la fuente sin cambios produce la misma revisión; cambiar magnitud o salud sí la cambia',async()=>{
 const e={...igc(),observations:[{...obs(),verified_at_utc:at,source_health:'success'}]};const revision=await eventRevision([e]);
 assert.equal(await eventRevision([{...e,verified_at_utc:new Date(now+60000).toISOString(),observations:[{...e.observations[0],verified_at_utc:new Date(now+60000).toISOString()}]}]),revision);
 assert.notEqual(await eventRevision([{...e,observations:[{...e.observations[0],source_health:'failure'}]}]),revision);
 assert.notEqual(await eventRevision([{...e,observations:[{...e.observations[0],mag:4.9}]}]),revision);
});

test('El WebSocket EMSC persiste un reporte y lo asocia sin otra descarga ni duplicación',async()=>{
 const {sql,db:database}=db();let alarm=null;const pending=[];const ctx={waitUntil:p=>pending.push(p),blockConcurrencyWhile:fn=>fn(),getWebSockets:()=>[],storage:{sql,getAlarm:async()=>alarm,setAlarm:async v=>{alarm=v;},transactionSync(fn){database.exec('BEGIN');try{const r=fn();database.exec('COMMIT');return r;}catch(e){database.exec('ROLLBACK');throw e;}}}};
 const service=new AtlasLive(ctx,{MULTI_SOURCE:'true'});await service.ready;await service.check(async url=>String(url).includes('up.ac.pa')?new Response('mantenimiento'):Response.json({features:String(url).includes('usgs')?[feature()]:[]}),async()=>{});
 const uid=service.snapshot.catalog.events[0].uid,checkpoint=providerStates(sql).EMSC.checkpoint,listeners={};const socket={readyState:1,accept(){},addEventListener:(name,callback)=>{listeners[name]=callback;}};
 const original=globalThis.fetch;globalThis.fetch=async()=>({webSocket:socket});try{await service.connectEMSC();}finally{globalThis.fetch=original;}
 const event={id:'emsc-one',geometry:{coordinates:[-80.501,7.5,-15]},properties:{time:'2026-10-14T17:00:03Z',lastupdate:at,depth:15,mag:4.6,magtype:'mw',auth:'EMSC',source_id:'12345'}};
 listeners.message({data:JSON.stringify({action:'create',data:event})});await Promise.all(pending);
 assert.equal(service.snapshot.catalog.events.length,1);assert.equal(service.snapshot.catalog.events[0].uid,uid);assert.equal(service.snapshot.catalog.events[0].observations.length,2);assert.equal(service.snapshot.diagnostic.event,'stream');assert.equal(providerStates(sql).EMSC.checkpoint,checkpoint);assert.equal(providerStates(sql).EMSC.stream,'connected');
 const versions=sql.exec('SELECT * FROM atlas_observation_revisions').toArray().length;listeners.message({data:JSON.stringify({action:'update',data:event})});await Promise.all(pending);assert.equal(sql.exec('SELECT * FROM atlas_observation_revisions').toArray().length,versions);
 const history=await service.fetch(new Request('https://atlas.test/revisiones.json?uid='+encodeURIComponent(uid)));assert.equal((await history.json()).sources.length,2);
 const archive=await service.fetch(new Request('https://atlas.test/historico.json?provider=EMSC'));assert.equal((await archive.json()).events.length,1);
});
