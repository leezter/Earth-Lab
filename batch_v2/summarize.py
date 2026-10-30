"""Summarise completed evidence; never edits baked outputs."""
from pathlib import Path
import json,statistics
ROOT=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
new=read(ROOT/'report.json');old=read(ROOT.parent/'batch/report.json');previous={s['id']:s for s in old['sites']}
assert new.get('finished_utc')
browser=read(ROOT/'browser-verification.json');audit=read(ROOT/'audit.json');visual=read(ROOT/'visual-review.json')
out={'freeze':new['freeze'],'pipeline_hashes_unchanged':audit['pipeline_hashes_unchanged'],'manual_scene_edits':sum(s.get('manual_scene_edits',0)for s in new['sites']),'built':audit['technical_built'],'attempted':audit['attempted'],'driving_passes':sum(s.get('movement',False)for s in browser['results']),'screenshots':sum(s.get('screenshots',0)for s in browser['results']),'tile_bytes':sum(s.get('tile_bytes',0)for s in new['sites']),'median_build_seconds':statistics.median(s['total_seconds']for s in new['sites']if s['status']=='built'),'sites':[],'limits':['WorldCover 2021 is 10 m classification, not current street-level detail.','Canopy heights are modelled; tree positions and species are inferred.','Fixed 192 m areas; no terrain elevation or continuous streaming.','Desktop browser checks only; Android performance untested.','Technical checks and image review do not establish surveyed accuracy.']}
for s in new['sites']:
 p=previous[s['id']];out['sites'].append({'id':s['id'],'buildings':s.get('buildings'),'trees_v1':p.get('trees'),'trees_v2':s.get('trees'),'shrubs':s.get('shrubs'),'total_build_seconds':s.get('total_seconds'),'previous_build_seconds':p.get('total_seconds'),'raster':s.get('context',{}).get('raster'),'visual_review':visual.get(s['id'])})
(ROOT/'summary.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in out.items()if k!='sites'}))
