import unittest
from shapely.geometry import Polygon, Point, LineString, box
from pavements import metres, side_spec, side_polygon, osm_shape, compile_pavements


class PavementTests(unittest.TestCase):
    def test_side_is_geographic_left_in_south_positive_frame(self):
        g = side_polygon([(0, 0), (100, 0)], 8, 2, 'left')
        self.assertTrue(g.covers(Point(50, -5)))
        self.assertFalse(g.covers(Point(50, 5)))
        reverse = side_polygon([(100, 0), (0, 0)], 8, 2, 'right')
        self.assertLess(g.symmetric_difference(reverse).area, 1e-8)

    def test_explicit_absence_separate_and_side_overrides(self):
        for value in ('no', 'none', 'separate'):
            for side in ('left', 'right'):
                self.assertFalse(side_spec({'sidewalk': value}, side, True)['present'])
        tags = {'sidewalk': 'both', 'sidewalk:left': 'no', 'sidewalk:right:width': '1.25 m',
                'sidewalk:both:surface': 'paving_stones', 'sidewalk:right:colour': '#f00'}
        self.assertFalse(side_spec(tags, 'left', True)['present'])
        right = side_spec(tags, 'right')
        self.assertEqual((right['width'], right['surface'], right['colour']), (1.25, 'paving_stones', '#f00'))

    def test_width_units_and_invalid_values(self):
        self.assertAlmostEqual(metres('6 ft'), 1.8288)
        for invalid in ('nan', '-1', '0', '300', '2;3', 'unknown'):
            self.assertIsNone(metres(invalid))

    def test_side_attributes_establish_presence_without_urban_density(self):
        self.assertTrue(side_spec({'sidewalk:left:width':'1.8'}, 'left')['present'])
        self.assertFalse(side_spec({'sidewalk':'no','sidewalk:left:width':'1.8'}, 'left')['present'])

    def test_long_osm_way_is_matched_inside_generation_extent(self):
        element = {'type':'way','id':3,'tags':{'highway':'residential','sidewalk':'left','sidewalk:left:width':'1'},
                   'geometry':[{'lon':0,'lat':0},{'lon':10000,'lat':0}]}
        _, walk, *_ = self.compile([element])
        self.assertTrue(walk.covers(Point(50,-4.5)))
        self.assertFalse(walk.covers(Point(50,5)))

    def test_relation_holes(self):
        def member(points, role):
            return {'role': role, 'geometry': [{'lon': x, 'lat': y} for x, y in points]}
        e = {'type': 'relation', 'members': [member([(0,0),(10,0),(10,10)], 'outer'),
             member([(10,10),(0,10),(0,0)], 'outer'), member([(2,2),(3,2),(3,3),(2,3),(2,2)], 'inner')]}
        self.assertAlmostEqual(osm_shape(e, lambda p:p).area, 99)

    def compile(self, osm=None, survey=None, sidewalk='both', solid=None):
        raw = {'roads': [{'id':'road', 'class':'residential', 'width':8, 'surface':'asphalt',
                         'sidewalk':sidewalk, 'parts':[[[[0,0],[100,0]]]]}]}
        return compile_pavements(raw, lambda p:p, box(0,-4,100,4), solid if solid is not None else Polygon(),
             {'building_share':.2, 'regional_guess':'temperate'}, {'elements':osm or []}, survey or [])

    def test_one_sided_direct_osm_suppresses_both_sided_fallback(self):
        element = {'type':'way', 'id':1, 'tags':{'highway':'residential','sidewalk':'left',
                   'sidewalk:left:width':'1.5','sidewalk:left:surface':'asphalt'},
                   'geometry':[{'lon':0,'lat':0},{'lon':100,'lat':0}]}
        _, walk, surfaces, report, _, _, _ = self.compile([element])
        self.assertAlmostEqual(walk.area, 150)
        self.assertTrue(walk.covers(Point(50,-5)))
        self.assertFalse(walk.covers(Point(50,5)))
        self.assertEqual(set(surfaces), {'asphalt'})

    def test_survey_corrects_width_preserves_bands_pits_and_driveway_gap(self):
        rows = [{'id':'slabs','layer':'cl_gehweg','material':'07','geometry':box(0,-6,100,-3)},
                {'id':'mosaic','layer':'cl_gehweg','material':'03','geometry':box(0,-7,100,-6)},
                {'id':'apron','layer':'by_gehwegueberfahrt','material':'05','geometry':box(40,-7,44,-3)},
                {'id':'pit','layer':'bn_baumscheibe','material':'','geometry':box(60,-6,62,-4)},
                {'id':'carriageway','layer':'cm_fahrbahn','material':'02','geometry':box(0,-3,100,4)}]
        driving, walk, surfaces, report, kerbs, aprons, pits = self.compile(survey=rows, sidewalk='no')
        self.assertFalse(driving.covers(Point(50,-3.5)))
        self.assertFalse(walk.covers(Point(61,-5)))
        self.assertTrue(aprons.covers(Point(42,-5)))
        self.assertLess(kerbs.intersection(box(40.1,-3.1,43.9,-2.9)).length, .001)
        self.assertAlmostEqual(sum(g.area for g in surfaces.values()), walk.area)
        self.assertLess(walk.intersection(driving).area, 1e-8)
        self.assertLess(walk.intersection(pits).area, 1e-8)
        self.assertEqual(report['materials']['walk_slabs_0p35']['unit_metres'], .35)

    def test_junctions_and_buildings_have_no_pavement_overlap(self):
        solid = box(20,-7,40,-5)
        driving, walk, surfaces, *_ = self.compile(solid=solid)
        self.assertLess(walk.intersection(solid).area, 1e-8)
        self.assertLess(walk.intersection(driving).area, 1e-8)
        self.assertAlmostEqual(sum(g.area for g in surfaces.values()), walk.area)

    def test_separately_mapped_path_has_own_width_and_material(self):
        e = {'type':'way','id':2,'tags':{'highway':'footway','footway':'sidewalk','width':'4','surface':'paving_stones'},
             'geometry':[{'lon':0,'lat':-8},{'lon':100,'lat':-8}]}
        _, walk, surfaces, *_ = self.compile([e], sidewalk='separate')
        self.assertAlmostEqual(walk.area, 400)
        self.assertEqual(set(surfaces), {'paving_blocks'})


if __name__ == '__main__':
    unittest.main()
