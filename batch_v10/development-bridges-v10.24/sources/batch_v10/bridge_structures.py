"""Mapped structural decks and evidence-gated overhead bridge passages."""
from shapely.geometry import LineString,Point,box
from shapely.ops import unary_union
from surface_mesh import source_shape
from surface_network import export
from pavements import osm_shape
from terrain import height_at,profile_at


def attach(scene,network,terrain,osm,xy):
    decks=[s for s in network['surfaces'] if s['kind']=='deck']
    structures=[]
    for element in osm.get('elements',[]):
        tags=element.get('tags',{})
        if tags.get('man_made')!='bridge' or element.get('geometry_complete') is False:continue
        shape=osm_shape(element,xy)
        if shape.is_empty or shape.area<5:continue
        members=[d for d in decks if str(d['source_tags'].get('layer','1'))==str(tags.get('layer','1'))
                 and shape.buffer(.5).covers(LineString(d['points']).interpolate(.5,normalized=True))]
        if not members:continue
        owner=min(members,key=lambda d:d['id'])
        owner['structure_parts']=export(shape)
        owner['structure_source']={'id':str(element['id']),'tags':tags,'footprint':'mapped'}
        for d in members:d['structural_owner']=owner['id']
        structures.append((shape,tags,members))
    scene['bridge_overheads']=[]
    for b in scene['buildings']:
        footprint=source_shape(b['parts']);corridors=[];levels=[]
        for shape,tags,members in structures:
            if tags.get('bridge:structure')!='arch' or not shape.buffer(1).covers(footprint.centroid):continue
            for deck in members:
                line=LineString(deck['points']);cut=line.intersection(footprint)
                if cut.is_empty or cut.length<1 or cut.length>30 or footprint.area>1200:continue
                z=profile_at(deck,footprint.centroid.x,footprint.centroid.y)[0]
                roof=height_at(terrain,footprint.centroid.x,footprint.centroid.y)+min(26,max(5,b['height']))
                if roof-z<5.4:continue
                corridor=line.buffer(deck['width']/2+.3,cap_style=2).intersection(footprint)
                corridors.append(corridor);levels.append(z)
        if not corridors:continue
        opening=unary_union(corridors);base=height_at(terrain,footprint.centroid.x,footprint.centroid.y)
        ceiling=max(levels)+4.6
        b['collision_parts']=export(footprint.difference(opening))
        b['bridge_passage']={'inferred':True,'evidence':'Mapped arch structure and continuous bridge road through footprint',
                             'clearance_m':4.6,'parts':export(opening)}
        overhead={'id':'overhead-'+b['id'],'building_id':b['id'],'parts':b['parts'],
                  'zmin':ceiling,'zmax':base+min(26,max(5,b['height']))+6,'kind':'overhead'}
        scene['bridge_overheads'].append(overhead)
        network.setdefault('passage_obstacles',[]).extend([
            {'id':overhead['id']+'-ceiling','kind':'support','parts':export(opening),'zmin':ceiling,'zmax':overhead['zmax']},
            {'id':overhead['id']+'-base','kind':'support','parts':export(opening),'zmin':base-.3,'zmax':min(levels)-.3}])


def finish_obstacles(network):
    owners={s['id']:s for s in network['surfaces'] if s.get('structure_parts')}
    surfaces={s['id']:s for s in network['surfaces']}
    kept=[]
    for ob in network['obstacles']:
        owner=surfaces.get(ob.get('surface_id'),{}).get('structural_owner')
        if ob['kind']=='rail' and owner in owners:
            midpoint=LineString([ob['a'],ob['b']]).interpolate(.5,normalized=True)
            if source_shape(owners[owner]['structure_parts']).buffer(-.15).covers(midpoint):continue
        kept.append(ob)
    network['obstacles']=kept+network.get('passage_obstacles',[])
