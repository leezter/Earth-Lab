"""Bounded fallback to validated scenes, then nearby mapped road samples."""
import math,hashlib,json
from pathlib import Path
import custom_places as jobs

RADIUS=1500
LIMIT=8
DELIVERY={'batch_v10/batch_server.py','batch_v10/nearby_places.py'}


def coordinates(lat,lon):
    lat,lon=float(lat),float(lon)
    if not math.isfinite(lat+lon)or abs(lat)>84 or abs(lon)>180:raise ValueError('Choose valid map coordinates within 84 degrees latitude')
    return lat,lon


def distance(a,b):
    p,q=map(math.radians,(a[0],b[0]));dl=math.radians(b[1]-a[1])
    h=math.sin((q-p)/2)**2+math.cos(p)*math.cos(q)*math.sin(dl/2)**2
    return 6371008.8*2*math.asin(min(1,math.sqrt(h)))


def model_hashes(freeze):
    return {p:h for p,h in freeze['source_hashes'].items()if p not in DELIVERY and not p.startswith('batch_v10/web/')}


def previous_failure(lat,lon):
    current=jobs.read(jobs.ROOT/'freeze.json')
    for d in sorted(jobs.entries(),key=lambda d:(jobs.directory(d['id'])/'job.json').stat().st_mtime,reverse=True):
        if d.get('fixture')or d['status']!='failed' or (round(d['lat'],6),round(d['lon'],6))!=(round(lat,6),round(lon,6)):continue
        if not(d.get('retryable')is False or any(s in d.get('error','')for s in ('Insufficient inferred clearance','Excessive road grade','Overlapping ground/bridge','unambiguous road','Bridge intersects'))):continue
        manifest=jobs.ROOT/('development-'+d['renderer_freeze'])/'source-manifest.json'
        if manifest.exists()and model_hashes(jobs.read(manifest))==model_hashes(current):return d
    return None


def nearest_ready(lat,lon):
    ranked=[]
    for d in jobs.entries():
        if d.get('fixture')or d['status']!='built' or d.get('acceptance',{}).get('status')!='passed':continue
        point=(d.get('actual_lat',d['lat']),d.get('actual_lon',d['lon']))
        metres=distance((lat,lon),point)
        if metres<=RADIUS:ranked.append((metres,-(jobs.directory(d['id'])/'job.json').stat().st_mtime,d))
    for metres,_,d in sorted(ranked,key=lambda r:r[:2]):
        folder=jobs.directory(d['id'])
        try:
            manifest=jobs.read(folder/'baked/manifest.json')
            if {f['name']for f in manifest['files']}!={f'{x}_{y}.webp'for x in range(3)for y in range(3)}:continue
            images=manifest['files']+manifest.get('patches',[])
            if not(folder/'district-data.json').is_file():continue
            if any(not(folder/'baked/tiles'/f['name']).is_file()for f in images):continue
        except (OSError,ValueError,KeyError):continue
        return {**d,'fallback':{'requested_lat':lat,'requested_lon':lon,'distance_m':round(metres,1),'reason':'Nearest already validated generated area','radius_m':RADIUS}}
    return None


def candidates(lat,lon):
    import earth_backend as backend
    from bridge_sources import DRIVE
    from shapely.geometry import LineString,Point
    scale=111319.490793*math.cos(math.radians(lat));ranked=[]
    for road in backend.features(lat,lon)['roads']:
        if road['class']not in DRIVE:continue
        for part in road['parts']:
            for line in part:
                if len(line)<2:continue
                g=LineString([((x-lon)*scale,-(y-lat)*111319.490793)for x,y in line])
                stations=[g.project(Point(0,0))]+list(range(0,math.ceil(g.length),32))
                for st in stations:
                    p=g.interpolate(st);metres=p.distance(Point(0,0))
                    if not 32<=metres<=RADIUS:continue
                    point=(lat-p.y/111319.490793,lon+p.x/scale)
                    if abs(point[1])>180:continue
                    ranked.append((metres,*point))
    result=[]
    for metres,a,b in sorted(ranked):
        if any(distance((a,b),(p['lat'],p['lon']))<64 for p in result):continue
        result.append({'lat':round(a,6),'lon':round(b,6),'distance_m':round(metres,1)})
        if len(result)==LIMIT:break
    return result


def find(lat,lon):
    lat,lon=coordinates(lat,lon);ready=nearest_ready(lat,lon)
    return {'ready':ready,'candidates':[]if ready else candidates(lat,lon),'radius_m':RADIUS,'max_attempts':LIMIT}
