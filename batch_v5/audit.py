"""Verify frozen inputs and retained local pavement scenes without rendering."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from PIL import Image
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

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
    version = frozen('batch_v5')
    previous = [frozen(edition) for edition in ['batch', 'batch_v2', 'batch_v3', 'batch_v4']]
    result = {'checked_utc':datetime.now(timezone.utc).isoformat(), 'renderer':version,
              'previous_frozen_sources_verified':previous, 'scenes':[]}
    for path in sorted((ROOT/'custom').glob('*/job.json')):
        job = read(path)
        if job.get('status') != 'built' or job.get('renderer_freeze') != version:
            continue
        folder = path.parent;s = read(folder/'geometry.json');area = box(-96,-96,96,96)
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
    result['completed_scene_checks'] = len(result['scenes'])
    (ROOT/'audit.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result,indent=2))
