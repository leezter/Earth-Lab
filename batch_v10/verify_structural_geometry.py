"""Independently validate structural mesh and compositing coverage of actual builds."""
from pathlib import Path
import json
from shapely.geometry import box
from shapely.ops import unary_union
from surface_mesh import source_shape,coverage
import custom_places as jobs


def verify(folder):
    data=jobs.read(folder/'district-data.json');s=data['scene'];g=jobs.read(folder/'geometry.json')
    patches=jobs.read(folder/'baked/manifest.json')['patches'];results=[]
    for surface in s['surface_network']['surfaces']:
        if not surface.get('structure_parts'):continue
        mesh=next(d for d in g['bridge_meshes']if d['id']==surface['id'])['structure_mesh']
        domain=source_shape(surface['structure_parts'],box(-155,-155,155,155))
        result=coverage(domain,mesh)
        images=unary_union([box(*p['bounds'])for p in patches if p['surface_id']==surface['id']])
        if domain.intersection(box(-96,-96,96,96)).difference(images).area>.001:
            raise ValueError('Structural image coverage gap')
        results.append({'id':surface['id'],**result})
    for overhead in s.get('bridge_overheads',[]):
        images=[p for p in patches if p['surface_id']==overhead['id']]
        if not images or any(p.get('kind')!='overhead'for p in images):raise ValueError('Missing overhead roof pass')
    return {'id':folder.name,'structures':results,'overheads':len(s.get('bridge_overheads',[]))}


if __name__=='__main__':
    current=jobs.read(jobs.ROOT/'freeze.json')['id']
    results=[verify(jobs.directory(d['id'])) for d in jobs.entries()if d['status']=='built'and d['renderer_freeze']==current]
    jobs.save(jobs.ROOT/'structural-geometry-verification.json',{'renderer':current,'builds':results})
    print(json.dumps(results,indent=2))
