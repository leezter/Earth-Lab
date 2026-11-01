"""Verify frozen inputs and retained local pavement scenes without rendering."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from PIL import Image
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from job_validation import validate_parking
from surface_mesh import flat_sources, source_shape, coverage

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
read = lambda p: json.loads(p.read_text(encoding='utf-8'))


def shape(parts):
    return unary_union([Polygon(p[0], p[1:]).buffer(0) for p in parts])


def frozen(edition):
    freeze = read(REPO/edition/'freeze.json')
    for name, expected in freeze['source_hashes'].items():
        assert hashlib.sha256((REPO/name).read_bytes()).hexdigest() == expected, name
    return freeze['id']


def coverage_gap(domain, materials):
    # scene_builder.export intentionally omits disconnected islands <=0.03 m2.
    # Separately rounded rings also differ by at most millimetres. Verify both
    # explicit export rules rather than accepting a broad total-area tolerance.
    gap = domain.difference(materials.buffer(.002))
    parts = [gap] if gap.geom_type=='Polygon' else list(getattr(gap,'geoms',[]))
    for part in parts:
        assert part.area <= .03+.002*part.length, ('Material coverage gap exceeds export island cutoff',part.area)
    assert materials.difference(domain.buffer(.002)).area < .01, 'Material spill beyond 2 mm'
    return gap


if __name__ == '__main__':
    version = frozen('batch_v9')
    previous = [frozen(edition) for edition in ['batch', 'batch_v2', 'batch_v3', 'batch_v4', 'batch_v5','batch_v6','batch_v7','batch_v8']]
    result = {'checked_utc':datetime.now(timezone.utc).isoformat(), 'renderer':version,
              'previous_frozen_sources_verified':previous, 'scenes':[]}
    for path in sorted((ROOT/'custom').glob('*/job.json')):
        job = read(path)
        if job.get('status') != 'built' or job.get('renderer_freeze') != version:
            continue
        folder = path.parent;s = read(folder/'geometry.json');validate_parking(s);area = box(-96,-96,96,96)
        mesh_area=box(-155,-155,155,155)
        mesh_checks={name:coverage(source_shape(parts,mesh_area),s['flat'][name])for name,parts in flat_sources(s).items()}
        roof_checks=[coverage(shape(b['parts']),b['mesh'])for b in s['buildings']]
        walk = shape(s['pavements']);roads = shape(s['roads'])
        materials = [shape(parts) for parts in s['pavement_surfaces'].values()]
        union = unary_union(materials)
        overlap = sum(g.area for g in materials)-union.area
        assert overlap < .15, ('Pavement material overlap', overlap)
        coverage_delta = walk.symmetric_difference(union).area
        # Export rounds each ring independently to millimetres. Check coverage
        # beyond that quantisation distance, recording the raw area difference.
        pavement_gap = coverage_gap(walk,union)
        raw_road_overlap = walk.intersection(roads).area
        assert walk.buffer(-.002).intersection(roads.buffer(-.002)).area < .001, 'Pavements overlap driving surface beyond ring rounding'
        road_mats = [shape(parts) for parts in s['surfaces'].values()]
        road_union = unary_union(road_mats)
        road_gap = coverage_gap(roads,road_union)
        assert sum(g.area for g in road_mats)-unary_union(road_mats).area < .15, 'Road materials overlap'
        solid = unary_union([shape(b['parts']) for b in s['buildings']])
        assert walk.intersection(solid).area < .15, 'Pavements overlap buildings'
        pits = shape(s['tree_pits'])
        assert walk.intersection(pits).area < .15, 'Tree pits paved over'
        inputs = read(folder/'pavement-inputs.json')
        survey = [r for r in inputs['survey'] if r['layer'] in {'cl_gehweg','by_gehwegueberfahrt'}]
        reference = unary_union([shape(r['parts']) for r in survey]).difference(pits).difference(solid.buffer(.15)).intersection(area)
        missing = reference.difference(walk).area
        assert missing < .5, ('Mapped survey pavement lost', missing)
        site_area=shape(s['site_areas'])
        site_materials=[shape(parts)for parts in s['site_surfaces'].values()]
        site_union=unary_union(site_materials)
        site_gap=coverage_gap(site_area,site_union)
        assert sum(g.area for g in site_materials)-site_union.area < .15,'Site materials overlap'
        for name,protected in [('roads',roads),('pavements',walk),('buildings',solid),('water',shape(s['water'])),('tree pits',pits)]:
            assert site_area.buffer(-.002).intersection(protected.buffer(-.002)).area < .001,('Site surfaces overlap '+name)
        boundary_solid=shape(s['boundary_solids'])
        from shapely.geometry import LineString,Point
        boundary_reference=unary_union([LineString(b['points']).buffer(b['width']/2,cap_style=2,join_style=2)for b in s['boundaries']])
        coverage_gap(boundary_reference,boundary_solid.difference(shape(s.get('furniture_solids',[]))))
        site_interior=site_area.buffer(-.02)
        assert all(not site_interior.contains(Point(t['x'],t['y']))for t in s['trees']),'Tree trunks placed on mapped hardstanding'
        for gate in s['gates']:
            assert not boundary_solid.buffer(-.002).contains(Point(gate['point'])),'Mapped gate opening blocked by a boundary collider'
        site_stats={'playable_site_area_m2':round(site_area.intersection(area).area,3),
                    'site_materials':len(site_materials),'playable_site_material_gap_m2':round(site_gap.intersection(area).area,5),
                    'boundary_parts':len(s['boundaries']),'playable_boundary_parts':sum(LineString(b['points']).intersects(area)for b in s['boundaries']),
                    'gate_assets':len(s['gates']),'boundary_assets':read(folder/'boundary-assets.json')}
        parking=unary_union([shape(parts)for parts in s['parking_surfaces'].values()])
        bay_paint=shape(s['parking_paint'])
        assert bay_paint.difference(parking.buffer(.002)).area<.01,'Bay paint outside parking'
        assert parking.intersection(walk.buffer(-.002)).area<.01,'Parking overlaps pavement'
        assert parking.intersection(solid.buffer(-.002)).area<.01,'Parking overlaps building'
        reserved=shape(s['reserved_lanes']);mobility_paint=shape(s['mobility_paint']);refuges=shape(s['refuges']);tactile=shape(s['tactile'])
        assert reserved.difference(roads.buffer(.002)).area<.02,'Reserved lane outside carriageway'
        assert mobility_paint.difference(reserved.buffer(.002)).area<.02,'Mobility paint outside reserved lane'
        assert refuges.intersection(roads.buffer(-.002)).area<.01,'Refuge remains drivable'
        assert tactile.difference(walk.buffer(.002)).area<.02,'Tactile pad outside pedestrian space'
        for item in s['furniture']:
            p=Point(item['point'])
            assert not solid.buffer(-.002).covers(p),'Furniture in building'
            if item['kind']!='bollard':assert not roads.buffer(-.002).covers(p),'Furniture inside carriageway'
        for ramp in s['ramps']:
            patch=shape(ramp['parts'])
            assert patch.difference(walk.buffer(.002)).area<.02,'Ramp outside pedestrian space'
        paint=[shape(parts)for parts in s['road_paint'].values()]
        paint_union=unary_union(paint)
        assert paint_union.difference(roads.buffer(.002)).area<.01,'Road paint spills outside the carriageway'
        assert paint_union.intersection(solid.buffer(-.002)).area<.001,'Road paint intersects buildings'
        assert sum(g.area for g in paint)-paint_union.area<.02,'Paint colours overlap'
        assert all(not solid.buffer(-.002).covers(Point(h['point']))for h in s['traffic_hardware']),'Traffic hardware placed inside buildings'
        assert all(not roads.buffer(-.002).covers(Point(h['point']))for h in s['traffic_hardware']),'Inferred poles inside carriageway'
        street_stats={'playable_paint_m2':round(paint_union.intersection(area).area,3),
            'playable_hardware':{kind:sum(h['kind']==kind and area.covers(Point(h['point']))for h in s['traffic_hardware'])for kind in ['signal','stop','give_way']},
            'traffic_assets':read(folder/'traffic-assets.json'),'street_profile':s['street_report']['profile']}
        manifest = read(folder/'baked/manifest.json')
        assert {t['name'] for t in manifest['files']} == {f'{x}_{y}.webp' for x in range(3) for y in range(3)}
        for tile in manifest['files']:
            p = folder/'baked/tiles'/tile['name']
            assert hashlib.sha256(p.read_bytes()).hexdigest() == tile['sha256'], p
            with Image.open(p) as image:
                assert image.size == (2048,2048), p
        result['scenes'].append({'id':job['id'],'name':job['name'],'tiles_verified':9,
            'build_seconds':job['total_seconds'],'tile_bytes':sum(t['bytes'] for t in manifest['files']),
            'playable_pavement_m2':round(walk.intersection(area).area,3),
            'survey_pavement_missing_m2':round(missing,5), 'material_overlap_m2':round(overlap,5),
            'raw_pavement_material_difference_m2':round(coverage_delta,5),'export_tolerance_metres':.002,
            'raw_pavement_road_overlap_m2':round(raw_road_overlap,5),
            'export_island_cutoff_m2':.03,'omitted_pavement_islands_m2':round(pavement_gap.area,5),
            'playable_pavement_gap_m2':round(pavement_gap.intersection(area).area,5),
            'omitted_road_islands_m2':round(road_gap.area,5),
            'materials':len(materials),'sources':s['pavement_report']['sources']})
        result['scenes'][-1].update(mesh_surface_checks=len(mesh_checks),mesh_roof_checks=len(roof_checks),max_missing_mesh_m2=max((v['missing_m2']for v in [*mesh_checks.values(),*roof_checks]),default=0),max_outside_mesh_m2=max((v['outside_m2']for v in [*mesh_checks.values(),*roof_checks]),default=0))
        result['scenes'][-1].update(playable_reserved_lane_m2=round(reserved.intersection(area).area,3),playable_mobility_paint_m2=round(mobility_paint.intersection(area).area,3),playable_refuge_m2=round(refuges.intersection(area).area,3),playable_tactile_m2=round(tactile.intersection(area).area,3),playable_ramps=sum(area.covers(Point(r['edge']))for r in s['ramps']),playable_furniture={k:sum(item['kind']==k and area.covers(Point(item['point']))for item in s['furniture'])for k in s['furniture_report']['counts']},furniture_assets=read(folder/'furniture-assets.json'))
        result['scenes'][-1].update(site_stats)
        result['scenes'][-1].update(street_stats)
        result['scenes'][-1].update(playable_parking_m2=round(parking.intersection(area).area,3),playable_bay_paint_m2=round(bay_paint.intersection(area).area,3),matched_widths=len(s['geometry_report']['width_records']),road_polygon_records=len(s['geometry_report']['records']))
    result['completed_scene_checks'] = len(result['scenes'])
    (ROOT/'audit.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2))
