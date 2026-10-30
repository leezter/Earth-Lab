"""Triangulate mapped polygons and infer bounded pitched roof surfaces for baking."""
from pathlib import Path
import json,math,sys
import numpy as np
from shapely.geometry import Polygon,Point,box,MultiPoint
from shapely.ops import triangulate
ROOT=Path(sys.argv[1]).resolve()
d=json.loads((ROOT/'district-data.json').read_text());s=d['scene'];area=box(-155,-155,155,155)
def roof_mesh(poly,height,flat=False,pitch=.65):
 points=[]
 for ring in [poly.exterior,*poly.interiors]:
  points.extend(list(ring.coords)[:-1])
  length=ring.length
  points.extend([[ring.interpolate(t).x,ring.interpolate(t).y]for t in np.arange(0,length,1.2)])
 x0,y0,x1,y1=poly.bounds
 for x in np.arange(x0+1,x1,1.8):
  for y in np.arange(y0+1,y1,1.8):
   if poly.contains(Point(x,y)):points.append([x,y])
 xy=np.unique(np.round(points,5),axis=0);index={tuple(p):i for i,p in enumerate(xy)}
 faces=[[index[tuple(p)]for p in list(t.exterior.coords)[:3]]for t in triangulate(MultiPoint(xy))if poly.covers(t.buffer(-.00001))]
 pos=[[float(x),float(y),float(height+(0 if flat else min(poly.boundary.distance(Point(x,y)),8)*pitch))]for x,y in xy]
 return {'vertices':pos,'faces':faces}
buildings=[]
for b in s['buildings']:
 p=Polygon(b['parts'][0][0],b['parts'][0][1:])
 if not p.intersects(area):continue
 h=float(b['height']);h=min(26,max(5,h));flat=b['roof']=='flat';industrial=str(b.get('class','')).lower()in ['industrial','warehouse','manufacturing']or p.area>1500;pitch=.16 if industrial else .65
 b['industrial_inferred']=industrial
 b={**b,'height':h,'mesh':roof_mesh(p,h,flat,pitch)}
 buildings.append(b)
s['buildings']=buildings;s['trees']=[t for t in s['trees']if area.buffer(10).covers(Point(t['x'],t['y']))]
def flat(parts):
 vertices=[];faces=[]
 for part in parts:
  poly=Polygon(part[0],part[1:])
  if not poly.intersects(area):continue
  for t in triangulate(poly):
   if not poly.covers(t.buffer(-.00001)):continue
   k=len(vertices);vertices.extend(list(t.exterior.coords)[:3]);faces.append([k,k+1,k+2])
 return {'vertices':vertices,'faces':faces}
s['flat']={name:flat(s[name])for name in ['roads','pavements','green','gardens','water']}
s['flat'].update({name:flat(parts)for name,parts in s['surfaces'].items()})
s['flat'].update({name:flat(parts)for name,parts in s.get('landcover',{}).items()})
s['shrubs']=[t for t in s.get('shrubs',[])if area.buffer(5).covers(Point(t['x'],t['y']))]
(ROOT/'geometry.json').write_text(json.dumps(s,separators=(',',':')))
print(json.dumps({'buildings':len(buildings),'roof_triangles':sum(len(b['mesh']['faces'])for b in buildings),'trees':len(s['trees'])}))
