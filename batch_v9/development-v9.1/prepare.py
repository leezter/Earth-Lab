"""Triangulate mapped polygons and infer bounded pitched roof surfaces for baking."""
from pathlib import Path
import json,math,sys
import numpy as np
from shapely.geometry import Polygon,Point,box,MultiPoint
from shapely.ops import triangulate
from v9_access import ramp_height
from surface_mesh import flat_mesh, roof_surface, coverage, source_shape, flat_sources
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
 # Preserve exact footprint vertices; rounding them can leave boundary slivers.
 xy=np.unique(np.asarray(points),axis=0)
 return roof_surface(poly,xy,lambda x,y:float(height+(0 if flat else min(poly.boundary.distance(Point(x,y)),8)*pitch)))

buildings=[];roof_report=[]
for b in s['buildings']:
 p=Polygon(b['parts'][0][0],b['parts'][0][1:])
 if not p.intersects(area):continue
 h=float(b['height']);h=min(26,max(5,h));flat=b['roof']=='flat';industrial=str(b.get('class','')).lower()in ['industrial','warehouse','manufacturing']or p.area>1500;pitch=.16 if industrial else .65
 b['industrial_inferred']=industrial
 b={**b,'height':h,'mesh':roof_mesh(p,h,flat,pitch)}
 roof_report.append({'id':b['id'],**coverage(p,b['mesh'])})
 buildings.append(b)
s['buildings']=buildings;s['trees']=[t for t in s['trees']if area.buffer(10).covers(Point(t['x'],t['y']))]
mesh_report={}
s['flat']={}
for name,parts in flat_sources(s).items():
 mesh=flat_mesh(parts,area)
 mesh_report[name]=coverage(source_shape(parts,area),mesh)
 if name=='walk_ramp_concrete':mesh['vertices']=[[x,y,ramp_height(x,y,s['ramps'])]for x,y in mesh['vertices']]
 s['flat'][name]=mesh
s['shrubs']=[t for t in s.get('shrubs',[])if area.buffer(5).covers(Point(t['x'],t['y']))]
(ROOT/'mesh-coverage.json').write_text(json.dumps({'surfaces':mesh_report,'roofs':roof_report},indent=2))
(ROOT/'geometry.json').write_text(json.dumps(s,separators=(',',':')))
print(json.dumps({'buildings':len(buildings),'roof_triangles':sum(len(b['mesh']['faces'])for b in buildings),'trees':len(s['trees'])}))
