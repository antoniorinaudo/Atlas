import {collect,pack,eventRevision} from './worker.mjs';
import {prepareMerge,viewStored,recordCheck} from './catalog-store.mjs';
import {collectProvider,providerStates,saveProvider,prepareMulti} from './multi-source.mjs';
import {queueNewEvents,dispatchPush} from './push.mjs';

export async function checkMulti(fetcher=fetch,wait,options={}){
 const now=Date.now(),checked=new Date(now).toISOString(),sql=this.ctx.storage.sql,old=this.snapshot,prior=providerStates(sql),batches={};let igcPlan=null;
 if(!prior['IGC-UP']&&old?.catalog)prior['IGC-UP']={status:old.diagnostic?.status||'pending',verified_at_utc:old.catalog.verified_at_utc||old.catalog.fetched_at_utc,fetched_at_utc:old.catalog.fetched_at_utc,upstream:old.diagnostic?.upstream||{},failure_count:old.diagnostic?.failure_count||0};
 const states={...prior};
 await this.ctx.storage.setAlarm(now+120000);
 const due=['IGC-UP','USGS','EMSC'].filter(p=>p==='EMSC'&&options.live||!prior[p]?.next_check_at_utc||Date.parse(prior[p].next_check_at_utc)<=now);
 const results=await Promise.allSettled(due.map(async provider=>{
  if(provider==='EMSC'&&options.live)return {events:[options.live],state:{...prior.EMSC,status:'success',stream:'connected',last_stream_event_at_utc:checked,verified_at_utc:checked,fetched_at_utc:checked,logs:['EMSC: evento nuevo o revisado recibido por WebSocket.'],failure_count:0}};
  if(provider!=='IGC-UP')return collectProvider(provider,prior[provider],fetcher,now);
  const result=await collect(fetcher,wait,prior[provider]?.upstream||old?.diagnostic?.upstream||{}),verified=new Date().toISOString();
  if(!result.not_modified)igcPlan=prepareMerge(sql,result.events,verified,now);
  return {state:{status:'success',checked_at_utc:checked,verified_at_utc:verified,fetched_at_utc:result.not_modified?prior[provider]?.fetched_at_utc||old?.catalog?.fetched_at_utc:verified,upstream:result.validators,http_status:result.http_status,bytes_read:result.bytes_read,logs:result.logs,failure_count:0,next_check_at_utc:new Date(now+60000).toISOString()}};
 }));
 for(let i=0;i<due.length;i++){
  const p=due[i],r=results[i];
  if(r.status==='fulfilled'){states[p]=r.value.state;if(p!=='IGC-UP')batches[p]=r.value;}
  else{const failure=(prior[p]?.failure_count||0)+1;states[p]={...prior[p],status:'failure',checked_at_utc:checked,failure_count:failure,reason:r.reason.code||null,http_status:r.reason.http_status??null,logs:r.reason.logs||[r.reason.message],next_check_at_utc:new Date(now+Math.min(600000,60000*2**Math.min(4,failure))).toISOString()};}
 }
 const multi=prepareMulti(sql,igcPlan?.events||viewStored(sql,now),batches,states,now);
 const healthy=Object.values(states).filter(s=>s.status==='success'&&now-Date.parse(s.verified_at_utc)<180000),latest=(field,fallback)=>Object.values(states).map(s=>s[field]).filter(Boolean).sort().at(-1)||fallback||null;
 const catalog={source:'IGC-UP · USGS · EMSC',source_url:'https://sismosgeociencias.up.ac.pa/',fetched_at_utc:latest('fetched_at_utc',old?.catalog?.fetched_at_utc),verified_at_utc:healthy.length?latest('verified_at_utc'):old?.catalog?.verified_at_utc,snapshot_only:!healthy.length&&!old?.catalog?.verified_at_utc,events:multi.events,sources:states,attribution:'IGC–UP; USGS; EMSC SeismicPortal (CC BY 4.0). La asociación entre catálogos es aproximada; no implica mediciones independientes.'};
 const status=healthy.length?'success':'failure',persistence={...(igcPlan?.stats||old?.diagnostic?.persistence||{}),...multi.stats,active_events:multi.events.length};
 if(states.EMSC)states.EMSC={...states.EMSC,stream:this.emscSocket?.readyState===1?'connected':'reconnecting'};
 const diagnostic={collector:'cloudflare',service:'durable-object',event:options.event||'alarm',status,partial_failure:Object.values(states).some(s=>s.status==='failure'),checked_at_utc:checked,fetched_at_utc:catalog.fetched_at_utc,verified_at_utc:catalog.verified_at_utc,event_count:catalog.events.length,sources:states,persistence,logs:Object.entries(states).flatMap(([p,s])=>[p+' · '+s.status+' · verificado: '+(s.verified_at_utc||'nunca'),...(s.logs||[])]),next_check_at_utc:new Date(now+60000).toISOString()};
 const revision=await eventRevision(catalog.events),snapshot={...await pack(catalog,diagnostic),revision};
 // A provider's first harvest is a baseline. Backfills, late IGC associations,
 // and revisions never become duplicate pushes for existing canonical events.
 const previousUIDs=new Set((old?.catalog?.events||[]).map(e=>e.uid));
 const added=multi.events.filter(e=>!previousUIDs.has(e.uid)&&(Object.keys(batches).some(p=>prior[p]?.checkpoint&&e.observations.some(o=>o.provider===p))||igcPlan?.added.some(a=>a.uid===e.uid)));
 const baseline=!!this.baselineReady;
 this.atomic(()=>{igcPlan?.apply();multi.apply();for(const p of due)saveProvider(sql,p,states[p]);this.save(snapshot);recordCheck(sql,diagnostic);if(status==='success')sql.exec('INSERT OR IGNORE INTO atlas_catalog_meta(key,value) VALUES(?,?)','push-baseline-v1',checked);});
 if(status==='success')this.baselineReady=true;
 const queued=baseline?await queueNewEvents(sql,old?.catalog?.events,added):0;
 this.broadcast(revision!==old?.revision?{type:'catalog',etag:snapshot.etag,revision,payload:{...catalog,collector:diagnostic}}:{type:'heartbeat',etag:snapshot.etag,revision,collector:diagnostic});
 const push=await dispatchPush(sql,this.env);
 if(queued||push.accepted||push.failed||push.expired||push.pending){const d={...diagnostic,push:{queued,...push}};this.atomic(()=>{this.save({...snapshot,diagnostic:d});recordCheck(sql,d);});}
 await this.ctx.storage.setAlarm(Date.now()+60000);
 console.log(JSON.stringify({event:'multi-source',status,event_count:catalog.events.length,compared:multi.stats.compared_events,sources:Object.fromEntries(Object.entries(states).map(([p,s])=>[p,s.status]))}));
}
