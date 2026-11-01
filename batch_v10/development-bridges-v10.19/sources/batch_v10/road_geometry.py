"""Evidence-led road footprints; all centreline offsets remain approximations."""
from collections import Counter
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union
from shapely import STRtree
from pavements import metres, osm_shape
from site_features import ground_level
from street_features import DRIVE
from road_types import family


def compile_roads(osm, survey, xy, lanes, solid):
    extent = box(-420, -420, 420, 420)
    records = []; skipped = Counter()
    groups = {k: list(v) for k, v in lanes.items()}
    # Exact area footprints supersede ribbons only inside mapped street space.
    # Historical Berlin pavement/parking areas define where roads must stop.
    survey_domain = unary_union([r['geometry'] for r in survey])
    carriageways = [r['geometry'] for r in survey if r['layer'] == 'cm_fahrbahn']
    if carriageways:
        original={k:unary_union(v) for k,v in groups.items()}
        for key in groups:
            groups[key] = [g.difference(survey_domain) for g in groups[key]]
        codes = {'01':'concrete','02':'asphalt','05':'sett','06':'paving_blocks','11':'asphalt','12':'asphalt'}
        for r in survey:
            if r['layer'] != 'cm_fahrbahn':
                continue
            covered=Polygon()
            for key,material_area in original.items():
                piece=r['geometry'].intersection(material_area)
                groups[key].append(piece);covered=covered.union(piece)
            groups[codes.get(r['material'], 'asphalt')].append(r['geometry'].difference(covered))
            records.append({'id':r['id'],'source':'Berlin survey 2014/2015',
                            'geometry_inferred':False,'surface_inferred':r['material'] not in codes,
                            'surface_policy':'Retain baseline material coverage; survey code or asphalt for uncovered extensions'})
    for e in osm.get('elements', []):
        t=e.get('tags', {})
        if t.get('area:highway') not in DRIVE or not ground_level(t):
            continue
        if e.get('geometry_complete') is False:
            skipped['incomplete road polygon'] += 1; continue
        g=osm_shape(e,xy).intersection(extent)
        if g.is_empty:
            continue
        if carriageways:
            g=g.difference(survey_domain)
        for key in groups:
            groups[key]=[p.difference(g) for p in groups[key]]
        groups[family(t.get('surface'))].append(g)
        records.append({'id':str(e['id']),'source':'OpenStreetMap road polygon', 'geometry_inferred':False})
    groups={k:[unary_union(v).intersection(extent).difference(solid.buffer(.1)).buffer(0)] for k,v in groups.items()}
    driving=unary_union([g for parts in groups.values() for g in parts])
    return driving, groups, {'records':records,'skipped':dict(skipped), 'area_m2':round(driving.area,3),
                            'limitations':['Offsets from tagged widths approximate kerb shapes.',
                                           'Berlin survey dates from 2014/2015; current layouts may differ.',
                                           'Mapped polygons are not extrapolated to unmapped junctions.']}


def apply_widths(raw, osm, xy):
    """Use width evidence only on closely aligned baseline segments."""
    candidates=[]
    for e in osm.get('elements',[]):
        t=e.get('tags',{})
        width=metres(t.get('width:carriageway')) or metres(t.get('width'))
        pts=[xy((p['lon'],p['lat'])) for p in e.get('geometry',[])]
        if e.get('type')=='way' and t.get('highway') in DRIVE and ground_level(t) and t.get('area')!='yes' and width and len(pts)>1:
            candidates.append((LineString(pts),width,str(e['id'])))
    index=STRtree([g for g,_,_ in candidates]);records=[]
    for r in raw['roads']:
        if r['class'] not in DRIVE:continue
        lines=[LineString([xy(p) for p in ring]) for part in r['parts'] for ring in part if len(ring)>1]
        length=sum(g.length for g in lines)
        matches=[]
        for g,w,fid in candidates:
            coverage=sum(line.intersection(g.buffer(1.5,cap_style=2)).length for line in lines)
            if length>0 and coverage/length>.8:matches.append((coverage,w,fid))
        if not matches:continue
        widths={w for _,w,_ in matches}
        if max(widths)-min(widths)>1:continue
        _,w,fid=max(matches)
        r['width']=w;r['width_source']='matched OSM width';r['width_osm_id']=fid
        records.append({'id':r['id'],'osm_id':fid,'width':w,'geometry_inferred':True})
    return records
