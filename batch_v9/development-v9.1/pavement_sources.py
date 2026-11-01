"""Bounded pavement evidence. Existing survey files are opened read-only.

OSM responses are retained in this edition's cache, never in the installed adapters.
No map-source failure is silently interpreted as an absence of pavements.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import sqlite3
import urllib.parse
import urllib.request
import zlib
import xml.etree.ElementTree as ET

from shapely.geometry import box
from shapely.ops import transform
from shapely import from_wkb

ROOT = Path(__file__).resolve().parent
SURVEY_SOURCE = 'https://gdi.berlin.de/services/wfs/strassenbefahrung'
SURVEY_CODES = {
    '01': ('concrete', None), '02': ('asphalt', None),
    '03': ('mosaic', .05), '04': ('small_sett', .09),
    '05': ('sett', .18), '06': ('paving_blocks', .20),
    '07': ('walk_slabs', .35), '08': ('stone_slabs', .50),
    '09': ('stone_slabs', .80), '10': ('walk_slabs', .60),
    '11': ('asphalt', None), '12': ('asphalt', None),
    '13': ('compacted', None), '14': ('sand', None), '15': ('grass', None),
}


def survey_path():
    if os.environ.get('EARTH_LAB_PAVEMENT_SURVEY'):
        return Path(os.environ['EARTH_LAB_PAVEMENT_SURVEY'])
    config = Path(os.environ['LOCALAPPDATA']) / 'Programs/BeamNG.Earth.Landmark.Exploration/streets-data-paths.json'
    if config.exists():
        value = json.loads(config.read_text()).get('survey')
        if value:
            return Path(value)
    return None


def survey(lat, lon, half=420):
    info = {'source': SURVEY_SOURCE, 'status': 'outside coverage', 'features': 0}
    if not (52.32 <= lat <= 52.69 and 13.07 <= lon <= 13.78):
        return [], info
    path = survey_path()
    if path is None or not path.is_file():
        return [], {**info, 'status': 'unavailable', 'warning': 'Local Berlin pavement survey is not installed.'}
    from pyproj import Transformer
    forward = Transformer.from_crs(4326, 25833, always_xy=True)
    inverse = Transformer.from_crs(25833, 4326, always_xy=True)
    scale = math.cos(math.radians(lat)) * 111319.490793
    corners = [(lon + x/scale, lat-y/111319.490793) for x in (-half, half) for y in (-half, half)]
    points = [forward.transform(*p) for p in corners]
    x0, y0 = min(p[0] for p in points)-2, min(p[1] for p in points)-2
    x1, y1 = max(p[0] for p in points)+2, max(p[1] for p in points)+2
    def project(x, y, z=None):
        import numpy as np
        lo, la = inverse.transform(x, y)
        return (np.asarray(lo)-lon)*scale, -(np.asarray(la)-lat)*111319.490793
    rows = []
    try:
        with sqlite3.connect(path.resolve().as_uri()+'?mode=ro&immutable=1', uri=True) as db:
            meta = {k: json.loads(v) for k, v in db.execute('SELECT key,value FROM metadata')}
            if meta.get('schema') != 2 or meta.get('crs') != 'EPSG:25833' or meta.get('complete') is not True:
                raise ValueError('Incompatible or incomplete survey database')
            records = db.execute('''SELECT f.id,f.layer,f.material,f.geom FROM bounds b
                CROSS JOIN features f ON f.id=b.id WHERE b.minx<=? AND b.maxx>=?
                AND b.miny<=? AND b.maxy>=? ORDER BY f.id''', (x1, x0, y1, y0))
            digest = hashlib.sha256()
            for fid, layer, material, blob in records:
                if layer not in {'cl_gehweg', 'by_gehwegueberfahrt', 'bn_baumscheibe', 'cm_fahrbahn', 'ck_parkflaeche'}:
                    continue
                g = transform(project, from_wkb(zlib.decompress(blob))).buffer(0).intersection(box(-half, -half, half, half))
                if g.is_empty:
                    continue
                digest.update(str((fid, layer, material)).encode()); digest.update(blob)
                rows.append({'id': str(fid), 'layer': layer, 'material': str(material).zfill(2), 'geometry': g})
        return rows, {**info, 'status': 'available', 'features': len(rows),
                      'metadata': meta, 'local_features_sha256': digest.hexdigest(),
                      'warning': 'Survey dates from 2014/2015; later street changes are not represented.'}
    except (OSError, ValueError, sqlite3.Error) as e:
        return [], {**info, 'status': 'unavailable', 'warning': str(e)}


def relevant(tags):
    return ('highway' in tags or 'area:highway' in tags or 'barrier' in tags or 'road_marking' in tags
            or tags.get('amenity') in {'parking','parking_space','fuel','car_wash','bicycle_parking','shelter','bench','waste_basket'}
            or tags.get('man_made') in {'courtyard','works'}
            or tags.get('landuse') in {'industrial','garages','depot','grass','forest','meadow','flowerbed'}
            or tags.get('natural') in {'water','wood','scrub'} or tags.get('leisure')=='garden' or 'public_transport' in tags or 'kerb' in tags or 'tactile_paving' in tags)


def parse_osm(payload):
    xml = ET.fromstring(payload)
    node_elements = {n.get('id'):n for n in xml.findall('node')}
    nodes = {fid:{'lon':float(n.get('lon')),'lat':float(n.get('lat'))} for fid,n in node_elements.items()}
    ways = {}
    for way in xml.findall('way'):
        refs = [n.get('ref') for n in way.findall('nd')]
        if not all(ref in nodes for ref in refs):
            continue
        tags = {t.get('k'):t.get('v') for t in way.findall('tag')}
        ways[way.get('id')] = {'type':'way','id':int(way.get('id')),'tags':tags,
            'version':way.get('version'),'timestamp':way.get('timestamp'),
            'nodes':refs,'geometry':[nodes[ref] for ref in refs]}
    elements = [w for w in ways.values() if relevant(w['tags'])]
    for relation in xml.findall('relation'):
        tags = {t.get('k'):t.get('v') for t in relation.findall('tag')}
        if not relevant(tags):
            continue
        members = [m for m in relation.findall('member') if m.get('type')=='way']
        complete = all(m.get('ref') in ways for m in members)
        elements.append({'type':'relation','id':int(relation.get('id')),'tags':tags,
            'version':relation.get('version'),'timestamp':relation.get('timestamp'),
            'geometry_complete':complete,'members':[{'role':m.get('role'),'geometry':ways[m.get('ref')]['geometry']}
                for m in members if m.get('ref') in ways]})
    for fid,n in node_elements.items():
        tags = {t.get('k'):t.get('v') for t in n.findall('tag')}
        if relevant(tags):
            elements.append({'type':'node','id':int(fid),'tags':tags,'version':n.get('version'),
                             'timestamp':n.get('timestamp'),'geometry':[nodes[fid]]})
    return {'elements':elements},xml.get('timestamp')


def osm(lat, lon, half=420):
    scale = math.cos(math.radians(lat))*111319.490793
    bounds = [lat-half/111319.490793, lon-half/scale, lat+half/111319.490793, lon+half/scale]
    bbox = ','.join(f'{bounds[i]:.7f}' for i in (1,0,3,2))
    endpoint = 'https://www.openstreetmap.org/api/0.6/map?bbox='+bbox
    cache = ROOT/'cache/osm';cache.mkdir(parents=True, exist_ok=True)
    path = cache/(hashlib.sha256(('mobility-v9:'+endpoint).encode()).hexdigest()+'.json')
    if path.exists():
        data = json.loads(path.read_text(encoding='utf-8'))
        return data['response'], {**data['provenance'], 'cache_reused': True}
    errors = []
    for endpoint in (endpoint,):
        try:
            request = urllib.request.Request(endpoint, headers={'User-Agent': 'EarthLab-Mobility/9 (local map visualisation)'})
            with urllib.request.urlopen(request, timeout=20) as r:
                payload = r.read(20*1024*1024+1)
            if len(payload)>20*1024*1024:
                raise ValueError('OSM response exceeds bounded query size')
            response,osm_timestamp = parse_osm(payload)
            info = {'status': 'available', 'source': endpoint, 'licence': 'ODbL',
                    'retrieved_utc': datetime.now(timezone.utc).isoformat(),
                    'osm_timestamp': osm_timestamp,
                    'evidence_schema': 'mobility-v9',
                    'response_sha256': hashlib.sha256(payload).hexdigest(),
                    'features': len(response['elements']), 'cache_reused': False}
            path.write_text(json.dumps({'response': response, 'provenance': info}), encoding='utf-8')
            return response, info
        except (OSError, ValueError, ET.ParseError) as e:
            errors.append(f'{endpoint}: {e}')
    return {'elements': []}, {'status': 'unavailable', 'warnings': errors, 'features': 0}
