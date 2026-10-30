from pathlib import Path
import sys,json,threading,secrets,webbrowser
from http.server import SimpleHTTPRequestHandler
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT.parent))
import earth_backend as baseline
DATA=json.loads((ROOT/'district-data.json').read_text())
class Handler(baseline.Handler):
 def __init__(self,*args,**kw):SimpleHTTPRequestHandler.__init__(self,*args,directory=str(ROOT/'web'),**kw)
 def translate_path(self,path):
  u=urlparse(path)
  if u.path.startswith('/rv/'):return str(ROOT.parent/'web'/u.path.lstrip('/'))
  if u.path.startswith('/baked/'):
   candidate=(ROOT/u.path.lstrip('/')).resolve()
   if candidate.is_relative_to(ROOT/'baked'):return str(candidate)
  return super().translate_path(path)
 def do_GET(self):
  u=urlparse(self.path)
  if u.path=='/api/data':return self.reply(DATA)
  if u.path=='/api/health':return self.reply({'ok':True,'edition':'baked-3d'})
  if u.path=='/api/search':return self.reply({'error':'This fixed street study uses the baked Kreuzberg scene. Location search returns in a later revision.'},400)
  return super().do_GET()
if __name__=='__main__':
 server=baseline.Server(('127.0.0.1',47842),Handler);(ROOT/'server-token.txt').write_text(baseline.STOP_TOKEN)
 print('3D-baked street study: http://127.0.0.1:47842',flush=True)
 if '--no-browser'not in sys.argv:webbrowser.open('http://127.0.0.1:47842')
 server.serve_forever()
