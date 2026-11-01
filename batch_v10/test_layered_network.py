import unittest,copy
from unittest.mock import patch
from shapely.geometry import Point,LineString
from fixtures import scene,junction_scene
from terrain import profile_at
from surface_mesh import source_shape
from surface_network import validate
from surface_network import road_width,UnsupportedLayout
from layered_network import required,compile_layered
from terrain_sources import flat


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

    def test_oneway_lane_width_preserves_explicit_measurements(self):
        tags={'highway':'secondary','oneway':'yes','lanes':'1'}
        self.assertEqual(road_width(tags),3.25)
        self.assertEqual(road_width({**tags,'lanes':'2'}),6.5)
        self.assertEqual(road_width({**tags,'highway':'motorway'}),3.5)
        self.assertEqual(road_width({**tags,'width':'8'}),8)
        self.assertEqual(road_width({**tags,'width':'8','width:carriageway':'4'}),4)
        self.assertEqual(road_width({**tags,'oneway':'no'}),9)
        self.assertEqual(road_width({**tags,'lanes':'unknown'}),9)

    def test_parallel_divided_bridge_carriageways_do_not_invent_crossing(self):
        for lanes,separation in [('1',7.8),('2',6.83)]:
            with self.subTest(lanes=lanes):
                tags={'highway':'secondary','oneway':'yes','lanes':lanes,'bridge':'yes','layer':'1','dual_carriageway':'yes'}
                roads=[]
                for i,y in enumerate((0,separation)):
                    points=[[-60,y],[60,y]]
                    roads.append(dict(id=str(i),tags=tags,points=points,nodes=[str(i)+'a',str(i)+'b'],
                                      line=LineString(points),width=road_width(tags)))
                self.assertFalse(required(roads))
                terrain=flat();terrain['source']['status']='available'
                n=compile_layered(roads,terrain,None,None,[])
                self.assertEqual(len(n['surfaces']),2)
                self.assertTrue(all(not r['crossings'] for r in n['report']['records']))
                self.assertTrue(all(not s['connections'] for s in n['surfaces']))

    def test_genuine_equal_layer_crossing_still_rejected(self):
        tags={'highway':'secondary','oneway':'yes','lanes':'1','bridge':'yes','layer':'1'}
        roads=[]
        for i,points in enumerate(([[-60,0],[60,0]],[[0,-60],[0,60]])):
            roads.append(dict(id=str(i),tags=tags,points=points,nodes=[str(i)+'a',str(i)+'b'],
                              line=LineString(points),width=road_width(tags)))
        self.assertTrue(required(roads));terrain=flat();terrain['source']['status']='available'
        with self.assertRaisesRegex(UnsupportedLayout,'ambiguous equal ordering'):
            compile_layered(roads,terrain,None,None,[])

    def test_simple_bridge_building_passage_is_blocked_without_rejecting_area(self):
        from bridge_system import enrich
        from surface_network import export
        from shapely.geometry import box
        d=scene('overpass');s=d['scene'];network=copy.deepcopy(s['surface_network']);terrain=copy.deepcopy(s['terrain'])
        building=box(-1,-7,1,7);s['buildings']=[{'parts':export(building),'height':12}]
        with patch('bridge_system.terrain_sources.read',return_value=terrain),patch('bridge_system.compile_network',return_value=network):
            enrich(d,{},lambda p:p)
        deck=next(g for g in s['surface_network']['surfaces']if g['kind']=='deck')
        self.assertLess(source_shape(deck['parts']).intersection(building).area,.001)
        self.assertGreater(source_shape(deck['blocked_parts']).intersection(building).area,1)
        self.assertTrue(any('remains blocked' in item['reason'] for item in s['bridge_report']['omitted']))
        self.assertEqual(len(s['buildings']),1)


if __name__=='__main__':unittest.main()
