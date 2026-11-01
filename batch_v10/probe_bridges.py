"""Frozen source/network probes; these are explicitly NOT rendered acceptance."""
import argparse,hashlib,json,math,traceback,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import earth_backend
import pavement_sources,terrain_sources
from surface_network import compile_network,validate
from terrain import finalize

ROOT=Path(__file__).resolve().parent
UNSEEN=[('Santa Clara bridge - Coimbra',40.2040,-8.4295),('Pont Wilson - Lyon',45.7581,4.8365),
        ('Deutzer bridge - Cologne',50.9361,6.9657),('Dom Luis bridge - Porto',41.1406,-8.6099)]


def probe(locations):
    freeze=json.loads((ROOT/'freeze.json').read_text())
    for name,digest in freeze['source_hashes'].items():
        if hashlib.sha256((ROOT.parent/name).read_bytes()).hexdigest()!=digest:raise ValueError('Frozen source mismatch: '+name)
    result={'renderer':freeze['id'],'scope':'Source and surface-network checks only. No Blender, driving or visual acceptance.',
            'per_location_geometry_changes':False,'cases':[]}
    for index,(name,lat,lon)in enumerate(locations):
        key=hashlib.sha256(json.dumps([name,lat,lon]).encode()).hexdigest()[:16]
        folder=ROOT/'cache/unseen-probes'/freeze['id']/key;folder.mkdir(parents=True,exist_ok=True)
        case={'name':name,'lat':lat,'lon':lon,'evidence_path':folder.relative_to(ROOT).as_posix()}
        try:
            osm,info=pavement_sources.osm(lat,lon)
            if info['status']!='available':raise ValueError('OSM topology unavailable')
            terrain=terrain_sources.read(lat,lon)
            xy=lambda p:((p[0]-lon)*111319.490793*math.cos(math.radians(lat)),-(p[1]-lat)*111319.490793)
            network=compile_network(osm,xy,terrain);finalize(terrain,network);checks=validate(network,terrain)
            case.update(status='network passed'if network['report']['records']else'no eligible bridge',
                        bridges=len(network['report']['records']),crossings=sum(len(r['crossings'])for r in network['report']['records']))
            (folder/'network.json').write_text(json.dumps(network));(folder/'terrain.json').write_text(json.dumps(terrain))
            (folder/'source.json').write_text(json.dumps({'info':info,'osm':osm}))
        except Exception as error:
            case.update(status='rejected',reason=str(error));(folder/'failure.txt').write_text(traceback.format_exc())
        result['cases'].append(case);print(json.dumps(case),flush=True)
    result['counts']={status:sum(c['status']==status for c in result['cases'])for status in ('network passed','no eligible bridge','rejected')}
    (ROOT/'unseen-network-verification.json').write_text(json.dumps(result,indent=2));return result

if __name__=='__main__':probe(UNSEEN)
