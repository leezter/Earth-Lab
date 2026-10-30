"""Generate one selected location with the roof-variety v3 renderer."""
from pathlib import Path
import sys,json,hashlib,subprocess,time,math,traceback
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT.parent))
import custom_places as jobs
import scene_builder
from shapely.geometry import LineString,Point
from shapely.ops import nearest_points
folder=jobs.directory(sys.argv[1]);path=folder/'job.json';d=jobs.read(path);start=time.monotonic()
def phase(state):d['status']=state;jobs.save(path,d)
def step(cmd,name):
 phase(name)
 with (folder/(name+'.log')).open('w')as log:r=subprocess.run(cmd,cwd=ROOT.parent,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
 if r.returncode:raise RuntimeError(name+' failed; check '+name+'.log')
try:
 freeze=jobs.read(ROOT/'freeze.json')
 for f,h in freeze['source_hashes'].items():assert hashlib.sha256((ROOT.parent/f).read_bytes()).hexdigest()==h,'Renderer differs from frozen v3'
 phase('finding road');lat,lon=d['lat'],d['lon'];raw=scene_builder.baseline.features(lat,lon);scale=111319.490793*math.cos(math.radians(lat));best=None
 for road in raw['roads']:
  if road['class']in ['footway','path','cycleway','steps','pedestrian','bridleway']:continue
  for part in road['parts']:
   for line in part:
    if len(line)<2:continue
    g=LineString([((p[0]-lon)*scale,-(p[1]-lat)*111319.490793)for p in line]);p=nearest_points(Point(0,0),g)[1];dist=p.distance(Point(0,0))
    if best is None or dist<best[0]:best=(dist,p.x,p.y)
 if best is None or best[0]>1500:raise ValueError('No mapped driving road found within 1.5 km. Try a nearby street.')
 lat-=best[2]/111319.490793;lon+=best[1]/scale;d.update(actual_lat=lat,actual_lon=lon,automatic_road_snap_metres=best[0]);phase('fetching map and vegetation')
 data=scene_builder.scene(lat,lon);data['scene']['bake']={'tile_url':'/baked/'+d['id']+'/','origin':[lat,lon]};(folder/'district-data.json').write_text(json.dumps(data,separators=(',',':')))
 step([sys.executable,str(ROOT/'prepare.py'),str(folder)],'preparing geometry')
 step([str(ROOT.parent/'tools/blender-4.5.14-windows-x64/blender.exe'),'--background','--factory-startup','--python-exit-code','1','--python',str(ROOT/'bake.py'),'--','--work-dir',str(folder)],'rendering')
 step([sys.executable,str(ROOT/'tiles.py'),str(folder)],'optimising tiles')
 manifest=jobs.read(folder/'baked/manifest.json');assert len(manifest['files'])==9
 for t in manifest['files']:assert hashlib.sha256((folder/'baked/tiles'/t['name']).read_bytes()).hexdigest()==t['sha256']
 d.update(total_seconds=time.monotonic()-start,renderer_freeze=freeze['id']);phase('built')
 # Keep playable tiles and provenance; discard the large reproducible intermediate PNG.
 (folder/'baked/street-6144.png').unlink(missing_ok=True)
except Exception as e:
 d.update(error=str(e));phase('failed');(folder/'failure.txt').write_text(traceback.format_exc());raise
