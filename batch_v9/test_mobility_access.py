import unittest
from shapely.geometry import Polygon,Point,LineString,box
from shapely.ops import unary_union
from v9_mobility import lane_specs,compile_mobility,bus_symbol
from v9_access import compile_access,ramp_height,export,align_ramps,partition_pavements
from v9_furniture import compile_furniture
from v9_common import road_contexts
from pavement_sources import parse_osm
from job_validation import validate_spatial

def way(tags,points=((-40,0),(40,0)),fid=1):
    return {'type':'way','id':fid,'tags':tags,'nodes':[str(fid)+'-'+str(i) for i in range(len(points))],
            'geometry':[{'lon':x,'lat':y}for x,y in points]}
def node(tags,x=0,y=0,fid=2):return {'type':'node','id':fid,'tags':tags,'geometry':[{'lon':x,'lat':y}]}
def context(tags=None):
    e=way({'highway':'residential','width':'10',**(tags or {})})
    return {'element':e,'line':LineString([(-40,0),(40,0)]),'width':10,'width_source':'mapped'}
def access(elements):
    return compile_access({'elements':elements},lambda p:p,[context()],box(-40,-5,40,5),Polygon(),
                          box(-40,5,40,10).union(box(-40,-10,40,-5)))

class MobilityAccessTests(unittest.TestCase):
    def test_bus_letters_remain_separate_and_fit_supported_lane(self):
        symbol=bus_symbol();letters=list(symbol.geoms)
        self.assertEqual(len(letters),3)
        self.assertLessEqual(symbol.bounds[2]-symbol.bounds[0],2.2)
        self.assertGreater(min(a.distance(b)for i,a in enumerate(letters)for b in letters[i+1:]),.05)

    def test_parser_retains_furniture_kerb_and_tactile_nodes(self):
        data,_=parse_osm(b'<osm><node id="1" lat="0" lon="0"><tag k="amenity" v="bench"/></node><node id="2" lat="0" lon="1"><tag k="kerb" v="lowered"/></node><node id="3" lat="0" lon="2"><tag k="tactile_paving" v="yes"/></node><node id="4" lat="0" lon="3"><tag k="highway" v="bus_stop"/></node></osm>')
        self.assertEqual(len(data['elements']),4)

    def test_cycle_sides_and_parking_reservation(self):
        specs,error=lane_specs({'cycleway:right':'lane','parking:right':'lane'},10)
        self.assertIsNone(error);self.assertEqual(len(specs),1)
        self.assertAlmostEqual(specs[0]['hi'],2.9);self.assertAlmostEqual(specs[0]['lo'],1.4)
        self.assertEqual(specs[0]['direction'],1)
        left,_=lane_specs({'cycleway:left':'lane'},10)
        self.assertLess(left[0]['hi'],0);self.assertEqual(left[0]['direction'],-1)

    def test_oneway_cycle_lane_direction(self):
        s,_=lane_specs({'oneway':'yes','cycleway:left':'lane'},10)
        self.assertEqual(s[0]['direction'],1)
        s,_=lane_specs({'oneway':'-1','cycleway:right':'lane'},10)
        self.assertEqual(s[0]['direction'],-1)
        s,_=lane_specs({'oneway':'-1','cycleway':'lane'},10)
        self.assertEqual(s[0]['side'],'left');self.assertEqual(s[0]['direction'],-1)
        s,_=lane_specs({'oneway':'-1','cycleway:right':'lane','cycleway:right:oneway':'-1'},10)
        self.assertEqual(s[0]['direction'],-1)

    def test_no_paint_for_separate_track_or_no_cycleway(self):
        for value in ('track','separate','no','share_busway'):
            s,_=lane_specs({'cycleway:right':value},10)
            self.assertEqual(s,[])

    def test_bus_arrays_and_reverse_direction(self):
        for reverse in (False,True):
            s,error=lane_specs({'oneway':'-1'if reverse else'yes','lanes':'3','bus:lanes':'yes|yes|designated'},9)
            self.assertIsNone(error);self.assertEqual(s[0]['kind'],'bus')
            self.assertEqual(s[0]['direction'],-1 if reverse else 1)
            self.assertAlmostEqual(s[0]['lo'],-4.5 if reverse else 1.5)

    def test_directional_bus_arrays_follow_driving_side(self):
        t={'lanes:forward':'2','lanes:backward':'1','bus:lanes:forward':'designated|yes'}
        right,_=lane_specs(t,9);left,_=lane_specs(t,9,True)
        self.assertAlmostEqual(right[0]['lo'],-1.5)
        self.assertAlmostEqual(left[0]['lo'],-4.5)

    def test_ambiguous_bus_array_is_skipped(self):
        specs,error=lane_specs({'bus:lanes:forward':'yes|designated'},10)
        self.assertFalse(specs);self.assertIn('ambiguous',error)
        specs,error=lane_specs({'oneway':'yes','lanes':'3','bus:lanes':'yes|designated'},9)
        self.assertFalse(specs);self.assertIn('mismatch',error)

    def test_lane_narrowness_and_explicit_marking_suppression(self):
        specs,error=lane_specs({'parking:both':'lane','cycleway:both':'lane'},7)
        self.assertFalse(specs);self.assertTrue(error)
        road=context({'cycleway:right':'lane','lane_markings':'no'})
        surfaces,paint,reserved,report=compile_mobility({'elements':[]},[road],box(-40,-5,40,5),Polygon(),{},52,13)
        self.assertGreater(reserved.area,0);self.assertTrue(paint.is_empty)

    def test_mapped_lane_colour_and_paint_containment(self):
        road=context({'cycleway:right':'lane','cycleway:right:surface:colour':'red'})
        surfaces,paint,reserved,report=compile_mobility({'elements':[]},[road],box(-40,-5,40,5),Polygon(),{},52,13)
        self.assertTrue(surfaces);self.assertGreater(paint.area,0)
        self.assertLess(paint.difference(reserved.buffer(.001)).area,1e-6)
        self.assertEqual(next(iter(report['materials'].values()))['colour_source'],'mapped')

    def test_curved_nearly_coincident_lane_overlay(self):
        road=context({'cycleway:both':'lane'})
        road['line']=LineString([(-40,0),(-10,0),(0,.00000000001),(10,8),(20,8),(40,0)])
        surfaces,paint,reserved,report=compile_mobility({'elements':[]},[road],road['line'].buffer(5),Polygon(),{},52,13)
        self.assertTrue(reserved.is_valid);self.assertGreater(reserved.area,0)
        self.assertLess(paint.difference(reserved.buffer(.002)).area,.001)
        self.assertEqual(report['geometry_precision_metres'],.001)

    def test_refuge_requires_evidence_and_removes_driving_area(self):
        d,p,island,*_=access([node({'highway':'crossing','crossing:island':'yes'})])
        self.assertGreater(island.area,3);self.assertFalse(d.covers(Point(0,0)));self.assertTrue(p.covers(Point(0,0)))
        d,p,island,*_=access([node({'highway':'crossing'})]);self.assertTrue(island.is_empty)

    def test_mapped_island_outline_and_no_duplicate_node(self):
        e=way({'area:highway':'traffic_island'},[(-2,-1),(2,-1),(2,1),(-2,1),(-2,-1)])
        d,p,island,*_=access([e,node({'highway':'crossing','crossing:island':'yes'})])
        self.assertAlmostEqual(island.area,8)

    def test_mapped_refuge_preserves_protected_tree_pits(self):
        e=way({'area:highway':'traffic_island'},[(-3,-3),(3,-3),(3,3),(-3,3),(-3,-3)])
        pit=box(-1,-1,1,1)
        d,p,island,*_=compile_access({'elements':[e]},lambda p:p,[context()],box(-40,-5,40,5),Polygon(),Polygon(),pit)
        self.assertLess(p.intersection(pit).area,1e-8)
        self.assertLess(island.intersection(pit).area,1e-8)
        self.assertAlmostEqual(island.area,32)

    def test_spatial_guard_rejects_paved_tree_pit(self):
        scene={'pavements':export(box(0,0,5,5)),'roads':[],'tree_pits':export(box(1,1,2,2)),'buildings':[]}
        with self.assertRaisesRegex(ValueError,'tree pits'):validate_spatial(scene)

    def test_ramp_material_uses_exported_walk_domain(self):
        walk=box(0,0,5,5)
        ramps=[{'parts':export(box(4,1,6,2))}]
        area=align_ramps(ramps,walk)
        self.assertAlmostEqual(area.area,1)
        self.assertLess(area.difference(walk).area,1e-9)

    def test_pavement_ownership_uses_shared_precision(self):
        domain=box(0,0,5,5).difference(box(1,1,2,2))
        domain,groups=partition_pavements(domain,{'walk_slabs':box(0,0,5,5),'ramp_concrete':box(2.50000000004,0,6,3)})
        self.assertLess(groups['walk_slabs'].intersection(groups['ramp_concrete']).area,1e-9)
        self.assertLess(unary_union(list(groups.values())).symmetric_difference(domain).area,1e-9)
        self.assertGreater(groups['ramp_concrete'].area,1)

    def test_lowered_crossing_has_two_ramps_and_tactile_pads(self):
        d,p,island,ramps,cuts,tactile,report=access([node({'highway':'crossing','kerb':'lowered','tactile_paving':'yes'})])
        self.assertEqual(len(ramps),2);self.assertGreater(tactile.area,0)
        r=ramps[0];x,y=r['edge'];nx,ny=r['outward']
        self.assertAlmostEqual(ramp_height(x,y,ramps),.02)
        self.assertGreater(ramp_height(x+nx*1.4,y+ny*1.4,ramps),.12)
        self.assertLess(tactile.intersection(d).area,1e-8)

    def test_crossing_alone_does_not_invent_accessibility(self):
        _,_,_,ramps,_,tactile,_=access([node({'highway':'crossing'})])
        self.assertFalse(ramps);self.assertTrue(tactile.is_empty)

    def test_bridge_access_features_skipped(self):
        _,_,island,ramps,*_=access([node({'highway':'crossing','bridge':'yes','crossing:island':'yes','kerb':'lowered'})])
        self.assertTrue(island.is_empty);self.assertFalse(ramps)

    def test_furniture_kinds_and_ground_placement(self):
        elements=[node({'amenity':'bench'},-25,7,10),node({'amenity':'bicycle_parking','bicycle_parking':'stands'},-15,7,11),
                  node({'highway':'bus_stop'},0,7,12),node({'amenity':'waste_basket'},10,7,13),
                  node({'barrier':'bollard'},20,0,14),node({'amenity':'shelter','shelter_type':'public_transport'},30,7,15)]
        records,solids,report=compile_furniture({'elements':elements},lambda p:p,[context()],box(-40,-5,40,5),Polygon(),box(-40,5,40,12),[],Polygon())
        self.assertEqual(set(report['counts']),{'bench','bike_rack','bus_stop','bin','bollard','shelter'})
        self.assertEqual(next(r for r in records if r['kind']=='bollard')['ground_z'],.014)

    def test_shelter_is_not_invented_from_stop_alone(self):
        records,_,_=compile_furniture({'elements':[node({'highway':'bus_stop'},0,7)]},lambda p:p,[context()],box(-40,-5,40,5),Polygon(),box(-40,5,40,12),[],Polygon())
        self.assertEqual([r['kind']for r in records],['bus_stop'])

    def test_furniture_cannot_block_crossing_or_building(self):
        e=node({'amenity':'bench'},0,7)
        for obstacle in (box(-2,6,2,8),):
            records,_,_=compile_furniture({'elements':[e]},lambda p:p,[context()],box(-40,-5,40,5),obstacle,box(-40,5,40,12),[],Polygon())
            self.assertFalse(records)
        records,_,_=compile_furniture({'elements':[e]},lambda p:p,[context()],box(-40,-5,40,5),Polygon(),box(-40,5,40,12),[],box(-2,6,2,8))
        self.assertFalse(records)

if __name__=='__main__':unittest.main()
