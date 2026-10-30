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
 raster=s['context']['raster'];assert abs(sum(raster['class_fractions'].values())-1)<1e-6
 assert 0<=raster['canopy_valid_fraction']<=1 and 0<=raster['landcover_valid_fraction']<=1
 assert all(3<=t['height']<=35 and math.isfinite(t['height'])for t in geo['trees'])
 from shapely.geometry import Polygon,Point
 from shapely.ops import unary_union
 scene=json.loads((p/'district-data.json').read_text())['scene']
 old=json.loads((REPO/'batch/runs'/s['id']/'district-data.json').read_text())['scene']
 assert all(scene[k]==old[k]for k in ['origin','roads','pavements']), 'Changed mapped driving geometry'
 assert [(b['id'],b['parts'])for b in scene['buildings']]==[(b['id'],b['parts'])for b in old['buildings']], 'Changed mapped footprints'
 normalizations=[]
 def polygons(parts):
  shapes=[]
  for part in parts:
   g=Polygon(part[0],part[1:])
   if not g.is_valid:
    fixed=g.buffer(0);delta=abs(g.area-fixed.area)
    assert delta<.01,('Nontrivial invalid exported ring',delta)
    normalizations.append(delta);g=fixed
   shapes.append(g)
  return unary_union(shapes)
 roads=polygons(scene['roads']);walks=polygons(scene['pavements']);water=polygons(scene['water'])
 solids=unary_union([polygons(b['parts'])for b in scene['buildings']])
 blocked=unary_union([roads,walks,water,solids])
 overlap=sum(polygons(parts).intersection(blocked).area for parts in scene['landcover'].values());assert overlap<1,('Raster painted over vector geometry',overlap)
 assert all(not blocked.contains(Point(t['x'],t['y']))for t in geo['trees'])
 out.append({'id':s['id'],'built':True,'tiles_verified':9,'geometry_finite':True,'roads_pavements_footprints_unchanged':True,'raster_vector_overlap_m2':overlap,'analysis_only_ring_normalization_count':len(normalizations),'analysis_only_ring_normalization_area_m2':sum(normalizations),'tree_centres_clear':True,'canopy_heights_bounded':True,'landcover_coverage':raster['landcover_valid_fraction'],'canopy_coverage':raster['canopy_valid_fraction'],'manual_scene_edits':s['manual_scene_edits']})
report={'pipeline_hashes_unchanged':True,'material_checksums_verified':sum(len(a['files'])for a in assets),'configured_material_sets':len(assets),'sites':out,'technical_built':sum(s['status']=='built'for s in r['sites']),'attempted':len(r['sites'])}
(ROOT/'audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
