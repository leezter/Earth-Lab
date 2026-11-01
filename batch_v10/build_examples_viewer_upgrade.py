"""Reuse baked outputs only when a NEW freeze changes viewer files exclusively.

Renderer inputs, source evidence and model geometry remain identical. New job
and content identities are created, all image/geometry checks run again, and
the reuse is recorded explicitly. Original jobs and logs are never overwritten.
"""
import argparse,hashlib,json,shutil,time
from pathlib import Path
import custom_places as jobs
from validation import outputs


def upgrade(previous):
    root=jobs.ROOT;current=jobs.read(root/'freeze.json')
    old=jobs.read(root/('development-'+previous)/'source-manifest.json')
    if set(old['source_hashes'])!=set(current['source_hashes']):raise ValueError('Frozen input set changed; full generation required')
    changed=[p for p,h in current['source_hashes'].items()if old['source_hashes'][p]!=h]
    if not changed or any(not p.startswith('batch_v10/web/')for p in changed):
        raise ValueError('Only viewer-file changes permit this reuse; full generation required')
    for p,h in current['source_hashes'].items():
        if hashlib.sha256((root.parent/p).read_bytes()).hexdigest()!=h:raise ValueError('Current frozen input changed: '+p)
    report={'from':previous,'to':current['id'],'changed_viewer_files':changed,
            'renderer_inputs_unchanged':True,'builds':[]}
    report_path=root/'viewer-upgrade-report.json'
    if report_path.exists():
        saved=jobs.read(report_path)
        if saved.get('from')==previous and saved.get('to')==current['id']:report=saved
    for job in jobs.entries():
        if job.get('renderer_freeze')!=previous or job['status']!='built':continue
        start=time.monotonic();source=jobs.directory(job['id'])
        sid=jobs.fixture_identifier(job['fixture'])if job.get('fixture')else jobs.identifier(job['lat'],job['lon'])
        target=jobs.directory(sid)
        if target.exists():
            existing=jobs.read(target/'job.json')
            if existing['status']=='built':continue
            raise ValueError('Refusing to overwrite an existing attempt: '+sid)
        # Copy model/provenance and images. Render logs stay at the original job.
        shutil.copytree(source,target,ignore=shutil.ignore_patterns('*.log','job.json','acceptance.json','street-6144.png','bridge-*.png'))
        data=jobs.read(target/'district-data.json');s=data['scene'];inputs=jobs.read(target/'pavement-inputs.json')
        content={'freeze':current['id'],'sources':inputs,'terrain':s['terrain'],'network':s['surface_network']}
        identity=hashlib.sha256(json.dumps(content,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        data['renderer_freeze']=s['renderer_freeze']=current['id'];data['content_identity']=identity
        s['bake'].update(tile_url='/baked/'+sid+'/',content_identity=identity)
        jobs.save(target/'district-data.json',data)
        geometry=jobs.read(target/'geometry.json');geometry.update(renderer_freeze=current['id'],bake=s['bake']);jobs.save(target/'geometry.json',geometry)
        manifest=jobs.read(target/'baked/manifest.json');manifest['content_identity']=identity;jobs.save(target/'baked/manifest.json',manifest)
        reuse={'type':'viewer-only upgrade','original_job':job['id'],'original_freeze':previous,
               'current_freeze':current['id'],'changed_viewer_files':changed,'renderer_inputs_unchanged':True,
               'original_generation_seconds':job.get('render_cache_reuse',{}).get('original_generation_seconds',job['total_seconds']),
               'previous_reuse':job.get('render_cache_reuse'),'images_rerendered':False}
        jobs.save(target/'cache-reuse.json',reuse)
        d={**job,'id':sid,'renderer_freeze':current['id'],'status':'validating cached outputs',
           'content_identity':identity,'render_cache_reuse':reuse};jobs.save(target/'job.json',d)
        try:
            acceptance=outputs(target);jobs.save(target/'acceptance.json',acceptance)
            d.update(status='built',acceptance=acceptance,total_seconds=time.monotonic()-start);jobs.save(target/'job.json',d)
        except Exception as error:
            d.update(status='failed',error=str(error));jobs.save(target/'job.json',d);raise
        report['builds'].append({'id':sid,'original_job':job['id'],'name':d['name'],'acceptance':acceptance})
        jobs.save(root/'viewer-upgrade-report.json',report);print(sid,d['name'],'revalidated cached images',flush=True)
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--from-freeze',required=True);args=parser.parse_args();upgrade(args.from_freeze)
