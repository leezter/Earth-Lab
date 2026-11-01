import unittest,copy
from shapely.geometry import Point,LineString
from fixtures import scene,junction_scene
from terrain import profile_at
from surface_mesh import source_shape
from surface_network import validate


class LayeredNetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.s=junction_scene()['scene']

    def test_three_way_junction_has_shared_plane(self):
        s=self.s;n=s['surface_network'];decks=[g for g in n['surfaces']if '2'in g['nodes']and g['kind']=='deck']
        self.assertEqual(len(decks),3)
        for a in decks:
            for b in decks:
                if a is b:continue
                overlap=source_shape(a['parts']).intersection(source_shape(b['parts']))
                for p in [overlap.centroid,*[Point(p)for p in overlap.exterior.coords]]:
                    self.assertAlmostEqual(profile_at(a,p.x,p.y)[0],profile_at(b,p.x,p.y)[0],places=5)

    def test_multiple_deck_levels_have_clearance(self):
        n=self.s['surface_network'];surfaces={s['id']:s for s in n['surfaces']}
        pairs=[(surfaces[r['id']],surfaces[c['surface_id']],c)for r in n['report']['records']for c in r['crossings']if surfaces[c['surface_id']]['kind']=='deck']
        self.assertEqual(len(pairs),2)
        for upper,lower,c in pairs:
            self.assertNotIn(lower['id'],upper['connections'])
            self.assertGreater(upper['render_order'],lower['render_order'])
            for p in c['clearance_samples']:
                self.assertGreaterEqual(profile_at(upper,*p)[0]-.45-profile_at(lower,*p)[0],4.6)

    def test_merge_entrances_have_no_internal_rail(self):
        n=self.s['surface_network'];decks=[g for g in n['surfaces']if '2'in g['nodes']and g['kind']=='deck']
        for rail in n['obstacles']:
            if rail['kind']!='rail' or rail['surface_id']not in {d['id']for d in decks}:continue
            mid=LineString([rail['a'],rail['b']]).interpolate(.5,normalized=True)
            for peer in decks:
                if peer['id']!=rail['surface_id']:self.assertFalse(source_shape(peer['parts']).buffer(-.1).contains(mid))

    def test_disconnected_levels_stay_disconnected(self):
        n=self.s['surface_network'];upper=next(g for g in n['surfaces']if g['id']=='bridge-3-0')
        self.assertNotIn('bridge-1-1',upper['connections'])
        self.assertNotIn('bridge-2-0',upper['connections'])

    def test_platform_outer_edge_has_guard(self):
        rails=[LineString([o['a'],o['b']])for o in self.s['surface_network']['obstacles']if o['kind']=='rail']
        self.assertLess(min(r.distance(Point(-5,-6))for r in rails),.15)

    def test_rails_follow_the_entire_profile(self):
        n=self.s['surface_network'];surfaces={s['id']:s for s in n['surfaces']}
        for rail in n['obstacles']:
            if rail['kind']!='rail':continue
            p=LineString([rail['a'],rail['b']]).interpolate(.5,normalized=True)
            expected=profile_at(surfaces[rail['surface_id']],p.x,p.y)[0]
            self.assertLess(abs((rail['za']+rail['zb'])/2-expected),.09)

    def test_actual_mesh_checks_reject_corrupt_clearance(self):
        s=copy.deepcopy(self.s);g=next(g for g in s['surface_network']['surfaces']if g['id']=='bridge-3-0')
        for row in g['profile']:row[1]-=4
        with self.assertRaises(ValueError):validate(s['surface_network'],s['terrain'])


if __name__=='__main__':unittest.main()
