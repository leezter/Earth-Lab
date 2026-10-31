"""Find a car-sized clear point inside an actual rendered site ground area."""
from pathlib import Path
import json
from shapely.geometry import Polygon,box
from shapely.ops import unary_union
ROOT=Path(__file__).resolve().parent
shape=lambda parts:unary_union([Polygon(p[0],p[1:]).buffer(0)for p in parts])
version=json.loads((ROOT/'freeze.json').read_text())['id']
for path in sorted((ROOT/'custom').glob('*/job.json')):
    job=json.loads(path.read_text())
    if job.get('status')!='built'or job.get('renderer_freeze')!=version:
        continue
    s=json.loads((path.parent/'geometry.json').read_text());walls=shape(s['boundary_solids'])
    for key,parts in s['site_surfaces'].items():
        family=s['site_report']['materials'][key]['family']
        if family not in {'asphalt','concrete','gravel','paving_blocks','walk_slabs','sett'}:
            continue
        free=shape(parts).buffer(-3).difference(walls.buffer(3)).intersection(box(-70,-70,70,70))
        if free.is_empty:
            continue
        p=free.representative_point();grip='gravel-rally'if family=='gravel'else'tarmac-pro'if family=='asphalt'else'concrete-oval'
        probe={'site':job['id'],'renderer':version,'point':[p.x,p.y],'family':family,'expectedSurfaceType':grip}
        (ROOT/'ground-probe.json').write_text(json.dumps(probe,indent=2)+'\n');print(json.dumps(probe));raise SystemExit(0)
raise SystemExit('No completed site has a suitable car-sized ground probe')
