import unittest
from terrain_surface import canonical_grid,sample,inside,cell_triangles


class CanonicalGroundTests(unittest.TestCase):
    def test_triangle_interior_is_a_plane(self):
        grid=canonical_grid(lambda x,y:x*y/6,half=6,step=2)
        for triangle in cell_triangles(0,0,2):
            x=sum(p[0]for p in triangle)/3;y=sum(p[1]for p in triangle)/3
            self.assertAlmostEqual(sample(grid,x,y),sum(sample(grid,*p)for p in triangle)/3,places=6)

    def test_adjacent_triangles_have_identical_edge(self):
        grid=canonical_grid(lambda x,y:x*x+y*y,half=6,step=2)
        for u in (0,.1,.25,.5,.9,1):
            self.assertAlmostEqual(sample(grid,2*u,2*(1-u)),4,places=6)

    def test_flat_and_linear_hills_are_exact(self):
        grid=canonical_grid(lambda x,y:.08*x-.04*y,half=6,step=2)
        for x,y in ((-5.7,1.5),(2.3,-.8),(0,0)):
            self.assertAlmostEqual(sample(grid,x,y),.08*x-.04*y,places=6)

    def test_extent_is_explicit(self):
        grid=canonical_grid(lambda x,y:0,half=6,step=2)
        self.assertTrue(inside(grid,6,6));self.assertFalse(inside(grid,7,0))

    def test_clipped_overlays_share_base_triangle_planes(self):
        from bridge_geometry import refined_mesh
        from surface_network import export
        from shapely.geometry import Polygon,box
        grid=canonical_grid(lambda x,y:x*y/6,half=12,step=2)
        shape=Polygon([(-4.7,-5.2),(7.1,1.3),(.2,8.4)])
        mesh=refined_mesh(export(shape),box(-12,-12,12,12))
        for face in mesh['faces']:
            points=[mesh['vertices'][i]for i in face]
            x=sum(p[0]for p in points)/3;y=sum(p[1]for p in points)/3
            self.assertAlmostEqual(sample(grid,x,y),sum(sample(grid,*p)for p in points)/3,places=6)

if __name__=='__main__':unittest.main()
