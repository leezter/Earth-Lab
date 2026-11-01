"""Serial v10 generation with complete height/mesh/image acceptance gates."""
from pathlib import Path
import sys,json,hashlib,subprocess,time,math,traceback
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT.parent))
import custom_places as jobs
import scene_builder
from job_validation import validate_parking,validate_spatial
from surface_network import validate,UnsupportedLayout
from validation import outputs
from shapely.geometry import LineString,Point
from shapely.ops import nearest_points
from bridge_sources import DRIVE

folder=jobs.directory(sys.argv[1]);path=folder/'job.json';d=jobs.read(path);start=time.monotonic()

def phase(state):d['status']=state;jobs.save(path,d)

def step(cmd,name):
    phase(name)
    with (folder/(name+'.log')).open('w')as log:
        result=subprocess.run(cmd,cwd=ROOT.parent,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
    if result.returncode:raise RuntimeError(name+' failed; check '+name+'.log')

try:
    freeze=jobs.read(ROOT/'freeze.json')
    expected=jobs.fixture_identifier(d['fixture'])if d.get('fixture')else jobs.identifier(d['lat'],d['lon'])
    if d['id']!=expected or d.get('renderer_freeze')!=freeze['id']:
        raise ValueError('Renderer changed before this job started; resubmit for the new edition')
    for file,digest in freeze['source_hashes'].items():
        if hashlib.sha256((ROOT.parent/file).read_bytes()).hexdigest()!=digest:
            raise ValueError('Frozen renderer input changed: '+file)
    lat,lon=d['lat'],d['lon']
    if d.get('fixture'):
        from fixtures import scene
        data=scene(d['fixture']);lat,lon=data['scene']['origin'];d.update(actual_lat=lat,actual_lon=lon,automatic_road_snap_metres=0)
    else:
        phase('finding road');raw=scene_builder.baseline.features(lat,lon);scale=111319.490793*math.cos(math.radians(lat));best=None
        for road in raw['roads']:
            if road['class']not in DRIVE:continue
            for part in road['parts']:
                for line in part:
                    if len(line)<2:continue
                    g=LineString([((p[0]-lon)*scale,-(p[1]-lat)*111319.490793)for p in line])
                    point=nearest_points(Point(0,0),g)[1];distance=point.distance(Point(0,0))
                    if best is None or distance<best[0]:best=(distance,point.x,point.y)
        if best is None or best[0]>1500:raise ValueError('No mapped driving road found within 1.5 km; choose a nearby street')
        lat-=best[2]/111319.490793;lon+=best[1]/scale
        d.update(actual_lat=lat,actual_lon=lon,automatic_road_snap_metres=best[0]);phase('fetching map and elevation')
        data=scene_builder.scene(lat,lon)
    s=data['scene'];validate_parking(s);validate_spatial(s);validate(s['surface_network'],s['terrain'])
    inputs=data.pop('pavement_inputs')
    content={'freeze':freeze['id'],'sources':inputs,'terrain':s['terrain'],'network':s['surface_network']}
    data['content_identity']=hashlib.sha256(json.dumps(content,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    data['renderer_freeze']=s['renderer_freeze']=freeze['id']
    s['bake']={'tile_url':'/baked/'+d['id']+'/','origin':[lat,lon],'patches':[],'content_identity':data['content_identity']}
    (folder/'pavement-inputs.json').write_text(json.dumps(inputs,separators=(',',':')),encoding='utf-8')
    for key in ('pavement_report','site_report','street_report','parking_report','geometry_report','mobility_report','access_report','furniture_report','bridge_report','bridge_checks','surface_network'):
        (folder/(key.replace('_','-')+'.json')).write_text(json.dumps(s[key],indent=2),encoding='utf-8')
    (folder/'terrain-report.json').write_text(json.dumps(s['terrain']['source'],indent=2))
    jobs.save(folder/'district-data.json',data)
    step([sys.executable,str(ROOT/'prepare.py'),str(folder)],'preparing geometry')
    step([str(ROOT.parent/'tools/blender-4.5.14-windows-x64/blender.exe'),'--background','--factory-startup','--python-exit-code','1','--python',str(ROOT/'bake.py'),'--','--work-dir',str(folder)],'rendering')
    step([sys.executable,str(ROOT/'tiles.py'),str(folder)],'optimising tiles')
    manifest=jobs.read(folder/'baked/manifest.json');s['bake']['patches']=manifest['patches'];jobs.save(folder/'district-data.json',data)
    phase('validating completed outputs');audit=outputs(folder);jobs.save(folder/'acceptance.json',audit)
    d.update(total_seconds=time.monotonic()-start,content_identity=data['content_identity'],
             bridge_count=len(s['bridge_report']['records']),terrain_source=s['terrain']['source'],acceptance=audit)
    phase('built')
except Exception as error:
    d.update(error=str(error),retryable=not isinstance(error,UnsupportedLayout));phase('failed');(folder/'failure.txt').write_text(traceback.format_exc());raise
