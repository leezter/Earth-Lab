from pathlib import Path
import sys,json,webbrowser,html
from urllib.parse import urlparse,parse_qs
from http.server import SimpleHTTPRequestHandler
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent;sys.path.insert(0,str(REPO))
import earth_backend as baseline
import custom_places
import place_search
from site_labels import labelled
from site_catalog import displayed
def report():return {'edition':'bridges-v10','sites':sites(),'verification':json.loads((ROOT/'verification.json').read_text())if(ROOT/'verification.json').exists()else None}
def available_sites():return [d for d in custom_places.entries()if d['status']=='built' or d['id']==custom_places.identifier(d['lat'],d['lon'])]
def sites():
 entries=custom_places.entries();fixtures=[]
 for name in ('overpass','hills','flat'):
  group=[d for d in entries if d.get('fixture')==name]
  current=next((d for d in group if d['id']==custom_places.fixture_identifier(name)),None)
  ready=[d for d in group if d['status']=='built']
  if current and current['status']=='built':fixtures.append(current)
  elif ready:fixtures.append(max(ready,key=lambda d:(custom_places.directory(d['id'])/'job.json').stat().st_mtime))
  elif current:fixtures.append(current)
 places=displayed([d for d in entries if not d.get('fixture')],custom_places.identifier,lambda d:(custom_places.directory(d['id'])/'job.json').stat().st_mtime)
 return [labelled(d)for d in fixtures+places]
def folder(sid):return custom_places.directory(sid)
class Handler(baseline.Handler):
 def __init__(self,*a,**kw):SimpleHTTPRequestHandler.__init__(self,*a,directory=str(ROOT/'web'),**kw)
 def translate_path(self,path):
  u=urlparse(path)
  if u.path.startswith('/rv/'):
   relative=u.path[len('/rv/'):];local=(ROOT/'runtime'/relative).resolve();shared=(REPO/'web/rv'/relative).resolve()
   if not local.is_relative_to(ROOT/'runtime') or not shared.is_relative_to(REPO/'web/rv'):return str(ROOT/'missing')
   return str(local if local.is_file()else shared)
  if u.path=='/street-access-kit.png':return str(ROOT/'street-access-kit.png')
  if u.path=='/materials.png':return str(REPO/'batch_v4/road-materials.png')
  if u.path.startswith('/v3-reviews/'):return str(REPO/'batch_v3/web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/v4-reviews/'):return str(REPO/'batch_v4/web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/v5-reviews/'):return str(REPO/'batch_v5/web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/v2-reviews/'):return str(REPO/'batch_v2/web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/v1-reviews/'):
   candidate=(REPO/'batch/web/reviews'/u.path.split('/')[-1]).resolve()
   if candidate.is_relative_to(REPO/'batch/web/reviews'):return str(candidate)
  if u.path.startswith('/reviews/'):
   return str(ROOT/'web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/baked/'):
   parts=u.path.split('/');sid=parts[2]if len(parts)>3 else '';name=parts[3]if len(parts)>3 else ''
   if sid in [s['id']for s in available_sites()]:
    manifest=custom_places.read(folder(sid)/'baked/manifest.json')
    if name in [f['name']for f in manifest['files']+manifest.get('patches',[])]:return str(folder(sid)/'baked/tiles'/name)
  return super().translate_path(path)
 def raw(self,text,mime='text/html; charset=utf-8'):
  b=text.encode();self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_POST(self):
  if urlparse(self.path).path!='/api/generate':return super().do_POST()
  try:
   origin=self.headers.get('Origin')
   if origin and origin!='http://'+self.headers.get('Host',''):return self.reply({'error':'Origin mismatch'},403)
   if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.reply({'error':'JSON required'},415)
   size=int(self.headers.get('Content-Length',0))
   if not 0<size<=4096:return self.reply({'error':'Invalid request size'},400)
   d=json.loads(self.rfile.read(size));return self.reply(labelled(custom_places.submit(d['lat'],d['lon'],d.get('name','Custom location'))))
  except (ValueError,KeyError,TypeError)as e:return self.reply({'error':str(e)},400)
 def do_GET(self):
  u=urlparse(self.path);q=parse_qs(u.query)
  if u.path=='/api/search':
   try:return self.reply(place_search.search(q.get('q',[''])[0]))
   except ValueError as e:return self.reply({'error':str(e)},400)
   except Exception as e:
    print('Place search failed:',str(e),flush=True)
    return self.reply({'error':'Place search is temporarily unavailable. Retry shortly, or enter latitude, longitude.'},503)
  if u.path=='/api/health':return self.reply({'ok':True,'edition':'bridges-v10'})
  if u.path=='/api/job':
   sid=q.get('id',[''])[0]
   try:return self.reply(labelled(custom_places.read(custom_places.directory(sid)/'job.json')))
   except (ValueError,FileNotFoundError):return self.reply({'error':'Unknown area'},404)
  if u.path=='/api/sites':return self.reply(sites())
  if u.path=='/api/report':return self.reply(report())
  if u.path=='/api/summary':return self.reply(json.loads((ROOT/'summary.json').read_text())if(ROOT/'summary.json').exists()else {'status':'Generation or review in progress'})
  if u.path=='/api/credits':return self.reply({'street_details':{'lanes':'Mapped cycle/bus lane presence; inferred boundaries, symbols and missing dimensions','access':'Mapped refuges/kerbs/tactile presence; inferred node outlines, ramp slopes and tactile pattern','furniture':'OSM nodes/areas; generic inferred prefab dimensions and styles','collision':'Furniture footprints join the existing static scenery collision layer'},'road_geometry_and_parking':{'geometry':'OSM road polygons and matched width tags; historical Berlin carriageway survey 2014/2015','parking':'Mapped presence and surfaces, inferred lane/bay dimensions; paint requires marking evidence','tag_reference':'https://wiki.openstreetmap.org/wiki/Street_parking'},'road_markings_and_signals':{'source':'OpenStreetMap contributors, ODbL','paint':'Mapped lane/control/crossing evidence, with inferred presence/style where noted','hardware':'Inferred roadside placement from control abstractions','indicators':'Illustrative phases, not actual schedules; no AI traffic or live illumination'},'sites_and_boundaries':{'geometry':'OpenStreetMap area polygons, barrier lines and connected gate nodes; Berlin historical parking polygons where available','appearance':'Missing dimensions, materials and colours inferred; gate pose inferred open; no invented parking bays'},'pavements':{'survey':'Geoportal Berlin Strassenbefahrung 2014/2015','licence':'dl-de-zero-2.0','source':'https://gdi.berlin.de/services/wfs/strassenbefahrung','changes':'Read-only pavement, driveway, tree-pit and parking polygons; material codes converted to approximate Blender finishes; historical data.'},'map_geometry':'Overture Maps, OpenStreetMap contributors and upstream providers','land_cover':{'name':'ESA WorldCover 10 m 2021 v200','licence':'CC BY 4.0','source':'https://doi.org/10.5281/zenodo.7254221','changes':'Sampled and converted to smoothed masks; clipped by vector geometry'},'canopy':{'name':'Meta and World Resources Institute, canopy-height model v2-ml3','licence':'CC BY 4.0','source':'https://registry.opendata.aws/dataforgood-fb-forests/','changes':'Sampled heights, bounded for procedurally positioned trees'},'materials':'Powered by Poly Haven, CC0. Asset authors and source URLs in assets/materials/batch-manifest.json.','vehicles_and_physics':'RacingVibes','terrain':{'source':'Mapterhorn / upstream providers; AWS Terrain Tiles fallback','attribution':'https://mapterhorn.com/attribution','fallback_attribution':'https://github.com/tilezen/joerd/blob/master/docs/attribution.md','datum':'Relative local reference; mixed provider datums are not fused with OSM ele'},'bridges':{'topology':'OSM bridge ways and source nodes','heights':'Constrained inferred deck and approach profiles; not surveyed','structures':'Generic inferred fixed structures'},'note':'Baked daytime 2.5D prototype; tree positions and missing architecture are inferred. See batch_v10/README.md.'})
  if u.path=='/config.js':return self.raw('window.EARTH_BATCH_SITES='+json.dumps(sites())+';','application/javascript; charset=utf-8')
  if u.path=='/api/data':
   sid=q.get('id',['berlin'])[0];entry=next((s for s in available_sites()if s['id']==sid),None)
   if not entry or entry['status']!='built':return self.reply({'error':'Scene unavailable: '+str(entry.get('error',entry['status'])if entry else sid)},503)
   data=json.loads((folder(sid)/'district-data.json').read_text());data['renderer_freeze']=entry['renderer_freeze'];return self.reply(data)
  if u.path=='/gallery.html':return self.raw((ROOT/'web/gallery.html').read_text(encoding='utf-8')if(ROOT/'web/gallery.html').exists()else '<a href="/">Drive sites edition</a>')
  return super().do_GET()
if __name__=='__main__':
 custom_places.resume_queued()
 s=baseline.Server(('127.0.0.1',47852),Handler);(ROOT/'server-token.txt').write_text(baseline.STOP_TOKEN);print('Earth Lab bridges v10: http://127.0.0.1:47852',flush=True)
 if '--no-browser'not in sys.argv:webbrowser.open('http://127.0.0.1:47852/gallery.html')
 s.serve_forever()
