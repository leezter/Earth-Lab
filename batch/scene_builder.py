"""Rendered district study. The photographic baseline is left untouched."""
import sys,os,json,math,threading,webbrowser,argparse,hashlib,time
from pathlib import Path
from http.server import SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
REPO=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(REPO))
ROOT=Path(__file__).resolve().parent
import earth_backend as baseline
import numpy as np
from shapely.geometry import Polygon,LineString,box,Point
from shapely.ops import unary_union,transform
import mapdata
SCENES={};LOCK=threading.Lock();VERSION=1

def scene(lat,lon):
 key=(round(lat,6),round(lon,6))
 with LOCK:
  if key in SCENES:return SCENES[key]
  raw=baseline.features(lat,lon)
  scale=math.cos(math.radians(lat))*111319.490793
  def xy(p):return [(p[0]-lon)*scale,-(p[1]-lat)*111319.490793]
  extent=box(-420,-420,420,420)
  def clean(p):
   if not p.is_valid:p=p.buffer(0)
   return p.intersection(extent)
  def polygons(g):
   if g.is_empty:return []
   if g.geom_type=='Polygon':return [[[round(x,3),round(y,3)] for x,y in r.coords] for r in [g.exterior,*g.interiors]]
   return None
  def export(g):
   if g.geom_type=='Polygon':return [polygons(g)] if not g.is_empty else []
   return [polygons(p) for p in getattr(g,'geoms',[]) if p.geom_type=='Polygon' and p.area>.03]
  # Read the mapped roof metadata and actual land-use polygons, not photographed pixels.
  md=mapdata.MapData(str(baseline.CACHE),baseline.FETCH)
  try:c=md.cell_at(lat,lon,layers=('buildings','land_use','water'))
  finally:md.close()
  bf=c.layers['buildings'];lookup={str(fid):i for i,fid in enumerate(bf.ids)}
  def attr(f,k,i,default=None):
   a=f.attrs.get(k)
   if a is None:return default
   v=a[i].item() if hasattr(a[i],'item') else a[i]
   return default if isinstance(v,float) and not math.isfinite(v) else v
  structures=[];solids=[]
  for b in raw['buildings']:
   i=lookup.get(b['id']);height=attr(bf,'height',i,None) if i is not None else None
   if not height:
    floors=attr(bf,'num_floors',i,None)if i is not None else None
    height=floors*3 if floors else 7 if 49<lat<60 and -9<lon<3 else 10 if 30<lat<42 and -12<lon<40 else 12
   for p in b['parts']:
    poly=clean(Polygon([xy(v)for v in p[0]],[[xy(v)for v in r]for r in p[1:]]))
    if poly.area<8:continue
    solids.append(poly)
    for coords in export(poly):
     pg=Polygon(coords[0],coords[1:]);h=hashlib.sha256(b['id'].encode()).hexdigest();seed=int(h[:8],16)
     inner=pg.buffer(-.6,join_style=2)
     structures.append({'id':b['id'],'seed':seed,'parts':[coords],'inner':export(inner),'height':height or 15,'class':attr(bf,'class',i,'')if i is not None else '','roof':attr(bf,'roof_shape',i,'')if i is not None else '', 'color':attr(bf,'roof_color',i,'')if i is not None else '', 'material':attr(bf,'roof_material',i,'')if i is not None else '', 'bounds':list(pg.bounds),'name':b['name']})
  solid=unary_union(solids)
  local=box(-96,-96,96,96);building_share=solid.intersection(local).area/local.area
  mediterranean=30<lat<42 and -12<lon<40
  uk=49<lat<60 and -9<lon<3
  lanes={'asphalt':[],'cobble':[],'concrete':[],'dirt':[],'gravel':[]};walks=[];paths=[];streets=[];roadout=[]
  for r in raw['roads']:
   cls=r['class'];ped=cls in ['footway','path','cycleway','steps','pedestrian','bridleway'];surface=r['surface'].lower()
   mat='cobble' if any(v in surface for v in ['sett','cobble','paving']) else 'concrete' if 'concrete'in surface else 'gravel'if 'gravel'in surface else 'dirt' if any(v in surface for v in ['dirt','earth','unpaved']) else 'asphalt'
   width=r['width'];width=min(width,3)if ped else width
   touched=False
   for part in r['parts']:
    for ring in part:
     if len(ring)<2:continue
     line=LineString([xy(v)for v in ring])
     if not line.intersects(extent):continue
     touched=True;line=line.intersection(extent)
     if ped:paths.append(line.buffer(width/2,cap_style=2,join_style=1));continue
     # All carriageways are united before edging, so junctions have no stacked ribbon caps.
     lanes[mat].append(line.buffer(width/2,cap_style=2,join_style=1))
     urban=cls in ['residential','tertiary','secondary','primary','living_street','unclassified']
     pavement=0 if r['sidewalk']=='no' else (2.1 if uk else 2.5 if mediterranean else 3.1) if urban and (r['sidewalk'] or building_share>.12) else 1.4 if r['sidewalk']else 0
     if pavement:walks.append(line.buffer(width/2+pavement,cap_style=2,join_style=1))
     streets.append({'points':[xy(v)for v in ring],'width':width,'name':r['name'],'class':cls})
   if touched:roadout.append(r)
  driving=unary_union([p for group in lanes.values()for p in group]).difference(solid.buffer(.1))
  pedestrian=unary_union(walks+paths).difference(driving).difference(solid.buffer(.15))
  greens=[];waters=[];forests=[];industry=[]
  for name,target in [('land_use',greens),('water',waters)]:
   f=c.layers.get(name)
   if f is None:continue
   for i in range(len(f.ids)):
    if int(f.kind[i])!=3:continue
    cls=str(attr(f,'class',i,''))+str(attr(f,'subtype',i,''))
    if name=='land_use' and not any(k in cls.lower()for k in ['park','garden','grass','forest','wood','recreation','cemetery']):continue
    for part in f.parts(i):
     if not len(part) or len(part[0])<4:continue
     p=clean(Polygon([xy(v)for v in part[0]],[[xy(v)for v in ring]for ring in part[1:]]))
     if p.area>3:
      target.append(p)
      if name=='land_use' and any(v in cls.lower()for v in ['forest','wood']):forests.append(p)
  green=unary_union(greens).difference(solid).difference(driving).difference(pedestrian)
  water=unary_union(waters)
  # Courtyard gardens and foliage are procedural, bounded by mapped geometry.
  joined=solid.buffer(.7)
  enclosed=[joined]if joined.geom_type=='Polygon'else list(getattr(joined,'geoms',[]))
  courts=[Polygon(r) for p in enclosed if p.geom_type=='Polygon' for r in p.interiors]
  gardens=unary_union(courts).buffer(-1).difference(unary_union(paths))
  vegetation=unary_union([green,gardens]).difference(water).difference(solid).difference(driving.buffer(1))
  forest_share=unary_union(forests).intersection(local).area/local.area
  green_share=green.intersection(local).area/local.area
  context={'building_share':building_share,'forest_share':forest_share,'green_share':green_share,'regional_guess':'mediterranean'if mediterranean else 'british'if uk else 'temperate','ground':'forest_floor'if forest_share>.2 else 'dry_ground_rocks'if mediterranean and building_share<.12 else 'aerial_grass_rock'if building_share<.12 else 'concrete_pavement','roof_default':'clay_roof_tiles_02'if mediterranean else 'roof_slates_02','inference':'Regional fallback uses coarse geographic boxes, not a climate survey.'}
  rng=np.random.default_rng(72431);trees=[];spacing=4.0 if forest_share>.2 else 6.
  for x,y in rng.uniform(-155,155,(18000,2)):
   if not vegetation.contains(Point(x,y)):continue
   if any((x-a['x'])**2+(y-a['y'])**2<spacing**2 for a in trees):continue
   trees.append({'x':round(float(x),2),'y':round(float(y),2),'r':round(float(rng.uniform(3.8,5.8)if forest_share>.2 else rng.uniform(2.1,4.1)),2),'seed':int(rng.integers(0,2**30))})
   if len(trees)>=(1000 if forest_share>.2 else 450):break
  result={**raw,'roads':roadout,'buildings':[b for b in raw['buildings']if b['id']in {b['id']for b in structures}], 'scene':{'context':context,'origin':[lat,lon],'version':VERSION,'extent':[-420,-420,420,420],'buildings':structures,'roads':export(driving),'surfaces':{k:export(unary_union(v).difference(solid))for k,v in lanes.items()},'pavements':export(pedestrian),'green':export(green),'gardens':export(gardens),'water':export(water),'trees':trees,'streets':streets,'notes':['Footprints and road centre lines are mapped.','Roof fittings, roof style where missing, courtyard gardens and tree placements are procedural.','Unmapped urban pavement widths are inferred. No claim of surveyed street furniture.']}}
  SCENES[key]=result
  while len(SCENES)>3:SCENES.pop(next(iter(SCENES)))
  (ROOT/'scene-summary.json').write_text(json.dumps({'origin':[lat,lon],'buildings':len(structures),'trees':len(trees),'roads':len(roadout),'road_area':driving.area,'pavement_area':pedestrian.area,'road_building_overlap':driving.intersection(solid).area,'notes':result['scene']['notes']},indent=2))
  return result
