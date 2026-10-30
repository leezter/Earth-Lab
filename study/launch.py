from pathlib import Path
import urllib.request,json,subprocess,sys,time,webbrowser,ctypes
ROOT=Path(__file__).resolve().parent;URL='http://127.0.0.1:47842'
def alive():
 try:
  with urllib.request.urlopen(URL+'/api/health',timeout=2)as r:return json.load(r).get('edition')=='baked-3d'
 except Exception:return False
try:
 if not(ROOT/'baked/manifest.json').exists():raise RuntimeError('Baked tiles missing. See study/README.md for the build steps.')
 if not alive():
  with open(ROOT/'server.log','a',buffering=1)as log:p=subprocess.Popen([sys.executable,str(ROOT/'study_server.py'),'--no-browser'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
  (ROOT/'server.pid').write_text(str(p.pid))
  for _ in range(40):
   if alive():break
   if p.poll()is not None:raise RuntimeError('Server failed. See study/server.log.')
   time.sleep(.25)
  else:raise RuntimeError('Server startup timed out.')
 webbrowser.open(URL)
except Exception as e:ctypes.windll.user32.MessageBoxW(0,str(e),'Earth Lab · 3D-baked street',0x10)
