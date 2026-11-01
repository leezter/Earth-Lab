"""Viewer-only Photon client, independent of the frozen renderer fetch cache."""
import json
import math
import threading
import time
import urllib.parse
import urllib.request
from functools import lru_cache

LOCK=threading.Lock()
LAST_REQUEST=0.

@lru_cache(maxsize=256)
def reverse(lat,lon):
    global LAST_REQUEST
    with LOCK:
        time.sleep(max(0,1-(time.monotonic()-LAST_REQUEST)))
        LAST_REQUEST=time.monotonic()
        request=urllib.request.Request('https://photon.komoot.io/reverse?'+urllib.parse.urlencode({'lat':lat,'lon':lon,'lang':'en'}),headers={'User-Agent':'EarthLab/9 (local desktop map visualisation)','Accept':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=8)as response:data=json.loads(response.read(1024*1024))
        except Exception:return None
    for feature in data.get('features',[]):
        p=feature.get('properties',{})
        street=p.get('street') or (p.get('name') if p.get('osm_key')=='highway' else None)
        area=p.get('city') or p.get('district') or p.get('county') or p.get('state')
        if street and area:return ', '.join(dict.fromkeys([street,area]))
    return None

@lru_cache(maxsize=128)
def search(text):
    global LAST_REQUEST
    text=text.strip()[:180]
    if len(text)<3:
        raise ValueError('Enter at least three characters, or latitude, longitude')
    with LOCK:
        time.sleep(max(0,1-(time.monotonic()-LAST_REQUEST)))
        LAST_REQUEST=time.monotonic()
        request=urllib.request.Request('https://photon.komoot.io/api/?'+urllib.parse.urlencode({'limit':6,'q':text,'lang':'en'}),
            headers={'User-Agent':'EarthLab/6 (local desktop map visualisation)','Accept':'application/json'})
        with urllib.request.urlopen(request,timeout=12)as response:
            data=json.loads(response.read(1024*1024))
    out=[]
    for feature in data.get('features',[]):
        props=feature.get('properties',{});coords=feature.get('geometry',{}).get('coordinates',[])
        if len(coords)<2:continue
        lon,lat=map(float,coords[:2])
        if not math.isfinite(lat+lon)or abs(lat)>84 or abs(lon)>180:continue
        label=', '.join(dict.fromkeys(str(props[k])for k in ('name','street','city','state','country')if props.get(k)))
        out.append({'lat':lat,'lon':lon,'label':label or f'{lat}, {lon}'})
    return out
