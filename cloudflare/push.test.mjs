import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initPush,pushAPI,queueNewEvents,dispatchPush,newPublishedEvents,sendPush} from './push.mjs';
const origin='https://antoniorinaudo.github.io';
const b64=bytes=>Buffer.from(bytes).toString('base64url');
async function setup(){
 const db=new DatabaseSync(':memory:'),sql={exec(query,...params){const statement=db.prepare(query),rows=statement.columns().length?statement.all(...params):(statement.run(...params),[]);return{toArray:()=>rows};}};initPush(sql);
 const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',signing.privateKey);
 const env={VAPID_PUBLIC_KEY:b64(await crypto.subtle.exportKey('raw',signing.publicKey)),VAPID_PRIVATE_KEY:jwk.d,VAPID_SUBJECT:origin+'/Atlas/'};
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:b64(await crypto.subtle.exportKey('raw',receiver.publicKey)),auth:b64(crypto.getRandomValues(new Uint8Array(16)))}};
 const req=(path,body,extra={})=>new Request('https://atlas.test/push/'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});
 return{sql,env,subscription,req,signing};
}
const event=(time='12:00:00',mag=4)=>({date:'2026-10-10',time,lat:7.5,lon:-80.5,mag,depth:8,region:'Panamá: Tonosí'});
test('Solo acepta suscripciones y magnitudes válidas del origen autorizado; protege cambios y bajas',async()=>{
 const{sql,env,subscription,req}=await setup();
 assert.equal((await pushAPI(req('subscribe',{subscription,minMagnitude:4},{Origin:'https://other.test'}),sql,env)).status,403);
 assert.equal((await pushAPI(req('subscribe',{subscription:{...subscription,endpoint:'https://127.0.0.1/private'},minMagnitude:4}),sql,env)).status,400);
 assert.equal((await pushAPI(req('subscribe',{subscription,minMagnitude:100}),sql,env)).status,400);
 let r=await pushAPI(req('subscribe',{subscription,minMagnitude:4}),sql,env);assert.equal(r.status,200);const record=await r.json();
 r=await pushAPI(req('subscribe',{subscription,minMagnitude:5,token:record.token}),sql,env);assert.equal((await r.json()).token,record.token);assert.equal(sql.exec('SELECT min_mag FROM push_subscriptions').toArray()[0].min_mag,5);
 assert.equal((await pushAPI(req('unsubscribe',{id:record.id,token:'bad'}),sql,env)).status,403);
 assert.equal((await pushAPI(req('unsubscribe',{id:record.id,token:record.token}),sql,env)).status,200);assert.equal(sql.exec('SELECT * FROM push_subscriptions').toArray().length,0);
});
test('No avisa la carga inicial, revisiones o rellenos históricos; aplica magnitud y deduplica la cola',async()=>{
 const{sql,env,subscription,req}=await setup(),now=Date.parse('2026-10-10T17:05:00Z');
 await pushAPI(req('subscribe',{subscription,minMagnitude:5}),sql,env);
 assert.deepEqual(newPublishedEvents(null,[event()],now),[]);
 assert.deepEqual(newPublishedEvents([event()],[event('12:00:00',6),event('11:00:00',7)],now),[]);
 assert.equal(await queueNewEvents(sql,[event()],[event(),event('12:01:00',4.9)],now),0);
 const after=[event(),event('12:01:00',5.5)];assert.equal(await queueNewEvents(sql,[event()],after,now),1);await queueNewEvents(sql,[event()],after,now);
 const rows=sql.exec('SELECT * FROM push_outbox').toArray();assert.equal(rows.length,1);assert.match(JSON.parse(rows[0].payload).title,/5.5/);assert.match(JSON.parse(rows[0].payload).body,/Aviso informativo/);
});
test('Cifra el mensaje y firma VAPID; reintenta fallos y elimina suscripciones caducadas',async()=>{
 const{sql,env,subscription,req,signing}=await setup();let captured;
 assert.equal(await sendPush(subscription,{title:'prueba'},env,async(url,payload)=>{captured=payload;return new Response('',{status:201});}),201);
 assert.equal(captured.headers['content-encoding'],'aes128gcm');assert(!Buffer.from(captured.body).includes(Buffer.from('prueba')));
 const jwt=captured.headers.authorization.match(/t=([^,]+)/)[1],parts=jwt.split('.');const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
 assert.equal(claims.aud,'https://fcm.googleapis.com');assert(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},signing.publicKey,Buffer.from(parts[2],'base64url'),Buffer.from(parts[0]+'.'+parts[1])));
 await pushAPI(req('subscribe',{subscription,minMagnitude:4}),sql,env);const now=Date.parse('2026-10-10T17:05:00Z');await queueNewEvents(sql,[event()],[event(),event('12:01:00',5)],now);
 let result=await dispatchPush(sql,env,async()=>new Response('',{status:503}),now);assert.equal(result.failed,1);assert.equal(result.pending,1);
 result=await dispatchPush(sql,env,async()=>new Response('',{status:201}),now+61000);assert.equal(result.accepted,1);assert.equal(result.pending,0);
 await queueNewEvents(sql,[event()],[event(),event('12:02:00',5)],now);result=await dispatchPush(sql,env,async()=>new Response('',{status:410}),now);assert.equal(result.expired,1);assert.equal(sql.exec('SELECT * FROM push_subscriptions').toArray().length,0);
});
test('La prueba solo llega al dispositivo autenticado y limita las repeticiones',async()=>{
 const{sql,env,subscription,req}=await setup(),record=await (await pushAPI(req('subscribe',{subscription,minMagnitude:4}),sql,env)).json();let sent=0;
 const sender=async()=>{sent++;return new Response('',{status:201});};
 assert.equal((await pushAPI(req('test',{id:record.id,token:'bad'}),sql,env,sender)).status,403);assert.equal(sent,0);
 assert.equal((await pushAPI(req('test',record),sql,env,sender)).status,200);assert.equal(sent,1);
 assert.equal((await pushAPI(req('test',record),sql,env,sender)).status,429);assert.equal(sent,1);
});
