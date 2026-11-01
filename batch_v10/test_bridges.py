import copy,json,math,unittest
from shapely.geometry import LineString,Point,box
from terrain import height_at,profile_at
from terrain_sources import flat
from surface_network import compile_network,validate,export
from bridge_sources import strip_elevated
from bridge_geometry import refined_mesh
from surface_mesh import coverage,source_shape
from pavement_sources import parse_osm
from fixtures import scene


def way(fid,points,nodes,tags=None):
    return {'type':'way','id':fid,'nodes':[str(n)for n in nodes],
            'geometry':[{'lon':x,'lat':y}for x,y in points],
            'tags':{'highway':'residential',**(tags or {})}}


def source():
    return {'elements':[way(1,[(-20,0),(20,0)],[1,2],{'bridge':'yes','layer':'1'}),
            way(2,[(-150,0),(-20,0)],[3,1]),way(3,[(20,0),(150,0)],[2,4]),
            way(4,[(0,-150),(0,150)],[5,6])]}


def terrain():
    t=flat();t['source']['status']='available';return t


class BridgeTests(unittest.TestCase):
    def compile(self,osm=None,t=None):
        t=t or terrain();network=compile_network(osm or source(),lambda p:p,t);validate(network,t);return network,t

    def test_multiple_crossing_points_are_not_overlap(self):
        osm=source()
        osm['elements'][-1]=way(4,[(-8,-40),(-8,30),(8,30),(8,-40)],[5,7,8,6])
        network,_=self.compile(osm)
        crossings=network['report']['records'][0]['crossings']
        self.assertEqual(len(crossings),2)
        self.assertEqual({c['surface_id']for c in crossings},{'osm-4-0'})

    def test_true_overlapping_centrelines_still_rejected(self):
        osm=source();osm['elements'][-1]=way(4,[(-10,0),(10,0)],[5,6])
        with self.assertRaisesRegex(ValueError,'centreline segments overlap'):
            self.compile(osm)

    def test_branched_deck_not_arbitrarily_concatenated(self):
        osm=source()
        osm['elements'] += [way(5,[(20,0),(40,20)],[2,9],{'bridge':'yes'}),
                            way(6,[(20,0),(40,-20)],[2,10],{'bridge':'yes'})]
        network,_=self.compile(osm)
        self.assertEqual(network['schema'],2)
        decks=[g for g in network['surfaces']if g['kind']=='deck']
        self.assertEqual(len(decks),3)
        for g in decks:self.assertGreaterEqual(len(g['connections']),2)

    def test_separate_crossing(self):
        network,t=self.compile();deck=next(s for s in network['surfaces']if s['kind']=='deck')
        lower=next(s for s in network['surfaces']if s['id']=='osm-4-0')
        self.assertNotIn(lower['id'],deck['connections']);self.assertGreaterEqual(deck['profile'][0][1]-.45,4.6)

    def test_approach_continuity(self):
        network,t=self.compile()
        self.assertEqual(sum(s['kind']=='approach'for s in network['surfaces']),2)
        for s in network['surfaces']:
            if s['kind']=='approach':
                self.assertAlmostEqual(height_at(t,*s['points'][0]),s['profile'][0][1])
                self.assertAlmostEqual(height_at(t,*s['points'][-1]),s['profile'][-1][1])

    def test_layer_is_not_height(self):
        a,_=self.compile();osm=source();osm['elements'][0]['tags']['layer']='4';b,_=self.compile(osm)
        self.assertEqual(a['report']['records'][0]['deck_height_local_m'],b['report']['records'][0]['deck_height_local_m'])

    def test_bridge_level_zero(self):
        osm=source();osm['elements'][0]['tags']['layer']='0';n,_=self.compile(osm)
        self.assertEqual(len(n['report']['records']),1)

    def test_elevation_not_fused(self):
        osm=source();osm['elements'][0]['tags']['ele']='1000';n,_=self.compile(osm)
        self.assertLess(n['report']['records'][0]['deck_height_local_m'],10)

    def test_missing_terrain_rejected_for_bridge(self):
        with self.assertRaisesRegex(ValueError,'requires identified terrain'):self.compile(t=flat())

    def test_flat_fallback_allowed_without_bridge(self):
        n,t=self.compile({'elements':[way(2,[(-100,0),(100,0)],[1,2])]},flat())
        self.assertEqual(n['report']['records'],[])

    def test_interior_shared_node_rejected(self):
        osm=source();osm['elements'][0]=way(1,[(-20,0),(0,0),(20,0)],[1,5,2],{'bridge':'yes'})
        with self.assertRaisesRegex(ValueError,'share an interior'):self.compile(osm)

    def test_at_grade_shared_node_connects(self):
        osm={'elements':[way(1,[(-20,0),(0,0),(20,0)],[1,2,3]),way(2,[(0,-20),(0,0),(0,20)],[4,2,5])]}
        n,t=self.compile(osm);self.assertEqual(len(n['surfaces']),4)
        self.assertTrue(all(len(s['connections'])==3 for s in n['surfaces']))

    def test_unconnected_xy_crossing_has_no_graph_edge(self):
        osm={'elements':[way(1,[(-20,0),(20,0)],[1,2]),way(2,[(0,-20),(0,20)],[3,4])]}
        n,_=self.compile(osm);self.assertTrue(all(not s['connections']for s in n['surfaces']))

    def test_insufficient_approach_rejected(self):
        osm=source();osm['elements'][1]=way(2,[(-25,0),(-20,0)],[3,1])
        with self.assertRaisesRegex(ValueError,'approach context'):self.compile(osm)

    def test_movable_bridge_rejected(self):
        osm=source();osm['elements'][0]['tags']['bridge']='movable'
        with self.assertRaisesRegex(ValueError,'Movable'):self.compile(osm)

    def test_tunnel_rejected(self):
        osm=source();osm['elements'][3]['tags']['tunnel']='yes'
        with self.assertRaisesRegex(ValueError,'Tunnel'):self.compile(osm)

    def test_baseline_lower_crossing_not_clipped(self):
        raw={'roads':[{'id':'upper','parts':[[[[-150,0],[150,0]]]],'level':1},
                      {'id':'lower','parts':[[[[0,-150],[0,150]]]],'level':0}]}
        cleaned,report=strip_elevated(raw,source(),lambda p:p)
        lower=next(r for r in cleaned['roads']if r['id']=='lower')
        self.assertAlmostEqual(LineString(lower['parts'][0][0]).length,300)
        upper=next(r for r in cleaned['roads']if r['id']=='upper')
        self.assertAlmostEqual(sum(LineString(p[0]).length for p in upper['parts']),260)
        self.assertEqual(len(report),1)

    def test_unknown_layered_baseline_rejected(self):
        with self.assertRaisesRegex(ValueError,'lacks matched'):
            strip_elevated({'roads':[{'id':'x','class':'residential','parts':[[[[100,100],[120,100]]]],'level':1}]},source(),lambda p:p)

    def test_parser_elevation_and_relation_identity(self):
        xml=b'<osm><node id="1" lon="0" lat="0"><tag k="ele" v="12"/></node><node id="2" lon="1" lat="0"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="bridge" v="yes"/></way><relation id="4"><member type="way" ref="3" role="outer"/><tag k="man_made" v="bridge"/></relation></osm>'
        result,_=parse_osm(xml)
        self.assertTrue(any(e.get('tags',{}).get('ele')=='12'for e in result['elements']))
        relation=next(e for e in result['elements']if e['type']=='relation')
        self.assertEqual(relation['members'][0]['ref'],'3');self.assertEqual(relation['members'][0]['nodes'],['1','2'])

    def test_refined_mesh_retains_holes(self):
        polygon=box(-20,-20,20,20).difference(box(-3,-3,3,3));parts=export(polygon)
        mesh=refined_mesh(parts,box(-21,-21,21,21));coverage(polygon,mesh)
        self.assertTrue(all(math.dist(mesh['vertices'][a],mesh['vertices'][b])<9 for f in mesh['faces']for a,b in zip(f,f[1:]+f[:1])))

    def test_all_fixtures_validate(self):
        for name in ('overpass','hills','flat'):
            s=scene(name)['scene'];validate(s['surface_network'],s['terrain'])
            self.assertEqual(s['terrain']['source']['provider'],'authored synthetic fixture')

    def test_abutments_below_deck(self):
        s=scene()['scene'];supports=[o for o in s['surface_network']['obstacles']if o['kind']=='support']
        self.assertTrue(supports);self.assertTrue(all(o['zmax']<=4.6 for o in supports))

    def test_reject_discontinuous_connection(self):
        s=scene()['scene'];s['surface_network']['surfaces'][1]['profile']=[[0,8],[44,8]]
        with self.assertRaisesRegex(ValueError,'Discontinuous'):validate(s['surface_network'],s['terrain'])

if __name__=='__main__':unittest.main()
