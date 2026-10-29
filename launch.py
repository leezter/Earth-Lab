from pathlib import Path
import urllib.request,json,subprocess,sys,time,webbrowser,ctypes
ROOT=Path(__file__).resolve().parent;URL='http://127.0.0.1:47841'
def alive():
 try:
  with urllib.request.urlopen(URL+'/api/health',timeout=2)as r:return json.load(r).get('edition')=='rendered'
 except Exception:return False
try:
 if not alive():
  with open(ROOT/'server.log','a',buffering=1)as f:p=subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--no-browser'],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
  (ROOT/'server.pid').write_text(str(p.pid))
  for _ in range(40):
   if alive():break
   if p.poll()is not None:raise RuntimeError('Could not start rendered prototype. See server.log.')
   time.sleep(.25)
  else:raise RuntimeError('Startup timed out. See server.log.')
 webbrowser.open(URL)
except Exception as e:ctypes.windll.user32.MessageBoxW(0,str(e),'RacingVibes rendered district',0x10)
