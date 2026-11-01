import copy,unittest
from shapely.geometry import box,LineString
from bridge_structures import attach,finish_obstacles
from surface_network import export,make_surface
from surface_mesh import source_shape
from terrain_sources import flat


class StructuralBridgeTests(unittest.TestCase):
    def sample(self,arch=True):
        terrain=flat();terrain['source']['status']='available'
        roads=[make_surface(str(i),'deck',LineString([(-60,y),(60,y)]),3.25,
              {'bridge':'yes','layer':'1'},[str(i)+'a',str(i)+'b'],[[0,3],[120,3]])for i,y in enumerate((-4,4))]
        building={'id':'tower','parts':export(box(-4,-10,4,10)),'height':12}
        scene={'buildings':[building]};network={'surfaces':roads,'obstacles':[]}
        tags={'man_made':'bridge','layer':'1','bridge:structure':'arch' if arch else 'beam'}
        e={'type':'way','id':10,'tags':tags,'geometry':[{'lon':x,'lat':y}for x,y in box(-60,-12,60,12).exterior.coords]}
        attach(scene,network,terrain,{'elements':[e]},lambda p:p)
        return scene,network

    def test_shared_deck_does_not_merge_driving_topology(self):
        s,n=self.sample();owners=[d for d in n['surfaces'] if d.get('structure_parts')]
        self.assertEqual(len(owners),1)
        self.assertTrue(source_shape(owners[0]['structure_parts']).covers(box(-2,-2,2,2)))
        self.assertTrue(all(d['connections']==[] for d in n['surfaces']))

    def test_arch_opening_retains_towers_and_ceiling_collision(self):
        s,n=self.sample();b=s['buildings'][0]
        self.assertTrue(source_shape(b['collision_parts']).covers(box(-3,-1,3,1)))
        self.assertFalse(source_shape(b['collision_parts']).contains(LineString([(-3,4),(3,4)])))
        self.assertEqual(len(s['bridge_overheads']),1)
        finish_obstacles(n)
        ceiling=next(o for o in n['obstacles'] if o['id'].endswith('ceiling'))
        self.assertAlmostEqual(ceiling['zmin'],7.6)
        self.assertTrue(all(o['collision_only'] for o in n['obstacles']))

    def test_no_arch_evidence_keeps_building_solid(self):
        s,n=self.sample(False)
        self.assertNotIn('collision_parts',s['buildings'][0])
        self.assertEqual(len(s['bridge_overheads']),1,'A solid building still needs correct roof occlusion')
        self.assertFalse(n.get('passage_obstacles'))

    def test_render_requirements_use_visible_structure_and_roof_footprints(self):
        from validation import required_passes
        s,n=self.sample();s['surface_network']=n
        for d in n['surfaces']:d['parts']=[]
        s['bridge_overheads'].append({'id':'outside','parts':export(box(200,200,210,210))})
        self.assertEqual(required_passes(s),{'0','overhead-tower'})

    def test_ordinary_road_does_not_require_bridge_passes(self):
        from validation import required_passes
        self.assertEqual(required_passes({'surface_network':{'surfaces':[{'id':'road','kind':'ground','parts':export(box(-10,-10,10,10))}]} }),set())


if __name__=='__main__':unittest.main()
