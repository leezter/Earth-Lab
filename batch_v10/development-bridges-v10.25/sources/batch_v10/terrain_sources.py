"""Bounded reads from the existing installed DEM adapter, never its scene overrides."""
import hashlib
import json
from pathlib import Path

import numpy as np
import earth_backend as backend
import dem

POLICY = 'installed-ground-v1:z15:grid6m:binomial3:relative-only'


def read(lat, lon, half=420, step=6):
    xs = np.arange(-half, half+step/2, step)
    X,Y = np.meshgrid(xs,xs)
    scale = np.cos(np.radians(lat))*111319.490793
    reader = dem.Dem(str(backend.CACHE/'dem'), fetch_workers=4, mem_tiles=48, fetcher=backend.FETCH)
    try:
        # sample() also applies installed landmark overrides. _sample is the
        # underlying DEM read only; use no per-location landmark adjustments.
        values = np.asarray(reader._sample(lat-Y/111319.490793,lon+X/scale,15),dtype=float)
        if not np.isfinite(values).all():
            raise ValueError('Elevation contains nodata')
        providers = sorted({v for v in reader.served.values() if v})
        if not providers:
            raise ValueError('Elevation adapter supplied no identified provider')
        # Suppress isolated ground-filter/noise cells, without fabricating detail
        # by treating the sample spacing as the source resolution.
        p = np.pad(values,1,mode='edge')
        values = sum(p[dy:dy+len(xs),dx:dx+len(xs)]*w for dx,dy,w in
                     [(1,1,4),(0,1,2),(2,1,2),(1,0,2),(1,2,2),(0,0,1),(0,2,1),(2,0,1),(2,2,1)])/16
        reference = float(values[len(xs)//2,len(xs)//2])
        grid = np.round(values-reference,4).tolist()
        inputs = []
        for (z,x,y),provider in sorted(reader.served.items()):
            if provider not in {'mapterhorn','aws-terrarium'}:
                continue
            ext = 'webp' if provider=='mapterhorn' else 'png'
            path = backend.CACHE/'dem'/provider/str(z)/str(x)/(str(y)+'.'+ext)
            if path.is_file():
                inputs.append({'provider':provider,'tile':[z,x,y],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        source = {'status':'available','policy':POLICY,'providers':providers,
                  'adapter_sha256':hashlib.sha256(Path(dem.__file__).read_bytes()).hexdigest(),
                  'adapter_decoded_version':dem.DECODED_VERSION,'requested_zoom':15,
                  'native_resolution':'Provider dependent; z15 can upsample coarser ground-filtered DSM',
                  'datum':'Provider-dependent orthometric heights; relative scene reference only',
                  'absolute_reference_m':reference,'osm_ele_policy':'Retained, not fused without verified datum conversion',
                  'attribution':'Mapterhorn and upstream terrain providers; AWS Terrain Tiles where used',
                  'source_urls':['https://mapterhorn.com/attribution','https://github.com/tilezen/joerd/blob/master/docs/attribution.md'],
                  'inputs':inputs,'stats':reader.stats_snapshot()}
        result={'origin':[-half,-half],'step':step,'heights':grid,'embankments':[],'source':source}
    except (OSError, ValueError, RuntimeError) as e:
        result=flat(half,step)
        result['source'].update(warning=str(e))
    finally:
        for pool in (reader.pool,reader.urgent_pool,reader.probe_pool):
            pool.shutdown(wait=True)
    result['source']['sample_sha256']=hashlib.sha256(json.dumps(result['heights'],separators=(',',':')).encode()).hexdigest()
    return result


def flat(half=420,step=6):
    count=round(half*2/step)+1
    return {'origin':[-half,-half],'step':step,'heights':[[0.0]*count for _ in range(count)],
            'embankments':[],'source':{'status':'flat fallback','policy':POLICY,'datum':'local arbitrary zero',
            'warning':'Terrain unavailable; no surveyed elevation or clearance is implied'}}
