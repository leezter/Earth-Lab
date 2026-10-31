import unittest
from shapely.geometry import Polygon,box,Point,LineString
from site_features import compile_sites,dimension
from pavement_sources import parse_osm


def way(fid,points,tags):
    return {'id':fid,'type':'way','tags':tags,'geometry':[{'lon':x,'lat':y}for x,y in points]}


class SiteTests(unittest.TestCase):
    def compile(self,elements,survey=(),solid=None,road=None,walk=None):
        return compile_sites({'elements':elements},survey,lambda p:p,
            solid if solid is not None else Polygon(),road if road is not None else Polygon(),
            walk if walk is not None else Polygon(),Polygon(),Polygon())

    def test_parking_clips_buildings_roads_and_pavements(self):
        area=way(1,[(0,0),(20,0),(20,20),(0,20),(0,0)],{'amenity':'parking','surface':'gravel'})
        occupied,surfaces,*_=self.compile([area],solid=box(0,0,5,5),road=box(0,5,20,8),walk=box(0,8,20,10))
        self.assertLess(occupied.intersection(box(0,5,20,10)).area,.001)
        self.assertLess(occupied.intersection(box(0,0,5,5)).area,.001)
        self.assertEqual(set(surfaces),{'gravel'})

    def test_unknown_industrial_plot_and_courtyard_remain_unknown(self):
        for tags in ({'landuse':'industrial'},{'man_made':'courtyard'},{'amenity':'fuel'}):
            occupied,*_,report=self.compile([way(1,[(0,0),(10,0),(10,10),(0,10),(0,0)],tags)])
            self.assertTrue(occupied.is_empty)
            self.assertEqual(report['skipped']['unconfirmed yard/courtyard/forecourt surface'],1)

    def test_explicit_forecourt_yard_and_courtyard_surfaces(self):
        for tags in ({'amenity':'fuel'},{'landuse':'industrial'},{'man_made':'courtyard'}):
            tags={**tags,'surface':'concrete','colour':'#abc'}
            occupied,surfaces,*_,report=self.compile([way(1,[(0,0),(10,0),(10,10),(0,10),(0,0)],tags)])
            self.assertAlmostEqual(occupied.area,100)
            self.assertEqual(next(iter(report['materials'].values()))['colour_source'],'mapped')

    def test_multi_storey_underground_and_point_parking_have_no_ground_area(self):
        for extra in ({'parking':'multi-storey'},{'location':'underground'},{'layer':'1'},{'building':'yes'}):
            self.assertTrue(self.compile([way(1,[(0,0),(10,0),(10,10),(0,10),(0,0)],{'amenity':'parking',**extra})])[0].is_empty)
        self.assertTrue(self.compile([{'id':2,'type':'node','tags':{'amenity':'parking'},'geometry':[{'lon':0,'lat':0}]}])[0].is_empty)

    def test_survey_precedence_and_exclusive_material_ownership(self):
        survey=[{'id':'a','layer':'ck_parkflaeche','material':'05','geometry':box(0,0,10,10)}]
        area=way(1,[(0,0),(20,0),(20,10),(0,10),(0,0)],{'amenity':'parking','surface':'asphalt'})
        occupied,surfaces,*_=self.compile([area],survey)
        self.assertAlmostEqual(occupied.area,200)
        self.assertAlmostEqual(sum(g.area for g in surfaces.values()),200)
        self.assertTrue(surfaces['sett_0p18'].covers(Point(5,5)))

    def test_mapped_planting_is_not_paved(self):
        area=way(1,[(0,0),(20,0),(20,20),(0,20),(0,0)],{'amenity':'parking'})
        grass=way(2,[(5,5),(10,5),(10,10),(5,10),(5,5)],{'landuse':'grass'})
        self.assertFalse(self.compile([area,grass])[0].covers(Point(7,7)))

    def test_mapped_gate_creates_gap_and_wall_collision_matches_it(self):
        wall=way(1,[(0,0),(20,0)],{'barrier':'wall','height':'2','width':'.3'})
        node={'id':10,'type':'node','tags':{'barrier':'gate','width':'4'},'geometry':[{'lon':10,'lat':0}]}
        _,_,boundaries,gates,solid,report=self.compile([wall,node])
        self.assertEqual(len(boundaries),2);self.assertEqual(len(gates),1)
        self.assertFalse(solid.covers(Point(10,0)))
        self.assertTrue(solid.covers(Point(5,0)))
        self.assertEqual(boundaries[0]['height_source'],'mapped')

    def test_gate_axis_from_connected_highway_and_unattached_gate_skipped(self):
        gate={'id':2,'type':'node','tags':{'barrier':'gate'},'geometry':[{'lon':10,'lat':0}]}
        road=way(1,[(0,0),(10,0),(20,0)],{'highway':'service'});road['nodes']=['1','2','3']
        self.assertEqual(len(self.compile([gate,road])[3]),1)
        self.assertEqual(len(self.compile([gate])[3]),0)

    def test_incomplete_relation_does_not_create_an_area(self):
        e={'id':1,'type':'relation','tags':{'amenity':'parking'},'geometry_complete':False,'members':[]}
        self.assertTrue(self.compile([e])[0].is_empty)

    def test_dimensions_and_ground_level_barriers(self):
        self.assertAlmostEqual(dimension('6 ft',1,.1,5)[0],1.8288)
        for bad in ('unknown','100','nan','-1'):
            self.assertEqual(dimension(bad,1,.1,5),(1,'inferred'))
        _,_,boundaries,*_=self.compile([way(1,[(0,0),(20,0)],{'barrier':'fence','layer':'1'})])
        self.assertEqual(boundaries,[])

    def test_source_retains_parking_boundaries_and_gate_node_connections(self):
        data,_=parse_osm(b'''<osm><node id="1" lon="0" lat="0"/><node id="2" lon="10" lat="0"><tag k="barrier" v="gate"/></node><node id="3" lon="10" lat="10"/>
        <way id="4"><nd ref="1"/><nd ref="2"/><tag k="barrier" v="fence"/></way>
        <way id="5"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/><tag k="amenity" v="parking"/></way></osm>''')
        self.assertEqual(len(data['elements']),3)
        self.assertEqual(data['elements'][0]['nodes'],['1','2'])


if __name__=='__main__':
    unittest.main()
