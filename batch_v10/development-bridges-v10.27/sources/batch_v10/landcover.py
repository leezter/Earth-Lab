"""Sample neighbouring WorldCover and optional canopy rasters in map metres.

Ten-metre classification guides ground/vegetation; it is not individual-tree data.
Canopy values are modelled crown heights, not surveyed trunk positions.
"""
import math,sys
from pathlib import Path
import numpy as np
from shapely.geometry import box
from shapely.ops import unary_union
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import earth_backend as backend
import mapcells,maprasters
STEP=5.;HALF=160.

def read(lat,lon):
 scale=111319.490793*math.cos(math.radians(lat))
 xs=np.arange(-HALF+STEP/2,HALF,STEP);ys=xs.copy();X,Y=np.meshgrid(xs,ys)
 lons=lon+X/scale;lats=lat-Y/111319.490793
 cover=np.zeros(X.shape,dtype=np.uint8);height=np.full(X.shape,np.nan,dtype=np.float32)
 keys=mapcells.cells_for_bbox(float(lats.min()),float(lons.min()),float(lats.max()),float(lons.max()))
 md=backend.mapdata.MapData(str(backend.CACHE),backend.FETCH);warnings=[];files=[]
 def sample(r):
  if r.crs=='EPSG:4326':return r.sample(lons,lats)
  return r.sample(6378137*np.radians(lons),6378137*np.log(np.tan(math.pi/4+np.radians(lats)/2)))
 try:
  for key in keys:
   wc=md.cell(key,layers=('landcover',)).layers['landcover'];values=sample(wc);cover[values!=0]=values[values!=0];files.extend(wc.files)
   try:
    chm=md.cell(key,layers=('canopy',)).layers.get('canopy')
    if chm is not None:
     h=sample(chm).astype(np.float32);valid=(h!=255)&(h>=0)&(h<80);height[valid]=h[valid]
   except Exception as e:warnings.append('Canopy unavailable: '+type(e).__name__)
 finally:md.close()
 local=(np.abs(X)<96)&(np.abs(Y)<96)
 stats={maprasters.CLASSES.get(int(k),str(k)):float(np.mean(cover[local]==k))for k in np.unique(cover[local])}
 meta={'source':'ESA WorldCover','landcover_release':maprasters.WORLDCOVER_RELEASE,'native_landcover_resolution_m':10,'sample_grid_m':STEP,'canopy_source':'Meta/WRI canopy-height model','canopy_release':maprasters.CHM_RELEASE,'sampled_cells':[str(k)for k in keys],'source_files':sorted(set(files)),'class_fractions':stats,'landcover_valid_fraction':float(np.mean(cover[local]!=0)),'canopy_valid_fraction':float(np.mean(np.isfinite(height[local]))),'warnings':warnings,'tree_positions':'Procedural candidates within cover/canopy masks, not surveyed trunks.'}
 return {'classes':cover,'height':height,'xs':xs,'ys':ys,'meta':meta}

def mask(raster,classes=None,canopy=False):
 flags=np.isin(raster['classes'],classes)if classes is not None else np.zeros(raster['classes'].shape,dtype=bool)
 if canopy:flags|=np.isfinite(raster['height'])&(raster['height']>=3)
 shapes=[]
 for iy,row in enumerate(flags):
  changes=np.flatnonzero(np.diff(np.r_[False,row,False].astype(np.int8)));y=raster['ys'][iy]
  for a,b in zip(changes[::2],changes[1::2]):shapes.append(box(raster['xs'][a]-STEP/2,y-STEP/2,raster['xs'][b-1]+STEP/2,y+STEP/2))
 g=unary_union(shapes)
 # Round only the classification's coarse stair steps. Vector roads/buildings are clipped later.
 return g.buffer(2.2).buffer(-2.2).simplify(.5,preserve_topology=True)if not g.is_empty else g

def at(raster,x,y):
 ix=int((x+HALF)//STEP);iy=int((y+HALF)//STEP)
 if not(0<=ix<len(raster['xs'])and 0<=iy<len(raster['ys'])):return 0,float('nan')
 return int(raster['classes'][iy,ix]),float(raster['height'][iy,ix])
