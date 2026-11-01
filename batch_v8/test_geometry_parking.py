import unittest
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union
from road_types import FAMILIES
from road_geometry import compile_roads, apply_widths
from parking_features import compile_parking, side_spec
from job_validation import validate_parking

def way(tags, pts=((0,0),(60,0)), fid=1):
    return {'type':'way','id':fid,'tags':tags,'nodes':[str(fid)+'a',str(fid)+'b'],
            'geometry':[{'lon':x,'lat':y} for x,y in pts]}

def parking(elements, walk=Polygon(), solids=Polygon(), paints=None):
    return compile_parking({'elements':elements},lambda p:p,box(0,-6,60,6),solids,walk,Polygon(),paints or {})

class GeometryParkingTests(unittest.TestCase):
    def test_enclosed_parking_cannot_be_accepted_as_ground(self):
        for kind in ('underground','multi-storey','rooftop','garage_boxes','sheds'):
            with self.assertRaises(ValueError):
                validate_parking({'parking_report':{'records':[{'id':'bad','source_tags':{'parking':kind}}]}})
        validate_parking({'parking_report':{'records':[{'id':'ok','source_tags':{'parking':'surface'}}]}})

    def test_survey_geometry_keeps_existing_sett_material(self):
        lanes={k:[] for k in FAMILIES};lanes['sett']=[box(-30,-3,30,3)]
        survey=[{'id':'road','layer':'cm_fahrbahn','material':'02','geometry':box(-30,-4,30,4)}]
        road,groups,_=compile_roads({'elements':[]},survey,lambda p:p,lanes,Polygon())
        self.assertAlmostEqual(unary_union(groups['sett']).area,360)
        self.assertAlmostEqual(road.area,480)
        self.assertAlmostEqual(unary_union(groups['asphalt']).area,120)

    def test_survey_replaces_junction_without_building_overlap(self):
        lanes={k:[] for k in FAMILIES};lanes['asphalt']=[box(-30,-5,30,5),box(-5,-30,5,30)]
        rows=[{'id':'road','layer':'cm_fahrbahn','material':'02','geometry':box(-25,-4,25,4)},
              {'id':'walk','layer':'cl_gehweg','material':'07','geometry':box(-25,4,25,7)}]
        road,_,report=compile_roads({'elements':[]},rows,lambda p:p,lanes,box(15,-1,20,1))
        self.assertLess(road.intersection(rows[1]['geometry']).area,1e-8)
        self.assertLess(road.intersection(box(15,-1,20,1)).area,1e-8)
        self.assertTrue(road.covers(LineString([(-20,0),(10,0)])))
        self.assertEqual(report['records'][0]['geometry_inferred'],False)

    def test_width_matching_preserves_cross_street(self):
        raw={'roads':[{'id':'a','class':'residential','width':7,'parts':[[[[0,0],[60,0]]]]},
                      {'id':'b','class':'residential','width':7,'parts':[[[[30,-30],[30,30]]]]}]}
        rec=apply_widths(raw,{'elements':[way({'highway':'residential','width':'10'})]},lambda p:p)
        self.assertEqual([r['width'] for r in raw['roads']],[10,7]);self.assertEqual(len(rec),1)

    def test_ambiguous_width_is_not_applied(self):
        raw={'roads':[{'id':'a','class':'residential','width':7,'parts':[[[[0,0],[60,0]]]]}]}
        apply_widths(raw,{'elements':[way({'highway':'residential','width':str(w)},fid=w) for w in (6,10)]},lambda p:p)
        self.assertEqual(raw['roads'][0]['width'],7)

    def test_side_overrides_both(self):
        self.assertIsNone(side_spec({'parking:both':'lane','parking:right':'no'},'right'))
        self.assertEqual(side_spec({'parking:lane:left':'diagonal'},'left')['orientation'],'diagonal')

    def test_left_right_in_south_positive_frame(self):
        for side,sign in [('left',-1),('right',1)]:
            surfaces,_,_=parking([way({'highway':'residential','width':'12',f'parking:{side}':'lane'})])
            g=unary_union(list(surfaces.values()))
            self.assertGreater(g.area,0);self.assertGreater(g.centroid.y*sign,0)

    def test_no_paint_from_orientation_alone(self):
        _,paint,report=parking([way({'highway':'residential','width':'12','parking:both':'lane','parking:both:orientation':'parallel'})])
        self.assertTrue(paint.is_empty);self.assertGreater(report['area_m2'],0)

    def test_all_marked_orientations(self):
        for orientation in ('parallel','perpendicular','diagonal'):
            surfaces,paint,report=parking([way({'highway':'residential','width':'12','parking:right':'lane',
                 'parking:right:orientation':orientation,'parking:right:markings':'yes'})])
            self.assertGreater(paint.area,0,orientation)
            self.assertLess(paint.difference(unary_union(list(surfaces.values()))).area,1e-8)

    def test_missing_width_and_too_narrow_are_skipped(self):
        for width in (None,'4'):
            t={'highway':'residential','parking:both':'lane'}
            if width:t['width']=width
            surfaces,paint,report=parking([way(t)])
            self.assertFalse(surfaces);self.assertTrue(report['skipped'])

    def test_exclusions(self):
        walk=box(0,4,60,6);solids=box(10,-6,20,6);cross=box(30,-6,34,6)
        surfaces,paint,_=parking([way({'highway':'residential','width':'12','parking:both':'lane','parking:both:markings':'yes'})],walk,solids,{'white':cross})
        g=unary_union(list(surfaces.values()))
        self.assertLess(g.intersection(unary_union([walk,solids,cross])).area,1e-8)

    def test_bridges_not_used(self):
        surfaces,_,_=parking([way({'highway':'residential','bridge':'yes','width':'12','parking:right':'lane'})])
        self.assertFalse(surfaces)

    def test_individual_spaces_require_markings_for_paint(self):
        pts=((10,1),(16,1),(16,3),(10,3),(10,1))
        for marked in ('yes','no'):
            surfaces,paint,_=parking([way({'amenity':'parking_space','markings':marked},pts)])
            self.assertTrue(surfaces);self.assertEqual(paint.area>0,marked=='yes')

if __name__=='__main__':unittest.main()
