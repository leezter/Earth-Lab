"""Verify delivered shaders, tile hashes and retained roof/building geometry."""
from pathlib import Path
import json,hashlib
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
freeze=read(ROOT/'freeze.json')
for name,h in freeze['source_hashes'].items():assert hashlib.sha256((REPO/name).read_bytes()).hexdigest()==h,name
job=next(d for p in (ROOT/'custom').glob('*/job.json')if(d:=read(p)).get('renderer_freeze')==freeze['id'])
folder=ROOT/'custom'/job['id'];manifest=read(folder/'baked/manifest.json')
for t in manifest['files']:assert hashlib.sha256((folder/'baked/tiles'/t['name']).read_bytes()).hexdigest()==t['sha256']
old=read(REPO/'batch_v3/custom/place-725fac0c5ab64749/geometry.json');new=read(folder/'geometry.json')
assert old['buildings']==new['buildings'],'Building geometry changed'
assert read(REPO/'batch_v3/custom/place-725fac0c5ab64749/roof-finishes.json')==read(folder/'roof-finishes.json'),'Roof appearance rules changed'
from shapely.geometry import Polygon
from shapely.ops import unary_union
def shape(parts):return unary_union([Polygon(p[0],p[1:]).buffer(0)for p in parts])
road_delta=shape(old['roads']).symmetric_difference(shape(new['roads'])).area
assert road_delta<.1,('Changed driving footprint',road_delta)
report={'renderer':freeze['id'],'source_hashes_verified':True,'tiles_verified':len(manifest['files']),'tile_bytes':sum(t['bytes']for t in manifest['files']),'buildings_unchanged':True,'roof_finishes_unchanged':True,'driving_footprint_difference_m2':road_delta,'trees_unchanged':old['trees']==new['trees'],'compiled_sample_locations':len(read(ROOT/'six-location-data-audit.json')),'material_families':13,'in_game_visual_review':'Kreuzberg only; all families also shown on the material sheet'}
(ROOT/'audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
