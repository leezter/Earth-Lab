"""Shared deck meshes, rail collision edges and labelled inferred abutments."""
import math
from shapely.geometry import LineString,Point,Polygon,box
from shapely.ops import unary_union
from surface_mesh import triangles,pack,coverage,source_shape
from terrain import height_at,profile_at
from surface_network import export
from terrain_surface import cell_triangles


def refined_mesh(parts,clip,step=2,height=None):
    shape=source_shape(parts,clip)
    if shape.is_empty:return {'vertices':[],'faces':[]}
    x0,y0,x1,y1=shape.bounds
    def fitted():
        for x in range(math.floor(x0/step),math.ceil(x1/step)):
            for y in range(math.floor(y0/step),math.ceil(y1/step)):
                cell=box(x*step,y*step,(x+1)*step,(y+1)*step)
                if not shape.intersects(cell):continue
                for points in cell_triangles(x,y,step):yield from triangles(shape.intersection(Polygon(points)))
    return pack(fitted(),height)


def prepare(scene):
    network=scene['surface_network'];terrain=scene['terrain'];clip=box(-155,-155,155,155)
    base=clip.difference(source_shape(scene.get('water',[])))
    scene['terrain_base_mesh']=refined_mesh(export(base),clip)
    meshes=[];report=[]
    for surface in network['surfaces']:
        if surface['kind']!='deck':continue
        mesh=refined_mesh(surface['parts'],clip,2,lambda x,y:profile_at(surface,x,y)[0]+.024)
        report.append({'id':surface['id'],**coverage(source_shape(surface['parts'],clip),mesh)})
        shape=source_shape(surface['parts']).intersection(box(-96,-96,96,96));regions=[]
        for ix in range(6):
            for iy in range(6):
                cell=box(-96+ix*32,-96+iy*32,-64+ix*32,-64+iy*32);part=shape.intersection(cell)
                if part.area<.001:continue
                xa,ya,xb,yb=part.bounds
                regions.append({'suffix':str(ix)+'-'+str(iy),'bounds':[
                    max(cell.bounds[0],math.floor((xa-.7)*32)/32),max(cell.bounds[1],math.floor((ya-.7)*32)/32),
                    min(cell.bounds[2],math.ceil((xb+.7)*32)/32),min(cell.bounds[3],math.ceil((yb+.7)*32)/32)]})
        meshes.append({'id':surface['id'],'surface':surface['surface'],'mesh':mesh,'thickness':surface['thickness'],
                       'parts':export(source_shape(surface['parts'],clip)),'image_regions':regions})
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
                if surface['kind']=='deck' and network.get('schema',1)>=2:
                    peers=[source_shape(g['parts'])for g in network['surfaces']if g['id'] in surface['connections']and g['kind']=='deck']
                    if peers:
                        trimmed=piece.difference(unary_union(peers).buffer(.12))
                        pieces2=[trimmed]if trimmed.geom_type=='LineString'else list(getattr(trimmed,'geoms',[]))
                    else:pieces2=[piece]
                else:pieces2=[piece]
                if surface['kind']=='deck'and network.get('schema',1)>=2:
                    mask=source_shape(surface['parts']).buffer(.02)
                    clipped=[seg.intersection(mask)for seg in pieces2]
                    pieces2=[child for seg in clipped for child in ([seg]if seg.geom_type=='LineString'else list(getattr(seg,'geoms',[])))]
                for a,b in [(a,b)for segment in pieces2 if segment.geom_type=='LineString'for dense in [segment.segmentize(1)]for a,b in zip(dense.coords,list(dense.coords)[1:])]:
                    za=profile_at(surface,*a)[0];zb=profile_at(surface,*b)[0]
                    result.append({'id':surface['id']+'-rail-'+str(len(result)),'kind':'rail',
                                   'surface_id':surface['id'],'bridge_id':surface.get('bridge_id',surface['id']),
                                   'a':list(a),'b':list(b),'za':za,'zb':zb,'height':1.1,'inferred':True})
        if surface['kind']=='deck':
            # Generic end abutments below the slab; they cannot block the deck.
            # No unsurveyed pier is placed in a lower road or waterway.
            for index in (0,-1):
                node=surface['nodes'][index]
                if any(g['kind']=='deck'and g['id']!=surface['id']and node in g['nodes']for g in network['surfaces']):continue
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
    for node,parts in network.get('report',{}).get('junction_shapes',{}).items():
        peers=[g for g in network['surfaces']if node in g['nodes']and g['kind']=='deck']
        if not peers:continue
        owner=min(peers,key=lambda g:g['id']);shape=source_shape(parts)
        ribbons=unary_union([LineString(g['points']).buffer(g['width']/2,cap_style=2)for g in peers])
        guard=shape.boundary.difference(ribbons.buffer(-.15)).intersection(source_shape(owner['parts']).buffer(.02))
        pieces=[guard]if guard.geom_type=='LineString'else list(getattr(guard,'geoms',[]))
        for piece in pieces:
            if piece.geom_type!='LineString':continue
            coords=list(piece.segmentize(1).coords)
            for a,b in zip(coords,coords[1:]):
                result.append({'id':'junction-'+node+'-'+str(len(result)),'kind':'rail','surface_id':owner['id'],'bridge_id':owner['id'],
                               'a':list(a),'b':list(b),'za':profile_at(owner,*a)[0],'zb':profile_at(owner,*b)[0],'height':1.1,'inferred':True})
    network['obstacles']=result
    return result
