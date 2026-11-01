"""Compare retained editions at matching origins, without rebuilding evidence."""
from pathlib import Path
import json
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parent
def read(path):return json.loads(path.read_text(encoding='utf-8'))
def shape(parts):return unary_union([Polygon(p[0],p[1:]).buffer(0) for p in parts])

if __name__=='__main__':
    version=read(ROOT/'freeze.json')['id'];area=box(-96,-96,96,96);results=[]
    previous=[p for p in (ROOT.parent/'batch_v7/custom').glob('*/job.json') if read(p).get('status')=='built']
    for path in (ROOT/'custom').glob('*/job.json'):
        job=read(path)
        if job.get('status')!='built' or job.get('renderer_freeze')!=version:continue
        old=next((p for p in previous if abs(read(p)['actual_lat']-job['actual_lat'])<1e-7 and abs(read(p)['actual_lon']-job['actual_lon'])<1e-7),None)
        if old is None:continue
        before=read(old.parent/'district-data.json')['scene'];after=read(path.parent/'district-data.json')['scene']
        road0=shape(before['roads']).intersection(area);road1=shape(after['roads']).intersection(area)
        parking=unary_union([shape(p) for p in after['parking_surfaces'].values()]).intersection(area)
        results.append({'name':job['name'],'id':job['id'],'previous_id':read(old)['id'],
            'origin':[job['actual_lat'],job['actual_lon']], 'road_before_m2':round(road0.area,3),
            'road_after_m2':round(road1.area,3),'road_changed_m2':round(road0.symmetric_difference(road1).area,3),
            'pavement_before_m2':round(shape(before['pavements']).intersection(area).area,3),
            'pavement_after_m2':round(shape(after['pavements']).intersection(area).area,3),
            'parking_after_m2':round(parking.area,3),
            'bay_paint_after_m2':round(shape(after['parking_paint']).intersection(area).area,3),
            'same_osm_snapshot':before['pavement_report']['sources']['osm']['response_sha256']==after['pavement_report']['sources']['osm']['response_sha256']})
    report={'renderer':version,'comparisons':results,'limitations':[
        'Matching origins do not guarantee identical source snapshots; snapshot equality is reported.',
        'Geometry changes and paint areas are measurements, not surveyed visual accuracy.']}
    (ROOT/'comparison.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
