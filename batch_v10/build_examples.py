"""Submit one real or synthetic job and wait for an actual terminal result."""
import argparse,json,time
import custom_places as jobs

EXAMPLES=[('overpass',), (52.4974739,13.4484894,'Schlesische bridge - Berlin'),
          (51.5700,-.1385,'Hornsey Lane bridge - London'),(46.80492,7.17226,'Gotteron bridge - Fribourg'),
          (55.95305,-3.2144,'Dean Bridge - Edinburgh'),(52.4971,13.44561,'Kreuzberg - ground regression'),
          ('hills',),('flat',)]


def wait(d):
    previous=None
    while True:
        d=jobs.read(jobs.directory(d['id'])/'job.json')
        if d['status']!=previous:print(d['id'],d['name'],d['status'],d.get('error',''),flush=True);previous=d['status']
        if d['status']in {'built','failed'}:return d
        time.sleep(2)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--all',action='store_true');p.add_argument('--fixture',choices=['overpass','hills','flat','junctions']);p.add_argument('--lat',type=float);p.add_argument('--lon',type=float);p.add_argument('--name',default='Bridge test location');a=p.parse_args()
    if a.all:
        results=[]
        for example in EXAMPLES:
            submitted=jobs.submit_fixture(example[0])if len(example)==1 else jobs.submit(*example)
            cached=submitted['status']=='built';d=wait(submitted)
            results.append({k:d.get(k)for k in ('id','name','fixture','renderer_freeze','status','error','total_seconds','bridge_count','acceptance')})
            results[-1]['cached_at_submission']=cached
            (jobs.ROOT/'build-examples-report.json').write_text(json.dumps(results,indent=2))
        raise SystemExit(1 if any(d['status']=='failed'for d in results)else 0)
    d=jobs.submit_fixture(a.fixture)if a.fixture else jobs.submit(a.lat,a.lon,a.name)
    d=wait(d)
    print(json.dumps({k:d.get(k)for k in ('id','name','status','error','total_seconds','bridge_count','acceptance')},indent=2))
    if d['status']=='failed':raise SystemExit(1)
