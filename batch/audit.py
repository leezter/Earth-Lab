"""Verify the frozen experiment and tiles without changing any scene."""
from pathlib import Path
import json,hashlib,math,sys
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent
r=json.loads((ROOT/'report.json').read_text());f=json.loads((ROOT/'freeze.json').read_text());assert r.get('finished_utc'),'Batch still running'
for name,digest in f['source_hashes'].items():assert hashlib.sha256((REPO/name).read_bytes()).hexdigest()==digest,name
assets=json.loads((REPO/'assets/materials/batch-manifest.json').read_text(encoding='utf-8-sig'))
for a in assets:
 for file in a['files']:assert hashlib.md5((REPO/file['path']).read_bytes()).hexdigest()==file['md5']
out=[]
for s in r['sites']:
 if s['status']!='built':out.append({'id':s['id'],'built':False,'reason':s.get('error')});continue
 p=ROOT/'runs'/s['id'];m=json.loads((p/'baked/manifest.json').read_text());assert len(m['files'])==9 and m['pixels_per_metre']==32
 for t in m['files']:assert hashlib.sha256((p/'baked/tiles'/t['name']).read_bytes()).hexdigest()==t['sha256']
 geo=json.loads((p/'geometry.json').read_text());assert geo['flat']['roads']['faces']
 assert all(math.isfinite(v)for b in geo['buildings']for xyz in b['mesh']['vertices']for v in xyz)
 out.append({'id':s['id'],'built':True,'tiles_verified':9,'geometry_finite':True,'manual_scene_edits':s['manual_scene_edits']})
report={'pipeline_hashes_unchanged':True,'material_checksums_verified':sum(len(a['files'])for a in assets),'configured_material_sets':len(assets),'sites':out,'technical_built':sum(s['status']=='built'for s in r['sites']),'attempted':len(r['sites'])}
(ROOT/'audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
