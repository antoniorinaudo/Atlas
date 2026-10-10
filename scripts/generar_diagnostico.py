#!/usr/bin/env python3
"""Publica solo metadatos de Actions y la salida del colector, sin credenciales."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_report(data, log, outcome, run_id, event):
    return {
        'checked_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'status': 'success' if outcome == 'success' else 'failure',
        'source_url': 'https://sismosgeociencias.up.ac.pa/',
        'fetched_at_utc': data.get('fetched_at_utc'),
        'event_count': len(data.get('events', [])),
        'run_id': run_id if str(run_id).isdigit() else None,
        'event': event[:60],
        'logs': log[-24000:].splitlines()[-100:],
    }


if __name__ == '__main__':
    data = json.loads((ROOT / 'sismos.json').read_text(encoding='utf-8'))
    log = (ROOT / 'actualizacion.log').read_text(encoding='utf-8', errors='replace')
    report = build_report(data, log, os.getenv('SYNC_OUTCOME', 'failure'),
                          os.getenv('GITHUB_RUN_ID', ''), os.getenv('GITHUB_EVENT_NAME', 'unknown'))
    report['trigger_schedule'] = os.getenv('ATLAS_TRIGGER_SCHEDULE', '') or None
    report['actor'] = os.getenv('GITHUB_ACTOR', '') or None
    report['workflow_ref'] = os.getenv('GITHUB_WORKFLOW_REF', '') or None
    report['commit_sha'] = os.getenv('GITHUB_SHA', '') or None
    temporary = ROOT / 'diagnostico.json.tmp'
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(ROOT / 'diagnostico.json')
