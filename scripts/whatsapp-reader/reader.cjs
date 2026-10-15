const {Client, LocalAuth} = require('whatsapp-web.js');
const QRCode = require('qrcode');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {timingSafeEqual, createHash} = require('node:crypto');

const configPath = process.argv[2];
if (!configPath || !path.isAbsolute(configPath)) throw Error('Ruta absoluta de configuración requerida');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!/^[a-f0-9]{64}$/i.test(config.local_token)) throw Error('Token local inválido');
const setupToken = createHash('sha256').update(config.local_token + ':setup').digest('hex');
const INVITE = '0029VbAUotm2ZjCgDnlGAZ08';
let state = 'starting', qrImage = null, failure = null, reading = null;
const client = new Client({
  authStrategy: new LocalAuth({clientId: 'atlas-igc', dataPath: path.join(path.dirname(configPath), 'session')}),
  puppeteer: {headless: true, executablePath: config.browser_path},
  authTimeoutMs: 120000,
  qrMaxRetries: 0,
  deviceName: 'Atlas IGC lector local',
  browserName: 'Chrome',
  webVersionCache: {type: 'none'}
});
const log = (event, extra = {}) => console.log(JSON.stringify({at: new Date().toISOString(), event, ...extra}));
// Recent WhatsApp versions can finish synchronization before wwebjs attaches
// its hasSynced edge listener. Our read-only path needs the synced socket and
// helpers, independently of the library's unrelated chat event listeners.
setInterval(async () => {
  if (!['authenticated', 'starting'].includes(state) || !client.pupPage) return;
  try {
    const synced = await client.pupPage.evaluate(() => {
      const socket = window.require('WAWebSocketModel').Socket;
      return socket.hasSynced && socket.state === 'CONNECTED' && !!window.WWebJS;
    });
    if (synced) {state = 'ready'; failure = null; qrImage = null; log('ready-synced');}
  } catch { /* The page is still navigating or awaiting authentication. */ }
}, 5000).unref();
client.on('qr', async qr => {qrImage = await QRCode.toDataURL(qr, {width: 320, margin: 2}); state = 'qr'; failure = null; log('qr-ready');});
client.on('authenticated', () => {if (state === 'ready') return; if (state !== 'authenticated') log('authenticated'); state = 'authenticated'; qrImage = null;});
client.on('ready', () => {state = 'ready'; qrImage = null; failure = null; log(state);});
client.on('auth_failure', () => {state = 'auth_failure'; failure = 'WhatsApp rechazó la vinculación'; log(state);});
client.on('disconnected', () => {state = 'disconnected'; failure = 'Sesión desconectada; revisar la vinculación'; log(state);});

async function readChannel() {
  if (state !== 'ready') throw Error('Lector no preparado: ' + state);
  if (reading) return reading;
  reading = (async () => {
    const modulePath = require.resolve('./read-channel.cjs');
    delete require.cache[modulePath];
    const {name, messages} = await require(modulePath)(client, INVITE);
    log('channel-read', {count: messages.length});
    return {channel: INVITE, name, fetched_at_utc: new Date().toISOString(), messages};
  })().finally(() => {reading = null;});
  return reading;
}

const setupHTML = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Vincular lector del Atlas</title><style>body{font:16px system-ui;background:#081b25;color:#e9f5f5;max-width:620px;margin:40px auto;padding:24px}h1{font-size:26px}p{line-height:1.6}img{display:block;border-radius:14px;max-width:100%}#state{color:#83dfce}small{color:#abc4cd}</style><h1>Atlas Sísmico Panamá</h1><p>Vincula el lector local: abre WhatsApp en tu teléfono → <b>Dispositivos vinculados → Vincular un dispositivo</b> y escanea este QR.</p><p id="state">Preparando WhatsApp Web…</p><img id="qr" hidden alt="QR para vincular el lector local"><p><button id="renew" onclick="renew()">Renovar QR</button></p><p><small>El lector consultará únicamente el canal público del Instituto de Geociencias UP. No envía mensajes. La sesión queda en esta computadora.</small></p><script>async function renew(){await fetch('/renew'+location.search,{method:'POST'});}async function poll(){try{const r=await fetch('/status'+location.search,{cache:'no-store'});const s=await r.json();document.getElementById('state').textContent=s.state==='ready'?'✓ Vinculado. El lector está preparado.':s.failure||({qr:'Escanea el QR con tu teléfono.',authenticated:'Vinculado. Preparando la lectura…',starting:'Preparando WhatsApp Web…'}[s.state]||s.state);document.getElementById('renew').hidden=['ready','authenticated'].includes(s.state);const q=document.getElementById('qr');q.hidden=!s.qr;if(s.qr)q.src=s.qr;}catch{document.getElementById('state').textContent='Lector desconectado.';}setTimeout(poll,2000)}poll();</script></html>`;
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') || url.searchParams.get('key') || '');
  const setupPath = ['/setup', '/status', '/renew'].includes(url.pathname);
  const expected = Buffer.from(setupPath && supplied.toString() === setupToken ? setupToken : config.local_token);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (code, data) => {res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'}); res.end(JSON.stringify(data));};
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, {error: 'Acceso local no autorizado'});
  if (req.method === 'POST' && url.pathname === '/renew') {
    if (['ready', 'authenticated'].includes(state)) return reply(409, {error: 'La sesión ya está vinculada'});
    await client.destroy().catch(() => {}); state = 'starting'; qrImage = null; failure = null;
    reply(200, {state}); initialize(); return;
  }
  if (req.method === 'POST' && url.pathname === '/shutdown') {
    reply(200, {status: 'stopping'}); await client.destroy(); process.exit(0); return;
  }
  if (req.method !== 'GET') return reply(405, {error: 'Solo lectura'});
  if (url.pathname === '/setup') {res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); return res.end(setupHTML);}
  if (url.pathname === '/status') return reply(200, {state, failure, qr: qrImage});
  if (url.pathname === '/compat' && state === 'ready') {
    try {return reply(200, await client.pupPage.evaluate(() => {
      const modules = {};
      for (const name of ['WAWebNewsletterModelUtils','WAWebNewsletterMetadataQueryJob','WAWebNewsletterRoleUtils']) {
        try {modules[name] = Object.keys(window.require(name));} catch {modules[name] = 'unavailable';}
      }
      const cached = window.require('WAWebCollections').WAWebNewsletterCollection.getModelsArray();
      const selected = cached.filter(c => /Instituto de Geociencias UP/i.test(c.name || c.formattedTitle || c.newsletterMetadata?.name || c.newsletterMetadata?.titleMetadata?.title || ''));
      return {modules, target: selected.map(c => ({id: c.id?._serialized, fields: Object.keys(c.serialize())}))};
    }));} catch(error) {return reply(503, {error: error.message});}
  }
  if (url.pathname !== '/channel') return reply(404, {error: 'Ruta no encontrada'});
  try {reply(200, await readChannel());} catch (error) {log('read-failed', {error: error.message}); reply(503, {error: error.message});}
}).listen(config.local_port || 38741, '127.0.0.1', () => log('listening'));
async function initialize() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {await client.initialize(); return;} catch (error) {
      failure = String(error.message).slice(0, 250);
      log('init-failed', {attempt, error: failure});
      await client.destroy().catch(() => {});
      if (attempt < 3 && /Execution context was destroyed|detached Frame|Session closed/i.test(failure)) {
        await new Promise(resolve => setTimeout(resolve, 2000)); continue;
      }
      state = 'failure'; return;
    }
  }
}
initialize();
process.on('SIGTERM', async () => {await client.destroy(); process.exit(0);});
