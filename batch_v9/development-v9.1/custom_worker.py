"""Generate one selected location with the frozen street-details v9 renderer."""
from pathlib import Path
import sys,json,hashlib,subprocess,time,math,traceback
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT.parent))
import custom_places as jobs
import scene_builder
from job_validation import validate_parking
from shapely.geometry import LineString,Point
from shapely.ops import nearest_points
from street_features import DRIVE
folder=jobs.directory(sys.argv[1]);path=folder/'job.json';d=jobs.read(path);start=time.monotonic()
def phase(state):d['status']=state;jobs.save(path,d)
def step(cmd,name):
 phase(name)
 with (folder/(name+'.log')).open('w')as log:r=subprocess.run(cmd,cwd=ROOT.parent,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
 if r.returncode:raise RuntimeError(name+' failed; check '+name+'.log')
try:
 freeze=jobs.read(ROOT/'freeze.json')
 if d['id']!=jobs.identifier(d['lat'],d['lon'])or d.get('renderer_freeze')!=freeze['id']:
  raise ValueError('Renderer changed before this job started. Resubmit the location for the current edition.')
 for f,h in freeze['source_hashes'].items():assert hashlib.sha256((ROOT.parent/f).read_bytes()).hexdigest()==h,f'Renderer differs from {freeze["id"]}: {f}'
 phase('finding road');lat,lon=d['lat'],d['lon'];raw=scene_builder.baseline.features(lat,lon);scale=111319.490793*math.cos(math.radians(lat));best=None
 for road in raw['roads']:
  if road['class']not in DRIVE:continue
  for part in road['parts']:
   for line in part:
    if len(line)<2:continue
    g=LineString([((p[0]-lon)*scale,-(p[1]-lat)*111319.490793)for p in line]);p=nearest_points(Point(0,0),g)[1];dist=p.distance(Point(0,0))
    if best is None or dist<best[0]:best=(dist,p.x,p.y)
 if best is None or best[0]>1500:raise ValueError('No mapped driving road found within 1.5 km. Try a nearby street.')
 lat-=best[2]/111319.490793;lon+=best[1]/scale;d.update(actual_lat=lat,actual_lon=lon,automatic_road_snap_metres=best[0]);phase('fetching map and vegetation')
 data=scene_builder.scene(lat,lon);validate_parking(data['scene']);data['scene']['bake']={'tile_url':'/baked/'+d['id']+'/','origin':[lat,lon]}
 (folder/'pavement-inputs.json').write_text(json.dumps(data.pop('pavement_inputs'),separators=(',',':')),encoding='utf-8')
 (folder/'pavement-report.json').write_text(json.dumps(data['scene']['pavement_report'],indent=2),encoding='utf-8')
 (folder/'site-report.json').write_text(json.dumps(data['scene']['site_report'],indent=2),encoding='utf-8')
 (folder/'street-report.json').write_text(json.dumps(data['scene']['street_report'],indent=2),encoding='utf-8')
 for report in ('parking_report','geometry_report','mobility_report','access_report','furniture_report'):
  (folder/(report.replace('_','-')+'.json')).write_text(json.dumps(data['scene'][report],indent=2),encoding='utf-8')
 (folder/'district-data.json').write_text(json.dumps(data,separators=(',',':')))
 step([sys.executable,str(ROOT/'prepare.py'),str(folder)],'preparing geometry')
 step([str(ROOT.parent/'tools/blender-4.5.14-windows-x64/blender.exe'),'--background','--factory-startup','--python-exit-code','1','--python',str(ROOT/'bake.py'),'--','--work-dir',str(folder)],'rendering')
 step([sys.executable,str(ROOT/'tiles.py'),str(folder)],'optimising tiles')
 manifest=jobs.read(folder/'baked/manifest.json');assert len(manifest['files'])==9
 for t in manifest['files']:assert hashlib.sha256((folder/'baked/tiles'/t['name']).read_bytes()).hexdigest()==t['sha256']
 d.update(total_seconds=time.monotonic()-start,renderer_freeze=freeze['id'],pavement_sources=data['scene']['pavement_report']['sources'],site_summary={k:data['scene']['site_report'][k]for k in ['area_m2','boundaries','boundary_kinds','gates']});phase('built')
 # Keep playable tiles and provenance; discard the large reproducible intermediate PNG.
 (folder/'baked/street-6144.png').unlink(missing_ok=True)
except Exception as e:
 d.update(error=str(e));phase('failed');(folder/'failure.txt').write_text(traceback.format_exc());raise
