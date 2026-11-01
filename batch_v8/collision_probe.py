"""Find a clear approach to an actual mapped wall/fence in retained geometry."""
from pathlib import Path
import json,math
from shapely.geometry import Polygon,Point,LineString,box
from shapely.ops import unary_union
ROOT=Path(__file__).resolve().parent
shape=lambda parts:unary_union([Polygon(p[0],p[1:]).buffer(0)for p in parts])
version=json.loads((ROOT/'freeze.json').read_text())['id']
for path in sorted((ROOT/'custom').glob('*/job.json')):
    job=json.loads(path.read_text())
    if job.get('status')!='built'or job.get('renderer_freeze')!=version:
        continue
    s=json.loads((path.parent/'geometry.json').read_text());solid=unary_union([shape(b['parts'])for b in s['buildings']]);boundaries=shape(s['boundary_solids'])
    for boundary in s['boundaries']:
        if boundary['kind']not in {'wall','fence'}:
            continue
        for a,b in zip(boundary['points'],boundary['points'][1:]):
            length=math.dist(a,b)
            if length<8:
                continue
            mid=[(a[0]+b[0])/2,(a[1]+b[1])/2]
            if max(map(abs,mid))>60:
                continue
            target=LineString([a,b]);other=unary_union([solid,boundaries.difference(target.buffer(boundary['width']/2+.06))])
            for sign in (-1,1):
                normal=[-(b[1]-a[1])/length*sign,(b[0]-a[0])/length*sign]
                start=[mid[i]+normal[i]*7 for i in (0,1)];end=[mid[i]+normal[i]*1.5 for i in (0,1)]
                corridor=LineString([start,end]).buffer(1.4,cap_style=2)
                if corridor.intersection(other).area>.01:
                    continue
                probe={'site':job['id'],'renderer':version,'boundary':boundary['id'],'kind':boundary['kind'],
                       'mid':mid,'normal':normal,'start':start,'angle':math.atan2(-normal[1],-normal[0])}
                (ROOT/'collision-probe.json').write_text(json.dumps(probe,indent=2)+'\n');print(json.dumps(probe));raise SystemExit(0)
raise SystemExit('No suitable completed scene/clear mapped boundary approach found')
