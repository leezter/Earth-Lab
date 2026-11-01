"""Mapped street furniture with bounded inferred prefab dimensions/placement."""
import math
from collections import Counter
from shapely.geometry import Point,Polygon,box
from shapely.ops import unary_union
from site_features import ground_level,dimension
from pavements import osm_shape
from street_features import tangent
from v9_common import nearest_road,rectangle

def compile_furniture(osm,xy,roads,driving,solid,pedestrian,ramps,tactile):
    records=[];skipped=Counter();occupied=Polygon();solids=[];extent=box(-155,-155,155,155)
    ramp_area=unary_union([Polygon(p[0],p[1:]) for r in ramps for p in r['parts']])
    dimensions={'bollard':(.16,.16,1),'bike_rack':(.10,1,.8),'bus_stop':(.15,.5,2.5),
                'shelter':(1.4,3.2,2.4),'bench':(.6,1.8,.85),'bin':(.5,.5,.9)}
    elements=osm.get('elements',[])
    explicit_shelters=[]
    for e in elements:
        if e.get('tags',{}).get('amenity')=='shelter' and e.get('geometry'):
            pts=e['geometry'];explicit_shelters.append(Point(xy((pts[0]['lon'],pts[0]['lat']))))

    def add(kind,point,road,e,presence,offset=False):
        nonlocal occupied
        t=e['tags'];w,l,h=dimensions[kind]
        width,ws=dimension(t.get('width') if kind=='shelter' else None,w,w*.5,w*2)
        length,ls=dimension(t.get('length') if kind=='shelter' else None,l,l*.5,l*2)
        height,hs=dimension(t.get('height'),h,h*.4,h*2)
        heading=math.atan2(*reversed(tangent(road['line'],road['line'].project(point)))) if road else 0
        direction=t.get('direction')
        try:heading=math.radians(float(direction)) - math.pi/2 if direction is not None else heading
        except ValueError:pass
        footprint=rectangle((point.x,point.y),(math.cos(heading),math.sin(heading)),width,length)
        if not extent.covers(point) or footprint.intersects(solid.buffer(.15)) or footprint.intersects(occupied.buffer(.12)):
            skipped['furniture obstructed or duplicate']+=1;return
        if kind!='bollard' and footprint.intersects(driving.buffer(.1)):
            skipped['furniture intersects carriageway']+=1;return
        if footprint.intersects(ramp_area.buffer(.25)) or footprint.intersects(tactile.buffer(.15)):
            skipped['furniture blocks crossing approach']+=1;return
        if kind!='bollard' and not pedestrian.buffer(.75).covers(footprint):
            skipped['furniture outside supported pedestrian space']+=1;return
        if kind=='bollard' and not driving.union(pedestrian).buffer(.2).covers(footprint):
            skipped['bollard outside supported ground']+=1;return
        occupied=occupied.union(footprint);solids.append(footprint)
        records.append({'id':str(e['id']),'kind':kind,'point':[point.x,point.y],'heading':heading,
                        'width':width,'length':length,'height':height,'presence_evidence':presence,
                        'dimensions_inferred':ws!='mapped' or ls!='mapped' or hs!='mapped',
                        'position_inferred':offset or e.get('type')!='node' or kind=='bus_stop',
                        'style_inferred':True,'ground_z':.014 if driving.covers(point) else .14,'source_tags':t})
    for e in elements:
        t=e.get('tags',{});pts=e.get('geometry',[])
        candidate=t.get('barrier')=='bollard' or t.get('amenity') in {'bicycle_parking','shelter','bench','waste_basket'} or t.get('highway')=='bus_stop' or (t.get('public_transport')=='platform' and t.get('bus')=='yes')
        if not candidate:continue
        if not pts or not ground_level(t) or t.get('indoor')=='yes' or t.get('building') not in {None,'','no'}:continue
        if e.get('type')=='node':point=Point(xy((pts[0]['lon'],pts[0]['lat'])))
        else:
            if e.get('geometry_complete') is False:continue
            shape=osm_shape(e,xy)
            if shape.is_empty:continue
            point=shape.representative_point()
        road=nearest_road(point,roads,25)
        if not road:continue
        if t.get('barrier')=='bollard':add('bollard',point,road,e,'mapped bollard node')
        elif t.get('amenity')=='bicycle_parking':
            if t.get('bicycle_parking') not in {None,'stands'}:skipped['unsupported bicycle parking style']+=1;continue
            add('bike_rack',point,road,e,'mapped bicycle parking; stand count/style inferred')
        elif t.get('highway')=='bus_stop' or (t.get('public_transport')=='platform' and t.get('bus')=='yes'):
            if t.get('public_transport')=='stop_position':continue
            add('bus_stop',point,road,e,'mapped stop/platform; pole presence/location inferred')
            # Do not duplicate separately mapped shelters or infer one from a stop alone.
            if t.get('shelter')=='yes' and not any(p.distance(point)<12 for p in explicit_shelters):
                nearest=road['line'].interpolate(road['line'].project(point));dx,dy=point.x-nearest.x,point.y-nearest.y;distance=math.hypot(dx,dy)
                if distance>.1:add('shelter',Point(point.x+dx/distance*1.8,point.y+dy/distance*1.8),road,e,'bus stop shelter=yes',True)
        elif t.get('amenity')=='shelter' and t.get('shelter_type') in {None,'public_transport'}:
            add('shelter',point,road,e,'mapped shelter')
        elif t.get('amenity')=='bench':add('bench',point,road,e,'mapped bench')
        elif t.get('amenity')=='waste_basket':add('bin',point,road,e,'mapped waste basket')
    return records,unary_union(solids),{'counts':dict(Counter(r['kind'] for r in records)),
        'skipped':dict(skipped),'records':records,
        'limitations':['Generic prefab dimensions, orientation, material and appearance are inferred.',
                       'A bus-stop node denotes a stop/waiting location, not a surveyed pole.',
                       'One representative bicycle stand is used; mapped capacity is not converted into invented racks.']}
