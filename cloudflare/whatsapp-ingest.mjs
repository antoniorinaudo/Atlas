import {inRegion} from './multi-source.mjs';

export const WHATSAPP_CHANNEL='0029VbAUotm2ZjCgDnlGAZ08';
export const WHATSAPP_PROVIDER='IGC-WHATSAPP';
export const INGEST_PATH='/ingest/igc-whatsapp';
export function initWhatsApp(sql){
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_whatsapp_messages (message_id TEXT PRIMARY KEY,value TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,first_seen_utc TEXT NOT NULL,updated_at_utc TEXT NOT NULL,parse_status TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS atlas_whatsapp_revisions (message_id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,observed_at_utc TEXT NOT NULL,PRIMARY KEY(message_id,revision))');
}
export async function authorized(request,secret){
 if(!secret||secret.length<32)return false;
 const hash=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const [a,b]=await Promise.all([hash(request.headers.get('Authorization')||''),hash('Bearer '+secret)]);
 let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
export async function readIngest(request,now=Date.now()){
 const reader=request.body?.getReader();if(!reader)throw Error('Cuerpo requerido');
 let raw='',bytes=0;const decoder=new TextDecoder();
 try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>1000000)throw Error('Límite de 1 MB');raw+=decoder.decode(r.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();}
 const payload=JSON.parse(raw);
 if(payload.channel!==WHATSAPP_CHANNEL||!Array.isArray(payload.messages)||payload.messages.length>100)throw Error('Canal o lote inválido');
 const fetched=Date.parse(payload.fetched_at_utc);if(!Number.isFinite(fetched)||Math.abs(now-fetched)>86400000)throw Error('Hora de lectura inválida');
 const seen=new Set();
 const messages=payload.messages.map(m=>{
  if(typeof m.id!=='string'||!/^[a-zA-Z0-9_.:-]{1,180}$/.test(m.id)||seen.has(m.id)||typeof m.text!=='string'||m.text.length>16000)throw Error('Publicación inválida o duplicada en el lote');
  seen.add(m.id);const published=Date.parse(m.published_at_utc);if(!Number.isFinite(published)||published>now+300000)throw Error('Fecha de publicación inválida');
  return {id:m.id,published_at_utc:new Date(published).toISOString(),text:m.text,has_media:!!m.has_media};
 });
 return {fetched_at_utc:new Date(fetched).toISOString(),read_count:Math.max(messages.length,Math.min(500,Math.max(0,Math.floor(Number(payload.read_count)||0)))),messages};
}
function dateISO(value){
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 const m=value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;
}
function time24(value){
 const m=value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i);
 if(!m)return null;let h=Number(m[1]);if(m[4]){if(h<1||h>12)return null;h=h%12+(m[4].toLowerCase()==='p'?12:0);}
 if(h>23||Number(m[2])>59||Number(m[3]||0)>59)return null;
 return `${String(h).padStart(2,'0')}:${m[2]}:${m[3]||'00'}`;
}
// Only explicit origin parameters are accepted. Publication time and a named
// locality never stand in for the earthquake's origin time or coordinates.
export function parseWhatsApp(message,observed){
 const body=message.text.replace(/[\u200e\u200f*]/g,'');let values=null;
 for(const raw of body.match(/https:\/\/sismosgeociencias\.up\.ac\.pa\/[^\s<>]+/gi)||[]){
  try{const u=new URL(raw.replace(/&amp;/g,'&'));if(u.pathname!=='/ultimosismo.html')continue;
   const p=u.searchParams;values={date:p.get('f'),time:p.get('h'),lat:p.get('lt'),lon:p.get('ln'),mag:p.get('m'),depth:p.get('p'),region:p.get('r'),status:p.get('e')};break;
  }catch{/* Ignore malformed links; explicit fields below may still be complete. */}
 }
 const field=(name)=>body.match(new RegExp('(?:^|\\n)\\s*'+name+'\\s*[:=]\\s*([^\\n]+)','i'))?.[1]?.trim();
 values=values||{date:field('Fecha'),time:field('Hora(?: local)?'),lat:field('Latitud'),lon:field('Longitud'),mag:field('Magnitud'),depth:field('Profundidad'),region:body.match(/Localizado en\s+([^\n]+)/i)?.[1],status:body.match(/\b(REVISADO|PRELIMINAR)\b/i)?.[1]};
 const date=dateISO(values.date||''),time=time24((values.time||'').replace(/\s+hora local\s*$/i,''));
 const number=value=>{if(typeof value!=='string'||!value.trim())return NaN;const m=value.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*(?:km|°)?\s*([NSEOW])?\s*$/i);if(!m)return NaN;return Number(m[1].replace(',','.'))*(m[2]&&/[SOW]/i.test(m[2])?-1:1);};
 const hasCoordinates=!!values.lat&&!!values.lon;
 const lat=hasCoordinates?number(values.lat):null,lon=hasCoordinates?number(values.lon):null,depth=number(values.depth),mag=number(values.mag);
 if(!date||!time||![depth,mag].every(Number.isFinite)||depth<0||depth>800||mag<0||mag>10||hasCoordinates&&(![lat,lon].every(Number.isFinite)||!inRegion({lat,lon})))return null;
 const origin=date+'T'+time+'-05:00',ms=Date.parse(origin);if(!Number.isFinite(ms)||new Date(ms-18000000).toISOString().slice(0,10)!==date||ms>Date.parse(message.published_at_utc)+300000)return null;
 return {provider:WHATSAPP_PROVIDER,provider_id:message.id,agency:'IGC-UP',origin_at_utc:new Date(ms).toISOString(),date,time,displayTime:time,lat,lon,depth,mag,mag_type:'',status:String(values.status||'SIN CLASIFICAR').toUpperCase().slice(0,40),region:String(values.region||'Región de Panamá').replace(/^Localizado en\s*/i,'').slice(0,240),sourceUrl:'https://whatsapp.com/channel/'+WHATSAPP_CHANNEL,source_updated_at_utc:null,published_at_utc:message.published_at_utc,source_channel:'WhatsApp',coordinates_published:hasCoordinates};
}
export async function prepareWhatsApp(sql,payload,now=Date.now()){
 const checked=new Date(now).toISOString(),events=[],writes=[],acknowledged_ids=[];let inserted=0,revised=0,incomplete=0;
 for(const message of payload.messages){
  const value=JSON.stringify(message),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
  const prior=sql.exec('SELECT * FROM atlas_whatsapp_messages WHERE message_id=?',message.id).toArray()[0];acknowledged_ids.push(message.id);
  if(prior?.digest===digest)continue;
  const event=parseWhatsApp(message,checked);if(event)events.push(event);else incomplete++;
  if(prior)revised++;else inserted++;
  writes.push({message,value,digest,revision:(prior?.revision||0)+1,first_seen:prior?.first_seen_utc||checked,parse_status:event?'parsed':'incomplete'});
 }
 const result={acknowledged_ids,inserted,revised,incomplete};
 return {events,result,apply(){for(const r of writes){sql.exec('INSERT INTO atlas_whatsapp_messages VALUES(?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET value=excluded.value,digest=excluded.digest,revision=excluded.revision,updated_at_utc=excluded.updated_at_utc,parse_status=excluded.parse_status',r.message.id,r.value,r.digest,r.revision,r.first_seen,checked,r.parse_status);sql.exec('INSERT INTO atlas_whatsapp_revisions VALUES(?,?,?,?)',r.message.id,r.revision,r.value,checked);}}};
}
