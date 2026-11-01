"""Rendered district study. The photographic baseline is left untouched."""
import sys,os,json,math,threading,webbrowser,argparse,hashlib,time
from pathlib import Path
from http.server import SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
REPO=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(REPO))
ROOT=Path(__file__).resolve().parent
import road_data as baseline
from road_types import FAMILIES,segments
import numpy as np
from shapely.geometry import Polygon,LineString,box,Point
from shapely.ops import unary_union,transform
from shapely.prepared import prep
import mapdata
import landcover
import pavement_sources
from pavements import compile_pavements
from site_features import compile_sites
from street_features import compile_streets
from road_geometry import compile_roads, apply_widths
from parking_features import compile_parking
from v9_common import road_contexts
from v9_access import compile_access,align_ramps,partition_pavements
from surface_mesh import source_shape
from v9_mobility import compile_mobility
from v9_furniture import compile_furniture
from bridge_sources import strip_elevated
from bridge_system import enrich
SCENES={};LOCK=threading.Lock();VERSION=10

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
  osm_data,osm_info=pavement_sources.osm(lat,lon)
  if osm_info.get('status')!='available':raise ValueError('Bridge-aware generation requires OSM topology; retry when the map source is available')
  raw,bridge_matches=strip_elevated(raw,osm_data,xy)
  survey_rows,survey_info=pavement_sources.survey(lat,lon)
  width_records=apply_widths(raw,osm_data,xy)
  lanes={k:[]for k in FAMILIES};paths=[];streets=[];roadout=[]
  for r in raw['roads']:
   cls=r['class'];ped=cls in ['footway','path','cycleway','steps','pedestrian','bridleway'];surface=r['surface'].lower()
   width=r['width'];width=min(width,3)if ped else width
   touched=False
   for line,mat in segments(r,xy):
     if not line.intersects(extent):continue
     touched=True;line=line.intersection(extent)
     if ped:
      pg=line.buffer(width/2,cap_style=2,join_style=1);paths.append(pg);continue
     # All carriageways are united before edging, so junctions have no stacked ribbon caps.
     lanes[mat].append(line.buffer(width/2,cap_style=2,join_style=1))
     streets.extend({'points':list(piece.coords),'width':width,'name':r['name'],'class':cls,'surface_family':mat}for piece in ([line]if line.geom_type=='LineString'else line.geoms)if piece.geom_type=='LineString')
   if touched:roadout.append(r)
  driving=unary_union([p for group in lanes.values()for p in group]).difference(solid.buffer(.1))
  driving,lanes,geometry_report=compile_roads(osm_data,survey_rows,xy,lanes,solid)
  geometry_report['width_records']=width_records
  geometry_report['sources']={'osm':osm_info,'survey':survey_info}
  pavement_context={'building_share':building_share,'regional_guess':'mediterranean'if mediterranean else 'british'if uk else 'temperate'}
  driving,pedestrian,pavement_surfaces,pavement_report,kerbs,driveways,tree_pits=compile_pavements(raw,xy,driving,solid,pavement_context,osm_data,[r for r in survey_rows if r['layer']!='ck_parkflaeche'])
  pavement_report['sources']={'osm':osm_info,'survey':survey_info}
  road_context=road_contexts(osm_data,raw,xy)
  driving,pedestrian,refuges,ramps,kerb_cuts,tactile,access_report=compile_access(osm_data,xy,road_context,driving,solid,pedestrian,tree_pits)
  walk_domain=source_shape(export(pedestrian))
  ramp_area=align_ramps(ramps,walk_domain)
  new_refuges=refuges.difference(unary_union(list(pavement_surfaces.values())))
  for name in pavement_surfaces:pavement_surfaces[name]=pavement_surfaces[name].difference(ramp_area)
  pavement_surfaces['refuge_concrete']=new_refuges.difference(ramp_area)
  pavement_surfaces['ramp_concrete']=ramp_area
  pedestrian,pavement_surfaces=partition_pavements(walk_domain,pavement_surfaces)
  driving=driving.difference(pedestrian).buffer(0)
  pavement_report['materials']['refuge_concrete']={'family':'concrete','colour':None,'role':'refuge','colour_source':'inferred'}
  pavement_report['materials']['ramp_concrete']={'family':'concrete','colour':None,'role':'ramp','colour_source':'inferred'}
  pavement_report['area_m2']=round(pedestrian.area,3)
  kerbs=kerbs.union(driving.boundary.intersection(refuges.buffer(.035))).difference(kerb_cuts)

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
  # Make junction surface ownership explicit; coplanar overlapping materials
  # otherwise flicker. This is an inferred transition, not a mapped kerb boundary.
  def exclusive(groups,domain):
   occupied=Polygon();result={}
   for name,parts in groups.items():
    area=unary_union(parts).buffer(0).intersection(domain.buffer(0)).buffer(0)
    if area.is_empty:result[name]=[];continue
    area=area.difference(occupied).buffer(0)
    result[name]=export(area);occupied=unary_union([occupied,area])
   return result
  road_finishes=exclusive(lanes,driving);path_finishes={}
  green=unary_union(greens).difference(solid).difference(driving).difference(pedestrian)
  water=unary_union(waters)
  # Courtyard gardens and foliage are procedural, bounded by mapped geometry.
  joined=solid.buffer(.7)
  enclosed=[joined]if joined.geom_type=='Polygon'else list(getattr(joined,'geoms',[]))
  courts=[Polygon(r) for p in enclosed if p.geom_type=='Polygon' for r in p.interiors]
  gardens=unary_union(courts).buffer(-1).difference(unary_union(paths))
  ras=landcover.read(lat,lon)
  raster_forest=landcover.mask(ras,[10,95]);raster_grass=landcover.mask(ras,[30,100]);raster_crop=landcover.mask(ras,[40]);raster_bare=landcover.mask(ras,[60]);raster_shrub=landcover.mask(ras,[20]);raster_wet=landcover.mask(ras,[90]);raster_snow=landcover.mask(ras,[70])
  if water.is_empty:water=landcover.mask(ras,[80])
  site_area,site_surfaces,boundaries,gates,boundary_solid,site_report=compile_sites(osm_data,survey_rows,xy,solid,driving,pedestrian,water,tree_pits)
  site_report['sources']={'osm':osm_info,'survey':survey_info}
  green=green.difference(site_area);gardens=gardens.difference(site_area)
  furniture,furniture_solids,furniture_report=compile_furniture(osm_data,xy,road_context,driving,unary_union([solid,boundary_solid,*[Point(g['point']).buffer(.8)for g in gates]]),pedestrian,ramps,tactile)
  boundary_solid=boundary_solid.union(furniture_solids)
  blocked=unary_union([solid.buffer(.35),driving.buffer(.5),pedestrian.buffer(.15),water.buffer(.5),site_area,boundary_solid.buffer(.2)])
  ground_masks={name:g.difference(blocked)for name,g in {'landcover_forest':raster_forest,'landcover_grass':raster_grass,'landcover_crop':raster_crop,'landcover_bare':raster_bare,'landcover_shrub':raster_shrub,'landcover_wetland':raster_wet,'landcover_snow':raster_snow}.items()}
  green=green.difference(raster_forest).difference(water)
  vegetation=unary_union([green,gardens,raster_forest,landcover.mask(ras,canopy=True)]).difference(blocked)
  forest_share=raster_forest.intersection(local).area/local.area;green_share=unary_union([green,raster_grass]).intersection(local).area/local.area
  stats=ras['meta']['class_fractions'];dominant=max(stats,key=stats.get)
  base={'tree cover':'forest_floor','mangroves':'forest_floor','grassland':'aerial_grass_rock','cropland':'brown_mud_dry','shrubland':'brown_mud_dry','bare / sparse vegetation':'dry_ground_rocks','built-up':'concrete_pavement','herbaceous wetland':'forest_floor'}.get(dominant,'brown_mud_dry')
  context={'building_share':building_share,'forest_share':forest_share,'green_share':green_share,'regional_guess':'mediterranean'if mediterranean else 'british'if uk else 'temperate','ground':base,'roof_default':'clay_roof_tiles_02'if mediterranean else 'roof_slates_02','inference':'Ground uses WorldCover classification, clipped by mapped geometry; roof styles still use regional fallbacks.','raster':ras['meta']}
  rng=np.random.default_rng(72431);trees=[];shrubs=[];spacing=4.8 if forest_share>.2 else 6.
  vegetation_mask=prep(vegetation)
  shrub_mask=prep(ground_masks['landcover_shrub'])
  for x,y in rng.uniform(-155,155,(24000,2)):
   pt=Point(x,y)
   if not vegetation_mask.contains(pt):continue
   cls,h=landcover.at(ras,x,y)
   if np.isfinite(h) and h<3:continue
   if any((x-a['x'])**2+(y-a['y'])**2<spacing**2 for a in trees):continue
   height=float(np.clip(h,3,35))if np.isfinite(h)else float(rng.uniform(12,19)if cls in [10,95]else rng.uniform(6,12))
   radius=float(np.clip(height*.27,1.6,6));radius=min(radius,float(driving.distance(pt))-.4)
   if radius<1.6:continue
   trees.append({'x':round(float(x),2),'y':round(float(y),2),'r':round(radius,2),'height':round(height,2),'height_source':'canopy model'if np.isfinite(h)else 'inferred fallback','seed':int(rng.integers(0,2**30))})
   if len(trees)>=800:break
  for x,y in rng.uniform(-155,155,(6000,2)):
   if not shrub_mask.contains(Point(x,y)):continue
   if any((x-a['x'])**2+(y-a['y'])**2<36 for a in shrubs):continue
   shrubs.append({'x':round(float(x),2),'y':round(float(y),2),'r':round(float(rng.uniform(.45,1)),2),'height':round(float(rng.uniform(.6,1.6)),2),'is_shrub':True,'seed':int(rng.integers(0,2**30))})
   if len(shrubs)>=450:break
  result={**raw,'roads':roadout,'buildings':[b for b in raw['buildings']if b['id']in {b['id']for b in structures}], 'scene':{'context':context,'origin':[lat,lon],'version':VERSION,'extent':[-420,-420,420,420],'buildings':structures,'roads':export(driving),'surfaces':road_finishes,'path_surfaces':path_finishes,'pavements':export(pedestrian),'green':export(green),'gardens':export(gardens),'water':export(water),'trees':trees,'shrubs':shrubs,'landcover':{name:export(g)for name,g in ground_masks.items()},'streets':streets,'notes':['Footprints and road centre lines are mapped.','Roof fittings, missing roof styles and tree positions are inferred. Raster cover and canopy heights guide vegetation; this is not a tree survey.','Unmapped urban pavement widths are inferred. No claim of surveyed street furniture.']}}
  def line_export(g):
   if g.geom_type=='LineString':return [list(g.coords)]
   return [coords for part in getattr(g,'geoms',[])for coords in line_export(part)]
  result['scene'].update(pavement_surfaces={k:export(g)for k,g in pavement_surfaces.items()},pavement_report=pavement_report,kerbs=line_export(kerbs),driveways=export(driveways),tree_pits=export(tree_pits))
  result['scene'].update(site_areas=export(site_area),site_surfaces={k:export(g)for k,g in site_surfaces.items()},boundaries=boundaries,gates=gates,boundary_solids=export(boundary_solid),site_report=site_report)
  road_paint,traffic_hardware,street_report=compile_streets(osm_data,raw,xy,driving,solid,lat,lon)
  mobility_surfaces,mobility_paint,reserved,mobility_report=compile_mobility(osm_data,road_context,driving,solid,{'controls':unary_union([Polygon(p[0],p[1:])for p in street_report['control_paint_parts']])},lat,lon)
  # Recompile longitudinal paint outside reserved lanes; control/crossing paint
  # continues across the full carriageway as in the prior edition.
  road_paint,traffic_hardware,street_report=compile_streets(osm_data,raw,xy,driving,solid,lat,lon,reserved)
  result['scene'].update(refuges=export(refuges),ramps=ramps,tactile=export(tactile),access_report=access_report,
                         furniture=furniture,furniture_solids=export(furniture_solids),furniture_report=furniture_report,
                         mobility_surfaces={k:export(g)for k,g in mobility_surfaces.items()},mobility_paint=export(mobility_paint),
                         reserved_lanes=export(reserved),mobility_report=mobility_report)
  result['scene']['boundary_solids']=export(boundary_solid)
  parking_surfaces,parking_paint,parking_report=compile_parking(osm_data,xy,driving,solid,pedestrian,driveways,{**road_paint,'reserved':reserved})
  result['scene'].update(parking_surfaces={k:export(g)for k,g in parking_surfaces.items()},parking_report=parking_report,parking_paint=export(parking_paint),geometry_report=geometry_report)
  result['scene'].update(road_paint={k:export(g)for k,g in road_paint.items()},traffic_hardware=traffic_hardware,street_report=street_report)
  result['scene']['notes'].append('Pavement polygons and material codes use historical Berlin survey where available, otherwise OSM geometry/tags then labelled inference. Exact colours are generally unknown.')
  result['pavement_inputs']={'osm':osm_data,'survey':[dict(id=r['id'],layer=r['layer'],material=r['material'],parts=export(r['geometry']))for r in survey_rows]}
  result=enrich(result,osm_data,xy)
  result['scene']['bridge_report']['baseline_matches']=bridge_matches
  SCENES[key]=result
  while len(SCENES)>3:SCENES.pop(next(iter(SCENES)))
  (ROOT/'scene-summary.json').write_text(json.dumps({'origin':[lat,lon],'buildings':len(structures),'trees':len(trees),'roads':len(roadout),'road_area':driving.area,'pavement_area':pedestrian.area,'road_building_overlap':driving.intersection(solid).area,'notes':result['scene']['notes']},indent=2))
  return result
