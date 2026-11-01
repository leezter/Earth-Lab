import unittest
from shapely.geometry import Polygon,LineString,box,Point
from street_features import compile_streets,crossing_style,profile,strokes
from pavement_sources import parse_osm

def way(tags=None,points=None,refs=None):
    return {'type':'way','id':1,'tags':{'highway':'secondary','lanes':'2','width':'8','surface':'asphalt',**(tags or {})},
        'nodes':refs or ['a','b','c'],'geometry':[{'lon':x,'lat':y}for x,y in (points or [(0,0),(50,0),(100,0)])]}
def node(kind,ref='b',tags=None):return {'type':'node','id':ref,'tags':{'highway':kind,**(tags or {})},'geometry':[{'lon':50,'lat':0}]}

class StreetTests(unittest.TestCase):
    def compile(self,elements,lat=52,lon=13):
        raw={'roads':[{'class':'secondary','width':8,'parts':[[[[0,0],[100,0]]]]}]}
        return compile_streets({'elements':elements},raw,lambda p:p,box(0,-4,100,4),Polygon(),lat,lon)
    def test_dashes_have_physical_dimensions_and_gaps(self):
        g=strokes(LineString([(0,0),(30,0)]),.12,3,6)
        self.assertAlmostEqual(g.area,1.44)
        self.assertTrue(g.covers(Point(1,0)));self.assertFalse(g.covers(Point(5,0)))
    def test_explicit_unmarked_suppresses_lane_dividers(self):
        paint,_,report=self.compile([way({'lane_markings':'no'})]);self.assertTrue(all(g.is_empty for g in paint.values()))
        self.assertEqual(report['skipped']['explicitly unmarked lane dividers'],1)
    def test_known_lane_count_inference_is_labelled_and_clipped(self):
        paint,_,r=self.compile([way()]);self.assertGreater(paint['white'].area,0)
        self.assertIn('inferred',r['records'][0]['presence_evidence'])
        self.assertLess(paint['white'].difference(box(0,-4,100,4)).area,.001)
    def test_us_centre_is_yellow_one_way_divider_is_white(self):
        p,_,_=self.compile([way()],40,-74);self.assertGreater(p['yellow'].area,0)
        p,_,_=self.compile([way({'oneway':'yes'})],40,-74);self.assertTrue(p['yellow'].is_empty);self.assertGreater(p['white'].area,0)
    def test_unknown_or_ambiguous_lane_layout_is_not_invented(self):
        for tags in ({'lanes':'unknown'},{'lanes':'3'},{'lanes':'6','width':'5'}):
            p,_,_=self.compile([way(tags)]);self.assertTrue(all(g.is_empty for g in p.values()))
    def test_crossings_need_marking_evidence(self):
        self.assertIsNone(crossing_style({}));self.assertIsNone(crossing_style({'crossing:markings':'no'}))
        self.assertEqual(crossing_style({'crossing:markings':'zebra'}),'zebra')
        p,_,r=self.compile([way({'lane_markings':'no'}),node('crossing',tags={'crossing:markings':'zebra'})])
        self.assertGreater(p['white'].area,0);self.assertEqual(r['feature_counts']['crossing'],1)
    def test_crossing_way_and_node_are_deduplicated(self):
        crossing={'type':'way','id':2,'tags':{'highway':'footway','footway':'crossing','crossing:markings':'zebra'},'geometry':[{'lon':50,'lat':-5},{'lon':50,'lat':5}]}
        _,_,r=self.compile([way(),crossing,node('crossing',tags={'crossing:markings':'zebra'})]);self.assertEqual(r['feature_counts']['crossing'],1)
    def test_signal_is_offset_to_roadside_and_stop_line_is_clipped(self):
        paint,hw,r=self.compile([way(),node('traffic_signals',tags={'traffic_signals:direction':'forward'})])
        self.assertEqual(len(hw),1);self.assertGreater(abs(hw[0]['point'][1]),4)
        self.assertEqual(r['feature_counts']['signal_stop_line'],1)
        self.assertLess(paint['white'].difference(box(0,-4,100,4)).area,.001)
    def test_signal_at_way_endpoint_is_supported(self):
        e=way(points=[(0,0),(50,0)],refs=['a','b'])
        _,hw,_=self.compile([e,node('traffic_signals',tags={'traffic_signals:direction':'forward'})]);self.assertEqual(len(hw),1)
    def test_left_driving_changes_nearside_hardware(self):
        _,de,_=self.compile([way(),node('stop',tags={'direction':'forward'})])
        _,uk,_=self.compile([way(),node('stop',tags={'direction':'forward'})],51,-.1)
        self.assertGreater(de[0]['point'][1],0);self.assertLess(uk[0]['point'][1],0)
    def test_turn_arrows_require_explicit_lane_turns(self):
        _,_,r=self.compile([way({'oneway':'yes','turn:lanes':'left|through'})]);self.assertEqual(r['feature_counts']['turn_arrow'],2)
    def test_grade_separated_controls_and_roads_are_omitted(self):
        p,hw,_=self.compile([way({'bridge':'yes'}),node('traffic_signals',tags={'layer':'1'})]);self.assertFalse(hw);self.assertTrue(all(g.is_empty for g in p.values()))
    def test_source_retains_control_nodes_and_way_connections(self):
        data,_=parse_osm(b'<osm><node id="1" lat="0" lon="0"><tag k="highway" v="traffic_signals"/></node><node id="2" lat="0" lon="10"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="highway" v="secondary"/></way></osm>')
        self.assertEqual(len(data['elements']),2);self.assertEqual(data['elements'][0]['nodes'],['1','2'])
    def test_dividers_do_not_run_through_junction_mouths(self):
        branch=way(points=[(50,-50),(50,0)],refs=['d','b']);branch['id']=2
        paint,_,_=self.compile([way(),branch])
        self.assertLess(paint['white'].intersection(box(46,-1,54,1)).area,.001)
    def test_separately_mapped_solid_line_uses_its_actual_geometry(self):
        marking={'type':'way','id':7,'tags':{'road_marking':'solid_line','width':'.15'},'geometry':[{'lon':20,'lat':2},{'lon':80,'lat':2}]}
        paint,_,r=self.compile([way(),marking]);self.assertTrue(paint['white'].covers(Point(50,2)))
        self.assertEqual(r['feature_counts']['mapped_solid_line'],1)

if __name__=='__main__':unittest.main()
