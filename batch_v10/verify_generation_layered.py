"""Serial, reproducible acceptance requests; preserves actual cache/build status."""
import custom_places as jobs
from build_examples import wait

CASES=['junctions',(53.726589,-1.860018),(53.72558,-1.859568),
       (53.726006,-1.859824),(53.727338,-1.859579),'overpass','flat','hills']


if __name__=='__main__':
    report={'renderer':jobs.read(jobs.ROOT/'freeze.json')['id'],
            'scope':'Serial fixtures and original Halifax requests; no manual crop or geometry adjustment',
            'source_cache_policy':'Reuse retained raw sources when available; no fresh acquisition claim',
            'builds':[]}
    for case in CASES:
        d=jobs.submit_fixture(case)if isinstance(case,str)else jobs.submit(*case,'Halifax viaducts '+str(case))
        cached=d['status']=='built';d=wait(d)
        report['builds'].append({**d,'cached_at_submission':cached,
                                'fresh_render_during_this_check':not cached and d['status']=='built'and not d.get('render_cache_reuse')})
        jobs.save(jobs.ROOT/'layered-generation-verification.json',report)
    raise SystemExit(int(any(d['status']!='built'for d in report['builds'])))
