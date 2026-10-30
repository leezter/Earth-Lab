import unittest
from roof_styles import style,colour
class RoofTests(unittest.TestCase):
 def test_mapped_attributes_override_inference(self):
  for tag,asset in [('slate','roof_slates_02'),('clay_tiles','clay_roof_tiles_02'),('zinc','corrugated_iron'),('bitumen','asphalt_02')]:
   s=style({'id':'a','material':tag,'color':'#127abe','industrial_inferred':True,'roof':'flat'},{})
   self.assertEqual(s['asset'],asset);self.assertTrue(s['mapped_material']);self.assertTrue(s['mapped_colour']);self.assertEqual(s['colour'],colour('#127abe'))
 def test_stable_building_identity(self):
  a=style({'id':'building-42'},{'regional_guess':'british'})
  self.assertEqual(a,style({'id':'building-42','seed':99999},{'regional_guess':'british'}))
 def test_missing_data_varies_without_inventing_mapping(self):
  roofs=[style({'id':str(i)},{'regional_guess':'temperate'})for i in range(100)]
  self.assertEqual(len({s['asset']for s in roofs}),3)
  self.assertGreater(len({s['colour']for s in roofs}),8)
  self.assertFalse(any(s['mapped_material']or s['mapped_colour']for s in roofs))
 def test_colour_parsing_and_safe_unknowns(self):
  self.assertEqual(colour('#abc'),colour('#aabbcc'));self.assertEqual(colour('Dark Grey'),colour('darkgray'))
  self.assertIsNone(colour('unknown'));self.assertIsNone(colour('#invalid'))
  self.assertEqual(style({'id':'a','material':'unrecognized'}, {})['unsupported_material'],'unrecognized')
 def test_flat_roofs_stay_flat_surface(self):
  self.assertEqual(style({'id':'a','roof':'flat'}, {})['asset'],'asphalt_02')
if __name__=='__main__':unittest.main()
