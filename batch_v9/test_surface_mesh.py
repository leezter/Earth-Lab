import unittest
import json
from pathlib import Path
from shapely.geometry import Polygon, box
from shapely.ops import triangulate
from surface_mesh import flat_mesh, coverage, source_shape, roof_surface


def parts(p):
    return [[list(p.exterior.coords),*[list(r.coords) for r in p.interiors]]]


class SurfaceMeshTests(unittest.TestCase):
    def test_reported_real_scene_footprints(self):
        fixtures=json.loads((Path(__file__).parent/'testdata/mesh_regressions.json').read_text())['cases']
        for case in fixtures:
            with self.subTest(location=case['name']):
                source=source_shape(case['parts'])
                # Establish that these source shapes exercise the old fault.
                retained=[t for t in triangulate(source) if source.covers(t.buffer(-.00001))]
                from shapely.ops import unary_union
                self.assertGreater(source.difference(unary_union(retained)).area,100)
                metrics=coverage(source,flat_mesh(case['parts'],box(-96,-96,96,96)))
                self.assertLess(metrics['missing_m2'],1e-7)
                self.assertLess(metrics['outside_m2'],1e-7)

    def test_concave_road_has_no_discarded_wedges(self):
        p=Polygon([(0,0),(30,0),(30,4),(7,4),(7,30),(0,30)])
        m=flat_mesh(parts(p),box(-1,-1,40,40))
        self.assertLess(coverage(p,m)['missing_m2'],1e-8)

    def test_holes_and_disconnected_clip(self):
        p=Polygon([(0,0),(30,0),(30,30),(0,30)], [[(5,5),(5,25),(25,25),(25,5)]])
        clip=box(0,10,30,20)
        m=flat_mesh(parts(p),clip)
        report=coverage(p,m,clip)
        self.assertLess(report['missing_m2'],1e-8)
        self.assertLess(report['outside_m2'],1e-8)

    def test_pitched_roof_keeps_concave_outline_and_courtyard(self):
        p=Polygon([(0,0),(16,0),(16,6),(10,6),(10,16),(0,16)], [[(2,2),(2,5),(5,5),(5,2)]])
        points=[*p.exterior.coords,*p.interiors[0].coords,(7,3),(7,8),(4,10)]
        mesh=roof_surface(p,points,lambda x,y:10+min(p.boundary.distance(__import__('shapely').Point(x,y)),3)*.65)
        self.assertLess(coverage(p,mesh)['missing_m2'],1e-8)
        self.assertTrue(any(v[2]>10 for v in mesh['vertices']))

    def test_guard_rejects_missing_triangle_and_spill(self):
        p=box(0,0,10,10)
        for mesh in ({'vertices':[[0,0],[10,0],[0,10]],'faces':[[0,1,2]]},
                     {'vertices':[[0,0],[20,0],[0,20]],'faces':[[0,1,2]]}):
            with self.assertRaises(ValueError):coverage(p,mesh)

    def test_empty_and_overlapping_material_parts(self):
        self.assertEqual(flat_mesh([],box(0,0,1,1))['faces'],[])
        pieces=parts(box(0,0,10,10))+parts(box(5,0,15,10))
        target=source_shape(pieces)
        self.assertAlmostEqual(coverage(target,flat_mesh(pieces,box(-1,-1,20,20)))['mesh_m2'],150)

if __name__=='__main__':unittest.main()
