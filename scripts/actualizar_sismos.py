#!/usr/bin/env python3
"""Sincroniza el catálogo público IGC-UP al JSON de un sitio estático.
Sin paquetes adicionales ni credenciales. Fallos no sobrescriben la copia anterior.
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.client import IncompleteRead
from pathlib import Path

SOURCE = 'https://sismosgeociencias.up.ac.pa/'
OUT = Path(__file__).resolve().parents[1] / 'sismos.json'


class OfficialTableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.active_table = None
        self.active_row = None
        self.active_cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'table' and self.active_table is None:
            self.active_table = []
        elif tag == 'tr' and self.active_table is not None:
            self.active_row = []
        elif tag in ('td', 'th') and self.active_row is not None:
            self.active_cell = []
        elif tag == 'br' and self.active_cell is not None:
            self.active_cell.append(' ')

    def handle_data(self, data):
        if self.active_cell is not None:
            self.active_cell.append(data)

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.active_cell is not None and self.active_row is not None:
            self.active_row.append(' '.join(''.join(self.active_cell).split()))
            self.active_cell = None
        elif tag == 'tr' and self.active_row is not None and self.active_table is not None:
            if self.active_row:
                self.active_table.append(self.active_row)
            self.active_row = None
        elif tag == 'table' and self.active_table is not None:
            self.tables.append(self.active_table)
            self.active_table = None


def convert_time(value):
    val = re.sub(r'\s+', '', value).upper()
    ampm = re.fullmatch(r'(\d{1,2}):(\d{2}):(\d{2})(AM|PM)', val)
    if ampm:
        h, m, s, suffix = ampm.groups()
        h24 = int(h) % 12 + (12 if suffix == 'PM' else 0)
        return f'{h24:02}:{m}:{s}'
    if re.fullmatch(r'\d{2}:\d{2}:\d{2}', val):
        return val
    raise ValueError(f'Hora no reconocida: {value}')


def parse(html_text):
    parser = OfficialTableParser()
    parser.feed(html_text)
    table = next((t for t in parser.tables if any(
        'latitud' in ' '.join(r).lower() and 'longitud' in ' '.join(r).lower() and
        'magnitud' in ' '.join(r).lower() and 'fecha' in ' '.join(r).lower()
        for r in t[:4])), None)
    if table is None:
        raise ValueError('La página no tiene una tabla reconocible de sismos')
    events, seen = [], set()
    for cells in table:
        if len(cells) < 8 or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', cells[1]):
            continue
        try:
            date = cells[1]
            datetime.strptime(date, '%Y-%m-%d')
            time = convert_time(cells[2])
            lat, lon = float(cells[3].replace(',', '.')), float(cells[4].replace(',', '.'))
            depth = float(re.sub(r'\s*(?:km|kil[oó]metros?)\s*$', '', cells[5], flags=re.I).replace(',', '.'))
            mag = float(cells[6].replace(',', '.'))
            if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= depth <= 800 and 0 <= mag <= 10):
                continue
            region = re.sub(r'^Localizado en\s*', '', cells[7], flags=re.I).strip()[:240]
            key = (date, time, round(lat, 5), round(lon, 5))
            if key in seen:
                continue
            seen.add(key)
            events.append(dict(status=cells[0].strip().upper()[:40],date=date,time=time,
                               displayTime=cells[2],lat=lat,lon=lon,depth=depth,
                               mag=mag,region=region or 'Región sin descripción'))
        except (ValueError, IndexError):
            continue
    if not events:
        raise ValueError('No se pudo extraer ningún sismo; no se sobrescribió el JSON anterior')
    events.sort(key=lambda e: (e['date'], e['time']), reverse=True)
    for i, e in enumerate(events, 1):
        e['id'] = i
    return events


def download_events(attempts=3):
    request = urllib.request.Request(SOURCE,headers={
        'User-Agent': 'Mozilla/5.0 (compatible; AtlasSismicoPanama/1.0; public data collector)',
        'Accept': 'text/html,application/xhtml+xml',
        'Cache-Control': 'no-cache',
    })
    for attempt in range(1, attempts + 1):
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=25) as resp:
                charset = resp.headers.get_content_charset() or 'utf-8'
                raw = resp.read(5_000_001)
                if len(raw) > 5_000_000:
                    raise ValueError('La respuesta oficial supera el límite de 5 MB')
                events = parse(raw.decode(charset, errors='replace'))
            print(f'GET oficial: intento {attempt}/{attempts}, '
                  f'{time.monotonic() - started:.1f}s, {len(events)} sismos', flush=True)
            return events
        except urllib.error.HTTPError as exc:
            if exc.code not in (408, 429, 500, 502, 503, 504):
                raise
            error = exc
        except (OSError, IncompleteRead) as exc:
            error = exc
        if attempt == attempts:
            raise error
        delay = 2 ** attempt
        print(f'GET oficial: intento {attempt}/{attempts} falló ({error}); '
              f'reintento en {delay}s', file=sys.stderr, flush=True)
        time.sleep(delay)


def main():
    events = download_events()
    document = {'source':'IGC-UP','source_url':SOURCE,
                'fetched_at_utc':datetime.now(timezone.utc).isoformat(timespec='seconds'),
                'snapshot_only':False,'events':events}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',
                                     dir=OUT.parent,suffix='.tmp',delete=False) as tmp:
        json.dump(document,tmp,ensure_ascii=False,separators=(',', ':'))
        tmp.write('\n')
        filename=tmp.name
    Path(filename).replace(OUT)
    print(f'Guardados {len(events)} sismos en {OUT}; {document["fetched_at_utc"]}')

if __name__=='__main__':
    if '--fixture' in sys.argv:
        print('TEST',len(parse(Path(sys.argv[sys.argv.index('--fixture')+1]).read_text(encoding='utf-8'))))
    else:
        try:
            main()
        except (OSError, ValueError) as exc:
            print(f'ERROR: no se actualizó el catálogo; se conserva la copia anterior. {exc}',
                  file=sys.stderr)
            sys.exit(1)
