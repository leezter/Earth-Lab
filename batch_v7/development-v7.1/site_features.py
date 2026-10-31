"""Mapped site surfaces and boundaries, without invented parcels or parking bays."""
import math
import re
from collections import Counter
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union
from pavements import osm_shape, SURFACES
from pavement_sources import SURVEY_CODES
from road_types import family
from roof_styles import colour

BOUNDARIES = {'wall','fence','hedge','city_wall'}
OPENINGS = {'gate','swing_gate','wicket_gate','entrance'}
KNOWN_SURFACES = {'asphalt','chipseal','concrete','concrete:plates','concrete:lanes','paving_stones',
    'paving_stones:lanes','bricks','sett','stone','cobblestone','unhewn_cobblestone','cobblestone:flattened',
    'compacted','fine_gravel','gravel','pebblestone','ground','dirt','earth','mud','clay','sand','grass',
    'grass_paver','gravel_turf','wood','woodchips','metal','paved','unpaved'}


def polygons(g):
    if g.is_empty:
        return []
    if g.geom_type=='Polygon':
        return [g]
    return [p for part in getattr(g,'geoms',[]) for p in polygons(part)]


def lines(g):
    if g.is_empty:
        return []
    if g.geom_type=='LineString':
        return [g]
    return [p for part in getattr(g,'geoms',[]) for p in lines(part)]


def dimension(value, default, low, high):
    text=str(value or '').strip().lower()
    match=re.fullmatch(r'(\d+(?:\.\d+)?|\.\d+)\s*(m|ft|\')?',text)
    if match:
        v=float(match[1])*(.3048 if match[2] in {'ft',"'"} else 1)
        if low<=v<=high:
            return v,'mapped'
    return default,'inferred'


def ground_level(tags):
    return not (tags.get('location') in {'underground','roof','rooftop'} or tags.get('tunnel')=='yes'
        or tags.get('bridge') in {'yes','viaduct'} or str(tags.get('layer','0')) not in {'','0'}
        or str(tags.get('level','0')) not in {'','0'})


def area_role(tags):
    if tags.get('amenity') in {'parking','parking_space'}:
        if tags.get('parking') in {'underground','multi-storey','rooftop','garage_boxes','sheds'} or tags.get('building') not in {None,'','no'}:
            return None
        return 'parking'
    if tags.get('man_made')=='courtyard':
        return 'courtyard'
    if tags.get('amenity') in {'fuel','car_wash'}:
        return 'forecourt'
    if tags.get('landuse') in {'industrial','depot','garages'} or tags.get('man_made')=='works':
        return 'yard'
    return None


def material_spec(tags, role, survey_code=None):
    surface=tags.get('surface')
    if survey_code:
        kind,unit=SURVEY_CODES.get(survey_code,('asphalt',None))
        inferred=survey_code not in SURVEY_CODES
    elif surface in KNOWN_SURFACES:
        kind=SURFACES.get(surface,family(surface,'service'));unit=None
        inferred=surface in {'paved','unpaved'}
    elif role=='parking':
        kind,unit,inferred='asphalt',None,True
    else:
        return None
    rgb=colour(tags.get('colour')or tags.get('color'))
    key=kind+('_'+str(unit).replace('.','p')if unit else '')+('_'+''.join(f'{round(v*255):02x}'for v in rgb)if rgb else '')
    return key,{'family':kind,'unit_metres':unit,'colour':rgb,'colour_source':'mapped'if rgb else'inferred',
                'surface':surface or survey_code,'surface_inferred':inferred,'role':role}


def compile_sites(osm, survey, xy, solid, driving, pavement, water, pits):
    extent=box(-420,-420,420,420);skipped=Counter();candidates=[];specs={}
    elements=osm.get('elements',[])
    planted=[]
    for e in elements:
        t=e.get('tags',{})
        if not ground_level(t) or e.get('geometry_complete') is False:
            continue
        if t.get('landuse') in {'grass','forest','meadow','flowerbed'} or t.get('natural') in {'water','wood','scrub'} or t.get('leisure')=='garden':
            planted.append(osm_shape(e,xy))
    protected=unary_union([solid.buffer(.10),driving,pavement,water,pits,*planted]).buffer(0)
    for row in survey:
        if row['layer']=='ck_parkflaeche':
            key,spec=material_spec({},'parking',row['material']);specs[key]=spec
            candidates.append((0,row['geometry'],key,{'id':'Berlin '+row['id'],'role':'parking',
                'source':'Berlin survey 2014/2015','geometry_source':'survey polygon','material':key,
                'surface_inferred':spec['surface_inferred'],'survey_material_code':row['material']}))
    for e in elements:
        t=e.get('tags',{});role=area_role(t)
        if not role:
            continue
        if not ground_level(t):
            skipped['non-ground site']+=1;continue
        if e.get('geometry_complete') is False:
            skipped['incomplete site relation']+=1;continue
        g=osm_shape(e,xy).intersection(extent)
        if g.is_empty:
            skipped['site has no closed area geometry']+=1;continue
        result=material_spec(t,role)
        if result is None:
            skipped['unconfirmed yard/courtyard/forecourt surface']+=1;continue
        key,spec=result;specs[key]=spec
        candidates.append((1 if t.get('amenity')=='parking_space'else 2,g,key,
            {'id':f"OSM {e['type']}/{e['id']}",'role':role,'source':'OpenStreetMap','material':key,
             'geometry_source':'mapped polygon','surface':t.get('surface'),'surface_inferred':spec['surface_inferred']}))
    occupied=Polygon();surfaces={};records=[]
    grouped={}
    for priority,g,key,record in candidates:
        grouped.setdefault((priority,key),[]).append((g,record))
    for (_,key),members in sorted(grouped.items(),key=lambda pair:pair[0][0]):
        g=unary_union([g for g,_ in members]).intersection(extent).difference(protected).difference(occupied).buffer(0)
        if g.is_empty:
            continue
        surfaces.setdefault(key,[]).append(g);occupied=unary_union([occupied,g])
        for source,record in members:
            area=source.intersection(g).area
            if area>.003:
                records.append({**record,'area_m2':round(area,3)})
    surfaces={key:unary_union(parts)for key,parts in surfaces.items()}

    nodes=[]
    for e in elements:
        if e.get('type')=='node'and e.get('tags',{}).get('barrier') in OPENINGS and ground_level(e['tags']):
            p=e['geometry'][0];point=Point(xy((p['lon'],p['lat'])))
            if extent.covers(point):
                width,source=dimension(e['tags'].get('width'),1 if e['tags']['barrier']=='wicket_gate'else 3,.4,12)
                nodes.append({'element':e,'point':point,'width':width,'width_source':source})
    boundaries=[];gate_axes={};seen={};bands=[]
    for e in elements:
        t=e.get('tags',{});kind=t.get('barrier')
        if kind not in BOUNDARIES or e.get('type')!='way' or not ground_level(t):
            continue
        pts=[xy((p['lon'],p['lat']))for p in e.get('geometry',[])]
        if len(pts)<2:
            continue
        line=LineString(pts).intersection(extent).difference(solid.buffer(.025))
        if line.is_empty:
            continue
        height,hs=dimension(t.get('height'),1.2 if kind=='hedge'else 1.4,.25,5)
        width,ws=dimension(t.get('width'),.65 if kind=='hedge'else .24 if kind in {'wall','city_wall'}else .10,.04,2)
        cuts=[]
        for node in nodes:
            point=node['point']
            if point.distance(line)<.5:
                cuts.append(point.buffer(node['width']/2+.08))
                if line.geom_type=='LineString':
                    s=line.project(point);a=line.interpolate(max(0,s-.5));b=line.interpolate(min(line.length,s+.5))
                    gate_axes[node['element']['id']]=math.atan2(b.y-a.y,b.x-a.x)
        line=line.difference(unary_union(cuts)).difference(seen.get(kind,Polygon()))
        seen[kind]=unary_union([seen.get(kind,Polygon()),line.buffer(.015)])
        material=t.get('material')or ('stone'if t.get('wall')in {'dry_stone','stone'}else None)
        for part in lines(line):
            if part.length<.15:
                continue
            boundaries.append({'id':f"OSM way/{e['id']}",'kind':'wall'if kind=='city_wall'else kind,
                'points':[[round(x,3),round(y,3)]for x,y in part.coords],
                'height':height,'height_source':hs,'width':width,'width_source':ws,
                'material':material,'material_source':'mapped'if material else'inferred',
                'colour':colour(t.get('colour')or t.get('color')),'fence_type':t.get('fence_type'),
                'source':'OpenStreetMap','geometry_source':'mapped line'})
            bands.append(part.buffer(width/2,cap_style=2,join_style=2))
    gates=[]
    for node in nodes:
        e=node['element'];point=node['point'];axis=gate_axes.get(e['id'])
        if axis is None:
            for way in elements:
                refs=way.get('nodes',[])
                if not way.get('tags',{}).get('highway') or str(e['id'])not in refs:
                    continue
                i=refs.index(str(e['id']));geo=way['geometry'];a=xy((geo[max(0,i-1)]['lon'],geo[max(0,i-1)]['lat']));b=xy((geo[min(len(geo)-1,i+1)]['lon'],geo[min(len(geo)-1,i+1)]['lat']))
                axis=math.atan2(b[1]-a[1],b[0]-a[0])+math.pi/2;break
        if e['tags']['barrier']=='entrance':
            continue
        if axis is None:
            skipped['gate orientation not established by connected geometry']+=1;continue
        height,hs=dimension(e['tags'].get('height'),1.3,.3,4)
        gates.append({'id':f"OSM node/{e['id']}",'point':[round(point.x,3),round(point.y,3)],
            'angle':axis,'width':node['width'],'width_source':node['width_source'],
            'height':height,'height_source':hs,'source':'OpenStreetMap',
            'pose':'inferred open display; current physical state unknown'})
    boundary_solid=unary_union(bands).buffer(0)
    report={'area_m2':round(occupied.area,3),'material_count':len(surfaces),'records':records,
        'materials':specs,'boundaries':len(boundaries),'boundary_kinds':dict(Counter(b['kind']for b in boundaries)),
        'boundary_length_m':round(sum(LineString(b['points']).length for b in boundaries),3),
        'gates':len(gates),'skipped':dict(skipped),
        'limitations':['Surface colours, condition and missing materials remain inferred.',
            'Unknown yard/courtyard surfaces are preserved; industrial land use alone is not hardstanding evidence.',
            'Boundary height, thickness and finish use recorded defaults when absent.',
            'Gates are depicted open for playability; their current state is unknown. Gate leaves/posts are decorative.',
            'No parking bays, paint, parked cars or additional parcel boundaries are invented.',
            'Per-feature areas may overlap within one material group; totals use exclusive unions.']}
    return occupied,surfaces,boundaries,gates,boundary_solid,report
