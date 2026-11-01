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
 import re
 if not re.fullmatch(r'(?:place|fixture)-[0-9a-f]{16}',sid):raise ValueError('Invalid area ID')
 return STORE/sid
def identifier(lat,lon):
 freeze=read(ROOT/'freeze.json');key=json.dumps([round(float(lat),6),round(float(lon),6),freeze['source_hashes']],sort_keys=True)
 return 'place-'+hashlib.sha256(key.encode()).hexdigest()[:16]

def fixture_identifier(name):
 freeze=read(ROOT/'freeze.json');key=json.dumps([name,freeze['source_hashes']],sort_keys=True)
 return 'fixture-'+hashlib.sha256(key.encode()).hexdigest()[:16]

def submit_fixture(name):
 if name not in {'overpass','hills','flat'}:raise ValueError('Unknown synthetic fixture')
 sid=fixture_identifier(name);folder=directory(sid);folder.mkdir(exist_ok=True);p=folder/'job.json'
 with LOCK:
  if p.exists() and (read(p)['status']=='built' or sid in ACTIVE):return read(p)
  d={'id':sid,'fixture':name,'name':'Synthetic '+name+' test','lat':0,'lon':{'overpass':0,'hills':.01,'flat':.02}[name],
     'status':'queued','renderer_freeze':read(ROOT/'freeze.json')['id']}
  save(p,d);ACTIVE.add(sid);POOL.submit(work,sid);return d

def submit(lat,lon,name):
 lat=float(lat);lon=float(lon)
 if not math.isfinite(lat+lon)or abs(lat)>84 or abs(lon)>180:raise ValueError('Choose coordinates within 84 degrees latitude')
 freeze=read(ROOT/'freeze.json')
 sid=identifier(lat,lon);folder=directory(sid);folder.mkdir(exist_ok=True);p=folder/'job.json'
 with LOCK:
  if p.exists():
   old=read(p)
   if old['status']=='built' or sid in ACTIVE:return old
  if shutil.disk_usage(ROOT).free<3*1024**3:raise ValueError('At least 3 GB free space is needed to generate another area')
  if len(ACTIVE)>=4:raise ValueError('The generation queue is full. Wait for an area to finish.')
  d={'id':sid,'name':str(name or 'Custom location')[:160],'lat':lat,'lon':lon,'status':'queued','renderer_freeze':freeze['id']};save(p,d);ACTIVE.add(sid);POOL.submit(work,sid)
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
