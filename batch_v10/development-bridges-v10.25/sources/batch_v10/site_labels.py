"""Readable display metadata, independent of frozen scene/cache identities."""
import json
import re
from pathlib import Path
import place_search

ROOT=Path(__file__).resolve().parent

def labelled(job):
    if job.get('status')!='built' or not re.match(r'^(Map location |[-+]?\d+\.?\d*\s*,)',job.get('name','')):
        return job
    path=ROOT/'custom'/job['id']/'display-name.json'
    try:
        if path.exists():
            label=json.loads(path.read_text(encoding='utf-8'))['label']
        else:
            label=place_search.reverse(job.get('actual_lat',job['lat']),job.get('actual_lon',job['lon']))
            if not label:return job
            path.write_text(json.dumps({'label':label,'source':'Photon / OpenStreetMap','coordinates':[job.get('actual_lat',job['lat']),job.get('actual_lon',job['lon'])]},ensure_ascii=False),encoding='utf-8')
        return {**job,'name':label}
    except Exception:
        # Naming failures must never prevent driving or change build status.
        return job
