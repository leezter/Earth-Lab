"""Separate localhost prototype. Reads Earth data adapters; never starts/edits BeamNG."""
import os,sys,json,math,io,hashlib,threading,argparse,webbrowser,time,secrets,gzip
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs,quote
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parent
ADAPTER=Path(os.environ['LOCALAPPDATA'])/'Programs/BeamNG.Earth.Landmark.Exploration/server'
sys.path.insert(0,str(ADAPTER))
import numpy as np
from dataclasses import replace
from PIL import Image
import mapdata,netfetch,imagery,geodesy
FETCH=netfetch.Fetcher()
# Reuse existing downloads without duplicating gigabytes or starting a cache sweeper.
CACHE=Path(os.environ['LOCALAPPDATA'])/'beamng-earth/cache'
DATA_GATE=threading.Semaphore(1)
IMG=imagery.Imagery(str(CACHE),chain=tuple(replace(imagery.SOURCES[n],lazy=False) for n in imagery.DEFAULT_CHAIN),fetcher=FETCH,mem_tiles=96,fetch_workers=4)
IMAGES=ROOT/'cache/images';IMAGES.mkdir(parents=True,exist_ok=True)
IMAGE_GATE=threading.Semaphore(3)
TILE=128
STOP_TOKEN=secrets.token_hex(24)

def number(q,key,default,lo,hi):
 v=float(q.get(key,[default])[0])
 if not math.isfinite(v) or not lo<=v<=hi:raise ValueError('Invalid '+key)
 return v

def location(q):return number(q,'lat',52.4971,-84,84),number(q,'lon',13.44561,-180,180)

def features(lat,lon):
 print('Map request',lat,lon,flush=True)
 # Each query owns its reader. The shared Earth reader retains mutable per-cell
 # tables; independent HTTP workers must not reuse those across location changes.
 with DATA_GATE:
  md=mapdata.MapData(str(CACHE),FETCH)
  try:c=md.cell_at(lat,lon,layers=('roads','buildings'))
  finally:md.close()
 print('Map source ready',lat,lon,flush=True)
 result={'roads':[],'buildings':[],'credits':c.credit_line(),'cell':str(c.key)}
 for layer,f in c.layers.items():
  if f is None:continue
  def attr(k,i,default=''):
   a=f.attrs.get(k)
   if a is None:return default
   v=a[i].item() if hasattr(a[i],'item') else a[i]
   return default if isinstance(v,float) and not math.isfinite(v) else v
  def rule(k,i,default=None):
   r=f.rules.get(k)
   if r is None:return default
   j=r.major(i)
   return r.value[j].item() if j>=0 else default
  for i,fid in enumerate(f.ids):
   if abs(float(attr('cy',i,lat))-lat)>.024 or abs(float(attr('cx',i,lon))-lon)*math.cos(math.radians(lat))>.024:continue
   p=[ [r.round(8).tolist() for r in part] for part in f.parts(i)]
   if layer=='roads':
    cls=attr('class',i);surface=attr('osm_surface',i) or rule('surface',i,'asphalt')
    width=attr('osm_width',i,0) or rule('width',i,0)
    try:width=float(width or 0)
    except (TypeError,ValueError):width=0
    if not math.isfinite(width) or width<=0:width={'motorway':12,'primary':10,'secondary':9,'tertiary':8,'residential':7,'service':4,'footway':2,'path':2,'cycleway':2,'steps':2}.get(cls,6)
    result['roads'].append({'id':str(fid),'parts':p,'width':min(40,max(1,width)),'class':cls,'surface':str(surface),'name':attr('name',i),'sidewalk':attr('osm_sidewalk',i),'level':attr('osm_layer',i,0)})
   else:
    if attr('is_underground',i,False):continue
    result['buildings'].append({'id':str(fid),'parts':p,'name':attr('name',i)})
 print('Map assembled',len(result['roads']),len(result['buildings']),flush=True)
 return result

class Server(ThreadingHTTPServer):
 request_queue_size=128
 daemon_threads=True

class Handler(SimpleHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT/'web'),**kw)
 def do_POST(self):
  if self.path!='/api/stop' or self.headers.get('X-Stop-Token')!=STOP_TOKEN:return self.reply({'error':'Forbidden'},403)
  self.reply({'stopping':True});threading.Thread(target=self.server.shutdown,daemon=True).start()
 def reply(self,value,status=200):
  b=json.dumps(value,allow_nan=False,separators=(',',':')).encode()
  compressed=len(b)>4096 and 'gzip' in self.headers.get('Accept-Encoding','')
  if compressed:b=gzip.compress(b,compresslevel=3)
  self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
  if compressed:self.send_header('Content-Encoding','gzip')
  self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
  if self.path.startswith('/api/data'):print('Map response sent',len(b),flush=True)
 def do_GET(self):
  u=urlparse(self.path);q=parse_qs(u.query)
  try:
   if u.path=='/api/health':return self.reply({'ok':True,'prototype':True,'adapter':str(ADAPTER)})
   if u.path=='/favicon.ico':self.send_response(204);self.end_headers();return
   if u.path=='/api/search':
    text=q.get('q',[''])[0].strip()[:180]
    if len(text)<3:raise ValueError('Enter a place and city, or latitude, longitude')
    raw=FETCH.get('https://photon.komoot.io/api/?limit=6&q='+quote(text),kind='demand').body
    out=[]
    for f in json.loads(raw).get('features',[]):
     p=f['properties'];lon,lat=f['geometry']['coordinates']
     out.append({'lat':lat,'lon':lon,'label':', '.join(dict.fromkeys(str(p[k]) for k in ('name','street','city','state','country') if p.get(k)))})
    return self.reply(out)
   if u.path=='/api/data':return self.reply(features(*location(q)))
   if u.path=='/api/image':
    lat,lon=location(q);tx=int(number(q,'x',0,-100000,100000));ty=int(number(q,'y',0,-100000,100000))
    key=hashlib.sha256(f'v2:{lat:.7f}:{lon:.7f}:{tx}:{ty}'.encode()).hexdigest()
    path=IMAGES/(key+'.jpg');sources=IMAGES/(key+'.json')
    if not path.exists():
     with IMAGE_GATE:
      if not path.exists():
       rgb,used=IMG.render(geodesy.EnuFrame(lat,lon),tx*TILE,-(ty+1)*TILE,TILE,512)
       b=io.BytesIO();Image.fromarray(rgb).save(b,format='JPEG',quality=91)
       tmp=path.with_suffix('.tmp');tmp.write_bytes(b.getvalue());tmp.replace(path)
       sources.write_text(json.dumps(used))
       # Bound only this prototype's disposable rendered imagery cache to 384 MiB.
       files=list(IMAGES.glob('*.jpg'))
       if sum(f.stat().st_size for f in files)>384*1024**2:
        for old in sorted(files,key=lambda f:f.stat().st_mtime)[:max(1,len(files)//8)]:
         if old!=path:old.unlink(missing_ok=True);old.with_suffix('.json').unlink(missing_ok=True)
    b=path.read_bytes();self.send_response(200);self.send_header('Content-Type','image/jpeg');self.send_header('Cache-Control','private, max-age=86400');self.send_header('X-Imagery-Sources',sources.read_text() if sources.exists() else '{}');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
   if u.path=='/api/credits':return self.reply({'imagery':imagery.ATTRIBUTION,'note':'Local visual research prototype. Individual source licences apply; imagery resolution varies by location. Overture, OpenStreetMap, Microsoft, TomTom. See README.'})
   if u.path.startswith('/api/'):return self.reply({'error':'Unknown endpoint'},404)
   return super().do_GET()
  except (BrokenPipeError,ConnectionResetError):pass
  except Exception as e:
   print(type(e).__name__,str(e),flush=True)
   try:self.reply({'error':str(e),'type':type(e).__name__},503)
   except (BrokenPipeError,ConnectionResetError):pass
 def log_message(self,*a):pass

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=47840);p.add_argument('--no-browser',action='store_true');a=p.parse_args()
 server=Server(('127.0.0.1',a.port),Handler)
 (ROOT/'server-token.txt').write_text(STOP_TOKEN)
 print(f'RacingVibes Earth prototype: http://127.0.0.1:{a.port} (close this process to stop)',flush=True)
 if not a.no_browser:webbrowser.open(f'http://127.0.0.1:{a.port}')
 server.serve_forever()
