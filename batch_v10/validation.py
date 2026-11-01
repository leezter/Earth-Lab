"""Independent completed-output checks; never accepts a job by submission alone."""
import hashlib,json,math
from pathlib import Path
from PIL import Image
from surface_network import validate
from surface_mesh import coverage,source_shape,flat_sources
from shapely.geometry import box
from terrain import height_at


def required_passes(scene):
    """Only visible geometry needs a pass; structural coverage is separate from lanes."""
    clip=box(-96,-96,96,96)
    result={surface['id'] for surface in scene['surface_network']['surfaces']
            if surface['kind']=='deck' and source_shape(surface['parts']).union(
                source_shape(surface.get('structure_parts',[]))).intersection(clip).area>.01}
    result.update(o['id'] for o in scene.get('bridge_overheads',[]) if source_shape(o['parts'],clip).area>.01)
    return result


def outputs(folder):
    folder=Path(folder);data=json.loads((folder/'district-data.json').read_text());s=data['scene']
    from parked_cars import validate_cars
    validate_cars(s)
    validate(s['surface_network'],s['terrain'])
    geometry=json.loads((folder/'geometry.json').read_text());clip=box(-155,-155,155,155)
    max_height_error=0
    for name,parts in flat_sources(geometry).items():
        mesh=geometry['flat'][name];coverage(source_shape(parts,clip),mesh)
        if name=='water':continue
        for face in mesh['faces']:
            points=[mesh['vertices'][i][:2]for i in face]
            x=sum(p[0]for p in points)/3;y=sum(p[1]for p in points)/3
            interpolated=sum(height_at(s['terrain'],*p)for p in points)/3
            error=abs(interpolated-height_at(s['terrain'],x,y));max_height_error=max(max_height_error,error)
            if error>.00002:raise ValueError('Ground layers do not share a height plane: '+name)
    for b in geometry['buildings']:coverage(source_shape(b['parts']),b['mesh'])
    for b in geometry['bridge_meshes']:
        coverage(source_shape(b['parts'],clip),b['mesh'])
        if b.get('structure_mesh'):
            surface=next(g for g in s['surface_network']['surfaces']if g['id']==b['id'])
            coverage(source_shape(surface['structure_parts'],clip),b['structure_mesh'])
    manifest=json.loads((folder/'baked/manifest.json').read_text())
    expected={f'{x}_{y}.webp'for x in range(3)for y in range(3)}
    if {f['name']for f in manifest['files']}!=expected or len(manifest['files'])!=9:raise ValueError('Nine unique base tiles required')
    decoded=6144*6144*4
    for f in manifest['files']+manifest.get('patches',[]):
        path=folder/'baked/tiles'/f['name']
        if path.parent.resolve()!=(folder/'baked/tiles').resolve():raise ValueError('Unsafe manifest image name')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=f['sha256']:raise ValueError('Image hash mismatch: '+f['name'])
        with Image.open(path)as image:
            if image.size!=(f.get('width',2048),f.get('height',2048)):raise ValueError('Image dimensions mismatch')
            if f in manifest.get('patches',[]):
                if 'A'not in image.getbands():raise ValueError('Bridge pass needs alpha')
                if image.getchannel('A').getextrema()[0]!=0:raise ValueError('Bridge pass has no transparent background')
                decoded+=image.width*image.height*4
    declared={p.get('surface_id',p['id'])for p in manifest.get('patches',[])}
    required=required_passes(s)
    if len({p['id']for p in manifest.get('patches',[])})!=len(manifest.get('patches',[])):raise ValueError('Duplicate bridge image patch')
    from shapely.ops import unary_union
    for surface in s['surface_network']['surfaces']:
        if surface['id']not in required:continue
        images=[p for p in manifest.get('patches',[])if p.get('surface_id',p['id'])==surface['id']]
        covered=unary_union([box(*p['bounds'])for p in images])
        domain=source_shape(surface['parts']).union(source_shape(surface.get('structure_parts',[]))).intersection(box(-96,-96,96,96))
        if domain.difference(covered.buffer(.001)).area>.01:raise ValueError('Bridge image patches do not cover the complete visible deck: '+surface['id'])
    for overhead in s.get('bridge_overheads',[]):
        images=unary_union([box(*p['bounds'])for p in manifest.get('patches',[])if p.get('surface_id')==overhead['id']])
        if source_shape(overhead['parts'],box(-96,-96,96,96)).difference(images.buffer(.001)).area>.01:
            raise ValueError('Missing overhead image coverage: '+overhead['id'])
    if declared!=required:raise ValueError('Missing or unexpected bridge passes')
    if decoded>256*1024**2:raise ValueError('Decoded ground and bridge images exceed 256 MiB prototype budget')
    if data['content_identity']!=manifest['content_identity']:raise ValueError('Output content identity mismatch')
    return {'status':'passed','tiles':9,'patches':len(declared),'decoded_image_bytes':decoded,
            'bridges':len(s['bridge_report']['records']),'max_ground_plane_error_m':max_height_error,'content_identity':data['content_identity']}
