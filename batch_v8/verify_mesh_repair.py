"""Measure the reported rendering holes on retained and rebuilt scene meshes."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from shapely.geometry import Polygon,box
from shapely.ops import unary_union
from surface_mesh import flat_sources, source_shape, coverage

ROOT=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def measured(source, mesh, clip):
    actual=unary_union([Polygon([mesh['vertices'][i][:2] for i in f]) for f in mesh['faces']]).intersection(clip)
    target=source.intersection(clip)
    return {'source_m2':target.area,'missing_m2':target.difference(actual).area,'outside_m2':actual.difference(target).area}

if __name__=='__main__':
    version=read(ROOT/'freeze.json')['id'];area=box(-96,-96,96,96);results=[]
    old_jobs=[p for p in (ROOT/'custom').glob('*/job.json') if read(p).get('renderer_freeze')=='geometry-v8.3' and read(p).get('status')=='built']
    for path in (ROOT/'custom').glob('*/job.json'):
        job=read(path)
        if job.get('renderer_freeze')!=version or job.get('status')!='built':continue
        previous=next(p for p in old_jobs if abs(read(p)['lat']-job['lat'])<1e-7 and abs(read(p)['lon']-job['lon'])<1e-7)
        old=read(previous.parent/'geometry.json');new=read(path.parent/'geometry.json')
        sources0=flat_sources(old);sources1=flat_sources(new)
        assert sources0==sources1,'Source surface footprints changed during mesh-only repair'
        surfaces={}
        for name,parts in sources1.items():
            source=source_shape(parts)
            before=measured(source,old['flat'][name],area)
            after=coverage(source,new['flat'][name],area)
            surfaces[name]={'before':before,'after':after}
        results.append({'name':job['name'],'old_id':read(previous)['id'],'new_id':job['id'],
                        'identical_source_footprints':True,'surfaces':surfaces})
    assert len(results)==3,'Wait for all three v8.4 sample builds'
    report={'checked_utc':datetime.now(timezone.utc).isoformat(),'renderer':version,'cases':results}
    (ROOT/'mesh-repair-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    for result in results:
        print(result['name'],json.dumps({name:values for name,values in result['surfaces'].items() if values['before']['missing_m2']>.01}))
