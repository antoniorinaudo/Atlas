"""Hermes script-only job: persist the IGC public channel, then upload pending revisions."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

INVITE = '0029VbAUotm2ZjCgDnlGAZ08'


def request_json(url, token, payload=None, timeout=120):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    request = Request(url, data=data, headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
        'User-Agent': 'Atlas-IGC-local-reader/1.0'})
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def collect(config_path):
    config = json.loads(config_path.read_text(encoding='utf-8-sig'))
    home = config_path.parent
    local = 'http://127.0.0.1:' + str(config['local_port'])
    try:
        status = request_json(local + '/status', config['local_token'], timeout=5)
    except OSError:
        with (home / 'reader.log').open('ab') as out, (home / 'reader-errors.log').open('ab') as err:
            subprocess.Popen([config['node_path'], config['reader_path'], str(config_path)],
                             stdout=out, stderr=err, stdin=subprocess.DEVNULL,
                             creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        status = {'state': 'starting'}
        for _ in range(60):
            time.sleep(2)
            try:
                status = request_json(local + '/status', config['local_token'], timeout=5)
            except OSError:
                continue
            if status['state'] in ('ready', 'qr', 'failure', 'auth_failure'):
                break
    if status['state'] in ('starting', 'authenticated'):
        for _ in range(60):
            time.sleep(2)
            status = request_json(local + '/status', config['local_token'], timeout=5)
            if status['state'] not in ('starting', 'authenticated'):
                break
    if status['state'] != 'ready':
        raise RuntimeError('WhatsApp requiere revisión local: ' + status['state'])
    channel = request_json(local + '/channel', config['local_token'])
    if channel.get('channel') != INVITE:
        raise RuntimeError('Respuesta de otro canal rechazada')
    checked = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(home / 'messages.sqlite3') as db:
        db.execute('CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, value TEXT NOT NULL, digest TEXT NOT NULL, acked_digest TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)')
        for message in channel['messages']:
            value = json.dumps(message, ensure_ascii=False, sort_keys=True)
            digest = hashlib.sha256(value.encode('utf-8')).hexdigest()
            db.execute('INSERT INTO messages(id,value,digest,first_seen,last_seen) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,digest=excluded.digest,last_seen=excluded.last_seen',
                       (message['id'], value, digest, checked, checked))
        db.commit()  # Persist before upload: network failures cannot lose observations.
        rows = db.execute('SELECT id,value,digest FROM messages WHERE acked_digest IS NULL OR acked_digest!=digest ORDER BY first_seen LIMIT 100').fetchall()
        if not config.get('ingest_url') or not config.get('ingest_token'):
            return {'status': 'saved_locally', 'read': len(channel['messages']), 'pending': len(rows), 'checked_at_utc': checked}
        totals = {'status': 'uploaded', 'read': len(channel['messages']), 'submitted': 0,
                  'acknowledged': 0, 'inserted': 0, 'revised': 0, 'incomplete': 0, 'checked_at_utc': checked}
        for _ in range(10):
            result = request_json(config['ingest_url'], config['ingest_token'], {
                'channel': INVITE, 'fetched_at_utc': channel['fetched_at_utc'],
                'read_count': len(channel['messages']),
                'messages': [json.loads(row[1]) for row in rows]})
            acknowledged = set(result.get('acknowledged_ids', []))
            for identifier, _, digest in rows:
                if identifier in acknowledged:
                    db.execute('UPDATE messages SET acked_digest=? WHERE id=? AND digest=?', (digest, identifier, digest))
            db.commit()
            totals['submitted'] += len(rows)
            totals['acknowledged'] += len(acknowledged)
            for key in ('inserted', 'revised', 'incomplete'):
                totals[key] += result.get(key, 0)
            if len(acknowledged) != len(rows):
                raise RuntimeError('Cloudflare no confirmó todo el lote; pendientes conservados')
            rows = db.execute('SELECT id,value,digest FROM messages WHERE acked_digest IS NULL OR acked_digest!=digest ORDER BY first_seen LIMIT 100').fetchall()
            if not rows:
                return totals
        raise RuntimeError('Se alcanzó el límite de lotes; pendientes conservados')


if __name__ == '__main__':
    home = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'hermes' / 'atlas-whatsapp'
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else home / 'config.json'
    try:
        result = collect(config_path)
        exit_code = 0
    except Exception as error:
        result = {'status': 'failure', 'checked_at_utc': datetime.now(timezone.utc).isoformat(),
                  'error': str(error)[:300]}
        exit_code = 1
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with (config_path.parent / 'harvest.jsonl').open('a', encoding='utf-8') as log:
        log.write(json.dumps(result, ensure_ascii=False) + '\n')
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(exit_code)
