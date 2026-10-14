import {calendar} from './catalog-store.mjs';

export const PROVIDERS={
 USGS:{url:'https://earthquake.usgs.gov/fdsnws/event/1/query',home:'https://earthquake.usgs.gov/earthquakes/'},
 EMSC:{url:'https://www.seismicportal.eu/fdsnws/event/1/query',home:'https://www.emsc.eu/'}
};
export const inRegion=e=>e.lat>=6&&e.lat<=10.5&&e.lon>=-83.5&&e.lon<=-77;
const one=(sql,q,...args)=>sql.exec(q,...args).toArray()[0];
const key=e=>e.provider+':'+e.provider_id;
const epoch=e=>Date.parse(e.origin_at_utc||e.date+'T'+e.time+'-05:00');
export function distance(a,b){const r=Math.PI/180,h=Math.sin((a.lat-b.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((a.lon-b.lon)*r/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,h)));}
export function initMulti(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_observations (observation_key TEXT PRIMARY KEY, provider TEXT NOT NULL, event_date TEXT NOT NULL, canonical_uid TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL, observed_at_utc TEXT NOT NULL)');
 sql.exec('CREATE INDEX IF NOT EXISTS atlas_observation_date ON atlas_observations(event_date)');
 sql.exec('CREATE INDEX IF NOT EXISTS atlas_observation_uid ON atlas_observations(canonical_uid)');
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_observation_revisions (observation_key TEXT NOT NULL, revision INTEGER NOT NULL, observed_at_utc TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(observation_key,revision))');
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_provider_state (provider TEXT PRIMARY KEY, value TEXT NOT NULL)');
}
export function providerStates(sql){return Object.fromEntries(sql.exec('SELECT provider,value FROM atlas_provider_state').toArray().map(r=>[r.provider,JSON.parse(r.value)]));}
export function saveProvider(sql,provider,state){sql.exec('INSERT INTO atlas_provider_state(provider,value) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET value=excluded.value',provider,JSON.stringify(state));}
export function externalArchive(sql,url){
 const provider=url.searchParams.get('provider');if(!PROVIDERS[provider])throw Error('provider debe ser USGS o EMSC');
 const from=url.searchParams.get('from')||'0000-01-01',to=url.searchParams.get('to')||'9999-12-31';if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Fechas from/to inválidas');
 const limit=Math.floor(Math.max(1,Math.min(500,Number(url.searchParams.get('limit'))||100))),offset=Math.floor(Math.max(0,Math.min(1000000,Number(url.searchParams.get('offset'))||0)));
 const rows=sql.exec('SELECT * FROM atlas_observations WHERE provider=? AND event_date>=? AND event_date<=? ORDER BY event_date DESC,observation_key LIMIT ? OFFSET ?',provider,from,to,limit,offset).toArray();
 return {source:provider,description:'Reportes persistidos, independientes del catálogo combinado.',events:rows.map(r=>({...JSON.parse(r.value),uid:r.canonical_uid,revision:r.revision,observed_at_utc:r.observed_at_utc})),next_offset:rows.length===limit?offset+rows.length:null};
}
export function comparisonRevisions(sql,uid){return sql.exec('SELECT observation_key,provider FROM atlas_observations WHERE canonical_uid=? AND provider!=?',uid,'IGC-UP').toArray().map(o=>({provider:o.provider,observation_key:o.observation_key,revisions:sql.exec('SELECT revision,observed_at_utc,value FROM atlas_observation_revisions WHERE observation_key=? ORDER BY revision DESC LIMIT 100',o.observation_key).toArray().map(r=>({revision:r.revision,observed_at_utc:r.observed_at_utc,event:JSON.parse(r.value)}))}));}
export function normalizeFeature(provider,f){
 const p=f?.properties||{},c=f?.geometry?.coordinates||[],origin=provider==='USGS'?new Date(p.time).toISOString():p.time;
 const ms=Date.parse(origin),local=new Date(ms-18000000).toISOString(),id=String(provider==='USGS'?f.id:p.unid||f.id||'');
 if(!id||id.length>120||!Number.isFinite(ms)||p.mag===null)throw Error('Evento sin identificador, hora o magnitud');
 const e={provider,provider_id:id,origin_at_utc:new Date(ms).toISOString(),date:local.slice(0,10),time:local.slice(11,19),displayTime:local.slice(11,19),lat:Number(c[1]),lon:Number(c[0]),depth:Number(provider==='EMSC'?p.depth:c[2]),mag:Number(p.mag),mag_type:String(provider==='USGS'?p.magType||'':p.magtype||'').slice(0,12),status:provider==='USGS'?(p.status==='reviewed'?'REVISADO':'PRELIMINAR'):'SIN CLASIFICAR',agency:String(provider==='USGS'?p.net||'USGS':p.auth||'EMSC').slice(0,40),region:String(provider==='USGS'?p.place||'Región de Panamá':p.flynn_region||'Región de Panamá').slice(0,240),source_updated_at_utc:new Date(provider==='USGS'?p.updated:p.lastupdate||origin).toISOString(),sourceUrl:provider==='USGS'?'https://earthquake.usgs.gov/earthquakes/eventpage/'+encodeURIComponent(id):/^\d+$/.test(String(p.source_id))?'https://www.emsc.eu/Earthquake_information/earthquake.php?id='+p.source_id:'https://www.emsc.eu/'};
 if(![e.lat,e.lon,e.depth,e.mag].every(Number.isFinite)||Math.abs(e.lat)>90||Math.abs(e.lon)>180||e.depth< -10||e.depth>800||e.mag<0||e.mag>10)throw Error('Parámetros sísmicos inválidos');
 return e;
}
export async function collectProvider(provider,state={},fetcher=fetch,now=Date.now()){
 const started=new Date(now).toISOString(),url=new URL(PROVIDERS[provider].url);
 url.search=new URLSearchParams({format:provider==='USGS'?'geojson':'json',starttime:calendar(now).cutoff+'T05:00:00',minlatitude:'6',maxlatitude:'10.5',minlongitude:'-83.5',maxlongitude:'-77',orderby:'time',limit:'1000'});
 // The checkpoint is the request START, with overlap: an update made while a
 // response is in flight must be collected on the next request too.
 if(state.checkpoint)url.searchParams.set('updatedafter',new Date(Date.parse(state.checkpoint)-600000).toISOString());
 const events=[],seen=new Set();let bytes=0,pages=0;
 for(let offset=1;offset<=10000;offset+=1000){
  url.searchParams.set('offset',String(offset));
  const response=await fetcher(url.href,{headers:{Accept:'application/json','User-Agent':'AtlasSismicoPanama/4.0'},signal:AbortSignal.timeout(20000)});pages++;
  if(response.status===204)break;
  if(!response.ok){await response.body?.cancel();throw Error(provider+' HTTP '+response.status);}
  const reader=response.body.getReader(),decoder=new TextDecoder();let raw='';
  try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>8000000)throw Error(provider+' excedió 8 MB');raw+=decoder.decode(r.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();}
  const body=JSON.parse(raw);if(!Array.isArray(body.features))throw Error(provider+': respuesta sin colección de eventos');
  for(const f of body.features){const e=normalizeFeature(provider,f);if(inRegion(e)&&!seen.has(key(e))){seen.add(key(e));events.push(e);}}
  if(body.features.length<1000)break;
  if(offset===9001)throw Error(provider+': paginación incompleta; no se avanza el punto de recuperación');
 }
 return {events,state:{...state,status:'success',checked_at_utc:started,verified_at_utc:new Date().toISOString(),fetched_at_utc:bytes?new Date().toISOString():state.fetched_at_utc||null,checkpoint:started,failure_count:0,received:events.length,bytes_read:bytes,pages,next_check_at_utc:new Date(now+60000).toISOString(),logs:[provider+': '+events.length+' registros '+(state.checkpoint?'nuevos o modificados':'en carga inicial')+' · '+bytes+' bytes · '+pages+' consultas']}};
}
function igcObservation(e,verified){const params=new URLSearchParams({e:e.status,f:e.date,h:e.displayTime||e.time,ln:e.lon.toFixed(5),lt:e.lat.toFixed(5),m:String(e.mag),p:e.depth+'km',r:'Localizado en '+e.region,z:'9'});return {...e,provider:'IGC-UP',provider_id:e.uid,agency:'IGC-UP',mag_type:'',sourceUrl:'https://sismosgeociencias.up.ac.pa/ultimosismo.html?'+params,source_updated_at_utc:null,verified_at_utc:verified||null};}
function compatible(a,b){return Math.abs(epoch(a)-epoch(b))<=20000&&distance(a,b)<=25&&Math.abs(a.mag-b.mag)<=1.2;}
function rank(e){return {'IGC-UP':0,USGS:1,EMSC:2}[e.provider];}
export function prepareMulti(sql,igc,batches={},states={},now=Date.now()){
 const {cutoff,today}=calendar(now),old=sql.exec('SELECT * FROM atlas_observations WHERE event_date>=?',cutoff).toArray(),rows=new Map(old.map(r=>[r.observation_key,{...r,e:JSON.parse(r.value)}])),writes=[];
 for(const [provider,batch]of Object.entries(batches))for(const e of batch.events){
  const k=key(e),prior=rows.get(k);
  if(prior&&Date.parse(e.source_updated_at_utc)<Date.parse(prior.e.source_updated_at_utc))continue;
  const value=JSON.stringify(e);
  if(prior?.value===value)continue;
  const row={observation_key:k,provider,event_date:e.date,canonical_uid:prior?.canonical_uid||'',value,revision:(prior?.revision||0)+1,observed_at_utc:new Date(now).toISOString(),e};rows.set(k,row);writes.push(row);
 }
 const groups=new Map(),oldLinks=new Map(old.map(r=>[r.observation_key,r.canonical_uid]));
 // Existing links are stable across provider revisions and process restarts.
 // IGC can join a previously external-only group when it returns from maintenance.
 for(const e of igc){const uid=oldLinks.get('IGC-UP:'+e.uid)||e.uid;groups.set(uid,{uid,observations:[igcObservation(e,states['IGC-UP']?.verified_at_utc)]});}
 const ext=[...rows.values()].filter(r=>r.provider!=='IGC-UP'&&r.event_date>=cutoff&&r.event_date<=today);
 const pending=[];
 for(const r of ext){
  if(!r.canonical_uid){pending.push(r);continue;}
  let g=groups.get(r.canonical_uid);if(!g){g={uid:r.canonical_uid,observations:[]};groups.set(g.uid,g);}g.observations.push(r.e);
 }
 const links=[];
 // Associate only reciprocal, unique candidates. Never merge a crowded cluster
 // merely because its nearest point looks plausible; ambiguous observations stay separate.
 for(const provider of ['USGS','EMSC']){
  const current=pending.filter(r=>r.provider===provider),candidates=new Map(current.map(r=>[r,Array.from(groups.values()).filter(g=>!g.observations.some(o=>o.provider===provider)&&g.observations.some(o=>compatible(o,r.e)))]));
  for(const r of current){const possible=candidates.get(r),g=possible.length===1&&current.filter(other=>candidates.get(other).includes(possible[0])).length===1?possible[0]:null;
   const target=g||{uid:'external:'+r.observation_key,observations:[]};if(!g)groups.set(target.uid,target);target.observations.push(r.e);r.canonical_uid=target.uid;links.push(r);
  }
 }
 // Late IGC records attach only when the match is unambiguous in both directions.
 const alone=[...groups.values()].filter(g=>g.observations.length===1&&g.observations[0].provider==='IGC-UP'),external=[...groups.values()].filter(g=>!g.observations.some(o=>o.provider==='IGC-UP'));
 for(const g of alone){const candidates=external.filter(t=>t.observations.some(o=>compatible(g.observations[0],o)));if(candidates.length!==1)continue;const target=candidates[0];if(alone.filter(other=>target.observations.some(o=>compatible(other.observations[0],o))).length!==1)continue;target.observations.push(g.observations[0]);groups.delete(g.uid);links.push({observation_key:'IGC-UP:'+g.observations[0].uid,canonical_uid:target.uid,igc:true});}
 const events=[...groups.values()].filter(g=>g.observations.length).map(g=>{
  g.observations.sort((a,b)=>rank(a)-rank(b));const best=g.observations[0],observations=g.observations.map(o=>({...o,verified_at_utc:states[o.provider]?.verified_at_utc||o.verified_at_utc||null,source_health:states[o.provider]?.status||'unknown'}));
  return {...best,uid:g.uid,source_presence:best.source_presence||'observed',observations,association:observations.length>1?'approximate':'single-source'};
 }).sort((a,b)=>epoch(b)-epoch(a)||a.uid.localeCompare(b.uid)).map((e,i)=>({...e,id:i+1}));
 const existingTotal=one(sql,'SELECT COUNT(*) AS n FROM atlas_observations WHERE provider!=?','IGC-UP').n;
 return {events,stats:{observations:existingTotal+writes.filter(r=>!oldLinks.has(r.observation_key)).length,observation_rows_written:writes.length,compared_events:events.filter(e=>e.observations.length>1).length},apply(){
  for(const r of writes){sql.exec('INSERT INTO atlas_observations(observation_key,provider,event_date,canonical_uid,value,revision,observed_at_utc) VALUES(?,?,?,?,?,?,?) ON CONFLICT(observation_key) DO UPDATE SET event_date=excluded.event_date,value=excluded.value,revision=excluded.revision,observed_at_utc=excluded.observed_at_utc',r.observation_key,r.provider,r.event_date,r.canonical_uid,r.value,r.revision,r.observed_at_utc);sql.exec('INSERT INTO atlas_observation_revisions VALUES(?,?,?,?)',r.observation_key,r.revision,r.observed_at_utc,r.value);}
  for(const r of links){if(r.igc){const e=igc.find(e=>'IGC-UP:'+e.uid===r.observation_key);sql.exec('INSERT OR IGNORE INTO atlas_observations VALUES(?,?,?,?,?,?,?)',r.observation_key,'IGC-UP',e.date,r.canonical_uid,JSON.stringify(igcObservation(e)),1,new Date(now).toISOString());}else sql.exec('UPDATE atlas_observations SET canonical_uid=? WHERE observation_key=?',r.canonical_uid,r.observation_key);}
 }};
}
