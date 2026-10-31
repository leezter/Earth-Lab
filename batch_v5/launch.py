from pathlib import Path
import urllib.request,json,subprocess,sys,time,webbrowser,ctypes
ROOT=Path(__file__).resolve().parent;URL='http://127.0.0.1:47847'
def alive():
 try:
  with urllib.request.urlopen(URL+'/api/health',timeout=2)as r:return json.load(r).get('edition')=='pavements-v5'
 except Exception:return False
try:
 if not alive():
  with open(ROOT/'server.log','a',buffering=1)as f:p=subprocess.Popen([sys.executable,str(ROOT/'batch_server.py'),'--no-browser'],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
  (ROOT/'server.pid').write_text(str(p.pid))
  for _ in range(40):
   if alive():break
   if p.poll()is not None:raise RuntimeError(f'Batch viewer failed. See {ROOT / "server.log"}.')
   time.sleep(.25)
  else:raise RuntimeError('Batch viewer did not start')
 webbrowser.open(URL+'/gallery.html')
except Exception as e:ctypes.windll.user32.MessageBoxW(0,str(e),'Earth Lab · Pavements v5',0x10)
