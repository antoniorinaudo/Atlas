// Read-only public API. Only the scheduled handler contacts the official source.
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
async function readLimited(response) {
  const reader=response.body.getReader(), chunks=[];let size=0;
  try { for(;;) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5_000_000)throw Error('Respuesta superior a 5 MB');chunks.push(value); } }
  catch(error) {await reader.cancel();throw error;}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  const charset=response.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1]||'utf-8';
  return new TextDecoder(charset).decode(bytes);
}
export async function collect(fetcher=fetch, wait=sleep) {
  const logs=[];
  for(let attempt=1;attempt<=3;attempt++) {
    const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    let status=null,canRetry=true;
    try {
      const response=await fetcher(SOURCE,{headers:{'Accept':'text/html,application/xhtml+xml','Cache-Control':'no-cache','User-Agent':'AtlasSismicoPanama/2.0 (public data collector)'},signal:controller.signal});
      status=response.status;
      if(!response.ok) {canRetry=retryable.has(status);await response.body?.cancel();throw Error('HTTP '+status);}
      canRetry=false; // Invalid HTML must not provoke a burst of repeated downloads.
      const events=parseOfficial(await readLimited(response));
      logs.push(`GET oficial: intento ${attempt}/3 · HTTP ${status} · ${Date.now()-started} ms · ${events.length} sismos`);
      return {events,logs,http_status:status};
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
export async function synchronize(env, event, fetcher=fetch, wait=sleep) {
  const old=await env.ATLAS_KV.get(KEY,{type:'json',cacheTtl:30});
  const checked=new Date().toISOString();
  const base={collector:'cloudflare',event:'schedule',trigger_schedule:event.cron,checked_at_utc:checked,scheduled_at_utc:new Date(event.scheduledTime).toISOString()};
  try {
    const result=await collect(fetcher,wait);
    const fetched=new Date().toISOString();
    const catalog={source:'IGC-UP',source_url:SOURCE,fetched_at_utc:fetched,snapshot_only:false,events:result.events};
    const diagnostic={...base,status:'success',fetched_at_utc:fetched,event_count:result.events.length,http_status:result.http_status,logs:result.logs};
    await env.ATLAS_KV.put(KEY,JSON.stringify(await pack(catalog,diagnostic)));
    console.log(JSON.stringify(diagnostic));
  } catch(error) {
    const diagnostic={...base,status:'failure',fetched_at_utc:old?.catalog?.fetched_at_utc||null,event_count:old?.catalog?.events?.length||0,http_status:error.http_status??null,logs:error.logs||[error.message]};
    await env.ATLAS_KV.put(KEY,JSON.stringify(await pack(old?.catalog||null,diagnostic)));
    console.error(JSON.stringify(diagnostic));
    throw error;
  }
}
export default {
  async scheduled(event, env) {await synchronize(env,event);},
  async fetch(request,env) {
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, OPTIONS','Access-Control-Allow-Headers':'If-None-Match','Access-Control-Expose-Headers':'ETag','Access-Control-Max-Age':'86400','X-Content-Type-Options':'nosniff'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!['GET','HEAD'].includes(request.method))return new Response('{"error":"API de solo lectura"}',{status:405,headers:{...headers,Allow:'GET, HEAD, OPTIONS'}});
    const path=new URL(request.url).pathname;
    if(!['/sismos.json','/diagnostico.json'].includes(path))return new Response('{"error":"Ruta no encontrada"}',{status:404,headers});
    const stored=await env.ATLAS_KV.get(KEY,{type:'json',cacheTtl:30});
    if(!stored)return new Response('{"error":"Colector pendiente de su primera descarga"}',{status:503,headers});
    headers.ETag=stored.etag;
    if(request.headers.get('If-None-Match')?.split(',').map(v=>v.trim().replace(/^W\//,'')).some(v=>v===stored.etag||v==='*'))return new Response(null,{status:304,headers});
    const data=path==='/diagnostico.json'?stored.diagnostic:stored.catalog?{...stored.catalog,collector:stored.diagnostic}:null;
    if(!data)return new Response('{"error":"No hay copia válida disponible"}',{status:503,headers});
    return new Response(request.method==='HEAD'?null:JSON.stringify(data),{headers});
  }
};
