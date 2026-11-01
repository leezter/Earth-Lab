import copy, hashlib, json, random, unittest
from collections import Counter
from pathlib import Path
from shapely.geometry import box, Polygon
from fixtures import scene
from parking_features import compile_parking
from parked_cars import attach, choose_vehicle, shape
from surface_network import export

ROOT=Path(__file__).resolve().parent


def sample():
    s=scene('flat')['scene']
    s['parking_report']['records']=[dict(id=str(i),parts=export(box(x,-22,x+6.4,-19.3)),
        source_tags={'amenity':'parking_space','parking':'surface'}) for i,x in enumerate(range(-78,79,8))]
    return s


class ParkedCarTests(unittest.TestCase):
    def test_catalog_complete_and_hashed(self):
        catalog=json.loads((ROOT/'web/parked-assets/manifest.json').read_text())['vehicles']
        self.assertEqual(len(catalog),151)
        self.assertEqual(len({v['kind'] for v in catalog}),21)
        for v in catalog:
            self.assertEqual(hashlib.sha256((ROOT/'web'/v['asset']).read_bytes()).hexdigest(),v['sha256'])
        self.assertEqual({v['kind'] for v in catalog if v['weight'] < 1},{'DuneraX1','RavikR'})

    def test_stable_partial_occupancy_and_footprints(self):
        a=sample(); b=copy.deepcopy(a); attach(a); attach(b)
        self.assertEqual(a['parked_cars'],b['parked_cars'])
        self.assertGreater(len(a['parked_cars']),3)
        self.assertLess(len(a['parked_cars']),20)
        used=Polygon()
        domains={r['id']:shape(r['parts']) for r in a['parking_report']['records']}
        for car in a['parked_cars']:
            g=shape(car['parts'])
            self.assertTrue(domains[car['source_id']].covers(g))
            self.assertFalse(used.intersects(g))
            used=used.union(g)

    def test_no_parking_evidence_no_cars(self):
        s=scene('flat')['scene'];attach(s);self.assertEqual(s['parked_cars'],[])

    def test_protected_spaces_and_ground_obstacles(self):
        s=sample();s['pavements']=[p for r in s['parking_report']['records'] for p in r['parts']]
        attach(s);self.assertEqual(s['parked_cars'],[])
        s=sample()
        for r in s['parking_report']['records']:r['source_tags']['parking_space']='disabled'
        attach(s);self.assertEqual(s['parked_cars'],[])

    def test_unknown_lot_and_elevated_parking_omitted(self):
        s=sample()
        for r in s['parking_report']['records']:r['source_tags']={'amenity':'parking'}
        attach(s);self.assertEqual(s['parked_cars'],[])
        s=sample();s['surface_network']['surfaces'][0]['kind']='deck'
        s['surface_network']['surfaces'][0]['parts']=export(box(-100,-30,100,0))
        attach(s);self.assertEqual(s['parked_cars'],[])

    def test_roadside_evidence_curvature_and_remaining_lane(self):
        elements=[dict(type='way',id=42,nodes=[1,2],geometry=[{'lon':-90,'lat':0},{'lon':90,'lat':0}],
            tags={'highway':'residential','width':'10','parking:both':'lane','parking:both:orientation':'parallel'})]
        _,_,report=compile_parking({'elements':elements},lambda p:p,box(-95,-5,95,5),Polygon(),Polygon(),Polygon(),{})
        s=scene('flat')['scene'];s['parking_report']=report;attach(s)
        self.assertGreater(len(s['parked_cars']),10)
        for car in s['parked_cars']:
            self.assertGreater(abs(car['y']),3)
            self.assertFalse(shape(car['parts']).intersects(box(-100,-2.8,100,2.8)))

    def test_buggy_rare_and_all_variants_selectable(self):
        catalog=json.loads((ROOT/'web/parked-assets/manifest.json').read_text())['vehicles']
        r=random.Random(719);counts=Counter();variants=set()
        for _ in range(60000):
            v=choose_vehicle(catalog,r);counts[v['kind']]+=1;variants.add((v['kind'],v['variant']))
        self.assertEqual(len(variants),151)
        self.assertLess(counts['DuneraX1']+counts['RavikR'],150)
        self.assertTrue(all(counts[k]>2000 for k in counts if k not in {'DuneraX1','RavikR'}))


if __name__=='__main__': unittest.main()
