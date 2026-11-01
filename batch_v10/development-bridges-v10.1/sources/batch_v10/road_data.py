"""Enrich the baseline read without modifying earlier builds or shared adapters."""
import earth_backend as baseline
from earth_backend import *
def features(lat,lon):
 raw=baseline.features(lat,lon);md=mapdata.MapData(str(CACHE),FETCH)
 try:f=md.cell_at(lat,lon,layers=('roads',)).layers['roads']
 finally:md.close()
 indices={str(fid):i for i,fid in enumerate(f.ids)}
 for r in raw['roads']:
  i=indices[r['id']]
  def attr(key):
   a=f.attrs.get(key);v=a[i]if a is not None else None
   if hasattr(v,'item'):v=v.item()
   return None if isinstance(v,float)and not math.isfinite(v)else v
  osm=attr('osm_surface');rules=f.rules.get('surface');spans=rules.for_feature(i)if rules is not None else []
  r.update(lanes=attr('osm_lanes'),smoothness=attr('osm_smoothness'),surface_source='OpenStreetMap'if osm else 'Overture'if spans else 'inferred',surface_rules=[]if osm else spans)
  if not osm and not spans:r['surface']='unknown'
  r['appearance_inferred']=r['surface']in ['unknown','paved','unpaved','']
 return raw
