"""Metric helpers in the scene's south-positive frame."""
from shapely.geometry import Polygon,LineString,Point
from shapely import STRtree
from site_features import dimension,ground_level
from street_features import DRIVE,tangent

def road_contexts(osm,raw,xy):
    baseline=[(LineString([xy(p) for p in ring]),r['width']) for r in raw['roads'] if r['class'] in DRIVE
              for part in r['parts'] for ring in part if len(ring)>1]
    tree=STRtree([p for p,_ in baseline]);result=[]
    for e in osm.get('elements',[]):
        t=e.get('tags',{});pts=[xy((p['lon'],p['lat'])) for p in e.get('geometry',[])]
        if e.get('type')!='way' or t.get('highway') not in DRIVE or t.get('area')=='yes' or not ground_level(t) or len(pts)<2:continue
        line=LineString(pts);near=[baseline[int(i)] for i in tree.query(line.buffer(3))]
        match=max(near,key=lambda p:p[0].intersection(line.buffer(2)).length,default=None)
        width,source=dimension(t.get('width:carriageway',t.get('width')),match[1] if match else 7,2,40)
        result.append({'element':e,'line':line,'width':width,'width_source':source})
    return result

def nearest_road(point,roads,limit=15):
    road=min(roads,key=lambda r:r['line'].distance(point),default=None)
    return road if road and road['line'].distance(point)<=limit else None

def rectangle(point,t,width,length):
    x,y=point;tx,ty=t;rx,ry=-ty,tx
    return Polygon([(x+rx*a+tx*b,y+ry*a+ty*b) for a,b in [(-width/2,-length/2),(width/2,-length/2),(width/2,length/2),(-width/2,length/2)]])

def band(line,lo,hi):
    def half(d):return line.buffer(d,single_sided=True,join_style=2)
    if lo>=0:return half(hi).difference(half(lo)) if lo else half(hi)
    if hi<=0:return half(lo).difference(half(hi)) if hi else half(lo)
    return half(lo).union(half(hi))

def orient(shape,point,t):
    from shapely.affinity import affine_transform
    tx,ty=t
    return affine_transform(shape,[-ty,tx,tx,ty,point.x,point.y])

def line_parts(g):
    if g.geom_type=='LineString':yield g
    else:
        for p in getattr(g,'geoms',[]):yield from line_parts(p)
