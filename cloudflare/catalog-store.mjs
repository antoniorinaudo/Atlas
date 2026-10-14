// Event ledger: observations update individual records, never replace the archive.
const DAY=86400000;
export const sourceKey=e=>[e.date,e.time,Number(e.lat).toFixed(5),Number(e.lon).toFixed(5)].join('|');
const payload=e=>({status:e.status,date:e.date,time:e.time,displayTime:e.displayTime,lat:e.lat,lon:e.lon,depth:e.depth,mag:e.mag,region:e.region});
const clock=e=>e.date+'T'+e.time;
export function calendar(now=Date.now()){
 const today=new Date(now-5*3600000).toISOString().slice(0,10);
 return {today,cutoff:new Date(Date.parse(today+'T12:00:00Z')-6*DAY).toISOString().slice(0,10)};
}
const one=(sql,query,...args)=>sql.exec(query,...args).toArray()[0];
export function initCatalogStore(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_events (event_key TEXT PRIMARY KEY, event_date TEXT NOT NULL, occurred_at TEXT NOT NULL, value TEXT NOT NULL, first_seen_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL, revision INTEGER NOT NULL)');
 sql.exec('CREATE INDEX IF NOT EXISTS atlas_event_date ON atlas_events(event_date)');
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_event_aliases (alias_key TEXT PRIMARY KEY, event_key TEXT NOT NULL, source_date TEXT NOT NULL)');
 sql.exec('CREATE INDEX IF NOT EXISTS atlas_alias_date ON atlas_event_aliases(source_date)');
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_event_revisions (event_key TEXT NOT NULL, revision INTEGER NOT NULL, observed_at_utc TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(event_key,revision))');
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_collection_checks (checked_at_utc TEXT PRIMARY KEY, value TEXT NOT NULL)');
}
function distanceKm(a,b){const rad=Math.PI/180,dlat=(a.lat-b.lat)*rad,dlon=(a.lon-b.lon)*rad,h=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,h)));}
function view(rows,seen,now){
 const {cutoff,today}=calendar(now);
 return rows.filter(r=>r.event_date>=cutoff&&r.event_date<=today).map(r=>({...JSON.parse(r.value),uid:r.event_key,source_presence:seen.has(r.event_key)?'observed':'retained'})).sort((a,b)=>clock(b).localeCompare(clock(a))||a.uid.localeCompare(b.uid)).map((e,i)=>({...e,id:i+1}));
}
export function prepareMerge(sql,incoming,observedAt,now=Date.now(),{seed=false}={}){
 const {cutoff,today}=calendar(now),minDate=incoming.reduce((d,e)=>e.date<d?e.date:d,cutoff);
 const previous=sql.exec('SELECT * FROM atlas_events WHERE event_date>=?',minDate).toArray(),rows=new Map(previous.map(r=>[r.event_key,r]));
 const active=previous.filter(r=>r.event_date>=cutoff&&r.event_date<=today);
 const observedActive=incoming.filter(e=>e.date>=cutoff&&e.date<=today);
 if(!seed&&active.length>=20&&observedActive.length<Math.ceil(active.length*.5)){
  const error=Error(`Catálogo parcial: ${observedActive.length} registros recibidos frente a ${active.length} conservados en los mismos 7 días; no se modifica el histórico`);error.code='partial_catalog';throw error;
 }
 const aliases=new Map(sql.exec('SELECT alias_key,event_key FROM atlas_event_aliases WHERE source_date>=?',minDate).toArray().map(r=>[r.alias_key,r.event_key]));
 const exact=new Set(incoming.map(e=>aliases.get(sourceKey(e))).filter(Boolean)),used=new Set(),observed=new Set(),writes=[],aliasWrites=[],added=[];
 let inserted=0,updated=0,unchanged=0,reviewedPreserved=0;
 for(const input of incoming){
  const e=payload(input),alias=sourceKey(e);let key=aliases.get(alias),old=key?rows.get(key):null;
  if(!old&&!seed){
   // No official stable ID exists in this HTML. Only link an unambiguous
   // same-second relocation within 25 km; two simultaneous source rows stay distinct.
   const candidates=previous.filter(r=>r.occurred_at===clock(e)&&!exact.has(r.event_key)&&!used.has(r.event_key)&&distanceKm(JSON.parse(r.value),e)<=25);
   if(candidates.length===1&&incoming.filter(other=>clock(other)===clock(e)&&distanceKm(other,JSON.parse(candidates[0].value))<=25).length===1){old=candidates[0];key=old.event_key;}
  }
  key=key||alias;used.add(key);observed.add(key);
  if(!aliases.has(alias)){aliases.set(alias,key);aliasWrites.push({alias,key,date:e.date});}
  const previousEvent=old?JSON.parse(old.value):null;
  const downgrade=previousEvent?.status==='REVISADO'&&e.status==='PRELIMINAR';
  const value=JSON.stringify(downgrade?previousEvent:e);
  if(downgrade)reviewedPreserved++;
  if(!old||old.value!==value){
   const row={event_key:key,event_date:e.date,occurred_at:clock(e),value,first_seen_utc:old?.first_seen_utc||observedAt,updated_at_utc:observedAt,revision:(old?.revision||0)+1};
   rows.set(key,row);writes.push(row);if(old)updated++;else{inserted++;added.push({...e,uid:key});}
  }else unchanged++;
 }
 const events=view([...rows.values()],observed,now),stored=one(sql,'SELECT COUNT(*) AS total FROM atlas_events').total+inserted,revisions=one(sql,'SELECT COUNT(*) AS total FROM atlas_event_revisions').total+writes.length;
 const stats={mode:'sqlite-event-ledger',stored_events:stored,stored_revisions:revisions,active_events:events.length,observed_events:incoming.length,retained_active:events.filter(e=>e.source_presence==='retained').length,inserted,updated,unchanged,reviewed_preserved:reviewedPreserved,event_rows_written:writes.length};
 return {events,stats,added,apply(){
  for(const r of writes){
   sql.exec('INSERT INTO atlas_events(event_key,event_date,occurred_at,value,first_seen_utc,updated_at_utc,revision) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_key) DO UPDATE SET event_date=excluded.event_date,occurred_at=excluded.occurred_at,value=excluded.value,updated_at_utc=excluded.updated_at_utc,revision=excluded.revision',r.event_key,r.event_date,r.occurred_at,r.value,r.first_seen_utc,r.updated_at_utc,r.revision);
   sql.exec('INSERT INTO atlas_event_revisions(event_key,revision,observed_at_utc,value) VALUES(?,?,?,?)',r.event_key,r.revision,observedAt,r.value);
  }
  for(const a of aliasWrites)sql.exec('INSERT OR IGNORE INTO atlas_event_aliases(alias_key,event_key,source_date) VALUES(?,?,?)',a.alias,a.key,a.date);
  const seen=JSON.stringify([...observed].sort()),oldSeen=one(sql,'SELECT value FROM atlas_catalog_meta WHERE key=?','source-seen');
  if(oldSeen?.value!==seen)sql.exec('INSERT INTO atlas_catalog_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','source-seen',seen);
 }};
}
export function viewStored(sql,now=Date.now()){
 const {cutoff,today}=calendar(now),row=one(sql,'SELECT value FROM atlas_catalog_meta WHERE key=?','source-seen'),seen=new Set(row?JSON.parse(row.value):[]);
 const rows=sql.exec('SELECT * FROM atlas_events WHERE event_date>=? AND event_date<=?',cutoff,today).toArray();return view(rows,seen,now);
}
export function seedLegacy(sql,catalog,now=Date.now()){
 if(one(sql,'SELECT value FROM atlas_catalog_meta WHERE key=?','ledger-v1'))return false;
 if(catalog?.events?.length)prepareMerge(sql,catalog.events,catalog.fetched_at_utc||new Date(now).toISOString(),now,{seed:true}).apply();
 sql.exec('INSERT INTO atlas_catalog_meta(key,value) VALUES(?,?)','ledger-v1',new Date(now).toISOString());return true;
}
export function prepareRecovery(sql,catalog,now=Date.now()){
 const marker='recovery:'+catalog.fetched_at_utc;
 if(one(sql,'SELECT value FROM atlas_catalog_meta WHERE key=?',marker))return null;
 const earliest=catalog.events.reduce((d,e)=>e.date<d?e.date:d,calendar(now).cutoff);
 const rows=sql.exec('SELECT * FROM atlas_events WHERE event_date>=?',earliest).toArray();
 const aliases=new Set(sql.exec('SELECT alias_key FROM atlas_event_aliases WHERE source_date>=?',earliest).toArray().map(r=>r.alias_key));
 const missing=catalog.events.filter(e=>!aliases.has(sourceKey(e))&&!rows.some(r=>r.occurred_at===clock(e)&&distanceKm(JSON.parse(r.value),e)<=25));
 const oldSeen=one(sql,'SELECT value FROM atlas_catalog_meta WHERE key=?','source-seen')?.value||'[]',seen=new Set(JSON.parse(oldSeen));
 const plan=prepareMerge(sql,missing,catalog.fetched_at_utc,now,{seed:true});
 const events=plan.events.map(e=>({...e,source_presence:seen.has(e.uid)?'observed':'retained'}));
 const stats={...plan.stats,recovered:missing.length,recovery_capture_at_utc:catalog.fetched_at_utc,retained_active:events.filter(e=>e.source_presence==='retained').length,observed_events:seen.size};
 return {events,stats,apply(){plan.apply();sql.exec('INSERT INTO atlas_catalog_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','source-seen',oldSeen);sql.exec('INSERT INTO atlas_catalog_meta(key,value) VALUES(?,?)',marker,new Date(now).toISOString());}};
}
export function recordCheck(sql,diagnostic){
 sql.exec('INSERT OR REPLACE INTO atlas_collection_checks(checked_at_utc,value) VALUES(?,?)',diagnostic.checked_at_utc,JSON.stringify(diagnostic));
 sql.exec('DELETE FROM atlas_collection_checks WHERE checked_at_utc NOT IN (SELECT checked_at_utc FROM atlas_collection_checks ORDER BY checked_at_utc DESC LIMIT 120)');
}
export function recentChecks(sql){return sql.exec('SELECT value FROM atlas_collection_checks ORDER BY checked_at_utc DESC LIMIT 8').toArray().map(r=>{const d=JSON.parse(r.value);return {checked_at_utc:d.checked_at_utc,status:d.status,http_status:d.http_status,event_count:d.event_count,logs:d.logs,persistence:d.persistence};});}
export function archivePage(sql,url){
 const from=url.searchParams.get('from')||'0000-01-01',to=url.searchParams.get('to')||'9999-12-31',limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit'))||100)),offset=Math.max(0,Math.min(1000000,Math.floor(Number(url.searchParams.get('offset'))||0)));
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Usa fechas from/to con formato AAAA-MM-DD');
 const rows=sql.exec('SELECT * FROM atlas_events WHERE event_date>=? AND event_date<=? ORDER BY occurred_at DESC,event_key LIMIT ? OFFSET ?',from,to,Math.floor(limit),offset).toArray();
 return {source:'IGC-UP',description:'Histórico conservado por Atlas; no implica que todos los registros sigan presentes en la última consulta oficial.',events:rows.map(r=>({...JSON.parse(r.value),uid:r.event_key,revision:r.revision,first_seen_utc:r.first_seen_utc,updated_at_utc:r.updated_at_utc})),next_offset:rows.length===limit?offset+rows.length:null};
}
export function eventRevisions(sql,key){
 if(!key||key.length>180)throw Error('Se requiere uid del evento');
 return {uid:key,revisions:sql.exec('SELECT revision,observed_at_utc,value FROM atlas_event_revisions WHERE event_key=? ORDER BY revision DESC LIMIT 100',key).toArray().map(r=>({revision:r.revision,observed_at_utc:r.observed_at_utc,event:JSON.parse(r.value)}))};
}
