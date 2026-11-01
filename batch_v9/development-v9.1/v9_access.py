"""Mapped refuges and explicitly tagged crossing kerbs/tactile approaches."""
from collections import Counter
import math
from shapely.geometry import Polygon,Point,LineString,box
from shapely.ops import unary_union,nearest_points
from site_features import ground_level,dimension
from pavements import osm_shape
from street_features import tangent
from v9_common import rectangle,nearest_road

def compile_access(osm,xy,roads,driving,solid,pedestrian):
    records=[];skipped=Counter();islands=[];extent=box(-420,-420,420,420)
    # Polygon outlines have priority over inferred node/footway dimensions.
    for e in osm.get('elements',[]):
        t=e.get('tags',{})
        if not ground_level(t) or e.get('geometry_complete') is False:continue
        if t.get('area:highway')=='traffic_island':
            g=osm_shape(e,xy).difference(solid.buffer(.15)).intersection(extent)
            if g.is_empty:continue
            islands.append(g);records.append({'id':str(e['id']),'kind':'refuge','geometry_inferred':False,'source_tags':t})
    known=unary_union(islands)
    for e in osm.get('elements',[]):
        t=e.get('tags',{})
        if not ground_level(t):continue
        pts=[xy((p['lon'],p['lat'])) for p in e.get('geometry',[])]
        g=Polygon()
        if e.get('type')=='way' and t.get('footway')=='traffic_island' and len(pts)>1:
            width,_=dimension(t.get('width'),1.8,.6,6)
            g=LineString(pts).buffer(width/2,cap_style=2)
        elif e.get('type')=='node' and t.get('highway')=='crossing' and t.get('crossing:island')=='yes' and pts:
            p=Point(pts[0]);road=nearest_road(p,roads,3)
            if not road or road['width']<5.5:skipped['refuge without sufficiently wide connected road']+=1;continue
            if known.buffer(3).covers(p) or pedestrian.buffer(.5).covers(p):continue
            width,_=dimension(t.get('crossing:island:width'),1.6,1,3)
            g=rectangle(pts[0],tangent(road['line'],road['line'].project(p)),width,3.5)
        if g.is_empty:continue
        g=g.intersection(driving).difference(solid.buffer(.15)).difference(known).intersection(extent).buffer(0)
        if g.area<.5:skipped['refuge clipped or already represented']+=1;continue
        islands.append(g);known=known.union(g)
        records.append({'id':str(e['id']),'kind':'refuge','geometry_inferred':True,'source_tags':t})
    island=unary_union(islands).difference(solid.buffer(.15)).buffer(0)
    driving=driving.difference(island).buffer(0);pedestrian=pedestrian.union(island).buffer(0)
    ramps=[];cuts=[];tactile=[];used=Polygon()

    def approach(e,point,road):
        nonlocal used
        t=e['tags'];edge=nearest_points(point,driving.boundary)[1]
        if edge.distance(point)>2.5:return
        tx,ty=tangent(road['line'],road['line'].project(edge))
        candidates=[(-ty,tx),(ty,-tx)]
        outward=next(((nx,ny) for nx,ny in candidates if pedestrian.covers(Point(edge.x+nx*.65,edge.y+ny*.65))),None)
        if not outward:skipped['approach without mapped or generated pavement']+=1;return
        nx,ny=outward
        # Ramp length runs away from the carriageway. Sideways width follows road.
        centre=(edge.x+nx*.75,edge.y+ny*.75)
        patch=rectangle(centre,(nx,ny),1.8,1.5).intersection(pedestrian).difference(solid.buffer(.15)).difference(used).buffer(0)
        if patch.area<.4:return
        lowered=t.get('kerb') in {'lowered','flush','no'}
        if lowered:
            ramps.append({'id':str(e['id']),'parts':export(patch),'edge':[edge.x,edge.y],'outward':[nx,ny],
                          'length':1.5,'flush':t.get('kerb') in {'flush','no'},'position_inferred':edge.distance(point)>.15})
            cuts.append(patch.buffer(.2));used=used.union(patch)
            records.append({'id':str(e['id']),'kind':'ramp','geometry_inferred':True,'source_tags':t})
        if t.get('tactile_paving')=='yes':
            # Keep the pad on the flat approach behind the ramp, not floating
            # over the sloped patch. Pattern, dimensions and colour are inferred.
            pad=rectangle((edge.x+nx*1.9,edge.y+ny*1.9),(nx,ny),1.5,.45)
            pad=pad.intersection(pedestrian).difference(solid.buffer(.15)).buffer(0)
            if pad.area>.15:
                tactile.append(pad);records.append({'id':str(e['id']),'kind':'tactile','geometry_inferred':True,'source_tags':t})

    for e in osm.get('elements',[]):
        t=e.get('tags',{});pts=e.get('geometry',[])
        if e.get('type')!='node' or not pts or not ground_level(t):continue
        if t.get('kerb') not in {'lowered','flush','no'} and t.get('tactile_paving')!='yes':continue
        point=Point(xy((pts[0]['lon'],pts[0]['lat'])));road=nearest_road(point,roads,20)
        if not road:skipped['kerb/tactile without nearby road']+=1;continue
        if t.get('highway')=='crossing' and road['line'].distance(point)<2:
            # A crossing-centre kerb tag applies to both sides; edge locations
            # are approximations derived from the rendered carriageway outline.
            tx,ty=tangent(road['line'],road['line'].project(point));rx,ry=-ty,tx
            for sign in (-1,1):approach(e,Point(point.x+rx*sign*road['width']/2,point.y+ry*sign*road['width']/2),road)
        elif point.distance(driving.boundary)<=2.5:approach(e,point,road)
        else:skipped['tactile/kerb node away from supported approach']+=1
    return driving,pedestrian,island,ramps,unary_union(cuts),unary_union(tactile),{
        'records':records,'skipped':dict(skipped),'refuge_area_m2':round(island.area,3),
        'ramp_count':len(ramps),'tactile_area_m2':round(unary_union(tactile).area,3),
        'limitations':['Node and island-footway outlines, approach positions, slopes and tactile patterns are inferred.',
                       'No kerb lowering or tactile paving is inferred from crossing presence alone.',
                       'The browser remains a flat driving prototype; ramps are visual geometry.']}

def export(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [[list(g.exterior.coords),*[list(r.coords) for r in g.interiors]]]
    return [p for child in getattr(g,'geoms',[]) for p in export(child)]

def ramp_height(x,y,ramps):
    p=Point(x,y)
    for ramp in ramps:
        if any(Polygon(part[0],part[1:]).buffer(.005).covers(p) for part in ramp['parts']):
            if ramp['flush']:return .02
            dx,dy=x-ramp['edge'][0],y-ramp['edge'][1];nx,ny=ramp['outward']
            return .02+.12*max(0,min(1,(dx*nx+dy*ny)/ramp['length']))
    return .14
