"""Serial, persistent custom-area jobs, separate from the frozen batch report."""
from pathlib import Path
import json,hashlib,math,threading,subprocess,sys,shutil
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parent
STORE=ROOT/'custom';STORE.mkdir(exist_ok=True)
POOL=ThreadPoolExecutor(max_workers=1);LOCK=threading.Lock();ACTIVE=set()
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def save(p,d):
 tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(d,indent=2),encoding='utf-8');tmp.replace(p)
def entries():return [read(p)for p in STORE.glob('*/job.json')]
def directory(sid):
 if not sid.startswith('place-')or len(sid)!=22 or any(c not in '0123456789abcdef'for c in sid[6:]):raise ValueError('Invalid area ID')
 return STORE/sid
def submit(lat,lon,name):
 lat=float(lat);lon=float(lon)
 if not math.isfinite(lat+lon)or abs(lat)>84 or abs(lon)>180:raise ValueError('Choose coordinates within 84 degrees latitude')
 freeze=read(ROOT/'freeze.json');key=json.dumps([round(lat,6),round(lon,6),freeze['source_hashes']],sort_keys=True)
 sid='place-'+hashlib.sha256(key.encode()).hexdigest()[:16];folder=directory(sid);folder.mkdir(exist_ok=True);p=folder/'job.json'
 with LOCK:
  if p.exists():
   old=read(p)
   if old['status']=='built' or sid in ACTIVE:return old
  if shutil.disk_usage(ROOT).free<3*1024**3:raise ValueError('At least 3 GB free space is needed to generate another area')
  if len(ACTIVE)>=4:raise ValueError('The generation queue is full. Wait for an area to finish.')
  d={'id':sid,'name':str(name or 'Custom location')[:160],'lat':lat,'lon':lon,'status':'queued'};save(p,d);ACTIVE.add(sid);POOL.submit(work,sid)
  return d
def work(sid):
 folder=directory(sid)
 try:
  with (folder/'worker.log').open('w')as log:
   result=subprocess.run([sys.executable,str(ROOT/'custom_worker.py'),sid],stdout=log,stderr=subprocess.STDOUT,timeout=2400,cwd=ROOT.parent)
  if result.returncode:raise RuntimeError('Generation failed; see the area worker log')
 except Exception as e:
  p=folder/'job.json';d=read(p)
  if d.get('status')!='failed':d.update(status='failed',error=str(e));save(p,d)
 finally:
  with LOCK:ACTIVE.discard(sid)
def resume_queued():
 for d in entries():
  if d['status']=='queued':
   with LOCK:ACTIVE.add(d['id']);POOL.submit(work,d['id'])
