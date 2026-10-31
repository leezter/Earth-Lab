import unittest
from boundary_geometry import clipped_segments

class ClippingTests(unittest.TestCase):
    def test_long_line_crosses_extent_despite_both_endpoints_outside(self):
        self.assertEqual(list(clipped_segments([(-500,0),(500,0)],10)),[[(-10.,0.),(10.,0.)]])
    def test_outside_parallel_line_and_zero_length_are_removed(self):
        self.assertEqual(list(clipped_segments([(-20,11),(20,11)],10)),[])
        self.assertEqual(list(clipped_segments([(1,1),(1,1)],10)),[])
    def test_diagonal_clip_and_segment_direction(self):
        result=list(clipped_segments([(20,20),(-20,-20)],10))
        self.assertEqual(result,[[(10.,10.),(-10.,-10.)]])

if __name__=='__main__':unittest.main()
