"""End-to-end frozen held-out requests, without crop or geometry adjustments."""
import hashlib,json,time
import custom_places as jobs
from probe_bridges import UNSEEN

freeze=jobs.read(jobs.ROOT/'freeze.json')
for name,digest in freeze['source_hashes'].items():
    if hashlib.sha256((jobs.ROOT.parent/name).read_bytes()).hexdigest()!=digest:raise ValueError('Frozen input changed: '+name)
report={'renderer':freeze['id'],'scope':'End-to-end generation gates; browser and visual review recorded separately',
        'manual_crop_or_geometry_adjustments':False,'cases':[]}
for name,lat,lon in UNSEEN:
    d=jobs.submit(lat,lon,'Held-out: '+name);cached=d['status']=='built';previous=None
    while True:
        d=jobs.read(jobs.directory(d['id'])/'job.json')
        if d['status']!=previous:print(name,d['status'],d.get('error',''),flush=True);previous=d['status']
        if d['status']in {'built','failed'}:break
        time.sleep(2)
    report['cases'].append({k:d.get(k)for k in ('id','name','lat','lon','actual_lat','actual_lon','automatic_road_snap_metres','status','error','total_seconds','bridge_count','acceptance')})
    report['cases'][-1]['cached_at_submission']=cached
    report['counts']={status:sum(c['status']==status for c in report['cases'])for status in ('built','failed')}
    jobs.save(jobs.ROOT/'heldout-generation-verification.json',report)
print(json.dumps(report,indent=2))
