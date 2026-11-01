import unittest
from road_types import family,segments,FAMILIES
class RoadTests(unittest.TestCase):
 def test_distinct_paved_types(self):
  values=['asphalt','concrete','concrete:plates','paving_stones','sett','unhewn_cobblestone']
  self.assertEqual(len({family(v)for v in values}),len(values))
 def test_unpaved_never_becomes_asphalt(self):
  for v in ['ground','sand','grass','compacted','fine_gravel','earth','mud','unpaved','gravel']:self.assertNotEqual(family(v),'asphalt',v)
 def test_shorter_rule_overrides_general_without_losing_length(self):
  road={'parts':[[[[0,0],[100,0]]]],'class':'residential','surface':'paved','surface_rules':[['paved',0,1],['gravel',.3,.6]]}
  result=list(segments(road,lambda p:p));self.assertEqual([t for _,t in result],['asphalt','gravel','asphalt']);self.assertAlmostEqual(sum(g.length for g,_ in result),100)
 def test_multipart_linear_reference(self):
  road={'parts':[[[[0,0],[20,0]]],[[[20,0],[100,0]]]],'class':'residential','surface':'paved','surface_rules':[['dirt',.5,1]]}
  result=list(segments(road,lambda p:p));self.assertAlmostEqual(sum(g.length for g,t in result if t=='earth'),50)
if __name__=='__main__':unittest.main()
