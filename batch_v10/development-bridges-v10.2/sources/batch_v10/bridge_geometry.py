"""Shared deck meshes, rail collision edges and labelled inferred abutments."""
import math
from shapely.geometry import LineString,Point,Polygon,box
from shapely.ops import unary_union
from surface_mesh import triangles,pack,coverage,source_shape
from terrain import height_at,profile_at
from surface_network import export


def refined_mesh(parts,clip,step=6,height=None):
    shape=source_shape(parts,clip)
    if shape.is_empty:return {'vertices':[],'faces':[]}
    x0,y0,x1,y1=shape.bounds
    def fitted():
        for x in range(math.floor(x0/step),math.ceil(x1/step)):
            for y in range(math.floor(y0/step),math.ceil(y1/step)):
                cell=box(x*step,y*step,(x+1)*step,(y+1)*step)
                if shape.intersects(cell):yield from triangles(shape.intersection(cell))
    return pack(fitted(),height)


def prepare(scene):
    network=scene['surface_network'];terrain=scene['terrain'];clip=box(-155,-155,155,155)
    scene['terrain_base_mesh']=refined_mesh(export(clip),clip,6)
    meshes=[];report=[]
    for surface in network['surfaces']:
        if surface['kind']!='deck':continue
        mesh=refined_mesh(surface['parts'],clip,2,lambda x,y:profile_at(surface,x,y)[0]+.024)
        report.append({'id':surface['id'],**coverage(source_shape(surface['parts'],clip),mesh)})
        meshes.append({'id':surface['id'],'surface':surface['surface'],'mesh':mesh,'thickness':surface['thickness'],
                       'parts':export(source_shape(surface['parts'],clip))})
    scene['bridge_meshes']=meshes
    return report


def obstacles(network,terrain):
    result=[]
    for surface in network['surfaces']:
        if surface['kind']not in {'deck','approach'}:continue
        line=LineString(surface['points'])
        for side in (-1,1):
            offset=line.offset_curve(side*(surface['width']/2-.10),join_style=1)
            pieces=[offset]if offset.geom_type=='LineString'else getattr(offset,'geoms',[])
            for piece in pieces:
                for a,b in zip(piece.coords,list(piece.coords)[1:]):
                    za=profile_at(surface,*a)[0];zb=profile_at(surface,*b)[0]
                    result.append({'id':surface['id']+'-rail-'+str(len(result)),'kind':'rail',
                                   'surface_id':surface['id'],'bridge_id':surface.get('bridge_id',surface['id']),
                                   'a':list(a),'b':list(b),'za':za,'zb':zb,'height':1.1,'inferred':True})
        if surface['kind']=='deck':
            # Generic end abutments below the slab; they cannot block the deck.
            # No unsurveyed pier is placed in a lower road or waterway.
            for index in (0,-1):
                p=line.interpolate(.35 if index==0 else max(0,line.length-.35))
                q=line.interpolate(1 if index==0 else max(0,line.length-1))
                a=math.atan2(q.y-p.y,q.x-p.x);nx,ny=-math.sin(a),math.cos(a)
                points=[(p.x+nx*t,p.y+ny*t)for t in (-surface['width']/2,surface['width']/2)]
                upper=profile_at(surface,p.x,p.y)[0]-surface['thickness']
                base=min(height_at(terrain,*v)for v in points)
                if upper-base<.2:continue
                shape=LineString(points).buffer(.3,cap_style=2)
                result.append({'id':surface['id']+'-abutment-'+str(index),'kind':'support','parts':export(shape),
                               'zmin':base-.3,'zmax':upper,'inferred':True,'bridge_id':surface['id']})
    network['obstacles']=result
    return result
