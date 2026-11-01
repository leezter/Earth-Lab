"""Deterministic inferred occupancy of evidence-gated, ground-level parking."""
import hashlib, json, math, random
from collections import Counter, defaultdict
from pathlib import Path
from shapely.geometry import Polygon, Point, LineString, box
from shapely.ops import unary_union
from shapely.affinity import rotate, translate
from surface_network import export
from terrain import height_at

ROOT = Path(__file__).resolve().parent
POLICY = 'parked-cars-v1'


def shape(parts):
    return unary_union([Polygon(p[0], p[1:]).buffer(0) for p in parts])


def footprint(x, y, angle, length, width):
    return translate(rotate(box(-length/2, -width/2, length/2, width/2), angle,
                            origin=(0, 0), use_radians=True), x, y)


def rng(key):
    return random.Random(int(hashlib.sha256(key.encode()).hexdigest(), 16))


def choose_vehicle(catalog, randomizer, fits=lambda v: True):
    kinds = defaultdict(list)
    for vehicle in catalog:
        if fits(vehicle): kinds[vehicle['kind']].append(vehicle)
    if not kinds: return None
    keys = sorted(kinds)
    kind = randomizer.choices(keys, weights=[kinds[k][0]['weight'] for k in keys])[0]
    return randomizer.choice(kinds[kind])


def candidates(record):
    """Never lay out unknown multi-row lots or invent parking presence."""
    domain = shape(record.get('parts', []))
    tags = record['source_tags']
    if domain.is_empty: return
    if record.get('side'):
        line = LineString(record['line'])
        sign = -1 if record['side'] == 'left' else 1
        from pavements import metres
        width = metres(tags.get('width:carriageway')) or metres(tags.get('width'))
        inner = width/2-record['width']
        orientation = record['orientation']
        spacing = {'parallel':6.8, 'perpendicular':3.2, 'diagonal':4.2}[orientation]
        for i in range(int(line.length/spacing)):
            station = (i+.5)*spacing
            p = line.interpolate(station)
            a = line.interpolate(max(0, station-.1)); b = line.interpolate(min(line.length, station+.1))
            angle = math.atan2(b.y-a.y, b.x-a.x)
            normal = angle+math.pi/2
            offset = sign*(inner+record['width']/2)
            heading = angle+(math.pi if sign < 0 else 0)
            if orientation == 'perpendicular': heading = normal
            elif orientation == 'diagonal': heading = angle+sign*math.pi/4
            yield i, p.x+math.cos(normal)*offset, p.y+math.sin(normal)*offset, heading, domain
    else:
        for index, part in enumerate(getattr(domain, 'geoms', [domain])):
            points = list(part.minimum_rotated_rectangle.exterior.coords)
            edges = [(Point(a).distance(Point(b)), a, b) for a,b in zip(points, points[1:])]
            length, a, b = max(edges)
            depth = min(e[0] for e in edges)
            angle = math.atan2(b[1]-a[1], b[0]-a[0])
            c = part.centroid
            if tags.get('amenity') == 'parking_space':
                # Oversized groups are not one individually mapped space.
                if length <= 8 and depth <= 3.8:
                    yield index, c.x, c.y, angle, part
                continue
            orientation = tags.get('orientation', tags.get('parking:orientation'))
            if orientation not in {'parallel','perpendicular','diagonal'}: continue
            if depth > (3.2 if orientation == 'parallel' else 6.5): continue
            spacing = {'parallel':6.8, 'perpendicular':3.2, 'diagonal':4.2}[orientation]
            for i in range(int(length/spacing)):
                offset = -length/2+(i+.5)*spacing
                heading = angle+({'parallel':0, 'perpendicular':math.pi/2, 'diagonal':math.pi/4}[orientation])
                yield index*10000+i, c.x+math.cos(angle)*offset, c.y+math.sin(angle)*offset, heading, part


def attach(scene, osm=None):
    records = scene.get('parking_report', {}).get('records', [])
    if records and any('parts' not in r for r in records):
        # Legacy baked scenes retain source OSM. Reconstruct eligible domains;
        # never rewrite their original report, tiles, freeze or accepted evidence.
        if osm is None: records = []
        else:
            from parking_features import compile_parking
            lat, lon = scene['origin']; scale = 111319.490793*math.cos(math.radians(lat))
            xy = lambda p: [(p[0]-lon)*scale, -(p[1]-lat)*111319.490793]
            _, _, report = compile_parking(osm, xy, shape(scene['roads']),
                unary_union([shape(b['parts']) for b in scene['buildings']]), shape(scene['pavements']),
                shape(scene.get('driveways', [])),
                {**{k:shape(v) for k,v in scene.get('road_paint', {}).items()},
                 'reserved':shape(scene.get('reserved_lanes', []))})
            records = report['records']
    catalog = json.loads((ROOT/'web/parked-assets/manifest.json').read_text())['vehicles']
    blocked = unary_union([shape(scene.get(k, [])) for k in
        ('pavements','water','driveways','tree_pits','boundary_solids','reserved_lanes','refuges','tactile')]+
        [shape(b['parts']) for b in scene['buildings']]+
        [shape(s['parts']).buffer(.5) for s in scene['surface_network']['surfaces'] if s['kind'] in {'approach','deck'}]+
        [Point(t['x'],t['y']).buffer(t.get('r',1)+.2) for t in scene.get('trees',[]) if 'x' in t])
    driving = shape(scene['roads'])
    used = Polygon(); cars = []; skipped = Counter(); slots = 0
    crop = box(-92,-92,92,92)
    for record in sorted(records, key=lambda r:(r['id'],r.get('side',''))):
        if not shape(record.get('parts', [])).intersects(crop): continue
        tags = record['source_tags']; side = record.get('side')
        restriction = tags.get('parking:'+str(side)+':restriction', tags.get('parking:both:restriction'))
        conditional = tags.get('parking:'+str(side)+':restriction:conditional', tags.get('parking:both:restriction:conditional',''))
        if tags.get('parking_space') in {'disabled','charging','delivery','bus','emergency'} or restriction in {'no_parking','no_stopping','loading_only'} or any(v in conditional for v in ('no_parking','no_stopping','loading_only')):
            skipped['reserved or restricted space'] += 1; continue
        for index, x, y, angle, domain in candidates(record):
            if not crop.covers(Point(x,y)): continue
            slots += 1
            randomizer = rng(json.dumps([POLICY,scene['origin'],record['id'],side,index]))
            if randomizer.random() >= .65:
                skipped['left empty'] += 1; continue
            fit_cache = {}
            def fits(v):
                key=(v['length'],v['width'])
                if key in fit_cache: return fit_cache[key]
                area = footprint(x,y,angle,v['length']+.12,v['width']+.08)
                through_road = not side and tags.get('amenity') != 'parking_space' and driving.intersects(area)
                fit_cache[key] = crop.covers(area) and domain.covers(area) and not through_road and not blocked.intersects(area) and not used.intersects(area.buffer(.3))
                return fit_cache[key]
            vehicle = choose_vehicle(catalog, randomizer, fits)
            if vehicle is None:
                skipped['no safe vehicle-sized footprint'] += 1; continue
            area = footprint(x,y,angle,vehicle['length'],vehicle['width'])
            heights = [height_at(scene['terrain'], px, py) for px,py in area.exterior.coords]
            if max(heights)-min(heights) > .4:
                skipped['steep ground'] += 1; continue
            used = used.union(area)
            cars.append(dict(id=f"parked-{record['id']}-{side or 'space'}-{index}",
                kind=vehicle['kind'], variant=vehicle['variant'], asset=vehicle['asset'],
                x=x, y=y, angle=angle, length=vehicle['length'], width=vehicle['width'],
                height=vehicle['height'], zmin=min(heights)-.05, zmax=max(heights)+vehicle['height'],
                parts=export(area), source_id=record['id'], source_tags=tags,
                presence='mapped parking; inferred occupancy, vehicle, dimensions and heading'))
            if len(cars) >= 80: break
        if len(cars) >= 80: break
    scene['parked_cars'] = cars
    scene['parked_cars_report'] = dict(policy=POLICY, occupancy_inferred=True, candidate_slots=slots,
        count=len(cars), skipped=dict(skipped), catalog_variants=len(catalog),
        source_renderer=scene.get('renderer_freeze'),
        limitations=['Occupancy and vehicles are decorative inference, not live or surveyed parking.',
                    'Unknown multi-row lots, elevated parking and approaches are omitted.'])
    validate_cars(scene)
    return cars


def validate_cars(scene):
    """Independent pose/geometry/height acceptance for static collision scenery."""
    catalog = {(v['kind'],v['variant']):v for v in json.loads((ROOT/'web/parked-assets/manifest.json').read_text())['vehicles']}
    used = Polygon()
    for car in scene.get('parked_cars', []):
        v = catalog[(car['kind'],car['variant'])]
        if any(not math.isfinite(car[k]) for k in ('x','y','angle','zmin','zmax')):
            raise ValueError('Nonfinite parked car pose')
        if car['asset'] != v['asset'] or car['length'] != v['length'] or car['width'] != v['width']:
            raise ValueError('Parked car differs from frozen catalog')
        area = shape(car['parts'])
        expected = footprint(car['x'],car['y'],car['angle'],car['length'],car['width'])
        if area.symmetric_difference(expected).area > .02 or not box(-92.01,-92.01,92.01,92.01).covers(area):
            raise ValueError('Parked collision footprint differs from visible pose')
        if used.intersection(area).area > .001:
            raise ValueError('Overlapping parked vehicles')
        heights = [height_at(scene['terrain'],x,y) for x,y in area.exterior.coords]
        if car['zmin'] > min(heights)+.01 or car['zmax'] < max(heights)+v['height']-.01:
            raise ValueError('Parked vehicle height bounds do not cover terrain support')
        used = used.union(area)
    return {'status':'passed','cars':len(scene.get('parked_cars', []))}
