"""Evidence-first pavement polygons in the viewer's south-positive map frame."""
import math
import re
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union, polygonize
from road_types import family
from roof_styles import colour
from pavement_sources import SURVEY_CODES

PEDESTRIAN = {'footway', 'path', 'pedestrian', 'cycleway', 'steps', 'bridleway'}
URBAN = {'residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary'}
SURFACES = {'concrete:plates': 'walk_slabs', 'paving_stones': 'paving_blocks',
            'paving_stones:lanes': 'paving_blocks', 'sett': 'sett', 'stone': 'stone_slabs',
            'cobblestone:flattened': 'sett'}


def metres(value):
    text = str(value or '').strip().lower()
    match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|\')?', text)
    if not match:
        return None
    result = float(match[1])*(.3048 if match[2] in {'ft', "'"} else 1)
    return result if .25 <= result <= 20 else None


def side_spec(tags, side, default_present=False, default_width=2):
    general = str(tags.get('sidewalk', '')).lower()
    explicit = tags.get('sidewalk:'+side, tags.get('sidewalk:both'))
    if explicit is not None:
        value = str(explicit).lower()
    elif general in {'left', 'right'}:
        value = 'yes' if side == general else 'no'
    else:
        value = general
    present = value in {'yes', 'both'} or (value not in {'no', 'none', 'separate'} and default_present)
    def get(key):
        for k in (f'sidewalk:{side}:{key}', f'sidewalk:both:{key}', f'sidewalk:{key}'):
            if tags.get(k):
                return tags[k]
        return None
    width = metres(get('width'))
    surface = get('surface')
    return {'side': side, 'present': present, 'presence': value or 'inferred',
            'width': width if width is not None else default_width,
            'width_source': 'mapped' if width is not None else 'inferred',
            'surface': surface, 'colour': get('colour') or get('color')}


def side_polygon(points, road_width, width, side):
    # OSM left/right is relative to way direction in a north-positive frame.
    # Our map Y points south, so geographic left is the negative Shapely side.
    line = LineString(points)
    sign = -1 if side == 'left' else 1
    inner = line.buffer(sign*road_width/2, single_sided=True, join_style=2)
    outer = line.buffer(sign*(road_width/2+width), single_sided=True, join_style=2)
    return outer.difference(inner).buffer(0)


def osm_shape(element, xy):
    if element.get('type') == 'relation':
        outers, inners = [], []
        for member in element.get('members', []):
            pts = [xy((p['lon'], p['lat'])) for p in member.get('geometry', []) if p and 'lon' in p]
            if len(pts)>1:
                (inners if member.get('role') == 'inner' else outers).append(LineString(pts))
        return unary_union(list(polygonize(unary_union(outers)))).difference(unary_union(list(polygonize(unary_union(inners)))))
    points = [xy((p['lon'], p['lat'])) for p in element.get('geometry', []) if p and 'lon' in p]
    if len(points)>3 and points[0] == points[-1]:
        return Polygon(points).buffer(0)
    return Polygon()


def compile_pavements(raw, xy, driving, solid, context, osm_data, survey_rows):
    extent = box(-420, -420, 420, 420)
    candidates = []; records = []; materials = {}
    def add(g, surface=None, color=None, source='inferred', fid='', priority=4, **extra):
        g = g.buffer(0).intersection(extent)
        if g.is_empty:
            return
        kind = SURFACES.get(surface, family(surface, 'footway')) if surface not in {None, '', 'paved', 'unknown'} else 'walk_slabs'
        if extra.get('kind'):
            kind = extra.pop('kind')
        rgb = colour(color)
        key = kind + ('_'+''.join(f'{round(v*255):02x}' for v in rgb) if rgb else '')
        if extra.get('unit_metres'):
            key += '_'+str(extra['unit_metres']).replace('.', 'p')
        if extra.get('role') == 'driveway':
            key += '_driveway'
        materials[key] = {'family': kind, 'colour': rgb, 'colour_source': 'mapped' if rgb else 'inferred',
                          'unit_metres': extra.get('unit_metres'), 'role': extra.get('role', 'pavement')}
        rec = {'id': fid, 'source': source, 'surface': surface, 'surface_inferred': surface in {None, '', 'paved', 'unknown'},
               'colour': color, 'material': key, **extra}
        if extra.get('material_code_supported') is False:
            rec['surface_inferred'] = True
        candidates.append((priority, len(candidates), g, key, rec))

    # Survey polygons preserve widths, corners and material bands, including
    # driveway footprints and tree-pit holes; none are inferred from a ribbon.
    survey_walks = [r for r in survey_rows if r['layer'] in {'cl_gehweg', 'by_gehwegueberfahrt'}]
    pits = unary_union([r['geometry'] for r in survey_rows if r['layer'] == 'bn_baumscheibe'])
    survey_domain = unary_union([r['geometry'] for r in survey_rows])
    aprons = unary_union([r['geometry'] for r in survey_walks if r['layer'] == 'by_gehwegueberfahrt'])
    for row in survey_walks:
        kind, unit = SURVEY_CODES.get(row['material'], ('walk_slabs', None))
        add(row['geometry'].difference(pits), row['material'], source='Berlin survey 2014/2015', fid=row['id'],
            priority=0 if row['layer'] == 'by_gehwegueberfahrt' else 1, kind=kind, unit_metres=unit,
            material_code_supported=row['material'] in SURVEY_CODES, geometry_source='survey polygon',
            width_source='survey polygon', role='driveway' if row['layer'] == 'by_gehwegueberfahrt' else 'pavement')
    mapped_walk = unary_union([r['geometry'] for r in survey_walks]).difference(pits)
    # Actual pavement polygons take priority over centreline-derived road widths.
    driving = driving.difference(mapped_walk).difference(pits).buffer(0)

    base_roads = []
    for road in raw['roads']:
        if road['class'] in PEDESTRIAN:
            continue
        for part in road['parts']:
            for ring in part:
                if len(ring)>1:
                    base_roads.append((LineString([xy(p) for p in ring]), road))
    osm_corridors = []; mapped_paths = []
    default_width = 2.1 if context['regional_guess']=='british' else 2.5 if context['regional_guess']=='mediterranean' else 3.1
    for element in osm_data.get('elements', []):
        tags = element.get('tags', {}); cls = tags.get('highway', '')
        if tags.get('tunnel') == 'yes' or str(tags.get('layer', '0')) not in {'0', ''} or tags.get('bridge') in {'yes', 'viaduct'}:
            continue
        fid = f"OSM {element['type']}/{element['id']}"
        area_kind = tags.get('area:highway')
        if area_kind in {'footway', 'pedestrian', 'path', 'cycleway'} or (cls in PEDESTRIAN and tags.get('area') == 'yes'):
            g = osm_shape(element, xy)
            add(g, tags.get('surface'), tags.get('colour'), 'OpenStreetMap', fid, 2, geometry_source='mapped polygon')
            mapped_paths.append(g)
            continue
        if element.get('type') != 'way' or not cls:
            continue
        pts = [xy((p['lon'], p['lat'])) for p in element.get('geometry', []) if p and 'lon' in p]
        if len(pts)<2:
            continue
        line = LineString(pts)
        if cls in PEDESTRIAN:
            # Crossing lines have no raised pavement across the carriageway.
            if tags.get('footway') == 'crossing' or cls == 'steps':
                continue
            width = metres(tags.get('width'))
            g = line.buffer((width or 2)/2, cap_style=2, join_style=2)
            add(g, tags.get('surface'), tags.get('colour'), 'OpenStreetMap', fid, 2,
                geometry_source='mapped centreline', width_source='mapped' if width else 'inferred', width=width or 2)
            mapped_paths.append(g)
            continue
        if cls not in URBAN and not any(k.startswith('sidewalk') for k in tags):
            continue
        near = min(base_roads, key=lambda pair: pair[0].distance(line.interpolate(.5, normalized=True)), default=None)
        if near is None or near[0].distance(line.interpolate(.5, normalized=True))>12:
            continue
        road_width = metres(tags.get('width')) or near[1]['width']
        osm_corridors.append(line.buffer(road_width/2+12, cap_style=2))
        for side in ('left', 'right'):
            spec = side_spec(tags, side, cls in URBAN and context['building_share']>.12, default_width)
            if spec['present']:
                g = side_polygon(pts, road_width, spec['width'], side)
                add(g, spec['surface'], spec['colour'], 'OpenStreetMap', fid, 3,
                    geometry_source='offset from mapped centreline', side=side,
                    presence=spec['presence'], width=spec['width'], width_source=spec['width_source'])
    osm_domain = unary_union(osm_corridors)
    path_domain = unary_union(mapped_paths).buffer(.25)
    # Baseline metadata remains a labelled fallback when direct OSM is absent.
    for road in raw['roads']:
        for part in road['parts']:
            for ring in part:
                if len(ring)<2:
                    continue
                pts = [xy(p) for p in ring];line = LineString(pts)
                if road['class'] in PEDESTRIAN:
                    g = line.buffer(min(12, road['width'])/2, cap_style=2, join_style=2).difference(path_domain)
                    add(g, road.get('surface'), source='baseline pedestrian centreline', fid=road['id'], priority=4,
                        geometry_source='mapped centreline', width_source='mapped or adapter fallback')
                else:
                    for side in ('left', 'right'):
                        spec = side_spec({'sidewalk': road.get('sidewalk', '')}, side,
                                         road['class'] in URBAN and context['building_share']>.12, default_width)
                        if spec['present']:
                            g = side_polygon(pts, road['width'], spec['width'], side).difference(osm_domain)
                            add(g, source='baseline sidewalk tag / inferred fallback', fid=road['id'], priority=5,
                                geometry_source='offset from mapped centreline', side=side, presence=spec['presence'],
                                width=spec['width'], width_source='inferred')
    polygon_walks = unary_union([g for _, _, g, _, r in candidates if r.get('geometry_source') == 'mapped polygon'])
    driving = driving.difference(polygon_walks).buffer(0)
    occupied = Polygon(); surfaces = {}; driveways = Polygon(); survey_area = 0
    # No inferred pavement within the survey's observed street space. This does
    # not extrapolate survey coverage into private yards or unsurveyed blocks.
    groups = {}
    for priority, index, g, key, rec in candidates:
        groups.setdefault((priority,key), []).append((g,rec))
    blocked = unary_union([solid.buffer(.15), driving, pits])
    for (priority,key), members in sorted(groups.items(), key=lambda item:item[0][0]):
        g = unary_union([p for p,_ in members])
        if priority>1:
            g = g.difference(survey_domain)
        g = g.difference(blocked).difference(occupied).buffer(0)
        if g.is_empty:
            continue
        surfaces.setdefault(key, []).append(g)
        occupied = unary_union([occupied, g])
        if priority<=1:
            survey_area += g.area
        if materials[key].get('role') == 'driveway':
            driveways = unary_union([driveways, g])
        for candidate, rec in members:
            part = candidate.intersection(g)
            if not part.is_empty:
                records.append({**rec, 'area_m2': round(part.area, 3)})
    surfaces = {key: unary_union(parts) for key, parts in surfaces.items()}
    kerbs = driving.boundary.intersection(occupied.buffer(.035)).difference(driveways.buffer(.25))
    stats = {'area_m2': round(occupied.area, 3), 'survey_area_m2': round(survey_area, 3),
             'driveway_area_m2': round(driveways.area, 3), 'tree_pit_area_m2': round(pits.area, 3),
             'material_count': len(surfaces), 'records': records, 'materials': materials,
             'limitations': ['Colours and condition are inferred unless explicitly tagged.',
                            'Record areas can overlap within a single material group; totals use the exclusive union.',
                            'Centreline widths and corner shapes remain inferred outside polygon coverage.',
                            'Survey is historical, not a current street inspection.']}
    return driving, occupied, surfaces, stats, kerbs, driveways, pits
