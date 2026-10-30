from pathlib import Path
import sys,json,webbrowser,html
from urllib.parse import urlparse,parse_qs
from http.server import SimpleHTTPRequestHandler
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent;sys.path.insert(0,str(REPO))
import earth_backend as baseline
import custom_places
def report():return json.loads((ROOT/'report.json').read_text())
def sites():return [d for d in custom_places.entries()if d['status']!='built'or d.get('renderer_freeze')==custom_places.read(ROOT/'freeze.json')['id']]
def folder(sid):return custom_places.directory(sid)if sid.startswith('place-')else ROOT/'runs'/sid
class Handler(baseline.Handler):
 def __init__(self,*a,**kw):SimpleHTTPRequestHandler.__init__(self,*a,directory=str(ROOT/'web'),**kw)
 def translate_path(self,path):
  u=urlparse(path)
  if u.path.startswith('/rv/'):return str(REPO/'web'/u.path.lstrip('/'))
  if u.path=='/materials.png':return str(ROOT/'road-materials.png')
  if u.path.startswith('/v3-reviews/'):return str(REPO/'batch_v3/web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/v2-reviews/'):return str(REPO/'batch_v2/web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/v1-reviews/'):
   candidate=(REPO/'batch/web/reviews'/u.path.split('/')[-1]).resolve()
   if candidate.is_relative_to(REPO/'batch/web/reviews'):return str(candidate)
  if u.path.startswith('/reviews/'):
   return str(ROOT/'web/reviews'/u.path.split('/')[-1])
  if u.path.startswith('/baked/'):
   parts=u.path.split('/');sid=parts[2]if len(parts)>3 else '';name=parts[3]if len(parts)>3 else ''
   if sid in [s['id']for s in sites()]and name in [f'{x}_{y}.webp'for x in range(3)for y in range(3)]:return str(folder(sid)/'baked/tiles'/name)
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
   d=json.loads(self.rfile.read(size));return self.reply(custom_places.submit(d['lat'],d['lon'],d.get('name','Custom location')))
  except (ValueError,KeyError,TypeError)as e:return self.reply({'error':str(e)},400)
 def do_GET(self):
  u=urlparse(self.path);q=parse_qs(u.query)
  if u.path=='/api/health':return self.reply({'ok':True,'edition':'road-materials-v4'})
  if u.path=='/api/job':
   sid=q.get('id',[''])[0]
   try:return self.reply(custom_places.read(custom_places.directory(sid)/'job.json'))
   except (ValueError,FileNotFoundError):return self.reply({'error':'Unknown area'},404)
  if u.path=='/api/sites':return self.reply(sites())
  if u.path=='/api/report':return self.reply(report())
  if u.path=='/api/summary':return self.reply(json.loads((ROOT/'summary.json').read_text())if(ROOT/'summary.json').exists()else {'status':'Generation or review in progress'})
  if u.path=='/api/credits':return self.reply({'map_geometry':'Overture Maps, OpenStreetMap contributors and upstream providers','land_cover':{'name':'ESA WorldCover 10 m 2021 v200','licence':'CC BY 4.0','source':'https://doi.org/10.5281/zenodo.7254221','changes':'Sampled and converted to smoothed masks; clipped by vector geometry'},'canopy':{'name':'Meta and World Resources Institute, canopy-height model v2-ml3','licence':'CC BY 4.0','source':'https://registry.opendata.aws/dataforgood-fb-forests/','changes':'Sampled heights, bounded for procedurally positioned trees'},'materials':'Powered by Poly Haven, CC0. Asset authors and source URLs in assets/materials/batch-manifest.json.','vehicles_and_physics':'RacingVibes','note':'Baked daytime 2D prototype; tree positions and missing architecture are inferred. See batch_v4/README.md.'})
  if u.path=='/config.js':return self.raw('window.EARTH_BATCH_SITES='+json.dumps(sites())+';','application/javascript; charset=utf-8')
  if u.path=='/api/data':
   sid=q.get('id',['berlin'])[0];entry=next((s for s in sites()if s['id']==sid),None)
   if not entry or entry['status']!='built':return self.reply({'error':'Scene unavailable: '+str(entry.get('error',entry['status'])if entry else sid)},503)
   return self.reply(json.loads((folder(sid)/'district-data.json').read_text()))
  if u.path=='/gallery.html':return self.raw((ROOT/'web/gallery.html').read_text(encoding='utf-8')if(ROOT/'web/gallery.html').exists()else '<a href="/">Drive road materials edition</a>')
  return super().do_GET()
if __name__=='__main__':
 custom_places.resume_queued()
 s=baseline.Server(('127.0.0.1',47846),Handler);(ROOT/'server-token.txt').write_text(baseline.STOP_TOKEN);print('Earth Lab road materials v4: http://127.0.0.1:47846',flush=True)
 if '--no-browser'not in sys.argv:webbrowser.open('http://127.0.0.1:47846/gallery.html')
 s.serve_forever()
