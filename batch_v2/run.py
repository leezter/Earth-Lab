"""Frozen six-location experiment. Never tunes a scene after seeing its render."""
from pathlib import Path
import sys,json,hashlib,subprocess,time,datetime,math,traceback
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(REPO))
import scene_builder
from shapely.geometry import LineString,Point
from shapely.ops import nearest_points
SITES=json.loads((ROOT/'sites.json').read_text())
FILES=['batch_v2/scene_builder.py','batch_v2/landcover.py','batch_v2/prepare.py','batch_v2/bake.py','batch_v2/tiles.py','batch_v2/run.py','batch_v2/sites.json','assets/materials/batch-manifest.json']
def digest():return {f:hashlib.sha256((REPO/f).read_bytes()).hexdigest()for f in FILES}
freeze={'id':'six-settings-v2','created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_hashes':digest(),'render_pixels':6144,'metres':192,'samples':48,'manual_scene_tuning':False,'acceptance':'Data/geometry/browser gates plus a separate visual review. Export success is not visual acceptance.'}
fp=ROOT/'freeze.json'
if fp.exists():
 freeze=json.loads(fp.read_text());assert freeze['source_hashes']==digest(),'Frozen pipeline changed. Start an explicitly new experiment version.'
else:fp.write_text(json.dumps(freeze,indent=2))
report={'freeze':freeze['id'],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sites':[dict(site,status='pending')for site in SITES]}
def save():
 temp=ROOT/'report.tmp';temp.write_text(json.dumps(report,indent=2));temp.replace(ROOT/'report.json')
def log(*args):print(*args,flush=True)
def step(cmd,run,name,timeout=900):
 with (run/(name+'.log')).open('w')as out:p=subprocess.run(cmd,cwd=REPO,stdout=out,stderr=subprocess.STDOUT,timeout=timeout)
 if p.returncode:raise RuntimeError(name+' failed: '+(run/(name+'.log')).read_text(errors='replace')[-1300:])
def centred(site):
 lat,lon=site['lat'],site['lon'];raw=scene_builder.baseline.features(lat,lon);scale=math.cos(math.radians(lat))*111319.490793;best=None
 for r in raw['roads']:
  if r['class']in ['footway','path','cycleway','steps','pedestrian','bridleway']:continue
  for part in r['parts']:
   for line in part:
    if len(line)<2:continue
    shape=LineString([((p[0]-lon)*scale,-(p[1]-lat)*111319.490793)for p in line]);p=nearest_points(Point(0,0),shape)[1];dist=p.distance(Point(0,0))
    if best is None or dist<best[0]:best=(dist,p.x,p.y)
 if best is None or best[0]>1500:raise RuntimeError('No driving road within 1.5 km of requested place')
 return lat-best[2]/111319.490793,lon+best[1]/scale,best[0]
save()
for entry in report['sites']:
 assert digest()==freeze['source_hashes'],'Frozen source changed during the experiment'
 run=ROOT/'runs'/entry['id'];run.mkdir(parents=True,exist_ok=True);start=time.monotonic();entry['status']='fetching';save();log('START',entry['id'])
 try:
  lat,lon,distance=centred(entry);entry.update({'actual_lat':lat,'actual_lon':lon,'automatic_road_snap_metres':distance});d=scene_builder.scene(lat,lon);d['scene']['bake']={'tile_url':'/baked/'+entry['id']+'/','origin':[lat,lon]};(run/'district-data.json').write_text(json.dumps(d,separators=(',',':')))
  entry['context']=d['scene']['context'];entry['status']='preparing';save();step([sys.executable,str(ROOT/'prepare.py'),str(run)],run,'prepare',300)
  geo=json.loads((run/'geometry.json').read_text());entry['buildings']=len(geo['buildings']);entry['trees']=len(geo['trees']);entry['shrubs']=len(geo.get('shrubs',[]));entry['roads']=len(d['roads'])
  for b in geo['buildings']:
   assert all(math.isfinite(v)for p in b['mesh']['vertices']for v in p),'Nonfinite building geometry'
  assert geo['flat']['roads']['faces'],'No road geometry in selected scene'
  entry['status']='baking';save();log('BAKE',entry['id'],entry['buildings'],'buildings',entry['trees'],'trees',entry['context'])
  step([str(REPO/'tools/blender-4.5.14-windows-x64/blender.exe'),'--background','--factory-startup','--python-exit-code','1','--python',str(ROOT/'bake.py'),'--','--work-dir',str(run)],run,'bake',1200)
  bake=json.loads((run/'bake-report.json').read_text());assert bake['pixels']==6144
  entry['status']='tiling';save();step([sys.executable,str(ROOT/'tiles.py'),str(run)],run,'tiles',300)
  tiles=json.loads((run/'baked/manifest.json').read_text());entry.update({'status':'built','total_seconds':time.monotonic()-start,'bake_seconds':bake['seconds'],'tile_bytes':sum(f['bytes']for f in tiles['files']),'tile_manifest_sha256':hashlib.sha256((run/'baked/manifest.json').read_bytes()).hexdigest(),'visual_status':'not_reviewed','manual_scene_edits':0})
  log('BUILT',entry['id'],round(entry['total_seconds'],1),'seconds')
 except Exception as e:
  entry.update(status='failed',error=str(e),total_seconds=time.monotonic()-start,visual_status='not_reviewed',manual_scene_edits=0);(run/'failure.txt').write_text(traceback.format_exc());log('FAILED',entry['id'],str(e))
 save()
report['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();report['source_hashes_unchanged']=digest()==freeze['source_hashes'];save();log('BATCH COMPLETE',[(e['id'],e['status'])for e in report['sites']])
